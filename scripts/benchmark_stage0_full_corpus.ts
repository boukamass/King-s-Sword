import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import { pipeline } from '@xenova/transformers';

async function main() {
  console.log("================================================================================");
  console.log("   DIAGNOSTIC COMPLET : EXPOSÉ + BIBLE + CHANTS (CORPUS GLOBAL)");
  console.log("================================================================================\n");

  // 1. CHARGEMENT DES COMPOSANTS DE CHUNKING
  const { createExposeDocumentChunks } = await import('../services/exposeDocumentService.ts');
  const { createBibleDocumentChunks } = await import('../services/bibleDocumentService.ts');
  const { createSongDocumentChunks } = await import('../services/songDocumentService.ts');
  const { createLibraryChunks } = await import('../services/chunkingService.ts');

  // --------------------------------------------------------------------------------
  // 1. MESURE DU CHUNKING
  // --------------------------------------------------------------------------------
  console.log("▶ [1/4] Mesure du temps de chunking par ressource...");

  // Exposé
  const tExposeStart = performance.now();
  const exposeChunks = await createExposeDocumentChunks();
  const tExposeEnd = performance.now();
  const exposeChunkTimeMs = Math.round((tExposeEnd - tExposeStart) * 100) / 100;
  console.log(`   ✓ Exposé des 7 Âges : ${exposeChunks.length} chunks en ${exposeChunkTimeMs} ms`);

  // Bible (LSG 1910)
  const tBibleStart = performance.now();
  const bibleChunks = await createBibleDocumentChunks();
  const tBibleEnd = performance.now();
  const bibleChunkTimeMs = Math.round((tBibleEnd - tBibleStart) * 100) / 100;
  console.log(`   ✓ Bible (Louis Segond 1910) : ${bibleChunks.length} chunks en ${bibleChunkTimeMs} ms`);

  // Chants
  const tSongStart = performance.now();
  const songChunks = await createSongDocumentChunks();
  const tSongEnd = performance.now();
  const songChunkTimeMs = Math.round((tSongEnd - tSongStart) * 100) / 100;
  console.log(`   ✓ Chants (Cantiques) : ${songChunks.length} chunks en ${songChunkTimeMs} ms`);

  // Échantillon sermons
  const libPath = path.resolve('public/library.json');
  const libSermons = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  const tLibStart = performance.now();
  const libraryChunks = createLibraryChunks(libSermons);
  const tLibEnd = performance.now();
  const libChunkTimeMs = Math.round((tLibEnd - tLibStart) * 100) / 100;
  console.log(`   ✓ Échantillon Sermons (library.json) : ${libraryChunks.length} chunks en ${libChunkTimeMs} ms`);

  const allChunks = [...exposeChunks, ...bibleChunks, ...songChunks, ...libraryChunks];
  const totalChunkTimeMs = Math.round((exposeChunkTimeMs + bibleChunkTimeMs + songChunkTimeMs + libChunkTimeMs) * 100) / 100;
  console.log(`\n   ⭐ TOTAL CHUNKS CORPUS COMPLET : ${allChunks.length} chunks`);
  console.log(`   ⏱️  Temps total de chunking : ${totalChunkTimeMs} ms (${(totalChunkTimeMs / 1000).toFixed(3)} s)\n`);

  // --------------------------------------------------------------------------------
  // 2. MESURE DE L'INDEXATION BM25
  // --------------------------------------------------------------------------------
  console.log("▶ [2/4] Mesure de l'indexation lexicale BM25 sur l'ensemble du corpus...");

  function tokenize(text: string): string[] {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
  }

  const tBm25Start = performance.now();
  const docFrequency = new Map<string, number>();
  const chunkLengths = new Map<string, number>();
  let totalTokens = 0;

  for (const c of allChunks) {
    const tokens = tokenize(c.text);
    chunkLengths.set(c.chunkId, tokens.length);
    totalTokens += tokens.length;
    const unique = new Set(tokens);
    for (const term of unique) {
      docFrequency.set(term, (docFrequency.get(term) || 0) + 1);
    }
  }

  const totalN = allChunks.length;
  const avgDocLength = totalTokens / totalN;
  const idfTable = new Map<string, number>();
  for (const [term, df] of docFrequency.entries()) {
    const idf = Math.max(0, Math.log(1 + (totalN - df + 0.5) / (df + 0.5)));
    idfTable.set(term, Math.round(idf * 1000) / 1000);
  }

  const tBm25End = performance.now();
  const bm25TimeMs = Math.round((tBm25End - tBm25Start) * 100) / 100;

  console.log(`   ✓ Vocabulaire unique indexé : ${idfTable.size} termes`);
  console.log(`   ✓ Total tokens analysés : ${totalTokens} mots (Longueur moyenne par chunk : ${avgDocLength.toFixed(1)} mots)`);
  console.log(`   ⏱️  Temps d'indexation BM25 : ${bm25TimeMs} ms (${(bm25TimeMs / 1000).toFixed(3)} s)\n`);

  // --------------------------------------------------------------------------------
  // 3. MESURE EMBEDDING & ESTIMATION
  // --------------------------------------------------------------------------------
  console.log("▶ [3/4] Mesure du calcul des embeddings E5 (multilingual-e5-small)...");
  const tModelLoadStart = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true
  });
  const tModelLoadEnd = performance.now();
  console.log(`   ✓ Modèle ONNX chargé en : ${Math.round(tModelLoadEnd - tModelLoadStart)} ms`);

  // Mesure sur échantillon représentatif de 32 chunks
  const sample32 = allChunks.slice(0, 32);
  const tSeqStart = performance.now();
  for (const c of sample32) {
    await extractor(`passage: ${c.text.slice(0, 512)}`, { pooling: 'mean', normalize: true });
  }
  const tSeqEnd = performance.now();
  const seqTimeMs = tSeqEnd - tSeqStart;
  const msPerChunkSeq = seqTimeMs / 32;

  // Mesure batch
  const tBatchStart = performance.now();
  const batchInputs = sample32.map(c => `passage: ${c.text.slice(0, 512)}`);
  await extractor(batchInputs, { pooling: 'mean', normalize: true });
  const tBatchEnd = performance.now();
  const batchTimeMs = tBatchEnd - tBatchStart;
  const msPerChunkBatch = batchTimeMs / 32;

  console.log(`   ✓ Débit séquentiel unitaire : ${msPerChunkSeq.toFixed(1)} ms/chunk (${(1000 / msPerChunkSeq).toFixed(1)} chunks/s)`);
  console.log(`   ✓ Débit par lot de 32 : ${msPerChunkBatch.toFixed(1)} ms/chunk (${(1000 / msPerChunkBatch).toFixed(1)} chunks/s)`);

  const estExposeSeqSec = (msPerChunkSeq * exposeChunks.length) / 1000;
  const estFullCorpusBatchSec = (msPerChunkBatch * allChunks.length) / 1000;
  const estFullCorpusSeqSec = (msPerChunkSeq * allChunks.length) / 1000;

  console.log(`\n   ⏱️  TEMPS ESTIMÉ DE CALCUL DES EMBEDDINGS :`);
  console.log(`     • Exposé seul (${exposeChunks.length} chunks) : ~${estExposeSeqSec.toFixed(1)} s (~${(estExposeSeqSec / 60).toFixed(1)} min)`);
  console.log(`     • Corpus complet (${allChunks.length} chunks) séquentiel : ~${estFullCorpusSeqSec.toFixed(1)} s (~${(estFullCorpusSeqSec / 60).toFixed(1)} min)`);
  console.log(`     • Corpus complet (${allChunks.length} chunks) par lot : ~${estFullCorpusBatchSec.toFixed(1)} s (~${(estFullCorpusBatchSec / 60).toFixed(1)} min)\n`);

  // --------------------------------------------------------------------------------
  // 4. TAILLES SUR DISQUE (ESTIMATION & FORMATS)
  // --------------------------------------------------------------------------------
  console.log("▶ [4/4] Estimation des tailles de fichier d'index sur disque...");
  const dim = 384;
  const vectorBytesInt8 = allChunks.length * dim; // 1 byte per dimension in int8
  const vectorBytesFloat32 = allChunks.length * dim * 4;

  console.log(`   • Vecteurs seuls Int8 (${allChunks.length} x 384) : ${(vectorBytesInt8 / (1024 * 1024)).toFixed(2)} Mo`);
  console.log(`   • Vecteurs seuls Float32 (${allChunks.length} x 384 x 4) : ${(vectorBytesFloat32 / (1024 * 1024)).toFixed(2)} Mo`);

  // Calcul du hash SHA-256 du corpus
  const hash = crypto.createHash('sha256');
  ['public/expose.json', 'public/bible-lsg1910.json', 'public/songs.json', 'public/library.json'].forEach(fp => {
    if (fs.existsSync(fp)) {
      hash.update(fs.readFileSync(fp));
    }
  });
  const corpusSha256 = hash.digest('hex');
  console.log(`   ✓ Hash SHA-256 combiné du corpus : ${corpusSha256.slice(0, 16)}...`);
  console.log("================================================================================\n");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
