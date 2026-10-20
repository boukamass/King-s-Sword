import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { pipeline, env } from '@xenova/transformers';
import { createLibraryChunks } from '../services/chunkingService';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { SermonChunk } from '../types';

export async function runStep3BatchingBenchmark(options: { sampleSize?: number; passes?: number } = {}) {
  console.log("=====================================================================");
  console.log("  ÉTAPE 3 : BENCHMARK BATCHING ONNX SUR 500 CHUNKS (3 PASSES)");
  console.log("  WARMUP EXCLU — MESURES RÉELLES EN MILLISECONDES PAR CHUNK (ms/chunk)");
  console.log("=====================================================================\n");

  // 1. Récupération de tous les chunks réels du corpus
  const libraryPath = path.resolve('public/library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const sermonChunks = createLibraryChunks(sermons);
  const exposeChunks = await createExposeDocumentChunks();
  const allChunks = [...sermonChunks, ...exposeChunks];

  // 2. Sélection aléatoire déterministe de 500 chunks
  const seededRandom = (seed: number) => {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  const sampleSize = options.sampleSize || 500;
  const sampledChunks: SermonChunk[] = [];
  const indices = new Set<number>();
  let seed = 42;

  while (indices.size < Math.min(sampleSize, allChunks.length)) {
    const idx = Math.floor(seededRandom(seed++) * allChunks.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      sampledChunks.push(allChunks[idx]);
    }
  }

  console.log(`• Échantillon sélectionné : ${sampledChunks.length} chunks extraits aléatoirement du corpus.`);

  // 3. Configuration et chargement du modèle ONNX réel
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.resolve('models') + '/';

  console.log(`• Chargement du modèle ONNX local : ${env.localModelPath}Xenova/multilingual-e5-small...`);
  const t0Model = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true });
  console.log(`✓ Modèle ONNX chargé en ${(performance.now() - t0Model).toFixed(2)} ms.\n`);

  // 4. WARMUP DU MODÈLE (STRICTEMENT EXCLU DU BENCHMARK)
  console.log(`• Exécution du Warmup modèle (1 lot de 4 chunks, exclu des mesures)...`);
  const warmupTexts = sampledChunks.slice(0, 4).map(c => `passage: ${c.text.trim()}`);
  const t0Warmup = performance.now();
  const warmupOut = await extractor(warmupTexts, { pooling: 'mean', normalize: true });
  const warmupDur = performance.now() - t0Warmup;
  console.log(`✓ Warmup terminé en ${warmupDur.toFixed(2)} ms. Dims tenseur: [${warmupOut.dims.join(', ')}]\n`);

  // 5. EXÉCUTION DU BENCHMARK COMPARATIF : LOTS 1, 4, 8, 16, 32 AVEC 3 PASSES
  const batchSizes = [1, 4, 8, 16, 32];
  const numPasses = options.passes || 3;
  const results: Record<number, {
    passTimes: number[];
    passMsPerChunk: number[];
    avgMsPerChunk: number;
    totalMs: number;
    throughputChunksPerSec: number;
  }> = {};

  console.log("---------------------------------------------------------------------------------------------");
  console.log(" LOT (BATCH) | PASS 1 (ms/ch) | PASS 2 (ms/ch) | PASS 3 (ms/ch) | MOYENNE (ms/ch) | DÉBIT (ch/s)");
  console.log("---------------------------------------------------------------------------------------------");

  for (const bSize of batchSizes) {
    const passTimes: number[] = [];
    const passMsPerChunk: number[] = [];

    for (let pass = 0; pass < numPasses; pass++) {
      const tStart = performance.now();

      // Découpage en lots réels et inférence ONNX
      for (let i = 0; i < sampledChunks.length; i += bSize) {
        const batch = sampledChunks.slice(i, i + bSize);
        const texts = batch.map(c => `passage: ${c.text.trim()}`);
        await extractor(texts, { pooling: 'mean', normalize: true });
      }

      const passDuration = performance.now() - tStart;
      const msPerChunk = passDuration / sampledChunks.length;
      passTimes.push(passDuration);
      passMsPerChunk.push(msPerChunk);
    }

    const totalMs = passTimes.reduce((a, b) => a + b, 0);
    const avgMsPerChunk = totalMs / (sampledChunks.length * numPasses);
    const throughput = 1000 / avgMsPerChunk;

    results[bSize] = {
      passTimes,
      passMsPerChunk,
      avgMsPerChunk,
      totalMs,
      throughputChunksPerSec: throughput
    };

    console.log(
      ` Lot ${String(bSize).padEnd(8)} | ` +
      `${passMsPerChunk[0].toFixed(3).padStart(12)} | ` +
      `${passMsPerChunk[1].toFixed(3).padStart(12)} | ` +
      `${passMsPerChunk[2].toFixed(3).padStart(12)} | ` +
      `${avgMsPerChunk.toFixed(3).padStart(13)} | ` +
      `${throughput.toFixed(1).padStart(10)}`
    );
  }

  console.log("---------------------------------------------------------------------------------------------\n");

  // Analyse du lot optimal
  let bestBatchSize = 1;
  let minAvgMs = Infinity;
  for (const [bStr, res] of Object.entries(results)) {
    const b = Number(bStr);
    if (res.avgMsPerChunk < minAvgMs) {
      minAvgMs = res.avgMsPerChunk;
      bestBatchSize = b;
    }
  }

  console.log(`• Lot optimal identifié : Lot de ${bestBatchSize} (${minAvgMs.toFixed(3)} ms/chunk, débit: ${results[bestBatchSize].throughputChunksPerSec.toFixed(1)} chunks/s).`);
  console.log("=====================================================================\n");

  return results;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify_step3_batching_benchmark.ts')) {
  // Par défaut 50 chunks pour test CLI rapide ou 500 chunks pour full benchmark
  const sizeArg = process.argv[2] ? parseInt(process.argv[2], 10) : 500;
  runStep3BatchingBenchmark({ sampleSize: sizeArg, passes: 3 }).catch(err => {
    console.error("Erreur Étape 3:", err);
    process.exit(1);
  });
}
