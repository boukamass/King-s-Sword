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
import { extractRequestedLineCount } from './queryIntentService';
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
  onStreamChunk?: (token: string) => void;
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
  const reqLines = extractRequestedLineCount(query);
  const lineInstruction = reqLines ? `\n\nCONSIGNE STRICTE DE LONGUEUR : L'utilisateur exige un résumé / résultat de sa demande en exactement ${reqLines} lignes. Rédige ta réponse de façon concise et synthétique en respectant rigoureusement la limite de ${reqLines} lignes.` : '';
  const promptContents = `${context}\n\n============================================================\nQUESTION DU CHERCHEUR :\n"${query}"${lineInstruction}`;

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

  const sysInstruction = systemInstruction || `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham et des Écritures.

DIRECTIVES D'EXCELLENCE POUR UNE ÉTUDE SIMPLE COMME APPROFONDIE :
1. PROFONDEUR, ÉLABORATION ET DÉVELOPPEMENT : Fournis une réponse complète, soignée, pédagogique, bien détaillée et largement développée, adaptée aussi bien à une première lecture simple qu'à une recherche théologique approfondie. Structure ta réponse avec des titres de sections explicites (Markdown ###), des sous-points analytiques et une conclusion doctrinale solide.
2. CONTINUITÉ CHRONOLOGIQUE ET DOCTRINALE : Si les extraits couvrent plusieurs sermons ou dates différentes, mets en lumière la progression prophétique et chronologique de l'enseignement au fil des années (ex: dans les années 1950, lors de l'ouverture des Sceaux en 1963, puis dans l'Exposé).
3. FIDÉLITÉ ABSOLUE AUX EXTRAITS : Fonde ton exposé EXCLUSIVEMENT sur les extraits documentaires fournis ci-dessous. N'extrapole pas, n'utilise aucune source web externe, et n'invente aucune doctrine ou interprétation qui ne figure pas expressément dans ces extraits.
4. CITATIONS TEXTUELLES EXACTES : Appuie chaque affirmation, explication ou principe doctrinal sur des citations directes entre guillemets, immédiatement suivies de leur référence au format :
   > « ... » [Réf: ID_SERMON, Para. N]
   (Exemple : > « ... » [Réf: expose-ch-4, §151] ou [Réf: 63-0324M, Para. 2])
5. INTÉGRITÉ DES IDENTIFIANTS : N'invente JAMAIS d'identifiant ni de numéro de paragraphe. Utilise UNIQUEMENT les références exactes mentionnées dans les extraits.
6. CAS D'INSUFFISANCE : Si les extraits fournis ne contiennent pas d'éléments suffisants pour répondre à la question, explique clairement et poliment à l'utilisateur ce que traitent les extraits consultés pour l'aider à réorienter sa sélection, sans rien inventer.
7. SOURCES CONSULTÉES : Termine toujours par une section "### Sources consultées" listant clairement tous les documents et paragraphes cités.
8. PISTES D'APPROFONDISSEMENT : Après les sources, suggère systématiquement une courte section "### Pistes d'approfondissement" proposant 2 à 3 questions de recherche complémentaires pertinentes pour poursuivre l'étude.`;

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
