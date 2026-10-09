/**
 * King's Sword — Second Filtre Local Optionnel (Phase de Clôture)
 * 
 * Filtre local de second niveau (derrière un flag désactivé par défaut) :
 * 1. Couverture IDF pondérée des termes substantiels de la requête dans le passage de tête.
 * 2. Accord de rang entre BM25 et E5 (concordance du retrieval hybride).
 * 
 * RÈGLE FONDAMENTALE :
 * Ce filtre est strictement optionnel et désactivé par défaut (enableSecondStageFilter: false)
 * pour ne pas altérer le comportement natif de l'application ni les seuils d'Answerability.
 */

import { SermonChunk, RankedCandidate } from '../types';
import { getCorpusTermIdf } from './corpusVocabularyService';
import { extractSubstantiveQueryTerms } from './rerankingService';
import { normalizeText } from '../utils/textUtils';

export interface SecondStageFilterOptions {
  enabled?: boolean; // false par défaut
  idfThreshold?: number; // seuil de couverture IDF minimal (ex: 0.35)
  agreementThreshold?: number; // seuil de concordance de rang (ex: 0.20)
  compositeThreshold?: number; // seuil composite (ex: 0.40)
}

export interface SecondStageEvaluationResult {
  passed: boolean;
  idfCoverage: number;
  rankAgreement: number;
  compositeScore: number;
  topLexicalRank: number | null;
  topVectorRank: number | null;
  matchedTerms: string[];
  totalSubstantiveTerms: number;
}

/**
 * Calcule la couverture IDF des termes de la requête dans un passage textuel.
 */
export function calculateIdfCoverage(query: string, passageText: string): {
  coverage: number;
  matchedTerms: string[];
  totalTerms: string[];
} {
  const normPassage = normalizeText(passageText || '');
  const terms = extractSubstantiveQueryTerms(query);
  if (terms.length === 0) {
    return { coverage: 1.0, matchedTerms: [], totalTerms: [] };
  }

  let totalIdf = 0;
  let matchedIdf = 0;
  const matchedTerms: string[] = [];

  for (const term of terms) {
    const idf = getCorpusTermIdf(term);
    totalIdf += idf;
    if (normPassage.includes(term)) {
      matchedIdf += idf;
      matchedTerms.push(term);
    }
  }

  const coverage = totalIdf > 0 ? (matchedIdf / totalIdf) : 0;
  return {
    coverage: Math.min(1.0, Math.max(0.0, coverage)),
    matchedTerms,
    totalTerms: terms
  };
}

/**
 * Calcule la concordance de rang entre BM25 et E5 sur les candidats.
 */
export function calculateRankAgreement(
  topCandidate: RankedCandidate | null | undefined,
  candidates: RankedCandidate[] = []
): {
  agreement: number;
  topLexicalRank: number | null;
  topVectorRank: number | null;
} {
  if (!topCandidate || candidates.length === 0) {
    return { agreement: 0, topLexicalRank: null, topVectorRank: null };
  }

  const lexRank = topCandidate.lexicalRank;
  const vecRank = topCandidate.vectorRank;

  if (lexRank === null || vecRank === null) {
    return { agreement: 0, topLexicalRank: lexRank, topVectorRank: vecRank };
  }

  // Concordance inverse de la distance de rang
  const rankDiff = Math.abs(lexRank - vecRank);
  const agreement = 1.0 / (1.0 + (rankDiff / 5.0));

  return {
    agreement: Math.min(1.0, Math.max(0.0, agreement)),
    topLexicalRank: lexRank,
    topVectorRank: vecRank
  };
}

/**
 * Évalue le second filtre local sur un ensemble de candidats.
 */
export function evaluateSecondStageFilter(
  query: string,
  candidates: RankedCandidate[],
  options: SecondStageFilterOptions = {}
): SecondStageEvaluationResult {
  const {
    compositeThreshold = 0.35,
    idfThreshold = 0.30
  } = options;

  if (!candidates || candidates.length === 0) {
    return {
      passed: false,
      idfCoverage: 0,
      rankAgreement: 0,
      compositeScore: 0,
      topLexicalRank: null,
      topVectorRank: null,
      matchedTerms: [],
      totalSubstantiveTerms: 0
    };
  }

  const topCandidate = candidates[0];
  const topText = topCandidate.chunk?.text || '';

  const { coverage: idfCoverage, matchedTerms, totalTerms } = calculateIdfCoverage(query, topText);
  const { agreement: rankAgreement, topLexicalRank, topVectorRank } = calculateRankAgreement(topCandidate, candidates);

  // Score composite combinant la couverture IDF (65%) et l'accord de rang BM25/E5 (35%)
  const compositeScore = (idfCoverage * 0.65) + (rankAgreement * 0.35);

  const passed = compositeScore >= compositeThreshold && idfCoverage >= idfThreshold;

  return {
    passed,
    idfCoverage,
    rankAgreement,
    compositeScore,
    topLexicalRank,
    topVectorRank,
    matchedTerms,
    totalSubstantiveTerms: totalTerms.length
  };
}
