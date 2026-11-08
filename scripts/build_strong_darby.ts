// Construit public/bible-strong-darby.json (index Strong hors ligne de la Bible Darby française)
// à partir de l'index certifié Louis Segond (public/bible-strong-lsg1910.json) et du texte Darby
// (public/bible-darby.json). Chaque verset Darby est aligné sur les numéros Strong du même verset LSG
// (même texte original grec/hébreu), à l'aide d'un dictionnaire forme française → numéros Strong
// tiré de l'index LSG. Aucun numéro n'est inventé : il provient toujours du verset LSG correspondant.
// Format produit identique à l'index LSG : { LIVRE: { chapitre: { verset: [[mot, strong], ...] } } }
// Usage : node scripts/run-ts.mjs scripts/build_strong_darby.ts
import fs from 'fs';
import path from 'path';
import { alignVerseStrongs, buildStrongFormsDictionary, StrongPair } from '../utils/strongAlignment';

type StrongIndex = Record<string, Record<string, Record<string, StrongPair[]>>>;
type BibleText = Record<string, Record<string, Array<{ verse: number; text: string }>>>;

const lsgIndex: StrongIndex = JSON.parse(fs.readFileSync(path.resolve('public/bible-strong-lsg1910.json'), 'utf8'));
const darby: BibleText = JSON.parse(fs.readFileSync(path.resolve('public/bible-darby.json'), 'utf8'));

// Dictionnaire des formes françaises : mot (normalisé, et ses parties élidées) → numéros Strong
const forms = buildStrongFormsDictionary(lsgIndex, 2, 0.02);

const out: StrongIndex = {};
let verseCount = 0;
let pairCount = 0;
let wordCount = 0;

for (const [book, chapters] of Object.entries(darby)) {
  for (const [chapter, verses] of Object.entries(chapters)) {
    for (const v of verses) {
      const lsgPairs = lsgIndex[book]?.[chapter]?.[String(v.verse)];
      const tokens = (v.text || '').split(/\s+/).filter(Boolean);
      wordCount += tokens.length;
      if (!lsgPairs || lsgPairs.length === 0) continue;
      const aligned = alignVerseStrongs(tokens, lsgPairs, forms);
      const pairs: StrongPair[] = [];
      aligned.forEach((strong, idx) => {
        if (strong) pairs.push([tokens[idx], strong]);
      });
      if (pairs.length === 0) continue;
      out[book] ??= {};
      out[book][chapter] ??= {};
      out[book][chapter][String(v.verse)] = pairs;
      verseCount++;
      pairCount += pairs.length;
    }
  }
}

const outFile = path.resolve('public/bible-strong-darby.json');
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`Livres : ${Object.keys(out).length}, versets : ${verseCount}, mots numérotés : ${pairCount} / ${wordCount}`);
console.log(`Écrit : ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} Mo)`);
