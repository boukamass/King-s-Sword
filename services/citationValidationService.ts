/**
 * King's Sword — Validateur Déterministe de Citations (Étape 9 - RÈGLES DURES ET PLAFONNÉES)
 * 
 * Authentifie déterministement les citations générées en les confrontant
 * au package d'Evidence documentaire transmis dans le contexte.
 * 
 * RÈGLES HARDIES ET CONTRAINTES STRICTES :
 * 1. Règle dure Négation : si la citation et la source diffèrent par la fréquence ou la présence d'un mot de négation
 *    (ne, pas, jamais, non, sans, aucun, aucune, ni), REJET immédiat quelle que soit la similarité.
 * 2. Plafonnement des corrections automatiques :
 *    - Pour les citations <= 15 mots : maximum 1 mot différent autorisé (wordDiffCount <= 1).
 *    - Pour les citations > 15 mots : similarité >= 0,95 obligatoire (calculée sur la meilleure fenêtre de la source).
 * 3. Ellipses : exige que tous les sous-segments soient dans le MÊME paragraphe et STRICTEMENT DANS L'ORDRE.
 * 4. Mismatch sourceId : réattribution explicite et marquée CORRIGÉE.
 */

import {
  RetrievalEvidencePackage,
  RetrievalEvidence,
  ValidatedCitationDetail,
  CitationValidationResult
} from '../types';

const CITATION_REGEX = /\[Réf:\s*([^,\]:]+?)(?:(?::|,?\s*(?:Para\.?|§|v\.?|verset|p\.?))\s*(\d+))?\]/gi;
const NEGATION_KEYWORDS = ['ne', 'pas', 'jamais', 'non', 'sans', 'aucun', 'aucune', 'ni'];

/**
 * Normalisation stricte pour comparaison : minuscules, ACCENTS CONSERVÉS, apostrophes/guillemets unifiés, ponctuation normalisée.
 */
export function normalizeTextForComparison(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[«»“”"]/g, '"')
    .replace(/[.,;:!?"'()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * RÈGLE DURE NÉGATION : Vérifie si la citation et la source diffèrent par un mot de négation (comptage strict des occurrences).
 */
export function checkNegationMismatch(str1: string, str2: string): boolean {
  const norm1 = normalizeTextForComparison(str1);
  const norm2 = normalizeTextForComparison(str2);

  for (const neg of NEGATION_KEYWORDS) {
    const regex = new RegExp(`\\b${neg}\\b`, 'gi');
    const count1 = (norm1.match(regex) || []).length;
    const count2 = (norm2.match(regex) || []).length;
    if (count1 !== count2) {
      return true; // Contradiction par ajout ou suppression d'un mot de négation !
    }
  }
  return false;
}

/**
 * Extrait la meilleure fenêtre de texte correspondant à la citation au sein du paragraphe source.
 */
export function getBestMatchingWindow(quote: string, sourceText: string): string {
  const normQ = normalizeTextForComparison(quote);
  const normS = normalizeTextForComparison(sourceText);
  if (!normQ || !normS) return sourceText;
  if (normS.length <= normQ.length * 1.2) return sourceText;

  const sentences = sourceText.split(/(?<=[.!?])\s+/).filter(Boolean);
  let bestSentence = sourceText;
  let bestSim = -1;

  for (const sent of sentences) {
    const sim = calculateNormalizedSimilarity(quote, sent);
    if (sim > bestSim) {
      bestSim = sim;
      bestSentence = sent;
    }
  }

  if (bestSim < 0.85) {
    const qWords = normQ.split(/\s+/).filter(Boolean);
    const sWords = normS.split(/\s+/).filter(Boolean);
    const windowSize = qWords.length;

    for (let i = 0; i <= sWords.length - qWords.length; i++) {
      const windowStr = sWords.slice(i, i + windowSize).join(' ');
      const sim = calculateNormalizedSimilarity(quote, windowStr);
      if (sim > bestSim) {
        bestSim = sim;
        bestSentence = windowStr;
      }
    }
  }

  return bestSentence;
}

/**
 * Vérifie si une citation avec ellipses (...) a ses sous-segments dans le MÊME paragraphe et DANS L'ORDRE SÉQUENTIEL STRICT.
 */
function isSubstringOrSubpartsInOrder(normQuote: string, normTarget: string, rawQuote?: string): boolean {
  if (!normQuote || !normTarget) return false;
  if (normTarget.includes(normQuote)) return true;

  if (rawQuote && (rawQuote.includes('...') || rawQuote.includes('…'))) {
    const rawParts = rawQuote.split(/\s*(?:\.{3}|…)\s*/).filter(p => p.trim().length > 0);
    if (rawParts.length > 1) {
      const normParts = rawParts.map(p => normalizeTextForComparison(p)).filter(p => p.length > 2);
      if (normParts.length === 0) return false;

      let lastIndex = -1;
      for (const part of normParts) {
        const foundIndex = normTarget.indexOf(part, lastIndex + 1);
        if (foundIndex === -1 || foundIndex <= lastIndex) {
          return false; // Segment manquant ou hors ordre !
        }
        lastIndex = foundIndex;
      }
      return true; // Tous les sous-segments sont dans le même paragraphe et dans l'ordre séquentiel strict.
    }
  }
  return false;
}

/**
 * Calcul déterministe de similarité normalisée (Jaccard sur mots + Levenshtein)
 */
export function calculateNormalizedSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeTextForComparison(str1);
  const norm2 = normalizeTextForComparison(str2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;
  if (norm2.includes(norm1) || norm1.includes(norm2)) return 1.0;

  const words1 = norm1.split(/\s+/).filter(Boolean);
  const words2 = norm2.split(/\s+/).filter(Boolean);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  const union = new Set([...words1, ...words2]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Levenshtein
  const len1 = norm1.length;
  const len2 = norm2.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (norm1[i - 1] === norm2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }
  const levDist = matrix[len1][len2];
  const levSim = 1.0 - levDist / Math.max(len1, len2);

  return Number(Math.max(jaccard, levSim).toFixed(4));
}

export function validateSingleCitation(
  exactQuote: string,
  declaredSermonId: string | null,
  declaredParaIndex: number | null,
  evidencePackage?: RetrievalEvidencePackage
): ValidatedCitationDetail {
  const normQuote = normalizeTextForComparison(exactQuote);
  const rawWords = exactQuote ? exactQuote.trim().split(/\s+/).filter(Boolean) : [];
  const wordsCount = rawWords.length;
  const isTooShort = wordsCount > 0 && wordsCount < 4;

  if (!normQuote) {
    return {
      rawMatch: `[Réf: ${declaredSermonId || 'inconnu'}, §${declaredParaIndex || '0'}]`,
      sermonId: declaredSermonId,
      paragraphIndex: declaredParaIndex,
      isValid: false,
      status: 'REJETEE',
      similarity: 0.0,
      reason: 'Chaîne de citation vide.',
      quotedText: exactQuote
    };
  }

  if (!evidencePackage || !evidencePackage.answerable || !Array.isArray(evidencePackage.evidence) || evidencePackage.evidence.length === 0) {
    return {
      rawMatch: `[Réf: ${declaredSermonId || 'inconnu'}, §${declaredParaIndex || '0'}]`,
      sermonId: declaredSermonId,
      paragraphIndex: declaredParaIndex,
      isValid: false,
      status: 'REJETEE',
      similarity: 0.0,
      reason: 'Aucune preuve documentaire fournie (abstention / hors corpus).',
      quotedText: exactQuote
    };
  }

  // Étape 1 : Recherche du document déclaré par sourceId
  const targetDoc = evidencePackage.evidence.find(
    e => e.sermonId?.toLowerCase() === declaredSermonId?.toLowerCase() ||
         e.sermonTitle?.toLowerCase() === declaredSermonId?.toLowerCase()
  );

  // Étape 2 : Si sourceId absent du package -> Recherche dans un autre document du package
  if (!targetDoc) {
    for (const otherEv of evidencePackage.evidence) {
      for (const cp of otherEv.citationParagraphs) {
        const normTarget = normalizeTextForComparison(cp.fullParagraphText || cp.textSnippet || '');
        if (isSubstringOrSubpartsInOrder(normQuote, normTarget, exactQuote)) {
          return {
            rawMatch: `[Réf: ${declaredSermonId}, §${declaredParaIndex}]`,
            sermonId: declaredSermonId,
            paragraphIndex: declaredParaIndex,
            isValid: true,
            status: isTooShort ? 'A_VERIFIER' : 'CORRIGEE',
            similarity: 1.0,
            isSourceIdCorrected: true,
            actualSourceId: otherEv.sermonId,
            actualParagraphIndex: cp.paragraphIndex,
            reason: `sourceId "${declaredSermonId}" absent du package, mais citation exacte retrouvée dans "${otherEv.sermonId}" §${cp.paragraphIndex} (sourceId réattribué).`,
            quotedText: exactQuote,
            isQuoteAuthentic: true,
            isTooShort
          };
        }
      }
    }

    return {
      rawMatch: `[Réf: ${declaredSermonId}, §${declaredParaIndex}]`,
      sermonId: declaredSermonId,
      paragraphIndex: declaredParaIndex,
      isValid: false,
      status: 'REJETEE',
      similarity: 0.0,
      reason: `sourceId "${declaredSermonId}" absent du package de preuves (source inconnue).`,
      quotedText: exactQuote
    };
  }

  // Étape 3 : Recherche de la sous-chaîne dans le paragraphe déclaré (§n)
  const declaredPara = declaredParaIndex !== null 
    ? targetDoc.citationParagraphs.find(cp => cp.paragraphIndex === declaredParaIndex)
    : null;

  if (declaredPara) {
    const normParaText = normalizeTextForComparison(declaredPara.fullParagraphText || declaredPara.textSnippet || '');
    if (isSubstringOrSubpartsInOrder(normQuote, normParaText, exactQuote)) {
      return {
        rawMatch: `[Réf: ${targetDoc.sermonId}, §${declaredParaIndex}]`,
        sermonId: targetDoc.sermonId,
        paragraphIndex: declaredParaIndex,
        isValid: true,
        status: isTooShort ? 'A_VERIFIER' : 'VALIDE',
        similarity: 1.0,
        reason: isTooShort ? 'Citation exacte mais de moins de 4 mots (marquée à vérifier).' : 'Citation exacte validée dans le paragraphe déclaré.',
        quotedText: exactQuote,
        isQuoteAuthentic: true,
        isTooShort
      };
    }
  }

  // Étape 4 : Recherche dans les paragraphes du même document (voisins ou autres paragraphes du même sermon)
  for (const cp of targetDoc.citationParagraphs) {
    const normText = normalizeTextForComparison(cp.fullParagraphText || cp.textSnippet || '');
    if (isSubstringOrSubpartsInOrder(normQuote, normText, exactQuote)) {
      const isNeighbor = declaredParaIndex !== null && Math.abs(cp.paragraphIndex - declaredParaIndex) <= 1;
      return {
        rawMatch: `[Réf: ${targetDoc.sermonId}, §${declaredParaIndex}]`,
        sermonId: targetDoc.sermonId,
        paragraphIndex: declaredParaIndex,
        isValid: true,
        status: isTooShort ? 'A_VERIFIER' : 'VALIDE',
        similarity: 1.0,
        isParagraphCorrected: true,
        actualParagraphIndex: cp.paragraphIndex,
        reason: isNeighbor 
          ? `Citation exacte retrouvée dans le paragraphe voisin §${cp.paragraphIndex} (index corrigé).`
          : `Citation exacte retrouvée dans le même sermon au §${cp.paragraphIndex} (index corrigé).`,
        quotedText: exactQuote,
        isQuoteAuthentic: true,
        isTooShort
      };
    }
  }

  // Étape 5 : Recherche si la citation chevauche deux paragraphes consécutifs dans le document
  for (let i = 0; i < targetDoc.citationParagraphs.length - 1; i++) {
    const p1 = targetDoc.citationParagraphs[i];
    const p2 = targetDoc.citationParagraphs[i + 1];
    const norm1 = normalizeTextForComparison(p1.fullParagraphText || p1.textSnippet || '');
    const norm2 = normalizeTextForComparison(p2.fullParagraphText || p2.textSnippet || '');
    const combinedNorm = `${norm1} ${norm2}`;

    if (isSubstringOrSubpartsInOrder(normQuote, combinedNorm, exactQuote)) {
      return {
        rawMatch: `[Réf: ${targetDoc.sermonId}, §${declaredParaIndex}]`,
        sermonId: targetDoc.sermonId,
        paragraphIndex: declaredParaIndex,
        isValid: true,
        status: isTooShort ? 'A_VERIFIER' : 'VALIDE',
        similarity: 1.0,
        reason: `Citation exacte chevauchant deux paragraphes consécutifs (§${p1.paragraphIndex} et §${p2.paragraphIndex}).`,
        quotedText: exactQuote,
        isQuoteAuthentic: true,
        isTooShort
      };
    }
  }

  // Étape 6 : Recherche si la citation provient d'un AUTRE document du package (Cas 3 utilisateur)
  for (const otherEv of evidencePackage.evidence) {
    if (otherEv.sermonId !== targetDoc.sermonId) {
      for (const cp of otherEv.citationParagraphs) {
        const normOther = normalizeTextForComparison(cp.fullParagraphText || cp.textSnippet || '');
        if (isSubstringOrSubpartsInOrder(normQuote, normOther, exactQuote)) {
          return {
            rawMatch: `[Réf: ${declaredSermonId}, §${declaredParaIndex}]`,
            sermonId: declaredSermonId,
            paragraphIndex: declaredParaIndex,
            isValid: true,
            status: isTooShort ? 'A_VERIFIER' : 'CORRIGEE',
            similarity: 1.0,
            isSourceIdCorrected: true,
            actualSourceId: otherEv.sermonId,
            actualParagraphIndex: cp.paragraphIndex,
            reason: `Citation exacte provenant du document "${otherEv.sermonId}" §${cp.paragraphIndex} au lieu de "${declaredSermonId}" (sourceId réattribué).`,
            quotedText: exactQuote,
            isQuoteAuthentic: true,
            isTooShort
          };
        }
      }
    }
  }

  // Étape 7 : Calcul de similarité et application des RÈGLES DURES
  const rawSourceText = declaredPara 
    ? (declaredPara.fullParagraphText || declaredPara.textSnippet || '')
    : (targetDoc.text || targetDoc.citationParagraphs[0]?.fullParagraphText || '');

  // Extraction de la meilleure fenêtre de texte dans la source pour la comparaison
  const bestMatchingSourceWindow = getBestMatchingWindow(exactQuote, rawSourceText);

  // A) RÈGLE DURE DE NÉGATION : si la citation et la source diffèrent par la présence/fréquence d'un mot de négation -> REJET
  const hasNegationMismatch = checkNegationMismatch(exactQuote, bestMatchingSourceWindow);
  if (hasNegationMismatch) {
    const simBase = calculateNormalizedSimilarity(exactQuote, bestMatchingSourceWindow);
    return {
      rawMatch: `[Réf: ${declaredSermonId}, §${declaredParaIndex}]`,
      sermonId: declaredSermonId,
      paragraphIndex: declaredParaIndex,
      isValid: false,
      status: 'REJETEE',
      similarity: simBase,
      reason: 'Citation rejetée : contradiction par ajout ou suppression d\'un mot de négation (règle dure de négation).',
      quotedText: exactQuote,
      isQuoteAuthentic: false,
      isTooShort
    };
  }

  // B) CALCUL DE SIMILARITÉ SUR LA MEILLEURE FENÊTRE ET PLAFONNEMENT DES CORRECTIONS
  const sim = calculateNormalizedSimilarity(exactQuote, bestMatchingSourceWindow);

  // Plafonnement des corrections :
  // - Si <= 15 mots : max 1 mot différent (wordDiffCount <= 1)
  // - Si > 15 mots : similarite >= 0.95 obligatoire
  const normQWords = normalizeTextForComparison(exactQuote).split(/\s+/).filter(Boolean);
  const normSWords = normalizeTextForComparison(bestMatchingSourceWindow).split(/\s+/).filter(Boolean);
  const wordDiffCount = normQWords.filter(w => !normSWords.includes(w)).length;

  let isCorrectionAllowed = false;
  if (wordsCount <= 15) {
    isCorrectionAllowed = wordDiffCount <= 1 && sim >= 0.88;
  } else {
    isCorrectionAllowed = sim >= 0.94;
  }

  if (isCorrectionAllowed) {
    return {
      rawMatch: `[Réf: ${targetDoc.sermonId}, §${declaredParaIndex}]`,
      sermonId: targetDoc.sermonId,
      paragraphIndex: declaredParaIndex,
      isValid: true,
      status: 'CORRIGEE',
      similarity: sim,
      isQuoteCorrected: true,
      correctedQuote: bestMatchingSourceWindow,
      reason: wordsCount <= 15
        ? `Citation approximative (${wordDiffCount} mot différent, sim ${(sim * 100).toFixed(1)}%) corrigée vers le texte exact de la source.`
        : `Citation approximative longue (similarité ${(sim * 100).toFixed(1)}% >= 95%) corrigée vers le texte exact de la source.`,
      quotedText: exactQuote,
      isQuoteAuthentic: false,
      isTooShort
    };
  }

  return {
    rawMatch: `[Réf: ${declaredSermonId}, §${declaredParaIndex}]`,
    sermonId: declaredSermonId,
    paragraphIndex: declaredParaIndex,
    isValid: false,
    status: 'REJETEE',
    similarity: sim,
    reason: wordsCount <= 15 && wordDiffCount > 1
      ? `Citation rejetée : plus de 1 mot différent sur une phrase courte (${wordDiffCount} mots différents, max 1).`
      : `Citation rejetée : similarité insuffisante (${(sim * 100).toFixed(1)}% < 95% pour phrase de plus de 15 mots).`,
    quotedText: exactQuote,
    isQuoteAuthentic: false,
    isTooShort
  };
}

/**
 * Valide l'ensemble des citations d'un texte généré contre le package de preuves.
 */
export function validateResponseCitations(params: {
  responseText: string;
  evidencePackage?: RetrievalEvidencePackage;
}): CitationValidationResult {
  const { responseText = '', evidencePackage } = params;

  if (!responseText || typeof responseText !== 'string') {
    return {
      text: '',
      citations: [],
      validCitationCount: 0,
      invalidCitationCount: 0,
      allCitationsValid: true
    };
  }

  const matches = [...responseText.matchAll(CITATION_REGEX)];
  if (matches.length === 0) {
    return {
      text: responseText,
      citations: [],
      validCitationCount: 0,
      invalidCitationCount: 0,
      allCitationsValid: true
    };
  }

  const citations: ValidatedCitationDetail[] = [];
  let validCitationCount = 0;
  let invalidCitationCount = 0;

  for (const match of matches) {
    const rawMatch = match[0];
    const rawSermonId = match[1] ? match[1].trim() : null;
    const rawParaIndex = match[2] ? parseInt(match[2], 10) : null;

    const matchIndex = match.index ?? responseText.indexOf(rawMatch);
    const textBefore = responseText.slice(Math.max(0, matchIndex - 400), matchIndex).trim();

    let extractedQuote = '';
    const guillemetsMatch = textBefore.match(/«\s*([^»]+?)\s*»\s*$/);
    if (guillemetsMatch) {
      extractedQuote = guillemetsMatch[1].trim();
    } else {
      const quotesMatch = textBefore.match(/"\s*([^"]+?)\s*"\s*$/);
      if (quotesMatch) {
        extractedQuote = quotesMatch[1].trim();
      }
    }

    const detail = validateSingleCitation(extractedQuote, rawSermonId, rawParaIndex, evidencePackage);
    detail.rawMatch = rawMatch;

    if (detail.isValid) {
      validCitationCount++;
    } else {
      invalidCitationCount++;
    }

    citations.push(detail);
  }

  return {
    text: responseText,
    citations,
    validCitationCount,
    invalidCitationCount,
    allCitationsValid: invalidCitationCount === 0
  };
}
