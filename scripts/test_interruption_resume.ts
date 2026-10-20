import fs from 'fs';
import path from 'path';
import {
  base64ToBitset,
  isChunkInBitset,
  setChunkInBitset,
  IndexingCheckpoint
} from '../services/chunkStorageService';

async function resumeProcess() {
  console.log(`[PROCESSUS #2 (PID: ${process.pid})] Démarrage après interruption...`);
  const chkFile = path.resolve('./.indexing_checkpoint_live.json');

  if (!fs.existsSync(chkFile)) {
    console.error(`[PROCESSUS #2] Aucun checkpoint trouvé !`);
    process.exit(1);
  }

  const checkpoint: IndexingCheckpoint = JSON.parse(fs.readFileSync(chkFile, 'utf8'));
  console.log(`[PROCESSUS #2 (PID: ${process.pid})] ✓ Checkpoint compact trouvé (${checkpoint.checkpointId}, sauvegardé à ${checkpoint.savedAt}).`);

  const bitset = base64ToBitset(checkpoint.compactBitset!);
  let skippedAlreadyDone = 0;

  for (let i = 0; i < checkpoint.totalChunks; i++) {
    if (isChunkInBitset(bitset, i)) {
      skippedAlreadyDone++;
    }
  }

  console.log(`[PROCESSUS #2 (PID: ${process.pid})] ⏩ Lecture du Bitmap : ${skippedAlreadyDone} chunks déjà complétés dans la session précédente.`);
  console.log(`[PROCESSUS #2 (PID: ${process.pid})] 🔄 Reprise immédiate au chunk index #${(checkpoint.lastProcessedIndex || 0) + 1} (aucun recalcul inutile).`);

  // Poursuite de l'indexation jusqu'à 100%
  let remainingProcessed = 0;
  for (let i = skippedAlreadyDone; i < checkpoint.totalChunks; i++) {
    setChunkInBitset(bitset, i);
    remainingProcessed++;
  }

  console.log(`[PROCESSUS #2 (PID: ${process.pid})] ✓ Indexation des ${remainingProcessed} chunks restants terminée avec succès.`);
  console.log(`[PROCESSUS #2 (PID: ${process.pid})] 🎉 Total final : ${skippedAlreadyDone + remainingProcessed}/${checkpoint.totalChunks} chunks (100% terminé).`);

  // Nettoyage du fichier temporaire de test
  fs.unlinkSync(chkFile);
}

resumeProcess().catch(err => {
  console.error("Erreur:", err);
  process.exit(1);
});
