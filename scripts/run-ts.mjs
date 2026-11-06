// Lanceur de scripts TypeScript sans dépendance supplémentaire : compile le script avec esbuild (déjà fourni par Vite)
// dans node_modules/.cache/run-ts, puis l'exécute avec Node.
// Usage : node scripts/run-ts.mjs scripts/mon_test.ts [arguments...]
import { build } from 'esbuild';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const entry = process.argv[2];
if (!entry || !fs.existsSync(entry)) {
  console.error(`[run-ts] Script introuvable : ${entry || '(aucun)'}`);
  process.exit(1);
}

const root = process.cwd();
const outDir = path.join(root, 'node_modules', '.cache', 'run-ts');
const outfile = path.join(outDir, path.basename(entry).replace(/\.(m?ts|mjs|js)$/, '') + '.mjs');
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
  // Modules natifs et lourds : résolus depuis node_modules à l'exécution
  external: ['@xenova/transformers', 'onnxruntime-node', 'better-sqlite3', 'sharp', 'electron', 'esbuild'],
  banner: { js: "import { createRequire as __ksCreateRequire } from 'module'; const require = __ksCreateRequire(import.meta.url);" },
  define: { 'import.meta.env': '{}' }
});

const res = spawnSync(process.execPath, ['--max-old-space-size=4096', outfile, ...process.argv.slice(3)], { stdio: 'inherit', cwd: root });
process.exit(res.status ?? 1);
