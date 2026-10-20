/**
 * King's Sword — Service Parent-Child & Contexte Adjacent (Étape 7)
 * 
 * Enrichit les preuves documentaires (RetrievalEvidencePackage) avec les paragraphes
 * adjacents immédiats (§n-1 et §n+1) du même document, sans jamais franchir les frontières
 * du document/chapitre, avec plafonnement de taille et fusion des contextes adjacents.
 * 
 * RÈGLES FORMELLES :
 * 1. L'indexation et le matching restent au niveau du paragraphe (ancre cliquable inchangée).
 * 2. Étiquetage explicite : [Précédent §n-1], [Cible §n], [Suivant §n+1].
 * 3. Plafonnement de taille : maximum N caractères par source (configurable, défaut 1200 car.).
 *    Ne traverse JAMAIS la frontière d'un sermon ou d'un chapitre (§1 n'a pas de §0).
 * 4. Déduplication : si deux résultats sont adjacents, fusionner leurs contextes.
 * 5. Le lien cliquable pointe STRICTEMENT sur le paragraphe cible, jamais sur le contexte.
 */

import {
  RetrievalEvidence,
  AdjacentContext,
  AdjacentParagraph,
  EvidenceParagraphCitation,
  Sermon
} from '../types';
import { splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';
import { formatParagraphCitation } from './retrievalEvidenceService';

export interface ParentChildOptions {
  maxCharsPerSource?: number; // Plafond en caractères par bloc de preuve (défaut: 1200)
  includePrevious?: boolean;  // Inclure §n-1 (défaut: true)
  includeNext?: boolean;      // Inclure §n+1 (défaut: true)
}

export const DEFAULT_PARENT_CHILD_OPTIONS: Required<ParentChildOptions> = {
  maxCharsPerSource: 1200,
  includePrevious: true,
  includeNext: true
};

/**
 * Extrait la liste ordonnée des paragraphes réels d'un document (Sermon ou Chapitre d'Exposé).
 */
export function extractDocumentParagraphs(
  docText: string
): Array<{ paragraphIndex: number; text: string }> {
  if (!docText || typeof docText !== 'string') return [];
  const rawParagraphs = splitSermonIntoParagraphs(docText);
  return rawParagraphs.map((rawP, idx) => {
    const leading = extractLeadingParagraphNumber(rawP);
    const actualNum = leading !== null ? leading : idx + 1;
    return {
      paragraphIndex: actualNum,
      text: rawP.trim()
    };
  });
}

/**
 * Enrichit une preuve individuelle avec son contexte adjacent §n-1 et §n+1.
 */
export function buildAdjacentContextForEvidence(
  evidence: RetrievalEvidence,
  docParagraphs: Array<{ paragraphIndex: number; text: string }>,
  options: ParentChildOptions = {}
): AdjacentContext | undefined {
  const opts = { ...DEFAULT_PARENT_CHILD_OPTIONS, ...options };
  const targetIds = evidence.paragraphIds && evidence.paragraphIds.length > 0
    ? [...evidence.paragraphIds].sort((a, b) => a - b)
    : [evidence.startParagraph];

  if (targetIds.length === 0 || docParagraphs.length === 0) {
    return undefined;
  }

  const minTarget = targetIds[0];
  const maxTarget = targetIds[targetIds.length - 1];

  // Carte rapide des paragraphes par index
  const paraMap = new Map<number, string>();
  for (const dp of docParagraphs) {
    paraMap.set(dp.paragraphIndex, dp.text);
  }

  const adjacentList: AdjacentParagraph[] = [];

  // 1. Paragraphe précédent (§n-1) — frontière stricte : pas de §0 ni négatif
  let hasPrevious = false;
  const prevNum = minTarget - 1;
  if (opts.includePrevious && prevNum >= 1 && paraMap.has(prevNum)) {
    hasPrevious = true;
    adjacentList.push({
      paragraphIndex: prevNum,
      text: paraMap.get(prevNum)!,
      role: 'precedent',
      formattedCitation: formatParagraphCitation(evidence.sermonId, prevNum)
    });
  }

  // 2. Paragraphes cibles (§n)
  for (const tNum of targetIds) {
    const tText = paraMap.get(tNum) || evidence.text;
    adjacentList.push({
      paragraphIndex: tNum,
      text: tText,
      role: 'cible',
      formattedCitation: formatParagraphCitation(evidence.sermonId, tNum)
    });
  }

  // 3. Paragraphe suivant (§n+1) — frontière stricte : ne dépasse pas le dernier paragraphe du document
  let hasNext = false;
  const nextNum = maxTarget + 1;
  if (opts.includeNext && paraMap.has(nextNum)) {
    hasNext = true;
    adjacentList.push({
      paragraphIndex: nextNum,
      text: paraMap.get(nextNum)!,
      role: 'suivant',
      formattedCitation: formatParagraphCitation(evidence.sermonId, nextNum)
    });
  }

  // 4. Plafonnement de taille et formatage textuel étiqueté
  const targetChars = adjacentList
    .filter(p => p.role === 'cible')
    .reduce((sum, p) => sum + p.text.length, 0);

  // Le texte cible est TOUJOURS préservé dans son intégralité
  const budgetForAdjacent = Math.max(0, opts.maxCharsPerSource - targetChars);
  const halfBudget = Math.floor(budgetForAdjacent / 2);

  const formattedBlocks: string[] = [];
  let totalChars = 0;

  for (const p of adjacentList) {
    let displayText = p.text;

    if (p.role === 'precedent') {
      if (displayText.length > halfBudget && budgetForAdjacent > 100) {
        // Tronquage propre par le début pour garder la transition vers le paragraphe cible
        displayText = '...' + displayText.slice(-halfBudget).trim();
      }
      formattedBlocks.push(`[Précédent §${p.paragraphIndex}]\n${displayText}`);
      totalChars += displayText.length;
    } else if (p.role === 'cible') {
      formattedBlocks.push(`[Cible §${p.paragraphIndex}]\n${displayText}`);
      totalChars += displayText.length;
    } else if (p.role === 'suivant') {
      if (displayText.length > halfBudget && budgetForAdjacent > 100) {
        displayText = displayText.slice(0, halfBudget).trim() + '...';
      }
      formattedBlocks.push(`[Suivant §${p.paragraphIndex}]\n${displayText}`);
      totalChars += displayText.length;
    }
  }

  const formattedContextText = formattedBlocks.join('\n\n');

  return {
    targetParagraphIndex: minTarget,
    hasPrevious,
    hasNext,
    adjacentParagraphs: adjacentList,
    formattedContextText,
    totalCharacters: formattedContextText.length
  };
}

/**
 * Fusionne les contextes adjacents de preuves issues du même document pour éliminer les doublons.
 * (ex: résultat 1 sur §4 et résultat 2 sur §5 fusionnent en : Précédent §3, Cible §4, Cible §5, Suivant §6).
 */
export function mergeAdjacentEvidenceContexts(
  evidenceList: RetrievalEvidence[],
  docsMap: Map<string, Array<{ paragraphIndex: number; text: string }>>,
  options: ParentChildOptions = {}
): RetrievalEvidence[] {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) return [];

  const mergedList: RetrievalEvidence[] = [];

  for (const ev of evidenceList) {
    const last = mergedList[mergedList.length - 1];

    // Vérifier si deux résultats consécutifs proviennent du même document et sont adjacents
    const isSameDoc = last && last.sermonId === ev.sermonId;
    const isAdjacent = isSameDoc && (
      ev.startParagraph <= last.endParagraph + 2 || // Paragraphes immédiatement voisins (§4 et §5, ou §4 et §6 avec lien)
      last.paragraphIds.some(id => ev.paragraphIds.includes(id) || Math.abs(id - ev.startParagraph) <= 1)
    );

    if (isAdjacent) {
      // Fusion des deux résultats en un seul bloc parent-child non redondant
      const mergedTargets = Array.from(new Set([...last.paragraphIds, ...ev.paragraphIds])).sort((a, b) => a - b);
      const startParagraph = mergedTargets[0];
      const endParagraph = mergedTargets[mergedTargets.length - 1];

      // Fusion des citations cibles authentiques
      const paraCitationMap = new Map<number, EvidenceParagraphCitation>();
      for (const cp of last.citationParagraphs) paraCitationMap.set(cp.paragraphIndex, cp);
      for (const cp of ev.citationParagraphs) paraCitationMap.set(cp.paragraphIndex, cp);
      const mergedCitationParagraphs = Array.from(paraCitationMap.values()).sort((a, b) => a.paragraphIndex - b.paragraphIndex);

      const docParas = docsMap.get(ev.sermonId) || [];
      const updatedEv: RetrievalEvidence = {
        ...last,
        paragraphIds: mergedTargets,
        startParagraph,
        endParagraph,
        citationParagraphs: mergedCitationParagraphs,
        retrievalScore: Math.max(last.retrievalScore, ev.retrievalScore)
      };

      updatedEv.adjacentContext = buildAdjacentContextForEvidence(updatedEv, docParas, options);
      if (updatedEv.adjacentContext) {
        updatedEv.text = updatedEv.adjacentContext.formattedContextText;
      }

      mergedList[mergedList.length - 1] = updatedEv;
    } else {
      // Pas adjacent : enrichissement standard
      const docParas = docsMap.get(ev.sermonId) || [];
      const enrichedEv: RetrievalEvidence = { ...ev };
      enrichedEv.adjacentContext = buildAdjacentContextForEvidence(enrichedEv, docParas, options);
      if (enrichedEv.adjacentContext) {
        enrichedEv.text = enrichedEv.adjacentContext.formattedContextText;
      }
      mergedList.push(enrichedEv);
    }
  }

  return mergedList;
}

/**
 * Enrichit l'ensemble des preuves d'un RetrievalEvidencePackage avec le contexte Parent-Child adjacent.
 */
export function applyParentChildToEvidencePackage(
  evidenceList: RetrievalEvidence[],
  originalDocsMap: Map<string, string | Array<{ paragraphIndex: number; text: string }>>,
  options: ParentChildOptions = {}
): RetrievalEvidence[] {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) return [];

  // Pré-découpage des documents en paragraphes
  const docsParagraphsMap = new Map<string, Array<{ paragraphIndex: number; text: string }>>();
  for (const [docId, content] of originalDocsMap.entries()) {
    if (Array.isArray(content)) {
      docsParagraphsMap.set(docId, content);
    } else if (typeof content === 'string') {
      docsParagraphsMap.set(docId, extractDocumentParagraphs(content));
    }
  }

  return mergeAdjacentEvidenceContexts(evidenceList, docsParagraphsMap, options);
}
