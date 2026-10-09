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
  // Verbes et formules de requête conversationnelle
  'voudrais', 'aimerais', 'savoir', 'sais', 'peux', 'pouvez', 'pourrais', 'pourriez',
  'dis', 'dire', 'dit', 'disait', 'donne', 'donnez', 'fais', 'faites', 'montre', 'montrez',
  'explique', 'expliquez', 'expliquer', 'comprendre', 'parle', 'parlez', 'parler',
  'voir', 'croire', 'pense', 'pensez', 'cherche', 'chercher', 'recherche',
  // Politesse, pronoms et salutations
  'sil', 'te', 'vous', 'plait', 'svp', 'stp', 'merci', 'moi', 'nous', 'lui', 'leur', 'eux',
  'bonjour', 'bonsoir', 'salut', 'question', 'reponse', 'demande',
  // Directives d'étude, de format ou d'ampleur
  'etude', 'plan', 'resume', 'synthese', 'analyse', 'panorama', 'apercu', 'detail', 'details',
  'detaille', 'detaillee', 'detailles', 'detaillees', 'approfondi', 'approfondie', 'approfondis', 'approfondies',
  'complet', 'complete', 'complets', 'completes', 'exhaustif', 'exhaustive', 'exhaustifs', 'exhaustives',
  'tout', 'tous', 'toute', 'toutes', 'absolument', 'ensemble', 'general', 'generale',
  'sens', 'signification', 'contexte', 'origine', 'histoire', 'definition', 'enseignement',
  // Références génériques à l'orateur / corpus
  'frere', 'fr', 'branham', 'william', 'marion', 'prophete', 'sermon', 'sermons', 'predicateur',
  // Mots interrogatifs et marqueurs de discours/syntaxe
  'pourquoi', 'comment', 'selon', 'quand', 'lorsque',
  // Anglais (requêtes mixtes ou bilingues)
  'can', 'you', 'explain', 'tell', 'give', 'detail', 'detailed', 'study', 'overview', 'summary',
  'comprehensive', 'brother', 'prophet'
]);

export function isDirectiveOrConversationalToken(token: string): boolean {
  if (!token) return false;
  const norm = normalizeText(token).toLowerCase().trim();
  if (CONVERSATIONAL_DIRECTIVE_TOKENS.has(norm)) return true;

  // Détection automatique par radical des consignes rédactionnelles, métadonnées et adjectifs de portée
  const stem = extractFrenchStem(norm);
  const directiveStems = [
    'exhaustif', 'approfond', 'detaill', 'complet', 'synthes', 'analys', 'resume', 'recherche',
    'explication', 'enseignement', 'presentation', 'panorama', 'apercu', 'etude', 'reponse',
    'question', 'demande', 'citation', 'passage', 'sermon', 'predicateur', 'propos', 'contexte'
  ];
  if (directiveStems.some(s => stem.startsWith(s) || norm.startsWith(s))) {
    return true;
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
 * Tokenise un texte en mots normalisés (minuscules, sans accents, sans ponctuation).
 * Sépare proprement les articles et prépositions élidés (ex: l'église -> eglise, léglise -> eglise).
 */
export function tokenizeText(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  // 1. Découpage explicite des apostrophes d'élision (ex: l'église -> l eglise, d'or -> d or)
  const withSeparatedApostrophes = text.replace(/([ldqujcsnmtLDQUJCSNMT])['`’]([\p{L}\p{N}]+)/gu, '$1 $2');
  const normalized = normalizeText(withSeparatedApostrophes);
  const words = normalized
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
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
export function buildCorpusVocabulary(chunks: Array<{ text: string }>): CorpusVocabulary {
  const totalChunks = Math.max(1, chunks.length);
  const docFrequency = new Map<string, number>();
  let totalWords = 0;

  for (const chunk of chunks) {
    if (!chunk || !chunk.text) continue;
    const tokens = tokenizeText(chunk.text);
    totalWords += tokens.length;
    const uniqueTokensInChunk = new Set(tokens);
    for (const token of uniqueTokensInChunk) {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
    }
  }

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

  globalCorpusVocabulary = vocab;
  return vocab;
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
  // - Prise en charge des flexions verbales et adjectivales (radicaux / stems communs)
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

      const sameFirstChar = candidateTerm[0] === norm[0];
      const isElisionOrPrefixVariant = !sameFirstChar && (
        norm.startsWith('l' + candidateTerm) || 
        norm.startsWith('d' + candidateTerm) ||
        norm.startsWith('c' + candidateTerm) ||
        candidateTerm.startsWith('l' + norm) ||
        candidateTerm.startsWith('d' + norm) ||
        (norm.length >= 5 && candidateTerm.length >= 5 && (norm.slice(1) === candidateTerm || candidateTerm.slice(1) === norm))
      );
      if (!sameFirstChar && !isElisionOrPrefixVariant && (norm.length < 8 || Math.abs(candidateTerm.length - norm.length) > 1)) {
        continue;
      }

      const dist = computeLevenshteinDistance(norm, candidateTerm);
      const maxAllowedDist = norm.length <= 5 ? 1 : 2;
      const candStem = extractFrenchStem(candidateTerm);
      const sameStem = normStem.length >= 3 && (normStem === candStem || normStem.startsWith(candStem) || candStem.startsWith(normStem));
      const commonPrefixLen = (() => {
        let l = 0;
        while (l < norm.length && l < candidateTerm.length && norm[l] === candidateTerm[l]) l++;
        return l;
      })();

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
        if (dist <= 1 && sameFirstChar) break; // Arrêt rapide
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
      if (!isDirectiveOrConversationalToken(token)) {
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
