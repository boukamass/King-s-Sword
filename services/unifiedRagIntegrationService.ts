/**
 * King's Sword — Unified RAG Integration Service (Phase 2F.12D)
 * 
 * Adaptateur d'intégration branchant le Unified RAG dans le flux réel de l'Assistant IA :
 * 
 * FLUX D'EXÉCUTION UNIFIÉ :
 * Utilisateur sélectionne ses sources
 *           ↓
 *       AI Context (source unique de vérité)
 *           ↓
 *      Unified RAG (BM25 + Vectoriel + RRF + Reranking + Answerability)
 *           ↓
 *   RetrievalEvidencePackage
 *           ↓
 *   Generation Adapter
 *           ↓
 *        Gemini
 *           ↓
 *  Citation Validation
 *           ↓
 *        Réponse
 * 
 * RÈGLES FONDAMENTALES :
 * 1. AI Context strict : Seules les sources explicitement présentes dans le contexte sont transmises.
 * 2. Non-answerable strict : Si answerable === false, Gemini N'EST JAMAIS APPELÉ.
 * 3. 0 Fallback : Pas de réponse synthétique locale, ni Ollama, ni Ground Truth fallback.
 * 4. 0 fuite de Chunk ID : Validé avant et après génération.
 * 5. Mode Shadow : Permet l'évaluation comparative non-autoritaire en parallèle du Legacy.
 */

import {
  AIContext,
  AIContextSource,
  RetrievalEvidencePackage,
  CitationValidationResult,
  ChatMessage
} from '../types';
import { BibleVersion } from '../types/bible';
import { executeUnifiedRagPipeline, UnifiedRagOptions } from './unifiedRagService';
import { generateNewRagResponse, GeminiCaller, GenerationResult } from './generationAdapter';
import { validateResponseCitations } from './citationValidationService';
import { detectTechnicalIdentifierExposure } from './generationAdapter';
import { getCachedRagResponse, setCachedRagResponse } from './semanticCacheService';
import { 
  isDeepDiveStudyRequest, 
  detectExhaustiveStudyIntent,
  isAllPassagesRequest, 
  getDeepDiveSystemInstruction, 
  formatCoverageSummary, 
  cleanPistesDapprofondissement 
} from './theologicalExegesisService';
import { extractSubstantiveQueryTerms } from './rerankingService';
import { aiConfig } from '../config/aiConfig';

export interface UnifiedRagIntegrationOptions extends UnifiedRagOptions {
  apiKey?: string;
  geminiClient?: GeminiCaller;
  systemInstruction?: string;
  temperature?: number;
  model?: string;
  bibleVersion?: BibleVersion;
  forceGenerate?: boolean;
  history?: ChatMessage[];
}

export interface UnifiedRagExecutionResult {
  status: 'success' | 'not_answerable' | 'error';
  answerText: string | null;
  evidencePackage: RetrievalEvidencePackage;
  generationResult?: GenerationResult;
  citationsValidation?: CitationValidationResult | null;
  chunkIdExposure: boolean;
  technicalIdentifiersDetected: string[];
  sources?: Array<{
    title: string;
    uri: string;
    sermonId: string;
    paragraphIndex: number;
  }>;
  latencyMs: number;
  errorMessage?: string | null;
  vectorMethod?: string;
}

export interface ShadowComparisonResult {
  query: string;
  aiContext: string[];
  unifiedResult: UnifiedRagExecutionResult;
  legacyRun: boolean;
  timestamp: string;
}

/**
 * Exécute le pipeline complet Unified RAG -> Evidence -> Generation Adapter -> Gemini -> Validation
 * sous la contrainte absolue de l'AI Context.
 */
export async function executeUnifiedRagAssistantFlow(
  query: string,
  aiContext: AIContext | Array<string | AIContextSource>,
  options: UnifiedRagIntegrationOptions = {}
): Promise<UnifiedRagExecutionResult> {
  const t0 = Date.now();
  const cleanQuery = (query || '').trim();

  // Extraction des IDs de contexte pour la clé de cache
  const contextIds = Array.isArray(aiContext) 
    ? aiContext.map(s => typeof s === 'string' ? s : s.sourceId)
    : (aiContext.sources || []).map(s => s.sourceId);

  // 0. Vérification du Cache Sémantique Local (0 ms)
  const cached = await getCachedRagResponse(cleanQuery, contextIds);
  if (cached && cached.answerText) {
    return {
      status: 'success',
      answerText: cached.answerText,
      evidencePackage: {
        answerable: true,
        confidenceScore: 1.0,
        reason: 'Réponse issue du cache sémantique local instantané (0 ms).',
        evidence: [],
        query: cleanQuery,
        totalCandidates: cached.evidenceCount || 1,
        rejectedCount: 0,
        vectorMethod: 'semantic_cache_hit'
      },
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: cached.sources,
      latencyMs: 0,
      vectorMethod: 'semantic_cache_hit'
    };
  }

  // 1. Exécution du Retrieval Unified RAG sous contrainte stricte de l'AI Context
  // Enrichissement contextuel de la requête pour les questions de relance / multi-tours
  let retrievalQuery = cleanQuery;
  if (Array.isArray(options.history) && options.history.length > 0) {
    const isFollowUp = /\b(pourquoi|comment|qui|que|quoi|et pour|ce que tu viens|ce point|cette phrase|cette citation|ce sujet|approfondis|developpe|explique|plus de citations|ensuite|autre|deuxieme|troisieme|quatrieme|precedent|suivant)\b/i.test(cleanQuery) || cleanQuery.split(/\s+/).length <= 4;
    if (isFollowUp) {
      const lastUserMsg = [...options.history].reverse().find(m => m.role === 'user' && m.content !== cleanQuery);
      const lastAssistantMsg = [...options.history].reverse().find(m => m.role === 'assistant' && m.content && !m.content.startsWith('**Erreur') && !m.content.toLowerCase().startsWith('erreur'));
      
      const prevKeywords: string[] = [];
      if (lastUserMsg && lastUserMsg.content) {
        prevKeywords.push(...extractSubstantiveQueryTerms(lastUserMsg.content).slice(0, 3));
      }
      if (lastAssistantMsg && lastAssistantMsg.content) {
        prevKeywords.push(...extractSubstantiveQueryTerms(lastAssistantMsg.content).slice(0, 3));
      }
      const uniqueKeywords = Array.from(new Set(prevKeywords));
      if (uniqueKeywords.length > 0) {
        retrievalQuery = `${cleanQuery} ${uniqueKeywords.join(' ')}`;
      }
    }
  }

  const isStudy = await detectExhaustiveStudyIntent(cleanQuery, {
    apiKey: options.apiKey,
    geminiClient: options.geminiClient
  });
  const isAllPassages = isAllPassagesRequest(cleanQuery);
  const effectiveTopK = isAllPassages ? Math.max(options.topK || 25, 50) : (isStudy ? Math.max(options.topK || 20, 35) : Math.max(options.topK || 20, 25));
  const effectiveMaxEvidence = isAllPassages ? Math.max(options.maxEvidenceCount || 16, 25) : (isStudy ? Math.max(options.maxEvidenceCount || 16, 20) : Math.max(options.maxEvidenceCount || 12, 16));

  const evidencePackage = await executeUnifiedRagPipeline(retrievalQuery, aiContext, {
    topK: effectiveTopK,
    maxEvidenceCount: effectiveMaxEvidence,
    k: options.k,
    vectorWeight: options.vectorWeight,
    lexicalWeight: options.lexicalWeight,
    rrfWeight: options.rrfWeight,
    multiModalBonus: options.multiModalBonus,
    bibleVersion: options.bibleVersion,
    mockVectorHits: options.mockVectorHits,
    loadedSermonsMap: options.loadedSermonsMap,
    apiKey: options.apiKey,
    queryVector: (options as any).queryVector
  });

  if (options.forceGenerate && !evidencePackage.answerable && evidencePackage.evidence && evidencePackage.evidence.length > 0) {
    evidencePackage.answerable = true;
    evidencePackage.reason = "Génération forcée à la demande de l'utilisateur.";
  }

  // 2. Traitement d'abstention stricte (answerable === false ou 0 preuve)
  if (!evidencePackage.answerable || !evidencePackage.evidence || evidencePackage.evidence.length === 0) {
    const latencyMs = Date.now() - t0;
    return {
      status: 'not_answerable',
      answerText: null,
      evidencePackage,
      generationResult: {
        status: 'not_answerable',
        provider: 'none',
        model: null,
        responseOrigin: 'none',
        answerText: null,
        errorCode: 'NOT_ANSWERABLE',
        errorMessage: evidencePackage.reason || "Les ressources sélectionnées dans l'AI Context ne contiennent pas d'informations suffisantes pour répondre à cette question.",
        latencyMs,
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: []
      },
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: [],
      latencyMs,
      errorMessage: evidencePackage.reason || "Non answerable dans le contexte sélectionné.",
      vectorMethod: evidencePackage.vectorMethod
    };
  }

  // 3. Appel au Generation Adapter avec les preuves authentifiées
  let activeInstruction = options.systemInstruction;
  if (isDeepDiveStudyRequest(cleanQuery)) {
    activeInstruction = (activeInstruction || '') + getDeepDiveSystemInstruction();
  }

  const genResult = await generateNewRagResponse({
    query: cleanQuery,
    evidencePackage,
    apiKey: options.apiKey,
    geminiClient: options.geminiClient,
    systemInstruction: activeInstruction,
    temperature: options.temperature ?? aiConfig.models.autoRagTemperature,
    model: options.model ?? aiConfig.models.primaryFastModel,
    history: options.history
  });

  const latencyMs = Date.now() - t0;

  // 4. Si la génération a échoué
  if (genResult.status !== 'success' || !genResult.answerText) {
    return {
      status: genResult.status === 'not_answerable' ? 'not_answerable' : 'error',
      answerText: null,
      evidencePackage,
      generationResult: genResult,
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: [],
      latencyMs,
      errorMessage: genResult.errorMessage || 'Erreur lors de la génération de la réponse.',
      vectorMethod: evidencePackage.vectorMethod
    };
  }

  // Enregistrement en cache sémantique local
  setCachedRagResponse(
    cleanQuery,
    contextIds,
    genResult.answerText,
    genResult.sources,
    evidencePackage.evidence.length
  ).catch(() => {});

  // 5. Validation des citations et contrôle d'exposition d'identifiants techniques
  const isRefusal = genResult.sourcesSuffisantes === false;
  const exposureCheck = isRefusal 
    ? { exposed: false, identifiers: [] } 
    : detectTechnicalIdentifierExposure(genResult.answerText);
    
  const citationsValidation = isRefusal 
    ? null 
    : validateResponseCitations({
        responseText: genResult.answerText,
        evidencePackage
      });

  let finalAnswerText = isRefusal 
    ? genResult.answerText 
    : cleanPistesDapprofondissement(genResult.answerText);

  if (!isRefusal && (isStudy || isAllPassages) && evidencePackage.evidence.length > 0) {
    const docIds = Array.from(new Set(evidencePackage.evidence.map(e => e.sermonId)));
    const uniqueDocsCount = docIds.length;
    const passagesCount = evidencePackage.evidence.length;
    const totalFound = evidencePackage.totalCandidates;
    const coverageHeader = `${formatCoverageSummary({
      uniqueDocsCount,
      passagesCount,
      docIds,
      totalFoundCount: totalFound
    })}\n\n`;
    if (!finalAnswerText.includes('Couverture documentaire')) {
      finalAnswerText = coverageHeader + finalAnswerText;
    }
  }

  return {
    status: 'success',
    answerText: finalAnswerText,
    evidencePackage,
    generationResult: genResult,
    citationsValidation,
    chunkIdExposure: exposureCheck.exposed,
    technicalIdentifiersDetected: exposureCheck.identifiers,
    sources: isRefusal ? [] : (genResult.sources || []),
    latencyMs,
    errorMessage: null,
    vectorMethod: evidencePackage.vectorMethod
  };
}

/**
 * Exécute une passe Shadow non-bloquante du Unified RAG pour comparaison
 * sans altérer la réponse retournée à l'utilisateur.
 */
export async function executeShadowUnifiedRag(
  query: string,
  aiContext: string[],
  options: UnifiedRagIntegrationOptions = {}
): Promise<ShadowComparisonResult | null> {
  try {
    const unifiedResult = await executeUnifiedRagAssistantFlow(query, aiContext, options);
    return {
      query,
      aiContext,
      unifiedResult,
      legacyRun: true,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.warn('[UnifiedRagShadow] Erreur silencieuse en mode shadow:', err);
    return null;
  }
}
