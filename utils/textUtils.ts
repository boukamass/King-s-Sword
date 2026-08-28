
const MAX_CACHE_SIZE = 500;
const normCache = new Map<string, string>();
const regexCache = new Map<string, RegExp>();
const multiWordCache = new Map<string, RegExp>();

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

  const map: Record<string, string> = {
    'a': '[aàáâãäå]',
    'e': '[eèéêë]',
    'i': '[iìíîï]',
    'o': '[oòóôõö]',
    'u': '[uùúûü]',
    'y': '[yýÿ]',
    'c': '[cç]',
    'n': '[nñ]',
  };
  
  // Motif optionnel pour les caractères non-alphanumériques entre les lettres
  const charInterPattern = "[^a-z0-9À-ÿ]*";
  const punctuationPattern = "[\\s.,;:!–?\"“”'()\\n\\r\\[\\]]+";
  
  const pattern = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map(word => 
      word.split('').map(char => map[char] || (/[a-z0-9]/.test(char) ? char : `\\${char}`)).join(charInterPattern)
    )
    .join(punctuationPattern);
    
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
 * Génère une expression régulière pour surligner plusieurs mots indépendamment.
 */
export const getMultiWordHighlightRegex = (query: string): RegExp => {
  if (!query || !query.trim()) return /(?!)/;
  if (multiWordCache.has(query)) {
    const cached = multiWordCache.get(query)!;
    cached.lastIndex = 0;
    return cached;
  }

  // Si la requête contient déjà des |, on les sépare d'abord pour ne pas casser le split par espace
  const terms = query.includes('|') ? query.split('|') : [query];
  const allWords = terms.flatMap(t => t.trim().split(/\s+/)).filter(w => w.length > 0);
  
  if (allWords.length === 0) return new RegExp(query, 'gi');

  const map: Record<string, string> = {
    'a': '[aàáâãäå]',
    'e': '[eèéêë]',
    'i': '[iìíîï]',
    'o': '[oòóôõö]',
    'u': '[uùúûü]',
    'y': '[yýÿ]',
    'c': '[cç]',
    'n': '[nñ]',
  };

  const charInterPattern = "[^a-z0-9À-ÿ]*";

  const wordPatterns = allWords.map(word => {
    return word.toLowerCase().split('').map(char => map[char] || (/[a-z0-9]/.test(char) ? char : `\\${char}`)).join(charInterPattern);
  });

  // Tri par longueur décroissante pour éviter que "chaton" soit matché par "chat" partiellement si les deux sont présents
  wordPatterns.sort((a, b) => b.length - a.length);

  const reg = new RegExp(`(${wordPatterns.join('|')})`, 'gi');
  if (multiWordCache.size >= MAX_CACHE_SIZE) {
    const firstKey = multiWordCache.keys().next().value;
    if (firstKey) multiWordCache.delete(firstKey);
  }
  multiWordCache.set(query, reg);
  return reg;
};
