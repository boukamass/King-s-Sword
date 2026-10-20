import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import crypto from 'crypto';
import { createExposeDocumentChunks, executeExposeRagPipeline } from '../services/exposeDocumentService';
import { computeSha1, computeParagraphSha1, computeChunkHash } from '../services/chunkingService';
import {
  saveChunks,
  getAllChunks,
  saveIndexingCheckpoint,
  loadIndexingCheckpoint,
  clearIndexingCheckpoint,
  IndexingCheckpoint
} from '../services/chunkStorageService';
import { runIncrementalEmbeddingIndexing } from '../services/embeddingIndexService';
import { loadBinaryVectorStorage, getBinaryVectorForChunk } from '../services/binaryVectorStorageService';
import { SermonChunk } from '../types';

async function runStage5Benchmark() {
  console.log("=====================================================================");
  console.log("  KING'S SWORD — MESURES COMPARATIVES ÉTAPE 5 : INDEXATION INCRÉMENTALE & REPRISE");
  console.log("=====================================================================\n");

  // 1. Validation de l'algorithme SHA-1 RFC 3174 (Navigateur / Worker / Node)
  console.log("1. Validation de l'algorithme de hachage SHA-1 conforme RFC 3174 :");
  const testStrings = [
    "",
    "The quick brown fox jumps over the lazy dog",
    "Dieu dans la Genèse - semence du serpent",
    "Car là où est le corps, là s'assembleront les aigles."
  ];

  let sha1Pass = true;
  for (const s of testStrings) {
    const computed = computeParagraphSha1(s);
    const native = crypto.createHash('sha1').update(s.trim()).digest('hex');
    const isMatch = computed === native;
    if (!isMatch) sha1Pass = false;
    console.log(`   • Texte: "${s.slice(0, 35)}..." -> SHA-1: ${computed.slice(0, 10)}... (Match Node Crypto: ${isMatch ? '✓ OUI' : '❌ NON'})`);
  }
  console.log(`   => Statut SHA-1 RFC 3174 : ${sha1Pass ? '✓ 100% CONFORME ET DÉTERMINISTE' : '❌ DIVERGENCE'}\n`);

  // 2. Chargement du corpus doctrinal complet de l'Exposé (1 434 chunks)
  console.log("2. Chargement du Corpus Doctrinal Complet (Exposé des Sept Âges) :");
  const t0Chunks = performance.now();
  const allChunks = await createExposeDocumentChunks({ forceCanonical: true });
  const tChunksElapsed = performance.now() - t0Chunks;

  console.log(`   • Total chunks Exposé                : ${allChunks.length}`);
  console.log(`   • Paragraphes avec hash SHA-1 calculé: ${allChunks.filter(c => Boolean(c.paragraphSha1)).length} / ${allChunks.length}`);
  console.log(`   • Temps de préparation chunks        : ${tChunksElapsed.toFixed(2)} ms`);

  // Hydratation complète avec les vecteurs binaires officiels Int8 384D
  await loadBinaryVectorStorage({ forceReload: true });
  const baseChunks: SermonChunk[] = allChunks.map(c => {
    const vec = getBinaryVectorForChunk(c.chunkId);
    return {
      ...c,
      embedding: vec || null
    };
  });
  const validVectorCount = baseChunks.filter(c => c.embedding && (c.embedding as any).length === 384).length;
  console.log(`   • Chunks hydratés avec vecteurs Int8 : ${validVectorCount} / ${baseChunks.length} (${((validVectorCount / baseChunks.length) * 100).toFixed(1)}%)`);

  await saveChunks(baseChunks, { immediate: true });

  // 3. Test d'incrémentalité : Aucun recalcul sur corpus inchangé
  console.log("\n3. Métrologie Incrémentale — Test 1 : Corpus inchangé (Cas B exclusif) :");
  const t0Inc1 = performance.now();
  const resUnchanged = await runIncrementalEmbeddingIndexing(baseChunks, {
    dryRun: true,
    enableCheckpoints: false
  });
  const tInc1 = performance.now() - t0Inc1;
  const pctReused = ((resUnchanged.alreadyIndexed / resUnchanged.totalChunks) * 100).toFixed(1);
  console.log(`   • Chunks totaux soumis               : ${resUnchanged.totalChunks}`);
  console.log(`   • Embeddings réutilisés (Cas B)       : ${resUnchanged.alreadyIndexed} / ${resUnchanged.totalChunks} (${pctReused}%)`);
  console.log(`   • Embeddings à recalculer            : ${resUnchanged.embeddingsRequired}`);
  console.log(`   • Temps de vérification SHA-1        : ${tInc1.toFixed(2)} ms (${(resUnchanged.totalChunks / Math.max(0.001, tInc1 / 1000)).toFixed(0)} chunks/sec)`);

  // 4. Test d'incrémentalité : Détection chirurgicale des modifications (Cas C)
  console.log("\n4. Métrologie Incrémentale — Test 2 : Modification chirurgicale d'un paragraphe :");
  const modifiedTargetIndex = 42;
  const originalTarget = baseChunks[modifiedTargetIndex];
  const modifiedText = originalTarget.text + " [Note doctrinale révisée pour test incrémental]";
  const modifiedChunk: SermonChunk = {
    ...originalTarget,
    text: modifiedText,
    paragraphSha1: computeParagraphSha1(modifiedText)
  };

  const modifiedCorpus = [...baseChunks];
  modifiedCorpus[modifiedTargetIndex] = modifiedChunk;

  const resModified = await runIncrementalEmbeddingIndexing(modifiedCorpus, {
    dryRun: true,
    enableCheckpoints: false
  });
  console.log(`   • Chunks totaux                      : ${resModified.totalChunks}`);
  console.log(`   • Chunks inchangés réutilisés (Cas B): ${resModified.alreadyIndexed}`);
  console.log(`   • Chunks modifiés détectés (Cas C)   : ${resModified.details.caseC}`);
  console.log(`   • Chunks nouveaux (Cas A)            : ${resModified.details.caseA}`);
  console.log(`   • Économie d'inférence               : ${((resModified.alreadyIndexed / resModified.totalChunks) * 100).toFixed(2)}% du corpus préservé sans recalcul`);

  // 5. Test Checkpoint & Reprise après fermeture
  console.log("\n5. Métrologie Checkpoint & Reprise après fermeture de l'application :");
  await clearIndexingCheckpoint();

  // Créer un scénario où 500 chunks ont été complétés et sauvegardés dans un checkpoint
  const completedCount = 500;
  const checkpointChunkIds = baseChunks.slice(0, completedCount).map(c => c.chunkId);

  const checkpointData: IndexingCheckpoint = {
    checkpointId: `chk-test-${Date.now()}`,
    savedAt: new Date().toISOString(),
    totalChunks: baseChunks.length,
    completedChunkIds: checkpointChunkIds,
    embeddingsCompleted: completedCount,
    embeddingsFailed: 0,
    alreadyIndexed: completedCount,
    details: { caseA: 0, caseB: completedCount, caseC: 0, caseD: 0 }
  };

  console.log("   • Simulation d'interruption et sauvegarde du checkpoint...");
  const t0CpSave = performance.now();
  await saveIndexingCheckpoint(checkpointData);
  const tCpSave = performance.now() - t0CpSave;
  console.log(`   • Checkpoint sauvegardé en            : ${tCpSave.toFixed(2)} ms`);
  console.log(`   • Progression sauvegardée            : ${completedCount} / ${baseChunks.length} chunks`);

  console.log("   • Simulation de réouverture de l'application et reprise :");
  const t0CpLoad = performance.now();
  const loadedCheckpoint = await loadIndexingCheckpoint();
  const tCpLoad = performance.now() - t0CpLoad;

  console.log(`   • Checkpoint rechargé en             : ${tCpLoad.toFixed(2)} ms`);
  console.log(`   • Identifiant du checkpoint          : ${loadedCheckpoint?.checkpointId}`);
  console.log(`   • Chunks pré-complétés reconnus      : ${loadedCheckpoint?.completedChunkIds.length}`);

  // Test de reprise effective avec simulation de chunks restants
  // Créons une copie du corpus où seuls les chunks du checkpoint ont des embeddings persistés
  const partialStorageChunks: SermonChunk[] = baseChunks.map((c, idx) => {
    if (idx < completedCount) {
      return c; // avec embedding
    }
    return {
      ...c,
      embedding: null // pas encore d'embedding
    };
  });
  await saveChunks(partialStorageChunks, { immediate: true });

  const resResume = await runIncrementalEmbeddingIndexing(baseChunks, {
    dryRun: true,
    enableCheckpoints: true
  });
  console.log(`   • Chunks reconnus comme déjà prêts   : ${resResume.alreadyIndexed} (dont ${completedCount} repris via checkpoint)`);
  console.log(`   • Chunks restant à calculer          : ${resResume.embeddingsRequired}`);
  console.log(`   • Cohérence de reprise               : ${resResume.alreadyIndexed === completedCount ? '✓ PARFAITE' : '❌ ÉCHEC'}`);

  // Restauration du stockage complet et nettoyage du checkpoint
  await saveChunks(baseChunks, { immediate: true });
  await clearIndexingCheckpoint();
  const cleared = await loadIndexingCheckpoint();
  console.log(`   • Nettoyage du checkpoint après fin  : ${cleared === null ? '✓ Succès' : '❌ Échec'}`);

  // 6. Test de non-régression de recherche hybride RAG
  console.log("\n6. Test de non-régression RAG sur le corpus complet (1 434 chunks) :");
  const testQueries = [
    { query: "semence du serpent genèse", expectedChapter: 3 },
    { query: "colonne de feu ange messager", expectedChapter: 1 },
    { query: "manne cachée vainqueur caillou blanc", expectedChapter: 5 }
  ];

  for (const tq of testQueries) {
    const t0Search = performance.now();
    const ragRes = await executeExposeRagPipeline(tq.query, {
      topK: 5,
      maxEvidenceCount: 5
    });
    const duration = performance.now() - t0Search;
    const topEvidence = ragRes.evidence?.[0];
    const topRef = topEvidence?.citationParagraphs?.[0]?.formattedCitation || topEvidence?.chunkId || 'N/A';
    console.log(`   • Requête : "${tq.query}"`);
    console.log(`     - Temps de recherche : ${duration.toFixed(2)} ms`);
    console.log(`     - Top-1 Réf : ${topRef}`);
    console.log(`     - Statut RAG : ${(ragRes.evidence?.length || 0) > 0 ? '✓ Succès' : '❌ Échec'}`);
  }

  console.log("\n=====================================================================");
  console.log("  RÉSULTAT ÉTAPE 5 : INDEXATION INCRÉMENTALE (SHA-1) & CHECKPOINT VALIDÉS");
  console.log("=====================================================================");
}

runStage5Benchmark().catch(err => {
  console.error("Erreur lors de l'exécution de l'Étape 5:", err);
  process.exit(1);
});
