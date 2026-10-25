import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const questions = JSON.parse(fs.readFileSync(path.join(rootDir, 'eval', 'questions.json'), 'utf8'));
const sampleSermons = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
const precalcData = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'precalculated_index.json'), 'utf8'));

// Text normalization & tokenization
function normalizeText(text) {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokenizeText(text) {
  if (!text) return [];
  const separated = text.replace(/([ldqujcsnmtLDQUJCSNMT])['`’]([\p{L}\p{N}]+)/gu, '$1 $2');
  return normalizeText(separated)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

function extractFrenchStem(word) {
  if (!word || word.length <= 3) return word;
  const s = word.toLowerCase();
  const suffixes = [
    'issantes', 'issants', 'issante', 'issant', 'issaient',
    'ement', 'emment', 'amment', 'ations', 'ation',
    'atrices', 'atrice', 'ateurs', 'ateur',
    'euses', 'euse', 'eurs', 'eur',
    'erait', 'irait', 'aient', 'irent', 'arent', 'eriez', 'iriez',
    'entes', 'ente', 'ents', 'ent', 'antes', 'ante', 'ants', 'ant',
    'issez', 'issons', 'ait', 'iez', 'ions', 'ons', 'ont',
    'eras', 'erez', 'eront', 'iras', 'irez', 'iront',
    'ees', 'ee', 'es', 'er', 'ir', 'is', 'it', 'e', 's'
  ];
  for (const suf of suffixes) {
    if (s.endsWith(suf) && (s.length - suf.length) >= 3) {
      return s.slice(0, s.length - suf.length);
    }
  }
  return s;
}

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'en', 'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'sous',
  'et', 'ou', 'ni', 'car', 'mais', 'donc', 'or', 'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'font', 'faire', 'fais', 'il', 'elle', 'ils', 'elles', 'on', 'je', 'tu', 'se', 'sa', 'son', 'ses', 'leur', 'leurs',
  'au', 'aux', 'mon', 'ton', 'ma', 'ta', 'mes', 'tes', 'notre', 'votre', 'nos', 'vos',
  'quel', 'quelle', 'quels', 'quelles', 'comme', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors', 'si', 'ne', 'pas', 'point', 'non', 'oui',
  'pourquoi', 'comment', 'selon', 'quand', 'lorsque',
  'frere', 'fr', 'branham', 'william', 'prophete', 'sermon', 'sermons', 'predicateur', 'message'
]);

function extractQueryTerms(query) {
  const words = tokenizeText(query);
  const filtered = words.filter(w => !STOP_WORDS.has(w) && w.length >= 3);
  return Array.from(new Set(filtered.length > 0 ? filtered : words));
}

// Corpus
const corpusChunks = [];
for (const s of sampleSermons) {
  const paras = s.text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  paras.forEach((p, idx) => {
    const match = p.trim().match(/^(\d+)[\.\s]/);
    const pNum = match ? parseInt(match[1], 10) : idx + 1;
    corpusChunks.push({
      chunkId: `${s.id}_p${pNum}`,
      sermonId: s.id,
      paragraphIds: [pNum],
      startParagraph: pNum,
      endParagraph: pNum,
      text: p.trim(),
      sermonTitle: s.title
    });
  });
}
if (precalcData && precalcData.chunks) {
  for (const c of precalcData.chunks) {
    corpusChunks.push({
      chunkId: c.chunkId || `expose_${c.chapterNumber}_p${c.startParagraph}`,
      sermonId: `expose_ch${c.chapterNumber}`,
      paragraphIds: c.paragraphIds || [c.startParagraph],
      startParagraph: c.startParagraph,
      endParagraph: c.endParagraph,
      text: c.text,
      sermonTitle: c.chapterTitle
    });
  }
}

// BM25
const totalDocs = corpusChunks.length;
const dfMap = new Map();
let totalWords = 0;
for (const c of corpusChunks) {
  const tokens = tokenizeText(c.text);
  totalWords += tokens.length;
  const uniqueTokens = new Set(tokens);
  for (const t of uniqueTokens) {
    dfMap.set(t, (dfMap.get(t) || 0) + 1);
    const stem = extractFrenchStem(t);
    if (stem !== t) dfMap.set(stem, (dfMap.get(stem) || 0) + 1);
  }
}
const bm25Terms = new Map();
for (const [term, df] of dfMap.entries()) {
  const idf = Math.max(0, Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5)));
  bm25Terms.set(term, { df, idf });
}
const bm25Model = {
  totalDocs,
  terms: bm25Terms,
  avgDocLength: totalWords / totalDocs
};

function scoreBM25(chunk, coreTerms, model, k1 = 1.5, b = 0.75) {
  const tokens = tokenizeText(chunk.text);
  const docLen = Math.max(1, tokens.length);
  const lenNorm = 1 - b + b * (docLen / model.avgDocLength);
  const tfMap = new Map();
  for (const t of tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);
  const stemTfMap = new Map();
  for (const [t, cnt] of tfMap.entries()) {
    const stem = extractFrenchStem(t);
    stemTfMap.set(stem, (stemTfMap.get(stem) || 0) + cnt);
  }
  let bm25Core = 0;
  let coreMatched = 0;
  for (const term of coreTerms) {
    let tf = tfMap.get(term) || 0;
    if (tf === 0) {
      const stem = extractFrenchStem(term);
      if (stem.length >= 3) tf = stemTfMap.get(stem) || 0;
    }
    if (tf > 0) {
      coreMatched++;
      const info = model.terms.get(term) || model.terms.get(extractFrenchStem(term));
      const idf = info ? info.idf : Math.max(0.5, Math.log(1 + model.totalDocs / 2));
      const tfSat = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
      bm25Core += idf * tfSat;
    }
  }
  return { score: bm25Core, coreMatched };
}

function computeDeterministicVectorCosine(queryTerms, chunkText) {
  const qTokens = new Set(queryTerms);
  const dTokens = tokenizeText(chunkText);
  let intersection = 0;
  for (const t of dTokens) if (qTokens.has(t)) intersection++;
  const normQ = Math.sqrt(qTokens.size);
  const normD = Math.sqrt(new Set(dTokens).size);
  if (normQ === 0 || normD === 0) return 0;
  return Math.min(1.0, intersection / (normQ * normD));
}

// Wilson 95% Confidence Interval
function wilsonConfidenceInterval(successes, total, confidence = 0.95) {
  if (total === 0) return { lower: 0, upper: 0, p: 0 };
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  const lower = Math.max(0, (center - spread) / denominator);
  const upper = Math.min(1.0, (center + spread) / denominator);
  return {
    p: Math.round(p * 1000) / 10,
    lower: Math.round(lower * 1000) / 10,
    upper: Math.round(upper * 1000) / 10
  };
}

function computeMetricsForHits(hitList, isRelevantChunk) {
  let rank = null;
  for (let i = 0; i < hitList.length; i++) {
    if (isRelevantChunk(hitList[i].chunk)) {
      rank = i + 1;
      break;
    }
  }
  const recall5 = rank !== null && rank <= 5 ? 1 : 0;
  const recall10 = rank !== null && rank <= 10 ? 1 : 0;
  const recall20 = rank !== null && rank <= 20 ? 1 : 0;
  const mrr = rank !== null ? (1.0 / rank) : 0;

  let dcg = 0;
  for (let i = 0; i < Math.min(10, hitList.length); i++) {
    const rel = isRelevantChunk(hitList[i].chunk) ? 1 : 0;
    if (rel > 0) dcg += rel / Math.log2(i + 2);
  }
  const idcg = 1.0 / Math.log2(2);
  const ndcg10 = idcg > 0 ? (dcg / idcg) : 0;

  return { rank, recall5, recall10, recall20, mrr, ndcg10 };
}

const inDomainQuestions = questions.filter(q => q.answerable !== false);
const outDomainQuestions = questions.filter(q => q.answerable === false);

console.log(`Corpus: ${corpusChunks.length} chunks. In-domain questions: ${inDomainQuestions.length}. Out-domain questions: ${outDomainQuestions.length}.`);

// =========================================================================
// PARTIE 2 : TEST RRF AVEC DIFFÉRENTS POIDS ET SECOND ÉTAGE
// Configurations demandées :
// - BM25 seul
// - Vectoriel seul
// - RRF 1 / 1 (wLex=1.0, wVec=1.0)
// - RRF 1 / 0.5 (wLex=1.0, wVec=0.5)
// - RRF 1 / 0.3 (wLex=1.0, wVec=0.3)
// - RRF 1 / 0.1 (wLex=1.0, wVec=0.1)
// - Vectoriel en 2nd étage (BM25 top-40, reranked par score vectoriel)
// =========================================================================

const configs = [
  { name: 'BM25-only', type: 'bm25' },
  { name: 'Vector-only', type: 'vector' },
  { name: 'RRF 1 / 1.0', type: 'rrf', wLex: 1.0, wVec: 1.0, k: 60 },
  { name: 'RRF 1 / 0.5', type: 'rrf', wLex: 1.0, wVec: 0.5, k: 60 },
  { name: 'RRF 1 / 0.3', type: 'rrf', wLex: 1.0, wVec: 0.3, k: 60 },
  { name: 'RRF 1 / 0.1', type: 'rrf', wLex: 1.0, wVec: 0.1, k: 60 },
  { name: 'Vectoriel en 2nd étage (BM25 top 40 -> Vector)', type: 'two-stage' }
];

const configResults = {};
for (const cfg of configs) configResults[cfg.name] = [];

// Latency breakdown trackers
const latencyBreakdown = {
  bm25: [],
  vector: [],
  rrf: [],
  total: []
};

for (const q of inDomainQuestions) {
  const queryTerms = extractQueryTerms(q.question);
  const expectedSources = q.expected_sources || (q.expected_sermons || []).map((sId, i) => ({
    sermonId: sId,
    paragraphIndex: (q.expected_paragraphs || [])[i] || 1
  }));
  const isRelevantChunk = (c) => {
    return expectedSources.some(exp => {
      const sermonMatch = c.sermonId === exp.sermonId || c.sermonId.startsWith(exp.sermonId) || exp.sermonId.startsWith(c.sermonId);
      const paraMatch = Array.isArray(c.paragraphIds) && c.paragraphIds.includes(exp.paragraphIndex);
      return sermonMatch && paraMatch;
    });
  };

  // 1. BM25 scoring
  const t0 = performance.now();
  const bm25Scored = [];
  for (const c of corpusChunks) {
    const res = scoreBM25(c, queryTerms, bm25Model);
    if (res.score > 0) bm25Scored.push({ chunk: c, score: res.score });
  }
  bm25Scored.sort((a, b) => b.score - a.score);
  const bm25Hits = bm25Scored.slice(0, 40).map((item, idx) => ({ chunk: item.chunk, rank: idx + 1, score: item.score }));
  const tBM25 = performance.now() - t0;
  latencyBreakdown.bm25.push(tBM25);

  // 2. Vector scoring
  const t1 = performance.now();
  const vectorScored = [];
  for (const c of corpusChunks) {
    const cos = computeDeterministicVectorCosine(queryTerms, c.text);
    if (cos > 0.05) vectorScored.push({ chunk: c, score: cos });
  }
  vectorScored.sort((a, b) => b.score - a.score);
  const vectorHits = vectorScored.slice(0, 40).map((item, idx) => ({ chunk: item.chunk, rank: idx + 1, score: item.score }));
  const tVector = performance.now() - t1;
  latencyBreakdown.vector.push(tVector);

  const candidateIds = new Set([...bm25Hits.map(h => h.chunk.chunkId), ...vectorHits.map(h => h.chunk.chunkId)]);
  const bm25RankMap = new Map(bm25Hits.map(h => [h.chunk.chunkId, h.rank]));
  const vecRankMap = new Map(vectorHits.map(h => [h.chunk.chunkId, h.rank]));
  const chunkMap = new Map(corpusChunks.map(c => [c.chunkId, c]));

  for (const cfg of configs) {
    let hits = [];
    if (cfg.type === 'bm25') {
      hits = bm25Hits;
    } else if (cfg.type === 'vector') {
      hits = vectorHits;
    } else if (cfg.type === 'rrf') {
      const tFusionStart = performance.now();
      const rrfList = [];
      for (const id of candidateIds) {
        const c = chunkMap.get(id);
        if (!c) continue;
        const lRank = bm25RankMap.get(id) || null;
        const vRank = vecRankMap.get(id) || null;
        let score = 0;
        if (lRank !== null && lRank > 0) score += cfg.wLex / (cfg.k + lRank);
        if (vRank !== null && vRank > 0) score += cfg.wVec / (cfg.k + vRank);
        rrfList.push({ chunk: c, score });
      }
      rrfList.sort((a, b) => b.score - a.score);
      hits = rrfList.slice(0, 20);
      if (cfg.name === 'RRF 1 / 1.0') {
        latencyBreakdown.rrf.push(performance.now() - tFusionStart);
        latencyBreakdown.total.push(tBM25 + tVector + (performance.now() - tFusionStart));
      }
    } else if (cfg.type === 'two-stage') {
      // First stage: BM25 top 40. Second stage: re-ranked by Vector cosine score
      const stage2 = [];
      for (const h of bm25Hits) {
        const cos = computeDeterministicVectorCosine(queryTerms, h.chunk.text);
        stage2.push({ chunk: h.chunk, score: cos, bm25Rank: h.rank });
      }
      stage2.sort((a, b) => b.score - a.score);
      hits = stage2.slice(0, 20);
    }

    const m = computeMetricsForHits(hits, isRelevantChunk);
    configResults[cfg.name].push(m);
  }
}

console.log(`\n========================================================================================================`);
console.log(`📊 TABLEAU COMPARATIF DES STRATÉGIES DE FUSION (N = ${inDomainQuestions.length} requêtes in-domain)`);
console.log(`========================================================================================================`);
console.log(`Configuration                     | Recall@5 (95% CI)   | Recall@10 (95% CI)  | Recall@20 (95% CI)  | MRR   | NDCG@10`);
console.log(`--------------------------------------------------------------------------------------------------------`);

for (const cfg of configs) {
  const resList = configResults[cfg.name];
  const n = resList.length;
  let r5 = 0, r10 = 0, r20 = 0, sumMrr = 0, sumNdcg = 0;
  for (const r of resList) {
    r5 += r.recall5;
    r10 += r.recall10;
    r20 += r.recall20;
    sumMrr += r.mrr;
    sumNdcg += r.ndcg10;
  }
  const ci5 = wilsonConfidenceInterval(r5, n);
  const ci10 = wilsonConfidenceInterval(r10, n);
  const ci20 = wilsonConfidenceInterval(r20, n);
  const mrr = (sumMrr / n).toFixed(3);
  const ndcg = (sumNdcg / n).toFixed(3);

  const padName = cfg.name.padEnd(33, ' ');
  const pad5 = `${ci5.p}% [${ci5.lower}-${ci5.upper}]`.padEnd(19, ' ');
  const pad10 = `${ci10.p}% [${ci10.lower}-${ci10.upper}]`.padEnd(20, ' ');
  const pad20 = `${ci20.p}% [${ci20.lower}-${ci20.upper}]`.padEnd(20, ' ');
  console.log(`${padName} | ${pad5} | ${pad10} | ${pad20} | ${mrr} | ${ndcg}`);
}
console.log(`========================================================================================================\n`);

// =========================================================================
// PARTIE 3 : ANALYSE DES 4 FAUSSES ACCEPTATIONS SUR 8 ET CALIBRATION SEUIL
// =========================================================================
console.log(`\n========================================================================================================`);
console.log(`🛡️  ANALYSE DES 8 QUESTIONS HORS-CORPUS (FAR) & RECHERCHE DES 4 FAUSSES ACCEPTATIONS`);
console.log(`========================================================================================================`);

function evaluateOODQuery(q) {
  const queryTerms = extractQueryTerms(q.question);
  const bm25Scored = [];
  for (const c of corpusChunks) {
    const res = scoreBM25(c, queryTerms, bm25Model);
    if (res.score > 0) bm25Scored.push({ chunk: c, score: res.score });
  }
  bm25Scored.sort((a, b) => b.score - a.score);
  const bm25Hits = bm25Scored.slice(0, 40).map((item, idx) => ({ chunk: item.chunk, rank: idx + 1, score: item.score }));

  const vectorScored = [];
  for (const c of corpusChunks) {
    const cos = computeDeterministicVectorCosine(queryTerms, c.text);
    if (cos > 0.05) vectorScored.push({ chunk: c, score: cos });
  }
  vectorScored.sort((a, b) => b.score - a.score);
  const vectorHits = vectorScored.slice(0, 40).map((item, idx) => ({ chunk: item.chunk, rank: idx + 1, score: item.score }));

  const candidateIds = new Set([...bm25Hits.map(h => h.chunk.chunkId), ...vectorHits.map(h => h.chunk.chunkId)]);
  const bm25RankMap = new Map(bm25Hits.map(h => [h.chunk.chunkId, h.rank]));
  const vecRankMap = new Map(vectorHits.map(h => [h.chunk.chunkId, h.rank]));
  const chunkMap = new Map(corpusChunks.map(c => [c.chunkId, c]));

  const rrfList = [];
  const maxPossibleRrf = (1 / 61) + (1 / 61);
  for (const id of candidateIds) {
    const c = chunkMap.get(id);
    if (!c) continue;
    const lRank = bm25RankMap.get(id) || null;
    const vRank = vecRankMap.get(id) || null;
    let rrfScore = 0;
    if (lRank !== null) rrfScore += 1.3 / (60 + lRank);
    if (vRank !== null) rrfScore += 0.7 / (60 + vRank);
    const rrfNorm = Math.min(1.0, rrfScore / maxPossibleRrf);
    const bm25ScoreRaw = bm25Hits.find(h => h.chunk.chunkId === id)?.score || 0;
    const lexScore = Math.min(1.0, bm25ScoreRaw / 50.0);
    const vecScore = vRank !== null ? (1.0 - (vRank / 40)) : 0;
    const isMultiModal = lRank !== null && vRank !== null;
    const mmBonus = isMultiModal ? 0.15 : 0;
    let matchedTerms = 0;
    const normText = normalizeText(c.text);
    for (const t of queryTerms) if (normText.includes(t)) matchedTerms++;
    const coverage = queryTerms.length > 0 ? (matchedTerms / queryTerms.length) : 0;
    const rerankScore = (0.35 * rrfNorm) + (0.35 * lexScore) + (0.15 * vecScore) + (0.15 * coverage) + mmBonus;
    rrfList.push({ chunk: c, score: rerankScore, coverage, bm25ScoreRaw, vecScore });
  }
  rrfList.sort((a, b) => b.score - a.score);

  const topCandidate = rrfList[0] || null;
  const topScore = topCandidate ? topCandidate.score : 0;
  const topText = topCandidate ? normalizeText(topCandidate.chunk.text) : '';

  let matchedSignificant = 0;
  let ignoredSignificant = 0;
  const termDetails = [];
  for (const t of queryTerms) {
    const norm = normalizeText(t);
    const inVocab = bm25Model.terms.has(norm) || bm25Model.terms.has(extractFrenchStem(norm));
    const inTopText = topText.includes(norm) || topText.includes(extractFrenchStem(norm));
    if (inVocab) {
      if (inTopText) matchedSignificant++;
    } else {
      ignoredSignificant++;
    }
    termDetails.push({ t, inVocab, inTopText });
  }

  // Exact benchmark rules:
  // Rule 1a: ignoredSignificant >= 1 && matchedSignificant === 0 -> refuse
  // Rule 1b: ignoredSignificant >= 2 && ignoredSignificant > matchedSignificant -> refuse
  // Rule 2: matchedSignificant === 0 && topScore < 0.20 -> refuse
  let engineAnswerable = true;
  let ruleApplied = 'AUCUNE (Accepté par défaut)';
  if (ignoredSignificant >= 1 && matchedSignificant === 0) {
    engineAnswerable = false;
    ruleApplied = 'Règle 1a : (ignoredSignificant >= 1 && matchedSignificant === 0)';
  } else if (ignoredSignificant >= 2 && ignoredSignificant > matchedSignificant) {
    engineAnswerable = false;
    ruleApplied = 'Règle 1b : (ignoredSignificant >= 2 && ignoredSignificant > matchedSignificant)';
  } else if (matchedSignificant === 0 && topScore < 0.20) {
    engineAnswerable = false;
    ruleApplied = 'Règle 2 : (matchedSignificant === 0 && topScore < 0.20)';
  }

  return {
    q,
    queryTerms,
    topScore,
    matchedSignificant,
    ignoredSignificant,
    topText: topText.slice(0, 100) + '...',
    engineAnswerable,
    ruleApplied,
    termDetails
  };
}

const oodDetails = outDomainQuestions.map(evaluateOODQuery);
for (const item of oodDetails) {
  console.log(`\nQuestion [${item.q.id}]: "${item.q.question}"`);
  console.log(`  Statut : ${item.engineAnswerable ? '❌ FAUSSE ACCEPTATION (FAR)' : '✅ CORRECTEMENT REFUSÉE'}`);
  console.log(`  Top Score Reranker : ${item.topScore.toFixed(3)} | MatchedSig: ${item.matchedSignificant} | IgnoredSig: ${item.ignoredSignificant}`);
  console.log(`  Règle déclenchée : ${item.ruleApplied}`);
  console.log(`  Détail des termes :`);
  for (const td of item.termDetails) {
    console.log(`    - "${td.t}": inVocab=${td.inVocab}, inTopDoc=${td.inTopText}`);
  }
}

// Split into Set A (calibration, first half: 4 queries) and Set B (verification, second half: 4 queries)
const setA = oodDetails.slice(0, 4); // Q073, Q074, Q075, Q076
const setB = oodDetails.slice(4, 8); // Q077, Q078, Q079, Q080

console.log(`\n--------------------------------------------------------------------------------------------------------`);
console.log(`🎯 CALIBRATION D'UN NOUVEAU SEUIL SUR LE SET A (4 requêtes)`);
console.log(`--------------------------------------------------------------------------------------------------------`);
console.log(`Set A: ${setA.map(x => x.q.id).join(', ')}`);
setA.forEach(x => {
  console.log(`  [${x.q.id}] topScore=${x.topScore.toFixed(3)}, matchedSig=${x.matchedSignificant}, ignoredSig=${x.ignoredSignificant}, currentAccepted=${x.engineAnswerable}`);
});

// Calibrer une règle combinée ou seuil sur Set A:
// Observer:
// Dans Set A:
// Q073 (Tour Eiffel Paris) a ignoredSignificant=1 ('eiffel') et matchedSignificant=2 ('dit', 'paris'). Ratio non-vocabulaire = 1 / 5 = 20%, mais 'eiffel' est le sujet central !
// Q076 (cavalier noir épée laser) a ignoredSignificant=1 ('maniait') et 'laser' inVocab=true (car présent dans expose ou sample) mais inTopText=false.
// Si règle : un mot inconnu du vocabulaire (ignoredSignificant >= 1) OU ratio couverture des termes dans topDoc < 50% OU topScore composite.
// Testons un seuil de ratio de termes inconnus et un ratio de couverture documentaire :
// Règle calibrée :
// 1) Si ignoredSignificant >= 1 : si ignoredSignificant >= 1 et ratio de couverture (matchedSignificant / totalTerms) < 0.60 -> Refus
// 2) Si coverage < 0.50 -> Refus
function testCalibratedRule(item, minCoverage = 0.55, maxIgnoredRatio = 0.15) {
  const total = item.queryTerms.length;
  const coverageRatio = total > 0 ? (item.matchedSignificant / total) : 0;
  const ignoredRatio = total > 0 ? (item.ignoredSignificant / total) : 0;

  // Si au moins un mot clé n'est pas dans le vocabulaire et couverture < 0.60
  if (item.ignoredSignificant >= 1 && coverageRatio < 0.60) {
    return { answerable: false, rule: 'Calibrée 1: ignoredSig >= 1 && coverage < 60%' };
  }
  // Si le ratio de termes inconnus > 15%
  if (ignoredRatio > maxIgnoredRatio) {
    return { answerable: false, rule: 'Calibrée 2: ignoredRatio > 15%' };
  }
  // Si la couverture des termes est inférieure à 55%
  if (coverageRatio < minCoverage) {
    return { answerable: false, rule: `Calibrée 3: coverageRatio < ${minCoverage * 100}%` };
  }
  return { answerable: true, rule: 'Accepté' };
}

console.log(`\nTest de la règle calibrée sur le Set A (Calibration) :`);
for (const item of setA) {
  const res = testCalibratedRule(item);
  console.log(`  [${item.q.id}] ${res.answerable ? '❌ ACCEPTÉ' : '✅ REFUSÉ'} (${res.rule}) - Couverture: ${(item.matchedSignificant / item.queryTerms.length * 100).toFixed(0)}%, IgnoredRatio: ${(item.ignoredSignificant / item.queryTerms.length * 100).toFixed(0)}%`);
}

console.log(`\nVérification de la règle calibrée sur le Set B (Validation hors échantillon) :`);
for (const item of setB) {
  const res = testCalibratedRule(item);
  console.log(`  [${item.q.id}] ${res.answerable ? '❌ ACCEPTÉ' : '✅ REFUSÉ'} (${res.rule}) - Couverture: ${(item.matchedSignificant / item.queryTerms.length * 100).toFixed(0)}%, IgnoredRatio: ${(item.ignoredSignificant / item.queryTerms.length * 100).toFixed(0)}%`);
}

// Vérifier non-régression sur in-domain questions (FRR)
let falseRefusalsCount = 0;
for (const q of inDomainQuestions) {
  const queryTerms = extractQueryTerms(q.question);
  // simulate same
  const bm25Scored = [];
  for (const c of corpusChunks) {
    const res = scoreBM25(c, queryTerms, bm25Model);
    if (res.score > 0) bm25Scored.push({ chunk: c, score: res.score });
  }
  bm25Scored.sort((a, b) => b.score - a.score);
  const topText = bm25Scored[0] ? normalizeText(bm25Scored[0].chunk.text) : '';
  let matchedSig = 0, ignoredSig = 0;
  for (const t of queryTerms) {
    const norm = normalizeText(t);
    const inVocab = bm25Model.terms.has(norm) || bm25Model.terms.has(extractFrenchStem(norm));
    const inTopText = topText.includes(norm) || topText.includes(extractFrenchStem(norm));
    if (inVocab) { if (inTopText) matchedSig++; } else { ignoredSig++; }
  }
  const dummyItem = { queryTerms, matchedSignificant: matchedSig, ignoredSignificant: ignoredSig };
  const res = testCalibratedRule(dummyItem);
  if (!res.answerable) falseRefusalsCount++;
}
console.log(`Non-régression sur In-Domain : Faux refus (FRR) = ${falseRefusalsCount} / ${inDomainQuestions.length} (${(falseRefusalsCount/inDomainQuestions.length*100).toFixed(1)}%)`);

// =========================================================================
// PARTIE 4 : DÉCOMPOSITION DE LA LATENCE
// =========================================================================
console.log(`\n========================================================================================================`);
console.log(`⚡ DÉCOMPOSITION RÉELLE DE LA LATENCE (Mesures sur ${inDomainQuestions.length} requêtes)`);
console.log(`========================================================================================================`);

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function p(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((q / 100) * s.length)];
}

console.log(`Étape                           | Moyenne (ms) | P50 (ms)   | P95 (ms)   | % du Temps Total`);
console.log(`------------------------------------------------------------------------------------------------`);
const avgBm25 = mean(latencyBreakdown.bm25);
const avgVec = mean(latencyBreakdown.vector);
const avgRrf = mean(latencyBreakdown.rrf);
const avgTot = mean(latencyBreakdown.total);

console.log(`1. Tokenisation & Scoring BM25  | ${avgBm25.toFixed(2).padEnd(12, ' ')} | ${p(latencyBreakdown.bm25, 50).toFixed(2).padEnd(10, ' ')} | ${p(latencyBreakdown.bm25, 95).toFixed(2).padEnd(10, ' ')} | ${(avgBm25 / avgTot * 100).toFixed(1)}%`);
console.log(`2. Scoring Vectoriel (Cosine)   | ${avgVec.toFixed(2).padEnd(12, ' ')} | ${p(latencyBreakdown.vector, 50).toFixed(2).padEnd(10, ' ')} | ${p(latencyBreakdown.vector, 95).toFixed(2).padEnd(10, ' ')} | ${(avgVec / avgTot * 100).toFixed(1)}%`);
console.log(`3. Fusion RRF & Rerank          | ${avgRrf.toFixed(2).padEnd(12, ' ')} | ${p(latencyBreakdown.rrf, 50).toFixed(2).padEnd(10, ' ')} | ${p(latencyBreakdown.rrf, 95).toFixed(2).padEnd(10, ' ')} | ${(avgRrf / avgTot * 100).toFixed(1)}%`);
console.log(`------------------------------------------------------------------------------------------------`);
console.log(`TOTAL PIPELINE                  | ${avgTot.toFixed(2).padEnd(12, ' ')} | ${p(latencyBreakdown.total, 50).toFixed(2).padEnd(10, ' ')} | ${p(latencyBreakdown.total, 95).toFixed(2).padEnd(10, ' ')} | 100.0%`);
