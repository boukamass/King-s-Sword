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
import { GoogleGenAI, Type } from '@google/genai';

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

  // Réduction du nombre de passages envoyés si la confiance de récupération est basse
  let effectiveEvidence = evidencePackage.evidence;
  const decisionJournal = evidencePackage.decisionJournal;
  const isLowConfidence = 
    (evidencePackage.confidenceScore !== undefined && evidencePackage.confidenceScore < 0.6) ||
    decisionJournal?.zone === 'refusal' ||
    decisionJournal?.zone === 'grey_zone' ||
    (decisionJournal?.topVectorScore !== undefined && decisionJournal.topVectorScore < 0.81) ||
    (decisionJournal?.topLexScore !== undefined && decisionJournal.topLexScore < 5);

  if (isLowConfidence && effectiveEvidence.length > 2) {
    effectiveEvidence = effectiveEvidence.slice(0, 2);
  }
  const effectivePackage: RetrievalEvidencePackage = {
    ...evidencePackage,
    evidence: effectiveEvidence
  };

  // Formatage déterministe du contexte documentaire
  const context = formatEvidenceContextForGemini(effectivePackage, query);
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

  const defaultSysInstruction = `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham et des Écritures.

DIRECTIVES DE RÉPONSE ET FORMAT STRICT (JSON) :
Tu dois impérativement renvoyer un objet JSON respectant le schéma avec les champs 'sources_suffisantes' et 'reponse'.

1. DÉCISION DU CHAMP 'sources_suffisantes' :
- Évalue si les extraits textuels fournis contiennent les éléments nécessaires pour traiter le sujet doctrinal, prophétique ou scripturaire de la question.
- Vaut true UNIQUEMENT si les extraits permettent de répondre véritablement au fond de la question.
- Vaut false si le sujet est absent des extraits, hors-domaine, profane (technologie, actualité, recettes, etc.), ou si les extraits ne mentionnent que fortuitement des termes généraux sans rapport avec l'objet de la demande.

2. EN CAS DE REFUS (sources_suffisantes = false) :
- Rédige dans le champ 'reponse' un message très court de 2 phrases au maximum.
- Commence obligatoirement par : « Les textes disponibles ne traitent pas de ce sujet. »
- Si pertinent, ajoute une brève suggestion de reformulation ou de recherche orientée vers le Message.
- Ne dresse AUCUNE liste des thèmes des passages non pertinents reçus.
- N'inclus AUCUNE section "### Sources consultées" ni "### Pistes d'approfondissement".

3. EN CAS D'ACCEPTATION (sources_suffisantes = true) :
- Fournis une étude doctrinale complète, pédagogique et structurée dans le champ 'reponse'.
- Fonde ton exposé EXCLUSIVEMENT sur les extraits fournis.
- Appuie chaque affirmation sur des citations textuelles exactes entre guillemets suivies de leur référence :
  > « ... » [Réf: ID_SERMON, Para. N]
- Termine obligatoirement par la section "### Sources consultées" listant clairement tous les documents et paragraphes cités.
- Termine par la section "### Pistes d'approfondissement" proposant 2 à 3 questions de recherche complémentaires sans balise [Réf:].`;

  const sysInstruction = systemInstruction || defaultSysInstruction;

  const t0 = Date.now();

  try {
    const response = await client.generateContent({
      model,
      contents: promptContents,
      config: {
        systemInstruction: sysInstruction,
        temperature,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sources_suffisantes: {
              type: Type.BOOLEAN,
              description: "true si les extraits fournis traitent réellement de la question. false si le sujet est absent, profane ou hors-domaine."
            },
            reponse: {
              type: Type.STRING,
              description: "Si sources_suffisantes=true: étude théologique complète avec citations exactes. Si sources_suffisantes=false: message court de 2 phrases max débutant par 'Les textes disponibles ne traitent pas de ce sujet.' éventuellement suivi d'une suggestion de reformulation."
            }
          },
          required: ["sources_suffisantes", "reponse"]
        }
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

    let sourcesSuffisantes = true;
    let finalAnswerText = responseText;

    try {
      const parsed = JSON.parse(responseText);
      if (typeof parsed?.sources_suffisantes === 'boolean') {
        sourcesSuffisantes = parsed.sources_suffisantes;
      }
      if (typeof parsed?.reponse === 'string' && parsed.reponse.trim()) {
        finalAnswerText = parsed.reponse.trim();
      }
    } catch (_) {
      const matchJson = responseText.match(/\{[\s\S]*\}/);
      if (matchJson) {
        try {
          const parsed = JSON.parse(matchJson[0]);
          if (typeof parsed?.sources_suffisantes === 'boolean') {
            sourcesSuffisantes = parsed.sources_suffisantes;
          }
          if (typeof parsed?.reponse === 'string' && parsed.reponse.trim()) {
            finalAnswerText = parsed.reponse.trim();
          }
        } catch (__) {}
      }
    }

    // Si les sources ne sont pas suffisantes (refus Gemini propre)
    if (!sourcesSuffisantes) {
      return {
        status: 'success',
        provider: 'google-gemini',
        model,
        responseOrigin: 'gemini',
        answerText: finalAnswerText,
        sourcesSuffisantes: false,
        latencyMs,
        errorCode: null,
        errorMessage: null,
        citationsValidation: null,
        chunkIdExposure: false,
        technicalIdentifiersDetected: [],
        sources: []
      };
    }

    // RÈGLE 12 : Détection stricte d'exposition de Chunk ID
    const exposureCheck = detectTechnicalIdentifierExposure(finalAnswerText);

    // RÈGLE 9, 10, 11 : Validation des citations
    const citationsValidation = validateResponseCitations({
      responseText: finalAnswerText,
      evidencePackage: effectivePackage
    });

    // Extraction des sources valides
    const sources = effectivePackage.evidence.flatMap(ev => 
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
      answerText: finalAnswerText,
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
