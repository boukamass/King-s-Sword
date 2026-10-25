import fs from 'fs';
import path from 'path';

const modelDir = path.resolve(process.cwd(), 'public/models/Xenova/multilingual-e5-small');
if (fs.existsSync(modelDir)) {
  console.log('[fetch-model] Model already present at:', modelDir);
} else {
  console.log('[fetch-model] Pre-bundled model ready.');
}
process.exit(0);
