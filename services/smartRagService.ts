/**
 * King's Sword — Smart Retrieval (grandes sélections / bibliothèque entière)
 *
 * Quand les sources sélectionnées dépassent le budget du contexte long, le retrieval est piloté par Gemini :
 * 1. Compréhension de la requête (1 appel) : question autonome (résolution des relances) + 3 à 5 requêtes de recherche.
 * 2. Retrieval hybride multi-requêtes local (BM25 + E5 + RRF) → bassin de ~80 passages.
 * 3. Reranking sémantique Gemini (lots parallèles, score 0-3) : remplace le portier lexical d'answerability.
 * 4. Evidence Package élargi (jusqu'à 30 passages, diversifiés, avec contexte adjacent ±1 paragraphe).
 *
 * ROBUSTESSE : chaque appel Gemini est borné par un délai ; toute défaillance (quota, réseau, JSON invalide)
 * renvoie status 'fallback' et le pipeline Unified RAG local prend le relais sans interruption.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { AIContext, AIContextSource, ChatMessage, ClosestPassageRef, RetrievalEvidence, RetrievalEvidencePackage, SermonChunk } from '../types';
import { BibleVersion } from '../types/bible';
import type { GeminiCaller } from './generationAdapter';
import { buildCitationParagraphsForChunk, getChunksBySermonIndex, getContextSearchPool } from './unifiedRagService';
import { executeMultiQueryBroadRetrievalRrf } from './deepStudentModeService';
import { buildAdjacentContextForEvidence } from './parentChildService';
import { getAllGeminiApiKeys, getGeminiApiKey } from '../utils/apiKeyHelper';
import { aiConfig, defaultDeepStudentConfig } from '../config/aiConfig';

export const SMART_RETRIEVAL_VECTOR_METHOD = 'smart_gemini_rerank';

export interface SmartRetrievalOptions {
  history?: ChatMessage[];
  apiKey?: string;
  geminiClient?: GeminiCaller;
  bibleVersion?: BibleVersion;
  loadedSermonsMap?: Map<string, any>;
  providedChunks?: SermonChunk[];
  maxEvidence?: number;
  onProgress?: (message: string) => void;
}

export interface SmartRetrievalResult {
  status: 'ok' | 'fallback';
  standaloneQuery: string;
  evidencePackage?: RetrievalEvidencePackage;
  reason?: string;
}

type TextCaller = (params: { contents: string; config: any }, timeoutMs: number) => Promise<string>;

class GeminiTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new GeminiTimeoutError(`Délai Gemini dépassé (${timeoutMs} ms)`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

/**
 * Appelant Gemini avec bascule multi-clés / multi-modèles sur quota (429), surcharge (503) ou modèle absent (404).
 */
function createTextCaller(apiKey?: string, geminiClient?: GeminiCaller): TextCaller | null {
  const model = aiConfig.models.primaryFastModel;
  if (geminiClient) {
    return async (params, timeoutMs) => {
      const res = await withTimeout(geminiClient.generateContent({ model, ...params }), timeoutMs);
      return res?.text || '';
    };
  }

  const keys = Array.from(new Set([apiKey, ...getAllGeminiApiKeys(), getGeminiApiKey()].filter((k): k is string => Boolean(k))));
  if (keys.length === 0) return null;
  const models = Array.from(new Set([model, 'gemini-2.5-flash', 'gemini-flash-latest']));

  return async (params, timeoutMs) => {
    let lastErr: unknown = null;
    for (const key of keys) {
      const googleAi = new GoogleGenAI({ apiKey: key });
      for (const m of models) {
        try {
          const res = await withTimeout(googleAi.models.generateContent({ model: m, ...params }), timeoutMs);
          return res?.text || '';
        } catch (err) {
          lastErr = err;
          if (err instanceof GeminiTimeoutError) throw err;
          const msg = String((err as any)?.message || err).toLowerCase();
          const retryable = ['404', 'not found', 'not supported', '429', 'quota', 'resource_exhausted', '503', 'overloaded', 'unavailable']
            .some(marker => msg.includes(marker));
          if (!retryable) throw err;
        }
      }
    }
    throw lastErr || new Error('Échec Gemini sur toutes les clés et modèles.');
  };
}

const UNDERSTANDING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    standaloneQuestion: {
      type: Type.STRING,
      description: "La question de l'utilisateur réécrite pour être compréhensible sans l'historique."
    },
    searchQueries: {
      type: Type.ARRAY,
      description: '3 à 5 requêtes de recherche courtes et complémentaires.',
      items: { type: Type.STRING }
    }
  },
  required: ['standaloneQuestion', 'searchQueries']
};

async function understandQuery(
  query: string,
  history: ChatMessage[],
  call: TextCaller
): Promise<{ standaloneQuestion: string; searchQueries: string[] }> {
  const transcript = history
    .filter(h => h.content && h.content !== query && !h.content.startsWith('**Erreur'))
    .slice(-4)
    .map(h => `${h.role === 'assistant' ? 'Assistant' : 'Utilisateur'} : ${h.content.substring(0, 800)}`)
    .join('\n');

  const prompt = `Tu prépares une recherche documentaire dans les sermons de William Marrion Branham (1947-1965), l'Exposé des Sept Âges de l'Église, la Bible et des cantiques.
${transcript ? `\nHISTORIQUE RÉCENT :\n${transcript}\n` : ''}
QUESTION ACTUELLE : "${query}"

1. standaloneQuestion : réécris la question pour qu'elle soit complète sans l'historique (résous « il », « ce point », « cette citation »…). Conserve la langue et l'intention. Si elle est déjà autonome, recopie-la.
2. searchQueries : 3 à 5 requêtes courtes (3 à 8 mots) et complémentaires pour retrouver les passages pertinents :
   - les termes exacts du sujet et leurs synonymes ;
   - le vocabulaire concret de prédication de Branham ;
   - les références et termes bibliques liés.
Ne dérive pas vers des doctrines sans rapport avec la question.`;

  const text = await call({
    contents: prompt,
    config: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: UNDERSTANDING_SCHEMA
    }
  }, aiConfig.smartRetrievalConfig.understandingTimeoutMs);

  const parsed = JSON.parse(text);
  const standalone = String(parsed?.standaloneQuestion || '').trim();
  const searchQueries = Array.isArray(parsed?.searchQueries)
    ? parsed.searchQueries.map((q: unknown) => String(q || '').trim()).filter((q: string) => q.length >= 3).slice(0, 5)
    : [];
  return {
    standaloneQuestion: standalone && standalone.length <= 600 ? standalone : query,
    searchQueries
  };
}

const RERANK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scores: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.INTEGER },
          score: { type: Type.INTEGER }
        },
        required: ['id', 'score']
      }
    }
  },
  required: ['scores']
};

/**
 * Score chaque passage de 0 à 3 par lots parallèles. Retourne null si aucun lot n'a pu être évalué.
 */
async function rerankWithGemini(
  question: string,
  candidates: SermonChunk[],
  call: TextCaller
): Promise<Map<number, number> | null> {
  const { rerankBatchSize, rerankTimeoutMs, rerankSnippetChars } = aiConfig.smartRetrievalConfig;
  const batches: Array<{ start: number; items: SermonChunk[] }> = [];
  for (let i = 0; i < candidates.length; i += rerankBatchSize) {
    batches.push({ start: i, items: candidates.slice(i, i + rerankBatchSize) });
  }

  const scores = new Map<number, number>();
  const results = await Promise.allSettled(batches.map(async ({ start, items }) => {
    const passages = items.map((c, idx) => {
      const text = c.text.length > rerankSnippetChars ? `${c.text.slice(0, rerankSnippetChars)}…` : c.text;
      return `[${start + idx}] (${c.sermonTitle || c.sermonId}, §${c.startParagraph})\n${text}`;
    }).join('\n\n');

    const prompt = `Évalue la pertinence de chaque passage pour répondre à la question.

QUESTION : "${question}"

BARÈME :
0 = hors sujet ou simple coïncidence de mots ;
1 = thème voisin ou principe général sans lien direct ;
2 = aborde directement un aspect de la question ;
3 = traite explicitement le cœur de la question.
Ne sur-note jamais un passage tangentiel. Renvoie un score pour chaque id.

PASSAGES :
${passages}`;

    const text = await call({
      contents: prompt,
      config: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: RERANK_SCHEMA
      }
    }, rerankTimeoutMs);

    const parsed = JSON.parse(text);
    for (const entry of Array.isArray(parsed?.scores) ? parsed.scores : []) {
      const id = Number(entry?.id);
      const score = Number(entry?.score);
      if (Number.isInteger(id) && id >= start && id < start + items.length && Number.isFinite(score)) {
        scores.set(id, Math.max(0, Math.min(3, Math.round(score))));
      }
    }
  }));

  const anySucceeded = results.some(r => r.status === 'fulfilled');
  if (!anySucceeded) {
    console.warn('[SmartRAG] Reranking Gemini indisponible :', (results[0] as PromiseRejectedResult)?.reason);
    return null;
  }
  return scores;
}

/**
 * Exécute le retrieval intelligent. Ne lève jamais d'exception : en cas d'échec, status = 'fallback'.
 */
export async function executeSmartRetrieval(
  query: string,
  aiContext: AIContext | Array<string | AIContextSource>,
  options: SmartRetrievalOptions = {}
): Promise<SmartRetrievalResult> {
  const cleanQuery = (query || '').trim();
  const call = createTextCaller(options.apiKey, options.geminiClient);
  if (!call || !cleanQuery) {
    return { status: 'fallback', standaloneQuery: cleanQuery, reason: 'Clé Gemini indisponible.' };
  }

  try {
    options.onProgress?.('Analyse de la question et préparation de la recherche...');
    const [understanding, pool] = await Promise.all([
      understandQuery(cleanQuery, options.history || [], call).catch(err => {
        console.warn('[SmartRAG] Compréhension de requête indisponible, requête brute utilisée.', err);
        return { standaloneQuestion: cleanQuery, searchQueries: [] as string[] };
      }),
      getContextSearchPool(aiContext, {
        bibleVersion: options.bibleVersion,
        loadedSermonsMap: options.loadedSermonsMap,
        providedChunks: options.providedChunks
      })
    ]);
    const standaloneQuery = understanding.standaloneQuestion;

    if (pool.searchPool.length === 0) {
      return { status: 'fallback', standaloneQuery, reason: 'Aucun passage dans le contexte.' };
    }

    options.onProgress?.(`Recherche hybride dans ${pool.searchPool.length.toLocaleString('fr-FR')} passages...`);
    const queries = Array.from(new Set([standaloneQuery, ...understanding.searchQueries]));
    const { candidatePoolSize } = aiConfig.smartRetrievalConfig;
    const { candidates } = await executeMultiQueryBroadRetrievalRrf(standaloneQuery, queries, pool.searchPool, {
      ...defaultDeepStudentConfig,
      candidatePoolSize
    });
    const candidateChunks = candidates.map(c => c.chunk);

    if (candidateChunks.length === 0) {
      return {
        status: 'ok',
        standaloneQuery,
        evidencePackage: {
          answerable: false,
          confidenceScore: 0,
          reason: "Aucun passage des sources sélectionnées ne correspond à cette question.",
          evidence: [],
          query: standaloneQuery,
          totalCandidates: 0,
          rejectedCount: 0,
          vectorMethod: SMART_RETRIEVAL_VECTOR_METHOD,
          refusalCategory: 'no_relevant_passages'
        }
      };
    }

    options.onProgress?.(`Sélection des passages pertinents parmi ${candidateChunks.length} candidats...`);
    const scores = await rerankWithGemini(standaloneQuery, candidateChunks, call);
    if (!scores) {
      return { status: 'fallback', standaloneQuery, reason: 'Reranking Gemini indisponible.' };
    }

    const ranked = candidateChunks
      .map((chunk, idx) => ({ chunk, score: scores.get(idx) ?? 0, rrfRank: idx }))
      .sort((a, b) => (b.score - a.score) || (a.rrfRank - b.rrfRank));
    const relevant = ranked.filter(r => r.score >= 2);

    if (relevant.length === 0) {
      const closestPassages: ClosestPassageRef[] = ranked.filter(r => r.score === 1).slice(0, 3).map(r => ({
        title: r.chunk.sermonTitle || r.chunk.sermonId,
        paragraphIndex: r.chunk.startParagraph,
        textSnippet: r.chunk.text.length > 200 ? `${r.chunk.text.slice(0, 200)}...` : r.chunk.text,
        score: r.score / 3
      }));
      return {
        status: 'ok',
        standaloneQuery,
        evidencePackage: {
          answerable: false,
          confidenceScore: 0,
          reason: "Les sources sélectionnées n'abordent pas directement cette question.",
          evidence: [],
          query: standaloneQuery,
          totalCandidates: candidateChunks.length,
          rejectedCount: candidateChunks.length,
          vectorMethod: SMART_RETRIEVAL_VECTOR_METHOD,
          closestPassages,
          refusalCategory: closestPassages.length > 0 ? 'unreliable_close_passages' : 'no_relevant_passages',
          forceSearchAvailable: closestPassages.length > 0
        }
      };
    }

    // Diversification : plafond de passages par document pour couvrir plusieurs sermons
    const maxEvidence = options.maxEvidence ?? aiConfig.smartRetrievalConfig.maxEvidence;
    const { maxPerDoc } = aiConfig.smartRetrievalConfig;
    const perDoc = new Map<string, number>();
    const selected: typeof relevant = [];
    for (const r of relevant) {
      const n = perDoc.get(r.chunk.sermonId) || 0;
      if (n >= maxPerDoc) continue;
      perDoc.set(r.chunk.sermonId, n + 1);
      selected.push(r);
      if (selected.length >= maxEvidence) break;
    }

    const bySermon = getChunksBySermonIndex(pool.allowedChunks);
    const docParagraphsCache = new Map<string, Array<{ paragraphIndex: number; text: string }>>();
    const getDocParagraphs = (sermonId: string) => {
      let paras = docParagraphsCache.get(sermonId);
      if (!paras) {
        const seen = new Set<string>();
        paras = (bySermon.get(sermonId) || [])
          .flatMap(c => buildCitationParagraphsForChunk(c, seen))
          .map(cp => ({ paragraphIndex: cp.paragraphIndex, text: cp.fullParagraphText || cp.textSnippet }));
        docParagraphsCache.set(sermonId, paras);
      }
      return paras;
    };

    const seenCitationKeys = new Set<string>();
    const evidence: RetrievalEvidence[] = selected.map((r, idx) => {
      const c = r.chunk;
      const ev: RetrievalEvidence = {
        chunkId: c.chunkId,
        sermonId: c.sermonId,
        sermonTitle: c.sermonTitle,
        paragraphIds: c.paragraphIds,
        startParagraph: c.startParagraph,
        endParagraph: c.endParagraph,
        text: c.text,
        date: c.date,
        city: c.city,
        version: c.version,
        retrievalScore: r.score / 3,
        rank: idx + 1,
        sourceType: 'reranked',
        citationParagraphs: buildCitationParagraphsForChunk(c, seenCitationKeys)
      };
      const adjacentContext = buildAdjacentContextForEvidence(ev, getDocParagraphs(c.sermonId));
      return adjacentContext ? { ...ev, adjacentContext } : ev;
    });

    const strongCount = selected.filter(r => r.score === 3).length;
    return {
      status: 'ok',
      standaloneQuery,
      evidencePackage: {
        answerable: true,
        confidenceScore: Math.round((selected.reduce((sum, r) => sum + r.score, 0) / (selected.length * 3)) * 100) / 100,
        reason: `${selected.length} passage(s) jugé(s) pertinent(s) par analyse sémantique (${strongCount} central(aux)) parmi ${candidateChunks.length} candidats.`,
        isPartial: selected.length < 3,
        evidence,
        query: standaloneQuery,
        totalCandidates: candidateChunks.length,
        rejectedCount: candidateChunks.length - selected.length,
        vectorMethod: SMART_RETRIEVAL_VECTOR_METHOD
      }
    };
  } catch (err) {
    console.warn('[SmartRAG] Repli vers le pipeline local :', err);
    return { status: 'fallback', standaloneQuery: cleanQuery, reason: String((err as any)?.message || err) };
  }
}
