
/**
 * Supprime les accents d'une chaîne de caractères et la met en minuscules.
 */
export const normalizeText = (str: string): string => {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:“”"?!()]/g, "") // Remove most punctuation, keep hyphen and apostrophe
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
};

/**
 * Génère une expression régulière qui ignore les accents pour un texte donné.
 * Exemple: "peche" -> /[p][eèéêë][cç][h][eèéêë]/gi
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
  
  const pattern = query
    .toLowerCase()
    .split('')
    .map(char => map[char] || (/[a-z]/.test(char) ? char : `\\${char}`))
    .join('');
    
  if (isExactWord) {
    return new RegExp(`\\b${pattern}\\b`, 'gi');
  }
  return new RegExp(`(${pattern})`, 'gi');
};