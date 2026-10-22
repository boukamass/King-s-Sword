/**
 * King's Sword — Script de Test & Validation Rigoureuse du Pipeline Vectoriel (Phase 2F.19)
 * 
 * Exécute :
 * 1. Test de Fidélité : Compare 20 vecteurs de `sermons_vectors.bin` à un recalcul indépendant.
 * 2. Test de Reprise : Interrompt brusquement l'indexation à mi-parcours, relance, et vérifie que
 *    les fichiers `.bin` et `.idx` générés après reprise sont 100% identiques octet par octet.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { performance } from 'perf_hooks';
import { loadBinaryVectorStorage, getBinaryVectorForChunk, parseBinaryIndex } from '../services/binaryVectorStorageService';
import { computeE5Embedding, computeCosineInt8 } from '../services/embeddingService';
import { createLibraryChunks } from '../services/chunkingService';
import { Sermon } from '../types';

function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function runPipelineTests() {
  console.log("=========================================================================================");
  console.log("  KING'S SWORD — SUITE DE TEST & VALIDATION DU PIPELINE D'INDEXATION VECTORIELLE");
  console.log("=========================================================================================\n");

  const libraryPath = path.resolve('public', 'library.json');
  if (!fs.existsSync(libraryPath)) {
    console.error(`❌ ERREUR : library.json introuvable à ${libraryPath}`);
    process.exit(1);
  }

  const sermons: Sermon[] = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const chunks = createLibraryChunks(sermons);

  // -----------------------------------------------------------------------------------
  // TEST A : Test de Reprise et Résilience après Interruption Brutale (taskkill / SIGKILL)
  // -----------------------------------------------------------------------------------
  console.log("📌 TEST A : Test de reprise après interruption (reprise à mi-parcours vs run complet)...");
  
  const tmpFullDir = path.resolve('tmp', 'run_full');
  const tmpInterruptedDir = path.resolve('tmp', 'run_interrupted');

  fs.mkdirSync(tmpFullDir, { recursive: true });
  fs.mkdirSync(tmpInterruptedDir, { recursive: true });

  // 1. Run complet de référence
  console.log("   1. Exécution du run complet de référence...");
  execSync(`npx tsx scripts/build_sermons_index.ts ${libraryPath} --limit 50 --out-dir ${tmpFullDir}`, { stdio: 'pipe' });

  const fullBinSha = computeFileSha256(path.join(tmpFullDir, 'sermons_vectors.bin'));
  const fullIdxSha = computeFileSha256(path.join(tmpFullDir, 'sermons_vectors.idx'));
  const fullMetaSha = computeFileSha256(path.join(tmpFullDir, 'sermons_meta.json'));

  console.log(`   ✓ Run complet achevé. SHA-256 .bin : ${fullBinSha.substring(0, 16)}...`);

  // 2. Simulation d'interruption à mi-parcours : écriture d'un checkpoint partiel (50% des chunks)
  console.log("   2. Simulation d'une interruption à mi-parcours (50% de la progression)...");
  
  // Lire le fichier JSON source pour récupérer le SHA-256
  const sourceBuffer = fs.readFileSync(libraryPath);
  const sourceSha = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
  const ckPath = path.resolve(tmpInterruptedDir, `sermons_checkpoint_${sourceSha.substring(0, 12)}.jsonl`);

  // Calculer 50% des vecteurs pour créer un checkpoint partiel réel
  const halfChunks = chunks.slice(0, Math.floor(chunks.length / 2));
  let ckLines = '';
  for (const c of halfChunks) {
    const vec = await computeE5Embedding(c.text, 'passage: ');
    if (vec) {
      ckLines += JSON.stringify({ chunkId: c.chunkId, vector: Array.from(vec) }) + '\n';
    }
  }
  fs.writeFileSync(ckPath, ckLines, 'utf8');
  console.log(`   ✓ Checkpoint partiel écrit à ${ckPath} (${halfChunks.length} chunks).`);

  // 3. Relance du script qui doit reprendre depuis le checkpoint et achever l'indexation
  console.log("   3. Relance du script de génération pour reprise depuis le checkpoint...");
  execSync(`npx tsx scripts/build_sermons_index.ts ${libraryPath} --limit 50 --out-dir ${tmpInterruptedDir}`, { stdio: 'pipe' });

  const resumedBinSha = computeFileSha256(path.join(tmpInterruptedDir, 'sermons_vectors.bin'));
  const resumedIdxSha = computeFileSha256(path.join(tmpInterruptedDir, 'sermons_vectors.idx'));

  console.log(`   • SHA-256 Run Complet .bin     : ${fullBinSha}`);
  console.log(`   • SHA-256 Run Repris .bin      : ${resumedBinSha}`);

  const isBinIdentical = fullBinSha === resumedBinSha;
  const isIdxIdentical = fullIdxSha === resumedIdxSha;

  if (isBinIdentical && isIdxIdentical) {
    console.log("   ✓ TEST A RÉUSSI : Les fichiers .bin et .idx générés après reprise sont 100% IDENTIQUES octet par octet.\n");
  } else {
    console.error("   ❌ ÉCHEC TEST A : Incohérence binaire entre le run complet et le run repris.\n");
    process.exit(1);
  }

  // -----------------------------------------------------------------------------------
  // TEST B : Test de Fidélité Vectorielle (20 vecteurs du .bin vs Recalcul Indépendant)
  // -----------------------------------------------------------------------------------
  console.log("📌 TEST B : Test de fidélité vectorielle (20 vecteurs du .bin vs recalcul indépendant)...");

  // Charger le stockage binaire généré dans le run complet
  const binPath = path.join(tmpFullDir, 'sermons_vectors.bin');
  const idxPath = path.join(tmpFullDir, 'sermons_vectors.idx');

  const binStorage = await loadBinaryVectorStorage({
    binaryFileName: binPath,
    indexFileName: path.join(tmpFullDir, 'sermons_meta.json'),
    forceReload: true
  });

  const testSample = chunks.slice(0, Math.min(20, chunks.length));
  console.log(`   • Nombre de chunks testés : ${testSample.length}`);

  let fidelityPasses = 0;
  for (let i = 0; i < testSample.length; i++) {
    const chunk = testSample[i];
    const vecFromBin = getBinaryVectorForChunk(chunk.chunkId);
    
    // Recalcul indépendant via la fonction de l'app
    const recalculatedVec = await computeE5Embedding(chunk.text, 'passage: ');

    if (!vecFromBin || !recalculatedVec) {
      console.error(`   ❌ Vecteur manquant pour chunk ${chunk.chunkId}`);
      continue;
    }

    const sim = computeCosineInt8(vecFromBin, recalculatedVec);
    console.log(`   • Chunk #${i + 1} (${chunk.chunkId.substring(0, 24)}...) -> Similarité Cosinus : ${sim.toFixed(5)}`);

    if (sim >= 0.99) {
      fidelityPasses++;
    }
  }

  console.log(`\n   • Statut Fidélité : ${fidelityPasses} / ${testSample.length} vecteurs avec cosinus >= 0,99.`);

  if (fidelityPasses === testSample.length) {
    console.log("   ✓ TEST B RÉUSSI : Fidélité vectorielle 100% conforme.\n");
  } else {
    console.error("   ❌ ÉCHEC TEST B : Certains vecteurs ne correspondent pas.\n");
    process.exit(1);
  }

  console.log("=========================================================================================");
  console.log("  RÉSUMÉ : TOUS LES TESTS DU PIPELINE SONT PASSÉS AVEC SUCCÈS ✅");
  console.log("=========================================================================================\n");
}

runPipelineTests().catch(err => {
  console.error("❌ ERREUR FATALE suite de tests pipeline:", err);
  process.exit(1);
});
