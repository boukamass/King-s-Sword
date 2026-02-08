
/**
 * Supprime les accents d'une chaîne de caractères et la met en minuscules.
 */
export const normalizeText = (str: string): string => {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[;:“”"?!()]/g, "") // On préserve le point pour permettre la recherche de paragraphes "1."
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Génère une expression régulière qui ignore les accents et la ponctuation intermédiaire.
 */
export const getAccentInsensitiveRegex = (query: string, isExactWord = false): RegExp => {
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
    
  if (isExactWord) {
    return new RegExp(`(?:^|[^a-z0-9À-ÿ])(${pattern})(?:$|[^a-z0-9À-ÿ])`, 'gi');
  }
  return new RegExp(`(${pattern})`, 'gi');
};

/**
 * Génère une expression régulière pour surligner plusieurs mots indépendamment.
 */
export const getMultiWordHighlightRegex = (query: string): RegExp => {
  const words = query.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return new RegExp(query, 'gi');

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

  const wordPatterns = words.map(word => {
    return word.toLowerCase().split('').map(char => map[char] || (/[a-z0-9]/.test(char) ? char : `\\${char}`)).join(charInterPattern);
  });

  return new RegExp(`(${wordPatterns.join('|')})`, 'gi');
};
