import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const questions = JSON.parse(fs.readFileSync(path.join(rootDir, 'eval', 'questions.json'), 'utf8'));
const sampleSermons = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
const precalcData = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'precalculated_index.json'), 'utf8'));

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

const THEOLOGICAL_SYNONYMS = {
  'finances': ['argent', 'dime', 'richesses', 'materiel'],
  'argent': ['finances', 'dime', 'biens'],
  'mariage': ['couple', 'foyer', 'femme', 'epoux', 'epouse'],
  'couple': ['mariage', 'foyer', 'famille'],
  'saint-esprit': ['jeton', 'token', 'sceau', 'bapteme'],
  'jeton': ['token', 'saint-esprit', 'sceau', 'sang'],
  'divinite': ['elohim', 'logos', 'unite', 'jesus'],
  'elohim': ['divinite', 'logos', 'theophanie'],
  'sceaux': ['sept sceaux', 'ouverture', 'agneau', 'redemption'],
  'pyramide': ['pierre de faite', 'capstone', 'stature'],
  'troisieme pull': ['petite chambre', 'parole parlee', 'creation'],
  'guerison': ['foi', 'discernement', 'vision', 'crois'],
  'enlevement': ['depart', 'epouse', 'resurrection', 'cri']
};

function expandTerms(terms) {
  const expanded = [];
  for (const t of terms) {
    if (THEOLOGICAL_SYNONYMS[t]) {
      for (const syn of THEOLOGICAL_SYNONYMS[t]) {
        for (const w of tokenizeText(syn)) {
          if (!terms.includes(w) && !expanded.includes(w)) expanded.push(w);
        }
      }
    }
  }
  return expanded;
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

// 1. Scoring BM25 Okapi COMPLET (identique à run_ir_benchmark_complet.mjs)
function scoreBM25Complete(chunk, coreTerms, expandedTerms, model, k1 = 1.5, b = 0.75) {
  const tokens = tokenizeText(chunk.text);
  const docLen = Math.max(1, tokens.length);
  const lenNorm = 1 - b + b * (docLen / model.avgDocLength);

  const tfMap = new Map();
  for (const t of tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);

  const stemTfMap = new Map();
  for (const [t, count] of tfMap.entries()) {
    const stem = extractFrenchStem(t);
    stemTfMap.set(stem, (stemTfMap.get(stem) || 0) + count);
  }

  const getIdf = (term) => {
    const info = model.terms.get(term);
    if (info) return info.idf;
    const stem = extractFrenchStem(term);
    const stemInfo = model.terms.get(stem);
    if (stemInfo) return stemInfo.idf;
    return Math.max(0.5, Math.log(1 + model.totalDocs / 2));
  };

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
      const idf = getIdf(term);
      const tfSat = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
      bm25Core += idf * tfSat;
    }
  }

  let bm25Expanded = 0;
  let expandedMatched = 0;
  for (const term of expandedTerms) {
    let tf = tfMap.get(term) || 0;
    if (tf === 0) {
      const stem = extractFrenchStem(term);
      if (stem.length >= 3) tf = stemTfMap.get(stem) || 0;
    }
    if (tf > 0) {
      expandedMatched++;
      const idf = getIdf(term);
      const tfSat = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
      bm25Expanded += idf * tfSat;
    }
  }

  const normDoc = normalizeText(chunk.text);
  let phraseBonus = 0;
  for (let i = 0; i < coreTerms.length - 1; i++) {
    if (normDoc.includes(coreTerms[i] + ' ' + coreTerms[i + 1])) {
      phraseBonus += 10.0;
    }
  }

  let titleBonus = 0;
  if (chunk.sermonTitle) {
    const normTitle = normalizeText(chunk.sermonTitle);
    for (const term of coreTerms) {
      if (normTitle.includes(term)) titleBonus += 4.0;
    }
  }

  const total = bm25Core + (0.4 * bm25Expanded) + phraseBonus + Math.min(titleBonus, 10.0);
  return { score: total, coreMatched, expandedMatched };
}

// 2. Scoring BM25 Okapi PURE (sans bonus de phrase, ni bonus titre, ni expansion de synonymes)
function scoreBM25Pure(chunk, coreTerms, model, k1 = 1.5, b = 0.75) {
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
  return { rank, recall5, recall10, recall20, mrr };
}

// =========================================================================
// PARTIE 1 : BENCHMARK SUR LES 20 PARAPHRASES SEULES (Q089-Q108)
// =========================================================================
console.log(`================================================================================`);
console.log(`PARTIE 1 : ÉVALUATION SUR LES 20 PARAPHRASES STRICTES SEULES (Q089 - Q108)`);
console.log(`================================================================================`);

const paraphrases = questions.filter(q => {
  const n = parseInt(q.id.replace('Q', ''), 10);
  return n >= 89 && n <= 108;
});

const pConfigs = [
  { name: 'BM25-only (Okapi)', type: 'bm25' },
  { name: 'Vector-only', type: 'vector' },
  { name: 'RRF (1 / 1.0)', type: 'rrf', wLex: 1.0, wVec: 1.0, k: 60 },
  { name: 'RRF (1 / 0.1)', type: 'rrf', wLex: 1.0, wVec: 0.1, k: 60 }
];

const pResults = {};
for (const cfg of pConfigs) pResults[cfg.name] = [];

for (const q of paraphrases) {
  const queryTerms = extractQueryTerms(q.question);
  const expanded = expandTerms(queryTerms);
  const expectedSources = q.expected_sources || [{ sermonId: q.expected_sermons[0], paragraphIndex: q.expected_paragraphs[0] }];
  const isRelevantChunk = (c) => {
    return expectedSources.some(exp => {
      const sMatch = c.sermonId === exp.sermonId || c.sermonId.startsWith(exp.sermonId) || exp.sermonId.startsWith(c.sermonId);
      const pMatch = Array.isArray(c.paragraphIds) && c.paragraphIds.includes(exp.paragraphIndex);
      return sMatch && pMatch;
    });
  };

  // BM25
  const bm25Scored = [];
  for (const c of corpusChunks) {
    const res = scoreBM25Complete(c, queryTerms, expanded, bm25Model);
    if (res.score > 0) bm25Scored.push({ chunk: c, score: res.score });
  }
  bm25Scored.sort((a, b) => b.score - a.score);
  const bm25Hits = bm25Scored.slice(0, 40).map((h, i) => ({ chunk: h.chunk, rank: i + 1, score: h.score }));

  // Vector
  const vectorScored = [];
  for (const c of corpusChunks) {
    const cos = computeDeterministicVectorCosine(queryTerms, c.text);
    if (cos > 0.05) vectorScored.push({ chunk: c, score: cos });
  }
  vectorScored.sort((a, b) => b.score - a.score);
  const vectorHits = vectorScored.slice(0, 40).map((h, i) => ({ chunk: h.chunk, rank: i + 1, score: h.score }));

  const candidateIds = new Set([...bm25Hits.map(h => h.chunk.chunkId), ...vectorHits.map(h => h.chunk.chunkId)]);
  const bm25RankMap = new Map(bm25Hits.map(h => [h.chunk.chunkId, h.rank]));
  const vecRankMap = new Map(vectorHits.map(h => [h.chunk.chunkId, h.rank]));
  const chunkMap = new Map(corpusChunks.map(c => [c.chunkId, c]));

  for (const cfg of pConfigs) {
    let hits = [];
    if (cfg.type === 'bm25') {
      hits = bm25Hits;
    } else if (cfg.type === 'vector') {
      hits = vectorHits;
    } else if (cfg.type === 'rrf') {
      const rrfList = [];
      for (const id of candidateIds) {
        const c = chunkMap.get(id);
        if (!c) continue;
        const lRank = bm25RankMap.get(id) || null;
        const vRank = vecRankMap.get(id) || null;
        let score = 0;
        if (lRank !== null) score += cfg.wLex / (cfg.k + lRank);
        if (vRank !== null) score += cfg.wVec / (cfg.k + vRank);
        rrfList.push({ chunk: c, score });
      }
      rrfList.sort((a, b) => b.score - a.score);
      hits = rrfList.slice(0, 20);
    }
    pResults[cfg.name].push(computeMetricsForHits(hits, isRelevantChunk));
  }
}

console.log(`Configuration     | Recall@5 (95% CI)   | Recall@10 (95% CI)  | Recall@20 (95% CI)  | MRR`);
console.log(`-----------------------------------------------------------------------------------------`);
for (const cfg of pConfigs) {
  const res = pResults[cfg.name];
  const n = res.length;
  let r5 = 0, r10 = 0, r20 = 0, sumMrr = 0;
  for (const r of res) {
    r5 += r.recall5;
    r10 += r.recall10;
    r20 += r.recall20;
    sumMrr += r.mrr;
  }
  const ci5 = wilsonConfidenceInterval(r5, n);
  const ci10 = wilsonConfidenceInterval(r10, n);
  const ci20 = wilsonConfidenceInterval(r20, n);
  const mrr = (sumMrr / n).toFixed(3);
  const padName = cfg.name.padEnd(17, ' ');
  const pad5 = `${ci5.p}% [${ci5.lower}-${ci5.upper}]`.padEnd(19, ' ');
  const pad10 = `${ci10.p}% [${ci10.lower}-${ci10.upper}]`.padEnd(20, ' ');
  const pad20 = `${ci20.p}% [${ci20.lower}-${ci20.upper}]`.padEnd(20, ' ');
  console.log(`${padName} | ${pad5} | ${pad10} | ${pad20} | ${mrr}`);
}

// =========================================================================
// PARTIE 2 : COMPARAISON BM25 COMPLET VS BM25 PURE SUR LES 80 QUESTIONS
// =========================================================================
console.log(`\n================================================================================`);
console.log(`PARTIE 2 : EXPLICATION DE LA CHUTE DE BM25 (92,5% -> 85,0%)`);
console.log(`================================================================================`);

const initialInDomain = questions.filter(q => {
  const n = parseInt(q.id.replace('Q', ''), 10);
  return (n >= 1 && n <= 72) || (n >= 81 && n <= 88);
});

let r10Complete = 0;
let r10Pure = 0;

for (const q of initialInDomain) {
  const queryTerms = extractQueryTerms(q.question);
  const expanded = expandTerms(queryTerms);
  const expectedSources = q.expected_sources || [{ sermonId: q.expected_sermons[0], paragraphIndex: q.expected_paragraphs[0] }];
  const isRelevant = (c) => {
    return expectedSources.some(exp => {
      const sMatch = c.sermonId === exp.sermonId || c.sermonId.startsWith(exp.sermonId) || exp.sermonId.startsWith(c.sermonId);
      const pMatch = Array.isArray(c.paragraphIds) && c.paragraphIds.includes(exp.paragraphIndex);
      return sMatch && pMatch;
    });
  };

  // 1. BM25 Complet (avec phraseBonus + titleBonus + synonymExpansion)
  const scoredComp = [];
  for (const c of corpusChunks) {
    const res = scoreBM25Complete(c, queryTerms, expanded, bm25Model);
    if (res.score > 0) scoredComp.push({ chunk: c, score: res.score });
  }
  scoredComp.sort((a, b) => b.score - a.score);
  const hitsComp = scoredComp.slice(0, 10);
  if (hitsComp.some(h => isRelevant(h.chunk))) r10Complete++;

  // 2. BM25 Pure (sans phraseBonus, sans titleBonus, sans synonymExpansion)
  const scoredPure = [];
  for (const c of corpusChunks) {
    const res = scoreBM25Pure(c, queryTerms, bm25Model);
    if (res.score > 0) scoredPure.push({ chunk: c, score: res.score });
  }
  scoredPure.sort((a, b) => b.score - a.score);
  const hitsPure = scoredPure.slice(0, 10);
  if (hitsPure.some(h => isRelevant(h.chunk))) r10Pure++;
}

console.log(`Sur les ${initialInDomain.length} questions in-domain initiales :`);
console.log(`- BM25 avec bonus de bi-grammes (+10), bonus de titre (+4) et synonymes (+0.4) : Recall@10 = ${r10Complete}/${initialInDomain.length} (${(r10Complete/initialInDomain.length*100).toFixed(1)}%)`);
console.log(`- BM25 Okapi pur (sans bonus phrasé, sans titre, sans synonymes)                : Recall@10 = ${r10Pure}/${initialInDomain.length} (${(r10Pure/initialInDomain.length*100).toFixed(1)}%)`);

// =========================================================================
// PARTIE 3 : 20 REQUÊTES PIÈGES VOISINES (ADVERSARIAL NEAR-MISSES)
// =========================================================================
console.log(`\n================================================================================`);
console.log(`PARTIE 3 : 20 REQUÊTES PIÈGES VOISINES (ABSTENTION & FAUX REFUS)`);
console.log(`================================================================================`);

const adversarialTraps = [
  // 10 requêtes de Calibration (Set A)
  { id: "TRAP01", question: "Dans quel sermon Branham affirme-t-il que le sixième sceau s'est ouvert en l'an 2000 à Jérusalem ?" },
  { id: "TRAP02", question: "Quelle prophétie Branham a-t-il donnée concernant l'atterrissage d'une soucoupe volante sur le mont Sinaï ?" },
  { id: "TRAP03", question: "Que dit Branham sur la quatrième pull manifestée dans une pyramide de Gizeh ?" },
  { id: "TRAP04", question: "Dans quel chapitre de l'Exposé est-il écrit que Martin Luther a rejeté l'immersion d'eau pour les croyants ?" },
  { id: "TRAP05", question: "Où Branham déclare-t-il que le cavalier sur le cheval roux utilisait un pistolet automatique ?" },
  { id: "TRAP06", question: "Quel passage décrit l'ange de l'Éternel apparaissant sous la forme d'un aigle doré à Chicago ?" },
  { id: "TRAP07", question: "Quelle révélation donne Branham sur la construction d'un temple en marbre blanc à Jeffersonville en 1980 ?" },
  { id: "TRAP08", question: "Dans quel sermon affirme-t-il que l'enlèvement aura lieu précisément un mardi à minuit ?" },
  { id: "TRAP09", question: "Comment Branham justifie-t-il l'utilisation du chapelet catholique pendant le service de communion ?" },
  { id: "TRAP10", question: "Quelle déclaration fait-il sur les deux témoins d'Apocalypse 11 ressuscitant devant des caméras de télévision ?" },

  // 10 requêtes de Validation (Set B)
  { id: "TRAP11", question: "Dans quel sermon Branham dit-il que la nuée surnaturelle contenait le visage de Napoléon Bonaparte ?" },
  { id: "TRAP12", question: "Que prêche Branham concernant le baptême au nom des archanges Michel et Gabriel ?" },
  { id: "TRAP13", question: "Dans quel paragraphe l'Épouse est-elle décrite comme portant un voile noir brodé de diamants ?" },
  { id: "TRAP14", question: "Quelle explication donne-t-il sur les sept tonnerres révélant les cours des actions boursières de New York ?" },
  { id: "TRAP15", question: "Où Branham affirme-t-il que l'apôtre Paul s'est rendu en Angleterre à bord d'un sous-marin ?" },
  { id: "TRAP16", question: "Quelle prophétie énonce-t-il sur la destruction de la ville de Los Angeles par un astéroïde radioactif ?" },
  { id: "TRAP17", question: "Dans quel sermon mentionne-t-il que l'onction du Saint-Esprit peut être mesurée avec un thermomètre ?" },
  { id: "TRAP18", question: "Que dit Branham sur le prophète Élie conduisant un char électrique à travers le désert ?" },
  { id: "TRAP19", question: "Quel passage de l'Exposé affirme que l'âge de Laodicée durera exactement trois cents ans ?" },
  { id: "TRAP20", question: "Dans quelle prédication Branham ordonne-t-il de ne plus jamais lire l'Ancien Testament ?" }
];

function evaluateTrap(q) {
  const queryTerms = extractQueryTerms(q.question);
  const bm25Scored = [];
  for (const c of corpusChunks) {
    const res = scoreBM25Complete(c, queryTerms, [], bm25Model);
    if (res.score > 0) bm25Scored.push({ chunk: c, score: res.score });
  }
  bm25Scored.sort((a, b) => b.score - a.score);
  const topCandidate = bm25Scored[0] || null;
  const topScore = topCandidate ? topCandidate.score : 0;
  const topText = topCandidate ? normalizeText(topCandidate.chunk.text) : '';

  let matchedSignificant = 0;
  let ignoredSignificant = 0;
  for (const t of queryTerms) {
    const norm = normalizeText(t);
    const inVocab = bm25Model.terms.has(norm) || bm25Model.terms.has(extractFrenchStem(norm));
    const inTop = topText.includes(norm) || topText.includes(extractFrenchStem(norm));
    if (inVocab) {
      if (inTop) matchedSignificant++;
    } else {
      ignoredSignificant++;
    }
  }
  const total = queryTerms.length;
  const coverage = total > 0 ? (matchedSignificant / total) : 0;
  return { q, queryTerms, topScore, matchedSignificant, ignoredSignificant, coverage, topCandidate };
}

// Calibration sur Set A (10 pièges)
const trapSetA = adversarialTraps.slice(0, 10).map(evaluateTrap);
const trapSetB = adversarialTraps.slice(10, 20).map(evaluateTrap);

// Règle d'abstention calibrée avancée :
// Pour bloquer un piège voisin (qui contient des mots du vocabulaire), il faut examiner :
// 1) Présence de mots hors vocabulaire (ignoredSignificant >= 1)
// 2) Taux de couverture documentaire des termes significatifs dans le meilleur passage (coverage)
// 3) Score brut BM25 normalisé ou bi-gramme match
function isAccepted(evaluated, minCoverage = 0.50) {
  // Règle 1 : Présence d'un terme inconnu + couverture partielle < 65%
  if (evaluated.ignoredSignificant >= 1 && evaluated.coverage < 0.65) {
    return false; // Refusé
  }
  // Règle 2 : Couverture documentaire insuffisante (< 50% des termes réunis dans un même paragraphe)
  if (evaluated.coverage < minCoverage) {
    return false; // Refusé
  }
  // Règle 3 : Si score BM25 trop bas
  if (evaluated.topScore < 4.0) {
    return false; // Refusé
  }
  return true; // Fausse acceptation si c'est un piège
}

console.log(`\n--- Set A (Calibration - 10 pièges voisins) ---`);
let acceptedSetA = 0;
for (const item of trapSetA) {
  const acc = isAccepted(item);
  if (acc) acceptedSetA++;
  console.log(`[${item.q.id}] Acc=${acc ? '❌ FAUX POSITIF' : '✅ REJETÉ'} | Couverture=${(item.coverage*100).toFixed(0)}% | Matched=${item.matchedSignificant}/${item.queryTerms.length} | Ignored=${item.ignoredSignificant} | TopScore=${item.topScore.toFixed(1)}`);
}
console.log(`Set A : ${10 - acceptedSetA}/10 pièges rejetés (FAR = ${(acceptedSetA/10*100).toFixed(0)}%)`);

console.log(`\n--- Set B (Validation hors échantillon - 10 pièges voisins) ---`);
let acceptedSetB = 0;
for (const item of trapSetB) {
  const acc = isAccepted(item);
  if (acc) acceptedSetB++;
  console.log(`[${item.q.id}] Acc=${acc ? '❌ FAUX POSITIF' : '✅ REJETÉ'} | Couverture=${(item.coverage*100).toFixed(0)}% | Matched=${item.matchedSignificant}/${item.queryTerms.length} | Ignored=${item.ignoredSignificant} | TopScore=${item.topScore.toFixed(1)}`);
}
console.log(`Set B : ${10 - acceptedSetB}/10 pièges rejetés (FAR = ${(acceptedSetB/10*100).toFixed(0)}%)`);

// Mesure de l'impact sur le taux de faux refus (FRR) des 80 questions in-domain
let falseRefusals = 0;
for (const q of initialInDomain) {
  const evalItem = evaluateTrap(q);
  const acc = isAccepted(evalItem);
  if (!acc) falseRefusals++;
}
console.log(`\n--- Impact sur les 80 questions in-domain légitimes ---`);
console.log(`Faux refus provoqués (FRR) : ${falseRefusals}/${initialInDomain.length} (${(falseRefusals/initialInDomain.length*100).toFixed(1)}%)`);
console.log(`IC 95% Wilson FRR : [${wilsonConfidenceInterval(falseRefusals, initialInDomain.length).lower}% - ${wilsonConfidenceInterval(falseRefusals, initialInDomain.length).upper}%]`);
