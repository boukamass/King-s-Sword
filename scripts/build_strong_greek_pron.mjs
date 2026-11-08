// Construit public/strongs-greek-pronunciations.json (prononciation des numéros Strong grecs, hors ligne)
// à partir de « Strong's Greek Dictionary in XML with real Greek » (Ulrik Sandborg-Petersen, licence CC0 —
// domaine public) : https://github.com/morphgnt/strongs-dictionary-xml (strongsgreek.xml).
// Format : { "G4100": "pist-yoo'-o", ... }
// Usage : node scripts/build_strong_greek_pron.mjs <chemin/vers/strongsgreek.xml>
import fs from 'fs';
import path from 'path';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage : node scripts/build_strong_greek_pron.mjs <strongsgreek.xml>');
  process.exit(1);
}

const xml = fs.readFileSync(src, 'utf8');
const out = {};
const re = /<entry strongs="0*(\d+)">[\s\S]*?<pronunciation strongs="([^"]*)"\s*\/>/g;
let m;
while ((m = re.exec(xml)) !== null) {
  const pron = m[2].trim();
  if (pron) out[`G${parseInt(m[1], 10)}`] = pron;
}

const outFile = path.resolve('public/strongs-greek-pronunciations.json');
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${Object.keys(out).length} prononciations grecques → ${outFile} (${(fs.statSync(outFile).size / 1e3).toFixed(0)} ko)`);
console.log('Exemples :', ['G4100', 'G26', 'G3056', 'G5547'].map(k => `${k} [${out[k]}]`).join(', '));
