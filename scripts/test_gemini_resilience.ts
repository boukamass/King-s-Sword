/**
 * Tests de résilience Gemini (P1 à P6) : requêtes réellement émises vers l'API (fetch simulé),
 * cascade de modèles, nouvelles tentatives sur surcharge, clés refusées, expansion locale, budget de sélection.
 * Exécution : npx tsx scripts/test_gemini_resilience.ts
 */
import assert from 'node:assert/strict';
import { SermonChunk } from '../types';
import { generateNewRagResponse, classifyGeminiError, OVERLOAD_RETRY_DELAYS_MS } from '../services/generationAdapter';
import { expandTheologicalQuery } from '../services/theologicalQueryService';
import { buildLongContextEvidencePackage } from '../services/longContextRagService';

// Messages réels relevés dans la console de l'application
const REAL_503 = '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';
const REAL_429 = '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}';
const REAL_401 = '{"error":{"code":401,"message":"API key not valid. Please pass a valid API key.","status":"UNAUTHENTICATED"}}';
const REAL_404 = '{"error":{"code":404,"message":"models/gemini-2.5-flash is not found for API version v1beta","status":"NOT_FOUND"}}';

const SUCCESS_BODY = JSON.stringify({
  candidates: [{
    content: { role: 'model', parts: [{ text: JSON.stringify({ answerability: true, summary: 'Réponse développée.', arguments: [], deepDiveQuestions: [] }) }] },
    finishReason: 'STOP'
  }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
});

type Reply = { status: number; body: string };
let requestedUrls: string[] = [];
let replies: Array<(url: string) => Reply> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.includes('generativelanguage.googleapis.com')) return originalFetch(input);
  requestedUrls.push(url);
  const next = replies.shift();
  const reply = next ? next(url) : { status: 500, body: '{"error":{"code":500,"message":"no reply"}}' };
  return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

const modelOf = (url: string) => (url.match(/models\/([^:]+):/) || [])[1];

const evidencePackage = {
  answerable: true,
  confidenceScore: 1,
  reason: '',
  query: 'Que signifie le septième sceau ?',
  evidence: [{
    chunkId: 'c1', sermonId: '63-0324E', sermonTitle: 'Le septième sceau', paragraphIds: [1], startParagraph: 1, endParagraph: 1,
    text: 'Le septième sceau est un mystère.', retrievalScore: 1, rank: 1, sourceType: 'reranked' as const,
    citationParagraphs: [{ paragraphIndex: 1, formattedCitation: '[Réf: 63-0324E, §1]', textSnippet: 'Le septième sceau est un mystère.', fullParagraphText: 'Le septième sceau est un mystère.', isAuthentic: true }]
  }]
};

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  requestedUrls = [];
  replies = [];
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

async function main() {
  // Isole le test des clés éventuellement définies dans l'environnement de la machine (processus de test uniquement)
  delete process.env.GEMINI_API_KEY;
  delete process.env.API_KEY;
  const quiet = { log: console.log, warn: console.warn };
  // Délais de nouvelle tentative raccourcis pour le test (mêmes nombre et ordre de tentatives)
  OVERLOAD_RETRY_DELAYS_MS.splice(0, OVERLOAD_RETRY_DELAYS_MS.length, 5, 5);
  const silence = () => { console.log = () => {}; console.warn = () => {}; };
  const restore = () => { console.log = quiet.log; console.warn = quiet.warn; };

  await test('classification des erreurs réelles de la console', async () => {
    assert.equal(classifyGeminiError(new Error(REAL_503)), 'overloaded');
    assert.equal(classifyGeminiError(new Error(REAL_429)), 'quota');
    assert.equal(classifyGeminiError(new Error(REAL_401)), 'auth');
    assert.equal(classifyGeminiError(new Error(REAL_404)), 'model_unavailable');
  });

  await test('P2/P3/P5 : surcharge persistante → 2 nouvelles tentatives, jamais Pro ni 2.5, message « surchargé »', async () => {
    replies = Array.from({ length: 10 }, () => () => ({ status: 503, body: REAL_503 }));
    const progress: string[] = [];
    silence();
    const res = await generateNewRagResponse({ query: 'q', evidencePackage, apiKey: 'AIzaTEST-KEY-A', onProgress: m => progress.push(m) });
    restore();
    const models = requestedUrls.map(modelOf);
    assert.deepEqual(models, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-flash-latest']);
    assert.equal(res.errorCode, 'SERVICE_UNAVAILABLE');
    assert.ok(/surchargé/.test(res.errorMessage || ''), res.errorMessage || '');
    assert.equal(progress.length, 2);
  });

  await test('P3 : surcharge passagère → nouvelle tentative réussie, réponse rédigée', async () => {
    replies = [() => ({ status: 503, body: REAL_503 }), () => ({ status: 200, body: SUCCESS_BODY })];
    silence();
    const res = await generateNewRagResponse({ query: 'q', evidencePackage, apiKey: 'AIzaTEST-KEY-B' });
    restore();
    assert.equal(res.status, 'success');
    assert.equal(requestedUrls.length, 2);
  });

  await test('P4/P5 : clé refusée (401) → 1 seule requête, message « clé », clé ignorée ensuite', async () => {
    replies = [() => ({ status: 401, body: REAL_401 })];
    silence();
    const res = await generateNewRagResponse({ query: 'q', evidencePackage, apiKey: 'INVALID-KEY-C' });
    restore();
    assert.equal(requestedUrls.length, 1);
    assert.equal(res.errorCode, 'API_KEY_INVALID');
    assert.ok(/clé/i.test(res.errorMessage || ''));
    requestedUrls = [];
    silence();
    const again = await generateNewRagResponse({ query: 'q', evidencePackage, apiKey: 'INVALID-KEY-C' });
    restore();
    assert.equal(requestedUrls.length, 0, 'la clé refusée n\'est plus sollicitée');
    assert.equal(again.status, 'error');
  });

  await test('P4 : quota (429) sur le modèle principal → pas d\'essai des autres modèles avec la même clé', async () => {
    replies = [() => ({ status: 429, body: REAL_429 })];
    silence();
    const res = await generateNewRagResponse({ query: 'q', evidencePackage, apiKey: 'AIzaTEST-KEY-D' });
    restore();
    assert.equal(requestedUrls.length, 1);
    assert.equal(res.errorCode, 'RESOURCE_EXHAUSTED');
  });

  await test('P1 : expansion théologique strictement locale quand le distant est désactivé (0 requête)', async () => {
    silence();
    const res = await expandTheologicalQuery('Que signifie le septième sceau ?', 'AIzaTEST-KEY-E', false);
    restore();
    assert.equal(requestedUrls.length, 0);
    assert.ok(res.expandedQuery.length > 0);
  });

  await test('P6 : copie identique d\'un paragraphe de chevauchement retirée et budget de sélection respecté', async () => {
    const longPara = `5. ${'Le septième sceau est le mystère caché de Dieu. '.repeat(30)}`;
    const make = (id: string, paras: Array<[number, string]>): SermonChunk => ({
      chunkId: id, sermonId: '63-0324E', sermonTitle: 'Le septième sceau', paragraphIds: paras.map(p => p[0]),
      startParagraph: paras[0][0], endParagraph: paras[paras.length - 1][0], text: paras.map(p => p[1]).join('\n\n'),
      characterCount: 0, wordCount: 0
    } as SermonChunk);
    const chunks = [
      make('a', [[4, '4. Introduction du sermon.'], [5, longPara]]),
      make('b', [[5, longPara]]),
      make('c', [[5, longPara], [6, '6. Conclusion de la réunion.']])
    ];
    const full = await buildLongContextEvidencePackage('Résume ce sermon', ['63-0324E'], { providedChunks: chunks, maxChars: 100000 });
    assert.ok(full);
    assert.deepEqual(full.evidence[0].citationParagraphs.map(cp => cp.paragraphIndex), [4, 5, 6]);
    const budget = 1200;
    const partial = await buildLongContextEvidencePackage('Résume ce sermon', ['63-0324E'], { providedChunks: chunks, maxChars: budget });
    assert.ok(partial);
    assert.equal(partial.isPartial, true, 'la sélection plafonnée est bien exercée');
    const chars = partial.evidence.flatMap(e => e.citationParagraphs).reduce((n, cp) => n + (cp.fullParagraphText || '').length, 0);
    assert.ok(chars <= budget, `budget respecté (${chars} ≤ ${budget})`);
  });

  console.log(`\n${passed} test(s) réussi(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
