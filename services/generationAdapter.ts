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
import { validateResponseCitations, validateSingleCitation, normalizeTextForComparison } from './citationValidationService';
import { getGeminiApiKey, getAllGeminiApiKeys } from '../utils/apiKeyHelper';
import { extractRequestedLineCount } from './queryIntentService';
import { isDeepDiveStudyRequest } from './theologicalExegesisService';
import { GoogleGenAI, Type } from '@google/genai';
import { aiConfig } from '../config/aiConfig';

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

export interface CitationContextVerificationReport {
  sanitizedResponse: StructuredResponseSchema;
  verifiedCount: number;
  repairedCount: number;
  rejectedCount: number;
}

/**
 * Vérificateur déterministe post-génération des citations par rapport au RetrievalEvidencePackage :
 * 1. Vérifie que chaque citation (sourceId, paragraphIndex, exactQuote) correspond à une source réellement transmise.
 * 2. Répare automatiquement les décalages de ±1 paragraphe (y compris dans adjacentContext) ou d'identifiant sourceId.
 * 3. Écarte de la réponse finale toute citation inventée dont ni la source ni l'extrait ne figurent dans le contexte fourni.
 */
export function verifyCitationsAgainstContext(
  structured: StructuredResponseSchema,
  evidencePackage: RetrievalEvidencePackage
): CitationContextVerificationReport {
  if (!structured || !Array.isArray(structured.arguments)) {
    return {
      sanitizedResponse: structured,
      verifiedCount: 0,
      repairedCount: 0,
      rejectedCount: 0
    };
  }

  let verifiedCount = 0;
  let repairedCount = 0;
  let rejectedCount = 0;

  const sanitizedArgs: StructuredArgument[] = structured.arguments.map(arg => {
    const rawCitations = Array.isArray(arg.citations) ? arg.citations : [];
    const verifiedCitations: StructuredCitation[] = [];

    for (const c of rawCitations) {
      const detail = validateSingleCitation(
        c.exactQuote || '',
        c.sourceId || null,
        typeof c.paragraphIndex === 'number' ? c.paragraphIndex : null,
        evidencePackage
      );

      if (detail.isValid) {
        verifiedCount++;
        const repairedSourceId = detail.actualSourceId || detail.sermonId || c.sourceId;
        const repairedParaIdx = detail.actualParagraphIndex ?? detail.paragraphIndex ?? c.paragraphIndex;
        const repairedQuote = detail.correctedQuote || c.exactQuote;

        if (detail.isSourceIdCorrected || detail.isParagraphCorrected || detail.isQuoteCorrected) {
          repairedCount++;
        }

        verifiedCitations.push({
          sourceId: repairedSourceId,
          paragraphIndex: repairedParaIdx,
          exactQuote: repairedQuote
        });
        continue;
      }

      // Vérification secondaire dans le fenêtrage adjacent ±1 paragraphe (adjacentContext)
      const normQuote = normalizeTextForComparison(c.exactQuote || '');
      let foundInAdjacent: StructuredCitation | null = null;

      if (normQuote.length >= 12 && Array.isArray(evidencePackage?.evidence)) {
        for (const ev of evidencePackage.evidence) {
          const adjParas = ev.adjacentContext?.adjacentParagraphs || [];
          for (const adj of adjParas) {
            const normAdj = normalizeTextForComparison(adj.text || '');
            if (normAdj && normAdj.includes(normQuote)) {
              foundInAdjacent = {
                sourceId: ev.sermonId,
                paragraphIndex: adj.paragraphIndex,
                exactQuote: c.exactQuote
              };
              break;
            }
          }
          if (foundInAdjacent) break;
        }
      }

      if (foundInAdjacent) {
        verifiedCount++;
        repairedCount++;
        verifiedCitations.push(foundInAdjacent);
      } else {
        rejectedCount++;
      }
    }

    return {
      ...arg,
      citations: verifiedCitations
    };
  });

  return {
    sanitizedResponse: {
      ...structured,
      arguments: sanitizedArgs
    },
    verifiedCount,
    repairedCount,
    rejectedCount
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

  // Résolution du client Gemini (avec bascule automatique multi-clés et multi-modèles pour les appels réels)
  let client = geminiClient;
  let activeModelUsed = model;
  if (!client) {
    const candidateKeys = apiKey ? [apiKey, ...getAllGeminiApiKeys().filter(k => k !== apiKey)] : getAllGeminiApiKeys();
    const fallbackSingleKey = apiKey || getGeminiApiKey();
    const allKeys = candidateKeys.length > 0 ? candidateKeys : (fallbackSingleKey ? [fallbackSingleKey] : []);

    if (allKeys.length === 0) {
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

    const modelCascade = Array.from(new Set([
      model,
      'gemini-2.5-flash',
      'gemini-flash-latest',
      ...(aiConfig.models.fastFailoverCascade || [])
    ].filter(Boolean)));

    client = {
      generateContent: async (p) => {
        let lastErr: any = null;
        for (const k of allKeys) {
          const googleAi = new GoogleGenAI({ apiKey: k });
          for (const m of modelCascade) {
            try {
              const res = await googleAi.models.generateContent({ ...p, model: m });
              activeModelUsed = m;
              return res;
            } catch (err: any) {
              lastErr = err;
              const msg = (err?.message || String(err)).toLowerCase();
              const isModelError = msg.includes('404') || msg.includes('not found') || msg.includes('not supported');
              const isQuotaOrRate = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('503') || msg.includes('overloaded');
              if (isModelError) {
                continue; // Essaie le modèle suivant sur la même clé
              }
              if (isQuotaOrRate) {
                continue; // Essaie le modèle suivant puis la clé suivante
              }
              throw err;
            }
          }
        }
        throw lastErr || new Error('Échec de génération Gemini sur tous les modèles de secours.');
      }
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
5. SI ANSWERABILITY EST FALSE : Définis 'answerability' à false, 'summary' à "Les documents disponibles dans la base documentaire ne contiennent pas d'informations suffisantes pour répondre à cette question.", 'arguments' à [], et 'deepDiveQuestions' à [].
6. GARDE ANTI-HALLUCINATION DE SECOND ÉTAGE (REQUÊTES PIÈGES VOISINES) : Si la question de l'utilisateur introduit un détail factuel, un chiffre, un lieu, une date, un objet ou un attribut anachronique/erroné qui est ABSENT ou CONTREDIT par les paragraphes fournis (ex: "huitième sceau", "trois témoins", "cheval vert", "pain au levain", "concile de Trente", "épée laser", "année 1975"), tu dois OBLIGATOIREMENT soit mettre 'answerability' à false, soit réfuter explicitement la fausse prémisse dans 'summary' en citant le fait exact du texte source sans jamais valider la prémisse erronée.`;

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

    const rawTextTrimmed = (responseText || '').trim();
    const isPlainMarkdownResponse =
      !isValid &&
      rawTextTrimmed.length > 0 &&
      !rawTextTrimmed.startsWith('{') &&
      !rawTextTrimmed.startsWith('[') &&
      !rawTextTrimmed.toLowerCase().includes('non json') &&
      !rawTextTrimmed.toLowerCase().includes('tronqué') &&
      (!finishReason || finishReason === 'STOP' || finishReason === 1);

    // Repli (Rule 3): si le JSON est invalide ou tronqué (finishReason !== 'STOP' && finishReason !== 1), UNE SEULE nouvelle tentative
    if ((!isValid && !isPlainMarkdownResponse) || (finishReason && finishReason !== 'STOP' && finishReason !== 1)) {
      console.warn('[GenerationAdapter - Étape 8] JSON invalide ou tronqué (finishReason:', finishReason, '). Tentative de réessai unique...');
      try {
        const retryInstruction = "\n\nATTENTION : La réponse précédente était incomplète ou invalide. Renvoyez UN SEUL objet JSON complet et parfaitement valide respectant le schéma.";
        const retryContents = Array.isArray(contentsPayload)
          ? [
              ...contentsPayload.slice(0, -1),
              {
                role: 'user',
                parts: [{ text: `${promptContents}${retryInstruction}` }]
              }
            ]
          : `${contentsPayload}${retryInstruction}`;

        const retryResponse = await client.generateContent({
          model: activeModelUsed,
          contents: retryContents,
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
      if (isPlainMarkdownResponse) {
        const answerText = rawTextTrimmed;
        const exposureCheck = detectTechnicalIdentifierExposure(answerText);
        const citationsValidation = validateResponseCitations({
          responseText: answerText,
          evidencePackage
        });
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
        return {
          status: 'success',
          provider: 'google-gemini',
          model: activeModelUsed,
          responseOrigin: 'gemini',
          answerText,
          structuredResponse: null,
          sourcesSuffisantes: true,
          latencyMs,
          errorCode: null,
          errorMessage: null,
          citationsValidation,
          chunkIdExposure: exposureCheck.exposed,
          technicalIdentifiersDetected: exposureCheck.identifiers,
          sources
        };
      }

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

    // Vérification déterministe post-génération et réparation d'ancrage (sourceId, §n et contexte adjacent ±1)
    const verificationReport = verifyCitationsAgainstContext(parsedJson, evidencePackage);
    const verifiedStructured = verificationReport.sanitizedResponse;

    // Construction du texte markdown brut (avant filtrage des rejets) pour l'audit de validation
    let rawAnswerText = `## Synthèse\n${parsedJson.summary}\n\n`;
    if (parsedJson.arguments && parsedJson.arguments.length > 0) {
      rawAnswerText += `## Démonstrations & Arguments Doctrinaux\n\n`;
      parsedJson.arguments.forEach((arg, idx) => {
        rawAnswerText += `### ${idx + 1}. ${arg.pointTitle}\n${arg.explanation}\n\n`;
        if (arg.citations && arg.citations.length > 0) {
          arg.citations.forEach(c => {
            rawAnswerText += `> « ${c.exactQuote} » [Réf: ${c.sourceId}, Para. ${c.paragraphIndex}]\n\n`;
          });
        }
      });
    }

    // Construction du texte markdown final vérifié et réparé
    let answerText = `## Synthèse\n${verifiedStructured.summary}\n\n`;
    if (verifiedStructured.arguments && verifiedStructured.arguments.length > 0) {
      answerText += `## Démonstrations & Arguments Doctrinaux\n\n`;
      verifiedStructured.arguments.forEach((arg, idx) => {
        answerText += `### ${idx + 1}. ${arg.pointTitle}\n${arg.explanation}\n\n`;
        if (arg.citations && arg.citations.length > 0) {
          arg.citations.forEach(c => {
            answerText += `> « ${c.exactQuote} » [Réf: ${c.sourceId}, Para. ${c.paragraphIndex}]\n\n`;
          });
        }
      });
    }

    if (verifiedStructured.deepDiveQuestions && verifiedStructured.deepDiveQuestions.length > 0) {
      answerText += `### Pistes d'approfondissement\n`;
      verifiedStructured.deepDiveQuestions.forEach(q => {
        answerText += `- ${q}\n`;
      });
    }

    // Détection d'exposition d'identifiants techniques
    const exposureCheck = detectTechnicalIdentifierExposure(answerText);

    // Validation des citations (évalue les citations générées et conserve la trace des rejets éventuels)
    const citationsValidation = validateResponseCitations({
      responseText: verificationReport.rejectedCount > 0 ? rawAnswerText : answerText,
      evidencePackage
    });

    // Extraction et déduplication des sources
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

    return {
      status: 'success',
      provider: 'google-gemini',
      model: activeModelUsed,
      responseOrigin: 'gemini',
      answerText,
      structuredResponse: verifiedStructured,
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
