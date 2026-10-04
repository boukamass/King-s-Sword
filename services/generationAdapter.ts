/**
 * King's Sword — Generation Adapter (Phase 2F.10)
 * 
 * Isole et durcit l'intégration de génération pour le New RAG.
 * 
 * RÈGLES FONDAMENTALES NON NÉGOCIABLES :
 * 1. Gemini SUCCESS → answerText = réponse Gemini, provider = 'google-gemini', responseOrigin = 'gemini'
 * 2. Gemini ERROR   → answerText = null, provider = 'none', responseOrigin = 'none'
 * 3. AUCUN fallback local, Ollama, Ground Truth, cache, réponse synthétique ou construite à partir de l'Evidence.
 * 4. answerable === false → status = 'not_answerable', Gemini n'est pas interrogé avec de fausses preuves.
 * 5. Toute réponse Gemini est validée par citationValidationService.
 * 6. Détection stricte des expositions techniques de Chunk ID.
 */

import { RetrievalEvidencePackage, CitationValidationResult } from '../types';
import { formatEvidenceContextForGemini } from './autoRagRetrievalService';
import { validateResponseCitations } from './citationValidationService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { GoogleGenAI } from '@google/genai';

export interface GeminiCaller {
  generateContent(params: {
    model: string;
    contents: any;
    config: any;
  }): Promise<{ text?: string | null; candidates?: any[]; usageMetadata?: any }>;
}

export interface GenerationResult {
  status: 'success' | 'error' | 'not_answerable';
  provider: 'google-gemini' | 'none';
  model: string | null;
  responseOrigin: 'gemini' | 'none';
  answerText: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  citationsValidation?: CitationValidationResult | null;
  chunkIdExposure?: boolean;
  technicalIdentifiersDetected?: string[];
  sources?: Array<{
    title: string;
    uri: string;
    sermonId: string;
    paragraphIndex: number;
  }>;
}

export interface GenerateNewRagOptions {
  query: string;
  evidencePackage: RetrievalEvidencePackage;
  apiKey?: string;
  geminiClient?: GeminiCaller;
  systemInstruction?: string;
  temperature?: number;
  model?: string;
}

// Détecteur strict des formats de Chunk ID réels du projet
const STRICT_CHUNK_ID_REGEX = /(?:chunk_[a-zA-Z0-9_\-]+|[a-zA-Z0-9_\-]+_c\d+_p[a-zA-Z0-9_\-]+)/gi;

export function detectTechnicalIdentifierExposure(text: string): {
  exposed: boolean;
  identifiers: string[];
} {
  if (!text || typeof text !== 'string') return { exposed: false, identifiers: [] };
  const matches = text.match(STRICT_CHUNK_ID_REGEX) || [];
  const excluded = new Set([
    'chunkIdExposure', 'chunkId', 'chunkIdExposureLegacy', 'chunkIdExposureNewRag', 
    'type.googleapis.com', 'RESOURCE_EXHAUSTED'
  ]);
  const trueChunkIds = Array.from(new Set(matches)).filter(id => !excluded.has(id));
  return {
    exposed: trueChunkIds.length > 0,
    identifiers: trueChunkIds
  };
}

/**
 * Exécute la génération New RAG en respectant strictement l'inviolabilité du contrat de génération.
 */
export async function generateNewRagResponse(
  options: GenerateNewRagOptions
): Promise<GenerationResult> {
  const {
    query,
    evidencePackage,
    apiKey,
    geminiClient,
    systemInstruction,
    temperature = 0.2,
    model = 'gemini-3.8-flash'
  } = options;

  // RÈGLE 8 : Cas answerable === false
  if (!evidencePackage || !evidencePackage.answerable || !evidencePackage.evidence || evidencePackage.evidence.length === 0) {
    return {
      status: 'not_answerable',
      provider: 'none',
      model: null,
      responseOrigin: 'none',
      answerText: null,
      errorCode: 'NOT_ANSWERABLE',
      errorMessage: evidencePackage?.reason || "Les documents disponibles ne contiennent pas d'informations suffisantes pour répondre à cette question.",
      latencyMs: 0,
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: []
    };
  }

  // Formatage déterministe du contexte documentaire
  const context = formatEvidenceContextForGemini(evidencePackage, query);
  const promptContents = `${context}\n\n============================================================\nQUESTION DU CHERCHEUR :\n"${query}"`;

  // Résolution du client Gemini
  let client = geminiClient;
  if (!client) {
    const key = apiKey || getGeminiApiKey();
    if (!key) {
      return {
        status: 'error',
        provider: 'none',
        model: null,
        responseOrigin: 'none',
        answerText: null,
        errorCode: 'API_KEY_MISSING',
        errorMessage: 'Clé API Gemini introuvable.',
        latencyMs: 0,
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: []
      };
    }
    const googleAi = new GoogleGenAI({ apiKey: key });
    client = {
      generateContent: (p) => googleAi.models.generateContent(p)
    };
  }

  const sysInstruction = systemInstruction || `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham.

DIRECTIVES STRICTES DE RÉPONSE FONDÉE EXCLUSIVEMENT SUR LES SOURCES FOURNIES DANS L'APPLICATION :
1. Réponds à la question posée en te basant EXCLUSIVEMENT sur les extraits de sermons et documents fournis ci-dessous.
2. N'extrapole pas, n'utilise AUCUNE source web externe, et n'invente aucune doctrine ou interprétation qui ne figure pas expressément dans ces extraits.
3. Pour chaque affirmation ou citation tirée d'un extrait, insère obligatoirement la référence exacte au format :
   > « ... » [Réf: ID_SERMON, Para. N]
   (Exemple : > « Le premier sceau a été ouvert... » [Réf: 63-0324M, Para. 2])
4. N'invente JAMAIS d'identifiant de sermon ni de numéro de paragraphe. Utilise UNIQUEMENT les références fournies dans le texte source.
5. Si les extraits fournis ne contiennent pas d'éléments suffisants pour répondre à la question, explique clairement et poliment à l'utilisateur que les documents sélectionnés ne contiennent pas la réponse. Résume brièvement en 1 ou 2 phrases ce que traitent les extraits consultés (par exemple : « Les extraits consultés parlent de Smyrne et de Sardes, mais ne mentionnent pas... ») pour l'aider à réorienter sa sélection dans le Dock IA, tout en refusant fermement d'inventer toute information hors de ces extraits.
6. Regroupe toujours en fin de réponse une section "### Sources consultées" listant clairement les sermons et paragraphes cités.`;

  const t0 = Date.now();

  try {
    const response = await client.generateContent({
      model,
      contents: promptContents,
      config: {
        systemInstruction: sysInstruction,
        temperature
      }
    });

    const latencyMs = Date.now() - t0;
    const responseText = response?.text;

    // RÈGLE 14 : Réponse vide de Gemini
    if (!responseText || typeof responseText !== 'string' || responseText.trim().length === 0) {
      return {
        status: 'error',
        provider: 'none',
        model: null,
        responseOrigin: 'none',
        answerText: null,
        errorCode: 'EMPTY_RESPONSE',
        errorMessage: 'Gemini a retourné une réponse vide.',
        latencyMs,
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: []
      };
    }

    // RÈGLE 12 : Détection stricte d'exposition de Chunk ID
    const exposureCheck = detectTechnicalIdentifierExposure(responseText);

    // RÈGLE 9, 10, 11 : Validation des citations
    const citationsValidation = validateResponseCitations({
      responseText,
      evidencePackage
    });

    // Extraction des sources valides
    const sources = evidencePackage.evidence.flatMap(ev => 
      ev.citationParagraphs.map(cp => ({
        title: `${ev.sermonTitle} (${ev.date || 'Non daté'}) — §${cp.paragraphIndex}`,
        uri: `sermon://${ev.sermonId}/${cp.paragraphIndex}`,
        sermonId: ev.sermonId,
        paragraphIndex: cp.paragraphIndex
      }))
    );

    // RÈGLE ABSOLUE : Gemini success
    return {
      status: 'success',
      provider: 'google-gemini',
      model,
      responseOrigin: 'gemini',
      answerText: responseText,
      latencyMs,
      errorCode: null,
      errorMessage: null,
      citationsValidation,
      chunkIdExposure: exposureCheck.exposed,
      technicalIdentifiersDetected: exposureCheck.identifiers,
      sources
    };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    const errorMsg = err?.message || String(err);
    const normErr = errorMsg.toLowerCase();

    let errorCode = 'API_ERROR';
    if (normErr.includes('429') || normErr.includes('resource_exhausted') || normErr.includes('quota')) {
      errorCode = 'RESOURCE_EXHAUSTED';
    } else if (normErr.includes('503') || normErr.includes('unavailable') || normErr.includes('high demand')) {
      errorCode = 'SERVICE_UNAVAILABLE';
    }

    // RÈGLE ABSOLUE : Gemini error → answerText = null, JAMAIS de fallback local
    return {
      status: 'error',
      provider: 'none',
      model: null,
      responseOrigin: 'none',
      answerText: null,
      errorCode,
      errorMessage: errorMsg,
      latencyMs,
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: []
    };
  }
}
