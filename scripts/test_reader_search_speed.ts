/**
 * King's Sword — Test de la recherche interne d'un sermon (lecteur)
 *
 * Sur le sermon le plus long de public/library.json, vérifie que le repérage des mots trouvés
 * (utils/wordRangeIndex) donne exactement les mêmes mots que l'ancien parcours, et qu'il reste
 * sous le seuil de temps, même pour une seule lettre (des dizaines de milliers de correspondances).
 * Usage : node scripts/run-ts.mjs scripts/test_reader_search_speed.ts   (inclus dans npm test)
 */
import fs from 'fs';
import { getAccentInsensitiveRegex } from '../utils/textUtils';
import { buildWordRangeIndex, forEachWordInRange } from '../utils/wordRangeIndex';

const THRESHOLD_MS = 50;
let failures = 0;
let passed = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { passed++; console.log(`✓ ${label}`); } else { failures++; console.log(`✗ ${label}`); }
};

const lib = JSON.parse(fs.readFileSync('public/library.json', 'utf8'));
const sermon = lib.reduce((a: any, b: any) => ((b.text || '').length > (a.text || '').length ? b : a));
// Même découpage que le lecteur : paragraphes, puis jetons (mots et espaces)
const words: { text: string; globalIndex: number }[] = [];
for (const seg of String(sermon.text).split(/\n\s*\n/)) for (const t of seg.split(/(\s+)/)) if (t !== '') words.push({ text: t, globalIndex: words.length });
const fullText = words.map(w => w.text).join('');
console.log(`Sermon : « ${sermon.title} » — ${fullText.length} caractères, ${words.length} jetons`);

// Ancien parcours (référence), limité aux recherches où il reste raisonnable
const oldSearch = (q: string) => {
  const regex = getAccentInsensitiveRegex(q, false);
  const starts: number[] = [];
  const all = new Set<number>();
  let m;
  while ((m = regex.exec(fullText)) !== null) {
    const s = m.index, e = m.index + m[0].length;
    let c = 0, first = true;
    for (let i = 0; i < words.length; i++) {
      const ws = c, we = c + words[i].text.length;
      if (we > s && ws < e) { all.add(words[i].globalIndex); if (first) { starts.push(words[i].globalIndex); first = false; } }
      c = we;
      if (ws >= e) break;
    }
    if (regex.lastIndex === m.index) regex.lastIndex++;
  }
  return { starts, all };
};

const index = buildWordRangeIndex(words);
const newSearch = (q: string) => {
  const regex = getAccentInsensitiveRegex(q, false);
  const starts: number[] = [];
  const all = new Set<number>();
  let m;
  while ((m = regex.exec(fullText)) !== null) {
    let first = true;
    forEachWordInRange(index, m.index, m.index + m[0].length, (i) => {
      all.add(words[i].globalIndex);
      if (first) { starts.push(words[i].globalIndex); first = false; }
    });
    if (regex.lastIndex === m.index) regex.lastIndex++;
  }
  return { starts, all };
};

// 1. Résultats identiques à l'ancien parcours
for (const q of ['Dieu', 'et', 'septième sceau', 'Christ', 'mystère de Dieu', 'Épouse']) {
  const a = oldSearch(q);
  const b = newSearch(q);
  const same = JSON.stringify(a.starts) === JSON.stringify(b.starts) && a.all.size === b.all.size && [...a.all].every(x => b.all.has(x));
  check(same, `« ${q} » : ${b.starts.length} résultats, ${b.all.size} mots surlignés, identiques à l'ancien calcul`);
}

// 2. Rapidité, y compris pour une seule lettre
for (const q of ['e', 'a', 'et', 'Dieu', 'septième sceau']) {
  const times: number[] = [];
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    n = newSearch(q).starts.length;
    times.push(performance.now() - t0);
  }
  const ms = times.sort((x, y) => x - y)[1];
  check(ms < THRESHOLD_MS, `« ${q} » : ${n} correspondances en ${ms.toFixed(1)} ms (seuil ${THRESHOLD_MS} ms)`);
}

console.log(`\n${passed} test(s) réussi(s)${failures ? `, ${failures} échec(s)` : ''}.`);
if (failures) process.exit(1);
