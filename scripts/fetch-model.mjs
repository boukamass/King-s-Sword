#!/usr/bin/env node
/**
 * scripts/fetch-model.mjs
 * Télécharge et vérifie les fichiers du modèle Xenova/multilingual-e5-small (ONNX quantifié)
 * Utilisé en pré-build pour garantir la présence locale sans committer le binaire de 113 Mo.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const modelDir = path.join(rootDir, 'models', 'Xenova', 'multilingual-e5-small');
const onnxDir = path.join(modelDir, 'onnx');

fs.mkdirSync(onnxDir, { recursive: true });

const FILES = [
  {
    url: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/config.json',
    dest: path.join(modelDir, 'config.json'),
    expectedSha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
    sizeExpected: 655
  },
  {
    url: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer_config.json',
    dest: path.join(modelDir, 'tokenizer_config.json'),
    expectedSha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
    sizeExpected: 443
  },
  {
    url: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json',
    dest: path.join(modelDir, 'tokenizer.json'),
    expectedSha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
    sizeExpected: 17112028
  },
  {
    url: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx',
    dest: path.join(onnxDir, 'model_quantized.onnx'),
    expectedSha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
    sizeExpected: 118308185
  }
];

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

async function downloadFile(url, dest) {
  console.log(`[fetch-model] Téléchargement: ${url} -> ${dest}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} pour ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
}

async function run() {
  console.log(`[fetch-model] Vérification et téléchargement des artefacts Xenova/multilingual-e5-small...`);
  for (const item of FILES) {
    let needDownload = false;
    if (!fs.existsSync(item.dest)) {
      needDownload = true;
    } else {
      const stats = fs.statSync(item.dest);
      if (stats.size !== item.sizeExpected) {
        console.warn(`[fetch-model] Taille incorrecte pour ${path.basename(item.dest)} (${stats.size} vs ${item.sizeExpected}). Re-téléchargement.`);
        needDownload = true;
      } else {
        const hash = computeSha256(item.dest);
        if (hash !== item.expectedSha256) {
          console.warn(`[fetch-model] Hash invalide pour ${path.basename(item.dest)}. Re-téléchargement.`);
          needDownload = true;
        }
      }
    }

    if (needDownload) {
      await downloadFile(item.url, item.dest);
      const hash = computeSha256(item.dest);
      if (hash !== item.expectedSha256) {
        throw new Error(`Échec vérification SHA-256 pour ${item.dest} (obtenu: ${hash}, attendu: ${item.expectedSha256})`);
      }
      console.log(`[fetch-model] OK: ${path.basename(item.dest)} vérifié avec succès (SHA-256: ${hash.substring(0, 16)}...).`);
    } else {
      console.log(`[fetch-model] Déjà présent et valide: ${path.basename(item.dest)}`);
    }
  }
  console.log(`[fetch-model] Tous les modèles sont prêts dans ${modelDir}.`);
}

run().catch(err => {
  console.error('[fetch-model] ERREUR FATALE:', err);
  process.exit(1);
});
