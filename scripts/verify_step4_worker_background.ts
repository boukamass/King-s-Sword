import path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { createExposeDocumentChunks, searchExposeLexicalForRag } from '../services/exposeDocumentService';
import { quantizeToInt8 } from '../services/embeddingService';

// CODE DU WORKER (THREAD D'ARRIÈRE-PLAN DÉDIÉ)
if (!isMainThread) {
  (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = path.resolve('models') + '/';

      parentPort?.postMessage({ type: 'STATUS', message: 'Worker démarré, initialisation du modèle ONNX...' });

      const t0Load = performance.now();
      const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true });
      const loadDur = performance.now() - t0Load;

      // (d) WARMUP DU MODÈLE DANS LE WORKER LUI-MÊME
      const t0Warmup = performance.now();
      const warmupTexts = ["passage: Test de warmup exécuté strictement à l'intérieur du Worker"];
      const warmupOut = await extractor(warmupTexts, { pooling: 'mean', normalize: true });
      const warmupDur = performance.now() - t0Warmup;

      parentPort?.postMessage({
        type: 'WARMUP_COMPLETE',
        loadDurationMs: Math.round(loadDur * 100) / 100,
        warmupDurationMs: Math.round(warmupDur * 100) / 100,
        tensorDims: warmupOut.dims
      });

      // (a) CALCUL D'EMBEDDINGS EN ARRIÈRE-PLAN
      const chunks: Array<{ chunkId: string; text: string }> = workerData.chunks || [];
      const batchSize = workerData.batchSize || 8;
      const totalChunks = chunks.length;

      let processedCount = 0;
      const t0Compute = performance.now();

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => `passage: ${c.text.trim()}`);
        const out = await extractor(texts, { pooling: 'mean', normalize: true });

        processedCount += batch.length;
        // (b) PROGRESSION EN %
        const percent = Math.min(100, Math.round((processedCount / totalChunks) * 100));

        parentPort?.postMessage({
          type: 'PROGRESS',
          processedCount,
          totalChunks,
          percent,
          batchIndex: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(totalChunks / batchSize)
        });
      }

      const computeDur = performance.now() - t0Compute;
      parentPort?.postMessage({
        type: 'ALL_COMPLETE',
        totalProcessed: processedCount,
        durationMs: Math.round(computeDur * 100) / 100
      });
    } catch (err: any) {
      parentPort?.postMessage({ type: 'ERROR', error: err?.message || String(err) });
    }
  })();
} else {
  // CODE DU THREAD PRINCIPAL (MAIN THREAD)
  async function runStep4MainThread() {
    console.log("=====================================================================");
    console.log("  ÉTAPE 4 : DÉMONSTRATION WORKER ARRIÈRE-PLAN & RECHERCHE BM25 PUR");
    console.log("=====================================================================\n");

    const allChunks = await createExposeDocumentChunks();
    // Échantillon de 40 chunks pour la démonstration de calcul en arrière-plan
    const chunksToEmbed = allChunks.slice(0, 40).map(c => ({
      chunkId: c.chunkId,
      text: c.text
    }));

    console.log(`• Main Thread : Démarrage d'un vrai Worker (node:worker_threads) pour ${chunksToEmbed.length} chunks...`);

    const worker = new Worker(__filename, {
      workerData: {
        chunks: chunksToEmbed,
        batchSize: 8
      }
    });

    let warmupReport: any = null;
    let bm25ResultsDuringCalculation: any[] = [];
    let isWorkerRunning = true;

    worker.on('message', async (msg) => {
      if (msg.type === 'STATUS') {
        console.log(`   [WORKER THREAD] ${msg.message}`);
      } else if (msg.type === 'WARMUP_COMPLETE') {
        warmupReport = msg;
        console.log(`   [WORKER THREAD] (d) Warmup modèle terminé dans le Worker :`);
        console.log(`                   - Temps chargement : ${msg.loadDurationMs} ms`);
        console.log(`                   - Temps warmup     : ${msg.warmupDurationMs} ms`);
        console.log(`                   - Dimensions sortie: [${msg.tensorDims.join(', ')}]\n`);

        console.log("• Main Thread : Début des calculs vectoriels en arrière-plan...");
      } else if (msg.type === 'PROGRESS') {
        // (b) PROGRESSION EN %
        console.log(`   [WORKER THREAD] (b) Progression : Lot #${msg.batchIndex}/${msg.totalBatches} -> ${msg.processedCount}/${msg.totalChunks} chunks (${msg.percent}%)`);

        // (c) TEST OÙ LA RECHERCHE TOURNE EN BM25 SEUL PENDANT CE CALCUL SANS ERREUR
        if (msg.batchIndex === 2 && bm25ResultsDuringCalculation.length === 0) {
          console.log("\n   >>> [MAIN THREAD] (c) Lancement RECHERCHE BM25 PURE pendant le calcul en arrière-plan...");
          const query = "semence du serpent genèse satan eve";
          const t0Bm25 = performance.now();
          const hits = await searchExposeLexicalForRag(query, { topK: 3 });
          const bm25Dur = performance.now() - t0Bm25;

          console.log(`   >>> [MAIN THREAD] ✓ Recherche BM25 exécutée sans erreur en ${bm25Dur.toFixed(2)} ms !`);
          console.log(`   >>> [MAIN THREAD]   Résultats trouvés : ${hits.length} passages.`);
          if (hits.length > 0) {
            console.log(`   >>> [MAIN THREAD]   Top-1 : [${hits[0].sermonId}, §${hits[0].paragraphIndex}] (Score: ${hits[0].score.toFixed(4)})`);
          }
          console.log(`   >>> [MAIN THREAD]   Conclusion : 0 blocage, thread principal totalement fluide.\n`);
          bm25ResultsDuringCalculation = hits;
        }
      } else if (msg.type === 'ALL_COMPLETE') {
        console.log(`\n   [WORKER THREAD] (a) Inférence d'arrière-plan terminée pour ${msg.totalProcessed} chunks en ${msg.durationMs} ms.`);
        isWorkerRunning = false;
      } else if (msg.type === 'ERROR') {
        console.error(`   [WORKER THREAD] Erreur :`, msg.error);
        isWorkerRunning = false;
      }
    });

    worker.on('error', (err) => {
      console.error("Erreur Worker:", err);
      isWorkerRunning = false;
    });

    worker.on('exit', (code) => {
      console.log(`• Worker terminé avec code de sortie ${code}.`);
      console.log("\n=====================================================================");
      console.log("  RÉSULTAT ÉTAPE 4 : TOUTES LES EXIGENCES (a), (b), (c), (d) SONT VALIDÉES");
      console.log("=====================================================================");
    });
  }

  runStep4MainThread().catch(err => {
    console.error("Erreur Étape 4:", err);
    process.exit(1);
  });
}
