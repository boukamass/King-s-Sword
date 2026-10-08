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
      fullParagraphText: originalParaText,
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

  // RÈGLE : Le texte documentaire doit comporter les paragraphes intégraux pour éviter toute coupure
  const completeParagraphsText = citationParagraphs.map(cp => cp.fullParagraphText || cp.textSnippet).join('\n\n');

  return {
    chunkId,
    sermonId,
    sermonTitle: sermonTitle || originalSermon.title || sermonId,
    paragraphIds: [...paragraphIds].sort((a, b) => a - b),
    startParagraph,
    endParagraph,
    text: completeParagraphsText || text,
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
 * Fusionne les fragments d'Evidence contigus ou chevauchants provenant du même document.
 * Évite les citations tronquées à la frontière des chunks.
 */
export function mergeContiguousEvidence(evidenceList: RetrievalEvidence[]): RetrievalEvidence[] {
  if (!Array.isArray(evidenceList) || evidenceList.length <= 1) return evidenceList;
  const merged: RetrievalEvidence[] = [];

  for (const ev of evidenceList) {
    const last = merged[merged.length - 1];
    if (last && last.sermonId === ev.sermonId && ev.startParagraph <= last.endParagraph + 1) {
      const allParas = Array.from(new Set([...last.paragraphIds, ...ev.paragraphIds])).sort((a, b) => a - b);
      const startParagraph = allParas[0];
      const endParagraph = allParas[allParas.length - 1];

      const paraMap = new Map<number, EvidenceParagraphCitation>();
      for (const cp of last.citationParagraphs) paraMap.set(cp.paragraphIndex, cp);
      for (const cp of ev.citationParagraphs) paraMap.set(cp.paragraphIndex, cp);
      const mergedCitationParagraphs = Array.from(paraMap.values()).sort((a, b) => a.paragraphIndex - b.paragraphIndex);

      const mergedText = mergedCitationParagraphs.map(cp => cp.fullParagraphText || cp.textSnippet).join('\n\n');

      merged[merged.length - 1] = {
        ...last,
        paragraphIds: allParas,
        startParagraph,
        endParagraph,
        text: mergedText,
        citationParagraphs: mergedCitationParagraphs,
        retrievalScore: Math.max(last.retrievalScore, ev.retrievalScore)
      };
    } else {
      merged.push({ ...ev });
    }
  }

  return merged;
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
      rejectedCount: candidates.length,
      closestPassages: assessment?.closestPassages || [],
      refusalCategory: assessment?.refusalCategory,
      decisionJournal: assessment?.decisionJournal,
      forceSearchAvailable: assessment?.forceSearchAvailable
    };
  }

  // Indexation rapide des sermons originaux pour vérification
  const originalSermonsMap = new Map<string, Sermon>();
  for (const s of originalSermons) {
    if (s && s.id) {
      originalSermonsMap.set(s.id, s);
    }
  }

  const rawEvidenceList: RetrievalEvidence[] = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    if (rawEvidenceList.length >= maxEvidenceCount * 2) {
      break;
    }

    const evidence = validateAndConvertCandidateToEvidence({
      candidate,
      rank: rawEvidenceList.length + 1,
      originalSermonsMap
    });

    if (evidence) {
      rawEvidenceList.push(evidence);
    } else {
      rejectedCount++;
    }
  }

  // Fusion des fragments contigus pour préserver l'intégralité des phrases et paragraphes
  const validEvidenceList = mergeContiguousEvidence(rawEvidenceList).slice(0, maxEvidenceCount);

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
    isPartial: assessment.isPartial,
    evidence: validEvidenceList,
    query: cleanQuery,
    totalCandidates: candidates.length,
    rejectedCount
  };
}
