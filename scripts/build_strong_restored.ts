// Construit public/bible-strong-restored.json : numéros Strong absents des index LSG et Darby, rétablis
// d'après la KJV (index complet du texte original). Exemple : Genèse 6:5, « toutes les pensées de leur
// cœur » — la LSG rend « yetser machshevot » (H3336 + H4284) par le seul mot « pensées » et l'index LSG
// ne gardait que H4284 ; H3336 est rétabli sur « pensées » (et sur « imagination » en Darby).
//
// Règles :
//  - verset traité seulement si sa numérotation correspond à la KJV (au moins 60 % des numéros du verset
//    français présents dans le même verset KJV) : les décalages de numérotation (Psaumes, Daniel…) sont ignorés ;
//  - H853 (marqueur d'objet hébreu) et G3588 (article grec) ne sont pas rétablis (pas de mot français propre) ;
//  - placement : repères = numéros voisins dans la KJV présents dans le verset français. S'il y a entre eux
//    exactement un mot porteur de sens sans numéro, il reçoit le numéro ; sinon le numéro est rattaché au mot
//    du repère voisin (paire marquée « avant:Hxxx » ou « apres:Hxxx »), qui porte alors deux numéros.
// Les fichiers d'index d'origine ne sont pas modifiés : ce fichier ne contient que les versets complétés
// (liste complète des paires du verset), fusionnés au chargement.
// Usage : node scripts/run-ts.mjs scripts/build_strong_restored.ts
import fs from 'fs';
import path from 'path';
import { alignVerseStrongsDetailed, buildStrongFormsDictionary, isStrongFunctionWord, normalizeStrongWord, StrongPair } from '../utils/strongAlignment';

type StrongIndex = Record<string, Record<string, Record<string, StrongPair[]>>>;
type BibleText = Record<string, Record<string, Array<{ verse: number; text: string }>>>;

const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.resolve('public', f), 'utf8'));
const kjv = read<StrongIndex>('bible-strong-kjv.json');
const EXCLUDED = new Set(['H853', 'G3588']);
const MIN_OVERLAP = 0.6;

// Mots français qui ne reçoivent jamais seuls un numéro rétabli (quantificateurs, adverbes, liaisons)
const NEVER_ALONE = new Set(['tout', 'toute', 'tous', 'toutes', 'meme', 'memes', 'plus', 'tres', 'bien', 'ainsi', 'alors', 'aussi',
  'encore', 'donc', 'car', 'mais', 'comme', 'quand', 'lorsque', 'puis', 'vers', 'apres', 'avant', 'entre', 'contre', 'selon', 'afin',
  'point', 'jamais', 'rien', 'chaque', 'quelques', 'quelque', 'autre', 'autres', 'leur', 'leurs', 'cela', 'ceci', 'celle', 'ceux', 'voici']);

const isContentToken = (t: string) => {
  const n = normalizeStrongWord(t);
  const parts = t.split(/[’'‘]/).map(normalizeStrongWord).filter(Boolean);
  const core = parts.length > 1 ? parts[parts.length - 1] : n;
  return n.length >= 3 && core.length >= 3 && !/^\d+$/.test(n) && !isStrongFunctionWord(t) && !isStrongFunctionWord(core) && !NEVER_ALONE.has(core);
};

// Le numéro KJV n'est rétabli que s'il traduit un mot porteur de sens en anglais (pas « and », « but »,
// « was », « him », « your »… : ces mots du texte original sont souvent volontairement non traduits)
const isContentKjvWord = (w: string) => {
  const n = normalizeStrongWord(w);
  return n.length >= 3 && !isStrongFunctionWord(w) && !KJV_FUNCTION_WORDS.has(n);
};
const KJV_FUNCTION_WORDS = new Set(['but', 'for', 'nor', 'yet', 'also', 'even', 'then', 'thus', 'there', 'here', 'this', 'that', 'these',
  'those', 'what', 'when', 'where', 'whom', 'whose', 'which', 'while', 'with', 'without', 'among', 'about', 'against', 'before', 'after',
  'unto', 'upon', 'into', 'from', 'over', 'under', 'through', 'shall', 'should', 'would', 'could', 'might', 'must', 'being', 'been',
  'himself', 'herself', 'itself', 'themselves', 'yourselves', 'ourselves', 'myself', 'thyself', 'mine', 'thine', 'theirs', 'ours',
  'every', 'any', 'all', 'some', 'such', 'same', 'other', 'another', 'not', 'nothing', 'none', 'neither', 'either', 'only', 'very',
  'more', 'most', 'now', 'again', 'because', 'therefore', 'wherefore', 'whether', 'though', 'although', 'until', 'till', 'since',
  'than', 'how', 'why', 'who', 'they', 'them', 'their', 'thee', 'thou', 'thy', 'your', 'you', 'ye', 'his', 'her', 'him', 'she',
  'are', 'was', 'were', 'hath', 'hast', 'doth', 'did', 'does', 'have', 'had', 'has', 'will', 'wilt', 'may', 'can', 'let', 'cometh']);

// Preuves : un numéro n'est rétabli sur un mot que si (1) ce mot français traduit ce numéro ailleurs dans
// la Bible (index LSG ou Darby), ou (2) il est apparenté au mot anglais de la KJV (imagination ↔ imagination),
// ou (3) il s'agit du même nom propre (Akhikam ↔ Ahikam). Sans preuve, rien n'est rétabli.
const evidence = new Map<string, Set<string>>();
for (const f of ['bible-strong-lsg1910.json', 'bible-strong-darby.json']) {
  const idx = read<StrongIndex>(f);
  for (const chapters of Object.values(idx)) for (const verses of Object.values(chapters)) for (const pairs of Object.values(verses)) {
    for (const [w, s] of pairs) {
      const parts = (w || '').split(/[’'‘]/).map(normalizeStrongWord).filter(Boolean);
      for (const form of new Set([normalizeStrongWord(w), parts[parts.length - 1] || ''])) {
        if (!form || form.length < 3) continue;
        let set = evidence.get(form);
        if (!set) evidence.set(form, (set = new Set()));
        set.add(s);
      }
    }
  }
}
const coreForm = (t: string) => {
  const parts = (t || '').split(/[’'‘]/).map(normalizeStrongWord).filter(Boolean);
  return parts[parts.length - 1] || normalizeStrongWord(t);
};
const hasProof = (frenchToken: string, strong: string, kjvWord: string): boolean => {
  const core = coreForm(frenchToken);
  if (evidence.get(core)?.has(strong) || evidence.get(normalizeStrongWord(frenchToken))?.has(strong)) return true;
  const en = normalizeStrongWord(kjvWord);
  if (core.length >= 5 && en.length >= 5) {
    let pre = 0;
    while (pre < Math.min(core.length, en.length) && core[pre] === en[pre]) pre++;
    if (pre >= 5) return true; // apparentés (imagination, adversaire/adversary…)
  }
  const frCap = /^[A-ZÀ-Ý]/.test(frenchToken.replace(/^[«"“(\[]+/, '').replace(/^(?:l|d|qu)['’]/i, ''));
  const enCap = /^[A-Z]/.test(kjvWord) && kjvWord !== kjvWord.toUpperCase();
  if (frCap && enCap && core.length >= 3 && en.length >= 3 && core.slice(0, 2) === en.slice(0, 2)) return true; // même nom propre
  return false;
};

const out: Record<string, StrongIndex> = {};
for (const [ver, indexFile, textFile] of [['lsg1910', 'bible-strong-lsg1910.json', 'bible-lsg1910.json'], ['darby', 'bible-strong-darby.json', 'bible-darby.json']] as const) {
  const index = read<StrongIndex>(indexFile);
  const text = read<BibleText>(textFile);
  const forms = buildStrongFormsDictionary(index);
  const res: StrongIndex = {};
  let versesChecked = 0, versesSkipped = 0, versesChanged = 0, ownWord = 0, anchoredCount = 0;

  for (const [B, chapters] of Object.entries(index)) {
    for (const [C, verses] of Object.entries(chapters)) {
      for (const [V, frPairs] of Object.entries(verses)) {
        const kPairs = kjv[B]?.[C]?.[V];
        const verseObj = text[B]?.[C]?.find(v => String(v.verse) === V);
        if (!kPairs || !verseObj || frPairs.length === 0) continue;
        versesChecked++;
        const frSet = new Set(frPairs.map(p => p[1]));
        const kSeq = kPairs.map(p => p[1]);
        const kSet = new Set(kSeq);
        const common = [...frSet].filter(s => kSet.has(s)).length;
        if (frSet.size < 2 || common / frSet.size < MIN_OVERLAP) { versesSkipped++; continue; }
        const missing = [...new Set(kSeq)].filter(s => !frSet.has(s) && !EXCLUDED.has(s)
          && kPairs.some(p => p[1] === s && isContentKjvWord(p[0])));
        if (missing.length === 0) continue;

        const tokens = (verseObj.text || '').split(/\s+/).filter(Boolean);
        const tokPair = alignVerseStrongsDetailed(tokens, frPairs, forms);
        // Numéros d'origine par mot (repères) ; tokStrong reçoit en plus les numéros rétablis sur un mot
        const origStrong: (string | null)[] = tokPair.map(p => (p >= 0 ? frPairs[p][1] : null));
        const tokStrong: (string | null)[] = [...origStrong];
        const insertions: Array<{ afterPair: number; pair: StrongPair }> = [];

        for (const M of missing) {
          const m = kSeq.indexOf(M);
          // Repères : numéros voisins dans la KJV portés (d'origine) par un mot du verset français
          let nIdx = -1, pIdx = -1;
          for (let k = m + 1; k < kSeq.length; k++) if (origStrong.includes(kSeq[k])) { nIdx = k; break; }
          for (let k = m - 1; k >= 0; k--) if (origStrong.includes(kSeq[k])) { pIdx = k; break; }
          if (nIdx < 0 && pIdx < 0) continue;
          const N = nIdx >= 0 ? kSeq[nIdx] : null;
          const P = pIdx >= 0 ? kSeq[pIdx] : null;
          const posN = N ? origStrong.indexOf(N) : -1;
          let posP = -1;
          if (P) {
            for (let k = origStrong.length - 1; k >= 0; k--) if (origStrong[k] === P && (posN < 0 || k < posN)) { posP = k; break; }
            if (posP < 0) posP = origStrong.indexOf(P);
          }
          const lo = posP >= 0 ? posP + 1 : Math.max(0, posN - 3);
          const hi = posN >= 0 ? posN - 1 : Math.min(tokens.length - 1, posP + 3);
          const kjvWord = (kPairs.find(p => p[1] === M && isContentKjvWord(p[0])) || kPairs.find(p => p[1] === M) || ['', ''])[0];
          const candidates: number[] = [];
          for (let k = lo; k <= hi; k++) if (tokStrong[k] === null && isContentToken(tokens[k])) candidates.push(k);
          // Mot sans numéro entre les repères : seulement s'il y en a un seul et qu'il est prouvé
          const proven = candidates.filter(k => hasProof(tokens[k], M, kjvWord));

          if (candidates.length === 1 && proven.length === 1) {
            const k = proven[0];
            tokStrong[k] = M;
            const after = posP >= 0 ? tokPair[posP] : (posN >= 0 ? tokPair[posN] - 1 : frPairs.length - 1);
            insertions.push({ afterPair: after, pair: [tokens[k], M] });
            ownWord++;
          } else if (proven.length === 0) {
            // Rattachement au mot d'un repère voisin (le plus proche dans la KJV d'abord), s'il est prouvé
            const order = posN >= 0 && (posP < 0 || nIdx - m <= m - pIdx) ? ['next', 'prev'] : ['prev', 'next'];
            for (const side of order) {
              const pos = side === 'next' ? posN : posP;
              if (pos < 0) continue;
              if (!hasProof(tokens[pos], M, kjvWord) && !hasProof(frPairs[tokPair[pos]][0], M, kjvWord)) continue;
              const anchorStrong = side === 'next' ? N! : P!;
              const pairIdx = tokPair[pos];
              insertions.push({ afterPair: side === 'next' ? pairIdx - 1 : pairIdx, pair: [frPairs[pairIdx][0], M, `${side === 'next' ? 'avant' : 'apres'}:${anchorStrong}`] });
              anchoredCount++;
              break;
            }
          }
        }
        if (insertions.length === 0) continue;
        const newPairs: StrongPair[] = [...frPairs];
        insertions.sort((a, b) => b.afterPair - a.afterPair).forEach(ins => newPairs.splice(ins.afterPair + 1, 0, ins.pair));
        res[B] ??= {};
        res[B][C] ??= {};
        res[B][C][V] = newPairs;
        versesChanged++;
      }
    }
  }
  out[ver] = res;
  console.log(`${ver} : ${versesChecked} versets comparés, ${versesSkipped} écartés (numérotation différente), ${versesChanged} complétés — ${ownWord} numéros sur un mot sans numéro, ${anchoredCount} rattachés au mot voisin`);
}

const outFile = path.resolve('public/bible-strong-restored.json');
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`Écrit : ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} Mo)`);
