
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
 * Expression régulière détectant le début d'un paragraphe numéroté (ex: "1.", "1)", "[1]", "1 -", "E-1", "§1", "001.")
 */
export const NUMBERED_LINE_REGEX = /^(?:\[?\s*(\d+)\s*\]?|(\d+)[\.\)\:\-\s]|E-(\d+)|\§\s*(\d+))/i;

/**
 * Extrait le numéro de paragraphe explicite au début d'un texte s'il existe.
 */
export const extractLeadingParagraphNumber = (text: string): number | null => {
  if (!text) return null;
  const match = text.trim().match(/^(?:\[?\s*(\d+)\s*\]?|(\d+)[\.\)\:\-\s]|E-(\d+)|\§\s*(\d+))/i);
  if (match) {
    const raw = match[1] || match[2] || match[3] || match[4];
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
};

/**
 * Découpe robuste et intégrale d'un sermon en paragraphes sans tronquage :
 * - Gère les séparations standards par double saut de ligne (\n\n)
 * - Gère les sermons longs (500+ paragraphes) séparés par saut de ligne simple (\n) ou numérotés
 * - Préserve l'intégralité de chaque paragraphe et son ordre exact.
 */
export const splitSermonIntoParagraphs = (text: string, isSong = false): string[] => {
  if (!text) return [];

  // Pour les cantiques, découpage standard par strophes
  if (isSong) {
    return text.split(/\r?\n\s*\r?\n+/).map(s => s.trim()).filter(Boolean);
  }

  // Normalisation des fins de ligne
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const doubleBlocks = normalized.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  const singleLines = normalized.split('\n').map(s => s.trim()).filter(Boolean);
  const numberedCount = singleLines.filter(l => NUMBERED_LINE_REGEX.test(l)).length;

  // Si le texte n'a pas ou très peu de doubles sauts mais de nombreuses lignes numérotées
  if (doubleBlocks.length <= 5 && singleLines.length > doubleBlocks.length && numberedCount >= Math.min(singleLines.length * 0.3, 3)) {
    return splitByNumberedLines(singleLines);
  }

  // Raffinage des blocs doubles pour extraire d'éventuels paragraphes numérotés fusionnés
  const results: string[] = [];
  for (const block of doubleBlocks) {
    const blockLines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const blockNumberedCount = blockLines.filter(l => NUMBERED_LINE_REGEX.test(l)).length;

    if (blockLines.length > 1 && blockNumberedCount >= 2) {
      let currentSeg = '';
      for (const line of blockLines) {
        if (NUMBERED_LINE_REGEX.test(line)) {
          if (currentSeg.trim()) results.push(currentSeg.trim());
          currentSeg = line;
        } else {
          currentSeg = currentSeg ? currentSeg + '\n' + line : line;
        }
      }
      if (currentSeg.trim()) results.push(currentSeg.trim());
    } else {
      results.push(block);
    }
  }

  return results.length > 0 ? results : doubleBlocks;
};

function splitByNumberedLines(lines: string[]): string[] {
  const segments: string[] = [];
  let current = '';

  for (const line of lines) {
    if (NUMBERED_LINE_REGEX.test(line)) {
      if (current.trim()) segments.push(current.trim());
      current = line;
    } else if (current) {
      current += ' ' + line;
    } else {
      current = line;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments.length > 0 ? segments : lines;
}

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

