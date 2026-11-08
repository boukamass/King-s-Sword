/**
 * Présentation commune de l'en-tête d'un numéro Strong : mot original · translittération · [prononciation]
 * (ex. « יֵצֶר  Yetser  [yay'-tser] », « πιστεύω  Pisteuo  [pist-yoo'-o] »).
 * Utilisée par la fenêtre Strong, les fiches Strong des notes, leur copie et l'export Word.
 */
export interface StrongHeadline {
  lemma: string;        // mot original (hébreu / grec), sans la translittération entre parenthèses
  simplified: string;   // translittération simplifiée (sans accents), avec majuscule : « Yetser »
  scholarly: string;    // translittération savante du lexique : « yêtser »
  pronunciation: string; // prononciation à afficher entre crochets (vide si identique à la translittération)
}

export function getStrongHeadline(entry: { original?: string | null; transliteration?: string | null; pronunciation?: string | null }): StrongHeadline {
  const rawOriginal = String(entry.original || '').trim();
  const parenthetical = rawOriginal.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || '';
  const lemma = rawOriginal.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawOriginal;
  let scholarly = String(entry.transliteration || parenthetical || '').trim();
  let pron = String(entry.pronunciation || '').trim();
  // Anciennes fiches de notes : la translittération était parfois enregistrée à la place de la prononciation
  // (« pisteúō ») ; une prononciation de Strong comporte des traits d'union ou des apostrophes (« pist-yoo'-o »)
  if (!scholarly && pron && !/[-'’]/.test(pron)) {
    scholarly = pron;
    pron = '';
  }
  const simplified = scholarly
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʼʻ’'`]/g, '')
    .replace(/^./, c => c.toUpperCase());
  const same = !pron || pron.toLowerCase() === scholarly.toLowerCase() || pron.toLowerCase() === simplified.toLowerCase();
  return { lemma, simplified, scholarly, pronunciation: same ? '' : pron };
}

/** Version texte : « יֵצֶר  Yetser  [yay'-tser] » */
export function formatStrongHeadline(entry: { original?: string | null; transliteration?: string | null; pronunciation?: string | null }): string {
  const h = getStrongHeadline(entry);
  return [h.lemma, h.simplified, h.pronunciation ? `[${h.pronunciation}]` : ''].filter(Boolean).join('  ');
}
