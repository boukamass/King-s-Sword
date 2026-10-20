import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import { pipeline } from '@xenova/transformers';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { createBibleDocumentChunks } from '../services/bibleDocumentService';
import { createSongDocumentChunks } from '../services/songDocumentService';
import { ensureFullBibleLoaded } from '../services/bibleService';
import { normalizeText } from '../utils/textUtils';
import { SermonChunk } from '../types';
import { BIBLE_BOOKS_META } from '../services/bibleMetadata';

// Cosine similarity pour Float32
function cosineSimilarityFloat32(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Cosine similarity pour Int8
function cosineSimilarityInt8(a: Int8Array | number[], b: Int8Array | number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function quantizeFloat32ToInt8(vec: Float32Array | number[]): Int8Array {
  const int8 = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    int8[i] = Math.max(-128, Math.min(127, Math.round(vec[i] * 127)));
  }
  return int8;
}

async function runStage1Evaluation() {
  console.log("=====================================================================");
  console.log("  KING'S SWORD — ÉVALUATION ÉTAPE 1 COMPLÈTE & MULTI-SOURCES");
  console.log("=====================================================================\n");

  // 1. Collecte de tous les chunks de toutes les sources
  const t0 = performance.now();
  console.log("1. Collecte et découpage de toutes les sources...");
  const exposeChunks = await createExposeDocumentChunks({ forceCanonical: true });
  const bibleLsgChunks = await createBibleDocumentChunks();
  const songChunks = await createSongDocumentChunks();

  // Darby
  const darbyData = await ensureFullBibleLoaded("darby");
  const darbyChunks: SermonChunk[] = [];
  if (darbyData) {
    for (const meta of BIBLE_BOOKS_META) {
      const bookData = darbyData[meta.id];
      if (!bookData) continue;
      const chapters = Object.keys(bookData).map(k => parseInt(k, 10)).sort((a,b) => a - b);
      for (const ch of chapters) {
        const verses = bookData[ch];
        if (!Array.isArray(verses) || verses.length === 0) continue;
        let pIdx = 0;
        let cCount = 1;
        while (pIdx < verses.length) {
          const group: any[] = [];
          let currentLen = 0;
          while (pIdx + group.length < verses.length) {
            const v = verses[pIdx + group.length];
            const vText = `${v.verse}. ${v.text.trim()}`;
            const added = currentLen === 0 ? vText.length : currentLen + 2 + vText.length;
            if (group.length > 0 && (added > 600 || group.length >= 4)) break;
            group.push({ ...v, fullText: vText });
            currentLen = added;
          }
          if (group.length === 0) group.push({ ...verses[pIdx], fullText: `${verses[pIdx].verse}. ${verses[pIdx].text}` });
          const text = group.map(g => g.fullText).join("\n\n");
          const vStart = group[0].verse;
          const vEnd = group[group.length - 1].verse;
          const ref = vStart === vEnd ? `${meta.name} ${ch}:${vStart}` : `${meta.name} ${ch}:${vStart}-${vEnd}`;
          darbyChunks.push({
            chunkId: `bible-darby-${meta.id}-${ch}-c${cCount++}`,
            sermonId: `bible-darby-${meta.id}-${ch}`,
            documentType: "bible",
            title: `${meta.name} ${ch}`,
            author: "Bible (Darby FR)",
            year: 1890,
            text,
            startParagraphIndex: vStart,
            endParagraphIndex: vEnd,
            paragraphIds: group.map(g => `v${g.verse}`),
            citationRef: `[Réf: ${ref} (Darby)]`,
            createdAt: new Date().toISOString()
          });
          pIdx += group.length;
        }
      }
    }
  }

  // KJV
  const kjvData = await ensureFullBibleLoaded("kjv");
  const kjvChunks: SermonChunk[] = [];
  if (kjvData) {
    for (const meta of BIBLE_BOOKS_META) {
      const bookData = kjvData[meta.id];
      if (!bookData) continue;
      const chapters = Object.keys(bookData).map(k => parseInt(k, 10)).sort((a,b) => a - b);
      for (const ch of chapters) {
        const verses = bookData[ch];
        if (!Array.isArray(verses) || verses.length === 0) continue;
        let pIdx = 0;
        let cCount = 1;
        while (pIdx < verses.length) {
          const group: any[] = [];
          let currentLen = 0;
          while (pIdx + group.length < verses.length) {
            const v = verses[pIdx + group.length];
            const vText = `${v.verse}. ${v.text.trim()}`;
            const added = currentLen === 0 ? vText.length : currentLen + 2 + vText.length;
            if (group.length > 0 && (added > 600 || group.length >= 4)) break;
            group.push({ ...v, fullText: vText });
            currentLen = added;
          }
          if (group.length === 0) group.push({ ...verses[pIdx], fullText: `${verses[pIdx].verse}. ${verses[pIdx].text}` });
          const text = group.map(g => g.fullText).join("\n\n");
          const vStart = group[0].verse;
          const vEnd = group[group.length - 1].verse;
          const ref = vStart === vEnd ? `${meta.name} ${ch}:${vStart}` : `${meta.name} ${ch}:${vStart}-${vEnd}`;
          kjvChunks.push({
            chunkId: `bible-kjv-${meta.id}-${ch}-c${cCount++}`,
            sermonId: `bible-kjv-${meta.id}-${ch}`,
            documentType: "bible",
            title: `${meta.name} ${ch}`,
            author: "Bible (KJV 1611)",
            year: 1611,
            text,
            startParagraphIndex: vStart,
            endParagraphIndex: vEnd,
            paragraphIds: group.map(g => `v${g.verse}`),
            citationRef: `[Réf: ${ref} (KJV)]`,
            createdAt: new Date().toISOString()
          });
          pIdx += group.length;
        }
      }
    }
  }

  // Sermons library.json
  const lib = JSON.parse(fs.readFileSync("public/library.json", "utf8"));
  const sermonChunks: SermonChunk[] = [];
  lib.forEach((s: any) => {
    sermonChunks.push({
      chunkId: `sermon-${s.id}-c1`,
      sermonId: s.id,
      documentType: "sermon",
      title: s.title,
      author: "William Marrion Branham",
      year: parseInt((s.date || "").split("-")[0], 10) || 1965,
      text: (s.text || "").trim(),
      startParagraphIndex: 1,
      endParagraphIndex: 1,
      paragraphIds: ["p1"],
      citationRef: `[${s.id}]`,
      createdAt: new Date().toISOString()
    });
  });

  const allChunks = [
    ...exposeChunks,
    ...bibleLsgChunks,
    ...songChunks,
    ...darbyChunks,
    ...kjvChunks,
    ...sermonChunks
  ];

  console.log(`✓ Chunks prêts : ${allChunks.length} chunks au total en ${Math.round(performance.now() - t0)} ms.`);
  console.log(`  - Exposé : ${exposeChunks.length}`);
  console.log(`  - Bible LSG 1910 : ${bibleLsgChunks.length}`);
  console.log(`  - Bible Darby FR : ${darbyChunks.length}`);
  console.log(`  - Bible KJV 1611 : ${kjvChunks.length}`);
  console.log(`  - Chants Crois Seulement : ${songChunks.length}`);
  console.log(`  - Sermons library.json : ${sermonChunks.length}`);

  // 2. Modèle pour le test de non-régression
  console.log("\n2. Chargement du modèle Xenova/multilingual-e5-small...");
  const tModel0 = performance.now();
  const embedder = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { quantized: true });
  const modelLoadTime = performance.now() - tModel0;
  console.log(`✓ Modèle chargé en ${modelLoadTime.toFixed(1)} ms.`);

  // 10 requêtes de non-régression couvrant Bible, Chants et Sermons
  const testQueries = [
    { id: 1, type: "bible", q: "Car Dieu a tant aime le monde quil a donne son Fils unique", targetSource: "Bible (LSG)" },
    { id: 2, type: "bible", q: "Au commencement Dieu crea les cieux et la terre", targetSource: "Bible (LSG)" },
    { id: 3, type: "bible", q: "L Eternel est mon berger je ne manquerai de rien", targetSource: "Bible (LSG)" },
    { id: 4, type: "bible", q: "Aux jours de la voix du septieme ange le mystere de Dieu saccomplira", targetSource: "Bible (LSG / Darby)" },
    { id: 5, type: "chant", q: "Crois seulement tout est possible crois seulement", targetSource: "Chants" },
    { id: 6, type: "chant", q: "Quel ami fidele et tendre nous avons en Jesus-Christ", targetSource: "Chants" },
    { id: 7, type: "chant", q: "Grace infinie qui sauva un pauvre miserable comme moi", targetSource: "Chants" },
    { id: 8, type: "sermon", q: "La semence du serpent et la perversion de la Parole divine", targetSource: "Exposé / Sermons" },
    { id: 9, type: "sermon", q: "Le cavalier sur le cheval blanc et la tromperie religieuse", targetSource: "Exposé / Sceaux" },
    { id: 10, type: "sermon", q: "La nourriture spirituelle au temps convenable et la manne cachee", targetSource: "Sermons / Communion" }
  ];

  console.log("\n3. Exécution du test de non-régression (Float32 Baseline vs Int8 Quantized)...");

  const regressionResults = [];

  for (const tq of testQueries) {
    const qTerms = normalizeText(tq.q).split(/\s+/).filter(w => w.length > 2);
    
    // Candidats pour cette requête
    const candidates = allChunks
      .map(c => {
        const norm = normalizeText(c.text);
        let score = 0;
        for (const term of qTerms) {
          if (norm.includes(term)) score += 10;
        }
        return { chunk: c, lexicalScore: score };
      })
      .filter(item => item.lexicalScore > 0)
      .sort((a, b) => b.lexicalScore - a.lexicalScore)
      .slice(0, 30)
      .map(item => item.chunk);

    if (candidates.length === 0) {
      const subset = allChunks.filter(c => c.documentType === tq.type).slice(0, 20);
      candidates.push(...subset);
    }

    // Embedding requête
    const qOutput = await embedder("query: " + tq.q, { pooling: "mean", normalize: true });
    const qFloat32 = new Float32Array(qOutput.data);
    const qInt8 = quantizeFloat32ToInt8(qFloat32);

    const scoredFloat32: Array<{ chunkId: string; title: string; score: number; ref: string }> = [];
    const scoredInt8: Array<{ chunkId: string; title: string; score: number; ref: string }> = [];

    for (const cand of candidates) {
      const cOutput = await embedder("passage: " + cand.text.slice(0, 400), { pooling: "mean", normalize: true });
      const cFloat32 = new Float32Array(cOutput.data);
      const cInt8 = quantizeFloat32ToInt8(cFloat32);

      const simF32 = cosineSimilarityFloat32(qFloat32, cFloat32);
      const simI8 = cosineSimilarityInt8(qInt8, cInt8);

      scoredFloat32.push({ chunkId: cand.chunkId, title: cand.title, score: simF32, ref: cand.citationRef || cand.chunkId });
      scoredInt8.push({ chunkId: cand.chunkId, title: cand.title, score: simI8, ref: cand.citationRef || cand.chunkId });
    }

    scoredFloat32.sort((a, b) => b.score - a.score);
    scoredInt8.sort((a, b) => b.score - a.score);

    const top10_F32 = scoredFloat32.slice(0, 10).map(s => s.chunkId);
    const top10_I8 = scoredInt8.slice(0, 10).map(s => s.chunkId);

    const overlapCount = top10_F32.filter(id => top10_I8.includes(id)).length;
    const top1Match = top10_F32[0] === top10_I8[0];

    regressionResults.push({
      id: tq.id,
      query: tq.q,
      type: tq.type,
      top1_F32: scoredFloat32[0]?.ref,
      top1_I8: scoredInt8[0]?.ref,
      top1Match,
      overlapAt10: `${overlapCount}/10 (${Math.round((overlapCount/10)*100)}%)`
    });

    console.log(`[Requête ${tq.id}] [${tq.type.toUpperCase()}] "${tq.q.slice(0, 45)}..."`);
    console.log(`  -> Top-1 Float32: ${scoredFloat32[0]?.ref} (score: ${scoredFloat32[0]?.score.toFixed(3)})`);
    console.log(`  -> Top-1 Int8:    ${scoredInt8[0]?.ref} (score: ${scoredInt8[0]?.score.toFixed(3)})`);
    console.log(`  -> Concordance Top-1: ${top1Match ? '✓ EXACT' : 'DIFF'} | Chevauchement Top-10: ${overlapCount}/10`);
  }

  if (!fs.existsSync('eval')) fs.mkdirSync('eval', { recursive: true });
  fs.writeFileSync('eval/non_regression_stage1_10queries.json', JSON.stringify(regressionResults, null, 2));
  console.log("\n✓ Résultats de non-régression enregistrés dans eval/non_regression_stage1_10queries.json");
}

runStage1Evaluation().catch(err => {
  console.error("Erreur évaluation:", err);
});
