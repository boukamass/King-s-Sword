/**
 * King's Sword — Long-Context Grounding Service (style NotebookLM, « local d'abord »)
 *
 * Les sources sélectionnées dans l'AI Context sont transmises à Gemini sous forme de paragraphes numérotés,
 * dans l'ordre du texte, en UN SEUL appel et sous un budget de tokens plafonné :
 * - si la sélection tient dans le budget : texte INTÉGRAL (synthèse à l'échelle du document entier) ;
 * - sinon : la sélection des paragraphes est faite LOCALEMENT (aucun appel Gemini) —
 *   répartition régulière pour une demande de synthèse, passages les plus pertinents (recherche hybride locale)
 *   avec leurs voisins pour une question ciblée. Les coupures sont signalées par […].
 *
 * RÈGLES :
 * 1. AI Context strict : seuls les chunks résolus depuis les sources sélectionnées sont transmis.
 * 2. Les citations restent validées par citationValidationService (chaque paragraphe est une preuve authentique).
 * 3. Le quota Gemini de l'utilisateur est préservé : aucun appel auxiliaire, contexte borné par le budget.
 * 4. Si le retrieval local juge la question hors sujet, la réponse est refusée localement (0 token consommé).
 */

import { GoogleGenAI } from '@google/genai';
import { AIContext, AIContextSource, ChatMessage, EvidenceParagraphCitation, RetrievalEvidence, RetrievalEvidencePackage, Sermon, SermonChunk } from '../types';
import { BibleVersion } from '../types/bible';
import { buildCitationParagraphsForChunk, executeUnifiedRagPipeline, normalizeAIContext, resolveAIContextChunks } from './unifiedRagService';
import { isOverviewOrSummaryQuery, isBroadOrExhaustiveContextQuery } from './rerankingService';
import { detectQueryIntent } from './queryIntentService';
import type { GeminiCaller } from './generationAdapter';
import { getAllGeminiApiKeys, getGeminiApiKey } from '../utils/apiKeyHelper';
import { aiConfig } from '../config/aiConfig';

export const LONG_CONTEXT_VECTOR_METHOD = 'long_context_full_sources';

export interface LongContextOptions {
  bibleVersion?: BibleVersion;
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  providedChunks?: SermonChunk[];
  maxChars?: number;
  maxSources?: number;
}

interface DocParagraphs {
  docId: string;
  first: SermonChunk;
  paragraphs: EvidenceParagraphCitation[];
}

const paragraphLength = (cp: EvidenceParagraphCitation) => (cp.fullParagraphText || cp.textSnippet || '').length;

/**
 * Construit l'Evidence Package des sources sélectionnées : intégral si possible, sinon sélection locale plafonnée.
 * Retourne null uniquement si la sélection est hors du périmètre du contexte long (trop de documents).
 */
export async function buildLongContextEvidencePackage(
  query: string,
  contextInput: AIContext | Array<string | AIContextSource>,
  options: LongContextOptions = {}
): Promise<RetrievalEvidencePackage | null> {
  const maxChars = options.maxChars ?? aiConfig.longContextConfig.maxChars;
  const maxSources = options.maxSources ?? aiConfig.longContextConfig.maxSources;
  const aiContext = normalizeAIContext(contextInput);

  // Pré-filtre peu coûteux : inutile de résoudre toute la bibliothèque (mode Auto-RAG global)
  if (!options.providedChunks && (aiContext.sources.length === 0 || aiContext.sources.length > maxSources)) {
    return null;
  }

  const chunks = options.providedChunks && options.providedChunks.length > 0
    ? options.providedChunks
    : await resolveAIContextChunks(aiContext, {
        bibleVersion: options.bibleVersion,
        loadedSermonsMap: options.loadedSermonsMap
      });
  if (chunks.length === 0) return null;

  // Regroupement par document en conservant l'ordre de sélection
  const chunksByDoc = new Map<string, SermonChunk[]>();
  for (const c of chunks) {
    const list = chunksByDoc.get(c.sermonId);
    if (list) list.push(c);
    else chunksByDoc.set(c.sermonId, [c]);
  }
  if (chunksByDoc.size > maxSources) return null;

  const docs: DocParagraphs[] = [];
  const seenParagraphKeys = new Set<string>();
  let totalChars = 0;
  for (const [docId, docChunks] of chunksByDoc) {
    docChunks.sort((a, b) => a.startParagraph - b.startParagraph);
    const paragraphs = docChunks
      .flatMap(c => buildCitationParagraphsForChunk(c, seenParagraphKeys))
      .sort((a, b) => a.paragraphIndex - b.paragraphIndex);
    if (paragraphs.length === 0) continue;
    for (const cp of paragraphs) totalChars += paragraphLength(cp);
    docs.push({ docId, first: docChunks[0], paragraphs });
  }
  if (docs.length === 0) return null;

  const cleanQuery = (query || '').trim();

  // 1. La sélection tient dans le budget : texte intégral
  if (totalChars <= maxChars) {
    console.log(`[LongContextRAG] ${docs.length} source(s) intégrale(s) transmise(s) (${totalChars} caractères).`);
    return buildPackage(cleanQuery, docs.map(d => ({ doc: d, kept: d.paragraphs })), false,
      `Contexte long : intégralité des ${docs.length} source(s) sélectionnée(s) transmise(s) au modèle.`);
  }

  // 2. Sélection locale plafonnée
  const isOverview = isOverviewOrSummaryQuery(cleanQuery)
    || isBroadOrExhaustiveContextQuery(cleanQuery)
    || detectQueryIntent(cleanQuery).intent === 'CONTENT_TRANSFORMATION';

  const selectedKeys = isOverview
    ? selectEvenlyDistributed(docs, maxChars)
    : await selectMostRelevant(cleanQuery, contextInput, docs, maxChars, options);

  // Le retrieval local juge la question hors sujet : refus local sans consommer de tokens
  if (selectedKeys === null) return null;

  const kept = docs
    .map(d => ({ doc: d, kept: d.paragraphs.filter(cp => selectedKeys.has(`${d.docId}_${cp.paragraphIndex}`)) }))
    .filter(entry => entry.kept.length > 0);
  if (kept.length === 0) return null;

  const keptChars = kept.reduce((n, e) => n + e.kept.reduce((m, cp) => m + paragraphLength(cp), 0), 0);
  console.log(`[LongContextRAG] Sélection locale ${isOverview ? 'répartie' : 'par pertinence'} : ${keptChars}/${totalChars} caractères.`);
  return buildPackage(cleanQuery, kept, true,
    `Contexte long plafonné : passages ${isOverview ? 'répartis sur l\'ensemble' : 'les plus pertinents'} de ${kept.length} source(s), sélectionnés localement.`);
}

/**
 * Synthèse / résumé : paragraphes répartis régulièrement sur chaque document, au prorata de sa taille.
 */
function selectEvenlyDistributed(docs: DocParagraphs[], maxChars: number): Set<string> {
  const keys = new Set<string>();
  const totalChars = docs.reduce((n, d) => n + d.paragraphs.reduce((m, cp) => m + paragraphLength(cp), 0), 0);
  for (const d of docs) {
    const docChars = d.paragraphs.reduce((m, cp) => m + paragraphLength(cp), 0);
    const docBudget = Math.floor(maxChars * (docChars / totalChars));
    const ratio = Math.min(1, docBudget / Math.max(1, docChars));
    // Un paragraphe sur 1/ratio, avec accumulateur pour conserver une répartition homogène
    let acc = 0;
    let used = 0;
    for (const cp of d.paragraphs) {
      acc += ratio;
      const len = paragraphLength(cp);
      if (acc >= 1 && used + len <= docBudget) {
        acc -= 1;
        used += len;
        keys.add(`${d.docId}_${cp.paragraphIndex}`);
      }
    }
  }
  return keys;
}

/**
 * Question ciblée : passages classés par la recherche hybride locale (BM25 + E5 + reranking), étendus à
 * leurs paragraphes voisins (±2) par ordre de pertinence jusqu'au budget. null si la question est hors sujet.
 */
async function selectMostRelevant(
  query: string,
  contextInput: AIContext | Array<string | AIContextSource>,
  docs: DocParagraphs[],
  maxChars: number,
  options: LongContextOptions
): Promise<Set<string> | null> {
  const pkg = await executeUnifiedRagPipeline(query, contextInput, {
    topK: 60,
    maxEvidenceCount: 40,
    bibleVersion: options.bibleVersion,
    loadedSermonsMap: options.loadedSermonsMap,
    providedChunks: options.providedChunks,
    enableParentChild: false
  });
  if (!pkg.answerable || pkg.evidence.length === 0) return null;

  const lengths = new Map<string, number>();
  const orderedByDoc = new Map<string, number[]>();
  for (const d of docs) {
    orderedByDoc.set(d.docId, d.paragraphs.map(cp => cp.paragraphIndex));
    for (const cp of d.paragraphs) lengths.set(`${d.docId}_${cp.paragraphIndex}`, paragraphLength(cp));
  }

  const keys = new Set<string>();
  let used = 0;
  const tryAdd = (docId: string, paragraphIndex: number): boolean => {
    const key = `${docId}_${paragraphIndex}`;
    if (keys.has(key)) return true;
    const len = lengths.get(key);
    if (len === undefined) return true;
    if (used + len > maxChars) return false;
    keys.add(key);
    used += len;
    return true;
  };

  // Passe 1 : paragraphes des preuves, par rang ; passe 2 : voisins ±1 puis ±2 pour la continuité du propos
  for (const radius of [0, 1, 2]) {
    for (const ev of pkg.evidence) {
      const ordered = orderedByDoc.get(ev.sermonId);
      if (!ordered) continue;
      for (const pid of ev.paragraphIds) {
        const pos = ordered.indexOf(pid);
        if (pos < 0) continue;
        const targets = radius === 0 ? [pos] : [pos - radius, pos + radius];
        for (const t of targets) {
          if (t < 0 || t >= ordered.length) continue;
          if (!tryAdd(ev.sermonId, ordered[t])) return keys;
        }
      }
    }
  }
  return keys;
}

function buildPackage(
  query: string,
  entries: Array<{ doc: DocParagraphs; kept: EvidenceParagraphCitation[] }>,
  isPartial: boolean,
  reason: string
): RetrievalEvidencePackage {
  const evidence: RetrievalEvidence[] = entries.map(({ doc, kept }, idx) => {
    const paragraphIds = kept.map(cp => cp.paragraphIndex);
    return {
      chunkId: `${doc.docId}_full`,
      sermonId: doc.docId,
      sermonTitle: doc.first.sermonTitle,
      paragraphIds,
      startParagraph: paragraphIds[0],
      endParagraph: paragraphIds[paragraphIds.length - 1],
      text: kept.map(cp => cp.fullParagraphText || cp.textSnippet).join('\n\n'),
      date: doc.first.date,
      city: doc.first.city,
      version: doc.first.version,
      retrievalScore: 1,
      rank: idx + 1,
      sourceType: 'full_text',
      citationParagraphs: kept
    };
  });

  return {
    answerable: true,
    confidenceScore: isPartial ? 0.9 : 1,
    reason,
    isPartial,
    evidence,
    query,
    totalCandidates: evidence.reduce((n, ev) => n + ev.citationParagraphs.length, 0),
    rejectedCount: 0,
    vectorMethod: LONG_CONTEXT_VECTOR_METHOD
  };
}

/**
 * Formatage compact : une seule ligne par paragraphe avec sa référence ; les paragraphes omis sont signalés par […].
 */
export function formatLongContextSources(evidencePackage: RetrievalEvidencePackage): string {
  return evidencePackage.evidence.map((ev, idx) => {
    const isExpose = ev.sermonId.startsWith('expose-');
    const isBible = ev.sermonId.startsWith('bible-');
    const isSong = ev.sermonId.startsWith('song-');
    const docLabel = isExpose ? 'Exposé des Sept Âges' : (isBible ? 'Sainte Bible' : (isSong ? 'Cantique' : 'Sermon'));
    const lines: string[] = [];
    let previous: number | null = null;
    for (const cp of ev.citationParagraphs) {
      if (evidencePackage.isPartial && previous !== null && cp.paragraphIndex > previous + 1) lines.push('[…]');
      lines.push(`${cp.formattedCitation} ${cp.fullParagraphText || cp.textSnippet}`);
      previous = cp.paragraphIndex;
    }
    return `<source numero="${idx + 1}" type="${docLabel}" id="${ev.sermonId}">
Titre : ${ev.sermonTitle}
Date : ${ev.date || 'Non daté'} | Lieu : ${ev.city || 'Inconnu'}
${lines.join('\n')}
</source>`;
  }).join('\n\n');
}

export const LONG_CONTEXT_DIRECTIVES = `DIRECTIVES DE RÉPONSE (SOURCES SÉLECTIONNÉES) :
1. Tu disposes du texte des sources sélectionnées : intégral, ou pour les plus longues, des passages les plus utiles à la question (les coupures sont marquées […]). Lis-les entièrement avant de répondre.
2. Réponds EXCLUSIVEMENT à partir de ces sources, sans aucune connaissance extérieure.
3. Synthétise à l'échelle du document : relie les passages éloignés, dégage le fil conducteur, la progression de l'argument et, si plusieurs sources sont fournies, leurs convergences et nuances.
4. Appuie chaque affirmation sur une ou plusieurs citations exactes, en reprenant la référence du paragraphe telle qu'elle apparaît devant celui-ci (ex. [Réf: ID, §N]).
5. Une citation doit être une phrase entière recopiée à l'identique depuis le paragraphe cité.
6. Si les sources n'abordent pas le sujet demandé, dis-le clairement au lieu d'extrapoler.`;

/**
 * Reformule une question de relance en requête autonome à partir de l'historique de conversation.
 * Retourne null en cas d'échec ou de délai dépassé (le repli heuristique s'applique alors).
 */
export async function rewriteFollowUpQuery(
  query: string,
  history: ChatMessage[],
  options: { apiKey?: string; geminiClient?: GeminiCaller; model?: string; timeoutMs?: number } = {}
): Promise<string | null> {
  const turns = history
    .filter(h => h.content && h.content !== query && !h.content.startsWith('**Erreur'))
    .slice(-4);
  if (turns.length === 0) return null;

  const transcript = turns
    .map(h => `${h.role === 'assistant' ? 'Assistant' : 'Utilisateur'} : ${h.content.substring(0, 1500)}`)
    .join('\n');
  const prompt = `Historique de la conversation :
${transcript}

Nouvelle question de l'utilisateur : "${query}"

Réécris cette nouvelle question en une question autonome et complète, compréhensible sans l'historique (résous les pronoms et les références implicites comme « ce point », « il », « cette citation »). Conserve la langue et l'intention. Si la question est déjà autonome, renvoie-la telle quelle. Réponds UNIQUEMENT par la question réécrite.`;

  let client = options.geminiClient;
  if (!client) {
    const key = options.apiKey || getAllGeminiApiKeys()[0] || getGeminiApiKey();
    if (!key) return null;
    const googleAi = new GoogleGenAI({ apiKey: key });
    client = { generateContent: (p) => googleAi.models.generateContent(p) };
  }

  const timeoutMs = options.timeoutMs ?? aiConfig.longContextConfig.rewriteTimeoutMs;
  try {
    const response = await Promise.race([
      client.generateContent({
        model: options.model || aiConfig.models.primaryFastModel,
        contents: prompt,
        config: { temperature: 0, maxOutputTokens: 256 }
      }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))
    ]);
    const rewritten = (response?.text || '').trim().replace(/^["«\s]+|["»\s]+$/g, '');
    if (!rewritten || rewritten.length > 500 || rewritten.startsWith('{')) return null;
    return rewritten;
  } catch (err) {
    console.warn('[LongContextRAG] Reformulation conversationnelle indisponible, repli heuristique.', err);
    return null;
  }
}
