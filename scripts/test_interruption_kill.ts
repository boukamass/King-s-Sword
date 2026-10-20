import fs from 'fs';
import path from 'path';
import {
  createCompactBitset,
  setChunkInBitset,
  bitsetToBase64,
  bitsetToRanges,
  saveIndexingCheckpoint,
  IndexingCheckpoint
} from '../services/chunkStorageService';

async function simulateProcessKill() {
  console.log(`[PROCESSUS #1 (PID: ${process.pid})] Démarrage de l'indexation vectorielle...`);
  const totalChunks = 1450;
  const bitset = createCompactBitset(totalChunks);

  let processed = 0;
  for (let i = 0; i < 650; i++) {
    setChunkInBitset(bitset, i);
    processed++;
  }

  const checkpoint: IndexingCheckpoint = {
    checkpointId: 'interruption-live-test',
    savedAt: new Date().toISOString(),
    totalChunks,
    compactBitset: bitsetToBase64(bitset),
    completedRanges: bitsetToRanges(bitset, totalChunks),
    lastProcessedIndex: 649,
    embeddingsCompleted: 650,
    embeddingsFailed: 0,
    alreadyIndexed: 0
  };

  // Sauvegarde sur disque du checkpoint pour persistance inter-processus
  const chkFile = path.resolve('./.indexing_checkpoint_live.json');
  fs.writeFileSync(chkFile, JSON.stringify(checkpoint, null, 2));

  console.log(`[PROCESSUS #1 (PID: ${process.pid})] Progression: 650/${totalChunks} chunks indexés (44.8%).`);
  console.log(`[PROCESSUS #1 (PID: ${process.pid})] Checkpoint compact écrit sur disque (.indexing_checkpoint_live.json).`);
  console.log(`[PROCESSUS #1 (PID: ${process.pid})] 💥 INTERRUPTION BRUTALE DU PROCESSUS (SIGKILL / Processus tué)...`);
  
  // Tuer le processus avec code 137 (SIGKILL standard sous Linux)
  process.exit(137);
}

simulateProcessKill();
