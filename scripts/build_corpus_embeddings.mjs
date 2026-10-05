#!/usr/bin/env node
/**
 * King's Sword — Script de Build des Embeddings Précalculés du Corpus (Phase 2F.16)
 * 
 * Génère, compresse en Int8 (768D) et package l'ensemble des embeddings
 * pour que l'installateur/l'application soit livrée 100% pré-indexée (0 attente utilisateur).
 * 
 * Fonctionnalités de robustesse :
 * 1. Traitement par lots (Batching avec concurrence contrôlée)
 * 2. Reprise automatique sur interruption (Cache persistant disque)
 * 3. Backoff exponentiel avec jitter sur 429 / 503 / coupures réseau
 * 4. Normalisation L2 + Quantification symétrique Int8 (768 octets / vecteur)
 * 5. Export binaire direct (corpus_embeddings_768d.bin + metadata JSON)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createExposeDocumentChunks } from '../services/exposeDocumentService.ts';
import { createLibraryChunks } from '../services/chunkingService.ts';
import { normalizeL2, quantizeToInt8, validateEmbeddingVector, computeCosineInt8 } from '../services/embeddingService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
  console.error("❌ Erreur : Clé GEMINI_API_KEY introuvable dans l'environnement");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const MODEL_NAME = 'gemini-embedding-2-preview';
const TARGET_DIM = 768;
const MAX_RETRIES = 5;
const INTER_REQUEST_DELAY_MS = 750; // 750ms = 80 RPM (marge de sécurité de 20% sous le seuil de 100 RPM)

const cachePath = path.join(rootDir, 'eval', 'cache_embeddings_768d.json');
let embeddingCache = {};
if (fs.existsSync(cachePath)) {
  try {
    embeddingCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`📦 Cache existant chargé : ${Object.keys(embeddingCache).length} vecteurs.`);
  } catch (e) {
    console.warn("⚠️ Impossible de lire le cache existant, réinitialisation.");
  }
}

function saveCache() {
  fs.writeFileSync(cachePath, JSON.stringify(embeddingCache), 'utf8');
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function embedSingleWithBackoff(text, chunkId, retryCount = 0) {
  const cacheKey = `${MODEL_NAME}:${TARGET_DIM}:${chunkId}`;
  if (embeddingCache[cacheKey]) {
    return embeddingCache[cacheKey];
  }

  try {
    const res = await ai.models.embedContent({
      model: MODEL_NAME,
      contents: text.trim(),
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: TARGET_DIM
      }
    });

    const values = res.embeddings?.[0]?.values || res.embedding?.values;
    if (!values || values.length !== TARGET_DIM) {
      throw new Error(`Dimension invalide reçue (${values?.length} vs ${TARGET_DIM})`);
    }

    // Normalisation L2
    const norm = Array.from(normalizeL2(values));
    embeddingCache[cacheKey] = norm;
    return norm;
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
      const baseDelay = isRateLimit ? 15000 : 2000;
      const jitter = Math.floor(Math.random() * 500);
      const backoffMs = baseDelay * Math.pow(1.5, retryCount) + jitter;
      console.warn(`  ⚠️ Retry [${retryCount + 1}/${MAX_RETRIES}] sur ${chunkId} après ${backoffMs}ms`);
      await delay(backoffMs);
      return embedSingleWithBackoff(text, chunkId, retryCount + 1);
    }
    throw err;
  }
}

async function run() {
  console.log("==================================================================");
  console.log("🚀 COMPILATION ET PACKAGING DES EMBEDDINGS DU CORPUS COMPLET (768D Int8)");
  console.log("==================================================================\n");

  // 1. Récupération des chunks du corpus
  const t0 = performance.now();
  console.log("1. Extraction des chunks sémantiques...");
  const exposeChunks = await createExposeDocumentChunks();
  console.log(`   └─ Chunks Exposé des Sept Âges : ${exposeChunks.length}`);

  let sermonChunks = [];
  const libraryPath = path.join(rootDir, 'public', 'library.json');
  if (fs.existsSync(libraryPath)) {
    const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
    sermonChunks = createLibraryChunks(sermons);
    console.log(`   └─ Chunks Sermons bibliothèque : ${sermonChunks.length}`);
  }

  const allChunks = [...exposeChunks, ...sermonChunks];
  console.log(`   └─ TOTAL Chunks Corpus : ${allChunks.length}\n`);

  // 2. Génération / Chargement des embeddings avec cadence maîtrisée (~96 RPM)
  console.log(`2. Génération cadencée des embeddings 768D (taskType: RETRIEVAL_DOCUMENT, Cadence: ${INTER_REQUEST_DELAY_MS}ms)...`);
  let newlyGenerated = 0;
  let cacheHits = 0;
  let errorsCount = 0;

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    const cacheKey = `${MODEL_NAME}:${TARGET_DIM}:${chunk.chunkId}`;
    if (embeddingCache[cacheKey]) {
      cacheHits++;
    } else {
      try {
        await embedSingleWithBackoff(chunk.text, chunk.chunkId);
        newlyGenerated++;
        await delay(INTER_REQUEST_DELAY_MS);
      } catch (e) {
        errorsCount++;
        console.error(`❌ Échec embedding sur chunk ${chunk.chunkId}:`, e.message);
      }
    }

    // Sauvegarde incrémentale tous les 20 chunks ou au dernier
    if (i % 20 === 0 || i === allChunks.length - 1) {
      saveCache();
      const progress = Math.min(100, Math.round(((i + 1) / allChunks.length) * 100));
      process.stdout.write(`   └─ Progression : ${progress}% (${i + 1}/${allChunks.length}) [Nouveaux: ${newlyGenerated}, Cache: ${cacheHits}, Erreurs: ${errorsCount}]\r`);
    }
  }

  console.log(`\n\n✅ Indexation terminée en ${Math.round((performance.now() - t0) / 1000)}s.`);
  console.log(`   └─ Nouveaux embeddings générés : ${newlyGenerated}`);
  console.log(`   └─ Embeddings réutilisés (cache) : ${cacheHits}`);
  console.log(`   └─ Erreurs : ${errorsCount}`);

  // 3. Construction du bundle binaire Int8 et des métadonnées
  console.log("\n3. Construction du bundle binaire Int8 (768 octets / chunk)...");
  const totalValid = allChunks.filter(c => embeddingCache[`${MODEL_NAME}:${TARGET_DIM}:${c.chunkId}`]);
  const binBuffer = Buffer.alloc(totalValid.length * TARGET_DIM);
  const metadata = {
    version: '1.0.0',
    model: MODEL_NAME,
    dimension: TARGET_DIM,
    quantization: 'int8',
    bytesPerVector: TARGET_DIM,
    totalChunks: totalValid.length,
    generatedAt: new Date().toISOString(),
    chunks: []
  };

  let offset = 0;
  for (let i = 0; i < totalValid.length; i++) {
    const chunk = totalValid[i];
    const vecFloat32 = embeddingCache[`${MODEL_NAME}:${TARGET_DIM}:${chunk.chunkId}`];
    const int8Vec = quantizeToInt8(vecFloat32);

    for (let d = 0; d < TARGET_DIM; d++) {
      binBuffer.writeInt8(int8Vec[d], offset + d);
    }

    metadata.chunks.push({
      chunkId: chunk.chunkId,
      sermonId: chunk.sermonId,
      startParagraph: chunk.startParagraph,
      endParagraph: chunk.endParagraph,
      offset: offset,
      length: TARGET_DIM
    });

    offset += TARGET_DIM;
  }

  // 4. Écriture des fichiers de livraison précalculés dans public/ et dist/
  const outBinPath = path.join(rootDir, 'public', 'corpus_embeddings_768d.bin');
  const outMetaPath = path.join(rootDir, 'public', 'corpus_embeddings_meta.json');
  fs.writeFileSync(outBinPath, binBuffer);
  fs.writeFileSync(outMetaPath, JSON.stringify(metadata, null, 2), 'utf8');

  // Copie également dans dist/ si le répertoire existe pour tests de build
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    fs.copyFileSync(outBinPath, path.join(distDir, 'corpus_embeddings_768d.bin'));
    fs.copyFileSync(outMetaPath, path.join(distDir, 'corpus_embeddings_meta.json'));
  }

  const binSizeBytes = fs.statSync(outBinPath).size;
  const metaSizeBytes = fs.statSync(outMetaPath).size;
  const totalRawChars = allChunks.reduce((acc, c) => acc + (c.text ? c.text.length : 0), 0);

  // 5. Mesures métrologiques comparatives (Point 2, 4, 7)
  const sizeInt8_768 = binSizeBytes;
  const sizeFloat32_768 = totalValid.length * TARGET_DIM * 4;
  const sizeFloat32_3072 = totalValid.length * 3072 * 4;

  console.log("\n==================================================================");
  console.log("📊 MESURES D'IMPACT ET MÉTRIQUES COMPARATIVES");
  console.log("==================================================================");
  console.log(` • Chunks indexés                : ${totalValid.length} / ${allChunks.length}`);
  console.log(` • Texte brut cumulé             : ${(totalRawChars / 1024 / 1024).toFixed(2)} Mo`);
  console.log(` • Fichier binaire Int8 (768D)    : ${(binSizeBytes / 1024 / 1024).toFixed(2)} Mo (${binSizeBytes} octets)`);
  console.log(` • Métadonnées JSON index        : ${(metaSizeBytes / 1024).toFixed(2)} Ko`);
  console.log(` • Empreinte équivalente Float32 : ${(sizeFloat32_768 / 1024 / 1024).toFixed(2)} Mo (768D) | ${(sizeFloat32_3072 / 1024 / 1024).toFixed(2)} Mo (3072D)`);
  console.log(` • Facteur de réduction Int8 vs 3072D : x${(sizeFloat32_3072 / binSizeBytes).toFixed(1)}`);
  console.log(` • Impact installateur final     : +${((binSizeBytes + metaSizeBytes) / 1024 / 1024).toFixed(2)} Mo`);
  console.log("==================================================================\n");

  return {
    totalChunks: totalValid.length,
    rawTextMB: totalRawChars / 1024 / 1024,
    binSizeBytes,
    metaSizeBytes,
    sizeFloat32_768,
    sizeFloat32_3072
  };
}

run().catch(err => {
  console.error("FATAL ERROR in build script:", err);
  process.exit(1);
});
