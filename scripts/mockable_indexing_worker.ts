import fs from 'fs';
import path from 'path';
import {
  createCompactBitset,
  setChunkInBitset,
  isChunkInBitset,
  bitsetToBase64,
  base64ToBitset,
  bitsetToRanges
} from '../services/chunkStorageService';

const checkpointFile = process.argv.find(a => a.startsWith('--checkpoint='))?.split('=')[1] || path.resolve('tmp_checkpoint_step5.json');
const totalChunks = parseInt(process.argv.find(a => a.startsWith('--total='))?.split('=')[1] || '60', 10);
const isResume = process.argv.includes('--resume');
const delayMs = parseInt(process.argv.find(a => a.startsWith('--delay='))?.split('=')[1] || '50', 10);

const pid = process.pid;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorker() {
  let bitset = createCompactBitset(totalChunks);
  let startIndex = 0;
  let alreadyDoneCount = 0;

  if (isResume && fs.existsSync(checkpointFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
      if (data.compactBitset) {
        bitset = base64ToBitset(data.compactBitset);
        for (let i = 0; i < totalChunks; i++) {
          if (isChunkInBitset(bitset, i)) {
            alreadyDoneCount++;
          }
        }
        startIndex = (data.lastProcessedIndex !== undefined ? data.lastProcessedIndex + 1 : alreadyDoneCount);
        console.log(`[PROCESS PID ${pid}] [REPRISE] Checkpoint compact détecté (${fs.statSync(checkpointFile).size} octets) :`);
        console.log(`[PROCESS PID ${pid}]   • ${alreadyDoneCount}/${totalChunks} chunks déjà complétés dans le Bitmap compact.`);
        console.log(`[PROCESS PID ${pid}]   • Reprise directe au chunk index #${startIndex} sans recalculer les ${alreadyDoneCount} précédents !`);
      }
    } catch (e: any) {
      console.warn(`[PROCESS PID ${pid}] Erreur lecture checkpoint:`, e.message);
    }
  } else {
    console.log(`[PROCESS PID ${pid}] [DÉMARRAGE] Début de session d'indexation fraîche (Total: ${totalChunks} chunks)...`);
  }

  for (let i = startIndex; i < totalChunks; i++) {
    await sleep(delayMs);

    // Marquer le chunk comme complété dans la structure compacte
    setChunkInBitset(bitset, i);

    // Sauvegarder périodiquement le checkpoint compact
    if ((i + 1) % 5 === 0 || i === totalChunks - 1) {
      const compactB64 = bitsetToBase64(bitset);
      const ranges = bitsetToRanges(bitset, totalChunks);
      const checkpointData = {
        checkpointId: `chk-pid-${pid}`,
        savedAt: new Date().toISOString(),
        totalChunks,
        compactBitset: compactB64,
        completedRanges: ranges,
        lastProcessedIndex: i,
        completedCount: i + 1
      };
      fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData));
      console.log(`[PROCESS PID ${pid}] [CHECKPOINT] Chunk #${i + 1}/${totalChunks} sauvegardé dans le BitSet compact (Taille: ${compactB64.length} car.)`);
    } else {
      console.log(`[PROCESS PID ${pid}] Chunk #${i + 1}/${totalChunks} indexé avec succès.`);
    }
  }

  console.log(`[PROCESS PID ${pid}] [SUCCÈS] Indexation des ${totalChunks} chunks achevée à 100% !`);
}

runWorker().catch(err => {
  console.error(`[PROCESS PID ${pid}] Erreur:`, err);
  process.exit(1);
});
