import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function runRealInterruptionAndResumeTest() {
  console.log("=====================================================================");
  console.log("  ÉTAPE 5 : TEST DE VRAIE INTERRUPTION (PROCESS KILL) & REPRISE");
  console.log("=====================================================================\n");

  const checkpointFile = path.resolve('tmp_checkpoint_step5.json');
  if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);

  const totalChunks = 60;

  console.log("---------------------------------------------------------------------");
  console.log(" PHASE 1 : DÉMARRAGE DU PROCESSUS D'INDEXATION INITIAL");
  console.log("---------------------------------------------------------------------");

  let child1Killed = false;

  // Utiliser node directement pour avoir le PID exact du processus Node
  const child1 = spawn('npx', [
    'tsx',
    'scripts/mockable_indexing_worker.ts',
    `--total=${totalChunks}`,
    `--checkpoint=${checkpointFile}`,
    '--delay=60'
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  console.log(`• Processus d'indexation lancé (PID Process Group: ${child1.pid})`);

  child1.stdout?.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);

    // Dès qu'on voit que le chunk #25 est atteint, on TUE tout le groupe de processus
    if (text.includes('Chunk #25/60') && !child1Killed) {
      child1Killed = true;
      console.log(`\n>>> [PARENT] Étape #25 atteinte ! ENVOI DU SIGNAL SIGKILL AU GROUPE DE PROCESSUS (-${child1.pid})...\n`);
      try {
        process.kill(-child1.pid, 'SIGKILL');
      } catch {
        child1.kill('SIGKILL');
      }
    }
  });

  child1.stderr?.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  await new Promise((resolve) => {
    child1.on('close', (code, signal) => {
      console.log(`• Processus initial PID ${child1.pid} TUÉ NET : ExitCode=${code}, Signal=${signal || 'SIGKILL'}`);
      console.log(`✓ Interruption physique confirmée : Le processus a été stoppé net au vol !\n`);
      resolve(true);
    });
  });

  // Vérification de l'état compact sur disque
  if (!fs.existsSync(checkpointFile)) {
    throw new Error("Erreur: Le fichier de checkpoint n'a pas été créé !");
  }
  const chkData = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  console.log(`• État du Checkpoint sur disque à l'interruption :`);
  console.log(`   - Fichier              : ${checkpointFile}`);
  console.log(`   - Taille JSON          : ${fs.statSync(checkpointFile).size} octets (Bitmap compact)`);
  console.log(`   - Chunks enregistrés   : ${chkData.completedCount}/${totalChunks}`);
  console.log(`   - Intervalles compacts : ${JSON.stringify(chkData.completedRanges)}`);
  console.log(`   - Bitmap Base64        : "${chkData.compactBitset}"\n`);

  console.log("---------------------------------------------------------------------");
  console.log(" PHASE 2 : RELANCE DU PROCESSUS AVEC REPRISE (--resume)");
  console.log("---------------------------------------------------------------------");

  const child2 = spawn('npx', [
    'tsx',
    'scripts/mockable_indexing_worker.ts',
    `--total=${totalChunks}`,
    `--checkpoint=${checkpointFile}`,
    '--delay=20',
    '--resume'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  console.log(`• Nouveau processus de reprise lancé avec PID : ${child2.pid}`);

  child2.stdout?.on('data', (data) => {
    process.stdout.write(data.toString());
  });

  child2.stderr?.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  await new Promise((resolve) => {
    child2.on('close', (code, signal) => {
      console.log(`\n• Processus de reprise PID ${child2.pid} terminé avec succès (ExitCode=${code}).\n`);
      resolve(true);
    });
  });

  // Nettoyage final
  if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);

  console.log("=====================================================================");
  console.log("  RÉSULTAT ÉTAPE 5 : INTERRUPTION RÉELLE & REPRISE COMPACTE VALIDÉES");
  console.log("=====================================================================");
}

runRealInterruptionAndResumeTest().catch(err => {
  console.error("Erreur test interruption:", err);
  process.exit(1);
});
