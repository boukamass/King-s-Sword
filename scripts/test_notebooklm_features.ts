/**
 * Tests des améliorations de type NotebookLM : flux, relances, rédaction, mode local, questions complexes.
 * Exécution : npx tsx scripts/test_notebooklm_features.ts
 */
import assert from 'node:assert/strict';
import { ChatMessage, SermonChunk } from '../types';
import { parsePartialJson, renderPartialStructuredAnswer } from '../services/streamingAnswerService';
import {
  buildHistoryForPrompt,
  compactAssistantMessage,
  extractPreviousCitedParagraphs,
  injectFollowUpSources,
  buildFollowUpCacheSignature
} from '../services/followUpContextService';
import { decomposeComplexQuery, stripQuestionScaffolding, fuseRankedLists } from '../services/complexQueryService';
import { extractUnifiedQueryTerms } from '../services/unifiedRagService';
import { buildLongContextEvidencePackage } from '../services/longContextRagService';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService';
import {
  GeminiCaller,
  generateNewRagResponse,
  buildStructuredAnswerMarkdown,
  toSuperscriptNumber,
  FOLLOW_UP_RULES,
  NATURAL_PROSE_RULES
} from '../services/generationAdapter';
import { validateResponseCitations } from '../services/citationValidationService';

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

const chunks: SermonChunk[] = [
  makeChunk('63-0324M', [[1, 'La première phrase du sermon.'], [2, 'Le septième sceau est un mystère.']]),
  makeChunk('63-0324M', [[3, 'Le silence se fit dans le ciel environ une demi-heure.'], [4, 'Personne ne savait ce qui se passait.']]),
  makeChunk('63-0324M', [[5, 'La grâce de Dieu est suffisante pour toi.'], [6, 'La foi vient de ce que l\'on entend.']])
];

const VALID_JSON = JSON.stringify({
  answerability: true,
  summary: 'Le sermon traite du septième sceau et du silence dans le ciel.',
  arguments: [{
    pointTitle: 'Le mystère du sceau',
    explanation: 'Le sceau est présenté comme un mystère caché.',
    citations: [{ sourceId: '63-0324M', paragraphIndex: 2, exactQuote: 'Le septième sceau est un mystère.' }]
  }, {
    pointTitle: 'Le silence',
    explanation: 'Le ciel se tait.',
    citations: [{ sourceId: '63-0324M', paragraphIndex: 3, exactQuote: 'Le silence se fit dans le ciel environ une demi-heure.' }]
  }],
  deepDiveQuestions: ['Pourquoi ce silence ?']
});

const sermonPackage = () => ({
  answerable: true,
  confidenceScore: 1,
  reason: '',
  query: 'q',
  totalCandidates: 1,
  rejectedCount: 0,
  evidence: [{
    chunkId: 'c1', sermonId: '63-0324M', sermonTitle: 'Les Sceaux', paragraphIds: [2, 3], startParagraph: 2, endParagraph: 3,
    text: 'Le septième sceau est un mystère.\n\nLe silence se fit dans le ciel environ une demi-heure.',
    retrievalScore: 1, rank: 1, sourceType: 'reranked' as const,
    citationParagraphs: [
      { paragraphIndex: 2, formattedCitation: '[Réf: 63-0324M, §2]', textSnippet: 'Le septième sceau est un mystère.', fullParagraphText: 'Le septième sceau est un mystère.', isAuthentic: true },
      { paragraphIndex: 3, formattedCitation: '[Réf: 63-0324M, §3]', textSnippet: 'Le silence se fit dans le ciel environ une demi-heure.', fullParagraphText: 'Le silence se fit dans le ciel environ une demi-heure.', isAuthentic: true }
    ]
  }]
});

function streamOf(pieces: string[], failAfter?: number) {
  return (async function* () {
    for (let i = 0; i < pieces.length; i++) {
      if (failAfter !== undefined && i === failAfter) throw new Error('connexion interrompue');
      yield { text: pieces[i], candidates: i === pieces.length - 1 ? [{ finishReason: 'STOP' }] : [] };
    }
  })();
}

function splitInPieces(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

async function main() {
  // ---------- Q2 : flux ----------
  await test('JSON partiel : la synthèse est lisible dès ses premiers mots', () => {
    const partial = parsePartialJson('{"answerability": true, "summary": "Le sermon tra');
    assert.equal(partial.summary, 'Le sermon tra');
    assert.equal(parsePartialJson('{"answerability": tru'), null);
    assert.deepEqual(parsePartialJson(VALID_JSON), JSON.parse(VALID_JSON));
    for (let cut = 1; cut < VALID_JSON.length; cut += 7) parsePartialJson(VALID_JSON.slice(0, cut)); // jamais d'exception
  });

  await test('rendu provisoire : synthèse puis points, sans citations ; vide si refus', () => {
    const md = renderPartialStructuredAnswer(VALID_JSON.slice(0, VALID_JSON.indexOf('"citations"')));
    assert.ok(md.startsWith('## Synthèse\nLe sermon traite'));
    assert.ok(md.includes('### 1. Le mystère du sceau\nLe sceau est présenté comme un mystère caché.'));
    assert.ok(!md.includes('Réf:'));
    assert.equal(renderPartialStructuredAnswer('{"answerability": false, "summary": "Les documents"'), '');
  });

  await test('génération en flux : réponses provisoires successives puis réponse finale vérifiée, un seul appel', async () => {
    const partials: string[] = [];
    let streamCalls = 0;
    let plainCalls = 0;
    const client: GeminiCaller = {
      async generateContent() { plainCalls++; return { text: VALID_JSON, candidates: [{ finishReason: 'STOP' }] }; },
      async generateContentStream() { streamCalls++; return streamOf(splitInPieces(VALID_JSON, 25)); }
    };
    const res = await generateNewRagResponse({ query: 'Que dit-il du septième sceau ?', evidencePackage: sermonPackage() as any, geminiClient: client, onPartialAnswer: md => partials.push(md) });
    assert.equal(res.status, 'success');
    assert.equal(streamCalls, 1);
    assert.equal(plainCalls, 0);
    assert.ok(partials.length >= 3, `${partials.length} réponses provisoires`);
    assert.ok(partials[partials.length - 1].length >= partials[0].length);
    assert.ok(res.answerText!.includes('[Réf: 63-0324M, Para. 2]'));
  });

  await test('sans flux disponible, l\'appel classique est utilisé', async () => {
    let plainCalls = 0;
    const client: GeminiCaller = { async generateContent() { plainCalls++; return { text: VALID_JSON, candidates: [{ finishReason: 'STOP' }] }; } };
    const res = await generateNewRagResponse({ query: 'q', evidencePackage: sermonPackage() as any, geminiClient: client, onPartialAnswer: () => {} });
    assert.equal(res.status, 'success');
    assert.equal(plainCalls, 1);
  });

  await test('flux interrompu : une seule nouvelle tentative classique', async () => {
    let plainCalls = 0;
    const client: GeminiCaller = {
      async generateContent() { plainCalls++; return { text: VALID_JSON, candidates: [{ finishReason: 'STOP' }] }; },
      async generateContentStream() { return streamOf(splitInPieces(VALID_JSON, 40), 3); }
    };
    const res = await generateNewRagResponse({ query: 'q', evidencePackage: sermonPackage() as any, geminiClient: client, onPartialAnswer: () => {} });
    assert.equal(res.status, 'success');
    assert.equal(plainCalls, 1);
  });

  // ---------- Q4 : rédaction et appels de note ----------
  await test('réponse finale : appels de note en exposant et citations toujours validées', () => {
    assert.equal(toSuperscriptNumber(12), '¹²');
    const md = buildStructuredAnswerMarkdown(JSON.parse(VALID_JSON), true);
    assert.ok(md.includes('Le sceau est présenté comme un mystère caché. ¹'));
    assert.ok(md.includes('> ¹ « Le septième sceau est un mystère. » [Réf: 63-0324M, Para. 2]'));
    assert.ok(md.includes('> ² « Le silence se fit'));
    assert.ok(!/\[\d+\]/.test(md), 'aucun appel [n] confondable avec une référence');
    const validation = validateResponseCitations({ responseText: md, evidencePackage: sermonPackage() as any });
    assert.equal(validation.allCitationsValid, true);
  });

  await test('consignes de prose naturelle toujours présentes ; consignes de relance seulement en conversation', async () => {
    const instructions: string[] = [];
    const client: GeminiCaller = { async generateContent(p) { instructions.push(String(p.config.systemInstruction)); return { text: VALID_JSON, candidates: [{ finishReason: 'STOP' }] }; } };
    await generateNewRagResponse({ query: 'q', evidencePackage: sermonPackage() as any, geminiClient: client });
    await generateNewRagResponse({ query: 'Et pourquoi ?', evidencePackage: sermonPackage() as any, geminiClient: client, history: [
      { role: 'user', content: 'Le septième sceau ?', timestamp: '' },
      { role: 'assistant', content: '## Synthèse\nC\'est un mystère.', timestamp: '' }
    ] });
    assert.ok(instructions[0].includes(NATURAL_PROSE_RULES.trim().slice(0, 40)));
    assert.ok(!instructions[0].includes('CONVERSATION EN COURS'));
    assert.ok(instructions[1].includes(FOLLOW_UP_RULES.trim().slice(0, 40)));
  });

  // ---------- Q3 / Q1 : relances ----------
  const answer = `## Synthèse\nLe septième sceau est un mystère que Dieu garde.\n\n## Démonstrations & Arguments Doctrinaux\n\n### 1. Le mystère\nExplication. ¹\n\n> ¹ « Le septième sceau est un mystère. » [Réf: 63-0324M, Para. 2]\n\n### 2. Le silence\nExplication. ²\n\n> ² « Le silence se fit dans le ciel environ une demi-heure. » [Réf: 63-0324M, Para. 3]\n`;
  const history: ChatMessage[] = [
    { role: 'user', content: 'Que dit-il du septième sceau ?', timestamp: '' },
    { role: 'assistant', content: answer, timestamp: '' }
  ];

  await test('historique compact : synthèse, points et passages cités au lieu du texte complet', () => {
    const compact = compactAssistantMessage(answer);
    assert.ok(compact.includes('Synthèse de ma réponse précédente : Le septième sceau est un mystère que Dieu garde.'));
    assert.ok(compact.includes('1. Le mystère ; 2. Le silence'));
    assert.ok(compact.includes('63-0324M §2, 63-0324M §3'));
    const long: ChatMessage[] = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? answer : `Question ${i}`, timestamp: '' } as ChatMessage));
    assert.equal(buildHistoryForPrompt(long).length, 10);
  });

  await test('relance : les sources ouvrent la conversation (préfixe stable) et la question vient en dernier', async () => {
    let contents: any = null;
    const client: GeminiCaller = { async generateContent(p) { contents = p.contents; return { text: VALID_JSON, candidates: [{ finishReason: 'STOP' }] }; } };
    await generateNewRagResponse({ query: 'Et pourquoi ce silence ?', evidencePackage: sermonPackage() as any, geminiClient: client, history });
    assert.ok(Array.isArray(contents));
    assert.equal(contents[0].role, 'user');
    assert.ok(contents[0].parts[0].text.includes('Le septième sceau est un mystère.'));
    assert.equal(contents[1].role, 'model');
    assert.ok(contents[contents.length - 1].parts[0].text.startsWith('QUESTION DU CHERCHEUR'));
    assert.ok(contents[contents.length - 2].parts[0].text.startsWith('Synthèse de ma réponse précédente'));
  });

  await test('paragraphes cités dans la réponse précédente extraits dans l\'ordre', () => {
    assert.deepEqual(extractPreviousCitedParagraphs(history), [
      { sermonId: '63-0324M', paragraphIndex: 2 },
      { sermonId: '63-0324M', paragraphIndex: 3 }
    ]);
    assert.notEqual(buildFollowUpCacheSignature(history), buildFollowUpCacheSignature(history.slice(0, 1)));
  });

  await test('relance jugée hors sujet localement : les passages précédents la rendent répondable', async () => {
    const empty = { answerable: false, confidenceScore: 0, reason: 'hors sujet', evidence: [], query: 'pourquoi ?', totalCandidates: 0, rejectedCount: 0 };
    const pkg = await injectFollowUpSources(empty as any, extractPreviousCitedParagraphs(history), ['63-0324M'], { providedChunks: chunks });
    assert.equal(pkg.answerable, true);
    const paragraphs = pkg.evidence.flatMap(e => e.citationParagraphs.map(cp => cp.paragraphIndex));
    assert.ok(paragraphs.includes(2) && paragraphs.includes(3));
    assert.ok(!paragraphs.includes(5), 'seulement les paragraphes cités et leurs voisins');
  });

  await test('contexte long plafonné : les passages de la réponse précédente sont sélectionnés en priorité', async () => {
    const pkg = await buildLongContextEvidencePackage('Et pourquoi ?', ['63-0324M'], {
      providedChunks: chunks,
      maxChars: 120,
      priorityParagraphs: [{ sermonId: '63-0324M', paragraphIndex: 3 }]
    });
    assert.ok(pkg, 'la relance reste répondable');
    const kept = pkg!.evidence.flatMap(e => e.citationParagraphs.map(cp => cp.paragraphIndex));
    assert.ok(kept.includes(3), `paragraphes retenus : ${kept.join(',')}`);
  });

  // ---------- Q1 : mode local ----------
  await test('mode local : aucun appel Gemini, les passages trouvés sont rendus', async () => {
    let calls = 0;
    const client: GeminiCaller = { async generateContent() { calls++; return { text: VALID_JSON }; } };
    const res = await executeUnifiedRagAssistantFlow('Résume ce sermon', ['63-0324M'], {
      providedChunks: chunks, geminiClient: client, useDeepStudentMode: false, localOnly: true
    });
    assert.equal(calls, 0);
    assert.equal(res.generationResult?.errorCode, 'LOCAL_ONLY');
    assert.ok(res.evidencePackage.evidence.length > 0);
  });

  // ---------- Q5 : questions complexes ----------
  await test('question complexe : formules de cadrage retirées et volets séparés', () => {
    const q = "Pourriez-vous m'expliquer en détail selon frère Branham ce que représente le septième sceau et pourquoi le silence dans le ciel a duré une demi-heure ?";
    const core = stripQuestionScaffolding(q);
    assert.ok(!/pourriez|expliquer|en d[ée]tail|branham/i.test(core), core);
    const d = decomposeComplexQuery(q, extractUnifiedQueryTerms);
    assert.equal(d.facets.length, 2, JSON.stringify(d.facets));
    assert.ok(d.facets[0].includes('septième sceau'));
    assert.ok(d.facets[1].includes('silence'));
    assert.equal(d.isComplex, true);
  });

  await test('question simple : aucune facette ; « le Père et le Fils » reste un seul volet', () => {
    const d = decomposeComplexQuery('Qui est le septième ange ?', extractUnifiedQueryTerms);
    assert.equal(d.facets.length, 0);
    assert.equal(d.isComplex, false);
    assert.equal(decomposeComplexQuery('Le Père et le Fils', extractUnifiedQueryTerms).facets.length, 0);
  });

  await test('fusion RRF des listes vectorielles : un passage présent dans plusieurs volets remonte', () => {
    const mk = (id: string, score: number) => ({ chunk: { chunkId: id }, score });
    const fused = fuseRankedLists([[mk('a', 0.9), mk('b', 0.8)], [mk('b', 0.85), mk('c', 0.7)]], 10);
    assert.equal(fused[0].chunk.chunkId, 'b');
    assert.equal(fused[0].score, 0.85);
    assert.deepEqual(fused.map(f => f.rank), [1, 2, 3]);
  });

  console.log(`\n${passed} test(s) réussi(s).`);
}

main().catch(err => {
  console.error('✗ Échec :', err);
  process.exit(1);
});
