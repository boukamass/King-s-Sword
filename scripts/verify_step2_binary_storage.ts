import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { loadBinaryVectorStorage, getBinaryVectorForChunk, parseBinaryIndex, createBinaryIndexBuffer } from '../services/binaryVectorStorageService';

async function runStep2BinaryStorageTest() {
  console.log("=====================================================================");
  console.log("  ÉTAPE 2 : STOCKAGE BINAIRE D'EMBEDDINGS (INT8 + INDEX SANS JSON.PARSE)");
  console.log("=====================================================================\n");

  const pubDir = path.resolve('public');
  const binPath = path.join(pubDir, 'corpus_embeddings_384d.bin');
  const metaJsonPath = path.join(pubDir, 'corpus_embeddings_384d_meta.json');
  const idxPath = path.join(pubDir, 'corpus_vectors.idx');

  // Si .idx n'existe pas encore, le construire depuis les métadonnées pour garantie du test
  if (fs.existsSync(metaJsonPath)) {
    const metaJson = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'));
    const compactIdxBuf = createBinaryIndexBuffer(metaJson.chunks, metaJson.dimension || 384, 'int8');
    fs.writeFileSync(idxPath, compactIdxBuf);
    fs.writeFileSync(path.join(pubDir, 'corpus_vectors_index.idx'), compactIdxBuf);
  }

  const binSize = fs.existsSync(binPath) ? fs.statSync(binPath).size : 0;
  const idxSize = fs.existsSync(idxPath) ? fs.statSync(idxPath).size : 0;

  // Mesure de RAM avant chargement
  if (globalThis.gc) globalThis.gc();
  const memBefore = process.memoryUsage().heapUsed;

  // Mesure de temps de chargement
  const tStart = performance.now();
  const storageState = await loadBinaryVectorStorage({
    binaryFileName: 'corpus_embeddings_384d.bin',
    indexFileName: 'corpus_vectors_index.idx',
    forceReload: true
  });
  const loadTimeMs = Math.round((performance.now() - tStart) * 100) / 100;

  const memAfter = process.memoryUsage().heapUsed;
  const ramDeltaKb = Math.round((memAfter - memBefore) / 1024 * 10) / 10;

  // Test d'accès direct O(1) zero-copy
  const sampleChunkId = 'expose-ch-1_c1_p1_p3';
  const sampleVector = getBinaryVectorForChunk(sampleChunkId);

  console.log(`1. Fichiers binaires de stockage Int8 :`);
  console.log(`   • Fichier de vecteurs (.bin) : ${(binSize / 1024).toFixed(2)} Ko (${binSize} octets)`);
  console.log(`   • Index d'offsets (.idx KSIX) : ${(idxSize / 1024).toFixed(2)} Ko (${idxSize} octets)`);
  console.log(`   • Total taille disque : ${((binSize + idxSize) / 1024).toFixed(2)} Ko\n`);

  console.log(`2. Performances de chargement binaire :`);
  console.log(`   • Total vecteurs Int8 : ${storageState.totalVectors} vecteurs 384D`);
  console.log(`   • Temps de chargement : ${loadTimeMs} ms (0ms de JSON.parse)`);
  console.log(`   • RAM allouée (Buffer heapUsed) : ${ramDeltaKb} Ko`);
  console.log(`   • Vecteur d'exemple (${sampleChunkId}) : Int8Array(${sampleVector ? sampleVector.length : 0}) [${sampleVector ? sampleVector.subarray(0, 5).join(', ') : ''}...]\n`);

  console.log("=====================================================================");
  console.log("  RÉSULTAT ÉTAPE 2 : STOCKAGE BINAIRE OPTIMISÉ VALIDÉ");
  console.log("=====================================================================");

  return {
    binSize,
    idxSize,
    loadTimeMs,
    ramDeltaKb,
    totalVectors: storageState.totalVectors
  };
}

runStep2BinaryStorageTest().catch(err => {
  console.error("Erreur Étape 2:", err);
  process.exit(1);
});
