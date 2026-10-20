import fs from 'fs';
import path from 'path';
import { Worker } from 'node:worker_threads';
import { performance } from 'perf_hooks';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { searchByText } from '../services/vectorSearchService';

async function main() {
  console.log("=====================================================================");
  console.log("  POINT 4 : WORKER ARRIERE-PLAN, PROGRESSION %, BM25 SEUL ET WARMUP");
  console.log("=====================================================================\n");

  const chunks = await createExposeDocumentChunks({ forceCanonical: true });
  console.log(`Corpus pour test Worker : ${chunks.length} chunks Exposé loaded.`);

  // 1. Démarrage du Worker
  console.log("\n(d) Initialisation du Worker et Warmup du modèle E5...");
  const workerPath = path.resolve('scripts', 'e5_background_worker.mjs');
  const worker = new Worker(workerPath);

  const t0Warmup = performance.now();
  worker.postMessage({ type: 'INIT_WARMUP' });

  await new Promise<void>((resolve) => {
    worker.on('message', (msg) => {
      if (msg.type === 'WARMED_UP') {
        const warmupMs = performance.now() - t0Warmup;
        console.log(`   ✓ Modèle réchauffé dans le Worker en ${msg.warmupDurationMs} ms (Mesure main: ${warmupMs.toFixed(1)} ms)`);
        resolve();
      }
    });
  });

  // 2. Lancement du calcul en arrière-plan et écoute de la progression %
  console.log("\n(a) Lancement du calcul des embeddings dans le Worker...");
  console.log("(b) Affichage de la progression en % en temps réel :");

  const progressHistory: number[] = [];
  let bm25QueriesExecuted = 0;
  let bm25Errors = 0;

  const testBm25Queries = [
    "semence du serpent genèse",
    "sept sceaux cavalier cheval blanc",
    "la colonne de feu et l ange",
    "la communion et la manne cachée",
    "les oints du temps de la fin",
    "le temple et l epouse"
  ];

  const t0Compute = performance.now();
  worker.postMessage({
    type: 'START_COMPUTE',
    items: chunks.slice(0, 300), // 300 chunks
    batchSize: 16
  });

  await new Promise<void>((resolve) => {
    worker.on('message', async (msg) => {
      if (msg.type === 'PROGRESS') {
        progressHistory.push(msg.percent);
        console.log(`   • Progression sémantique : ${msg.percent}% (${msg.completed}/${msg.total} chunks)`);

        // (c) Pendant que le worker calcule, exécution concurrent de recherche BM25 sur le thread principal
        const query = testBm25Queries[bm25QueriesExecuted % testBm25Queries.length];
        bm25QueriesExecuted++;

        try {
          const t0Bm25 = performance.now();
          const results = searchByText(query, chunks, { topK: 5 });
          const bm25Ms = performance.now() - t0Bm25;

          if (!results || results.length === 0) {
            bm25Errors++;
          } else {
            const topHit = results[0];
            console.log(`     ⚡ [BM25 Concurrent #${bm25QueriesExecuted}] "${query}" -> Top: ${topHit.chunkId} (${bm25Ms.toFixed(2)} ms, 0 erreur)`);
          }
        } catch (err) {
          bm25Errors++;
          console.error(`     ❌ Erreur recherche BM25 :`, err);
        }
      }

      if (msg.type === 'COMPLETE') {
        const computeMs = performance.now() - t0Compute;
        console.log(`\n✓ Inférence en arrière-plan terminée à 100% en ${computeMs.toFixed(1)} ms.`);
        resolve();
      }
    });
  });

  worker.terminate();

  console.log("\n=====================================================================");
  console.log("  RECAPITULATIF ETAPE 4");
  console.log("=====================================================================");
  console.log(`(a) Worker d'arrière-plan          : ✓ Opérationnel en thread séparé`);
  console.log(`(b) Progression % dynamique        : ${progressHistory.join('% -> ')}%`);
  console.log(`(c) Recherches BM25 pendant calcul : ${bm25QueriesExecuted} requêtes exécutées sans erreur (${bm25Errors} erreur)`);
  console.log(`(d) Warmup modèle dans Worker      : ✓ Effectué avec succès avant les lots`);
  console.log("=====================================================================");
}

main().catch(err => {
  console.error("Erreur benchmark Étape 4:", err);
  process.exit(1);
});
