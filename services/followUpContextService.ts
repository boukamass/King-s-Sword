/**
 * King's Sword — Mémoire de conversation des relances (100 % locale, 0 token)
 *
 * 1. Historique compact : chaque réponse précédente est résumée (synthèse, titres des points, passages cités)
 *    au lieu d'être tronquée, ce qui permet de transmettre davantage d'échanges pour le même budget.
 * 2. Sources de la réponse précédente : les paragraphes cités sont réinjectés en priorité dans les preuves
 *    d'une relance (« Et pourquoi ce silence ? » retrouve les passages dont il était question).
 */

import { AIContext, AIContextSource, ChatMessage, RetrievalEvidence, RetrievalEvidencePackage, SermonChunk } from '../types';
import { BibleVersion } from '../types/bible';
import { buildCitationParagraphsForChunk, getChunksBySermonIndex, normalizeAIContext, resolveAIContextChunks } from './unifiedRagService';
import { aiConfig } from '../config/aiConfig';

export interface CitedParagraph {
  sermonId: string;
  paragraphIndex: number;
}

const REF_REGEX = /\[R[ée]f\s*:\s*([A-Za-z0-9_-]+)\s*,\s*(?:Para\.?|§)\s*(\d+)\s*\]/g;

/** Réponses d'erreur, de refus ou de secours local : sans valeur pour la mémoire de conversation */
export function isUsableHistoryMessage(m: ChatMessage): boolean {
  const c = m.content || '';
  return Boolean(c) &&
    !c.startsWith('**Erreur') && !c.toLowerCase().startsWith('erreur') &&
    !c.startsWith('> **Information') && !c.startsWith('**Aucun passage') &&
    !c.includes('❌') && !c.includes('⚠');
}

/**
 * Paragraphes cités dans la dernière réponse exploitable de l'assistant (sources affichées, sinon références du texte).
 */
export function extractPreviousCitedParagraphs(history: ChatMessage[], max = 8): CitedParagraph[] {
  const lastAssistant = [...(history || [])].reverse().find(m =>
    m.role === 'assistant' && isUsableHistoryMessage(m) && !m.refusal);
  if (!lastAssistant) return [];

  const result: CitedParagraph[] = [];
  const seen = new Set<string>();
  const push = (sermonId: string, paragraphIndex: number) => {
    const key = `${sermonId}#${paragraphIndex}`;
    if (!sermonId || !Number.isFinite(paragraphIndex) || seen.has(key)) return;
    seen.add(key);
    result.push({ sermonId, paragraphIndex });
  };

  // Ordre d'apparition dans le texte (les citations les plus probantes viennent en premier)
  for (const match of (lastAssistant.content || '').matchAll(REF_REGEX)) {
    push(match[1], parseInt(match[2], 10));
    if (result.length >= max) return result;
  }
  for (const s of lastAssistant.sources || []) {
    if (s && typeof s.sermonId === 'string') push(s.sermonId, Number(s.paragraphIndex));
    if (result.length >= max) break;
  }
  return result;
}

/**
 * Version compacte d'une réponse de l'assistant pour l'historique transmis au modèle.
 */
export function compactAssistantMessage(content: string, maxSummaryChars = 1500): string {
  const text = content || '';
  const synthesisMatch = text.match(/##\s*Synth[èe]se\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  let summary = (synthesisMatch ? synthesisMatch[1] : text).replace(/\s+\n/g, '\n').trim();
  if (summary.length > maxSummaryChars) summary = summary.slice(0, maxSummaryChars).replace(/\s+\S*$/, '') + ' […]';

  const titles = Array.from(text.matchAll(/^###\s*\d+\.\s*(.+)$/gm)).map(m => m[1].trim()).slice(0, 8);
  const refs = Array.from(text.matchAll(REF_REGEX)).map(m => `${m[1]} §${m[2]}`);
  const uniqueRefs = Array.from(new Set(refs)).slice(0, 12);

  const parts = [`Synthèse de ma réponse précédente : ${summary}`];
  if (titles.length > 0) parts.push(`Points développés : ${titles.map((t, i) => `${i + 1}. ${t}`).join(' ; ')}`);
  if (uniqueRefs.length > 0) parts.push(`Passages cités : ${uniqueRefs.join(', ')}`);
  return parts.join('\n');
}

/**
 * Historique transmis au modèle : messages exploitables, réponses compactées, plafonné en messages et en caractères.
 */
export function buildHistoryForPrompt(history: ChatMessage[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const budget = aiConfig.tokenBudgetConfig;
  const compact = aiConfig.featureFlags.useCompactHistory;
  const maxMessages = compact ? budget.maxHistoryMessages : 6;

  const cleanHistory = (history || [])
    .filter(isUsableHistoryMessage)
    .slice(-maxMessages)
    .map(h => ({
      role: (h.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{
        text: h.role === 'assistant' && compact
          ? compactAssistantMessage(h.content)
          : h.content.substring(0, compact ? 1500 : 4000)
      }]
    }));

  // Plafond global : on conserve les échanges les plus récents
  let historyChars = 0;
  for (let i = cleanHistory.length - 1; i >= 0; i--) {
    historyChars += cleanHistory[i].parts[0].text.length;
    if (historyChars > budget.maxHistoryChars) {
      cleanHistory.splice(0, i + 1);
      break;
    }
  }
  return cleanHistory;
}

/**
 * Signature du dernier échange, utilisée pour mémoriser la réponse à une relance sans la confondre
 * avec la même question posée dans une autre conversation.
 */
export function buildFollowUpCacheSignature(history: ChatMessage[]): string {
  const usable = (history || []).filter(isUsableHistoryMessage);
  const lastUser = [...usable].reverse().find(m => m.role === 'user');
  const lastAssistant = [...usable].reverse().find(m => m.role === 'assistant');
  return `${(lastUser?.content || '').slice(0, 200)} || ${(lastAssistant?.content || '').slice(0, 300)}`;
}

/**
 * Réinjecte dans l'Evidence Package les paragraphes cités par la réponse précédente (±1 paragraphe),
 * strictement limités à l'AI Context. Une relance jugée hors sujet par le retrieval local devient
 * ainsi répondable à partir des passages dont il était question.
 */
export async function injectFollowUpSources(
  pkg: RetrievalEvidencePackage,
  cited: CitedParagraph[],
  contextInput: AIContext | Array<string | AIContextSource>,
  options: { bibleVersion?: BibleVersion; loadedSermonsMap?: Map<string, any>; providedChunks?: SermonChunk[]; insertAt?: number } = {}
): Promise<RetrievalEvidencePackage> {
  if (!cited || cited.length === 0) return pkg;

  const chunks = options.providedChunks && options.providedChunks.length > 0
    ? options.providedChunks
    : await resolveAIContextChunks(normalizeAIContext(contextInput), {
        bibleVersion: options.bibleVersion,
        loadedSermonsMap: options.loadedSermonsMap
      });
  if (chunks.length === 0) return pkg;
  const bySermon = getChunksBySermonIndex(chunks);

  const existingParagraphs = new Set<string>();
  for (const ev of pkg.evidence || []) {
    for (const cp of ev.citationParagraphs || []) existingParagraphs.add(`${ev.sermonId}_${cp.paragraphIndex}`);
  }

  const sticky: RetrievalEvidence[] = [];
  const usedChunks = new Set<string>();
  for (const ref of cited) {
    if (existingParagraphs.has(`${ref.sermonId}_${ref.paragraphIndex}`)) continue;
    const docChunks = bySermon.get(ref.sermonId);
    const chunk = docChunks?.find(c => (c.paragraphIds || [c.startParagraph]).includes(ref.paragraphIndex));
    if (!chunk || usedChunks.has(chunk.chunkId)) continue;
    usedChunks.add(chunk.chunkId);

    const citationParagraphs = buildCitationParagraphsForChunk(chunk)
      .filter(cp => Math.abs(cp.paragraphIndex - ref.paragraphIndex) <= 1 && !existingParagraphs.has(`${chunk.sermonId}_${cp.paragraphIndex}`));
    if (citationParagraphs.length === 0) continue;
    for (const cp of citationParagraphs) existingParagraphs.add(`${chunk.sermonId}_${cp.paragraphIndex}`);

    const paragraphIds = citationParagraphs.map(cp => cp.paragraphIndex);
    sticky.push({
      chunkId: chunk.chunkId,
      sermonId: chunk.sermonId,
      sermonTitle: chunk.sermonTitle,
      paragraphIds,
      startParagraph: paragraphIds[0],
      endParagraph: paragraphIds[paragraphIds.length - 1],
      text: citationParagraphs.map(cp => cp.fullParagraphText || cp.textSnippet).join('\n\n'),
      date: chunk.date,
      city: chunk.city,
      version: chunk.version,
      retrievalScore: 1,
      rank: 0,
      sourceType: 'reranked',
      citationParagraphs
    });
  }
  if (sticky.length === 0) return pkg;

  const evidence = [...(pkg.evidence || [])];
  const insertAt = Math.min(options.insertAt ?? 6, evidence.length);
  evidence.splice(insertAt, 0, ...sticky);
  console.log(`[FollowUp] ${sticky.length} passage(s) de la réponse précédente réinjecté(s) dans les preuves.`);

  return {
    ...pkg,
    answerable: true,
    reason: pkg.answerable ? pkg.reason : 'Relance : passages cités dans la réponse précédente.',
    evidence: evidence.map((ev, idx) => ({ ...ev, rank: idx + 1 }))
  };
}
