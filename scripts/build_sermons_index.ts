/**
 * King's Sword — Script de Génération Binaire de l'Index des Sermons (Format KSIX)
 * 
 * Usage :
 *   npx tsx scripts/build_sermons_index.ts <chemin_vers_sermons.json> [--limit N] [--out-dir <dossier>]
 * 
 * Options :
 *   --limit N        Indexe uniquement les N premiers sermons
 *   --out-dir PATH   Dossier de sortie des livrables (défaut : 'public')
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import { createLibraryChunks, normalizeSermonsForSqlite } from '../services/chunkingService';
import { createBinaryIndexBuffer } from '../services/binaryVectorStorageService';
import { computeE5Embedding, validateEmbeddingVector } from '../services/embeddingService';
import { Sermon, SermonChunk } from '../types';

/**
 * Écriture atomique sécurisée : écrit dans un fichier temporaire puis le renomme.
 */
function writeAtomicFileSync(filePath: string, data: string | Buffer): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

async function main() {
  const args = process.argv.slice(2);
  let jsonPath = '';
  let limit: number | null = null;
  let outDir = path.resolve('public');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--out-dir' && args[i + 1]) {
      outDir = path.resolve(args[i + 1]);
      i++;
    } else if (!jsonPath && !args[i].startsWith('--')) {
      jsonPath = args[i];
    }
  }

  if (!jsonPath) {
    const candidates = [
      path.resolve('public', 'library.json'),
      path.resolve('dist', 'library.json'),
      path.resolve('library.json')
    ];
    jsonPath = candidates.find(p => fs.existsSync(p)) || '';
  }

  console.log("=========================================================================================");
  console.log("  KING'S SWORD — BUILDER D'INDEX VECTORIEL DE SERMONS (FORMAT KSIX)");
  console.log("=========================================================================================\n");

  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.error(`❌ ERREUR : Fichier JSON source introuvable à l'emplacement : "${jsonPath}"`);
    console.log('\n📌 Usage :');
    console.log('   npx tsx scripts/build_sermons_index.ts /chemin/vers/sermons.json [--limit N] [--out-dir <dossier>]\n');
    process.exit(1);
  }

  console.log(`📂 Fichier JSON source : ${jsonPath}`);
  console.log(`📂 Dossier de sortie   : ${outDir}`);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonBuffer = fs.readFileSync(jsonPath);
  const sourceJsonSha256 = crypto.createHash('sha256').update(jsonBuffer).digest('hex');
  console.log(`🔑 SHA-256 du JSON source : ${sourceJsonSha256}`);

  const rawSermons: Sermon[] = JSON.parse(jsonBuffer.toString('utf8'));
  // Normalisation canonique partagée identique à main.js (db:importSermons + db:getAllSermonsWithParagraphs)
  let sermons: Sermon[] = normalizeSermonsForSqlite(rawSermons);
  const totalSermonsInFile = sermons.length;
  console.log(`✓ Nombre total de sermons dans le fichier : ${totalSermonsInFile}`);

  const isPartial = Boolean(limit && limit > 0 && limit < sermons.length);
  if (isPartial && limit) {
    console.log(`⚡ Option --limit activée : limitation à ${limit} sermons (isPartial = true)`);
    sermons = sermons.slice(0, limit);
  }

  // 1. Découpage canonique des sermons en chunks via la fonction officielle de l'application
  console.log('\n📌 Découpage des sermons en chunks sémantiques (createLibraryChunks)...');
  const tChunkStart = performance.now();
  const canonicalChunks: SermonChunk[] = createLibraryChunks(sermons);
  const chunkMs = Math.round(performance.now() - tChunkStart);
  console.log(`✓ ${canonicalChunks.length} chunks générés pour ${sermons.length} sermons (en ${chunkMs} ms).`);

  // Hash global du corpus pour la validation au démarrage
  const hasher = crypto.createHash('sha256');
  for (const c of canonicalChunks) {
    hasher.update(c.chunkId + c.text);
  }
  const corpusHash = hasher.digest('hex');
  console.log(`🔑 Hash du corpus : ${corpusHash}`);

  // 2. Reprise incrémentale par checkpoint JSONL (Format append-only)
  const checkpointJsonlPath = path.resolve(outDir, `sermons_checkpoint_${sourceJsonSha256.substring(0, 12)}.jsonl`);
  const completedMap = new Map<string, Int8Array>();

  if (fs.existsSync(checkpointJsonlPath)) {
    console.log(`\n🔄 Lecture du fichier checkpoint JSONL : ${checkpointJsonlPath}`);
    const lines = fs.readFileSync(checkpointJsonlPath, 'utf8').split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          if (entry.chunkId && Array.isArray(entry.vector) && entry.vector.length === 384) {
            completedMap.set(entry.chunkId, new Int8Array(entry.vector));
          }
        } catch (e) {
          // Ligne tronquée possible si arrêt pendant l'écriture, ignorée
        }
      }
    }
    console.log(`✓ ${completedMap.size} / ${canonicalChunks.length} chunks restaurés depuis le checkpoint.`);
  }

  // 3. Tri des chunks par longueur de texte pour optimiser le batching ONNX
  // Le tri réduit les pertes de padding ONNX. L'ordre canonique est réétabli ensuite.
  const sortedIndices = canonicalChunks.map((c, idx) => ({ idx, len: c.text.length, chunk: c }))
    .sort((a, b) => a.len - b.len);

  console.log('\n📌 Calcul des embeddings E5 (384D Int8) par lots de 4...');
  const tEmbedStart = performance.now();
  
  let unwrittenCount = 0;
  let pendingCheckpointLines = '';
  let lastCheckpointTime = performance.now();
  const BATCH_SIZE = 4;
  let failuresCount = 0;

  for (let i = 0; i < sortedIndices.length; i += BATCH_SIZE) {
    const batch = sortedIndices.slice(i, i + BATCH_SIZE);
    
    // Traitement par lot de 4
    for (const item of batch) {
      const chunk = item.chunk;
      if (!completedMap.has(chunk.chunkId)) {
        // Appelle exactement la fonction d'embedding de l'application
        const vec = await computeE5Embedding(chunk.text, 'passage: ');
        
        // Validation stricte du vecteur : interdiction absolue de vecteur nul ou invalide
        const val = validateEmbeddingVector(vec, 384);
        if (!val.valid || !vec) {
          console.error(`\n❌ ERREUR FATALE : Échec du calcul vectoriel pour le chunk "${chunk.chunkId}": ${val.error}`);
          failuresCount++;
          process.exit(1);
        }

        completedMap.set(chunk.chunkId, vec);
        unwrittenCount++;

        // Écriture incrémentale synchrone par appendFileSync dans le log JSONL du checkpoint
        const jsonlLine = JSON.stringify({ chunkId: chunk.chunkId, vector: Array.from(vec) }) + '\n';
        pendingCheckpointLines += jsonlLine;
        fs.appendFileSync(checkpointJsonlPath, jsonlLine, 'utf8');
      }
    }

    const now = performance.now();
    const elapsedSinceCk = (now - lastCheckpointTime) / 1000;

    // Conditions de checkpoint : toutes les 10 secondes OU tous les 500 nouveaux chunks
    if (unwrittenCount >= 500 || elapsedSinceCk >= 10) {
      unwrittenCount = 0;
      pendingCheckpointLines = '';
      lastCheckpointTime = now;
    }

    const currentCount = completedMap.size;
    const pct = Math.round((currentCount / canonicalChunks.length) * 100);
    const elapsedSec = (now - tEmbedStart) / 1000;
    const speed = (currentCount / Math.max(0.1, elapsedSec)).toFixed(1);
    process.stdout.write(`\r   [${pct}%] ${currentCount} / ${canonicalChunks.length} chunks traités (${speed} chunks/s)`);
  }

  process.stdout.write('\n');

  // 4. Contrôle d'intégrité strict à la fin du traitement
  if (completedMap.size !== canonicalChunks.length) {
    console.error(`\n❌ ERREUR FATALE : Nombre de vecteurs incomplet (${completedMap.size} / ${canonicalChunks.length}). Interruption.`);
    process.exit(1);
  }

  const totalEmbedSec = Math.round((performance.now() - tEmbedStart) / 1000);
  const msPerChunk = (performance.now() - tEmbedStart) / Math.max(1, canonicalChunks.length);
  console.log(`✓ Calcul terminé : ${completedMap.size} / ${canonicalChunks.length} embeddings valides (${totalEmbedSec}s, ${msPerChunk.toFixed(2)} ms/chunk).`);

  // 5. Génération des livrables dans l'ordre CANONIQUE STRICT des documents
  console.log('\n📌 Génération et écriture atomique des fichiers de sortie KSIX...');

  const rawVectorsBuf = Buffer.alloc(canonicalChunks.length * 384);
  const indexEntries: Array<{ chunkId: string; offset: number; length: number }> = [];

  for (let i = 0; i < canonicalChunks.length; i++) {
    const chunk = canonicalChunks[i];
    const vec = completedMap.get(chunk.chunkId);
    
    if (!vec || vec.length !== 384) {
      console.error(`❌ ERREUR FATALE : Vecteur manquant ou corrompu pour l'index canonique ${i} (${chunk.chunkId}).`);
      process.exit(1);
    }

    const offsetInBin = i * 384;
    Buffer.from(vec.buffer, vec.byteOffset, 384).copy(rawVectorsBuf, offsetInBin);

    indexEntries.push({
      chunkId: chunk.chunkId,
      offset: offsetInBin,
      length: 384
    });
  }

  // Header et table d'offsets KSIX
  const ksixIdxBuf = createBinaryIndexBuffer(indexEntries, 384, 'int8');

  // Métadonnées légères : SANS le texte des chunks pour éviter tout doublon avec SQLite/library.json
  const metaObj = {
    metadata: {
      indexVersion: '1.0.0',
      modelId: 'Xenova/multilingual-e5-small',
      modelVersion: '1.0.0',
      quantization: 'int8',
      chunkingVersion: '1.0.0',
      corpusHash,
      sourceJsonSha256,
      totalSermons: sermons.length,
      totalChunks: canonicalChunks.length,
      dimension: 384,
      isPartial,
      generatedAt: new Date().toISOString()
    },
    chunks: canonicalChunks.map(c => ({
      chunkId: c.chunkId,
      sermonId: c.sermonId,
      paragraphIds: c.paragraphIds,
      startParagraph: c.startParagraph,
      endParagraph: c.endParagraph,
      sermonTitle: c.sermonTitle,
      date: c.date,
      city: c.city,
      version: c.version,
      characterCount: c.characterCount || c.text.length,
      wordCount: c.wordCount || 0,
      contentHash: c.contentHash,
      paragraphSha1: c.paragraphSha1
    }))
  };

  // Écriture atomique (écriture dans .tmp puis renommage) dans LE DOSSIER UNIQUE de sortie
  const binPath = path.join(outDir, 'sermons_vectors.bin');
  const idxPath = path.join(outDir, 'sermons_vectors.idx');
  const metaPath = path.join(outDir, 'sermons_meta.json');

  writeAtomicFileSync(binPath, rawVectorsBuf);
  writeAtomicFileSync(idxPath, ksixIdxBuf);
  writeAtomicFileSync(metaPath, JSON.stringify(metaObj, null, 2));

  // Nettoyage du fichier temporaire de checkpoint après succès à 100%
  if (fs.existsSync(checkpointJsonlPath)) {
    try {
      fs.unlinkSync(checkpointJsonlPath);
      console.log(`🧹 Checkpoint temporaire supprimé (${checkpointJsonlPath}).`);
    } catch (e) {}
  }

  const binStat = fs.statSync(binPath);
  const idxStat = fs.statSync(idxPath);
  const metaStat = fs.statSync(metaPath);

  console.log('\n=========================================================================================');
  console.log('  RÉSUMÉ DU BUILD DE L\'INDEX VECTORIEL DE SERMONS :');
  console.log(`  • Sermons traités       : ${sermons.length} / ${totalSermonsInFile}`);
  console.log(`  • Chunks indexés        : ${canonicalChunks.length}`);
  console.log(`  • Vitesse moyenne       : ${msPerChunk.toFixed(2)} ms/chunk`);
  console.log(`  • Fichier Binaire (.bin): ${binPath} (${binStat.size} octets)`);
  console.log(`  • Fichier Index (.idx)  : ${idxPath} (${idxStat.size} octets)`);
  console.log(`  • Fichier Méta (.json)  : ${metaPath} (${metaStat.size} octets)`);
  console.log('=========================================================================================\n');
}

main().catch(err => {
  console.error('❌ ERREUR FATALE build_sermons_index:', err);
  process.exit(1);
});
