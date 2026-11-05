/**
 * Test du mode Contexte Long (style NotebookLM) et de la reformulation conversationnelle.
 * Exécution : npx tsx scripts/test_long_context_rag.ts
 */
import assert from 'node:assert/strict';
import { SermonChunk } from '../types';
import { buildLongContextEvidencePackage, rewriteFollowUpQuery, LONG_CONTEXT_VECTOR_METHOD } from '../services/longContextRagService';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService';
import { GeminiCaller, enforcePromptBudget } from '../services/generationAdapter';
import { aiConfig } from '../config/aiConfig';

function makeChunk(sermonId: string, paras: Array<[number, string]>): SermonChunk {
  return {
    chunkId: `${sermonId}_${paras[0][0]}`,
    sermonId,
    sermonTitle: `Titre ${sermonId}`,
    paragraphIds: paras.map(p => p[0]),
    startParagraph: paras[0][0],
    endParagraph: paras[paras.length - 1][0],
    text: paras.map(p => p[1]).join('\n\n'),
    date: '1963-03-24',
    characterCount: 0,
    wordCount: 0
  } as SermonChunk;
}

// Chunks avec chevauchement d'un paragraphe (§2), comme createSermonChunks
const chunks: SermonChunk[] = [
  makeChunk('63-0324M', [[1, 'La première phrase du sermon.'], [2, 'Le septième sceau est un mystère.']]),
  makeChunk('63-0324M', [[2, 'Le septième sceau est un mystère.'], [3, 'Le silence se fit dans le ciel.']]),
  makeChunk('65-1212', [[1, 'Un autre sermon sur la foi.']])
];

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

async function main() {
  await test('construit un package avec toutes les sources et sans doublon de chevauchement', async () => {
  const pkg = await buildLongContextEvidencePackage('Que dit-il ?', ['63-0324M', '65-1212'], { providedChunks: chunks });
  assert.ok(pkg);
  assert.equal(pkg.vectorMethod, LONG_CONTEXT_VECTOR_METHOD);
  assert.equal(pkg.evidence.length, 2);
  assert.deepEqual(pkg.evidence[0].citationParagraphs.map(c => c.paragraphIndex), [1, 2, 3]);
  assert.equal(pkg.evidence[0].citationParagraphs[1].fullParagraphText, 'Le septième sceau est un mystère.');
});

  await test('au-delà du budget, sélectionne localement des paragraphes répartis pour une synthèse', async () => {
  const pkg = await buildLongContextEvidencePackage('Résume ce sermon', ['63-0324M'], { providedChunks: chunks.filter(c => c.sermonId === '63-0324M'), maxChars: 70 });
  assert.ok(pkg);
  assert.equal(pkg.isPartial, true);
  const chars = pkg.evidence.flatMap(e => e.citationParagraphs).reduce((n, cp) => n + (cp.fullParagraphText || '').length, 0);
  assert.ok(chars <= 70, `budget respecté (${chars})`);
  assert.ok(pkg.evidence[0].citationParagraphs.length >= 1);
});

  await test('le plafond du prompt retire les preuves les moins bien classées', async () => {
  const big = (n: number) => 'Le septième sceau est un mystère. '.repeat(n);
  const evidence = [1, 2, 3].map(i => ({
    chunkId: `c${i}`, sermonId: '63-0324M', sermonTitle: 'T', paragraphIds: [i], startParagraph: i, endParagraph: i,
    text: big(40), retrievalScore: 1, rank: i, sourceType: 'reranked' as const,
    citationParagraphs: [{ paragraphIndex: i, formattedCitation: `[Réf: 63-0324M, §${i}]`, textSnippet: big(40), fullParagraphText: big(40), isAuthentic: true }]
  }));
  const pkg = { answerable: true, confidenceScore: 1, reason: '', evidence, query: 'q' };
  const trimmed = enforcePromptBudget(pkg as any, 'q', false, 6000);
  assert.ok(trimmed.evidence.length < 3 && trimmed.evidence.length >= 1);
  assert.deepEqual(trimmed.evidence.map(e => e.rank), [1, 2, 3].slice(0, trimmed.evidence.length));
  assert.equal(enforcePromptBudget(pkg as any, 'q', false, 1_000_000).evidence.length, 3);
});

  await test('un quota Gemini atteint donne un message clair sans détail technique', async () => {
  const client: GeminiCaller = { async generateContent() { throw new Error('429 RESOURCE_EXHAUSTED: input tokens per minute exceeded'); } };
  const res = await executeUnifiedRagAssistantFlow('Résume ce sermon', ['63-0324M'], {
    providedChunks: chunks.filter(c => c.sermonId === '63-0324M'),
    geminiClient: client,
    useDeepStudentMode: false
  });
  assert.equal(res.status, 'error');
  assert.ok(res.errorMessage && !/token|429|quota|RESOURCE/i.test(res.errorMessage), res.errorMessage || '');
});

  await test('retourne null si trop de sources sont sélectionnées', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `sermon-${i}`);
  const pkg = await buildLongContextEvidencePackage('q', ids, { maxSources: 40 });
  assert.equal(pkg, null);
});

  await test('le flux complet transmet le texte intégral à Gemini', async () => {
  let sentPrompt = '';
  const client: GeminiCaller = {
    async generateContent(p) {
      sentPrompt = typeof p.contents === 'string' ? p.contents : JSON.stringify(p.contents);
      return {
        text: JSON.stringify({
          answerability: true,
          summary: 'Le sermon traite du septième sceau.',
          arguments: [{
            pointTitle: 'Le mystère',
            explanation: 'Le sceau est présenté comme un mystère.',
            citations: [{ sourceId: '63-0324M', paragraphIndex: 2, exactQuote: 'Le septième sceau est un mystère.' }]
          }],
          deepDiveQuestions: []
        }),
        candidates: [{ finishReason: 'STOP' }]
      };
    }
  };
  const res = await executeUnifiedRagAssistantFlow('Résume ce sermon', ['63-0324M'], {
    providedChunks: chunks.filter(c => c.sermonId === '63-0324M'),
    geminiClient: client,
    useDeepStudentMode: false
  });
  assert.equal(res.status, 'success');
  assert.equal(res.vectorMethod, LONG_CONTEXT_VECTOR_METHOD);
  assert.ok(sentPrompt.includes('Le silence se fit dans le ciel.'), 'le dernier paragraphe doit être transmis');
  assert.ok(sentPrompt.includes('SOURCES SÉLECTIONNÉES'));
});

  await test('reformule une question de relance via le client fourni', async () => {
  const client: GeminiCaller = {
    async generateContent() {
      return { text: '« Que signifie le silence dans le ciel lors du septième sceau ? »' };
    }
  };
  const rewritten = await rewriteFollowUpQuery('Et ce silence ?', [
    { role: 'user', content: 'Parle-moi du septième sceau', timestamp: '' },
    { role: 'assistant', content: 'Le septième sceau est un mystère...', timestamp: '' }
  ] as any, { geminiClient: client });
  assert.equal(rewritten, 'Que signifie le silence dans le ciel lors du septième sceau ?');
});

  await test('la reformulation retourne null après le délai maximal', async () => {
  const client: GeminiCaller = { generateContent: () => new Promise(() => {}) };
  const rewritten = await rewriteFollowUpQuery('Et ensuite ?', [
    { role: 'user', content: 'Question précédente', timestamp: '' }
  ] as any, { geminiClient: client, timeoutMs: 50 });
  assert.equal(rewritten, null);
});

  // Sermon long (~170 000 caractères) : au-delà des deux budgets du contexte long
  const longParas: Array<[number, string]> = [];
  for (let p = 1; p <= 200; p++) {
    const topic = p % 10 === 0
      ? 'Le septième sceau est le mystère caché, et le silence se fit dans le ciel pendant une demi-heure.'
      : 'Nous parlons ce soir de la foi qui vient de ce que l’on entend, et de la grâce de Dieu envers son peuple.';
    longParas.push([p, `${p}. ${topic} ${'Le prédicateur développe longuement cette pensée devant l’assemblée réunie. '.repeat(10)}`]);
  }
  const longChunks: SermonChunk[] = [];
  for (let p = 0; p < longParas.length; p += 2) longChunks.push(makeChunk('63-0318', longParas.slice(p, p + 2)));

  const captureClient = () => {
    const sent: { prompt: string; instruction: string }[] = [];
    const client: GeminiCaller = {
      async generateContent(p) {
        sent.push({ prompt: typeof p.contents === 'string' ? p.contents : JSON.stringify(p.contents), instruction: String(p.config?.systemInstruction || '') });
        return { text: JSON.stringify({ answerability: true, summary: 'Réponse.', arguments: [], deepDiveQuestions: [] }), candidates: [{ finishReason: 'STOP' }] };
      }
    };
    return { client, sent };
  };

  await test('budget adaptatif : question ciblée sous le budget standard, résumé sous le budget approfondi', async () => {
    const quiet = console.log;
    console.log = () => {};
    try {
      const targeted = captureClient();
      await executeUnifiedRagAssistantFlow('Que signifie le septième sceau ?', ['63-0318'], { providedChunks: longChunks, geminiClient: targeted.client, useDeepStudentMode: false });
      const summary = captureClient();
      await executeUnifiedRagAssistantFlow('Résume ce sermon', ['63-0318'], { providedChunks: longChunks, geminiClient: summary.client, useDeepStudentMode: false });
      console.log = quiet;
      assert.equal(targeted.sent.length, 1, 'un seul appel Gemini');
      assert.equal(summary.sent.length, 1, 'un seul appel Gemini');
      const tLen = targeted.sent[0].prompt.length;
      const sLen = summary.sent[0].prompt.length;
      assert.ok(tLen <= aiConfig.tokenBudgetConfig.standardPromptChars, `ciblée : ${tLen}`);
      assert.ok(sLen > tLen && sLen <= aiConfig.tokenBudgetConfig.maxPromptChars, `résumé : ${sLen}`);
      assert.ok(targeted.sent[0].prompt.includes('septième sceau'), 'les passages pertinents sont retenus');
    } finally {
      console.log = quiet;
    }
  });

  await test('mode étude : règles de fiabilité conservées, plan d’étude et règles de qualité ajoutés', async () => {
    const quiet = console.log;
    console.log = () => {};
    try {
      const study = captureClient();
      await executeUnifiedRagAssistantFlow('Résume ce sermon', ['63-0318'], { providedChunks: longChunks, geminiClient: study.client, useDeepStudentMode: false });
      const targeted = captureClient();
      await executeUnifiedRagAssistantFlow('Que signifie le septième sceau ?', ['63-0318'], { providedChunks: longChunks, geminiClient: targeted.client, useDeepStudentMode: false });
      console.log = quiet;
      const si = study.sent[0].instruction;
      assert.ok(si.includes('INTERDICTION ABSOLUE DE TOUTE CONNAISSANCE EXTÉRIEURE'));
      assert.ok(si.includes('RÈGLES DE RÉDACTION'));
      assert.ok(si.includes("PLAN D'ÉTUDE APPROFONDIE"));
      const ti = targeted.sent[0].instruction;
      assert.ok(ti.includes('RÈGLES DE RÉDACTION') && !ti.includes("PLAN D'ÉTUDE APPROFONDIE"));
    } finally {
      console.log = quiet;
    }
  });

  console.log(`\n${passed} test(s) réussi(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
