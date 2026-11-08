/**
 * Alignement hors ligne des mots d'un verset avec ses numéros Strong.
 *
 * Utilisé par le lecteur biblique (affichage des numéros Strong) et par le script
 * de construction de l'index Darby (scripts/build_strong_darby.ts).
 *
 * Principe :
 *  1. Alignement ordonné (programmation dynamique) entre les mots du verset et les paires
 *     [mot, strong] de l'index : maximise les correspondances en respectant l'ordre du texte.
 *  2. Second passage : un mot porteur de sens resté sans numéro reçoit le numéro d'une paire
 *     du même verset dont le mot est identique ou de même racine (mots répétés, ordre inversé).
 *     Les articles, liaisons et mots grammaticaux sont exclus de ce second passage.
 *
 * Un numéro n'est jamais inventé : il provient toujours des paires du verset.
 */

export type StrongPair = [string, string];

/** Mots grammaticaux (articles, liaisons, prépositions…) exclus du second passage */
const FUNCTION_WORDS = new Set([
  // Français
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'au', 'aux', 'a', 'et', 'ou', 'en', 'y',
  'que', 'qu', 'qui', 'ne', 'n', 'pas', 'se', 's', 'ce', 'c', 'ces', 'cet', 'cette', 'sa', 'son', 'ses',
  'par', 'pour', 'sur', 'dans', 'avec', 'sans', 'sous', 'vers', 'chez', 'est', 'il', 'elle', 'on', 'j', 'm', 't',
  // Français : pronoms, possessifs et auxiliaires (souvent inclus dans le verbe ou le nom en hébreu/grec)
  'je', 'tu', 'ils', 'elles', 'vous', 'nous', 'lui', 'leur', 'leurs', 'mon', 'ton', 'ma', 'ta', 'mes', 'tes',
  'me', 'te', 'toi', 'moi', 'eux', 'votre', 'vos', 'notre', 'nos', 'ni', 'si', 'lequel', 'laquelle', 'lesquels',
  'duquel', 'auquel', 'dont', 'dun', 'dune', 'lun', 'lune', 'quun', 'quune', 'ceux', 'celui', 'celle', 'celles', 'cest', 'quil', 'quils', 'quelle', 'jai',
  'ai', 'as', 'avons', 'avez', 'ont', 'avait', 'avais', 'avaient', 'eu', 'suis', 'es', 'sommes', 'etes', 'sont',
  'etait', 'etais', 'etaient', 'fut', 'furent', 'ete', 'sera', 'seras', 'serez', 'seront', 'serai', 'soit', 'sois', 'soient',
  // Anglais
  'the', 'of', 'an', 'and', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'that', 'is', 'it',
  'be', 'as', 'or', 'which', 'unto', 'upon', 'into', 'shall', 'hath', 'had', 'his', 'her', 'their', 'them', 'they',
  // Anglais : pronoms, possessifs et auxiliaires
  'he', 'she', 'thou', 'thee', 'thy', 'thine', 'ye', 'you', 'your', 'me', 'my', 'mine', 'we', 'us', 'our', 'i',
  'him', 'hers', 'its', 'whom', 'whose', 'who', 'was', 'were', 'are', 'am', 'art', 'been', 'will', 'wilt',
  'have', 'hast', 'has', 'shalt', 'do', 'did', 'doth', 'dost', 'would', 'should', 'could', 'may', 'might'
]);

/** Normalise un mot : minuscules, sans accents, lettres et chiffres uniquement */
export const normalizeStrongWord = (text: string): string =>
  (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Vrai si le mot est un mot grammatical (article, liaison, pronom, auxiliaire) */
export const isStrongFunctionWord = (text: string): boolean => FUNCTION_WORDS.has(normalizeStrongWord(text));

/** Formes d'un mot : entier, puis ses parties séparées par apostrophe ou trait d'union (l’instruire → instruire) */
const wordVariants = (text: string): string[] => {
  const full = normalizeStrongWord(text);
  const parts = (text || '').split(/[’'‘\-]/).map(normalizeStrongWord).filter(p => p.length > 0);
  const out = [full];
  for (const p of parts) if (p !== full && !out.includes(p)) out.push(p);
  return out.filter(Boolean);
};

const commonPrefixLength = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
};

/**
 * Score de correspondance entre un mot du texte et le mot d'une paire Strong.
 * 3 = identique, 2 = même racine, 1 = seule la partie élidée grammaticale correspond (l’, qu’…),
 * 0 = aucune correspondance. Le mot porteur de sens est ainsi préféré à l'article élidé.
 * `forms` (optionnel) : dictionnaire forme → numéros Strong connus (traductions sœurs, ex. Darby ↔ LSG).
 */
const matchScore = (variants: string[], pairWord: string, strong: string, forms?: Map<string, Set<string>>): number => {
  const cp = normalizeStrongWord(pairWord);
  if (variants.length === 0) return 0;
  let best = 0;
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    if (!v) continue;
    if (cp && v === cp) {
      if (vi > 0 && FUNCTION_WORDS.has(v)) { best = Math.max(best, 1); continue; }
      return 3;
    }
    if (cp && cp.length >= 3 && v.length >= 3) {
      const pre = commonPrefixLength(v, cp);
      if (pre >= 4 && pre >= Math.ceil(Math.min(v.length, cp.length) * 0.6)) best = Math.max(best, 2);
      else if (cp.length >= 4 && (v.endsWith(cp) || cp.endsWith(v)) && Math.min(v.length, cp.length) >= 4) best = Math.max(best, 2);
    }
    if (forms && v.length >= 3 && !FUNCTION_WORDS.has(v) && forms.get(v)?.has(strong)) best = Math.max(best, 2);
  }
  return best;
};

/**
 * Construit le dictionnaire forme → numéros Strong à partir d'un index complet
 * ({ LIVRE: { chapitre: { verset: [[mot, strong]] } } }). Une association n'est retenue
 * que si elle apparaît au moins `minCount` fois dans l'index et représente au moins
 * `minShare` des emplois de cette forme (élimine les étiquetages isolés ou erronés).
 */
export function buildStrongFormsDictionary(
  index: Record<string, Record<string, Record<string, StrongPair[]>>>,
  minCount = 3,
  minShare = 0.05
): Map<string, Set<string>> {
  const counts = new Map<string, Map<string, number>>();
  const add = (form: string, strong: string) => {
    if (!form || form.length < 3 || FUNCTION_WORDS.has(form)) return;
    let m = counts.get(form);
    if (!m) counts.set(form, (m = new Map()));
    m.set(strong, (m.get(strong) || 0) + 1);
  };
  for (const chapters of Object.values(index || {})) {
    for (const verses of Object.values(chapters || {})) {
      for (const pairs of Object.values(verses || {})) {
        for (const [word, strong] of pairs || []) {
          const full = normalizeStrongWord(word);
          add(full, strong);
          for (const part of (word || '').split(/[’'‘\-]/)) {
            const p = normalizeStrongWord(part);
            if (p !== full) add(p, strong);
          }
        }
      }
    }
  }
  const forms = new Map<string, Set<string>>();
  counts.forEach((m, form) => {
    const set = new Set<string>();
    let total = 0;
    m.forEach(c => { total += c; });
    m.forEach((c, strong) => { if (c >= minCount && c / total >= minShare) set.add(strong); });
    if (set.size > 0) forms.set(form, set);
  });
  return forms;
}

/**
 * Aligne les mots d'un verset (jetons tels qu'affichés) avec ses paires Strong.
 * Retourne, pour chaque mot, son numéro Strong ou null.
 */
export function alignVerseStrongs(
  words: string[],
  pairs: StrongPair[],
  forms?: Map<string, Set<string>>
): (string | null)[] {
  const result: (string | null)[] = new Array(words.length).fill(null);
  if (!pairs || pairs.length === 0 || words.length === 0) return result;

  const variants = words.map(w => wordVariants(w));
  const n = words.length;
  const m = pairs.length;

  // 1. Alignement ordonné pondéré (programmation dynamique)
  const scores: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(m);
    for (let j = 0; j < m; j++) row[j] = matchScore(variants[i], pairs[j][0], pairs[j][1], forms);
    scores.push(row);
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let best = Math.max(dp[i + 1][j], dp[i][j + 1]);
      const s = scores[i][j];
      if (s > 0) best = Math.max(best, s + dp[i + 1][j + 1]);
      dp[i][j] = best;
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = scores[i][j];
    if (s > 0 && dp[i][j] === s + dp[i + 1][j + 1]) {
      result[i] = pairs[j][1];
      i++;
      j++;
    } else if (dp[i][j] === dp[i + 1][j]) {
      i++;
    } else {
      j++;
    }
  }

  // 2. Second passage : mots porteurs de sens restés sans numéro
  for (let k = 0; k < n; k++) {
    if (result[k]) continue;
    const full = variants[k][0];
    if (!full || full.length < 2 || /^\d+$/.test(full) || FUNCTION_WORDS.has(full)) continue;
    let bestScore = 0;
    let bestStrong: string | null = null;
    for (let p = 0; p < m; p++) {
      const s = scores[k][p];
      if (s > bestScore) {
        bestScore = s;
        bestStrong = pairs[p][1];
      }
    }
    if (bestStrong && bestScore >= 2) result[k] = bestStrong;
  }

  return result;
}
