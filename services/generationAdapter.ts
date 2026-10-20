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

import { RetrievalEvidencePackage, CitationValidationResult, ChatMessage } from '../types';
import { formatEvidenceContextForGemini } from './autoRagRetrievalService';
import { validateResponseCitations } from './citationValidationService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { extractRequestedLineCount } from './queryIntentService';
import { isDeepDiveStudyRequest } from './theologicalExegesisService';
import { GoogleGenAI, Type } from '@google/genai';

export interface GeminiCaller {
  generateContent(params: {
    model: string;
    contents: any;
    config: any;
  }): Promise<{ text?: string | null; candidates?: any[]; usageMetadata?: any }>;
}

export interface StructuredCitation {
  sourceId: string;
  paragraphIndex: number;
  exactQuote: string;
}

export interface StructuredArgument {
  pointTitle: string;
  explanation: string;
  citations: StructuredCitation[];
}

export interface StructuredResponseSchema {
  answerability: boolean;
  summary: string;
  arguments: StructuredArgument[];
  deepDiveQuestions: string[];
}

export interface GenerationResult {
  status: 'success' | 'error' | 'not_answerable';
  provider: 'google-gemini' | 'none';
  model: string | null;
  responseOrigin: 'gemini' | 'none';
  answerText: string | null;
  structuredResponse?: StructuredResponseSchema | null;
  sourcesSuffisantes?: boolean;
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

export const STEP8_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answerability: {
      type: Type.BOOLEAN,
      description: "true si la base documentaire/package de preuves contient les éléments suffisants pour répondre, false sinon."
    },
    summary: {
      type: Type.STRING,
      description: "Synthèse globale concise, claire et pédagogique."
    },
    arguments: {
      type: Type.ARRAY,
      description: "Liste des points doctrinaux ou arguments développés.",
      items: {
        type: Type.OBJECT,
        properties: {
          pointTitle: {
            type: Type.STRING,
            description: "Titre court du point doctrinal ou argument."
          },
          explanation: {
            type: Type.STRING,
            description: "Explication et exégèse détaillée."
          },
          citations: {
            type: Type.ARRAY,
            description: "Citations exactes étayant cette explication.",
            items: {
              type: Type.OBJECT,
              properties: {
                sourceId: {
                  type: Type.STRING,
                  description: "Identifiant exact du bloc de preuve fourni (ex: 63-0324M ou expose-ch-4)."
                },
                paragraphIndex: {
                  type: Type.INTEGER,
                  description: "Index du paragraphe dans la source."
                },
                exactQuote: {
                  type: Type.STRING,
                  description: "Extrait textuel rigoureusement exact du paragraphe."
                }
              },
              required: ["sourceId", "paragraphIndex", "exactQuote"]
            }
          }
        },
        required: ["pointTitle", "explanation", "citations"]
      }
    },
    deepDiveQuestions: {
      type: Type.ARRAY,
      description: "2 à 3 questions d'approfondissement biblique.",
      items: {
        type: Type.STRING
      }
    }
  },
  required: ["answerability", "summary", "arguments", "deepDiveQuestions"]
};

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

export interface GenerateNewRagOptions {
  query: string;
  evidencePackage: RetrievalEvidencePackage;
  apiKey?: string;
  geminiClient?: GeminiCaller;
  systemInstruction?: string;
  temperature?: number;
  model?: string;
  history?: ChatMessage[];
  onStreamChunk?: (token: string) => void;
}

/**
 * Exécute la génération New RAG en respectant strictement l'inviolabilité du contrat de génération (Étape 8 - Sortie Structurée).
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
    model = 'gemini-3.8-flash',
    history = []
  } = options;

  // RÈGLE : Cas answerable === false
  if (!evidencePackage || !evidencePackage.answerable || !evidencePackage.evidence || evidencePackage.evidence.length === 0) {
    return {
      status: 'not_answerable',
      provider: 'none',
      model: null,
      responseOrigin: 'none',
      answerText: null,
      structuredResponse: null,
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
  const lineInstruction = reqLines ? `\n\nCONSIGNE STRICTE DE LONGUEUR : L'utilisateur exige un résumé / résultat de sa demande en exactement ${reqLines} lignes.` : '';
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
        structuredResponse: null,
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

  const step8SystemInstruction = systemInstruction || `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham et de l'Exposé des Sept Âges.

RÈGLES STRICTES ET MANDATOIRES (Étape 8 - Sortie Structurée JSON) :
1. INTERDICTION ABSOLUE DE TOUTE CONNAISSANCE EXTÉRIEURE : N'utilise AUCUNE connaissance externe ni source web. Réponds EXCLUSIVEMENT à partir des blocs d'évidence fournis dans le package de preuves ci-dessous.
2. RESTRICTION STRICTE DES SOURCE_ID : Tu dois OBLIGATOIREMENT ne citer QUE des identifiants 'sourceId' STRICTEMENT présents dans le package de preuves fourni. Il est STRICTEMENT INTERDIT d'inventer des sourceId ou d'utiliser un identifiant absent des preuves.
3. STRUCTURE DE SORTIE JSON OBLIGATOIRE : Renvoyez STRICTEMENT un objet JSON valide respectant le schéma :
   - 'answerability' (bool) : true si les preuves sont suffisantes, false si le corpus ne permet pas de répondre.
   - 'summary' (string) : Synthèse globale claire et pédagogique.
   - 'arguments' (array) : Tableau d'arguments { pointTitle, explanation, citations[] }. Chaque citation contient { sourceId, paragraphIndex, exactQuote }. Une explication peut avoir plusieurs citations exactes.
   - 'deepDiveQuestions' (array) : 2 à 3 questions de recherche et d'approfondissement.
4. CITATIONS EXACTES ET INTÉGRALES : Toute citation déclarée dans 'exactQuote' doit être une sous-chaîne exacte et intégrale du texte du paragraphe correspondant dans le package de preuves.
5. SI ANSWERABILITY EST FALSE : Définis 'answerability' à false, 'summary' à "Les documents disponibles dans la base documentaire ne contiennent pas d'informations suffisantes pour répondre à cette question.", 'arguments' à [], et 'deepDiveQuestions' à [].`;

  // Préparation du payload multi-tours pour Gemini si un historique est disponible
  let contentsPayload: any;
  if (Array.isArray(history) && history.length > 0) {
    const cleanHistory = history
      .filter(h => h.content && !h.content.startsWith('**Erreur') && !h.content.toLowerCase().startsWith('erreur') && !h.content.startsWith('> **Information') && !h.content.startsWith('**Aucun passage') && !h.content.includes('\u274C') && !h.content.includes('\u26A0'))
      .slice(-6)
      .map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content.substring(0, 4000) }]
      }));

    contentsPayload = cleanHistory.length > 0
      ? [
          ...cleanHistory,
          {
            role: 'user',
            parts: [{ text: promptContents }]
          }
        ]
      : promptContents;
  } else {
    contentsPayload = promptContents;
  }

  const t0 = Date.now();
  let parsedJson: StructuredResponseSchema | null = null;
  let isValid = false;

  try {
    const response = await client.generateContent({
      model,
      contents: contentsPayload,
      config: {
        systemInstruction: step8SystemInstruction,
        temperature,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: STEP8_RESPONSE_SCHEMA
      }
    });

    const finishReason = response?.candidates?.[0]?.finishReason;
    const responseText = response?.text;

    if (responseText) {
      try {
        const candidate = JSON.parse(responseText);
        if (typeof candidate?.answerability === 'boolean' && typeof candidate?.summary === 'string' && Array.isArray(candidate?.arguments)) {
          parsedJson = candidate;
          isValid = true;
        }
      } catch (_) {
        isValid = false;
      }
    }

    // Repli (Rule 3): si le JSON est invalide ou tronqué (finishReason !== 'STOP' && finishReason !== 1), UNE SEULE nouvelle tentative
    if (!isValid || (finishReason && finishReason !== 'STOP' && finishReason !== 1)) {
      console.warn('[GenerationAdapter - Étape 8] JSON invalide ou tronqué (finishReason:', finishReason, '). Tentative de réessai unique...');
      try {
        const retryResponse = await client.generateContent({
          model,
          contents: contentsPayload + "\n\nATTENTION : La réponse précédente était incomplète ou invalide. Renvoyez UN SEUL objet JSON complet et parfaitement valide respectant le schéma.",
          config: {
            systemInstruction: step8SystemInstruction,
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: STEP8_RESPONSE_SCHEMA
          }
        });

        const retryText = retryResponse?.text;
        if (retryText) {
          const retryCandidate = JSON.parse(retryText);
          if (typeof retryCandidate?.answerability === 'boolean' && typeof retryCandidate?.summary === 'string' && Array.isArray(retryCandidate?.arguments)) {
            parsedJson = retryCandidate;
            isValid = true;
          }
        }
      } catch (retryErr) {
        console.warn('[GenerationAdapter - Étape 8] Échec de la réessai unique.', retryErr);
      }
    }

    const latencyMs = Date.now() - t0;

    if (!isValid || !parsedJson) {
      return {
        status: 'error',
        provider: 'none',
        model: null,
        responseOrigin: 'none',
        answerText: null,
        structuredResponse: null,
        errorCode: 'INVALID_JSON_SCHEMA',
        errorMessage: 'La réponse générée par le modèle n\'est pas un JSON valide conforme au schéma ou a été tronquée après la réessai.',
        latencyMs,
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: []
      };
    }

    // Si answerability === false
    if (!parsedJson.answerability) {
      return {
        status: 'not_answerable',
        provider: 'google-gemini',
        model,
        responseOrigin: 'gemini',
        answerText: "Les documents disponibles dans la base documentaire de l'application ne contiennent pas d'informations suffisantes pour répondre à cette question.",
        structuredResponse: parsedJson,
        sourcesSuffisantes: false,
        latencyMs,
        errorCode: 'NOT_ANSWERABLE',
        errorMessage: "Non answerable dans le contexte sélectionné.",
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: []
      };
    }

    // Construction du texte markdown structuré pour rétrocompatibilité
    let answerText = `## Synthèse\n${parsedJson.summary}\n\n`;
    if (parsedJson.arguments && parsedJson.arguments.length > 0) {
      answerText += `## Démonstrations & Arguments Doctrinaux\n\n`;
      parsedJson.arguments.forEach((arg, idx) => {
        answerText += `### ${idx + 1}. ${arg.pointTitle}\n${arg.explanation}\n\n`;
        if (arg.citations && arg.citations.length > 0) {
          arg.citations.forEach(c => {
            answerText += `> « ${c.exactQuote} » [Réf: ${c.sourceId}, Para. ${c.paragraphIndex}]\n\n`;
          });
        }
      });
    }

    if (parsedJson.deepDiveQuestions && parsedJson.deepDiveQuestions.length > 0) {
      answerText += `### Pistes d'approfondissement\n`;
      parsedJson.deepDiveQuestions.forEach(q => {
        answerText += `- ${q}\n`;
      });
    }

    // Détection d'exposition d'identifiants techniques
    const exposureCheck = detectTechnicalIdentifierExposure(answerText);

    // Validation des citations
    const citationsValidation = validateResponseCitations({
      responseText: answerText,
      evidencePackage
    });

    // Extraction des sources
    const sources = evidencePackage.evidence.flatMap(ev =>
      ev.citationParagraphs.map(cp => ({
        title: `${ev.sermonTitle} (${ev.date || 'Non daté'}) — §${cp.paragraphIndex}`,
        uri: `sermon://${ev.sermonId}/${cp.paragraphIndex}`,
        sermonId: ev.sermonId,
        paragraphIndex: cp.paragraphIndex
      }))
    );

    return {
      status: 'success',
      provider: 'google-gemini',
      model,
      responseOrigin: 'gemini',
      answerText,
      structuredResponse: parsedJson,
      sourcesSuffisantes: true,
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

    return {
      status: 'error',
      provider: 'none',
      model: null,
      responseOrigin: 'none',
      answerText: null,
      structuredResponse: null,
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
