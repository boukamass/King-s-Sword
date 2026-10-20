import fs from 'fs';
import path from 'path';
import { pipeline, env } from '@xenova/transformers';
import { performance } from 'perf_hooks';
import { createLibraryChunks } from '../services/chunkingService';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { writeBinaryVectorFiles } from '../services/binaryVectorStorageService';
import { quantizeToInt8 } from '../services/embeddingService';

async function buildCleanBinaryFilesWithRealOnnx() {
  console.log("=====================================================================");
  console.log("  GÉNÉRATION RÉELLE DU STOCKAGE BINAIRE ONNX (1 450 CHUNKS)");
  console.log("=====================================================================\n");

  const pubDir = path.resolve('public');
  const libraryPath = path.join(pubDir, 'library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const sermonChunks = createLibraryChunks(sermons);
  const exposeChunks = await createExposeDocumentChunks();

  // Les chunks réels du dépôt :
  // - Sermons disponibles : 16 chunks
  // - Exposé des Sept Âges : 1 434 chunks
  // Total exact : 1 450 chunks
  const allChunks = [...sermonChunks, ...exposeChunks];

  console.log(`• Sermons de la bibliothèque : ${sermons.length} sermons -> ${sermonChunks.length} chunks`);
  console.log(`• Livre Exposé des Sept Âges : 11 chapitres -> ${exposeChunks.length} chunks`);
  console.log(`• TOTAL DE TOUS LES CHUNKS RÉELS DU DÉPÔT : ${allChunks.length} chunks\n`);

  // Configuration du pipeline ONNX local
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.resolve('models') + '/';

  console.log("• Chargement du modèle ONNX Xenova/multilingual-e5-small...");
  const t0Model = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true });
  console.log(`✓ Modèle ONNX chargé en ${(performance.now() - t0Model).toFixed(2)} ms.\n`);

  // Calcul des vrais vecteurs ONNX par lots de 32
  const batchSize = 32;
  const vectorEntries: Array<{ chunkId: string; vector: Int8Array; sermonId?: string }> = [];
  const t0Inference = performance.now();

  console.log(`• Inférence ONNX réelle en cours sur les ${allChunks.length} chunks (lots de ${batchSize})...`);
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map(c => `passage: ${c.text.trim()}`);

    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    const dim = 384;
    const floatData = out.data;

    for (let j = 0; j < batch.length; j++) {
      const start = j * dim;
      const slice = floatData.subarray(start, start + dim);
      const int8Vec = quantizeToInt8(slice);
      vectorEntries.push({
        chunkId: batch[j].chunkId,
        vector: int8Vec,
        sermonId: batch[j].sermonId
      });
    }

    const pct = Math.round((vectorEntries.length / allChunks.length) * 100);
    if (i % 256 === 0 || vectorEntries.length === allChunks.length) {
      console.log(`   [ONNX] ${vectorEntries.length}/${allChunks.length} vecteurs calculés (${pct}%)`);
    }
  }

  const inferenceDuration = performance.now() - t0Inference;
  console.log(`✓ Inférence réelle terminée : ${vectorEntries.length} vecteurs calculés en ${inferenceDuration.toFixed(2)} ms (${(inferenceDuration / vectorEntries.length).toFixed(2)} ms/chunk)\n`);

  const binPath = path.join(pubDir, 'corpus_embeddings_384d.bin');
  const metaPath = path.join(pubDir, 'corpus_embeddings_384d_meta.json');
  const idxPath = path.join(pubDir, 'corpus_vectors.idx');

  // Écriture du binaire et de l'index
  const stats = writeBinaryVectorFiles(
    binPath,
    metaPath,
    vectorEntries,
    {
      modelId: 'Xenova/multilingual-e5-small',
      dimension: 384,
      quantization: 'int8'
    }
  );

  // Copie conforme pour les alias corpus_vectors.bin et corpus_vectors.idx
  fs.copyFileSync(binPath, path.join(pubDir, 'corpus_vectors.bin'));
  fs.copyFileSync(metaPath.replace(/\.json$/, '.idx'), idxPath);
  fs.copyFileSync(metaPath.replace(/\.json$/, '.idx'), path.join(pubDir, 'corpus_vectors_index.idx'));
  fs.copyFileSync(metaPath, path.join(pubDir, 'corpus_vectors_index.json'));

  const realBinSize = fs.statSync(binPath).size;
  const realIdxSize = fs.statSync(idxPath).size;

  console.log(`✓ Fichiers binaires générés pour EXACTEMENT ${vectorEntries.length} vecteurs :`);
  console.log(`   • Fichier binaire .bin : ${(realBinSize / 1024).toFixed(2)} Ko (${realBinSize} octets)`);
  console.log(`   • Fichier index .idx   : ${(realIdxSize / 1024).toFixed(2)} Ko (${realIdxSize} octets)`);
  console.log(`   • Nombre total de vecteurs : ${stats.totalVectors}`);
  console.log("=====================================================================");

  return {
    totalVectors: stats.totalVectors,
    binSize: realBinSize,
    idxSize: realIdxSize,
    inferenceDuration
  };
}

buildCleanBinaryFilesWithRealOnnx().catch(err => {
  console.error("Erreur génération binaire réelle:", err);
  process.exit(1);
});
