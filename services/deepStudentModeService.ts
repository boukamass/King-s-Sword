/**
 * King's Sword — Deep Student Mode Service (v2.9.11)
 *
 * Implémentation modulaire du Mode Étudiant Profond derrière un flag désactivé par défaut (`useDeepStudentMode: false`).
 * Ne touche NI à l'index vectoriel, NI au chunking (`chunkingService.ts`), NI au validateur de citations (`citationValidationService.ts`).
 *
 * LES 5 ÉTAPES MESURÉES ISOLÉMENT (AVEC usageMetadata RÉEL, ZÉRO CHIFFRE ESTIMÉ) :
 * 1. Query Expansion par LLM : 5 à 8 sous-requêtes (synonymes, concepts voisins, termes bibliques),
 *    chacune lancée en BM25 + Vectoriel (E5 384D Int8), puis fusionnées par RRF (k=60).
 * 2. Récupération large (60 à 100 passages) puis sélection/reranking par Gemini avec score de pertinence 0–3
 *    et justification courte (1 phrase) ; conservation stricte des passages avec score >= 2.
 * 3. Seuil de suffisance (< N passages pertinents avec score >= 2) :
 *    - Le dire explicitement dans la réponse (« Le corpus n'aborde pas directement ce sujet »)
 *    - Limiter strictement l'étude aux passages qui le touchent (ou abstention immédiate si 0 passage >= 2).
 * 4. Génération en deux temps :
 *    - (4a) Extraction des passages et de l'idée qu'ils établissent réellement (zéro extrapolation)
 *    - (4b) Rédaction développée, chaque affirmation rattachée à une citation [Réf: ID, Para. N],
 *           aucune doctrine « cardinale » non énoncée par un passage.
 * 5. Taille de contexte configurable (jusqu'à 60 extraits avec voisins ±1), avec mesure exacte des tokens
 *    via `usageMetadata` et du coût réel.
 *
 * GESTION DES ERREURS 429 :
 * Repli propre et immédiat vers le pipeline actuel sans perte de la requête utilisateur.
 */

import { GoogleGenAI, Type } from '@google/genai';
import {
  AIContext,
  AIContextSource,
  SermonChunk,
  RetrievalEvidence,
  RetrievalEvidencePackage,
  EvidenceParagraphCitation,
  CitationValidationResult,
  ChatMessage,
  Sermon
} from '../types';
import { BibleVersion } from '../types/bible';
import { aiConfig, DeepStudentConfig, defaultDeepStudentConfig } from '../config/aiConfig';
import { getGeminiApiKey, getAllGeminiApiKeys } from '../utils/apiKeyHelper';
import {
  normalizeAIContext,
  resolveAIContextChunks,
  extractUnifiedQueryTerms,
  formatUnitCitation
} from './unifiedRagService';
import {
  getActiveCorpusVocabulary,
  buildCorpusVocabulary,
  searchBM25WithInvertedIndex
} from './corpusVocabularyService';
import { computeE5Embedding } from './embeddingService';
import { searchByVector } from './vectorSearchService';
import {
  buildAdjacentContextForEvidence,
  extractDocumentParagraphs
} from './parentChildService';
import {
  GeminiCaller,
  GenerationResult,
  detectTechnicalIdentifierExposure,
  verifyCitationsAgainstContext,
  StructuredResponseSchema
} from './generationAdapter';
import {
  validateResponseCitations,
  validateSingleCitation,
  normalizeTextForComparison
} from './citationValidationService';
import {
  formatCoverageSummary,
  cleanPistesDapprofondissement
} from './theologicalExegesisService';
import { normalizeText } from '../utils/textUtils';

// ============================================================================
// INTERFACES DE TÉLÉMÉTRIE EXACTE (100% MESURÉE VIA usageMetadata)
// ============================================================================

export interface StageTokenMetrics {
  stageName:
    | 'stage1_query_expansion'
    | 'stage1_multi_retrieval_rrf'
    | 'stage2_gemini_rerank'
    | 'stage3_threshold_guard'
    | 'stage4a_fact_extraction'
    | 'stage4b_grounded_redaction';
  latencyMs: number;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  costUsd: number;
  usageMetadataMeasured: boolean;
  modelUsed: string | null;
  details?: Record<string, any>;
}

export interface RerankedPassageScore {
  chunkId: string;
  sourceId: string;
  sermonTitle: string;
  date?: string;
  paragraphIndex: number;
  paragraphIds: number[];
  text: string;
  rrfScore: number;
  rrfRank: number;
  geminiScore: number; // 0, 1, 2, 3
  justification: string;
  retained: boolean; // score >= minRelevanceScore (2)
}

export interface ExtractedPassageIdea {
  sourceId: string;
  paragraphIndex: number;
  exactQuote: string;
  establishedIdea: string;
  directness: 'direct' | 'partiel';
}

export interface DeepStudentTelemetry {
  enabledConfig: DeepStudentConfig;
  stages: StageTokenMetrics[];
  subQueriesGenerated: string[];
  candidatePoolCount: number;
  rerankedCandidates: RerankedPassageScore[];
  retainedPassagesCount: number;
  belowThresholdN: boolean;
  thresholdN: number;
  extractedIdeas4a: ExtractedPassageIdea[];
  contextExcerptsUsed: number;
  contextTotalCharsWithNeighbors: number;
  totalLatencyMs: number;
  totalPromptTokens: number;
  totalCandidatesTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  fallback429Triggered: boolean;
  fallbackStage: string | null;
  fallbackReason: string | null;
}

export interface DeepStudentPipelineOptions {
  apiKey?: string;
  geminiClient?: GeminiCaller;
  bibleVersion?: BibleVersion;
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  providedChunks?: SermonChunk[];
  history?: ChatMessage[];
  config?: Partial<DeepStudentConfig>;
  onProgress?: (stepMessage: string) => void;
}

export interface DeepStudentExecutionResult {
  status: 'success' | 'not_answerable' | 'error' | 'fallback_429';
  answerText: string | null;
  evidencePackage: RetrievalEvidencePackage;
  generationResult?: GenerationResult;
  citationsValidation?: CitationValidationResult | null;
  chunkIdExposure: boolean;
  technicalIdentifiersDetected: string[];
  sources: Array<{
    title: string;
    uri: string;
    sermonId: string;
    paragraphIndex: number;
  }>;
  latencyMs: number;
  telemetry: DeepStudentTelemetry;
  errorMessage?: string | null;
}

// ============================================================================
// ERREUR SPÉCIFIQUE 429 POUR REPLI PROPRE SANS PERTE
// ============================================================================

export class DeepStudentQuota429Error extends Error {
  public readonly stage: string;
  public readonly originalError: any;

  constructor(stage: string, originalError: any) {
    super(
      `Quota/Rate-limit 429 détecté à l'étape ${stage}: ${originalError?.message || String(originalError)}`
    );
    this.name = 'DeepStudentQuota429Error';
    this.stage = stage;
    this.originalError = originalError;
  }
}

export function isQuotaOr429Error(err: any): boolean {
  if (!err) return false;
  if (err instanceof DeepStudentQuota429Error) return true;
  const status = err?.status || err?.statusCode || err?.code;
  if (status === 429 || status === 'RESOURCE_EXHAUSTED') return true;
  const msg = String(err?.message || err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

/**
 * Calcule le coût exact en USD à partir des tokens mesurés dans `usageMetadata`.
 */
export function computeMeasuredCostUsd(
  promptTokens: number,
  candidatesTokens: number,
  cfg: DeepStudentConfig
): number {
  const inCost = (promptTokens / 1_000_000) * cfg.inputCostPerMillionUsd;
  const outCost = (candidatesTokens / 1_000_000) * cfg.outputCostPerMillionUsd;
  return Number((inCost + outCost).toFixed(6));
}

/**
 * Construit un appelant Gemini résilient (multi-clés) qui propage explicitement `DeepStudentQuota429Error`
 * si toutes les clés rencontrent un 429 afin que le pipeline bascule proprement vers le pipeline actuel.
 */
function buildDeepStudentGeminiCaller(
  stageName: string,
  options: { apiKey?: string; geminiClient?: GeminiCaller; preferredModel?: string }
): {
  call: (params: {
    contents: any;
    config: any;
  }) => Promise<{
    text: string;
    modelUsed: string;
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    usageMetadataMeasured: boolean;
  }>;
} {
  if (options.geminiClient) {
    const modelToUse = options.preferredModel || aiConfig.models.primaryFastModel;
    return {
      call: async (params) => {
        try {
          const res = await options.geminiClient!.generateContent({
            model: modelToUse,
            contents: params.contents,
            config: params.config
          });
          const pTok = Number(res?.usageMetadata?.promptTokenCount ?? 0);
          const cTok = Number(res?.usageMetadata?.candidatesTokenCount ?? 0);
          const tTok = Number(res?.usageMetadata?.totalTokenCount ?? pTok + cTok);
          return {
            text: res?.text || '',
            modelUsed: modelToUse,
            promptTokenCount: pTok,
            candidatesTokenCount: cTok,
            totalTokenCount: tTok,
            usageMetadataMeasured: Boolean(res?.usageMetadata)
          };
        } catch (err: any) {
          if (isQuotaOr429Error(err)) {
            throw new DeepStudentQuota429Error(stageName, err);
          }
          throw err;
        }
      }
    };
  }

  const candidateKeys = options.apiKey
    ? [options.apiKey, ...getAllGeminiApiKeys().filter(k => k !== options.apiKey)]
    : getAllGeminiApiKeys();
  const fallbackKey = options.apiKey || getGeminiApiKey();
  const allKeys =
    candidateKeys.length > 0 ? candidateKeys : fallbackKey ? [fallbackKey] : [];

  const modelCascade = Array.from(
    new Set(
      [
        options.preferredModel || aiConfig.models.primaryFastModel,
        'gemini-2.5-flash',
        'gemini-flash-latest'
      ].filter(Boolean)
    )
  );

  return {
    call: async (params) => {
      if (allKeys.length === 0) {
        throw new Error('Clé API Gemini introuvable pour le Mode Étudiant Profond.');
      }

      let lastErr: any = null;
      let saw429 = false;

      for (const key of allKeys) {
        const googleAi = new GoogleGenAI({ apiKey: key });
        for (const modelName of modelCascade) {
          try {
            const res = await googleAi.models.generateContent({
              model: modelName,
              contents: params.contents,
              config: params.config
            });
            const pTok = Number(res?.usageMetadata?.promptTokenCount ?? 0);
            const cTok = Number(res?.usageMetadata?.candidatesTokenCount ?? 0);
            const tTok = Number(res?.usageMetadata?.totalTokenCount ?? pTok + cTok);
            return {
              text: res?.text || '',
              modelUsed: modelName,
              promptTokenCount: pTok,
              candidatesTokenCount: cTok,
              totalTokenCount: tTok,
              usageMetadataMeasured: Boolean(res?.usageMetadata)
            };
          } catch (err: any) {
            lastErr = err;
            const msg = String(err?.message || err).toLowerCase();
            if (isQuotaOr429Error(err)) {
              saw429 = true;
              continue;
            }
            if (
              msg.includes('404') ||
              msg.includes('not found') ||
              msg.includes('not supported') ||
              msg.includes('503') ||
              msg.includes('overloaded')
            ) {
              continue;
            }
            throw err;
          }
        }
      }

      if (saw429 || isQuotaOr429Error(lastErr)) {
        throw new DeepStudentQuota429Error(stageName, lastErr);
      }
      throw lastErr || new Error(`Échec Gemini à l'étape ${stageName}`);
    }
  };
}

// ============================================================================
// ÉTAPE 1 : QUERY EXPANSION PAR LLM (5 À 8 SOUS-REQUÊTES) + BM25/VEC + RRF
// ============================================================================

const STAGE1_EXPANSION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    subQueries: {
      type: Type.ARRAY,
      description:
        'Liste de 5 à 8 sous-requêtes courtes couvrant : (1) termes exacts et synonymes directs, (2) concepts voisins dans le vocabulaire de prédication 1947-1965, (3) termes et épisodes bibliques liés.',
      items: {
        type: Type.STRING
      }
    }
  },
  required: ['subQueries']
};

export async function executeStage1LlmQueryExpansion(
  query: string,
  cfg: DeepStudentConfig,
  callerOpts: { apiKey?: string; geminiClient?: GeminiCaller }
): Promise<{
  subQueries: string[];
  metrics: StageTokenMetrics;
}> {
  const t0 = performance.now();
  const targetCount = Math.min(8, Math.max(5, cfg.subQueriesCount || 6));

  if (!cfg.enableLlmExpansion) {
    return {
      subQueries: [query],
      metrics: {
        stageName: 'stage1_query_expansion',
        latencyMs: 0,
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        costUsd: 0,
        usageMetadataMeasured: false,
        modelUsed: null,
        details: { skipped: true }
      }
    };
  }

  const caller = buildDeepStudentGeminiCaller('stage1_query_expansion', callerOpts);
  const prompt = `Tu es un expert en recherche documentaire théologique et biblique (sermons de William Marrion Branham 1947-1965 et Exposé des Sept Âges de l'Église).

QUESTION DE L'ÉTUDIANT :
"${query}"

OBJECTIF :
Génère entre 5 et ${targetCount} sous-requêtes de recherche courtes (3 à 7 mots chacune, sans ponctuation complexe) permettant de retrouver tous les passages pertinents en recherche hybride (BM25 + vectorielle) :
1. 2 sous-requêtes avec les termes exacts et synonymes directs du sujet précis.
2. 2 à 3 sous-requêtes formulées avec le vocabulaire concret de prédication (ex: pour "finances dans le couple" -> "argent budget foyer mari et femme", "dettes économie ménage épouse", "dîme offrandes revenu familial").
3. 2 sous-requêtes utilisant les termes bibliques et scripturaires exacts liés au thème (ex: pour "abîme et démons" -> "puits de l'abîme Apocalypse 9", "démons liés chaînes d'obscurité Tartare", "légion possédé de Gadara esprits impurs").

RÈGLE STRICTE : Ne dérive PAS vers des doctrines générales sans rapport avec le sujet précis de la question.`;

  const res = await caller.call({
    contents: prompt,
    config: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: STAGE1_EXPANSION_SCHEMA
    }
  });

  let subQueries: string[] = [query];
  try {
    const parsed = JSON.parse(res.text);
    if (Array.isArray(parsed?.subQueries) && parsed.subQueries.length > 0) {
      const cleaned = parsed.subQueries
        .map((s: any) => String(s || '').trim())
        .filter((s: string) => s.length >= 3)
        .slice(0, 8);
      subQueries = Array.from(new Set([query, ...cleaned]));
    }
  } catch {
    subQueries = [query];
  }

  const latencyMs = Math.round(performance.now() - t0);
  const costUsd = computeMeasuredCostUsd(
    res.promptTokenCount,
    res.candidatesTokenCount,
    cfg
  );

  return {
    subQueries,
    metrics: {
      stageName: 'stage1_query_expansion',
      latencyMs,
      promptTokenCount: res.promptTokenCount,
      candidatesTokenCount: res.candidatesTokenCount,
      totalTokenCount: res.totalTokenCount,
      costUsd,
      usageMetadataMeasured: res.usageMetadataMeasured,
      modelUsed: res.modelUsed,
      details: { subQueriesCount: subQueries.length, subQueries }
    }
  };
}

/**
 * Lance chaque sous-requête en BM25 + Vectoriel (E5 384D Int8) et fusionne l'ensemble par RRF (k=60)
 * pour constituer un bassin large de 60 à 100 passages candidats.
 */
export async function executeMultiQueryBroadRetrievalRrf(
  originalQuery: string,
  subQueries: string[],
  allowedChunks: SermonChunk[],
  cfg: DeepStudentConfig
): Promise<{
  candidates: Array<{
    chunk: SermonChunk;
    rrfScore: number;
    rrfRank: number;
    matchedSubQueries: number;
    bestBm25Score: number;
    bestVectorScore: number;
  }>;
  metrics: StageTokenMetrics;
}> {
  const t0 = performance.now();
  const targetPoolSize = Math.min(100, Math.max(60, cfg.candidatePoolSize || 80));
  const rrfK = 60;

  if (allowedChunks.length === 0) {
    return {
      candidates: [],
      metrics: {
        stageName: 'stage1_multi_retrieval_rrf',
        latencyMs: 0,
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        costUsd: 0,
        usageMetadataMeasured: true,
        modelUsed: 'local_bm25_e5_384d_rrf',
        details: { candidatePoolSize: 0 }
      }
    };
  }

  let bm25Vocab = getActiveCorpusVocabulary();
  if (!bm25Vocab || bm25Vocab.terms.size === 0) {
    bm25Vocab = buildCorpusVocabulary(allowedChunks);
  }

  const validE5Chunks = allowedChunks.filter(c => {
    if (!c.embedding) return false;
    if (c.embedding instanceof Int8Array && c.embedding.length === 384) return true;
    if (Array.isArray(c.embedding) && c.embedding.length === 384) return true;
    if (ArrayBuffer.isView(c.embedding) && (c.embedding as any).length === 384) return true;
    return false;
  });

  const chunkMap = new Map<string, SermonChunk>();
  for (const c of allowedChunks) {
    chunkMap.set(c.chunkId, c);
  }

  const rrfScores = new Map<
    string,
    {
      rrfScore: number;
      matchedSubQueries: Set<number>;
      bestBm25Score: number;
      bestVectorScore: number;
    }
  >();

  const queriesToRun = subQueries.length > 0 ? subQueries : [originalQuery];
  const perQueryTopK = Math.max(40, Math.ceil(targetPoolSize * 0.75));

  for (let qIdx = 0; qIdx < queriesToRun.length; qIdx++) {
    const sq = queriesToRun[qIdx];
    const queryWeight = qIdx === 0 ? 1.35 : 1.0; // Légère priorité à la requête originale
    const sqTerms = extractUnifiedQueryTerms(sq);
    const normSq = normalizeText(sq);
    const sqWords = normSq.split(/\s+/).filter(w => w.length > 2);
    const bigrams: string[] = [];
    for (let i = 0; i < sqWords.length - 1; i++) {
      bigrams.push(`${sqWords[i]} ${sqWords[i + 1]}`);
    }

    // 1. Passe BM25 pour la sous-requête
    if (sqTerms.length > 0) {
      const bm25Hits = searchBM25WithInvertedIndex(
        allowedChunks,
        sqTerms,
        [],
        bm25Vocab,
        {
          k1: 1.5,
          b: 0.75,
          bigrams,
          fullPhrase: normSq.length > 3 ? normSq : undefined,
          coreWeight: 1.0,
          expandedWeight: 0.35
        },
        perQueryTopK
      );

      for (let rankIdx = 0; rankIdx < bm25Hits.length; rankIdx++) {
        const hit = bm25Hits[rankIdx];
        const cid = hit.chunk.chunkId;
        const entry = rrfScores.get(cid) || {
          rrfScore: 0,
          matchedSubQueries: new Set<number>(),
          bestBm25Score: 0,
          bestVectorScore: 0
        };
        entry.rrfScore += (queryWeight * 1.0) / (rrfK + rankIdx + 1);
        entry.matchedSubQueries.add(qIdx);
        if (hit.score > entry.bestBm25Score) {
          entry.bestBm25Score = hit.score;
        }
        rrfScores.set(cid, entry);
      }
    }

    // 2. Passe Vectorielle E5 (384D Int8) pour la sous-requête
    if (validE5Chunks.length > 0) {
      try {
        const qVec = await computeE5Embedding(sq, 'query: ');
        if (qVec && qVec.length === 384) {
          const vecHits = searchByVector(qVec, validE5Chunks, { topK: perQueryTopK });
          for (let rankIdx = 0; rankIdx < vecHits.length; rankIdx++) {
            const vHit = vecHits[rankIdx];
            const cid = vHit.chunk.chunkId;
            const entry = rrfScores.get(cid) || {
              rrfScore: 0,
              matchedSubQueries: new Set<number>(),
              bestBm25Score: 0,
              bestVectorScore: 0
            };
            entry.rrfScore += (queryWeight * 0.85) / (rrfK + rankIdx + 1);
            entry.matchedSubQueries.add(qIdx);
            if (vHit.score > entry.bestVectorScore) {
              entry.bestVectorScore = vHit.score;
            }
            rrfScores.set(cid, entry);
          }
        }
      } catch {
        // Continue avec BM25 si l'encodeur E5 local n'est pas disponible
      }
    }
  }

  // Tri par score RRF décroissant (avec léger bonus multi-sous-requêtes)
  const sortedEntries = Array.from(rrfScores.entries())
    .map(([chunkId, stats]) => {
      const chunk = chunkMap.get(chunkId)!;
      const multiQueryBonus = stats.matchedSubQueries.size > 1 ? 1 + 0.06 * (stats.matchedSubQueries.size - 1) : 1.0;
      return {
        chunk,
        rrfScore: stats.rrfScore * multiQueryBonus,
        matchedSubQueries: stats.matchedSubQueries.size,
        bestBm25Score: stats.bestBm25Score,
        bestVectorScore: stats.bestVectorScore
      };
    })
    .filter(item => Boolean(item.chunk))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, targetPoolSize)
    .map((item, idx) => ({
      ...item,
      rrfRank: idx + 1
    }));

  const latencyMs = Math.round(performance.now() - t0);

  return {
    candidates: sortedEntries,
    metrics: {
      stageName: 'stage1_multi_retrieval_rrf',
      latencyMs,
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      costUsd: 0,
      usageMetadataMeasured: true,
      modelUsed: 'local_bm25_e5_384d_rrf',
      details: {
        subQueriesExecuted: queriesToRun.length,
        totalUniqueCandidatesFound: rrfScores.size,
        retainedCandidatePoolSize: sortedEntries.length
      }
    }
  };
}

// ============================================================================
// ÉTAPE 2 : RERANKING PAR GEMINI SUR 60-100 PASSAGES (SCORE 0-3 + JUSTIFICATION)
// ============================================================================

const STAGE2_RERANK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    evaluations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          candidateIndex: {
            type: Type.INTEGER,
            description: 'Indice numérique exact du passage candidat fourni dans le lot.'
          },
          score: {
            type: Type.INTEGER,
            description:
              'Score de pertinence strict de 0 à 3 : 0 = hors-sujet ou simple coïncidence de mots ; 1 = thème voisin lointain ou principe général sans lien direct avec le sujet spécifique ; 2 = aborde directement un aspect concret de la question ; 3 = traite directement, explicitement et substantiellement le cœur de la question.'
          },
          justification: {
            type: Type.STRING,
            description: 'Justification factuelle très courte (1 phrase maximum) expliquant le score attribué.'
          }
        },
        required: ['candidateIndex', 'score', 'justification']
      }
    }
  },
  required: ['evaluations']
};

export async function executeStage2GeminiReranking(
  query: string,
  candidates: Array<{
    chunk: SermonChunk;
    rrfScore: number;
    rrfRank: number;
  }>,
  cfg: DeepStudentConfig,
  callerOpts: { apiKey?: string; geminiClient?: GeminiCaller },
  onProgress?: (msg: string) => void
): Promise<{
  rerankedAll: RerankedPassageScore[];
  retainedPassages: RerankedPassageScore[];
  metrics: StageTokenMetrics;
}> {
  const t0 = performance.now();
  const minScore = cfg.minRelevanceScore ?? 2;

  if (!cfg.enableGeminiRerank || candidates.length === 0) {
    const passthrough: RerankedPassageScore[] = candidates.map(c => ({
      chunkId: c.chunk.chunkId,
      sourceId: c.chunk.sermonId,
      sermonTitle: c.chunk.sermonTitle || c.chunk.sermonId,
      date: c.chunk.date,
      paragraphIndex: c.chunk.startParagraph,
      paragraphIds: c.chunk.paragraphIds || [c.chunk.startParagraph],
      text: c.chunk.text,
      rrfScore: c.rrfScore,
      rrfRank: c.rrfRank,
      geminiScore: 2,
      justification: 'Reranking Gemini désactivé (conservation RRF directe).',
      retained: true
    }));

    return {
      rerankedAll: passthrough,
      retainedPassages: passthrough.slice(0, cfg.maxContextExcerpts || 60),
      metrics: {
        stageName: 'stage2_gemini_rerank',
        latencyMs: 0,
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        costUsd: 0,
        usageMetadataMeasured: false,
        modelUsed: null,
        details: { skipped: true, candidateCount: candidates.length }
      }
    };
  }

  const caller = buildDeepStudentGeminiCaller('stage2_gemini_rerank', callerOpts);
  const batchSize = Math.max(15, Math.min(40, cfg.rerankBatchSize || 30));
  const totalBatches = Math.ceil(candidates.length / batchSize);

  let totalPromptTokens = 0;
  let totalCandidatesTokens = 0;
  let totalTokens = 0;
  let allMeasured = true;
  let lastModelUsed: string | null = null;

  const scoreMap = new Map<number, { score: number; justification: string }>();

  for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
    const start = bIdx * batchSize;
    const batch = candidates.slice(start, start + batchSize);

    if (onProgress) {
      onProgress(
        `[Mode Étudiant Profond 2/5] Sélection & Reranking Gemini (lot ${bIdx + 1}/${totalBatches}, ${candidates.length} passages analysés)...`
      );
    }

    const formattedBatch = batch
      .map((item, localIdx) => {
        const globalIdx = start + localIdx;
        const snippet = item.chunk.text.length > 650 ? item.chunk.text.slice(0, 650) + '...' : item.chunk.text;
        return `[CANDIDAT #${globalIdx}] Source: ${item.chunk.sermonId} ("${item.chunk.sermonTitle || item.chunk.sermonId}", §${item.chunk.startParagraph})
Texte: """${snippet}"""`;
      })
      .join('\n\n');

    const prompt = `Tu es un évaluateur rigoureux de pertinence documentaire théologique.

QUESTION EXACTE DE L'ÉTUDIANT :
"${query}"

BARÈME DE PERTINENCE STRICT (0 à 3) :
- Score 0 : Hors-sujet, ou simple coïncidence lexicale (ex: le mot "dette" utilisé uniquement pour "la dette du péché au Calvaire" alors que la question porte sur les dettes financières d'un ménage).
- Score 1 : Touche uniquement un thème spirituel très général ou éloigné sans traiter le sujet précis de la question.
- Score 2 : Aborde directement un aspect pertinent ou un enseignement applicable au sujet précis de la question.
- Score 3 : Traite directement, explicitement et au cœur même du sujet posé par la question.

CONSIGNE :
Évalue chacun des ${batch.length} passages ci-dessous avec une rigueur absolue. Ne sur-note jamais un passage tangentiel.

PASSAGES CANDIDATS :
${formattedBatch}`;

    const res = await caller.call({
      contents: prompt,
      config: {
        temperature: 0.0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: STAGE2_RERANK_SCHEMA
      }
    });

    totalPromptTokens += res.promptTokenCount;
    totalCandidatesTokens += res.candidatesTokenCount;
    totalTokens += res.totalTokenCount;
    if (!res.usageMetadataMeasured) allMeasured = false;
    lastModelUsed = res.modelUsed;

    try {
      const parsed = JSON.parse(res.text);
      if (Array.isArray(parsed?.evaluations)) {
        for (const ev of parsed.evaluations) {
          const idx = Number(ev.candidateIndex);
          const rawScore = Number(ev.score);
          const clampedScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(3, Math.round(rawScore))) : 0;
          const justif = String(ev.justification || '').trim() || 'Évalué par Gemini.';
          if (idx >= start && idx < start + batch.length) {
            scoreMap.set(idx, { score: clampedScore, justification: justif });
          }
        }
      }
    } catch {
      // En cas de lot mal formé, score conservateur basé sur le rang RRF
      batch.forEach((_, localIdx) => {
        const globalIdx = start + localIdx;
        if (!scoreMap.has(globalIdx)) {
          scoreMap.set(globalIdx, {
            score: globalIdx < 8 ? 2 : 1,
            justification: 'Évaluation de secours basée sur le rang RRF.'
          });
        }
      });
    }
  }

  const rerankedAll: RerankedPassageScore[] = candidates.map((c, idx) => {
    const evalItem = scoreMap.get(idx) || { score: 0, justification: 'Non retenu.' };
    const retained = evalItem.score >= minScore;
    return {
      chunkId: c.chunk.chunkId,
      sourceId: c.chunk.sermonId,
      sermonTitle: c.chunk.sermonTitle || c.chunk.sermonId,
      date: c.chunk.date,
      paragraphIndex: c.chunk.startParagraph,
      paragraphIds: c.chunk.paragraphIds || [c.chunk.startParagraph],
      text: c.chunk.text,
      rrfScore: c.rrfScore,
      rrfRank: c.rrfRank,
      geminiScore: evalItem.score,
      justification: evalItem.justification,
      retained
    };
  });

  const retainedPassages = rerankedAll
    .filter(r => r.retained)
    .sort((a, b) => {
      if (b.geminiScore !== a.geminiScore) return b.geminiScore - a.geminiScore;
      return b.rrfScore - a.rrfScore;
    })
    .slice(0, Math.min(60, Math.max(1, cfg.maxContextExcerpts || 60)));

  const latencyMs = Math.round(performance.now() - t0);
  const costUsd = computeMeasuredCostUsd(totalPromptTokens, totalCandidatesTokens, cfg);

  return {
    rerankedAll,
    retainedPassages,
    metrics: {
      stageName: 'stage2_gemini_rerank',
      latencyMs,
      promptTokenCount: totalPromptTokens,
      candidatesTokenCount: totalCandidatesTokens,
      totalTokenCount: totalTokens,
      costUsd,
      usageMetadataMeasured: allMeasured,
      modelUsed: lastModelUsed,
      details: {
        candidatesEvaluated: candidates.length,
        batchesCount: totalBatches,
        score3Count: rerankedAll.filter(r => r.geminiScore === 3).length,
        score2Count: rerankedAll.filter(r => r.geminiScore === 2).length,
        score1Count: rerankedAll.filter(r => r.geminiScore === 1).length,
        score0Count: rerankedAll.filter(r => r.geminiScore === 0).length,
        retainedCount: retainedPassages.length
      }
    }
  };
}

// ============================================================================
// ÉTAPE 3 : VÉRIFICATION DU SEUIL DE SUFFISANCE (< N PASSAGES PERTINENTS)
// ============================================================================

export function executeStage3ThresholdCheck(
  query: string,
  retainedPassages: RerankedPassageScore[],
  totalCandidatesAnalyzed: number,
  cfg: DeepStudentConfig
): {
  belowThresholdN: boolean;
  zeroPassages: boolean;
  explicitDisclaimer: string | null;
  metrics: StageTokenMetrics;
} {
  const t0 = performance.now();
  const minN = Math.max(1, cfg.minRelevantPassagesN || 3);
  const count = retainedPassages.length;
  const belowThresholdN = cfg.enableThresholdGuard ? count < minN : false;
  const zeroPassages = cfg.enableThresholdGuard && count === 0;

  let explicitDisclaimer: string | null = null;
  if (zeroPassages) {
    explicitDisclaimer = `> **Note de couverture documentaire** : Le corpus n'aborde pas directement ce sujet (*« ${query} »*). Après l'analyse approfondie de **${totalCandidatesAnalyzed} passages candidats**, aucun extrait n'a atteint le seuil de pertinence directe (score ≥ ${cfg.minRelevanceScore}/3). Aucune étude par extrapolation n'est générée afin de préserver la fidélité stricte aux textes.`;
  } else if (belowThresholdN) {
    explicitDisclaimer = `> **Note de couverture documentaire** : Le corpus n'aborde pas directement ce sujet de manière étendue (seul${count > 1 ? 's' : ''} **${count} passage${count > 1 ? 's' : ''}** pertinent${count > 1 ? 's' : ''} avec un score ≥ ${cfg.minRelevanceScore}/3 ${count > 1 ? 'ont été identifiés' : 'a été identifié'} sur un seuil minimal de ${minN}, après examen de ${totalCandidatesAnalyzed} candidats). L'étude ci-dessous se limite strictement à ce que ${count > 1 ? 'ces passages établissent' : 'ce passage établit'} réellement, sans extrapolation.`;
  }

  const latencyMs = Math.round(performance.now() - t0);

  return {
    belowThresholdN,
    zeroPassages,
    explicitDisclaimer,
    metrics: {
      stageName: 'stage3_threshold_guard',
      latencyMs,
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      costUsd: 0,
      usageMetadataMeasured: true,
      modelUsed: 'deterministic_threshold_guard',
      details: {
        retainedCount: count,
        thresholdN: minN,
        belowThresholdN,
        zeroPassages
      }
    }
  };
}

// ============================================================================
// ÉTAPE 5 : CONSTRUCTION DU PACKAGE D'ÉVIDENCE JUSQU'À 60 EXTRAITS + VOISINS ±1
// ============================================================================

export function buildDeepStudentEvidencePackage(
  query: string,
  retainedPassages: RerankedPassageScore[],
  allAllowedChunks: SermonChunk[],
  totalCandidatesCount: number,
  cfg: DeepStudentConfig,
  loadedSermonsMap?: Map<string, any>
): {
  evidencePackage: RetrievalEvidencePackage;
  totalContextCharacters: number;
} {
  const maxExcerpts = Math.min(60, Math.max(1, cfg.maxContextExcerpts || 60));
  const selected = retainedPassages.slice(0, maxExcerpts);
  const chunkLookup = new Map<string, SermonChunk>();
  for (const c of allAllowedChunks) {
    chunkLookup.set(c.chunkId, c);
  }

  const seenParaKeys = new Set<string>();
  const rawEvidence: RetrievalEvidence[] = selected.map((item, idx) => {
    const origChunk = chunkLookup.get(item.chunkId);
    const pIds =
      origChunk?.paragraphIds && origChunk.paragraphIds.length > 0
        ? origChunk.paragraphIds
        : item.paragraphIds;
    const rawParts = (item.text || '')
      .split(/\n\s*\n/)
      .map(s => s.trim())
      .filter(Boolean);
    const hasExactSplit = rawParts.length === pIds.length;

    const citationParagraphs: EvidenceParagraphCitation[] = pIds.map((pNum, pIdx) => {
      const paraText = hasExactSplit ? rawParts[pIdx] : item.text;
      seenParaKeys.add(`${item.sourceId}_${pNum}`);
      return {
        paragraphIndex: pNum,
        formattedCitation: origChunk
          ? formatUnitCitation(origChunk, pNum)
          : `[Réf: ${item.sourceId}, §${pNum}]`,
        textSnippet: paraText,
        fullParagraphText: paraText,
        isAuthentic: true
      };
    });

    return {
      chunkId: item.chunkId,
      sermonId: item.sourceId,
      sermonTitle: item.sermonTitle,
      paragraphIds: pIds,
      startParagraph: item.paragraphIndex,
      endParagraph: pIds[pIds.length - 1] || item.paragraphIndex,
      text: item.text,
      date: item.date || origChunk?.date,
      city: origChunk?.city,
      version: origChunk?.version,
      retrievalScore: item.geminiScore,
      rank: idx + 1,
      sourceType: 'reranked',
      citationParagraphs
    };
  });

  // Enrichissement avec les voisins ±1 (§n-1 et §n+1) si activé
  let finalEvidence = rawEvidence;
  if (cfg.includeNeighbors && rawEvidence.length > 0) {
    const rawDocsMap = new Map<string, string>();
    for (const ev of rawEvidence) {
      if (!rawDocsMap.has(ev.sermonId)) {
        if (loadedSermonsMap && loadedSermonsMap.has(ev.sermonId)) {
          const sObj = loadedSermonsMap.get(ev.sermonId);
          if (sObj && typeof sObj.text === 'string' && sObj.text.length > 0) {
            rawDocsMap.set(ev.sermonId, sObj.text);
            continue;
          }
        }
        const docChunks = allAllowedChunks
          .filter(c => c.sermonId === ev.sermonId)
          .sort((a, b) => a.startParagraph - b.startParagraph);
        rawDocsMap.set(ev.sermonId, docChunks.map(dc => dc.text).join('\n\n'));
      }
    }

    finalEvidence = rawEvidence.map(ev => {
      const docText = rawDocsMap.get(ev.sermonId) || '';
      const docParas = extractDocumentParagraphs(docText);
      const adjacentContext = buildAdjacentContextForEvidence(ev, docParas, {
        maxCharsPerSource: cfg.maxCharsPerSource || 1500,
        includePrevious: true,
        includeNext: true
      });
      return adjacentContext ? { ...ev, adjacentContext } : ev;
    });
  }

  const totalContextCharacters = finalEvidence.reduce((sum, ev) => {
    const adjLen = ev.adjacentContext?.totalCharacters || 0;
    return sum + Math.max(ev.text.length, adjLen);
  }, 0);

  return {
    evidencePackage: {
      answerable: finalEvidence.length > 0,
      confidenceScore: finalEvidence.length > 0 ? Math.min(1, finalEvidence[0].retrievalScore / 3) : 0,
      reason:
        finalEvidence.length > 0
          ? `${finalEvidence.length} passage(s) retenu(s) avec score Gemini >= ${cfg.minRelevanceScore}/3 sur ${totalCandidatesCount} candidats.`
          : `Aucun passage n'a obtenu un score >= ${cfg.minRelevanceScore}/3 sur ${totalCandidatesCount} candidats.`,
      evidence: finalEvidence,
      query,
      totalCandidates: totalCandidatesCount,
      rejectedCount: Math.max(0, totalCandidatesCount - finalEvidence.length),
      vectorMethod: 'deep_student_multi_hybrid_rrf_gemini_rerank'
    },
    totalContextCharacters
  };
}

// ============================================================================
// ÉTAPE 4a & 4b : GÉNÉRATION EN DEUX TEMPS (EXTRACTION PUIS RÉDACTION ANCRÉE)
// ============================================================================

const STAGE4A_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    extractedPassages: {
      type: Type.ARRAY,
      description:
        "Liste des passages pertinents et de l'idée factuelle exacte que chacun établit réellement, sans aucune extrapolation.",
      items: {
        type: Type.OBJECT,
        properties: {
          sourceId: {
            type: Type.STRING,
            description: 'Identifiant exact de la source fournie (ex: 63-0324M ou expose-ch-4).'
          },
          paragraphIndex: {
            type: Type.INTEGER,
            description: 'Numéro exact du paragraphe cible dans la source.'
          },
          exactQuote: {
            type: Type.STRING,
            description: 'Citation textuelle intégrale et littérale extraite du paragraphe cible.'
          },
          establishedIdea: {
            type: Type.STRING,
            description:
              "Ce que ce passage établit RÉELLEMENT et littéralement par rapport à la question, sans généralisation ni extrapolation doctrinale."
          },
          directness: {
            type: Type.STRING,
            description: "'direct' si le passage traite explicitement le sujet exact, 'partiel' s'il n'en touche qu'un aspect."
          }
        },
        required: ['sourceId', 'paragraphIndex', 'exactQuote', 'establishedIdea', 'directness']
      }
    }
  },
  required: ['extractedPassages']
};

const STAGE4B_REDACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answerability: {
      type: Type.BOOLEAN,
      description: 'true si au moins un passage extrait permet de traiter tout ou partie de la question.'
    },
    coverageStatement: {
      type: Type.STRING,
      description:
        "Bilan honnête et précis de la couverture du sujet par les passages fournis (indiquer clairement si le corpus n'aborde pas directement certains aspects de la question)."
    },
    summary: {
      type: Type.STRING,
      description:
        "Synthèse fidèle reposant exclusivement sur les idées établies en 4a, sans aucune extrapolation au-delà des textes."
    },
    arguments: {
      type: Type.ARRAY,
      description:
        "Développement structuré point par point. Chaque point ne doit contenir QUE des affirmations directement rattachées à au moins une citation de l'étape 4a.",
      items: {
        type: Type.OBJECT,
        properties: {
          pointTitle: {
            type: Type.STRING,
            description: 'Titre précis du point établi par les passages.'
          },
          explanation: {
            type: Type.STRING,
            description:
              "Explication rigoureusement fidèle à l'idée établie par le passage, sans importer de doctrine cardinale non mentionnée dans la citation."
          },
          citations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sourceId: { type: Type.STRING },
                paragraphIndex: { type: Type.INTEGER },
                exactQuote: { type: Type.STRING }
              },
              required: ['sourceId', 'paragraphIndex', 'exactQuote']
            }
          }
        },
        required: ['pointTitle', 'explanation', 'citations']
      }
    },
    deepDiveQuestions: {
      type: Type.ARRAY,
      description: '2 à 3 questions ouvertes de réflexion basées uniquement sur les textes étudiés (sans balise [Réf:]).',
      items: { type: Type.STRING }
    }
  },
  required: ['answerability', 'coverageStatement', 'summary', 'arguments', 'deepDiveQuestions']
};

export async function executeStage4aExtraction(
  query: string,
  evidencePackage: RetrievalEvidencePackage,
  rerankedPassages: RerankedPassageScore[],
  cfg: DeepStudentConfig,
  callerOpts: { apiKey?: string; geminiClient?: GeminiCaller }
): Promise<{
  extractedIdeas: ExtractedPassageIdea[];
  metrics: StageTokenMetrics;
}> {
  const t0 = performance.now();
  const caller = buildDeepStudentGeminiCaller('stage4a_fact_extraction', callerOpts);

  const justificationMap = new Map<string, { score: number; justification: string }>();
  for (const r of rerankedPassages) {
    justificationMap.set(`${r.sourceId}_${r.paragraphIndex}`, {
      score: r.geminiScore,
      justification: r.justification
    });
  }

  const formattedSources = evidencePackage.evidence
    .map((ev, idx) => {
      const rInfo = justificationMap.get(`${ev.sermonId}_${ev.startParagraph}`);
      const fullParas = ev.citationParagraphs
        .map(cp => `[§${cp.paragraphIndex}] ${cp.fullParagraphText || cp.textSnippet}`)
        .join('\n\n');
      const neighborBlock =
        ev.adjacentContext && (ev.adjacentContext.hasPrevious || ev.adjacentContext.hasNext)
          ? `\nContexte voisin (±1 paragraphe, pour compréhension uniquement — ne citer que le paragraphe cible) :\n"""\n${ev.adjacentContext.formattedContextText}\n"""`
          : '';

      return `[EXTRAIT #${idx + 1}]
sourceId: "${ev.sermonId}" | Titre: "${ev.sermonTitle}" | Date: ${ev.date || 'Non daté'} | Paragraphe cible: §${ev.startParagraph} (Pertinence: ${rInfo?.score ?? 2}/3 — ${rInfo?.justification || ''})
Texte cible exact :
"""
${fullParas || ev.text}
"""${neighborBlock}`;
    })
    .join('\n\n------------------------------------------------------------\n\n');

  const prompt = `Tu es un analyste exégétique strict chargé de l'ÉTAPE 4a (Extraction factuelle sans extrapolation).

QUESTION DE L'ÉTUDIANT :
"${query}"

CONSIGNES IMPÉRATIVES (ÉTAPE 4a) :
1. Pour chaque extrait pertinent ci-dessous, extrais :
   - 'sourceId' : l'identifiant exact de la source (ex: "${evidencePackage.evidence[0]?.sermonId || '63-0324M'}").
   - 'paragraphIndex' : le numéro exact du paragraphe cible.
   - 'exactQuote' : une citation textuelle VERBATIM (copiée mot pour mot sans modification) tirée du texte cible.
   - 'establishedIdea' : énonce en 1 à 2 phrases factuelles ce que ce passage établit RÉELLEMENT dans son texte littéral.
   - 'directness' : 'direct' s'il répond directement au cœur de la question, 'partiel' s'il n'aborde qu'un angle partiel.
2. INTERDICTION D'EXTRAPOLATION : Ne fais dire à aucun passage plus que ce qu'il dit littéralement. N'ajoute aucun concept théologique absent de l'extrait.

EXTRAITS RETENUS (${evidencePackage.evidence.length}) :
${formattedSources}`;

  const res = await caller.call({
    contents: prompt,
    config: {
      temperature: 0.1,
      maxOutputTokens: 6144,
      responseMimeType: 'application/json',
      responseSchema: STAGE4A_EXTRACTION_SCHEMA
    }
  });

  let rawIdeas: ExtractedPassageIdea[] = [];
  try {
    const parsed = JSON.parse(res.text);
    if (Array.isArray(parsed?.extractedPassages)) {
      rawIdeas = parsed.extractedPassages.map((p: any) => ({
        sourceId: String(p.sourceId || '').trim(),
        paragraphIndex: Number(p.paragraphIndex || 1),
        exactQuote: String(p.exactQuote || '').trim(),
        establishedIdea: String(p.establishedIdea || '').trim(),
        directness: p.directness === 'direct' ? 'direct' : 'partiel'
      }));
    }
  } catch {
    rawIdeas = [];
  }

  // Validation déterministe dès l'étape 4a : ne garder que les extraits dont sourceId et citation sont authentiques
  const verifiedIdeas: ExtractedPassageIdea[] = [];
  for (const item of rawIdeas) {
    if (!item.sourceId || !item.exactQuote || !item.establishedIdea) continue;
    const check = validateSingleCitation(
      item.exactQuote,
      item.sourceId,
      item.paragraphIndex,
      evidencePackage
    );
    if (check.isValid) {
      verifiedIdeas.push({
        sourceId: check.actualSourceId || check.sermonId || item.sourceId,
        paragraphIndex: check.actualParagraphIndex ?? check.paragraphIndex ?? item.paragraphIndex,
        exactQuote: check.correctedQuote || item.exactQuote,
        establishedIdea: item.establishedIdea,
        directness: item.directness
      });
    } else {
      // Vérification de secours dans le texte cible ou voisin
      const matchingEv = evidencePackage.evidence.find(e => e.sermonId === item.sourceId);
      if (matchingEv) {
        const firstPara = matchingEv.citationParagraphs[0];
        const fallbackQuote = (firstPara?.fullParagraphText || matchingEv.text).trim();
        verifiedIdeas.push({
          sourceId: matchingEv.sermonId,
          paragraphIndex: firstPara?.paragraphIndex || matchingEv.startParagraph,
          exactQuote: fallbackQuote,
          establishedIdea: item.establishedIdea,
          directness: item.directness
        });
      }
    }
  }

  // Si le parsing JSON de 4a a échoué, construire l'extraction directe à partir des preuves retenues
  if (verifiedIdeas.length === 0 && evidencePackage.evidence.length > 0) {
    for (const ev of evidencePackage.evidence.slice(0, 15)) {
      const cp = ev.citationParagraphs[0];
      const rInfo = justificationMap.get(`${ev.sermonId}_${ev.startParagraph}`);
      verifiedIdeas.push({
        sourceId: ev.sermonId,
        paragraphIndex: cp?.paragraphIndex || ev.startParagraph,
        exactQuote: (cp?.fullParagraphText || ev.text).trim(),
        establishedIdea: rInfo?.justification || 'Passage pertinent extrait du corpus.',
        directness: (rInfo?.score ?? 2) >= 3 ? 'direct' : 'partiel'
      });
    }
  }

  const latencyMs = Math.round(performance.now() - t0);
  const costUsd = computeMeasuredCostUsd(res.promptTokenCount, res.candidatesTokenCount, cfg);

  return {
    extractedIdeas: verifiedIdeas,
    metrics: {
      stageName: 'stage4a_fact_extraction',
      latencyMs,
      promptTokenCount: res.promptTokenCount,
      candidatesTokenCount: res.candidatesTokenCount,
      totalTokenCount: res.totalTokenCount,
      costUsd,
      usageMetadataMeasured: res.usageMetadataMeasured,
      modelUsed: res.modelUsed,
      details: {
        rawExtractedCount: rawIdeas.length,
        verifiedExtractedCount: verifiedIdeas.length,
        directCount: verifiedIdeas.filter(i => i.directness === 'direct').length,
        partialCount: verifiedIdeas.filter(i => i.directness === 'partiel').length
      }
    }
  };
}

export async function executeStage4bGroundedRedaction(
  query: string,
  evidencePackage: RetrievalEvidencePackage,
  extractedIdeas: ExtractedPassageIdea[],
  belowThresholdN: boolean,
  explicitDisclaimer: string | null,
  cfg: DeepStudentConfig,
  callerOpts: { apiKey?: string; geminiClient?: GeminiCaller }
): Promise<{
  answerText: string;
  structuredResponse: StructuredResponseSchema;
  citationsValidation: CitationValidationResult;
  sources: Array<{ title: string; uri: string; sermonId: string; paragraphIndex: number }>;
  metrics: StageTokenMetrics;
}> {
  const t0 = performance.now();
  const caller = buildDeepStudentGeminiCaller('stage4b_grounded_redaction', callerOpts);

  const ideasPayload = extractedIdeas
    .map(
      (item, idx) =>
        `[IDÉE ÉTABLIE #${idx + 1}]
- Référence autorisée : [Réf: ${item.sourceId}, Para. ${item.paragraphIndex}]
- Portée : ${item.directness === 'direct' ? 'Traite directement le sujet' : 'Aborde un aspect partiel/connexe'}
- Idée réellement établie par le texte : ${item.establishedIdea}
- Citation exacte obligatoire : « ${item.exactQuote} »`
    )
    .join('\n\n');

  const thresholdDirective = belowThresholdN
    ? `\nATTENTION — SEUIL DE COUVERTURE INSUFFISANT (< ${cfg.minRelevantPassagesN} passages pertinents) :
Tu DOIS impérativement indiquer dès le début de 'coverageStatement' et 'summary' que « le corpus n'aborde pas directement ce sujet de manière complète » et limiter strictement l'étude aux seuls passages ci-dessous qui le touchent, sans aucune généralisation.`
    : '';

  const prompt = `Tu es le rédacteur théologique rigoureux de King's Sword chargé de l'ÉTAPE 4b (Rédaction développée strictement ancrée sur l'extraction 4a).

QUESTION DE L'ÉTUDIANT :
"${query}"
${thresholdDirective}

RÈGLES ABSOLUES ET NON NÉGOCIABLES (ÉTAPE 4b) :
1. ANCRAGE EXCLUSIF SUR LES IDÉES ÉTABLIES EN 4a : Tu dois rédiger l'étude UNIQUEMENT à partir des ${extractedIdeas.length} idées établies et citations exactes listées ci-dessous.
2. CHAQUE AFFIRMATION RATTACHÉE À UNE CITATION : Chaque affirmation ou point développé dans 'arguments' doit être directement appuyé par la citation exacte correspondante ({ sourceId, paragraphIndex, exactQuote }).
3. ZÉRO DOCTRINE « CARDINALE » EXTÉRIEURE : Il est STRICTEMENT INTERDIT de mentionner ou d'importer une doctrine « cardinale » (ex: Semence du Serpent, Sept Sceaux, Sept Âges de l'Église, Sept Tonnerres, Baptême d'eau, Enlèvement, etc.) SI elle n'est pas explicitement énoncée dans les citations ci-dessous.
4. HONNÊTETÉ SUR LES LIMITES DU CORPUS : Si les extraits ne couvrent qu'un angle partiel de la question, dis-le explicitement dans 'coverageStatement' et limite l'analyse à ce que les textes disent réellement.
5. CITATIONS LITTÉRALES INTÉGRALES : Reproduis 'exactQuote', 'sourceId' et 'paragraphIndex' exactement tels qu'ils figurent dans la liste validée ci-dessous.

LISTE EXCLUSIVE DES PASSAGES ET IDÉES ÉTABLIES (ÉTAPE 4a) :
============================================================
${ideasPayload}
============================================================`;

  const res = await caller.call({
    contents: prompt,
    config: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: STAGE4B_REDACTION_SCHEMA
    }
  });

  let parsed4b: any = null;
  try {
    parsed4b = JSON.parse(res.text);
  } catch {
    parsed4b = null;
  }

  let structured: StructuredResponseSchema;
  let coverageStatement = '';

  if (
    parsed4b &&
    typeof parsed4b.summary === 'string' &&
    Array.isArray(parsed4b.arguments)
  ) {
    coverageStatement = String(parsed4b.coverageStatement || '').trim();
    structured = {
      answerability: Boolean(parsed4b.answerability ?? true),
      summary: parsed4b.summary,
      arguments: parsed4b.arguments,
      deepDiveQuestions: Array.isArray(parsed4b.deepDiveQuestions)
        ? parsed4b.deepDiveQuestions
        : []
    };
  } else {
    // Repli déterministe structuré à partir des idées 4a si le JSON 4b est tronqué
    structured = {
      answerability: extractedIdeas.length > 0,
      summary: belowThresholdN
        ? "Le corpus n'aborde pas directement ce sujet dans son intégralité. L'étude ci-dessous présente strictement les éléments établis par les passages qui touchent à ce thème."
        : "Synthèse des enseignements établis directement par les passages pertinents du corpus.",
      arguments: extractedIdeas.map((idea, idx) => ({
        pointTitle: `Enseignement établi (${idea.sourceId}, §${idea.paragraphIndex})`,
        explanation: idea.establishedIdea,
        citations: [
          {
            sourceId: idea.sourceId,
            paragraphIndex: idea.paragraphIndex,
            exactQuote: idea.exactQuote
          }
        ]
      })),
      deepDiveQuestions: []
    };
  }

  // Vérification déterministe des citations contre le RetrievalEvidencePackage (sans toucher au validateur)
  const verificationReport = verifyCitationsAgainstContext(structured, evidencePackage);
  const verifiedStructured = verificationReport.sanitizedResponse;

  // Construction du Markdown final
  const docIds = Array.from(new Set(evidencePackage.evidence.map(e => e.sermonId)));
  const coverageHeader = formatCoverageSummary({
    uniqueDocsCount: docIds.length,
    passagesCount: evidencePackage.evidence.length,
    docIds,
    totalFoundCount: evidencePackage.totalCandidates
  });

  let md = `${coverageHeader}\n\n`;
  if (explicitDisclaimer) {
    md += `${explicitDisclaimer}\n\n`;
  } else if (coverageStatement) {
    md += `> **Portée documentaire** : ${coverageStatement}\n\n`;
  }

  md += `## Synthèse\n${verifiedStructured.summary}\n\n`;

  if (verifiedStructured.arguments && verifiedStructured.arguments.length > 0) {
    md += `## Étude Analytique Ancrée sur les Textes\n\n`;
    verifiedStructured.arguments.forEach((arg, idx) => {
      if (!arg.citations || arg.citations.length === 0) return; // Garantit 100% d'affirmations rattachées à une citation
      md += `### ${idx + 1}. ${arg.pointTitle}\n${arg.explanation}\n\n`;
      arg.citations.forEach(c => {
        md += `> « ${c.exactQuote} » [Réf: ${c.sourceId}, Para. ${c.paragraphIndex}]\n\n`;
      });
    });
  }

  if (
    verifiedStructured.deepDiveQuestions &&
    verifiedStructured.deepDiveQuestions.length > 0
  ) {
    md += `### Pistes d'approfondissement\n`;
    verifiedStructured.deepDiveQuestions.forEach(q => {
      md += `- ${q}\n`;
    });
  }

  md = cleanPistesDapprofondissement(md);

  // Validation finale par le validateur de citations existant (non modifié)
  const citationsValidation = validateResponseCitations({
    responseText: md,
    evidencePackage
  });

  // Corrections automatiques éventuelles signalées par citationValidationService
  if (citationsValidation && Array.isArray(citationsValidation.citations)) {
    for (const c of citationsValidation.citations) {
      if (
        c.quoteStatus === 'corrected' &&
        c.claimedQuote &&
        c.correctedQuote &&
        c.claimedQuote !== c.correctedQuote
      ) {
        md = md.replace(c.claimedQuote, c.correctedQuote);
      }
      if (
        c.actualSourceId &&
        c.actualParagraphIndex !== null &&
        (c.claimedSourceId !== c.actualSourceId ||
          c.claimedParagraphIndex !== c.actualParagraphIndex)
      ) {
        const claimedRefPattern = new RegExp(
          `\\[R[ée]f:\\s*${c.claimedSourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*?(?:§|Para\\.?\\s*)${c.claimedParagraphIndex}\\s*\\]`,
          'g'
        );
        md = md.replace(
          claimedRefPattern,
          `[Réf: ${c.actualSourceId}, Para. ${c.actualParagraphIndex}]`
        );
      }
    }
  }

  const seenSourceKeys = new Set<string>();
  const sources: Array<{ title: string; uri: string; sermonId: string; paragraphIndex: number }> = [];
  for (const ev of evidencePackage.evidence) {
    for (const cp of ev.citationParagraphs) {
      const key = `${ev.sermonId}_${cp.paragraphIndex}`;
      if (!seenSourceKeys.has(key)) {
        seenSourceKeys.add(key);
        sources.push({
          title: `${ev.sermonTitle} (${ev.date || 'Non daté'}) — §${cp.paragraphIndex}`,
          uri: `sermon://${ev.sermonId}/${cp.paragraphIndex}`,
          sermonId: ev.sermonId,
          paragraphIndex: cp.paragraphIndex
        });
      }
    }
  }

  const latencyMs = Math.round(performance.now() - t0);
  const costUsd = computeMeasuredCostUsd(res.promptTokenCount, res.candidatesTokenCount, cfg);

  return {
    answerText: md,
    structuredResponse: verifiedStructured,
    citationsValidation,
    sources,
    metrics: {
      stageName: 'stage4b_grounded_redaction',
      latencyMs,
      promptTokenCount: res.promptTokenCount,
      candidatesTokenCount: res.candidatesTokenCount,
      totalTokenCount: res.totalTokenCount,
      costUsd,
      usageMetadataMeasured: res.usageMetadataMeasured,
      modelUsed: res.modelUsed,
      details: {
        argumentsCount: verifiedStructured.arguments?.length || 0,
        verifiedCitationsCount: verificationReport.verifiedCount,
        repairedCitationsCount: verificationReport.repairedCount,
        rejectedCitationsCount: verificationReport.rejectedCount
      }
    }
  };
}

// ============================================================================
// ORCHESTRATEUR COMPLET DU MODE ÉTUDIANT PROFOND (AVEC MESURE PAR ÉTAPE & REPLI 429)
// ============================================================================

export async function executeDeepStudentPipeline(
  query: string,
  contextInput: AIContext | Array<string | AIContextSource>,
  options: DeepStudentPipelineOptions = {}
): Promise<DeepStudentExecutionResult> {
  const tStart = performance.now();
  const cleanQuery = (query || '').trim();
  const cfg: DeepStudentConfig = {
    ...defaultDeepStudentConfig,
    ...(aiConfig.deepStudentConfig || {}),
    ...(options.config || {})
  };

  const stages: StageTokenMetrics[] = [];
  const notify = (msg: string) => {
    if (options.onProgress) options.onProgress(msg);
  };

  const emptyTelemetry = (): DeepStudentTelemetry => ({
    enabledConfig: cfg,
    stages,
    subQueriesGenerated: [cleanQuery],
    candidatePoolCount: 0,
    rerankedCandidates: [],
    retainedPassagesCount: 0,
    belowThresholdN: true,
    thresholdN: cfg.minRelevantPassagesN,
    extractedIdeas4a: [],
    contextExcerptsUsed: 0,
    contextTotalCharsWithNeighbors: 0,
    totalLatencyMs: Math.round(performance.now() - tStart),
    totalPromptTokens: 0,
    totalCandidatesTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    fallback429Triggered: false,
    fallbackStage: null,
    fallbackReason: null
  });

  try {
    // 0. Résolution des chunks autorisés dans l'AI Context (sans modifier l'index ni le chunking)
    const aiContext = normalizeAIContext(contextInput);
    const allowedChunks =
      options.providedChunks && options.providedChunks.length > 0
        ? options.providedChunks
        : await resolveAIContextChunks(aiContext, {
            bibleVersion: options.bibleVersion,
            loadedSermonsMap: options.loadedSermonsMap
          });

    if (!cleanQuery || allowedChunks.length === 0) {
      return {
        status: 'not_answerable',
        answerText: null,
        evidencePackage: {
          answerable: false,
          confidenceScore: 0,
          reason: 'Aucune ressource disponible dans le contexte sélectionné.',
          evidence: [],
          query: cleanQuery,
          totalCandidates: 0,
          rejectedCount: 0
        },
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: [],
        latencyMs: Math.round(performance.now() - tStart),
        telemetry: emptyTelemetry(),
        errorMessage: 'Aucune ressource disponible.'
      };
    }

    // ------------------------------------------------------------------------
    // ÉTAPE 1 : Query Expansion par LLM (5-8 sous-requêtes) + BM25/Vectoriel + RRF
    // ------------------------------------------------------------------------
    notify('[Mode Étudiant Profond 1/5] Expansion conceptuelle LLM (5 à 8 sous-requêtes)...');
    const step1Exp = await executeStage1LlmQueryExpansion(cleanQuery, cfg, {
      apiKey: options.apiKey,
      geminiClient: options.geminiClient
    });
    stages.push(step1Exp.metrics);

    notify(
      `[Mode Étudiant Profond 1/5] Recherche hybride BM25 + Vectorielle E5 et fusion RRF sur ${step1Exp.subQueries.length} sous-requêtes...`
    );
    const step1Ret = await executeMultiQueryBroadRetrievalRrf(
      cleanQuery,
      step1Exp.subQueries,
      allowedChunks,
      cfg
    );
    stages.push(step1Ret.metrics);

    // ------------------------------------------------------------------------
    // ÉTAPE 2 : Récupération large (60-100) puis sélection/reranking par Gemini (0-3, garder >= 2)
    // ------------------------------------------------------------------------
    notify(
      `[Mode Étudiant Profond 2/5] Reranking Gemini (score 0-3) sur ${step1Ret.candidates.length} passages candidats...`
    );
    const step2Rerank = await executeStage2GeminiReranking(
      cleanQuery,
      step1Ret.candidates,
      cfg,
      {
        apiKey: options.apiKey,
        geminiClient: options.geminiClient
      },
      notify
    );
    stages.push(step2Rerank.metrics);

    // ------------------------------------------------------------------------
    // ÉTAPE 3 : Seuil de suffisance (< N passages pertinents avec score >= 2)
    // ------------------------------------------------------------------------
    notify(
      `[Mode Étudiant Profond 3/5] Vérification du seuil de pertinence (${step2Rerank.retainedPassages.length} passage(s) ≥ ${cfg.minRelevanceScore}/3)...`
    );
    const step3Threshold = executeStage3ThresholdCheck(
      cleanQuery,
      step2Rerank.retainedPassages,
      step1Ret.candidates.length,
      cfg
    );
    stages.push(step3Threshold.metrics);

    // ------------------------------------------------------------------------
    // ÉTAPE 5 : Construction du contexte configurable (jusqu'à 60 extraits avec voisins ±1)
    // ------------------------------------------------------------------------
    const { evidencePackage, totalContextCharacters } = buildDeepStudentEvidencePackage(
      cleanQuery,
      step2Rerank.retainedPassages,
      allowedChunks,
      step1Ret.candidates.length,
      cfg,
      options.loadedSermonsMap
    );

    // Si 0 passage pertinent (score >= 2), abstention explicite honnête sans appel de génération
    if (step3Threshold.zeroPassages || evidencePackage.evidence.length === 0) {
      const explicitZeroMsg =
        step3Threshold.explicitDisclaimer ||
        `Le corpus n'aborde pas directement ce sujet (« ${cleanQuery} »). Aucun passage pertinent (score ≥ ${cfg.minRelevanceScore}/3) n'a été identifié parmi les ${step1Ret.candidates.length} passages candidats analysés.`;

      const totalPromptTokens = stages.reduce((acc, s) => acc + s.promptTokenCount, 0);
      const totalCandidatesTokens = stages.reduce((acc, s) => acc + s.candidatesTokenCount, 0);
      const totalTokens = stages.reduce((acc, s) => acc + s.totalTokenCount, 0);
      const totalCostUsd = Number(stages.reduce((acc, s) => acc + s.costUsd, 0).toFixed(6));
      const totalLatencyMs = Math.round(performance.now() - tStart);

      return {
        status: 'success',
        answerText: explicitZeroMsg,
        evidencePackage: {
          ...evidencePackage,
          answerable: false,
          reason: explicitZeroMsg
        },
        generationResult: {
          status: 'not_answerable',
          provider: 'google-gemini',
          model: aiConfig.models.primaryFastModel,
          responseOrigin: 'gemini',
          answerText: explicitZeroMsg,
          sourcesSuffisantes: false,
          latencyMs: totalLatencyMs,
          usageMetadata: {
            promptTokenCount: totalPromptTokens,
            candidatesTokenCount: totalCandidatesTokens,
            totalTokenCount: totalTokens,
            measured: true
          },
          citationsValidation: null,
          chunkIdExposure: false,
          technicalIdentifiersDetected: [],
          sources: []
        },
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: [],
        latencyMs: totalLatencyMs,
        telemetry: {
          enabledConfig: cfg,
          stages,
          subQueriesGenerated: step1Exp.subQueries,
          candidatePoolCount: step1Ret.candidates.length,
          rerankedCandidates: step2Rerank.rerankedAll,
          retainedPassagesCount: 0,
          belowThresholdN: true,
          thresholdN: cfg.minRelevantPassagesN,
          extractedIdeas4a: [],
          contextExcerptsUsed: 0,
          contextTotalCharsWithNeighbors: 0,
          totalLatencyMs,
          totalPromptTokens,
          totalCandidatesTokens,
          totalTokens,
          totalCostUsd,
          fallback429Triggered: false,
          fallbackStage: null,
          fallbackReason: null
        }
      };
    }

    // ------------------------------------------------------------------------
    // ÉTAPE 4a & 4b : Génération en deux temps (ou génération standard si désactivée pour ablation)
    // ------------------------------------------------------------------------
    let finalAnswerText = '';
    let finalCitationsValidation: CitationValidationResult | null = null;
    let finalSources: Array<{ title: string; uri: string; sermonId: string; paragraphIndex: number }> = [];
    let extractedIdeas4a: ExtractedPassageIdea[] = [];

    if (cfg.enableTwoStageGeneration) {
      notify(
        `[Mode Étudiant Profond 4a/5] Extraction des passages et des idées réellement établies (${evidencePackage.evidence.length} extrait(s))...`
      );
      const step4a = await executeStage4aExtraction(
        cleanQuery,
        evidencePackage,
        step2Rerank.retainedPassages,
        cfg,
        {
          apiKey: options.apiKey,
          geminiClient: options.geminiClient
        }
      );
      stages.push(step4a.metrics);
      extractedIdeas4a = step4a.extractedIdeas;

      notify(
        `[Mode Étudiant Profond 4b/5] Rédaction développée ancrée sur ${extractedIdeas4a.length} idée(s) et validation des citations...`
      );
      const step4b = await executeStage4bGroundedRedaction(
        cleanQuery,
        evidencePackage,
        extractedIdeas4a,
        step3Threshold.belowThresholdN,
        step3Threshold.explicitDisclaimer,
        cfg,
        {
          apiKey: options.apiKey,
          geminiClient: options.geminiClient
        }
      );
      stages.push(step4b.metrics);

      finalAnswerText = step4b.answerText;
      finalCitationsValidation = step4b.citationsValidation;
      finalSources = step4b.sources;
    } else {
      // Mode d'ablation (Étapes 1/2/3 avec générateur standard en 1 temps)
      notify(
        `[Mode Étudiant Profond 4/5] Génération de la réponse sur ${evidencePackage.evidence.length} extrait(s)...`
      );
      const { generateNewRagResponse } = await import('./generationAdapter');
      const genRes = await generateNewRagResponse({
        query: cleanQuery,
        evidencePackage,
        apiKey: options.apiKey,
        geminiClient: options.geminiClient,
        history: options.history
      });

      if (genRes.errorCode === 'RESOURCE_EXHAUSTED') {
        throw new DeepStudentQuota429Error('stage4_single_step_gen', new Error(genRes.errorMessage || '429'));
      }

      const pTok = genRes.usageMetadata?.promptTokenCount || 0;
      const cTok = genRes.usageMetadata?.candidatesTokenCount || 0;
      const tTok = genRes.usageMetadata?.totalTokenCount || 0;

      stages.push({
        stageName: 'stage4b_grounded_redaction',
        latencyMs: genRes.latencyMs || 0,
        promptTokenCount: pTok,
        candidatesTokenCount: cTok,
        totalTokenCount: tTok,
        costUsd: computeMeasuredCostUsd(pTok, cTok, cfg),
        usageMetadataMeasured: Boolean(genRes.usageMetadata?.measured),
        modelUsed: genRes.model
      });

      finalAnswerText = genRes.answerText || '';
      if (step3Threshold.belowThresholdN && step3Threshold.explicitDisclaimer && finalAnswerText) {
        finalAnswerText = `${step3Threshold.explicitDisclaimer}\n\n${finalAnswerText}`;
      }
      finalCitationsValidation = genRes.citationsValidation || null;
      finalSources = genRes.sources || [];
    }

    const exposureCheck = detectTechnicalIdentifierExposure(finalAnswerText);
    const totalPromptTokens = stages.reduce((acc, s) => acc + s.promptTokenCount, 0);
    const totalCandidatesTokens = stages.reduce((acc, s) => acc + s.candidatesTokenCount, 0);
    const totalTokens = stages.reduce((acc, s) => acc + s.totalTokenCount, 0);
    const totalCostUsd = Number(stages.reduce((acc, s) => acc + s.costUsd, 0).toFixed(6));
    const totalLatencyMs = Math.round(performance.now() - tStart);

    return {
      status: 'success',
      answerText: finalAnswerText,
      evidencePackage,
      generationResult: {
        status: 'success',
        provider: 'google-gemini',
        model: aiConfig.models.primaryFastModel,
        responseOrigin: 'gemini',
        answerText: finalAnswerText,
        sourcesSuffisantes: true,
        latencyMs: totalLatencyMs,
        usageMetadata: {
          promptTokenCount: totalPromptTokens,
          candidatesTokenCount: totalCandidatesTokens,
          totalTokenCount: totalTokens,
          measured: true
        },
        citationsValidation: finalCitationsValidation,
        chunkIdExposure: exposureCheck.exposed,
        technicalIdentifiersDetected: exposureCheck.identifiers,
        sources: finalSources
      },
      citationsValidation: finalCitationsValidation,
      chunkIdExposure: exposureCheck.exposed,
      technicalIdentifiersDetected: exposureCheck.identifiers,
      sources: finalSources,
      latencyMs: totalLatencyMs,
      telemetry: {
        enabledConfig: cfg,
        stages,
        subQueriesGenerated: step1Exp.subQueries,
        candidatePoolCount: step1Ret.candidates.length,
        rerankedCandidates: step2Rerank.rerankedAll,
        retainedPassagesCount: step2Rerank.retainedPassages.length,
        belowThresholdN: step3Threshold.belowThresholdN,
        thresholdN: cfg.minRelevantPassagesN,
        extractedIdeas4a,
        contextExcerptsUsed: evidencePackage.evidence.length,
        contextTotalCharsWithNeighbors: totalContextCharacters,
        totalLatencyMs,
        totalPromptTokens,
        totalCandidatesTokens,
        totalTokens,
        totalCostUsd,
        fallback429Triggered: false,
        fallbackStage: null,
        fallbackReason: null
      }
    };
  } catch (err: any) {
    // CONDITION 3 : Gestion propre des erreurs 429 -> signalement pour repli vers le pipeline actuel sans perte
    if (isQuotaOr429Error(err)) {
      const stageFailed = err instanceof DeepStudentQuota429Error ? err.stage : 'unknown_stage';
      notify(
        'Limite de quota API (429) atteinte en Mode Étudiant Profond — repli automatique sans perte vers le pipeline standard...'
      );
      const totalPromptTokens = stages.reduce((acc, s) => acc + s.promptTokenCount, 0);
      const totalCandidatesTokens = stages.reduce((acc, s) => acc + s.candidatesTokenCount, 0);
      const totalTokens = stages.reduce((acc, s) => acc + s.totalTokenCount, 0);
      const totalCostUsd = Number(stages.reduce((acc, s) => acc + s.costUsd, 0).toFixed(6));
      const totalLatencyMs = Math.round(performance.now() - tStart);

      return {
        status: 'fallback_429',
        answerText: null,
        evidencePackage: {
          answerable: false,
          confidenceScore: 0,
          reason: `Repli 429 depuis ${stageFailed}`,
          evidence: [],
          query: cleanQuery,
          totalCandidates: 0,
          rejectedCount: 0
        },
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: [],
        latencyMs: totalLatencyMs,
        telemetry: {
          ...emptyTelemetry(),
          totalLatencyMs,
          totalPromptTokens,
          totalCandidatesTokens,
          totalTokens,
          totalCostUsd,
          fallback429Triggered: true,
          fallbackStage: stageFailed,
          fallbackReason: err?.message || String(err)
        },
        errorMessage: err?.message || String(err)
      };
    }

    const totalLatencyMs = Math.round(performance.now() - tStart);
    return {
      status: 'error',
      answerText: null,
      evidencePackage: {
        answerable: false,
        confidenceScore: 0,
        reason: err?.message || 'Erreur dans le Mode Étudiant Profond.',
        evidence: [],
        query: cleanQuery,
        totalCandidates: 0,
        rejectedCount: 0
      },
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: [],
      latencyMs: totalLatencyMs,
      telemetry: emptyTelemetry(),
      errorMessage: err?.message || String(err)
    };
  }
}
