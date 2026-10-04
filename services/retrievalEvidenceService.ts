/**
 * King's Sword — Adaptateur Retrieval → Evidence (Phase 2F.1)
 * 
 * Ce module transforme les résultats bruts du pipeline de retrieval :
 * HYBRID/RRF → RERANKING → ANSWERABILITY
 * en un format d'Evidence documentaire propre, immuable et validé par rapport
 * aux sermons originaux.
 * 
 * RÈGLES FONDAMENTALES :
 * 1. Le chunk est uniquement une unité de retrieval (découpage technique).
 * 2. La source de vérité absolue reste : SERMON -> PARAGRAPHE ORIGINAL.
 * 3. Les citations ne font JAMAIS référence à chunkId mais uniquement à :
 *    [Réf: SERMON_ID, §N] ou [Réf: SERMON_ID, Para. N].
 * 4. Si answerable = false (abstention / hors corpus), le service retourne
 *    strictement { answerable: false, evidence: [] }.
 */

import {
  Sermon,
  HybridSearchResult,
  RerankedSearchResult,
  AnswerabilityAssessment,
  RetrievalEvidence,
  RetrievalEvidencePackage,
  EvidenceParagraphCitation
} from '../types';
import { splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';

/**
 * Formate une citation de paragraphe pour l'Evidence et les futurs générateurs.
 * INTERDICTION FORMELLE d'utiliser chunkId dans la citation.
 */
export function formatParagraphCitation(sermonId: string, paragraphIndex: number): string {
  if (!sermonId || typeof sermonId !== 'string') {
    throw new Error('sermonId invalide pour la génération de citation.');
  }
  if (typeof paragraphIndex !== 'number' || paragraphIndex <= 0 || !Number.isInteger(paragraphIndex)) {
    throw new Error(`paragraphIndex invalide (${paragraphIndex}) pour le sermon ${sermonId}.`);
  }
  return `[Réf: ${sermonId.trim()}, §${paragraphIndex}]`;
}

/**
 * Vérifie et convertit un candidat reranké / hybride en Evidence validée.
 * Rejette strictement tout candidat altéré, tronqué ou incohérent.
 */
export function validateAndConvertCandidateToEvidence(params: {
  candidate: RerankedSearchResult | HybridSearchResult;
  rank: number;
  originalSermonsMap: Map<string, Sermon>;
}): RetrievalEvidence | null {
  const { candidate, rank, originalSermonsMap } = params;

  if (!candidate) return null;

  const chunk = candidate.chunk || candidate;

  // 1. Validation de base des champs structurels
  const chunkId = typeof chunk.chunkId === 'string' ? chunk.chunkId.trim() : '';
  const sermonId = typeof chunk.sermonId === 'string' ? chunk.sermonId.trim() : '';
  const sermonTitle = typeof chunk.sermonTitle === 'string' ? chunk.sermonTitle.trim() : '';
  const text = typeof chunk.text === 'string' ? chunk.text.trim() : '';
  const paragraphIds = Array.isArray(chunk.paragraphIds) ? chunk.paragraphIds : [];
  const startParagraph = typeof chunk.startParagraph === 'number' ? chunk.startParagraph : 0;
  const endParagraph = typeof chunk.endParagraph === 'number' ? chunk.endParagraph : 0;

  if (!chunkId || !sermonId || !text || paragraphIds.length === 0) {
    return null;
  }

  if (startParagraph <= 0 || endParagraph < startParagraph) {
    return null;
  }

  // 2. Vérification d'existence dans le corpus original
  const originalSermon = originalSermonsMap.get(sermonId);
  if (!originalSermon || !originalSermon.text) {
    return null;
  }

  // 3. Découpage et extraction des paragraphes originaux
  const originalParagraphs = splitSermonIntoParagraphs(originalSermon.text);
  const citationParagraphs: EvidenceParagraphCitation[] = [];

  for (const pNum of paragraphIds) {
    let originalParaText: string | null = null;

    for (let idx = 0; idx < originalParagraphs.length; idx++) {
      const rawP = originalParagraphs[idx];
      const leading = extractLeadingParagraphNumber(rawP);
      const actualNum = leading !== null ? leading : idx + 1;

      if (actualNum === pNum) {
        originalParaText = rawP.trim();
        break;
      }
    }

    // Le paragraphe référencé doit obligatoirement exister dans le sermon original
    if (originalParaText === null || originalParaText.length === 0) {
      return null;
    }

    const snippet = originalParaText.length > 220
      ? originalParaText.slice(0, 220).trim() + '...'
      : originalParaText;

    citationParagraphs.push({
      paragraphIndex: pNum,
      formattedCitation: formatParagraphCitation(sermonId, pNum),
      textSnippet: snippet,
      isAuthentic: true
    });
  }

  // 4. Détermination du type de source et du score final
  let retrievalScore = 0;
  let sourceType: 'lexical' | 'vector' | 'hybrid' | 'reranked' = 'hybrid';

  if ('rerankScore' in candidate && typeof candidate.rerankScore === 'number') {
    retrievalScore = candidate.rerankScore;
    sourceType = 'reranked';
  } else if (typeof candidate.rrfScore === 'number' && candidate.rrfScore > 0) {
    retrievalScore = candidate.rrfScore;
    sourceType = 'hybrid';
  } else if (typeof candidate.vectorScore === 'number' && candidate.vectorScore > 0) {
    retrievalScore = candidate.vectorScore;
    sourceType = 'vector';
  } else if (typeof candidate.lexicalScore === 'number' && candidate.lexicalScore > 0) {
    retrievalScore = candidate.lexicalScore;
    sourceType = 'lexical';
  }

  return {
    chunkId,
    sermonId,
    sermonTitle: sermonTitle || originalSermon.title || sermonId,
    paragraphIds: [...paragraphIds].sort((a, b) => a - b),
    startParagraph,
    endParagraph,
    text,
    date: chunk.date || originalSermon.date,
    city: chunk.city !== undefined ? chunk.city : (originalSermon.city || null),
    version: chunk.version || originalSermon.version,
    retrievalScore,
    rank,
    sourceType,
    citationParagraphs
  };
}

/**
 * Construit le package complet d'Evidence documentaire.
 * Applique strictement l'abstention si answerable = false.
 */
export function buildRetrievalEvidencePackage(params: {
  query: string;
  candidates: (RerankedSearchResult | HybridSearchResult)[];
  assessment: AnswerabilityAssessment;
  originalSermons: Sermon[];
  maxEvidenceCount?: number;
}): RetrievalEvidencePackage {
  const {
    query,
    candidates = [],
    assessment,
    originalSermons = [],
    maxEvidenceCount = 5
  } = params;

  const cleanQuery = (query || '').trim();

  // CAS D'ABSTENTION / HORS CORPUS :
  // Si le moteur d'answerability conclut à false, AUCUNE evidence n'est renvoyée.
  if (!assessment || !assessment.answerable || !cleanQuery || candidates.length === 0) {
    return {
      answerable: false,
      confidenceScore: assessment ? assessment.confidenceScore : 0,
      reason: assessment ? assessment.reason : 'Question non couverte par le corpus ou requête vide.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: candidates.length,
      rejectedCount: candidates.length
    };
  }

  // Indexation rapide des sermons originaux pour vérification
  const originalSermonsMap = new Map<string, Sermon>();
  for (const s of originalSermons) {
    if (s && s.id) {
      originalSermonsMap.set(s.id, s);
    }
  }

  const validEvidenceList: RetrievalEvidence[] = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    if (validEvidenceList.length >= maxEvidenceCount) {
      break;
    }

    const evidence = validateAndConvertCandidateToEvidence({
      candidate,
      rank: validEvidenceList.length + 1,
      originalSermonsMap
    });

    if (evidence) {
      validEvidenceList.push(evidence);
    } else {
      rejectedCount++;
    }
  }

  // Si après validation toutes les preuves étaient corrompues/invalides
  if (validEvidenceList.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Toutes les preuves documentaires ont échoué à la validation d\'authenticité.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: candidates.length,
      rejectedCount: candidates.length
    };
  }

  return {
    answerable: true,
    confidenceScore: assessment.confidenceScore,
    reason: assessment.reason,
    evidence: validEvidenceList,
    query: cleanQuery,
    totalCandidates: candidates.length,
    rejectedCount
  };
}
