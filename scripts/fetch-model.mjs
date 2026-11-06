import fs from 'fs';
import path from 'path';

// Le dossier « models/ » (racine) est copié dans les ressources de l'application installée (extraResources)
// et lu par les scripts Node : il doit contenir les mêmes fichiers que public/models (modèle ONNX + tokenizer).
// Les fichiers manquants y sont recopiés depuis public/models ; les fichiers déjà présents ne sont jamais modifiés.
const publicModels = path.resolve(process.cwd(), 'public/models');
const rootModels = path.resolve(process.cwd(), 'models');

function syncMissing(srcDir, dstDir) {
  let copied = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copied += syncMissing(src, dst);
    } else if (!fs.existsSync(dst)) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, dst);
      console.log('[fetch-model] Copié :', path.relative(process.cwd(), dst));
      copied++;
    }
  }
  return copied;
}

if (!fs.existsSync(publicModels)) {
  console.log('[fetch-model] Dossier public/models absent : rien à synchroniser.');
} else {
  const copied = syncMissing(publicModels, rootModels);
  console.log(copied > 0
    ? `[fetch-model] ${copied} fichier(s) de modèle complété(s) dans models/.`
    : '[fetch-model] Model already present at: ' + rootModels);
}

// Cross-encoder de reranking (processus principal Electron) : téléchargé une seule fois dans models/
// (≈ 136 Mo, non versionné). En cas d'échec, l'application garde le classement BM25 en tête.
// KS_SKIP_MODEL_DOWNLOAD=1 désactive le téléchargement.
const CROSS_ENCODER = {
  id: 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1',
  files: {
    'config.json': 'config.json',
    'tokenizer.json': 'tokenizer.json',
    'tokenizer_config.json': 'tokenizer_config.json',
    'special_tokens_map.json': 'special_tokens_map.json',
    // Version quantifiée int8 publiée par l'auteur du modèle, renommée selon la convention de transformers.js
    'onnx/model_quantized.onnx': 'onnx/model_quint8_avx2.onnx'
  }
};

async function downloadCrossEncoder() {
  if (process.env.KS_SKIP_MODEL_DOWNLOAD === '1') {
    console.log('[fetch-model] Téléchargement du cross-encoder désactivé (KS_SKIP_MODEL_DOWNLOAD=1).');
    return;
  }
  const dir = path.join(rootModels, ...CROSS_ENCODER.id.split('/'));
  for (const [target, remote] of Object.entries(CROSS_ENCODER.files)) {
    const dst = path.join(dir, ...target.split('/'));
    if (fs.existsSync(dst) && fs.statSync(dst).size > 0) continue;
    const url = `https://huggingface.co/${CROSS_ENCODER.id}/resolve/main/${remote}`;
    console.log('[fetch-model] Téléchargement :', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst + '.part', buf);
    fs.renameSync(dst + '.part', dst);
  }
  console.log('[fetch-model] Cross-encoder présent :', dir);
}

try {
  await downloadCrossEncoder();
} catch (err) {
  console.warn('[fetch-model] Cross-encoder non téléchargé (le classement BM25 en tête sera utilisé) :', err.message);
}
process.exit(0);
