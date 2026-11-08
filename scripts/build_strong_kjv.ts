// Construit public/bible-strong-kjv.json (index Strong hors ligne de la King James Version)
// à partir des fichiers USFM du domaine public « eng-kjv2006 » (KJV 1769 + numéros Strong,
// Crosswire Bible Society / eBible.org : https://ebible.org/Scriptures/eng-kjv2006_usfm.zip).
// Format produit identique à bible-strong-lsg1910.json : { LIVRE: { chapitre: { verset: [[mot, strong], ...] } } }
// Usage : node scripts/run-ts.mjs scripts/build_strong_kjv.ts <dossier_usfm_décompressé>
import fs from 'fs';
import path from 'path';
import { isStrongFunctionWord } from '../utils/strongAlignment';

const srcDir = process.argv[2];
if (!srcDir || !fs.existsSync(srcDir)) {
  console.error('Usage : node scripts/run-ts.mjs scripts/build_strong_kjv.ts <dossier_usfm>');
  process.exit(1);
}

// H0430 -> H430, G0025 -> G25 (même notation que l'index LSG)
const normStrong = (s: string): string | null => {
  const m = String(s).trim().match(/^([HG])0*(\d+)([a-z]?)$/i);
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
};

const index: Record<string, Record<string, Record<string, Array<[string, string]>>>> = {};
let verseCount = 0;
let pairCount = 0;

for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith('.usfm')).sort()) {
  let content = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const idMatch = content.match(/\\id\s+([A-Z0-9]{3})/);
  if (!idMatch) continue;
  const book = idMatch[1];

  // Retirer notes de bas de page et renvois
  content = content.replace(/\\f\s[\s\S]*?\\f\*/g, ' ').replace(/\\x\s[\s\S]*?\\x\*/g, ' ');

  let chapter: string | null = null;
  const tokens = content.split(/(\\c\s+\d+|\\v\s+\d+)/);
  let currentVerse: string | null = null;
  const flush = (text: string) => {
    if (!chapter || !currentVerse) return;
    const pairs: Array<[string, string]> = [];
    const re = /\\\+?w\s+([^|\\]+)\|[^\\]*?strong="([^"]+)"[^\\]*?\\\+?w\*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const strongs = m[2].split(/[,\s]+/).map(normStrong).filter(Boolean);
      if (strongs.length === 0) continue;
      // Un mot balisé peut contenir plusieurs mots anglais (« the world », « he gave ») : seuls les mots
      // porteurs de sens reçoivent le numéro (articles, pronoms et auxiliaires écartés), sauf s'il n'y a qu'eux
      const tagged = m[1].trim().split(/\s+/).filter(Boolean);
      const content = tagged.length > 1 ? tagged.filter(w => !isStrongFunctionWord(w)) : tagged;
      for (const w of (content.length > 0 ? content : tagged)) pairs.push([w, strongs[0]]);
    }
    if (pairs.length === 0) return;
    index[book] ??= {};
    index[book][chapter] ??= {};
    const existing = index[book][chapter][currentVerse];
    index[book][chapter][currentVerse] = existing ? existing.concat(pairs) : pairs;
    verseCount += existing ? 0 : 1;
    pairCount += pairs.length;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const c = t.match(/^\\c\s+(\d+)$/);
    const v = t.match(/^\\v\s+(\d+)$/);
    if (c) { chapter = c[1]; currentVerse = null; continue; }
    if (v) { currentVerse = v[1]; continue; }
    flush(t);
  }
}

const out = path.resolve('public/bible-strong-kjv.json');
fs.writeFileSync(out, JSON.stringify(index));
console.log(`Livres : ${Object.keys(index).length}, versets : ${verseCount}, paires : ${pairCount}`);
console.log(`Écrit : ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} Mo)`);
