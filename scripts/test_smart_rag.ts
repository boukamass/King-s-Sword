/**
 * Tests du Smart Retrieval (compréhension Gemini + multi-requêtes + reranking + repli local).
 * Exécution : npx tsx scripts/test_smart_rag.ts
 */
import assert from 'node:assert/strict';
import { SermonChunk } from '../types';
import { executeSmartRetrieval, SMART_RETRIEVAL_VECTOR_METHOD } from '../services/smartRagService';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService';
import { GeminiCaller } from '../services/generationAdapter';
import { aiConfig } from '../config/aiConfig';

const TOPICS = [
  'Le septième sceau est le mystère du retour du Seigneur et le silence dans le ciel.',
  'La foi est une ferme assurance des choses que l’on espère, une révélation de Dieu.',
  'Le baptême du Saint-Esprit scelle le croyant pour le jour de la rédemption.',
  'Les sept âges de l’Église correspondent aux sept églises de l’Apocalypse.'
];

// Corpus synthétique de 6 sermons × 8 chunks (au-dessus du budget du contexte long)
const chunks: SermonChunk[] = [];
for (let s = 0; s < 6; s++) {
  for (let p = 1; p <= 8; p++) {
    const text = `${p}. ${TOPICS[(s + p) % TOPICS.length]} Paragraphe ${p} du sermon numéro ${s} avec des détails supplémentaires pour l'étude.`;
    chunks.push({
      chunkId: `6${s}-0101_c${p}_p${p}_p${p}`,
      sermonId: `6${s}-0101`,
      sermonTitle: `Sermon ${s}`,
      paragraphIds: [p],
      startParagraph: p,
      endParagraph: p,
      text,
      date: `196${s}-01-01`,
      characterCount: text.length,
      wordCount: 20
    } as SermonChunk);
  }
}
const contextIds = Array.from(new Set(chunks.map(c => c.sermonId)));

function makeClient(opts: { failRerank?: boolean } = {}): GeminiCaller & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async generateContent(p) {
      const prompt = typeof p.contents === 'string' ? p.contents : JSON.stringify(p.contents);
      if (prompt.includes('Tu prépares une recherche documentaire')) {
        calls.push('understanding');
        return { text: JSON.stringify({ standaloneQuestion: 'Que signifie le septième sceau ?', searchQueries: ['septième sceau silence ciel', 'retour du Seigneur mystère'] }) };
      }
      if (prompt.includes('Évalue la pertinence de chaque passage')) {
        calls.push('rerank');
        if (opts.failRerank) throw new Error('503 overloaded');
        const ids = Array.from(prompt.matchAll(/^\[(\d+)\] \(([^)]*)\)\n(.*)$/gm));
        return { text: JSON.stringify({ scores: ids.map(m => ({ id: Number(m[1]), score: m[3].includes('septième sceau') ? 3 : 0 })) }) };
      }
      calls.push('generation');
      return {
        text: JSON.stringify({
          answerability: true,
          summary: 'Le septième sceau est le mystère du retour du Seigneur.',
          arguments: [],
          deepDiveQuestions: []
        }),
        candidates: [{ finishReason: 'STOP' }]
      };
    }
  };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

async function main() {
  const quiet = console.log;
  const restore = () => { console.log = quiet; };

  await test('ne retient que les passages jugés pertinents, avec diversité et contexte adjacent', async () => {
    const client = makeClient();
    console.log = () => {};
    const res = await executeSmartRetrieval('Et ce sceau ?', contextIds, { providedChunks: chunks, geminiClient: client });
    restore();
    assert.equal(res.status, 'ok');
    assert.equal(res.standaloneQuery, 'Que signifie le septième sceau ?');
    const pkg = res.evidencePackage!;
    assert.equal(pkg.vectorMethod, SMART_RETRIEVAL_VECTOR_METHOD);
    assert.ok(pkg.answerable);
    assert.ok(pkg.evidence.length > 0);
    assert.ok(pkg.evidence.every(e => e.text.includes('septième sceau')), 'seuls les passages pertinents');
    const perDoc = new Map<string, number>();
    for (const e of pkg.evidence) perDoc.set(e.sermonId, (perDoc.get(e.sermonId) || 0) + 1);
    assert.ok(Math.max(...perDoc.values()) <= aiConfig.smartRetrievalConfig.maxPerDoc);
    assert.ok(pkg.evidence.some(e => e.adjacentContext), 'contexte adjacent ±1');
  });

  await test('déclare la question non couverte quand aucun passage n’est pertinent', async () => {
    const client: GeminiCaller = {
      async generateContent(p) {
        const prompt = String(p.contents);
        if (prompt.includes('Tu prépares')) return { text: JSON.stringify({ standaloneQuestion: 'Que dit-il de la tour Eiffel ?', searchQueries: [] }) };
        const ids = Array.from(prompt.matchAll(/^\[(\d+)\]/gm));
        return { text: JSON.stringify({ scores: ids.map(m => ({ id: Number(m[1]), score: 0 })) }) };
      }
    };
    console.log = () => {};
    const res = await executeSmartRetrieval('Que dit-il de la tour Eiffel ?', contextIds, { providedChunks: chunks, geminiClient: client });
    restore();
    assert.equal(res.status, 'ok');
    assert.equal(res.evidencePackage!.answerable, false);
  });

  await test('renvoie fallback si le reranking Gemini échoue (quota / surcharge)', async () => {
    console.log = () => {};
    const res = await executeSmartRetrieval('Que signifie le septième sceau ?', contextIds, { providedChunks: chunks, geminiClient: makeClient({ failRerank: true }) });
    restore();
    assert.equal(res.status, 'fallback');
  });

  await test('le flux complet utilise le smart retrieval quand il est activé (option, désactivé par défaut)', async () => {
    const client = makeClient();
    const savedSources = aiConfig.longContextConfig.maxSources;
    const savedFlag = aiConfig.featureFlags.useSmartRetrieval;
    aiConfig.longContextConfig.maxSources = 2;
    aiConfig.featureFlags.useSmartRetrieval = true;
    console.log = () => {};
    try {
      const res = await executeUnifiedRagAssistantFlow('Que signifie le septième sceau ?', contextIds, {
        providedChunks: chunks,
        geminiClient: client,
        useSmartRetrieval: true,
        useDeepStudentMode: false
      });
      restore();
      assert.equal(res.status, 'success');
      assert.equal(res.vectorMethod, SMART_RETRIEVAL_VECTOR_METHOD);
      assert.deepEqual(client.calls.filter(c => c !== 'rerank'), ['understanding', 'generation']);
    } finally {
      restore();
      aiConfig.longContextConfig.maxSources = savedSources;
      aiConfig.featureFlags.useSmartRetrieval = savedFlag;
    }
  });

  await test('le flux complet bascule sur le pipeline local si Gemini échoue au reranking', async () => {
    const client = makeClient({ failRerank: true });
    const savedSources = aiConfig.longContextConfig.maxSources;
    const savedFlag = aiConfig.featureFlags.useSmartRetrieval;
    aiConfig.longContextConfig.maxSources = 2;
    aiConfig.featureFlags.useSmartRetrieval = true;
    console.log = () => {};
    try {
      const res = await executeUnifiedRagAssistantFlow('Que signifie le septième sceau ?', contextIds, {
        providedChunks: chunks,
        geminiClient: client,
        useSmartRetrieval: true,
        useDeepStudentMode: false
      });
      restore();
      assert.notEqual(res.vectorMethod, SMART_RETRIEVAL_VECTOR_METHOD);
      assert.ok(res.status === 'success' || res.status === 'not_answerable');
    } finally {
      restore();
      aiConfig.longContextConfig.maxSources = savedSources;
      aiConfig.featureFlags.useSmartRetrieval = savedFlag;
    }
  });

  await test('configuration par défaut : au plus UN appel Gemini par question sur une grande sélection', async () => {
    const client = makeClient();
    const savedSources = aiConfig.longContextConfig.maxSources;
    aiConfig.longContextConfig.maxSources = 2;
    console.log = () => {};
    try {
      const res = await executeUnifiedRagAssistantFlow('Que signifie le septième sceau ?', contextIds, {
        providedChunks: chunks,
        geminiClient: client,
        useDeepStudentMode: false
      });
      restore();
      assert.ok(client.calls.length <= 1, `appels Gemini : ${client.calls.join(', ')}`);
      assert.ok(res.status === 'success' || res.status === 'not_answerable');
    } finally {
      restore();
      aiConfig.longContextConfig.maxSources = savedSources;
    }
  });

  console.log(`\n${passed} test(s) réussi(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
