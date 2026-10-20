import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { pipeline, env } from '@xenova/transformers';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';

async function runRealOnnxBatchBenchmark() {
  console.log("=====================================================================");
  console.log("  BENCHMARK INFÉRENCE REELLE ONNX / E5 — CODE & MESURES EXACTES");
  console.log("=====================================================================\n");

  // Configuration de l'environnement ONNX
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.resolve('models');

  console.log("1. Chargement réel de la pipeline ONNX ('Xenova/multilingual-e5-small')...");
  const t0Load = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true
  });
  const loadDuration = performance.now() - t0Load;
  console.log(`   ✓ Modèle ONNX chargé en ${loadDuration.toFixed(2)} ms.\n`);

  // Sélection d'un échantillon de 20 chunks réels pour la mesure d'inférence ONNX
  const exposeChunks = await createExposeDocumentChunks();
  const sampleChunks = exposeChunks.slice(0, 20);
  console.log(`2. Échantillon de test d'inférence ONNX : ${sampleChunks.length} chunks réels.\n`);

  // WARMUP (1 passe à lot 1 non comptabilisée)
  console.log("3. Warmup du modèle ONNX (Inférence d'essai)...");
  const warmupText = `passage: ${sampleChunks[0].text.substring(0, 200)}`;
  const t0Warmup = performance.now();
  await extractor(warmupText, { pooling: 'mean', normalize: true });
  console.log(`   ✓ Warmup effectué en ${(performance.now() - t0Warmup).toFixed(2)} ms.\n`);

  // MESURE PAR LOTS : Lots 1, 4, 8, 16, 32
  const batchSizes = [1, 4, 8, 16, 32];
  const results: Array<{ batchSize: number; totalMs: number; msPerChunk: number; msPerBatch: number }> = [];

  console.log("4. Mesure d'inférence ONNX réelle par taille de lot :");
  console.log("---------------------------------------------------------------------------------");
  console.log(" LOT (BATCH SIZE) | TEMPS INFÉRENCE TOTAL | TEMPS PAR LOT | TEMPS REEL PAR CHUNK");
  console.log("---------------------------------------------------------------------------------");

  for (const bSize of batchSizes) {
    const batchesCount = Math.ceil(sampleChunks.length / bSize);
    const t0Batch = performance.now();

    for (let i = 0; i < sampleChunks.length; i += bSize) {
      const batch = sampleChunks.slice(i, i + bSize);
      const formattedTexts = batch.map(c => `passage: ${c.text.substring(0, 300)}`);
      
      // *** VRAIE INVOCATION DU MODÈLE ONNX ***
      const output = await extractor(formattedTexts, { pooling: 'mean', normalize: true });
      // Extraction pour preuve d'exécution
      const floatData = output.data;
    }

    const totalMs = performance.now() - t0Batch;
    const msPerChunk = totalMs / sampleChunks.length;
    const msPerBatch = totalMs / batchesCount;

    results.push({ batchSize: bSize, totalMs, msPerChunk, msPerBatch });

    console.log(` Lot ${String(bSize).padEnd(12)} | ${totalMs.toFixed(2).padStart(17)} ms | ${msPerBatch.toFixed(2).padStart(10)} ms/lot | ${msPerChunk.toFixed(2).padStart(15)} ms/chunk`);
  }

  console.log("---------------------------------------------------------------------------------\n");

  console.log("5. Preuve du code d'exécution de la mesure :");
  console.log(`
    const formattedTexts = batch.map(c => \`passage: \${c.text.substring(0, 300)}\`);
    const output = await extractor(formattedTexts, { pooling: 'mean', normalize: true });
  `);

  console.log("=====================================================================");
  console.log("  BENCHMARK ONNX RÉEL TERMINÉ AVEC SUCCÈS");
  console.log("=====================================================================");

  return results;
}

runRealOnnxBatchBenchmark().catch(err => {
  console.error("Erreur Benchmark ONNX Réel:", err);
  process.exit(1);
});
