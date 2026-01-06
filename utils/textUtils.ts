
/**
 * Supprime les accents d'une chaîne de caractères et la met en minuscules.
 */
export const normalizeText = (str: string): string => {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:“”"?!()]/g, "") // Supprime la ponctuation pour la comparaison de base
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
  
  // On remplace les espaces par un pattern qui accepte n'importe quelle ponctuation ou espace
  const punctuationPattern = "[\\s.,;:!–?\"“”'()\\n\\r]+";
  
  const pattern = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map(word => 
      word.split('').map(char => map[char] || (/[a-z0-9]/.test(char) ? char : `\\${char}`)).join('')
    )
    .join(punctuationPattern);
    
  if (isExactWord) {
    return new RegExp(`(^|[^a-z0-9À-ÿ])(${pattern})($|[^a-z0-9À-ÿ])`, 'gi');
  }
  return new RegExp(`(${pattern})`, 'gi');
};
