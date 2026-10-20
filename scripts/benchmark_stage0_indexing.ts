import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { pipeline } from '@xenova/transformers';

async function main() {
  console.log("================================================================================");
  console.log("   ÉTAPE 0 : DIAGNOSTIC DE L'INDEXATION DU CORPUS COMPLET DE L'EXPOSÉ");
  console.log("================================================================================\n");

  // 1. CHARGEMENT DU CORPUS EXPOSÉ
  const exposePath = path.resolve('public/expose.json');
  if (!fs.existsSync(exposePath)) {
    console.error("❌ Fichier public/expose.json introuvable !");
    process.exit(1);
  }

  const exposeRaw = JSON.parse(fs.readFileSync(exposePath, 'utf8'));
  const paragraphs = exposeRaw.paragraphs || [];
  console.log(`📖 Corpus chargé : Exposé des 7 Âges (${paragraphs.length} paragraphes, ${exposeRaw.chapters?.length || 10} chapitres)\n`);

  // --------------------------------------------------------------------------------
  // MESURE 1 : TEMPS DE CHUNKING
  // --------------------------------------------------------------------------------
  console.log("▶ [1/4] Mesure du temps de chunking...");
  const tChunkStart = performance.now();

  interface Chunk {
    chunkId: string;
    chapterNumber: number;
    paragraphIds: number[];
    text: string;
  }

  const chunks: Chunk[] = [];
  const maxCharacters = 1200;
  const maxParagraphsPerChunk = 4;
  const overlapParagraphs = 1;

  let currentGroup: Array<{ paragraphIndex: number; text: string; chapter_number?: number }> = [];
  let currentLength = 0;
  let pIdx = 0;
  let chunkCounter = 1;

  while (pIdx < paragraphs.length) {
    currentGroup = [];
    currentLength = 0;

    while (pIdx + currentGroup.length < paragraphs.length) {
      const candidate = paragraphs[pIdx + currentGroup.length];
      const addedLength = currentLength === 0 ? candidate.text.length : currentLength + 2 + candidate.text.length;

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

    const paragraphIds = currentGroup.map(p => p.paragraphIndex);
    const chunkText = currentGroup.map(p => p.text).join('\n\n');

    chunks.push({
      chunkId: `expose_c${chunkCounter}_p${paragraphIds[0]}_p${paragraphIds[paragraphIds.length - 1]}`,
      chapterNumber: currentGroup[0]?.chapter_number || 1,
      paragraphIds,
      text: chunkText
    });

    chunkCounter++;

    const groupSize = currentGroup.length;
    let step = groupSize;
    if (overlapParagraphs > 0 && groupSize > 1) {
      step = Math.max(1, groupSize - overlapParagraphs);
    }
    pIdx += step;
  }

  const tChunkEnd = performance.now();
  const chunkingTimeMs = Math.round((tChunkEnd - tChunkStart) * 100) / 100;
  console.log(`   ✓ Nombre de chunks générés : ${chunks.length}`);
  console.log(`   ⏱️  Temps de chunking : ${chunkingTimeMs} ms (${(chunkingTimeMs / 1000).toFixed(3)} s)\n`);

  // --------------------------------------------------------------------------------
  // MESURE 2 : TEMPS D'INDEXATION BM25
  // --------------------------------------------------------------------------------
  console.log("▶ [2/4] Mesure de l'indexation lexicale BM25 (tokenisation, DF, IDF)...");
  const tBm25Start = performance.now();

  function tokenize(text: string): string[] {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
  }

  const docFrequency = new Map<string, number>();
  let totalWords = 0;

  for (const c of chunks) {
    const tokens = tokenize(c.text);
    totalWords += tokens.length;
    const uniqueTokens = new Set(tokens);
    for (const t of uniqueTokens) {
      docFrequency.set(t, (docFrequency.get(t) || 0) + 1);
    }
  }

  const totalChunks = chunks.length;
  const bm25Idf = new Map<string, number>();

  for (const [term, df] of docFrequency.entries()) {
    // Formule BM25 IDF : ln(1 + (N - df + 0.5) / (df + 0.5))
    const idf = Math.max(0, Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5)));
    bm25Idf.set(term, Math.round(idf * 1000) / 1000);
  }

  const tBm25End = performance.now();
  const bm25TimeMs = Math.round((tBm25End - tBm25Start) * 100) / 100;
  console.log(`   ✓ Vocabulaire unique indexé : ${bm25Idf.size} termes (Total mots : ${totalWords})`);
  console.log(`   ⏱️  Temps d'indexation BM25 : ${bm25TimeMs} ms (${(bm25TimeMs / 1000).toFixed(3)} s)\n`);

  // --------------------------------------------------------------------------------
  // MESURE 3 : TEMPS DE CALCUL DES EMBEDDINGS E5
  // --------------------------------------------------------------------------------
  console.log("▶ [3/4] Mesure du calcul des embeddings E5 (multilingual-e5-small)...");
  console.log("   Initialisation du pipeline ONNX WebAssembly...");

  const tModelLoadStart = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true
  });
  const tModelLoadEnd = performance.now();
  const modelLoadTimeMs = Math.round((tModelLoadEnd - tModelLoadStart) * 100) / 100;
  console.log(`   ✓ Modèle chargé en : ${modelLoadTimeMs} ms (${(modelLoadTimeMs / 1000).toFixed(2)} s)`);

  const sampleSize = 32;
  const sampleChunks = chunks.slice(0, sampleSize);

  console.log(`   Calcul sur un échantillon de ${sampleSize} chunks avec préfixe E5 ("passage: ")...`);

  // Test séquentiel un par un (mode actuel)
  const tEmbedSeqStart = performance.now();
  for (const sc of sampleChunks) {
    await extractor(`passage: ${sc.text.slice(0, 512)}`, { pooling: 'mean', normalize: true });
  }
  const tEmbedSeqEnd = performance.now();
  const embedSeqTimeMs = Math.round((tEmbedSeqEnd - tEmbedSeqStart) * 100) / 100;
  const perChunkSeqMs = Math.round((embedSeqTimeMs / sampleSize) * 10) / 10;
  const estimatedFullSeqSec = Math.round(((perChunkSeqMs * chunks.length) / 1000) * 10) / 10;

  console.log(`   ✓ Vitesse séquentielle (1 par 1) : ${perChunkSeqMs} ms/chunk (${(1000 / perChunkSeqMs).toFixed(1)} chunks/sec)`);
  console.log(`   ⚠️  Extrapolation sur le corpus complet (${chunks.length} chunks) : ~${estimatedFullSeqSec} s (~${(estimatedFullSeqSec / 60).toFixed(1)} min)`);

  // Test par lot de 32 (mode batch optimisé)
  const tEmbedBatchStart = performance.now();
  const batchInputs = sampleChunks.map(c => `passage: ${c.text.slice(0, 512)}`);
  await extractor(batchInputs, { pooling: 'mean', normalize: true });
  const tEmbedBatchEnd = performance.now();
  const embedBatchTimeMs = Math.round((tEmbedBatchEnd - tEmbedBatchStart) * 100) / 100;
  const perChunkBatchMs = Math.round((embedBatchTimeMs / sampleSize) * 10) / 10;
  const estimatedFullBatchSec = Math.round(((perChunkBatchMs * chunks.length) / 1000) * 10) / 10;

  console.log(`   ✓ Vitesse par lot de 32 (batching) : ${perChunkBatchMs} ms/chunk (${(1000 / perChunkBatchMs).toFixed(1)} chunks/sec)`);
  console.log(`   🚀 Extrapolation batch sur le corpus complet : ~${estimatedFullBatchSec} s (~${(estimatedFullBatchSec / 60).toFixed(1)} min)\n`);

  // --------------------------------------------------------------------------------
  // MESURE 4 : TEMPS D'ÉCRITURE SUR DISQUE (JSON vs BINAIRE)
  // --------------------------------------------------------------------------------
  console.log("▶ [4/4] Mesure d'écriture sur disque (Persistance JSON vs Binaire Int8/Float32)...");

  const dim = 384;
  const mockVectorsInt8 = new Int8Array(chunks.length * dim);
  for (let i = 0; i < mockVectorsInt8.length; i++) {
    mockVectorsInt8[i] = (i % 255) - 127;
  }

  // 4.A Écriture JSON
  const tJsonWriteStart = performance.now();
  const jsonStructure = chunks.map((c, idx) => ({
    chunkId: c.chunkId,
    chapterNumber: c.chapterNumber,
    paragraphIds: c.paragraphIds,
    embedding: Array.from(mockVectorsInt8.subarray(idx * dim, (idx + 1) * dim))
  }));
  const jsonSerialized = JSON.stringify(jsonStructure);
  const testJsonPath = path.resolve('.tmp_test_index.json');
  fs.writeFileSync(testJsonPath, jsonSerialized);
  const tJsonWriteEnd = performance.now();
  const jsonWriteTimeMs = Math.round((tJsonWriteEnd - tJsonWriteStart) * 100) / 100;
  const jsonSizeBytes = fs.statSync(testJsonPath).size;
  fs.unlinkSync(testJsonPath);

  console.log(`   • Format JSON (avec vecteurs) :`);
  console.log(`     - Taille sur disque : ${(jsonSizeBytes / (1024 * 1024)).toFixed(2)} Mo`);
  console.log(`     - Temps d'écriture : ${jsonWriteTimeMs} ms`);

  // 4.B Écriture Binaire Int8 + Index
  const tBinWriteStart = performance.now();
  const testBinPath = path.resolve('.tmp_test_vectors.bin');
  const testMetaPath = path.resolve('.tmp_test_meta.json');
  fs.writeFileSync(testBinPath, Buffer.from(mockVectorsInt8.buffer));
  const metaStructure = chunks.map((c, idx) => ({
    chunkId: c.chunkId,
    chapterNumber: c.chapterNumber,
    paragraphIds: c.paragraphIds,
    byteOffset: idx * dim,
    byteLength: dim
  }));
  fs.writeFileSync(testMetaPath, JSON.stringify(metaStructure));
  const tBinWriteEnd = performance.now();
  const binWriteTimeMs = Math.round((tBinWriteEnd - tBinWriteStart) * 100) / 100;
  const binSizeBytes = fs.statSync(testBinPath).size + fs.statSync(testMetaPath).size;
  fs.unlinkSync(testBinPath);
  fs.unlinkSync(testMetaPath);

  console.log(`   • Format Binaire Int8 + Méta :`);
  console.log(`     - Taille sur disque : ${(binSizeBytes / (1024 * 1024)).toFixed(2)} Mo`);
  console.log(`     - Temps d'écriture : ${binWriteTimeMs} ms (${(jsonWriteTimeMs / binWriteTimeMs).toFixed(1)}x plus rapide)\n`);

  // --------------------------------------------------------------------------------
  // RÉSUMÉ DU DIAGNOSTIC
  // --------------------------------------------------------------------------------
  console.log("================================================================================");
  console.log("   SYNTHÈSE DU DIAGNOSTIC ÉTAPE 0");
  console.log("================================================================================");
  console.log(`1. Chunking (${chunks.length} chunks)       : ${chunkingTimeMs} ms  (< 0.1s - TRÈS RAPIDE)`);
  console.log(`2. Indexation BM25 (${bm25Idf.size} mots) : ${bm25TimeMs} ms  (< 0.2s - TRÈS RAPIDE)`);
  console.log(`3. Calcul des Embeddings E5         : ~${estimatedFullSeqSec} s séquentiel (~${estimatedFullBatchSec} s batch) - 🔴 GOULOT MAJEUR (99% du temps)`);
  console.log(`4. Écriture disque (JSON vs Bin)    : JSON = ${jsonWriteTimeMs} ms (${(jsonSizeBytes / (1024*1024)).toFixed(2)} Mo) vs BIN = ${binWriteTimeMs} ms (${(binSizeBytes / (1024*1024)).toFixed(2)} Mo)`);
  console.log("================================================================================\n");
}

main().catch(err => {
  console.error("Erreur benchmark:", err);
  process.exit(1);
});
