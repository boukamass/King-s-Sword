/**
 * King's Sword — Test de rapidité des recherches locales (Bible, Exposé, cantiques)
 *
 * Vérifie, sur les vraies données de public/, que :
 *  1. les résultats sont identiques à une recherche de référence (texte normalisé à la volée) ;
 *  2. chaque recherche, une fois les index préparés, reste sous le seuil fixé (médiane de 3 essais).
 *
 * Usage : node scripts/run-ts.mjs scripts/test_search_speed.ts   (inclus dans npm test)
 */
import fs from 'fs';
import path from 'path';

// Chargement des fichiers locaux de public/ à la place des requêtes du navigateur
(globalThis as any).fetch = async (url: string) => {
  const name = String(url).split('?')[0].replace(/^.*\//, '');
  const p = path.resolve('public', name);
  const txt = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  return { ok: !!txt, status: txt ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => JSON.parse(txt), text: async () => txt };
};

const THRESHOLD_MS = 150;

let failures = 0;
let passed = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { passed++; console.log(`✓ ${label}`); } else { failures++; console.log(`✗ ${label}`); }
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const timeIt = async <T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> => {
  const times: number[] = [];
  let result!: T;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    result = await fn();
    times.push(performance.now() - t0);
  }
  return { ms: median(times), result };
};

(async () => {
  const { searchBibleVersesAdvanced, warmBibleSearchIndex, ensureFullBibleLoaded } = await import('../services/bibleService');
  const { searchExpose, warmExposeSearchIndex, loadExposeData } = await import('../services/exposeService');
  const { searchSongs, warmSongsSearchIndex } = await import('../services/songService');
  const { SearchMode } = await import('../types');
  const { normalizeText } = await import('../utils/textUtils');

  // Préparation des index (équivalent du préchargement au démarrage)
  await warmBibleSearchIndex('lsg1910');
  await warmBibleSearchIndex('kjv');
  await warmExposeSearchIndex();
  await warmSongsSearchIndex();

  // 1. Exactitude : nombre et identité des versets trouvés = recherche de référence
  const lsg = await ensureFullBibleLoaded('lsg1910');
  for (const q of ['Dieu', 'agneau de Dieu', 'grâce']) {
    const expected: string[] = [];
    const nq = normalizeText(q);
    for (const [bookId, chapters] of Object.entries(lsg || {})) {
      for (const [ch, verses] of Object.entries(chapters)) {
        for (const v of verses) if (v?.text && normalizeText(`${v.verse}. ${v.text}`).includes(nq)) expected.push(`bible-${bookId}-${ch}-${v.verse}`);
      }
    }
    const got = (await searchBibleVersesAdvanced({ query: q, mode: SearchMode.EXACT_PHRASE, limit: 100000, version: 'lsg1910' })).map((r: any) => r.paragraphId);
    check(JSON.stringify([...got].sort()) === JSON.stringify([...expected].sort()), `Bible « ${q} » : ${got.length} versets, identiques à la référence (${expected.length})`);
  }
  const expose = await loadExposeData();
  {
    const nq = normalizeText('Épouse');
    let expected = 0;
    for (const pg in expose?.pages || {}) for (const p of expose!.pages[pg].paragraphs) if (p.text && normalizeText(p.text).includes(nq)) expected++;
    const got = (await searchExpose('Épouse', SearchMode.EXACT_PHRASE)).length;
    check(got === expected, `Exposé « Épouse » : ${got} paragraphes, identiques à la référence (${expected})`);
  }

  // 2. Rapidité (médiane de 3 essais, index préparés)
  const cases: Array<[string, () => Promise<any[]>]> = [
    ['Bible LSG « Dieu » (phrase exacte)', () => searchBibleVersesAdvanced({ query: 'Dieu', mode: SearchMode.EXACT_PHRASE, limit: 10000, version: 'lsg1910' })],
    ['Bible LSG « agneau de Dieu »', () => searchBibleVersesAdvanced({ query: 'agneau de Dieu', mode: SearchMode.EXACT_PHRASE, limit: 10000, version: 'lsg1910' })],
    ['Bible LSG « grâce paix » (tous les mots)', () => searchBibleVersesAdvanced({ query: 'grâce paix', mode: SearchMode.EXACT_WORDS, limit: 10000, version: 'lsg1910' })],
    ['Bible KJV « faith »', () => searchBibleVersesAdvanced({ query: 'faith', mode: SearchMode.EXACT_PHRASE, limit: 10000, version: 'kjv' })],
    ['Exposé « Épouse »', () => searchExpose('Épouse', SearchMode.EXACT_PHRASE)],
    ['Exposé « septième sceau »', () => searchExpose('septième sceau', SearchMode.EXACT_WORDS)],
    ['Cantiques « Jésus »', () => searchSongs('Jésus', SearchMode.EXACT_PHRASE)],
    ['Cantiques « sang grâce » (au moins un mot)', () => searchSongs('sang grâce', SearchMode.DIVERSE)]
  ];
  for (const [label, fn] of cases) {
    const { ms, result } = await timeIt(fn);
    check(ms < THRESHOLD_MS, `${label} : ${result.length} résultats en ${ms.toFixed(0)} ms (seuil ${THRESHOLD_MS} ms)`);
  }

  console.log(`\n${passed} test(s) réussi(s)${failures ? `, ${failures} échec(s)` : ''}.`);
  if (failures) process.exit(1);
})();
