
const MAX_CACHE_SIZE = 500;
const normCache = new Map<string, string>();
const regexCache = new Map<string, RegExp>();
const multiWordCache = new Map<string, RegExp>();
const searchHighlightCache = new Map<string, RegExp>();

const ACCENT_MAP: Record<string, string> = {
  'a': '[aàáâãäå]',
  'e': '[eèéêë]',
  'i': '[iìíîï]',
  'o': '[oòóôõö]',
  'u': '[uùúûü]',
  'y': '[yýÿ]',
  'c': '[cç]',
  'n': '[nñ]',
};

const CHAR_INTER_PATTERN = "[^a-z0-9À-ÿ]*";
const PUNCTUATION_PATTERN = "[\\s.,;:!–?\"“”'()\\n\\r\\[\\]]+";

/**
 * Supprime les accents d'une chaîne de caractères et la met en minuscules.
 */
export const normalizeText = (str: string): string => {
  if (!str) return '';
  if (str.length < 100) {
    const cached = normCache.get(str);
    if (cached !== undefined) return cached;
  }
  const result = str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[;:“”"?!()]/g, "") // On préserve le point pour permettre la recherche de paragraphes "1."
    .replace(/\s+/g, ' ')
    .trim();

  if (str.length < 100) {
    if (normCache.size >= 1000) {
      const firstKey = normCache.keys().next().value;
      if (firstKey) normCache.delete(firstKey);
    }
    normCache.set(str, result);
  }
  return result;
};

/**
 * Construit un pattern regex pour un mot unique insensible aux accents.
 */
export const buildWordPattern = (word: string): string => {
  return word
    .toLowerCase()
    .split('')
    .map(char => ACCENT_MAP[char] || (/[a-z0-9]/.test(char) ? char : `\\${char}`))
    .join(CHAR_INTER_PATTERN);
};

/**
 * Construit un pattern regex pour une phrase insensible aux accents et à la ponctuation intermédiaire.
 */
export const buildPhrasePattern = (phrase: string): string => {
  const words = phrase.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';
  return words.map(w => buildWordPattern(w)).join(PUNCTUATION_PATTERN);
};

/**
 * Génère une expression régulière qui ignore les accents et la ponctuation intermédiaire.
 */
export const getAccentInsensitiveRegex = (query: string, isExactWord = false): RegExp => {
  if (!query || !query.trim()) return /(?!)/;
  const cacheKey = `acc_${isExactWord}_${query}`;
  if (regexCache.has(cacheKey)) {
    const cached = regexCache.get(cacheKey)!;
    cached.lastIndex = 0;
    return cached;
  }

  const pattern = buildPhrasePattern(query);
  if (!pattern) return /(?!)/;
    
  const reg = isExactWord
    ? new RegExp(`(?:^|[^a-z0-9À-ÿ])(${pattern})(?:$|[^a-z0-9À-ÿ])`, 'gi')
    : new RegExp(`(${pattern})`, 'gi');

  if (regexCache.size >= MAX_CACHE_SIZE) {
    const firstKey = regexCache.keys().next().value;
    if (firstKey) regexCache.delete(firstKey);
  }
  regexCache.set(cacheKey, reg);
  return reg;
};

/**
 * Génère une expression régulière adaptée pour le surlignage de recherche :
 * - Si isExactPhrase = true : surligne la phrase entière consécutive (ex: "le baptême") et non "le" ou "baptême" seuls.
 * - Si isExactPhrase = false : surligne chaque mot indépendamment (ex: "foi" et "amour").
 */
export const getSearchHighlightRegex = (
  terms: string | string[], 
  isExactPhrase: boolean = false
): RegExp => {
  const termList = Array.isArray(terms) ? terms : [terms];
  const cleanTerms = termList
    .map(t => (t || '').trim())
    .filter(t => t.length > 0);

  if (cleanTerms.length === 0) return /(?!)/;

  const cacheKey = `sh_${isExactPhrase}_${cleanTerms.join('||')}`;
  if (searchHighlightCache.has(cacheKey)) {
    const cached = searchHighlightCache.get(cacheKey)!;
    cached.lastIndex = 0;
    return cached;
  }

  let patterns: string[] = [];

  if (isExactPhrase) {
    // Mode phrase exacte : chaque terme est une phrase insécable
    for (const term of cleanTerms) {
      const p = buildPhrasePattern(term);
      if (p) patterns.push(p);
    }
  } else {
    // Mode multi-mots / mots indépendants
    const allWords = new Set<string>();
    for (const term of cleanTerms) {
      const parts = term.includes('|') ? term.split('|') : [term];
      for (const p of parts) {
        const words = p.trim().split(/\s+/).filter(w => w.length > 0);
        for (const w of words) {
          if (w.length > 0) allWords.add(w);
        }
      }
    }

    for (const w of allWords) {
      const p = buildWordPattern(w);
      if (p) patterns.push(p);
    }
  }

  if (patterns.length === 0) return /(?!)/;

  // Tri par longueur décroissante pour matcher d'abord les expressions les plus longues
  patterns.sort((a, b) => b.length - a.length);

  const reg = new RegExp(`(${patterns.join('|')})`, 'gi');

  if (searchHighlightCache.size >= MAX_CACHE_SIZE) {
    const firstKey = searchHighlightCache.keys().next().value;
    if (firstKey) searchHighlightCache.delete(firstKey);
  }
  searchHighlightCache.set(cacheKey, reg);
  return reg;
};

/**
 * Génère une expression régulière pour surligner plusieurs mots indépendamment (rétro-compatibilité).
 */
export const getMultiWordHighlightRegex = (query: string): RegExp => {
  if (!query || !query.trim()) return /(?!)/;
  if (multiWordCache.has(query)) {
    const cached = multiWordCache.get(query)!;
    cached.lastIndex = 0;
    return cached;
  }

  const terms = query.includes('|') ? query.split('|') : [query];
  const allWords = terms.flatMap(t => t.trim().split(/\s+/)).filter(w => w.length > 0);
  
  if (allWords.length === 0) return new RegExp(query, 'gi');

  const wordPatterns = allWords.map(word => buildWordPattern(word));
  wordPatterns.sort((a, b) => b.length - a.length);

  const reg = new RegExp(`(${wordPatterns.join('|')})`, 'gi');
  if (multiWordCache.size >= MAX_CACHE_SIZE) {
    const firstKey = multiWordCache.keys().next().value;
    if (firstKey) multiWordCache.delete(firstKey);
  }
  multiWordCache.set(query, reg);
  return reg;
};

/**
 * Fusionne les balises <mark> adjacentes pour créer un surlignage unifié sans rupture visuelle.
 */
export const mergeAdjacentMarks = (html: string): string => {
  if (!html || !html.includes('</mark>')) return html;
  // Fusionne <mark class="X">mot1</mark> <mark class="X">mot2</mark> -> <mark class="X">mot1 mot2</mark>
  let merged = html;
  let prev = '';
  while (merged !== prev) {
    prev = merged;
    merged = merged.replace(/<\/mark>([\s.,;:!–?\"“”'()\n\r]*?)<mark[^>]*>/gi, '$1');
  }
  return merged;
};
