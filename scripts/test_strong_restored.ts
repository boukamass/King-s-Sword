/**
 * King's Sword — Test des numéros Strong rétablis d'après la KJV (public/bible-strong-restored.json)
 * Usage : node scripts/run-ts.mjs scripts/test_strong_restored.ts   (inclus dans npm test)
 */
import fs from 'fs';
import path from 'path';

(globalThis as any).fetch = async (url: string) => {
  const p = path.resolve('public', String(url).split('?')[0].replace(/^.*\//, ''));
  const t = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  return { ok: !!t, status: t ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => JSON.parse(t), text: async () => t };
};

let failures = 0;
let passed = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { passed++; console.log(`✓ ${label}`); } else { failures++; console.log(`✗ ${label}`); }
};

(async () => {
  const { getVersionChapterStrongs, findBibleOccurrences } = await import('../services/bibleExegesisService');
  const { alignVerseStrongsMulti } = await import('../utils/strongAlignment');

  const wordStrongs = async (version: string, word: string) => {
    const bible = JSON.parse(fs.readFileSync(path.resolve('public', `bible-${version}.json`), 'utf8'));
    const d = await getVersionChapterStrongs('GEN', '6', version);
    const tokens: string[] = bible.GEN['6'][4].text.split(/\s+/).filter(Boolean);
    const aligned = alignVerseStrongsMulti(tokens, d!.verses['5'], d!.forms);
    const idx = tokens.findIndex(t => t.includes(word));
    return idx >= 0 ? aligned[idx] || [] : [];
  };

  const lsg = await wordStrongs('lsg1910', 'pensées');
  check(lsg.includes('H3336') && lsg.includes('H4284'), `LSG Genèse 6:5 « pensées » : ${lsg.join(' + ')} (attendu H3336 + H4284)`);
  const darby = await wordStrongs('darby', 'imagination');
  check(darby.includes('H3336'), `DARBY Genèse 6:5 « l'imagination » : ${darby.join(' + ')} (attendu H3336)`);
  const occ = await findBibleOccurrences('', 'lsg1910', 'H3336');
  check(occ.some((o: any) => o.bookId === 'GEN' && o.chapter === 6 && o.verse === 5), `Occurrences LSG de H3336 : Genèse 6:5 présente (${occ.length} versets)`);

  console.log(`\n${passed} test(s) réussi(s)${failures ? `, ${failures} échec(s)` : ''}.`);
  if (failures) process.exit(1);
})();
