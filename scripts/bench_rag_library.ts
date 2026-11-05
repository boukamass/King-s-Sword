/**
 * Banc de performance du retrieval sur la bibliothèque complète (≈185k chunks).
 * Mesure, pour chaque phase, la latence ET le blocage maximal de la boucle d'événements (= gel de l'interface),
 * y compris l'alternance Bibliothèque ↔ Dock (éviction de cache) et la mémoire.
 * Exécution : npx tsx scripts/bench_rag_library.ts
 */
import fs from 'fs';
import { extractLibrarySermonsArray } from '../services/chunkingService';
import { executeUnifiedRagPipeline, prewarmContextRetrieval } from '../services/unifiedRagService';

const log = (...a: any[]) => process.stdout.write(a.join(' ') + '\n');

// Moniteur de réactivité : écart maximal entre deux ticks programmés toutes les 10 ms
let maxLag = 0;
let lastTick = performance.now();
const lagTimer = setInterval(() => {
  const now = performance.now();
  maxLag = Math.max(maxLag, now - lastTick - 10);
  lastTick = now;
}, 10);
const resetLag = () => { maxLag = 0; lastTick = performance.now(); };

async function phase<T>(label: string, fn: () => Promise<T>): Promise<T> {
  await new Promise(r => setTimeout(r, 20));
  resetLag();
  const t = performance.now();
  const res = await fn();
  await new Promise(r => setTimeout(r, 20));
  log(`${label}: ${Math.round(performance.now() - t)} ms | blocage max UI: ${Math.round(maxLag)} ms`);
  return res;
}

async function main() {
  const sermons = extractLibrarySermonsArray(JSON.parse(fs.readFileSync('public/library.json', 'utf8')));
  const map = new Map<string, any>();
  for (const s of sermons) {
    const id = (s.version && !s.id.endsWith('-' + s.version)) ? `${s.id}-${s.version}` : s.id;
    if (!map.has(id)) map.set(id, { ...s, id });
  }
  const ids = Array.from(map.keys());
  log(`bibliothèque : ${ids.length} sermons`);

  console.log = () => {};
  console.warn = () => {};

  if (process.argv.includes('--prewarm')) {
    await phase('préchauffage arrière-plan', () => prewarmContextRetrieval(ids, { loadedSermonsMap: map }));
  }

  const queries: Array<[string, string[]]> = [
    ['Que signifie le septième sceau ?', ids],
    ['Pourquoi les femmes ne doivent pas se couper les cheveux ?', ids],
    ['Résume la communion', ['65-1212-SHP']],
    ['Que dit-il sur la foi dans ce sermon ?', ['65-1212-SHP', '63-0324M-VGR']],
    ['Qui est Melchisédek ?', ids],
    ['Quelle est la différence entre la foi et l\'espérance ?', ids]
  ];
  for (const [q, ctx] of (process.argv.includes('--one') ? queries.slice(0, 1) : queries)) {
    const pkg = await phase(`"${q.slice(0, 42)}" [${ctx.length} src]`, () =>
      executeUnifiedRagPipeline(q, ctx, { loadedSermonsMap: map, topK: 25, maxEvidenceCount: 16 }));
    log(`   → answerable=${pkg.answerable}, evidence=${pkg.evidence.length}, vector=${pkg.vectorMethod}`);
  }
  clearInterval(lagTimer);
  const mem = process.memoryUsage();
  log(`mémoire : heapUsed ${Math.round(mem.heapUsed / 1e6)} Mo, rss ${Math.round(mem.rss / 1e6)} Mo`);
}

main().catch(err => {
  process.stderr.write(String(err?.stack || err));
  process.exit(1);
});
