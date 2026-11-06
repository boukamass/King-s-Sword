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
process.exit(0);
