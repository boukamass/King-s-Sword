/**
 * King's Sword — Tests Unitaires et Cas Limites de Recherche Hybride & RRF (Phase 2D)
 * 
 * Valide l'algorithme RRF, la fusion de rangs, les cas limites et l'intégrité des structures.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 🧪 TESTS DU MOTEUR HYBRIDE ET DE LA FUSION RRF (PHASE 2D)");
console.log("=================================================\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exit(1);
  }
}

// 1. Fonctions pures RRF et Fusion (identiques à hybridRetrievalService.ts)
function computeRrfScore(lexicalRank, vectorRank, k = 60, lexicalWeight = 1.0, vectorWeight = 1.0) {
  if (k <= 0) k = 60;
  let rrf = 0;

  if (typeof lexicalRank === 'number' && lexicalRank > 0 && Number.isFinite(lexicalRank)) {
    rrf += lexicalWeight / (k + lexicalRank);
  }

  if (typeof vectorRank === 'number' && vectorRank > 0 && Number.isFinite(vectorRank)) {
    rrf += vectorWeight / (k + vectorRank);
  }

  return Math.round(rrf * 1000000) / 1000000;
}

function parseSermonParagraphs(text) {
  if (!text || typeof text !== 'string') return [];
  const rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return rawParagraphs.map((raw, idx) => {
    const trimmed = raw.trim();
    const leadingNumMatch = trimmed.match(/^(\d+)[\.\s]/);
    const num = leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : idx + 1;
    return {
      num,
      text: trimmed,
      charCount: trimmed.length,
      wordCount: trimmed.split(/\s+/).filter(Boolean).length
    };
  });
}

function createSermonChunks(sermon, options = {}) {
  const maxCharacters = options.maxCharacters || 900;
  const maxParagraphsPerChunk = options.maxParagraphsPerChunk || 3;
  const overlapParagraphs = options.overlapParagraphs !== undefined ? options.overlapParagraphs : 1;

  const paragraphs = parseSermonParagraphs(sermon.text);
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let pIdx = 0;
  let chunkCounter = 1;

  while (pIdx < paragraphs.length) {
    const currentGroup = [];
    let currentLength = 0;

    while (pIdx + currentGroup.length < paragraphs.length) {
      const candidate = paragraphs[pIdx + currentGroup.length];
      const addedLength = currentLength === 0 ? candidate.charCount : currentLength + 2 + candidate.charCount;

      if (currentGroup.length > 0) {
        if (addedLength > maxCharacters || currentGroup.length >= maxParagraphsPerChunk) {
          break;
        }
      }

      currentGroup.push(candidate);
      currentLength = addedLength;
    }

    if (currentGroup.length === 0) {
      currentGroup.push(paragraphs[pIdx]);
    }

    const paragraphIds = currentGroup.map(p => p.num);
    const startParagraph = paragraphIds[0];
    const endParagraph = paragraphIds[paragraphIds.length - 1];
    const chunkText = currentGroup.map(p => p.text).join('\n\n');

    chunks.push({
      chunkId: `${sermon.id}_c${chunkCounter}_p${startParagraph}_p${endParagraph}`,
      sermonId: sermon.id,
      paragraphIds,
      startParagraph,
      endParagraph,
      text: chunkText,
      sermonTitle: sermon.title,
      date: sermon.date,
      city: sermon.city,
      version: sermon.version,
      characterCount: chunkText.length,
      wordCount: chunkText.split(/\s+/).filter(Boolean).length
    });

    chunkCounter++;
    const groupSize = currentGroup.length;
    let step = groupSize;
    if (overlapParagraphs > 0 && groupSize > 1) {
      step = Math.max(1, groupSize - overlapParagraphs);
    }
    pIdx += step;
  }

  return chunks;
}

function mapParagraphsToChunkHits(retrievedParagraphs, allChunks) {
  if (!Array.isArray(retrievedParagraphs) || retrievedParagraphs.length === 0 || !Array.isArray(allChunks) || allChunks.length === 0) {
    return [];
  }

  const chunksBySermon = new Map();
  for (const chunk of allChunks) {
    const list = chunksBySermon.get(chunk.sermonId) || [];
    list.push(chunk);
    chunksBySermon.set(chunk.sermonId, list);
  }

  const chunkHitsMap = new Map();
  let orderCounter = 1;

  for (let pRank = 0; pRank < retrievedParagraphs.length; pRank++) {
    const p = retrievedParagraphs[pRank];
    const candidateChunks = chunksBySermon.get(p.sermonId) || [];

    for (const chunk of candidateChunks) {
      if (chunk.paragraphIds.includes(p.paragraphIndex)) {
        const existing = chunkHitsMap.get(chunk.chunkId);
        const score = typeof p.score === 'number' ? p.score : 0;

        if (!existing) {
          chunkHitsMap.set(chunk.chunkId, {
            chunkId: chunk.chunkId,
            firstSeenOrder: orderCounter++,
            highestScore: score,
            matchedParagraphIds: new Set([p.paragraphIndex])
          });
        } else {
          existing.matchedParagraphIds.add(p.paragraphIndex);
          if (score > existing.highestScore) {
            existing.highestScore = score;
          }
        }
      }
    }
  }

  const sortedHits = Array.from(chunkHitsMap.values()).sort(
    (a, b) => a.firstSeenOrder - b.firstSeenOrder
  );

  return sortedHits.map((hit, idx) => ({
    chunkId: hit.chunkId,
    rank: idx + 1,
    score: hit.highestScore,
    matchedParagraphIds: Array.from(hit.matchedParagraphIds)
  }));
}

function fuseRankings(params) {
  const { lexicalHits = [], vectorHits = [], allChunks = [], options = {} } = params;
  if (!Array.isArray(allChunks) || allChunks.length === 0) return [];

  const k = options.k || 60;
  const topK = Math.max(1, options.topK || 10);
  const minRrfScore = options.minRrfScore || 0;
  const sermonFilterSet = options.sermonIdFilter && options.sermonIdFilter.length > 0
    ? new Set(options.sermonIdFilter)
    : null;

  const chunksMap = new Map();
  for (const c of allChunks) {
    if (c && c.chunkId) chunksMap.set(c.chunkId, c);
  }

  const lexicalMap = new Map();
  for (const lh of lexicalHits) {
    if (lh && lh.chunkId && !lexicalMap.has(lh.chunkId)) {
      lexicalMap.set(lh.chunkId, lh);
    }
  }

  const vectorMap = new Map();
  for (const vh of vectorHits) {
    const cid = vh.chunk?.chunkId || vh.chunkId;
    if (cid && !vectorMap.has(cid)) {
      vectorMap.set(cid, vh);
    }
  }

  const allCandidateIds = new Set([
    ...Array.from(lexicalMap.keys()),
    ...Array.from(vectorMap.keys())
  ]);

  if (allCandidateIds.size === 0) return [];

  const fused = [];

  for (const chunkId of allCandidateIds) {
    const chunk = chunksMap.get(chunkId);
    if (!chunk) continue;

    if (sermonFilterSet && !sermonFilterSet.has(chunk.sermonId)) continue;

    const lexHit = lexicalMap.get(chunkId);
    const vecHit = vectorMap.get(chunkId);

    const lexicalRank = lexHit ? lexHit.rank : null;
    const lexicalScore = lexHit && typeof lexHit.score === 'number' ? lexHit.score : null;

    const vectorRank = vecHit ? vecHit.rank : null;
    const vectorScore = vecHit && typeof vecHit.score === 'number' ? vecHit.score : null;

    const rrfScore = computeRrfScore(lexicalRank, vectorRank, k);

    if (rrfScore >= minRrfScore) {
      fused.push({
        chunkId: chunk.chunkId,
        sermonId: chunk.sermonId,
        paragraphIds: [...chunk.paragraphIds],
        startParagraph: chunk.startParagraph,
        endParagraph: chunk.endParagraph,
        text: chunk.text,
        sermonTitle: chunk.sermonTitle,
        date: chunk.date,
        city: chunk.city,
        version: chunk.version,
        lexicalRank,
        lexicalScore,
        vectorRank,
        vectorScore,
        rrfScore,
        rank: 0,
        chunk
      });
    }
  }

  fused.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    const aBoth = a.lexicalRank !== null && a.vectorRank !== null ? 1 : 0;
    const bBoth = b.lexicalRank !== null && b.vectorRank !== null ? 1 : 0;
    if (bBoth !== aBoth) return bBoth - aBoth;

    const aMinRank = Math.min(a.lexicalRank ?? Infinity, a.vectorRank ?? Infinity);
    const bMinRank = Math.min(b.lexicalRank ?? Infinity, b.vectorRank ?? Infinity);
    if (aMinRank !== bMinRank) return aMinRank - bMinRank;

    const aVecScore = a.vectorScore ?? -1;
    const bVecScore = b.vectorScore ?? -1;
    if (bVecScore !== aVecScore) return bVecScore - aVecScore;

    return a.chunkId.localeCompare(b.chunkId);
  });

  return fused.slice(0, topK).map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

// ----------------------------------------------------
// Exécution des tests
// ----------------------------------------------------

console.log("--- 1. Validation mathématique de la formule RRF ---");

const rrf1 = computeRrfScore(1, null, 60);
assert(rrf1 === 0.016393, `RRF(rank=1, null, k=60) = 0.016393 (obtenu: ${rrf1})`);

const rrfBoth1 = computeRrfScore(1, 1, 60);
assert(rrfBoth1 === 0.032787, `RRF(rank=1, rank=1, k=60) = 0.032787 (obtenu: ${rrfBoth1})`);
assert(rrfBoth1 > rrf1, "Document présent dans les deux listes a un score strictement supérieur");

const rrfK10 = computeRrfScore(1, null, 10);
assert(rrfK10 === 0.090909, `RRF(k=10) = 0.090909 (obtenu: ${rrfK10})`);

const rrfK100 = computeRrfScore(1, null, 100);
assert(rrfK100 === 0.009901, `RRF(k=100) = 0.009901 (obtenu: ${rrfK100})`);

assert(computeRrfScore(null, null, 60) === 0, "RRF(null, null) = 0");
assert(computeRrfScore(undefined, undefined, 60) === 0, "RRF(undefined, undefined) = 0");
assert(computeRrfScore(0, 0, 60) === 0, "RRF(0, 0) = 0");
assert(computeRrfScore(-3, null, 60) === 0, "RRF(-3, null) = 0");

console.log("\n--- 2. Chargement du corpus et mapping des chunks ---");

const sermons = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
const allChunks = sermons.flatMap(s => createSermonChunks(s));
assert(allChunks.length === 16, `16 chunks créés pour le corpus (obtenu: ${allChunks.length})`);

const sampleParas = [
  { sermonId: '63-0324M', paragraphIndex: 2, score: 85 },
  { sermonId: '65-1212', paragraphIndex: 1, score: 60 }
];
const mappedHits = mapParagraphsToChunkHits(sampleParas, allChunks);
assert(mappedHits.length >= 2, `Mapping paragraphes -> chunks (${mappedHits.length} chunks associés)`);
assert(mappedHits[0].rank === 1, "Premier chunk assigné au rang 1");
assert(mappedHits[0].score === 85, "Score du premier hit = 85");
assert(mappedHits[0].matchedParagraphIds.includes(2), "Paragraphe 2 correctement ciblé");

assert(mapParagraphsToChunkHits([], allChunks).length === 0, "Mapping tableau vide = []");
assert(mapParagraphsToChunkHits(sampleParas, []).length === 0, "Mapping chunks vides = []");

console.log("\n--- 3. Validation des cas particuliers de fusion RRF ---");

const cA = allChunks[0];
const cB = allChunks[1];
const cC = allChunks[2];
const cD = allChunks[3];

// Cas 1 : Présent uniquement dans lexical
const resLexOnly = fuseRankings({
  lexicalHits: [{ chunkId: cA.chunkId, rank: 1, score: 90 }],
  vectorHits: [],
  allChunks,
  options: { topK: 5 }
});
assert(resLexOnly.length === 1, "Résultat présent uniquement dans lexical : 1 résultat retourné");
assert(resLexOnly[0].chunkId === cA.chunkId, "Chunk A retourné");
assert(resLexOnly[0].lexicalRank === 1, "lexicalRank = 1");
assert(resLexOnly[0].lexicalScore === 90, "lexicalScore = 90");
assert(resLexOnly[0].vectorRank === null, "vectorRank = null");
assert(resLexOnly[0].vectorScore === null, "vectorScore = null");
assert(resLexOnly[0].rrfScore === rrf1, `rrfScore conforme (${resLexOnly[0].rrfScore})`);
assert(resLexOnly[0].rank === 1, "rank = 1");

// Cas 2 : Présent uniquement dans vectoriel
const resVecOnly = fuseRankings({
  lexicalHits: [],
  vectorHits: [{ chunk: cB, score: 0.8542, rank: 1 }],
  allChunks,
  options: { topK: 5 }
});
assert(resVecOnly.length === 1, "Résultat présent uniquement dans vectoriel : 1 résultat retourné");
assert(resVecOnly[0].chunkId === cB.chunkId, "Chunk B retourné");
assert(resVecOnly[0].lexicalRank === null, "lexicalRank = null");
assert(resVecOnly[0].lexicalScore === null, "lexicalScore = null");
assert(resVecOnly[0].vectorRank === 1, "vectorRank = 1");
assert(resVecOnly[0].vectorScore === 0.8542, "vectorScore = 0.8542");
assert(resVecOnly[0].rrfScore === rrf1, `rrfScore conforme (${resVecOnly[0].rrfScore})`);

// Cas 3 : Présent dans les deux modalités
const resBoth = fuseRankings({
  lexicalHits: [
    { chunkId: cA.chunkId, rank: 1, score: 90 },
    { chunkId: cB.chunkId, rank: 2, score: 70 }
  ],
  vectorHits: [
    { chunk: cA, score: 0.92, rank: 1 },
    { chunk: cC, score: 0.88, rank: 2 }
  ],
  allChunks,
  options: { topK: 5 }
});
assert(resBoth.length === 3, "3 résultats uniques fusionnés");
assert(resBoth[0].chunkId === cA.chunkId, "Le chunk présent dans les deux modalités est #1");
assert(resBoth[0].lexicalRank === 1 && resBoth[0].vectorRank === 1, "Rangs 1 dans les 2 listes");
assert(resBoth[0].rrfScore === rrfBoth1, "Score RRF maximal combiné");

// Cas 4 : Corpus vide
const resEmptyCorpus = fuseRankings({
  lexicalHits: [{ chunkId: 'c1', rank: 1 }],
  vectorHits: [],
  allChunks: [],
  options: { topK: 10 }
});
assert(Array.isArray(resEmptyCorpus) && resEmptyCorpus.length === 0, "Corpus vide -> []");

// Cas 5 : Aucun résultat lexical et aucun résultat vectoriel
const resNoResults = fuseRankings({
  lexicalHits: [],
  vectorHits: [],
  allChunks,
  options: { topK: 10 }
});
assert(Array.isArray(resNoResults) && resNoResults.length === 0, "Aucun hit -> []");

// Cas 6 : Doublons dans une modalité
const resDedupe = fuseRankings({
  lexicalHits: [
    { chunkId: cA.chunkId, rank: 1, score: 95 },
    { chunkId: cA.chunkId, rank: 4, score: 75 }
  ],
  vectorHits: [
    { chunk: cA, score: 0.95, rank: 1 },
    { chunk: cA, score: 0.91, rank: 2 }
  ],
  allChunks,
  options: { topK: 5 }
});
assert(resDedupe.length === 1, "Doublons dédupliqués : 1 résultat unique");
assert(resDedupe[0].lexicalRank === 1, "Conserve le meilleur rang lexical (1)");
assert(resDedupe[0].vectorRank === 1, "Conserve le meilleur rang vectoriel (1)");

// Cas 7 : Conservation des champs de diagnostic
const diag = resBoth[0];
assert(typeof diag.chunkId === 'string' && diag.chunkId.length > 0, "diagnostic: chunkId présent");
assert(typeof diag.sermonId === 'string', "diagnostic: sermonId présent");
assert(Array.isArray(diag.paragraphIds), "diagnostic: paragraphIds présent");
assert(typeof diag.startParagraph === 'number', "diagnostic: startParagraph présent");
assert(typeof diag.endParagraph === 'number', "diagnostic: endParagraph présent");
assert(typeof diag.text === 'string' && diag.text.length > 0, "diagnostic: text présent");
assert(typeof diag.sermonTitle === 'string', "diagnostic: sermonTitle présent");
assert(diag.lexicalRank === 1, "diagnostic: lexicalRank = 1");
assert(diag.lexicalScore === 90, "diagnostic: lexicalScore = 90");
assert(diag.vectorRank === 1, "diagnostic: vectorRank = 1");
assert(diag.vectorScore === 0.92, "diagnostic: vectorScore = 0.92");
assert(typeof diag.rrfScore === 'number' && diag.rrfScore > 0, "diagnostic: rrfScore > 0");
assert(diag.rank === 1, "diagnostic: rank final = 1");

console.log("\n--- 4. Validation des fenêtres Top-5, Top-10, Top-20 ---");

const allLexHits = allChunks.map((c, i) => ({ chunkId: c.chunkId, rank: i + 1 }));

const resTop5 = fuseRankings({ lexicalHits: allLexHits, vectorHits: [], allChunks, options: { topK: 5 } });
assert(resTop5.length === 5, `Top-5 limite à 5 résultats (obtenu: ${resTop5.length})`);
assert(JSON.stringify(resTop5.map(r => r.rank)) === JSON.stringify([1, 2, 3, 4, 5]), "Rangs 1..5 consécutifs");

const resTop10 = fuseRankings({ lexicalHits: allLexHits, vectorHits: [], allChunks, options: { topK: 10 } });
assert(resTop10.length === 10, `Top-10 limite à 10 résultats (obtenu: ${resTop10.length})`);
assert(resTop10[9].rank === 10, "Dernier rang = 10");

const resTop20 = fuseRankings({ lexicalHits: allLexHits, vectorHits: [], allChunks, options: { topK: 20 } });
assert(resTop20.length === 16, `Top-20 sur 16 chunks retourne 16 résultats (obtenu: ${resTop20.length})`);

// Vérification de la stricte décroissance des scores
for (let i = 0; i < resTop20.length - 1; i++) {
  assert(resTop20[i].rrfScore >= resTop20[i + 1].rrfScore, `Décroissance RRF vérifiée au rang ${i + 1}`);
}

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
console.log("=================================================\n");
