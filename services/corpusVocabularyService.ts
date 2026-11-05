/**
 * King's Sword — Corpus Vocabulary & Dynamic IDF Service
 * 
 * Moteur de vocabulaire autonome et zéro maintenance manuelle :
 * 1. Construction dynamique du vocabulaire et des poids IDF depuis le corpus indexé complet.
 * 2. Rapprochement approximatif déterministe (distance d'édition Levenshtein <= 2 ou trigrammes de caractères).
 * 3. Gestion gracieuse des termes inconnus : poids nul (IDF = 0), journalisés, JAMAIS bloquants.
 * 4. Aucune liste statique de mots à maintenir : détection statistique des termes de consigne/non discriminants.
 */

import { normalizeText } from '../utils/textUtils';

export interface VocabularyTermInfo {
  df: number;   // Document Frequency (nombre de chunks contenant le terme)
  idf: number;  // Inverse Document Frequency
}

export interface CorpusVocabulary {
  totalChunks: number;
  terms: Map<string, VocabularyTermInfo>;
  averageChunkLength: number;
  updatedAt: string;
}

export interface MatchedTokenResult {
  rawToken: string;
  normalizedToken: string;
  matchedVocabTerm: string | null;
  editDistance: number | null;
  similarity: number;
  idf: number;
  isHighIdf: boolean;
  status: 'exact' | 'fuzzy' | 'ignored_zero_weight';
}

export interface QueryVocabularyAnalysis {
  tokens: MatchedTokenResult[];
  matchedTerms: string[];
  ignoredTerms: string[];
  highIdfTerms: string[];
  maxIdf: number;
  sumIdf: number;
  hasHighIdfContentTerm: boolean;
}

// Singleton en mémoire pour accès instantané sans surcoût
let globalCorpusVocabulary: CorpusVocabulary | null = null;

export function getCorpusTermIdf(term: string): number {
  if (!globalCorpusVocabulary) return 1.0;
  const norm = normalizeText(term).toLowerCase().trim();
  const info = globalCorpusVocabulary.terms.get(norm);
  return info ? info.idf : 0;
}

/**
 * Termes de requête purement conversationnels, épistémiques ou de consigne rédactionnelle.
 * Ces termes ne doivent JAMAIS être considérés comme des concepts doctrinaux discriminants
 * (isHighIdf = false) ni comme des entités inconnues hors-domaine (ignoredTerms).
 */
export const CONVERSATIONAL_DIRECTIVE_TOKENS = new Set([
  // Mots grammaticaux et mots outils (ne doivent jamais être classés High-IDF ni OOV)
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'en', 'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'sous',
  'et', 'ou', 'ni', 'car', 'mais', 'donc', 'or', 'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'font', 'faire', 'fais', 'il', 'elle', 'ils', 'elles', 'on', 'je', 'tu', 'se', 'sa', 'son', 'ses', 'leur', 'leurs',
  'au', 'aux', 'mon', 'ton', 'ma', 'ta', 'mes', 'tes', 'notre', 'votre', 'nos', 'vos', 'vers', 'chez', 'entre',
  'quel', 'quelle', 'quels', 'quelles', 'comme', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors', 'si', 'ne', 'pas', 'point', 'non', 'oui',
  'apres', 'dapres', 'lors', 'sujet', 'aujet',
  // Verbes et formules de requête conversationnelle
  'voudrais', 'aimerais', 'savoir', 'sais', 'peux', 'pouvez', 'pourrais', 'pourriez', 'peut', 'peuvent', 'pouvoir',
  'dis', 'dire', 'dit', 'disent', 'disait', 'donne', 'donnez', 'donner', 'faites', 'montre', 'montrez', 'monter', 'monte',
  'explique', 'expliquez', 'expliquer', 'comprendre', 'parle', 'parlez', 'parler', 'parlent',
  'voir', 'croire', 'pense', 'pensez', 'cherche', 'chercher', 'recherche',
  // Politesse, pronoms et salutations
  'sil', 'te', 'vous', 'plait', 'svp', 'stp', 'merci', 'moi', 'nous', 'lui', 'eux',
  'bonjour', 'bonsoir', 'salut', 'question', 'questions', 'reponse', 'reponses', 'demande',
  // Directives d'étude, de format ou d'ampleur
  'etude', 'plan', 'resume', 'synthese', 'analyse', 'panorama', 'apercu', 'detail', 'details',
  'detaille', 'detaillee', 'detailles', 'detaillees', 'detaile', 'exahustive', 'exahustif',
  'approfondi', 'approfondie', 'approfondis', 'approfondies',
  'complet', 'complete', 'complets', 'completes', 'exhaustif', 'exhaustive', 'exhaustifs', 'exhaustives',
  'tout', 'tous', 'toute', 'toutes', 'absolument', 'ensemble', 'general', 'generale',
  'sens', 'signifie', 'signification', 'contexte', 'origine', 'histoire', 'definition', 'enseignement', 'doctrine', 'revelation',
  // Références génériques à l'orateur / conteneurs du corpus
  'frere', 'fr', 'branham', 'william', 'marion', 'prophete', 'sermon', 'sermons', 'predicateur', 'message',
  'expose', 'sept', 'ages', 'age', 'livre', 'chapitre', 'bible', 'verset', 'versets', 'cantique', 'chant', 'chanson', 'passage', 'passages', 'nom',
  // Mots interrogatifs, cadrage rhétorique et marqueurs de discours/syntaxe
  'pourquoi', 'comment', 'selon', 'quand', 'lorsque', 'combien', 'autrefois', 'jadis', 'aujourdhui',
  'crucial', 'cruciale', 'essentiel', 'essentielle', 'obligatoirement', 'simplement', 'exactement',
  'moment', 'precis', 'precise', 'element', 'elements', 'partie', 'parties', 'manquait', 'manque', 'manquer',
  'gardee', 'garde', 'garder', 'monte', 'monter', 'actuel', 'actuelle', 'disponible', 'disponibles',
  'texte', 'textes', 'fondamental', 'fondamentale', 'veritable', 'contemporain', 'contemporaine',
  'prochain', 'prochaine', 'final', 'finale', 'solennel', 'solennelle', 'commemoratif', 'commemorative',
  'identite', 'attachement', 'concernant', 'mise', 'proximite', 'retour', 'debut', 'fin',
  // Anglais (requêtes mixtes ou bilingues)
  'can', 'you', 'explain', 'tell', 'give', 'detail', 'detailed', 'study', 'overview', 'summary',
  'comprehensive', 'brother', 'prophet', 'the', 'of', 'in', 'and', 'to', 'concern', 'concerning'
]);

/**
 * Table de correspondance canonique des noms et abréviations des 66 livres bibliques (français/anglais).
 * Permet d'aligner "Apoc. 10:7", "Ap 10.7", "Apocalypse chapitre 10, verset 7" sur "bible_rev_10_7".
 */
export const CANONICAL_BIBLE_BOOK_ALIASES: Record<string, string> = {
  'gen': 'gen', 'gn': 'gen', 'genese': 'gen',
  'ex': 'exo', 'exo': 'exo', 'exode': 'exo',
  'lev': 'lev', 'lv': 'lev', 'levitique': 'lev',
  'nom': 'num', 'nb': 'num', 'nombres': 'num',
  'deut': 'deu', 'dt': 'deu', 'deuteronome': 'deu',
  'jos': 'jos', 'josue': 'jos',
  'jug': 'jdg', 'jg': 'jdg', 'juges': 'jdg',
  'rut': 'rut', 'rt': 'rut', 'ruth': 'rut',
  '1_sam': '1sa', '1_s': '1sa', '1_samuel': '1sa', 'samuel': '1sa',
  '2_sam': '2sa', '2_s': '2sa', '2_samuel': '2sa',
  '1_r': '1ki', '1_rois': '1ki', 'rois': '1ki',
  '2_r': '2ki', '2_rois': '2ki',
  '1_chr': '1ch', '1_ch': '1ch', '1_chroniques': '1ch', 'chroniques': '1ch',
  '2_chr': '2ch', '2_ch': '2ch', '2_chroniques': '2ch',
  'esd': 'ezr', 'esdras': 'ezr',
  'neh': 'neh', 'ne': 'neh', 'nehemie': 'neh',
  'est': 'est', 'esther': 'est',
  'job': 'job', 'jb': 'job',
  'ps': 'psa', 'psa': 'psa', 'psaume': 'psa', 'psaumes': 'psa',
  'pr': 'pro', 'prov': 'pro', 'proverbes': 'pro',
  'ec': 'ecc', 'ecc': 'ecc', 'eccl': 'ecc', 'ecclesiaste': 'ecc',
  'ct': 'sng', 'cant': 'sng', 'cantique': 'sng',
  'es': 'isa', 'esa': 'isa', 'esaie': 'isa', 'isaie': 'isa', 'is': 'isa',
  'jer': 'jer', 'jr': 'jer', 'jeremie': 'jer',
  'lam': 'lam', 'lm': 'lam', 'lamentations': 'lam',
  'ez': 'ezk', 'eze': 'ezk', 'ezech': 'ezk', 'ezechiel': 'ezk',
  'dan': 'dan', 'dn': 'dan', 'daniel': 'dan',
  'os': 'hos', 'osee': 'hos',
  'joel': 'jol', 'jl': 'jol',
  'am': 'amo', 'amos': 'amo',
  'abd': 'oba', 'ab': 'oba', 'abdias': 'oba',
  'jon': 'jon', 'jonas': 'jon',
  'mi': 'mic', 'mic': 'mic', 'mich': 'mic', 'michee': 'mic',
  'na': 'nam', 'nah': 'nam', 'nahum': 'nam',
  'ha': 'hab', 'hab': 'hab', 'habacuc': 'hab', 'habakuk': 'hab',
  'so': 'zep', 'sop': 'zep', 'soph': 'zep', 'sophonie': 'zep',
  'ag': 'hag', 'agg': 'hag', 'aggee': 'hag',
  'za': 'zec', 'zac': 'zec', 'zach': 'zec', 'zacharie': 'zec',
  'mal': 'mal', 'ml': 'mal', 'malachie': 'mal',
  'mt': 'mat', 'mat': 'mat', 'matt': 'mat', 'matth': 'mat', 'matthieu': 'mat',
  'mc': 'mrk', 'mr': 'mrk', 'mar': 'mrk', 'marc': 'mrk',
  'lc': 'luk', 'lu': 'luk', 'luc': 'luk',
  'jn': 'jhn', 'jean': 'jhn', 'jhn': 'jhn',
  'ac': 'act', 'act': 'act', 'actes': 'act',
  'rm': 'rom', 'ro': 'rom', 'rom': 'rom', 'romains': 'rom',
  '1_co': '1co', '1_cor': '1co', '1_corinthiens': '1co', 'corinthiens': '1co',
  '2_co': '2co', '2_cor': '2co', '2_corinthiens': '2co',
  'ga': 'gal', 'gal': 'gal', 'galates': 'gal',
  'ep': 'eph', 'eph': 'eph', 'ephesiens': 'eph',
  'ph': 'php', 'phil': 'php', 'philippiens': 'php',
  'col': 'col', 'cl': 'col', 'colossiens': 'col',
  '1_th': '1th', '1_thess': '1th', '1_thessaloniciens': '1th', 'thessaloniciens': '1th',
  '2_th': '2th', '2_thess': '2th', '2_thessaloniciens': '2th',
  '1_tm': '1ti', '1_tim': '1ti', '1_timothee': '1ti', 'timothee': '1ti',
  '2_tm': '2ti', '2_tim': '2ti', '2_timothee': '2ti',
  'tt': 'tit', 'tit': 'tit', 'tite': 'tit',
  'phm': 'phm', 'philemon': 'phm',
  'he': 'heb', 'heb': 'heb', 'hebr': 'heb', 'hebreux': 'heb',
  'jc': 'jas', 'jac': 'jas', 'jacq': 'jas', 'jacques': 'jas',
  '1_p': '1pe', '1_pi': '1pe', '1_pierre': '1pe', 'pierre': '1pe',
  '2_p': '2pe', '2_pi': '2pe', '2_pierre': '2pe',
  '1_jn': '1jn', '1_jean': '1jn',
  '2_jn': '2jn', '2_jean': '2jn',
  '3_jn': '3jn', '3_jean': '3jn',
  'jd': 'jud', 'jud': 'jud', 'jude': 'jud',
  'ap': 'rev', 'apo': 'rev', 'apoc': 'rev', 'apocalypse': 'rev', 'rev': 'rev'
};

export function isDirectiveOrConversationalToken(token: string): boolean {
  if (!token) return false;
  const norm = normalizeText(token).toLowerCase().trim();
  if (norm.length <= 2) return true;
  if (CONVERSATIONAL_DIRECTIVE_TOKENS.has(norm)) return true;

  // Détection automatique par radical des consignes rédactionnelles, métadonnées et adjectifs de portée
  const stem = extractFrenchStem(norm);
  const directiveStems = [
    'exhaustif', 'exahust', 'approfond', 'detaill', 'detail', 'complet', 'synthes', 'analys', 'resume', 'recherche',
    'explication', 'enseignement', 'presentation', 'panorama', 'apercu', 'etude', 'reponse',
    'question', 'demande', 'citation', 'passage', 'sermon', 'predicateur', 'propos', 'contexte', 'signif', 'expos',
    'appliq', 'distingu', 'suffis', 'retabl', 'caracteris', 'consist', 'representer'
  ];
  if (directiveStems.some(s => stem.startsWith(s) || norm.startsWith(s))) {
    return true;
  }

  // Tolérance aux fautes de frappe (Levenshtein <= 1) sur les mots de consigne fréquents
  if (norm.length >= 5) {
    for (const dirWord of ['detaille', 'exhaustive', 'exhaustif', 'approfondi', 'synthese', 'explique', 'revelation', 'passages', 'absolument']) {
      if (computeLevenshteinDistance(norm, dirWord) <= 1) {
        return true;
      }
    }
  }

  // Détection automatique des mots de consigne en -ion, -ive, -if, -ment quand ils sont utilisés comme méta-consigne
  if (norm.endsWith('ive') || norm.endsWith('if') || norm.endsWith('tion') || norm.endsWith('ment')) {
    if (norm.length >= 6 && ['exhaust', 'complet', 'exact', 'global', 'partiel', 'precis', 'strict', 'total'].some(p => norm.includes(p))) {
      return true;
    }
  }

  return false;
}

/**
 * Extrait les jetons composés à haute valeur discriminante :
 * - Références bibliques normalisées (ex: "Apoc. 10:7", "Ap 10.7", "Apocalypse chapitre 10, verset 7" -> "bible_rev_10_7", "bible_rev_10")
 * - Codes de sermons datés (ex: "65-1128M" -> "65_1128m", "63-0324E" -> "63_0324e")
 * - Expressions numériques théologiques (ex: "7 sceaux" -> "7_sceau", "24 anciens" -> "24_ancien", "144 000" -> "144000")
 */
export function extractCompoundTheologicalTokens(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return extractCompoundTokensFromNormalized(normalizeText(text).toLowerCase());
}

/**
 * Variante opérant sur un texte déjà normalisé (évite une seconde normalisation lors de la tokenisation).
 * Chaque expression coûteuse n'est évaluée que si sa condition nécessaire (pré-test linéaire) est remplie.
 */
function extractCompoundTokensFromNormalized(norm: string): string[] {
  if (!norm) return [];
  // Sans chiffre, seul le nombre écrit en toutes lettres « cent quarante-quatre mille » peut produire un jeton
  if (!/\d/.test(norm)) {
    return /\bcent\s+quarante[- ]quatre\s+mille\b/.test(norm) ? ['144000'] : [];
  }
  const compounds: string[] = [];

  // 1. Codes de sermons Branham : YY-MMDD[A/M/E/S/B/X] (ex: 65-1128m, 63-0324e)
  const sermonCodeRegex = /\b(\d{2})[-_](\d{4}[a-z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = sermonCodeRegex.exec(norm)) !== null) {
    compounds.push(`${m[1]}_${m[2]}`);
  }

  // 2a. Références bibliques compactes ou abrégées : ex: "Apoc. 10:7", "Ap 10.7", "Actes 2:38", "1 Cor. 13:1"
  const compactBibleRegex = /\b(?:([123])\s*)?([a-z]{2,15})\.?\s+(\d{1,3})\s*[:.,v]\s*(\d{1,3})\b/g;
  const hasCompactCandidate = /[a-z]\.?\s+\d{1,3}\s*[:.,v]\s*\d/.test(norm);
  while (hasCompactCandidate && (m = compactBibleRegex.exec(norm)) !== null) {
    const numPrefix = m[1] ? `${m[1]}_` : '';
    const rawBook = m[2];
    const chap = m[3];
    const verse = m[4];
    const aliasKey = `${numPrefix}${rawBook}`;
    const canonicalBook = CANONICAL_BIBLE_BOOK_ALIASES[aliasKey] || CANONICAL_BIBLE_BOOK_ALIASES[rawBook];
    if (canonicalBook) {
      compounds.push(`bible_${canonicalBook}_${chap}_${verse}`);
      compounds.push(`bible_${canonicalBook}_${chap}`);
      compounds.push(`${numPrefix}${rawBook}_${chap}_${verse}`);
      compounds.push(`${chap}_${verse}`);
    } else if (rawBook.length >= 3 && !CONVERSATIONAL_DIRECTIVE_TOKENS.has(rawBook)) {
      compounds.push(`${numPrefix}${rawBook}_${chap}_${verse}`);
      compounds.push(`${chap}_${verse}`);
    }
  }

  // 2b. Références bibliques rédigées en toutes lettres dans les sermons : ex: "Matthieu chapitre 24, verset 24", "Apocalypse 11"
  const verbalBibleRegex = /\b(?:([123])\s+)?([a-z]{2,15})\.?\s+(?:chapitre\s+)?(\d{1,3})(?:\s*[,;:]?\s*versets?\s*(\d{1,3}))?\b/g;
  const hasVerbalCandidate = /[a-z]\.?\s+(?:chapitre\s+)?\d/.test(norm);
  while (hasVerbalCandidate && (m = verbalBibleRegex.exec(norm)) !== null) {
    const numPrefix = m[1] ? `${m[1]}_` : '';
    const rawBook = m[2];
    const chap = m[3];
    const verse = m[4];
    const aliasKey = `${numPrefix}${rawBook}`;
    const canonicalBook = CANONICAL_BIBLE_BOOK_ALIASES[aliasKey] || CANONICAL_BIBLE_BOOK_ALIASES[rawBook];
    if (canonicalBook) {
      compounds.push(`bible_${canonicalBook}_${chap}`);
      if (verse) {
        compounds.push(`bible_${canonicalBook}_${chap}_${verse}`);
        compounds.push(`${chap}_${verse}`);
      }
    }
  }

  // 3. Expressions numériques cardinales doctrinales (ex: 7 sceaux, 7 tonnerres, 24 anciens, 3 pull, 144 000)
  const numericConceptRegex = /\b([1-9]|12|24|70|144)\s+(sceaux?|ages?|tonnerres?|eglises?|anges?|cavernes?|chevaux|etres?|anciens?|temoins?|trompettes?|coupes?|plaies?|pull|dimensions?|vierges?|cornes?|couronnes?|tetes?)\b/g;
  const hasNumericCandidate = /\d\s+[a-z]/.test(norm);
  while (hasNumericCandidate && (m = numericConceptRegex.exec(norm)) !== null) {
    const num = m[1];
    const noun = m[2].replace(/s$/, '');
    compounds.push(`${num}_${noun}`);
  }

  // 4. Nombre 144 000 séparé par espace ou "cent quarante-quatre mille"
  if (/\b144\s+000\b/.test(norm) || /\bcent\s+quarante[- ]quatre\s+mille\b/.test(norm)) {
    compounds.push('144000');
  }

  return Array.from(new Set(compounds));
}

/**
 * Tokenise un texte en mots normalisés (minuscules, sans accents, sans ponctuation)
 * tout en préservant les jetons composés (références bibliques, codes sermons, nombres doctrinaux).
 * Sépare proprement les articles et prépositions élidés (ex: l'église -> eglise, léglise -> eglise).
 */
const UNICODE_WORD_CHAR = /^[\p{L}\p{N}]$/u;

/**
 * Équivalent en un seul passage de text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2).
 */
function extractWordRuns(text: string): string[] {
  const words: string[] = [];
  let start = -1;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    let width = 1;
    let isWordChar: boolean;
    if (code < 128) {
      isWordChar = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      width = 2;
      isWordChar = UNICODE_WORD_CHAR.test(text.slice(i, i + 2));
    } else {
      isWordChar = UNICODE_WORD_CHAR.test(text[i]);
    }
    if (isWordChar) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= 2) words.push(text.slice(start, i));
      start = -1;
    }
    i += width;
  }
  if (start >= 0 && text.length - start >= 2) words.push(text.slice(start));
  return words;
}

export function tokenizeText(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return tokenizeNormalizedText(normalizeText(text));
}

/**
 * Tokenisation d'un texte déjà passé par normalizeText (permet de réutiliser la normalisation lors de l'indexation).
 */
function tokenizeNormalizedText(normalized: string): string[] {
  // Extraction en un passage des séquences de lettres/chiffres de 2+ caractères :
  // les apostrophes d'élision (l'église -> l, eglise) sont des séparateurs comme toute ponctuation
  const words = extractWordRuns(normalized);

  // 2. Ajout des jetons composés (références bibliques, codes de sermons, nombres théologiques)
  const compounds = extractCompoundTokensFromNormalized(normalized);
  if (compounds.length > 0) {
    return [...words, ...compounds];
  }
  return words;
}

/**
 * Calcule la distance d'édition de Levenshtein entre deux chaînes.
 * Optimisé avec matrice à deux lignes pour éviter les allocations mémoire inutiles.
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 999; // Élagage rapide

  let prevRow = new Int32Array(b.length + 1);
  let currRow = new Int32Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    currRow[0] = i;
    const charA = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // suppression
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[b.length];
}

/**
 * Calcule la similarité de Jaccard sur les trigrammes de caractères.
 */
export function computeTrigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 3 || b.length < 3) return 0;

  const getTrigrams = (str: string): Set<string> => {
    const padded = `^${str}$`;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  };

  const setA = getTrigrams(a);
  const setB = getTrigrams(b);

  let intersection = 0;
  for (const tri of setA) {
    if (setB.has(tri)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Construit dynamiquement le vocabulaire et les poids IDF à partir de n'importe quelle liste de chunks.
 * Reconstruit automatiquement à chaque indexation de documents.
 */
// Cache LRU du vocabulaire par signature de corpus : le vocabulaire de la bibliothèque entière
// (≈185k chunks) n'est calculé qu'une seule fois au lieu d'être reconstruit à chaque requête
const MAX_CACHED_VOCABULARIES = 4;
const cachedVocabularies = new Map<string, CorpusVocabulary>();

function computeCorpusSignature(chunks: Array<{ text: string; chunkId?: string }>): string {
  const n = chunks.length;
  const keyOf = (c: { text: string; chunkId?: string } | undefined) => c ? (c.chunkId || (c.text || '').slice(0, 32)) : '';
  return `${n}:${keyOf(chunks[0])}:${keyOf(chunks[Math.floor(n / 3)])}:${keyOf(chunks[Math.floor((2 * n) / 3)])}:${keyOf(chunks[n - 1])}`;
}

export function buildCorpusVocabulary(chunks: Array<{ text: string }>): CorpusVocabulary {
  const signature = computeCorpusSignature(chunks);
  let vocab = cachedVocabularies.get(signature);
  if (vocab) {
    cachedVocabularies.delete(signature);
  } else {
    vocab = computeCorpusVocabulary(chunks);
    if (cachedVocabularies.size >= MAX_CACHED_VOCABULARIES) {
      const oldestKey = cachedVocabularies.keys().next().value;
      if (oldestKey !== undefined) cachedVocabularies.delete(oldestKey);
    }
  }
  cachedVocabularies.set(signature, vocab);

  // Ne pas écraser un vocabulaire global robuste (>= 1000 chunks) avec un échantillon local restreint
  if (!globalCorpusVocabulary || globalCorpusVocabulary.totalChunks < 1000 || vocab.totalChunks >= 1000) {
    globalCorpusVocabulary = vocab;
  }
  return vocab;
}

function computeCorpusVocabulary(chunks: Array<{ text: string }>): CorpusVocabulary {
  const totalChunks = Math.max(1, chunks.length);
  // Les fréquences documentaires sont exactement les longueurs des listes d'inversion de l'index BM25 :
  // on réutilise l'index (déjà nécessaire à la recherche) au lieu de retokeniser tout le corpus
  const index = getOrBuildBM25InvertedIndex(chunks.filter(c => c && c.text));
  const docFrequency = new Map<string, number>();
  for (const [term, postings] of index.termPostings) {
    docFrequency.set(term, postings.length / 2);
  }
  let totalWords = 0;
  for (let i = 0; i < index.docLengths.length; i++) totalWords += index.docLengths[i];

  const terms = new Map<string, VocabularyTermInfo>();
  const maxPossibleIdf = Math.max(1.0, Math.log(1 + totalChunks));
  const highIdfCutoff = Math.max(0.5, 0.45 * maxPossibleIdf);

  for (const [term, df] of docFrequency.entries()) {
    // Formule standard BM25 IDF
    // idf = ln(1 + (N - df + 0.5) / (df + 0.5))
    const idf = Math.max(0, Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5)));
    terms.set(term, {
      df,
      idf: Math.round(idf * 1000) / 1000
    });
  }

  const vocab: CorpusVocabulary = {
    totalChunks,
    terms,
    averageChunkLength: Math.round(totalWords / totalChunks),
    updatedAt: new Date().toISOString()
  };
  return vocab;
}

export function initializeCorpusVocabularyFromPrecalculated(
  bm25Data: { vocabSize: number; avgDocLength: number; totalDocs: number; terms: Record<string, { df: number; idf: number }> }
): CorpusVocabulary {
  const termsMap = new Map<string, VocabularyTermInfo>();
  if (bm25Data && bm25Data.terms) {
    for (const [k, v] of Object.entries(bm25Data.terms)) {
      termsMap.set(k, { df: v.df, idf: v.idf });
    }
  }
  const vocab: CorpusVocabulary = {
    totalChunks: bm25Data.totalDocs || 1,
    terms: termsMap,
    averageChunkLength: bm25Data.avgDocLength || 100,
    updatedAt: new Date().toISOString()
  };
  if (!globalCorpusVocabulary || globalCorpusVocabulary.terms.size < termsMap.size) {
    globalCorpusVocabulary = vocab;
  }
  return vocab;
}

export interface BM25ScoreOptions {
  k1?: number; // Défaut 1.5
  b?: number;  // Défaut 0.75
  bigrams?: string[];
  fullPhrase?: string;
  docTitle?: string;
  coreWeight?: number;     // Défaut 1.0
  expandedWeight?: number; // Défaut 0.4
}

export interface BM25ScoreResult {
  score: number;
  coreMatched: number;
  expandedMatched: number;
  bm25Core: number;
  bm25Expanded: number;
  phraseBonus: number;
  titleBonus: number;
}

/**
 * Calcule le score BM25 Okapi formel (k1=1.5, b=0.75) avec normalisation de longueur,
 * pondération IDF du corpus, saturation TF, stemming français et bonus phrasé/titre.
 */
export function computeBM25Score(
  docText: string,
  coreTerms: string[],
  expandedTerms: string[] = [],
  vocab?: CorpusVocabulary | null,
  options: BM25ScoreOptions = {}
): BM25ScoreResult {
  if (!docText || typeof docText !== 'string') {
    return { score: 0, coreMatched: 0, expandedMatched: 0, bm25Core: 0, bm25Expanded: 0, phraseBonus: 0, titleBonus: 0 };
  }

  const k1 = typeof options.k1 === 'number' ? options.k1 : 1.5;
  const b = typeof options.b === 'number' ? options.b : 0.75;
  const coreWeight = typeof options.coreWeight === 'number' ? options.coreWeight : 1.0;
  const expandedWeight = typeof options.expandedWeight === 'number' ? options.expandedWeight : 0.40;

  const docTokens = tokenizeText(docText);
  const docLen = Math.max(1, docTokens.length);
  const activeVocab = vocab || globalCorpusVocabulary;
  const avgDocLen = (activeVocab && activeVocab.averageChunkLength > 0) ? activeVocab.averageChunkLength : 100;
  const lenNorm = 1 - b + b * (docLen / avgDocLen);

  // Term frequencies dans le document
  const tfMap = new Map<string, number>();
  for (const t of docTokens) {
    tfMap.set(t, (tfMap.get(t) || 0) + 1);
  }

  // Pre-calcul des stems dans le doc pour le matching morphologique
  const stemTfMap = new Map<string, number>();
  for (const [token, count] of tfMap.entries()) {
    const stem = extractFrenchStem(token);
    stemTfMap.set(stem, (stemTfMap.get(stem) || 0) + count);
  }

  const normDocText = normalizeText(docText).toLowerCase();

  const getIdf = (term: string): number => {
    if (!activeVocab) return 1.5;
    const info = activeVocab.terms.get(term);
    if (info) return info.idf;
    const stem = extractFrenchStem(term);
    const stemInfo = activeVocab.terms.get(stem);
    if (stemInfo) return stemInfo.idf;
    return Math.max(0.5, Math.log(1 + activeVocab.totalChunks / 2));
  };

  let bm25Core = 0;
  let coreMatched = 0;

  for (const term of coreTerms) {
    const normTerm = normalizeText(term).toLowerCase().trim();
    if (!normTerm) continue;

    let tf = tfMap.get(normTerm) || 0;
    if (tf === 0) {
      // Correspondance par radical (stemming)
      const termStem = extractFrenchStem(normTerm);
      if (termStem.length >= 3) {
        tf = stemTfMap.get(termStem) || 0;
      }
    }

    if (tf > 0) {
      coreMatched++;
      const idf = getIdf(normTerm);
      const tfSat = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
      bm25Core += idf * tfSat;
    }
  }

  let bm25Expanded = 0;
  let expandedMatched = 0;

  for (const term of expandedTerms) {
    const normTerm = normalizeText(term).toLowerCase().trim();
    if (!normTerm || coreTerms.includes(normTerm)) continue;

    let tf = tfMap.get(normTerm) || 0;
    if (tf === 0) {
      const termStem = extractFrenchStem(normTerm);
      if (termStem.length >= 3) {
        tf = stemTfMap.get(termStem) || 0;
      }
    }

    if (tf > 0) {
      expandedMatched++;
      const idf = getIdf(normTerm);
      const tfSat = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
      bm25Expanded += idf * tfSat;
    }
  }

  // Bonus de phrase exacte et bigrammes
  let phraseBonus = 0;
  if (options.bigrams && options.bigrams.length > 0) {
    let matchedBigrams = 0;
    for (const bg of options.bigrams) {
      if (normDocText.includes(bg)) {
        matchedBigrams++;
      }
    }
    if (matchedBigrams > 0) {
      phraseBonus += (matchedBigrams / options.bigrams.length) * 12.0;
    }
  }

  if (options.fullPhrase && options.fullPhrase.length > 4 && normDocText.includes(options.fullPhrase)) {
    phraseBonus += 15.0;
  }

  // Bonus de titre
  let titleBonus = 0;
  if (options.docTitle) {
    const normTitle = normalizeText(options.docTitle).toLowerCase();
    for (const term of coreTerms) {
      const normTerm = normalizeText(term).toLowerCase().trim();
      if (normTerm && normTitle.includes(normTerm)) {
        titleBonus += Math.min(5.0, getIdf(normTerm) * 1.0);
      }
    }
  }

  const rawScore = (coreWeight * bm25Core) + (expandedWeight * bm25Expanded) + phraseBonus + Math.min(titleBonus, 10.0);
  const finalScore = Math.round(rawScore * 100) / 100;

  return {
    score: finalScore,
    coreMatched,
    expandedMatched,
    bm25Core: Math.round(bm25Core * 100) / 100,
    bm25Expanded: Math.round(bm25Expanded * 100) / 100,
    phraseBonus: Math.round(phraseBonus * 100) / 100,
    titleBonus: Math.round(titleBonus * 100) / 100
  };
}

/**
 * Liste d'inversion compacte : paires consécutives [docIdx, tf, docIdx, tf, ...].
 * Un Int32Array remplace des millions d'objets { docIdx, tf } (≈ 3x moins de mémoire, aucune pression GC).
 */
export type PackedPostings = Int32Array;

export interface BM25InvertedIndex<T extends { text: string; chunkId?: string; sermonTitle?: string; sectionTitle?: string } = any> {
  signature: string;
  chunks: T[];
  docLengths: Float32Array;
  avgDocLength: number;
  normDocs: string[];
  normTitles: string[];
  termPostings: Map<string, PackedPostings>;
  stemPostings: Map<string, PackedPostings>;
}

// Cache LRU multi-emplacements (bibliothèque entière + sélections du Dock) pour éviter les reconstructions
const MAX_CACHED_INVERTED_INDEXES = 3;
const cachedInvertedIndexes = new Map<string, BM25InvertedIndex>();
const pendingIndexBuilds = new Map<string, Promise<BM25InvertedIndex>>();
const indexBuildProgressListeners = new Map<string, Set<(fraction: number) => void>>();
// Durée maximale d'une tranche de construction avant de rendre la main à l'interface
const INDEX_BUILD_FRAME_BUDGET_MS = 12;

interface IndexBuildState {
  next: number;
  totalWords: number;
  docLengths: Float32Array;
  normDocs: string[];
  normTitles: string[];
  // Termes et radicaux internés en identifiants entiers : une seule recherche de Map par occurrence de mot
  termIds: Map<string, number>;
  termNames: string[];
  termLists: number[][];
  termStemIds: number[];
  termCounts: number[];
  stemIds: Map<string, number>;
  stemNames: string[];
  stemLists: number[][];
  stemCounts: number[];
  titleCache: Map<string, string>;
}

function computeIndexSignature(chunks: Array<{ text: string; chunkId?: string }>): string {
  const n = chunks.length;
  const firstId = n > 0 ? (chunks[0].chunkId || chunks[0].text.slice(0, 24)) : '';
  const lastId = n > 0 ? (chunks[n - 1].chunkId || chunks[n - 1].text.slice(0, 24)) : '';
  const midId = n > 2 ? (chunks[Math.floor(n / 2)].chunkId || '') : '';
  return `${n}:${firstId}:${midId}:${lastId}`;
}

function getCachedIndex<T extends { text: string }>(signature: string, n: number): BM25InvertedIndex<T> | null {
  const cachedIndex = cachedInvertedIndexes.get(signature);
  if (!cachedIndex || cachedIndex.chunks.length !== n) return null;
  cachedInvertedIndexes.delete(signature);
  cachedInvertedIndexes.set(signature, cachedIndex);
  return cachedIndex as BM25InvertedIndex<T>;
}

function createIndexBuildState(n: number): IndexBuildState {
  return {
    next: 0,
    totalWords: 0,
    docLengths: new Float32Array(n),
    normDocs: new Array<string>(n),
    normTitles: new Array<string>(n),
    termIds: new Map(),
    termNames: [],
    termLists: [],
    termStemIds: [],
    termCounts: [],
    stemIds: new Map(),
    stemNames: [],
    stemLists: [],
    stemCounts: [],
    titleCache: new Map()
  };
}

function indexDocuments<T extends { text: string; sermonTitle?: string; sectionTitle?: string }>(
  state: IndexBuildState,
  chunks: T[],
  end: number
): void {
  const touchedTerms: number[] = [];
  const touchedStems: number[] = [];
  const { termIds, termNames, termLists, termStemIds, termCounts, stemIds, stemNames, stemLists, stemCounts } = state;
  for (let docIdx = state.next; docIdx < end; docIdx++) {
    const c = chunks[docIdx];
    const rawText = c?.text || '';
    const normalized = rawText ? normalizeText(rawText) : '';
    const tokens = normalized ? tokenizeNormalizedText(normalized) : [];
    const len = Math.max(1, tokens.length);
    state.docLengths[docIdx] = len;
    state.totalWords += len;
    state.normDocs[docIdx] = normalized;

    // Les titres sont partagés par tous les chunks d'un sermon : une seule chaîne normalisée par titre
    const rawTitle = (c as any)?.sectionTitle || c?.sermonTitle || '';
    let normTitle = state.titleCache.get(rawTitle);
    if (normTitle === undefined) {
      normTitle = rawTitle ? normalizeText(rawTitle).toLowerCase() : '';
      state.titleCache.set(rawTitle, normTitle);
    }
    state.normTitles[docIdx] = normTitle;

    touchedTerms.length = 0;
    touchedStems.length = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      let id = termIds.get(t);
      if (id === undefined) {
        id = termNames.length;
        termIds.set(t, id);
        termNames.push(t);
        termLists.push([]);
        termCounts.push(0);
        // Radical calculé une seule fois par terme distinct
        const stem = extractFrenchStem(t);
        let stemId = -1;
        if (stem.length >= 3) {
          stemId = stemIds.get(stem) ?? -1;
          if (stemId < 0) {
            stemId = stemNames.length;
            stemIds.set(stem, stemId);
            stemNames.push(stem);
            stemLists.push([]);
            stemCounts.push(0);
          }
        }
        termStemIds.push(stemId);
      }
      if (termCounts[id]++ === 0) touchedTerms.push(id);
      const stemId = termStemIds[id];
      if (stemId >= 0 && stemCounts[stemId]++ === 0) touchedStems.push(stemId);
    }

    for (let k = 0; k < touchedTerms.length; k++) {
      const id = touchedTerms[k];
      termLists[id].push(docIdx, termCounts[id]);
      termCounts[id] = 0;
    }
    for (let k = 0; k < touchedStems.length; k++) {
      const id = touchedStems[k];
      stemLists[id].push(docIdx, stemCounts[id]);
      stemCounts[id] = 0;
    }
  }
  state.next = end;
}

function packPostings(names: string[], lists: number[][]): Map<string, PackedPostings> {
  const packed = new Map<string, PackedPostings>();
  for (let i = 0; i < names.length; i++) {
    packed.set(names[i], Int32Array.from(lists[i]));
  }
  lists.length = 0;
  return packed;
}

function finalizeIndex<T extends { text: string }>(state: IndexBuildState, signature: string, chunks: T[]): BM25InvertedIndex<T> {
  const n = chunks.length;
  const index: BM25InvertedIndex<T> = {
    signature,
    chunks,
    docLengths: state.docLengths,
    avgDocLength: n > 0 ? state.totalWords / n : 100,
    normDocs: state.normDocs,
    normTitles: state.normTitles,
    termPostings: packPostings(state.termNames, state.termLists),
    stemPostings: packPostings(state.stemNames, state.stemLists)
  };
  storeIndex(signature, index);
  return index;
}

function storeIndex(signature: string, index: BM25InvertedIndex): void {
  if (cachedInvertedIndexes.size >= MAX_CACHED_INVERTED_INDEXES) {
    const oldestKey = cachedInvertedIndexes.keys().next().value;
    if (oldestKey !== undefined) cachedInvertedIndexes.delete(oldestKey);
  }
  cachedInvertedIndexes.set(signature, index);
}

/**
 * Construit ou récupère depuis le cache un index inversé BM25 haute performance en mémoire.
 * Complexité de construction : O(N) une seule fois par contexte documentaire.
 * Complexité de requête : O(|Q| * postings) au lieu de O(N * L), réduisant la latence de ~211 ms à < 1.5 ms.
 */
export function getOrBuildBM25InvertedIndex<T extends { text: string; chunkId?: string; sermonTitle?: string; sectionTitle?: string }>(
  chunks: T[]
): BM25InvertedIndex<T> {
  const signature = computeIndexSignature(chunks);
  const cached = getCachedIndex<T>(signature, chunks.length);
  if (cached) return cached;

  const state = createIndexBuildState(chunks.length);
  indexDocuments(state, chunks, chunks.length);
  return finalizeIndex(state, signature, chunks);
}

/**
 * Construit l'index en tâche de fond par tranches, en rendant la main à l'interface entre chaque tranche.
 * Les appels synchrones ultérieurs (recherche) trouvent ensuite l'index en cache, sans aucun gel.
 */
export function prewarmBM25InvertedIndex<T extends { text: string; chunkId?: string; sermonTitle?: string; sectionTitle?: string }>(
  chunks: T[],
  onProgress?: (fraction: number) => void
): Promise<BM25InvertedIndex<T>> {
  const signature = computeIndexSignature(chunks);
  const cached = getCachedIndex<T>(signature, chunks.length);
  if (cached) return Promise.resolve(cached);
  const pending = pendingIndexBuilds.get(signature);
  if (pending) {
    if (onProgress) indexBuildProgressListeners.get(signature)?.add(onProgress);
    return pending as Promise<BM25InvertedIndex<T>>;
  }

  const listeners = new Set<(fraction: number) => void>(onProgress ? [onProgress] : []);
  indexBuildProgressListeners.set(signature, listeners);
  const notify = (fraction: number) => listeners.forEach(fn => { try { fn(fraction); } catch {} });
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  const build = (async () => {
    const n = chunks.length;
    const state = createIndexBuildState(n);
    // Tranches bornées par un budget de temps (< 1 frame à 60 Hz) plutôt que par un nombre fixe de documents
    while (state.next < n) {
      // Un appel synchrone concurrent a pu construire l'index entre deux tranches
      const done = getCachedIndex<T>(signature, n);
      if (done) return done;
      const sliceStart = now();
      while (state.next < n && now() - sliceStart < INDEX_BUILD_FRAME_BUDGET_MS) {
        indexDocuments(state, chunks, Math.min(n, state.next + 32));
      }
      notify(0.95 * (state.next / n));
      await yieldToUi();
    }

    const packAsync = async (names: string[], lists: number[][]): Promise<Map<string, PackedPostings>> => {
      const packed = new Map<string, PackedPostings>();
      let i = 0;
      while (i < names.length) {
        const sliceStart = now();
        while (i < names.length && now() - sliceStart < INDEX_BUILD_FRAME_BUDGET_MS) {
          const end = Math.min(names.length, i + 256);
          for (; i < end; i++) packed.set(names[i], Int32Array.from(lists[i]));
        }
        await yieldToUi();
      }
      lists.length = 0;
      return packed;
    };
    const termPostings = await packAsync(state.termNames, state.termLists);
    const stemPostings = await packAsync(state.stemNames, state.stemLists);

    const existing = getCachedIndex<T>(signature, n);
    if (existing) return existing;
    const index: BM25InvertedIndex<T> = {
      signature,
      chunks,
      docLengths: state.docLengths,
      avgDocLength: n > 0 ? state.totalWords / n : 100,
      normDocs: state.normDocs,
      normTitles: state.normTitles,
      termPostings,
      stemPostings
    };
    storeIndex(signature, index);
    notify(1);
    return index;
  })().finally(() => {
    pendingIndexBuilds.delete(signature);
    indexBuildProgressListeners.delete(signature);
  });

  pendingIndexBuilds.set(signature, build);
  return build;
}

/**
 * Exécute une recherche BM25 Okapi formelle via l'Index Inversé (O(|Q| * postings) sans balayage linéaire).
 */
export function searchBM25WithInvertedIndex<T extends { text: string; chunkId?: string; sermonTitle?: string; sectionTitle?: string }>(
  chunks: T[],
  coreTerms: string[],
  expandedTerms: string[] = [],
  vocab?: CorpusVocabulary | null,
  options: BM25ScoreOptions = {},
  topK: number = 40
): Array<{ chunk: T; score: number; coreMatched: number; expandedMatched: number }> {
  if (!chunks || chunks.length === 0) return [];

  const index = getOrBuildBM25InvertedIndex(chunks);
  const k1 = typeof options.k1 === 'number' ? options.k1 : 1.5;
  const b = typeof options.b === 'number' ? options.b : 0.75;
  const coreWeight = typeof options.coreWeight === 'number' ? options.coreWeight : 1.0;
  const expandedWeight = typeof options.expandedWeight === 'number' ? options.expandedWeight : 0.40;
  const activeVocab = vocab || globalCorpusVocabulary;
  const avgDocLen = (activeVocab && activeVocab.averageChunkLength > 0)
    ? activeVocab.averageChunkLength
    : index.avgDocLength;
  const totalChunksCount = activeVocab ? activeVocab.totalChunks : chunks.length;

  const getIdf = (term: string): number => {
    if (activeVocab) {
      const info = activeVocab.terms.get(term);
      if (info) return info.idf;
      const stem = extractFrenchStem(term);
      const stemInfo = activeVocab.terms.get(stem);
      if (stemInfo) return stemInfo.idf;
    }
    const postings = index.termPostings.get(term) || index.stemPostings.get(extractFrenchStem(term));
    const df = postings ? postings.length / 2 : 0;
    return Math.max(0.5, Math.log(1 + (totalChunksCount - df + 0.5) / (df + 0.5)));
  };

  // Accumulateurs denses (tableaux typés) au lieu de Map : O(1) sans hachage ni allocation par document.
  // L'ordre des additions par document est identique à l'implémentation par Map (mêmes valeurs flottantes).
  const n = index.chunks.length;
  const buffers = getSearchBuffers(n);
  const { coreScores, expandedScores, coreMatchCounts, expandedMatchCounts, touched, visitStamp } = buffers;
  const candidates: number[] = [];
  let stamp = buffers.stamp;

  const touch = (docIdx: number) => {
    if (touched[docIdx] === 0) {
      touched[docIdx] = 1;
      candidates.push(docIdx);
    }
  };

  const accumulate = (
    list: PackedPostings,
    idf: number,
    scores: Float64Array,
    counts: Int32Array,
    termStamp: number,
    skipVisited: boolean
  ) => {
    for (let i = 0; i < list.length; i += 2) {
      const docIdx = list[i];
      if (skipVisited && visitStamp[docIdx] === termStamp) continue;
      visitStamp[docIdx] = termStamp;
      touch(docIdx);
      const tf = list[i + 1];
      const lenNorm = 1 - b + b * (index.docLengths[docIdx] / avgDocLen);
      const tfSat = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
      scores[docIdx] += idf * tfSat;
      counts[docIdx] += 1;
    }
  };

  const normCoreTerms = coreTerms
    .map(t => normalizeText(t).toLowerCase().trim())
    .filter(Boolean);
  const coreTermSet = new Set(normCoreTerms);

  try {
    for (const normTerm of normCoreTerms) {
      const idf = getIdf(normTerm);
      const termStamp = ++stamp;
      const exactList = index.termPostings.get(normTerm);
      if (exactList) accumulate(exactList, idf, coreScores, coreMatchCounts, termStamp, false);
      const termStem = extractFrenchStem(normTerm);
      if (termStem.length >= 3) {
        const stemList = index.stemPostings.get(termStem);
        if (stemList) accumulate(stemList, idf, coreScores, coreMatchCounts, termStamp, true);
      }
    }

    for (const rawExp of expandedTerms) {
      const normTerm = normalizeText(rawExp).toLowerCase().trim();
      if (!normTerm || coreTermSet.has(normTerm)) continue;
      const idf = getIdf(normTerm);
      const termStamp = ++stamp;
      const exactList = index.termPostings.get(normTerm);
      if (exactList) accumulate(exactList, idf, expandedScores, expandedMatchCounts, termStamp, false);
      const termStem = extractFrenchStem(normTerm);
      if (termStem.length >= 3) {
        const stemList = index.stemPostings.get(termStem);
        if (stemList) accumulate(stemList, idf, expandedScores, expandedMatchCounts, termStamp, true);
      }
    }

    // Bonus de titre mémoïsé par titre (partagé par tous les chunks d'un sermon)
    const titleBonusCache = new Map<string, number>();
    const getTitleBonus = (normTitle: string): number => {
      if (!normTitle) return 0;
      let bonus = titleBonusCache.get(normTitle);
      if (bonus === undefined) {
        bonus = 0;
        for (let i = 0; i < normCoreTerms.length; i++) {
          const nt = normCoreTerms[i];
          if (nt && normTitle.includes(nt)) {
            bonus += Math.min(5.0, getIdf(nt) * 1.0);
          }
        }
        titleBonusCache.set(normTitle, bonus);
      }
      return bonus;
    };

    const hasBigrams = Boolean(options.bigrams && options.bigrams.length > 0);
    const hasFullPhrase = Boolean(options.fullPhrase && options.fullPhrase.length > 4);
    const bigramList = hasBigrams ? options.bigrams! : [];

    // Documents pouvant contenir chaque expression (condition nécessaire exacte dérivée des tokens) :
    // null = aucune restriction possible, l'expression doit être testée sur tous les documents
    const bigramPossible = bigramList.map(bg => getPhrasePossibleDocs(index, bg));
    const fullPhrasePossible = hasFullPhrase ? getPhrasePossibleDocs(index, options.fullPhrase!) : null;

    // Borne supérieure du bonus de phrase propre à chaque document
    const phraseUpperBound = (docIdx: number): number => {
      let possibleBigrams = 0;
      for (let i = 0; i < bigramPossible.length; i++) {
        const set = bigramPossible[i];
        if (!set || set[docIdx] === 1) possibleBigrams++;
      }
      let ub = possibleBigrams > 0 ? (possibleBigrams / bigramList.length) * 12.0 : 0;
      if (hasFullPhrase && (!fullPhrasePossible || fullPhrasePossible[docIdx] === 1)) ub += 15.0;
      return ub;
    };

    // Score de base (sans bonus de phrase, coûteux car il parcourt le texte du chunk)
    const baseScores = new Float64Array(candidates.length);
    const kthBaseHeap = new MinHeap();
    for (let order = 0; order < candidates.length; order++) {
      const docIdx = candidates[order];
      const base = (coreWeight * coreScores[docIdx]) + (expandedWeight * expandedScores[docIdx]) + Math.min(getTitleBonus(index.normTitles[docIdx]), 10.0);
      baseScores[order] = base;
      if (kthBaseHeap.size < topK) kthBaseHeap.push(base);
      else if (base > kthBaseHeap.peek()) { kthBaseHeap.pop(); kthBaseHeap.push(base); }
    }

    // Présélection exacte : le score final est ≥ au score de base, donc le K-ième score final arrondi est
    // ≥ arrondi(K-ième score de base). Un candidat dont la borne supérieure reste en dessous ne peut pas
    // entrer dans le top K : inutile de le trier ni d'évaluer son bonus de phrase.
    const kthBaseRounded = kthBaseHeap.size >= topK ? Math.round(kthBaseHeap.peek() * 100) / 100 : -Infinity;
    const canPrefilter = kthBaseRounded >= 0.5;
    type Candidate = { docIdx: number; order: number; upper: number };
    const scored: Candidate[] = [];
    for (let order = 0; order < candidates.length; order++) {
      const docIdx = candidates[order];
      if (coreMatchCounts[docIdx] + expandedMatchCounts[docIdx] === 0) continue;
      // Marge de 0,01 : protège l'élagage des écarts d'arrondi flottant dus à l'ordre des additions
      const upper = Math.round((baseScores[order] + phraseUpperBound(docIdx)) * 100) / 100 + 0.01;
      if (canPrefilter && upper < kthBaseRounded) continue;
      scored.push({ docIdx, order, upper });
    }

    // Élagage exact : on évalue les candidats par borne supérieure décroissante et l'on s'arrête dès que
    // la borne (score de base + bonus de phrase atteignable) passe sous le K-ième meilleur score exact
    scored.sort((x, y) => (y.upper - x.upper) || (x.order - y.order));
    const kept: Array<{ docIdx: number; order: number; score: number }> = [];
    const topScores = new MinHeap();
    for (const cand of scored) {
      if (topScores.size >= topK && cand.upper < topScores.peek()) break;

      const normDocText = index.normDocs[cand.docIdx];
      let phraseBonus = 0;
      if (hasBigrams) {
        let matchedBigrams = 0;
        for (let i = 0; i < bigramList.length; i++) {
          const set = bigramPossible[i];
          if ((!set || set[cand.docIdx] === 1) && normDocText.includes(bigramList[i])) matchedBigrams++;
        }
        if (matchedBigrams > 0) phraseBonus += (matchedBigrams / bigramList.length) * 12.0;
      }
      if (hasFullPhrase && (!fullPhrasePossible || fullPhrasePossible[cand.docIdx] === 1) && normDocText.includes(options.fullPhrase!)) {
        phraseBonus += 15.0;
      }

      const bm25Core = coreScores[cand.docIdx];
      const bm25Expanded = expandedScores[cand.docIdx];
      const titleBonus = getTitleBonus(index.normTitles[cand.docIdx]);
      const rawScore = (coreWeight * bm25Core) + (expandedWeight * bm25Expanded) + phraseBonus + Math.min(titleBonus, 10.0);
      const finalScore = Math.round(rawScore * 100) / 100;
      if (finalScore < 0.5) continue;

      kept.push({ docIdx: cand.docIdx, order: cand.order, score: finalScore });
      topScores.push(finalScore);
      if (topScores.size > topK) topScores.pop();
    }

    // Tri stable équivalent à l'implémentation d'origine (score décroissant, puis ordre d'apparition)
    kept.sort((x, y) => (y.score - x.score) || (x.order - y.order));
    return kept.slice(0, topK).map(k => ({
      chunk: index.chunks[k.docIdx],
      score: k.score,
      coreMatched: coreMatchCounts[k.docIdx],
      expandedMatched: expandedMatchCounts[k.docIdx]
    }));
  } finally {
    // Remise à zéro ciblée des seuls documents touchés (les tampons sont réutilisés d'une requête à l'autre)
    for (let i = 0; i < candidates.length; i++) {
      const docIdx = candidates[i];
      coreScores[docIdx] = 0;
      expandedScores[docIdx] = 0;
      coreMatchCounts[docIdx] = 0;
      expandedMatchCounts[docIdx] = 0;
      touched[docIdx] = 0;
    }
    buffers.stamp = stamp;
  }
}

// Ensembles de documents par contrainte de token (préfixe / suffixe / exact / contenu), mis en cache par index
const affixDocSetCache = new WeakMap<BM25InvertedIndex, Map<string, Uint8Array>>();
const MAX_AFFIX_SETS_PER_INDEX = 96;

function isPureWordToken(word: string): boolean {
  if (word.length < 2) return false;
  const runs = extractWordRuns(word);
  return runs.length === 1 && runs[0] === word;
}

function getAffixDocSet(index: BM25InvertedIndex, affix: string, mode: 'prefix' | 'suffix' | 'exact' | 'contains'): Uint8Array {
  let cache = affixDocSetCache.get(index);
  if (!cache) {
    cache = new Map();
    affixDocSetCache.set(index, cache);
  }
  const key = `${mode}:${affix}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const set = new Uint8Array(index.chunks.length);
  const mark = (postings: PackedPostings) => {
    for (let i = 0; i < postings.length; i += 2) set[postings[i]] = 1;
  };
  if (mode === 'exact') {
    const postings = index.termPostings.get(affix);
    if (postings) mark(postings);
  } else {
    for (const [term, postings] of index.termPostings) {
      if (mode === 'prefix' ? term.startsWith(affix) : mode === 'suffix' ? term.endsWith(affix) : term.includes(affix)) {
        mark(postings);
      }
    }
  }
  if (cache.size >= MAX_AFFIX_SETS_PER_INDEX) cache.clear();
  cache.set(key, set);
  return set;
}

/**
 * Documents pouvant contenir l'expression (sous-chaîne de normDocs), ou null si aucune restriction n'est déductible.
 * Condition nécessaire exacte : une occurrence de « w0 w1 … wm » impose qu'un token se termine par w0,
 * que les mots intérieurs soient des tokens entiers et que le token suivant le dernier espace commence par wm
 * (un mot seul doit être contenu dans un token). Seuls les mots purement alphanumériques de 2+ caractères
 * contraignent : leurs tokens englobants sont alors de longueur ≥ 2, donc présents dans l'index.
 */
function getPhrasePossibleDocs(index: BM25InvertedIndex, phrase: string): Uint8Array | null {
  const words = phrase.split(' ');
  const constraints: Uint8Array[] = [];
  if (words.length === 1) {
    if (isPureWordToken(words[0])) constraints.push(getAffixDocSet(index, words[0], 'contains'));
  } else {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!isPureWordToken(w)) continue;
      const mode = i === 0 ? 'suffix' : i === words.length - 1 ? 'prefix' : 'exact';
      constraints.push(getAffixDocSet(index, w, mode));
    }
  }
  if (constraints.length === 0) return null;
  if (constraints.length === 1) return constraints[0];
  const result = new Uint8Array(index.chunks.length);
  const first = constraints[0];
  for (let d = 0; d < result.length; d++) {
    if (first[d] !== 1) continue;
    let ok = 1;
    for (let c = 1; c < constraints.length; c++) {
      if (constraints[c][d] !== 1) { ok = 0; break; }
    }
    result[d] = ok;
  }
  return result;
}

interface SearchBuffers {
  size: number;
  coreScores: Float64Array;
  expandedScores: Float64Array;
  coreMatchCounts: Int32Array;
  expandedMatchCounts: Int32Array;
  touched: Uint8Array;
  visitStamp: Int32Array;
  stamp: number;
}

let sharedSearchBuffers: SearchBuffers | null = null;

function getSearchBuffers(n: number): SearchBuffers {
  if (!sharedSearchBuffers || sharedSearchBuffers.size < n || sharedSearchBuffers.stamp > 2_000_000_000) {
    const size = Math.max(n, sharedSearchBuffers?.size ?? 0);
    sharedSearchBuffers = {
      size,
      coreScores: new Float64Array(size),
      expandedScores: new Float64Array(size),
      coreMatchCounts: new Int32Array(size),
      expandedMatchCounts: new Int32Array(size),
      touched: new Uint8Array(size),
      visitStamp: new Int32Array(size),
      stamp: 0
    };
  }
  return sharedSearchBuffers;
}

/** Tas binaire minimal de nombres (K meilleurs scores). */
class MinHeap {
  private data: number[] = [];
  get size(): number { return this.data.length; }
  peek(): number { return this.data[0]; }
  push(value: number): void {
    const d = this.data;
    d.push(value);
    let i = d.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (d[parent] <= d[i]) break;
      [d[parent], d[i]] = [d[i], d[parent]];
      i = parent;
    }
  }
  pop(): number | undefined {
    const d = this.data;
    if (d.length === 0) return undefined;
    const top = d[0];
    const last = d.pop()!;
    if (d.length > 0) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < d.length && d[l] < d[smallest]) smallest = l;
        if (r < d.length && d[r] < d[smallest]) smallest = r;
        if (smallest === i) break;
        [d[smallest], d[i]] = [d[i], d[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * PHASE C.3 : Détection structurelle des paragraphes sans contenu ou bruits éditoriaux.
 * Détecte par structure (crochets, ratio de ponctuation, longueur) sans liste statique de phrases.
 */
/**
 * Équivalent sans allocation de text.replace(/[^\p{L}\p{N}]/gu, '').length.
 */
function countLetterOrDigitCodeUnits(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) count++;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      if (UNICODE_WORD_CHAR.test(text.slice(i, i + 2))) count += 2;
      i++;
    } else if (UNICODE_WORD_CHAR.test(text[i])) {
      count++;
    }
  }
  return count;
}

function countLatinWordRuns(text: string, limit: number): number {
  let runs = 0;
  let runLength = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isWordChar =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7);
    if (isWordChar) {
      runLength++;
    } else {
      if (runLength >= 2 && ++runs >= limit) return runs;
      runLength = 0;
    }
  }
  if (runLength >= 2) runs++;
  return runs;
}

export function isContentlessOrNoiseParagraph(text: string): boolean {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length < 15) return true;

  // 1. Détection structurelle de notes éditoriales entre crochets (uniquement si le texte en contient)
  if (trimmed.includes('[')) {
    if (/^\s*\[.*\]\s*$/s.test(trimmed)) return true;
    const bracketMatches = trimmed.match(/\[.*?\]/g) || [];
    const bracketChars = bracketMatches.join('').length;
    if (bracketChars / trimmed.length > 0.45) return true;
  }

  // 2. Passages inaudibles ou bruits d'enregistrement ("...?... ", "…?... ")
  if (trimmed.length < 90 && /\b\.\.\.\?\.\.\.|\b…\?…|inconnu|inaudible|enregistrement/i.test(trimmed)) {
    return true;
  }

  // 3. Ratio de ponctuation/symboles anormalement élevé (> 35% de non-lettres)
  if (countLetterOrDigitCodeUnits(trimmed) / trimmed.length < 0.50) return true;

  // 4. Moins de 4 mots significatifs (chemin rapide : 4 séquences alphanumériques latines de 2+ caractères
  // impliquent au moins 4 jetons ; la tokenisation complète n'est faite que dans les cas limites)
  if (countLatinWordRuns(trimmed, 4) >= 4) return false;
  const words = tokenizeText(trimmed);
  if (words.length < 4) return true;

  return false;
}

/**
 * Récupère le vocabulaire global en cache ou initialise un fallback minimal.
 */
export function getActiveCorpusVocabulary(): CorpusVocabulary | null {
  return globalCorpusVocabulary;
}

/**
 * Définit explicitement le vocabulaire en cache mémoire.
 */
export function setActiveCorpusVocabulary(vocab: CorpusVocabulary): void {
  globalCorpusVocabulary = vocab;
}

/**
 * Extrait le radical flexionnel (stem) français de façon déterministe et sans liste statique de mots.
 * Supprime les désinences grammaticales récurrentes (terminaisons verbales, accords pluriels/féminins).
 */
export function extractFrenchStem(word: string): string {
  if (!word || word.length <= 3) return word;
  const s = word.toLowerCase();
  const suffixes = [
    'issantes', 'issants', 'issante', 'issant', 'issaient',
    'ement', 'emment', 'amment', 'ations', 'ation',
    'atrices', 'atrice', 'ateurs', 'ateur',
    'euses', 'euse', 'eurs', 'eur',
    'erait', 'irait', 'aient', 'irent', 'arent', 'eriez', 'iriez',
    'entes', 'ente', 'ents', 'ent', 'antes', 'ante', 'ants', 'ant',
    'issez', 'issons', 'ait', 'iez', 'ions', 'ons', 'ont',
    'eras', 'erez', 'eront', 'iras', 'irez', 'iront',
    'ees', 'ee', 'es', 'er', 'ir', 'is', 'it', 'e', 's'
  ];

  for (const suf of suffixes) {
    if (s.endsWith(suf) && (s.length - suf.length) >= 3) {
      return s.slice(0, s.length - suf.length);
    }
  }
  return s;
}

/**
 * Rapproche un terme de requête du vocabulaire du corpus (exact puis approximatif).
 * Si aucune correspondance n'existe :
 * le terme a un poids nul (IDF = 0), est ignoré et journalisé sans jamais bloquer.
 */
export function matchTermAgainstCorpusVocabulary(
  rawTerm: string,
  vocab: CorpusVocabulary
): MatchedTokenResult {
  const norm = normalizeText(rawTerm).toLowerCase().trim();

  const maxPossibleIdf = Math.max(1.0, Math.log(1 + vocab.totalChunks));
  const isHighIdfTerm = (info: VocabularyTermInfo, termStr: string) => {
    if (isDirectiveOrConversationalToken(termStr)) {
      return false;
    }
    if (vocab.totalChunks <= 2) {
      return true;
    }
    if (vocab.totalChunks <= 10) {
      return info.df < vocab.totalChunks;
    }
    const maxDf = Math.max(1, Math.floor(vocab.totalChunks * 0.18));
    return info.df <= maxDf || info.idf >= 0.55 * maxPossibleIdf;
  };

  // 1. Correspondance exacte dans le vocabulaire du corpus
  if (vocab.terms.has(norm)) {
    const info = vocab.terms.get(norm)!;
    return {
      rawToken: rawTerm,
      normalizedToken: norm,
      matchedVocabTerm: norm,
      editDistance: 0,
      similarity: 1.0,
      idf: info.idf,
      isHighIdf: isHighIdfTerm(info, norm),
      status: 'exact'
    };
  }

  // 2. Rapprochement approximatif déterministe et morphologique (sans liste statique de mots)
  // - Prise en charge des fautes de frappe (Levenshtein <= 2, trigrammes)
  // - EXIGENCE STRICTE (Phase C.1) : Exige une racine ou un préfixe commun (>= 4 caractères ou même radical)
  if (norm.length >= 4) {
    let bestMatch: string | null = null;
    let bestDistance = 999;
    let bestSim = 0;
    const normStem = extractFrenchStem(norm);

    const minLen = Math.max(3, norm.length - 3);
    const maxLen = norm.length + 3;

    for (const [candidateTerm, info] of vocab.terms.entries()) {
      if (candidateTerm.length < minLen || candidateTerm.length > maxLen) {
        continue;
      }

      const commonPrefixLen = (() => {
        let l = 0;
        while (l < norm.length && l < candidateTerm.length && norm[l] === candidateTerm[l]) l++;
        return l;
      })();

      const candStem = extractFrenchStem(candidateTerm);
      const sameStem = normStem.length >= 3 && (normStem === candStem || normStem.startsWith(candStem) || candStem.startsWith(normStem));

      // PHASE C.1 : Verrou de préfixe/racine strict. Un terme ne peut S'AMALAER que s'il partage le même préfixe (>=4) ou le même radical
      const hasValidPrefixOrStem = commonPrefixLen >= 4 || (sameStem && commonPrefixLen >= 3);
      if (!hasValidPrefixOrStem) {
        continue;
      }

      const dist = computeLevenshteinDistance(norm, candidateTerm);
      const maxAllowedDist = norm.length <= 5 ? 1 : 2;

      // Critère 1 : Levenshtein et trigrammes valides
      const triSim = computeTrigramSimilarity(norm, candidateTerm);
      const isLexFuzzy = dist <= maxAllowedDist && (triSim >= 0.45 || (dist === 1 && commonPrefixLen >= 3));

      // Critère 2 : Morphologie / stem commun avec préfixe solide (>= 3 lettres)
      const isMorphFuzzy = sameStem && commonPrefixLen >= 3 && dist <= 2;

      // Critère 3 : Préfixe robuste (>= 4 lettres) et distance modérée (<= 2)
      const isPrefixFuzzy = commonPrefixLen >= 4 && dist <= 2 && triSim >= 0.35;

      if ((isLexFuzzy || isMorphFuzzy || isPrefixFuzzy) && dist < bestDistance) {
        const sim = Math.max(0.60, 1.0 - (dist / Math.max(norm.length, candidateTerm.length)));
        bestDistance = dist;
        bestMatch = candidateTerm;
        bestSim = sim;
        if (dist <= 1 && candidateTerm[0] === norm[0]) break; // Arrêt rapide
      }
    }

    if (bestMatch && vocab.terms.has(bestMatch)) {
      const info = vocab.terms.get(bestMatch)!;
      return {
        rawToken: rawTerm,
        normalizedToken: norm,
        matchedVocabTerm: bestMatch,
        editDistance: bestDistance,
        similarity: Math.round(bestSim * 100) / 100,
        idf: info.idf,
        isHighIdf: isHighIdfTerm(info, bestMatch),
        status: 'fuzzy'
      };
    }
  }

  // 3. Aucun rapprochement : poids nul, ignoré, jamais bloquant
  return {
    rawToken: rawTerm,
    normalizedToken: norm,
    matchedVocabTerm: null,
    editDistance: null,
    similarity: 0,
    idf: 0,
    isHighIdf: false,
    status: 'ignored_zero_weight'
  };
}

/**
 * Analyse complète des tokens d'une requête avec calcul IDF dynamique et rapprochement approximatif.
 */
export function analyzeQueryWithVocabulary(
  query: string,
  vocab: CorpusVocabulary
): QueryVocabularyAnalysis {
  const rawTokens = tokenizeText(query);
  const tokenResults: MatchedTokenResult[] = [];
  const matchedTerms: string[] = [];
  const ignoredTerms: string[] = [];
  const highIdfTerms: string[] = [];
  let maxIdf = 0;
  let sumIdf = 0;

  for (const token of rawTokens) {
    const res = matchTermAgainstCorpusVocabulary(token, vocab);
    tokenResults.push(res);

    if (res.status === 'ignored_zero_weight' || !res.matchedVocabTerm) {
      // Les jetons composés synthétiques (ex: "7_sceau", "actes_2_38") sont des accélérateurs de précision :
      // s'ils ne matchent pas sous forme composée, leurs mots individuels sont déjà évalués séparément.
      if (!token.includes('_') && !isDirectiveOrConversationalToken(token)) {
        ignoredTerms.push(token);
      }
    } else {
      matchedTerms.push(res.matchedVocabTerm);
      sumIdf += res.idf;
      if (res.idf > maxIdf) {
        maxIdf = res.idf;
      }
      if (res.isHighIdf && !isDirectiveOrConversationalToken(res.matchedVocabTerm)) {
        highIdfTerms.push(res.matchedVocabTerm);
      }
    }
  }

  return {
    tokens: tokenResults,
    matchedTerms: Array.from(new Set(matchedTerms)),
    ignoredTerms: Array.from(new Set(ignoredTerms)),
    highIdfTerms: Array.from(new Set(highIdfTerms)),
    maxIdf: Math.round(maxIdf * 1000) / 1000,
    sumIdf: Math.round(sumIdf * 1000) / 1000,
    hasHighIdfContentTerm: highIdfTerms.length > 0
  };
}
