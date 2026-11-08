/**
 * Repérage rapide des mots couverts par une plage de caractères d'un texte découpé en mots.
 *
 * Le texte complet est la concaténation des mots (jetons) dans l'ordre. Les positions de début de
 * chaque mot sont calculées une seule fois ; pour une plage [début, fin[, une recherche dichotomique
 * trouve directement le premier mot concerné (au lieu de reparcourir le texte depuis le début pour
 * chaque correspondance, ce qui gelait l'application sur les longs sermons).
 */
export interface WordRangeIndex {
  starts: Int32Array; // position du premier caractère de chaque mot
  total: number;      // longueur totale du texte
}

export function buildWordRangeIndex(words: ReadonlyArray<{ text: string }>): WordRangeIndex {
  const starts = new Int32Array(words.length);
  let pos = 0;
  for (let i = 0; i < words.length; i++) {
    starts[i] = pos;
    pos += words[i].text.length;
  }
  return { starts, total: pos };
}

/**
 * Appelle `visit(i)` pour chaque mot i qui chevauche la plage [start, end[ (même règle que l'ancien
 * parcours : fin du mot > start et début du mot < end), dans l'ordre du texte.
 */
export function forEachWordInRange(index: WordRangeIndex, start: number, end: number, visit: (i: number) => void): void {
  const { starts, total } = index;
  const n = starts.length;
  if (n === 0 || end <= start) return;
  // Premier mot dont la fin dépasse `start` : dernier i tel que starts[i] <= start
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= start) lo = mid; else hi = mid - 1;
  }
  for (let i = lo; i < n; i++) {
    const wordStart = starts[i];
    if (wordStart >= end) break;
    const wordEnd = i + 1 < n ? starts[i + 1] : total;
    if (wordEnd > start) visit(i);
  }
}
