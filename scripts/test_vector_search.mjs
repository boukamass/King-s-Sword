/**
 * King's Sword — Tests de Recherche Vectorielle Minimale (Phase 2C)
 * Valide le calcul cosine, les filtres Top-K, la robustesse aux cas limites et la recherche sémantique.
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 🎯 TESTS DE LA RECHERCHE VECTORIELLE MINIMALE (PHASE 2C)");
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
  }
}

// 1. Implémentation du calcul cosine et de la recherche vectorielle (Portage ESM pour tests)
function computeCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  const lenA = vecA.length;
  const lenB = vecB.length;
  if (lenA === 0 || lenB === 0 || lenA !== lenB) return 0;

  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < lenA; i++) {
    const a = vecA[i];
    const b = vecB[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    nA += a * a;
    nB += b * b;
  }
  if (nA <= 0 || nB <= 0) return 0;
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  const sim = dot / denom;
  return sim > 1.0 ? 1.0 : (sim < -1.0 ? -1.0 : sim);
}

function searchByVector(queryVector, candidates, options = {}) {
  if (!queryVector || queryVector.length === 0 || !Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  const topK = options.topK || 10;
  const minThreshold = options.minScoreThreshold !== undefined ? options.minScoreThreshold : -1.0;
  const sermonFilter = options.sermonIdFilter && options.sermonIdFilter.length > 0 ? new Set(options.sermonIdFilter) : null;

  const scored = [];
  for (const c of candidates) {
    if (!c || !c.embedding || c.embedding.length === 0) continue;
    if (sermonFilter && !sermonFilter.has(c.sermonId)) continue;
    const sim = computeCosineSimilarity(queryVector, c.embedding);
    if (sim >= minThreshold) {
      scored.push({ chunk: c, score: sim });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topK)).map((item, idx) => ({
    chunk: item.chunk,
    score: Math.round(item.score * 10000) / 10000,
    rank: idx + 1
  }));
}

// 2. Tests de robustesse aux cas limites (Unit Tests)
console.log("--- Tests de robustesse aux cas limites du calcul cosinus ---");

// Test A : Vecteurs identiques
const v1 = [1, 2, 3, 4];
assert(Math.abs(computeCosineSimilarity(v1, v1) - 1.0) < 1e-6, "Vecteurs identiques -> Similarité = 1.0000");

// Test B : Vecteurs orthogonaux
const vOrth1 = [1, 0, 0];
const vOrth2 = [0, 1, 0];
assert(Math.abs(computeCosineSimilarity(vOrth1, vOrth2) - 0.0) < 1e-6, "Vecteurs orthogonaux -> Similarité = 0.0000");

// Test C : Vecteurs opposés
const vOpp1 = [1, 2, 3];
const vOpp2 = [-1, -2, -3];
assert(Math.abs(computeCosineSimilarity(vOpp1, vOpp2) - (-1.0)) < 1e-6, "Vecteurs opposés -> Similarité = -1.0000");

// Test D : Vecteur nul / Norme nulle
const vZero = [0, 0, 0];
assert(computeCosineSimilarity(v1, vZero) === 0, "Norme nulle gérée proprement -> Score = 0 (zéro division par zéro)");

// Test E : Dimensions différentes
const vDim3 = [1, 2, 3];
const vDim4 = [1, 2, 3, 4];
assert(computeCosineSimilarity(vDim3, vDim4) === 0, "Dimensions différentes gérées sans plantage -> Score = 0");

// Test F : Vecteur vide ou null
assert(computeCosineSimilarity([], v1) === 0, "Vecteur vide géré -> Score = 0");
assert(computeCosineSimilarity(null, v1) === 0, "Vecteur null géré -> Score = 0");
assert(computeCosineSimilarity(v1, undefined) === 0, "Vecteur undefined géré -> Score = 0");

// Test G : Présence de NaN / Infinity
const vNaN = [1, NaN, 3];
const vInf = [1, Infinity, 3];
assert(computeCosineSimilarity(v1, vNaN) === 0, "Valeur NaN gérée proprement -> Score = 0");
assert(computeCosineSimilarity(v1, vInf) === 0, "Valeur Infinity gérée proprement -> Score = 0");

// Test H : Déterminisme absolu
const sim1 = computeCosineSimilarity(v1, [4, 3, 2, 1]);
const sim2 = computeCosineSimilarity(v1, [4, 3, 2, 1]);
assert(sim1 === sim2, `Déterminisme absolu vérifié (${sim1} === ${sim2})`);

// Test I : Recherche sur corpus vide
assert(searchByVector(v1, []).length === 0, "Recherche sur corpus vide -> retourne tableau vide");

// 3. Tests sémantiques avec l'API Gemini et les 16 chunks du corpus de développement
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
assert(apiKey !== undefined, "Clé API Gemini configurée");

const ai = new GoogleGenAI({ apiKey });
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';

// Découpage des 16 chunks du corpus
function parseSermonParagraphs(text) {
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0).map((raw, idx) => {
    const trimmed = raw.trim();
    const match = trimmed.match(/^(\d+)[\.\s]/);
    return { num: match ? parseInt(match[1], 10) : idx + 1, text: trimmed, charCount: trimmed.length };
  });
}

function createChunksForSermon(sermon) {
  const paras = parseSermonParagraphs(sermon.text);
  const chunks = [];
  let pIdx = 0, cIdx = 1;
  while (pIdx < paras.length) {
    const grp = [];
    let curLen = 0;
    while (pIdx + grp.length < paras.length) {
      const cand = paras[pIdx + grp.length];
      const added = curLen === 0 ? cand.charCount : curLen + 2 + cand.charCount;
      if (grp.length > 0 && (added > 900 || grp.length >= 3)) break;
      grp.push(cand);
      curLen = added;
    }
    if (grp.length === 0) grp.push(paras[pIdx]);
    const pIds = grp.map(p => p.num);
    const chunkText = grp.map(p => p.text).join('\n\n');
    chunks.push({
      chunkId: `${sermon.id}_c${cIdx}_p${pIds[0]}_p${pIds[pIds.length - 1]}`,
      sermonId: sermon.id,
      paragraphIds: pIds,
      startParagraph: pIds[0],
      endParagraph: pIds[pIds.length - 1],
      sermonTitle: sermon.title,
      date: sermon.date,
      city: sermon.city,
      version: sermon.version,
      text: chunkText
    });
    cIdx++;
    pIdx += grp.length > 1 ? Math.max(1, grp.length - 1) : grp.length;
  }
  return chunks;
}

const library = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
const allChunks = [];
library.forEach(s => allChunks.push(...createChunksForSermon(s)));
assert(allChunks.length === 16, `16 chunks générés pour le test sémantique`);

async function runSemanticTests() {
  console.log("\nGénération des embeddings pour les 16 chunks du corpus...");
  for (const c of allChunks) {
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: c.text
    });
    c.embedding = res.embeddings?.[0]?.values || res.embedding?.values;
  }
  assert(allChunks.every(c => c.embedding && c.embedding.length === 3072), "16/16 chunks vectorisés avec succès (3072 dimensions)");

  // Test 1 : Requête exacte / directe
  console.log("\n--- Test 1 : Requête directe sur le premier sceau ---");
  const qDirect = "Qui est le cavalier sur le cheval blanc ?";
  const t0_q1_embed = performance.now();
  const resQ1 = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: qDirect });
  const latQ1_embed = Math.round((performance.now() - t0_q1_embed) * 100) / 100;
  const vecQ1 = resQ1.embeddings?.[0]?.values || resQ1.embedding?.values;

  const t0_q1_search = performance.now();
  const topResultsQ1 = searchByVector(vecQ1, allChunks, { topK: 5 });
  const latQ1_search = Math.round((performance.now() - t0_q1_search) * 100) / 100;

  assert(topResultsQ1.length === 5, `Top-5 retourné (${topResultsQ1.length} résultats)`);
  assert(topResultsQ1[0].chunk.sermonId === '63-0324M', `Top-1 sermon attendu : 63-0324M (trouvé: ${topResultsQ1[0].chunk.sermonId})`);
  assert(topResultsQ1[0].chunk.paragraphIds.includes(2), `Top-1 paragraphe attendu : §2 inclus`);
  assert(topResultsQ1[0].score > 0.70, `Score Top-1 élevé : ${topResultsQ1[0].score}`);
  console.log(`   ⏱️ Latence API embedding : ${latQ1_embed} ms | ⚡ Latence recherche locale : ${latQ1_search} ms`);

  // Test 2 : Requête paraphrasée avec synonymes et formulation indirecte
  console.log("\n--- Test 2 : Requête sémantique paraphrasée (sans mots-clés exacts) ---");
  const qParaphrase = "L'imposteur religieux monté sur la monture immaculée qui n'avait point de flèches";
  const t0_q2_embed = performance.now();
  const resQ2 = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: qParaphrase });
  const latQ2_embed = Math.round((performance.now() - t0_q2_embed) * 100) / 100;
  const vecQ2 = resQ2.embeddings?.[0]?.values || resQ2.embedding?.values;

  const t0_q2_search = performance.now();
  const topResultsQ2 = searchByVector(vecQ2, allChunks, { topK: 10 });
  const latQ2_search = Math.round((performance.now() - t0_q2_search) * 100) / 100;

  assert(topResultsQ2.length === 10, `Top-10 retourné (${topResultsQ2.length} résultats)`);
  assert(topResultsQ2[0].chunk.sermonId === '63-0324M', `Top-1 sémantique : 63-0324M retrouvé sans mots exacts`);
  assert(topResultsQ2[0].chunk.paragraphIds.includes(2), `Top-1 sémantique cible bien le §2`);
  assert(topResultsQ2[0].score > 0.65, `Score sémantique élevé : ${topResultsQ2[0].score}`);
  console.log(`   ⏱️ Latence API embedding : ${latQ2_embed} ms | ⚡ Latence recherche locale : ${latQ2_search} ms`);

  // Test 3 : Top-20 (sur les 16 chunks disponibles, retourne les 16)
  console.log("\n--- Test 3 : Validation Top-20 ---");
  const top20 = searchByVector(vecQ1, allChunks, { topK: 20 });
  assert(top20.length === 16, `Top-20 sur 16 chunks retourne 16 résultats (${top20.length})`);

  // Test 4 : Vérification de l'ordre strictement décroissant des scores
  let isSorted = true;
  for (let i = 1; i < top20.length; i++) {
    if (top20[i].score > top20[i - 1].score) isSorted = false;
  }
  assert(isSorted, "Ordre strictement décroissant des scores vérifié");

  // Test 5 : Vérification de la plage des scores [-1, 1]
  const allInRange = top20.every(r => r.score >= -1.0 && r.score <= 1.0);
  assert(allInRange, "Tous les scores sont strictement compris dans [-1.0, 1.0]");

  // Test 6 : Conservation intégrale des métadonnées
  const rFirst = top20[0];
  assert(rFirst.chunk.chunkId && rFirst.chunk.sermonId && rFirst.chunk.text && Array.isArray(rFirst.chunk.paragraphIds), "Métadonnées de chunk intégralement préservées dans les résultats");
  assert(rFirst.rank === 1 && top20[1].rank === 2, "Rangs 1..K correctement assignés");

  // Test 7 : Filtre par sermonId
  const filteredSearch = searchByVector(vecQ1, allChunks, { topK: 5, sermonIdFilter: ['65-1212'] });
  assert(filteredSearch.every(r => r.chunk.sermonId === '65-1212'), "Filtrage optionnel par sermonId respecté");

  console.log("\n=================================================");
  console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
  console.log("=================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runSemanticTests().catch(err => {
  console.error("Erreur durant les tests de recherche vectorielle :", err);
  process.exit(1);
});
