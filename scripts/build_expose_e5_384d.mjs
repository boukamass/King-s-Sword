#!/usr/bin/env node
/**
 * scripts/build_expose_e5_384d.mjs
 * Génère l'index pré-calculé complet de l'Exposé en E5 384D Int8 (100% local, sans aucun appel externe).
 * Conserve l'ancien index 768D intact sans suppression.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('[BUILD_EXPOSE_E5] Initialisation du calcul de l\'index Exposé 384D Int8...');
  
  const { createExposeDocumentChunks } = await import('../services/exposeDocumentService.ts');
  const { getE5Extractor, quantizeToInt8 } = await import('../services/embeddingService.ts');
  
  const chunks = await createExposeDocumentChunks();
  console.log(`[BUILD_EXPOSE_E5] Total chunks à encoder : ${chunks.length}`);
  
  const extractor = await getE5Extractor();
  console.log('[BUILD_EXPOSE_E5] Modèle local E5 chargé.');
  
  const totalChunks = chunks.length;
  const dimension = 384;
  const binaryBuffer = Buffer.alloc(totalChunks * dimension);
  const metadataChunks = [];
  
  const t0 = Date.now();
  let offset = 0;
  
  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i];
    const formatted = `passage: ${chunk.text}`;
    const output = await extractor(formatted, { pooling: 'mean', normalize: true });
    const int8Vec = quantizeToInt8(output.data);
    
    // Écriture directe dans le buffer binaire
    const chunkBuffer = Buffer.from(int8Vec.buffer, int8Vec.byteOffset, int8Vec.byteLength);
    chunkBuffer.copy(binaryBuffer, offset);
    
    metadataChunks.push({
      chunkId: chunk.chunkId,
      sermonId: chunk.sermonId,
      startParagraph: chunk.startParagraph,
      endParagraph: chunk.endParagraph,
      offset: offset,
      length: dimension
    });
    
    offset += dimension;
    
    if ((i + 1) % 150 === 0 || i === totalChunks - 1) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (i + 1) / elapsed;
      console.log(`[BUILD_EXPOSE_E5] Progression : ${i + 1} / ${totalChunks} (${((i + 1) / totalChunks * 100).toFixed(1)}%) à ${rate.toFixed(1)} chunks/s`);
    }
  }
  
  const elapsedTotal = (Date.now() - t0) / 1000;
  console.log(`[BUILD_EXPOSE_E5] Encodage terminé en ${elapsedTotal.toFixed(2)}s (${(totalChunks / elapsedTotal).toFixed(2)} chunks/s).`);
  
  // Sauvegarde du fichier binaire 384D
  const binPath = path.join(rootDir, 'public', 'corpus_embeddings_384d.bin');
  fs.writeFileSync(binPath, binaryBuffer);
  console.log(`[BUILD_EXPOSE_E5] Fichier binaire écrit : ${binPath} (${binaryBuffer.length} octets)`);
  
  // Sauvegarde des métadonnées avec model_id et dimension
  const metadata = {
    version: '2.0.0',
    model_id: 'Xenova/multilingual-e5-small',
    model: 'Xenova/multilingual-e5-small',
    dimension: 384,
    quantization: 'int8',
    bytesPerVector: 384,
    totalChunks: totalChunks,
    generatedAt: new Date().toISOString(),
    chunks: metadataChunks
  };
  
  const meta384Path = path.join(rootDir, 'public', 'corpus_embeddings_384d_meta.json');
  fs.writeFileSync(meta384Path, JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`[BUILD_EXPOSE_E5] Métadonnées écrites : ${meta384Path}`);
  
  // Met à jour aussi public/corpus_embeddings_meta.json pour la compatibilité générale
  const mainMetaPath = path.join(rootDir, 'public', 'corpus_embeddings_meta.json');
  fs.writeFileSync(mainMetaPath, JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`[BUILD_EXPOSE_E5] Métadonnées principales mises à jour : ${mainMetaPath}`);
}

main().catch(err => {
  console.error('[BUILD_EXPOSE_E5] ERREUR FATALE :', err);
  process.exit(1);
});
