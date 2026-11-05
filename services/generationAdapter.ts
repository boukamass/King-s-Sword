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
import { LONG_CONTEXT_VECTOR_METHOD, LONG_CONTEXT_DIRECTIVES, formatLongContextSources } from './longContextRagService';
import { buildHistoryForPrompt } from './followUpContextService';
import { renderPartialStructuredAnswer } from './streamingAnswerService';

export interface GeminiCaller {
  generateContent(params: {
    model: string;
    contents: any;
    config: any;
  }): Promise<{ text?: string | null; candidates?: any[]; usageMetadata?: any }>;
  /** Version en flux (optionnelle) : la réponse arrive morceau par morceau */
  generateContentStream?(params: {
    model: string;
    contents: any;
    config: any;
  }): Promise<AsyncIterable<{ text?: string | null; candidates?: any[]; usageMetadata?: any }>>;
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

export interface MeasuredUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  measured: boolean;
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
  usageMetadata?: MeasuredUsageMetadata | null;
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
      description: "Réponse directe à la question, développée en 2 à 4 paragraphes : thèse principale, articulation des idées et nuances, en s'appuyant sur ce que les sources disent réellement."
    },
    arguments: {
      type: Type.ARRAY,
      description: "3 à 7 points complémentaires couvrant tous les aspects de la question présents dans les sources, du plus central au plus secondaire.",
      items: {
        type: Type.OBJECT,
        properties: {
          pointTitle: {
            type: Type.STRING,
            description: "Titre précis du point doctrinal ou de l'argument (pas un titre générique)."
          },
          explanation: {
            type: Type.STRING,
            description: "Explication développée (au moins 2 paragraphes) : ce que le texte affirme, comment il le justifie (Écritures citées, images, raisonnement), le contexte du passage et le lien avec les autres points."
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
  useLegacyExtrapolativeDirective6?: boolean;
  /** Plafond de caractères du prompt (défaut : profil approfondi de la configuration) */
  maxPromptChars?: number;
  /** 'deep' : synthèse, résumé ou étude (plan d'étude structuré) ; 'standard' : question ciblée */
  answerDepth?: 'standard' | 'deep';
  /** Consignes complémentaires ajoutées aux règles de base (sans jamais les remplacer) */
  additionalInstruction?: string;
  /** Message de progression affiché à l'utilisateur (ex. nouvelle tentative après une surcharge) */
  onProgress?: (message: string) => void;
  /** Réponse provisoire (Markdown, sans citations) affichée au fil de la génération */
  onPartialAnswer?: (markdown: string) => void;
}

/** Délais d'attente avant chaque nouvelle tentative du modèle principal après une surcharge (503) */
export const OVERLOAD_RETRY_DELAYS_MS = [3000, 8000];

/** Clés refusées par Google (401/403) pendant la session : elles ne sont plus sollicitées */
const invalidGeminiKeys = new Set<string>();

export type GeminiErrorKind = 'overloaded' | 'model_unavailable' | 'quota' | 'auth' | 'other';

/**
 * Classe une erreur de l'API Gemini selon sa cause réelle.
 */
export function classifyGeminiError(err: any): GeminiErrorKind {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status ?? err?.code ?? 0);
  if (status === 401 || status === 403 || msg.includes('"code":401') || msg.includes('"code":403') ||
      msg.includes('api key not valid') || msg.includes('unauthenticated') || msg.includes('permission_denied')) {
    return 'auth';
  }
  if (status === 429 || msg.includes('"code":429') || msg.includes('resource_exhausted') || msg.includes('quota')) {
    return 'quota';
  }
  if (status === 503 || msg.includes('"code":503') || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('"status":"unavailable"')) {
    return 'overloaded';
  }
  if (status === 404 || msg.includes('"code":404') || msg.includes('not found') || msg.includes('not supported')) {
    return 'model_unavailable';
  }
  return 'other';
}

/**
 * Règles de rédaction appliquées à toute réponse : profondeur, précision et rigueur de type NotebookLM.
 */
export const ANSWER_QUALITY_RULES = `

RÈGLES DE RÉDACTION (QUALITÉ DES RÉPONSES) :
A. RÉPONDS VRAIMENT À LA QUESTION POSÉE : commence le 'summary' par la réponse directe, puis développe-la. Ne paraphrase pas la question.
B. DÉVELOPPE : chaque 'explanation' fait au moins deux paragraphes et explique ce que le texte affirme, POURQUOI (raisonnement, Écritures invoquées, images employées par le prédicateur) et dans quel contexte du sermon.
C. EXPLOITE TOUTES LES PREUVES PERTINENTES : relie des passages éloignés ou issus de sermons différents, signale les convergences, les précisions successives et les éventuelles nuances ou évolutions (avec les dates).
D. SOIS PRÉCIS : reprends les termes exacts du prédicateur, les références bibliques qu'il cite, les noms, chiffres et dates présents dans les sources. Évite les formules vagues ou génériques.
E. CITE ABONDAMMENT : 1 à 3 citations exactes par point, choisies pour leur force probante (la phrase qui établit l'affirmation, pas une phrase voisine).
F. DISTINGUE ce que les sources affirment explicitement de ce qui en découle ; si une partie de la question n'est pas couverte par les sources, dis-le précisément dans le 'summary' au lieu de combler par des suppositions.
G. 'deepDiveQuestions' : 2 à 3 questions qui prolongent réellement l'étude à partir de ce que contiennent les sources.`;

/**
 * Plan d'étude approfondie, compatible avec le schéma structuré (synthèse + points argumentés).
 */
export const DEEP_STUDY_RULES = `

PLAN D'ÉTUDE APPROFONDIE (demande de synthèse, de résumé ou d'étude) :
- 'summary' : introduction de 3 à 5 paragraphes présentant le thème, la thèse d'ensemble et le fil conducteur des sources mobilisées (nombre de sermons et période couverte).
- 'arguments' : 5 à 8 points organisés comme un plan d'étude (fondements scripturaires et définitions, développement doctrinal, enchaînement ou chronologie, concordances avec les Écritures et l'Exposé, portée pratique et spirituelle). Les tableaux Markdown sont permis dans 'explanation' pour comparer ou ordonner.
- Pour un résumé d'un sermon : suis l'ordre du sermon, de l'introduction à la conclusion, en dégageant chaque mouvement de la prédication.`;

/**
 * Rédaction naturelle et développée (style NotebookLM) : un texte suivi plutôt qu'une liste de fragments.
 */
export const NATURAL_PROSE_RULES = `

STYLE DE RÉDACTION :
H. Écris en prose française naturelle et fluide, comme un enseignant qui explique à un étudiant : phrases complètes, transitions logiques entre les idées (« ainsi », « c'est pourquoi », « en revanche », « plus loin dans le même sermon »).
I. Le 'summary' est un texte suivi : une ouverture qui répond directement, un développement qui articule les idées principales, une conclusion qui en dégage la portée. Pas de liste à puces dans le 'summary'.
J. Chaque 'explanation' développe l'idée comme un paragraphe d'essai : elle situe le passage (sermon, date, contexte), expose l'enseignement, explique le raisonnement du prédicateur et relie ce point aux autres.
K. Intègre de courtes expressions du prédicateur entre guillemets dans le fil du texte quand elles éclairent l'explication ; les citations longues vont dans 'citations'.`;

/**
 * Relances : la question s'interprète à la lumière de l'échange précédent.
 */
export const FOLLOW_UP_RULES = `

CONVERSATION EN COURS :
L. La question peut prolonger l'échange précédent (historique ci-dessus). Interprète les pronoms et les ellipses (« il », « ce silence », « ce point », « pourquoi ? », « et ensuite ? ») d'après le sujet de cet échange, puis réponds à la question ainsi complétée.
M. Ne répète pas la réponse précédente : approfondis, précise ou complète-la avec de nouveaux passages ; renvoie à ce qui a déjà été établi en une phrase si nécessaire.`;

/** Réponse du modèle (texte seul) qui ouvre la conversation après le bloc de sources */
const SOURCES_ACKNOWLEDGEMENT = "Sources reçues. Je répondrai exclusivement à partir de ces passages, en citant leurs références exactes.";

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
/** Appel de note en exposant (¹, ², ¹²…) : sans crochets, pour ne pas être confondu avec une référence de sermon */
export function toSuperscriptNumber(n: number): string {
  return String(n).split('').map(d => SUPERSCRIPT_DIGITS[Number(d)] ?? d).join('');
}

/**
 * Réponse Markdown : synthèse, puis chaque point avec ses appels de note numérotés et ses citations vérifiées.
 */
export function buildStructuredAnswerMarkdown(structured: StructuredResponseSchema, includeDeepDive: boolean): string {
  let text = `## Synthèse\n${structured.summary}\n\n`;
  let noteNumber = 0;
  if (structured.arguments && structured.arguments.length > 0) {
    text += `## Démonstrations & Arguments Doctrinaux\n\n`;
    structured.arguments.forEach((arg, idx) => {
      const citations = arg.citations || [];
      const notes = citations.map(() => toSuperscriptNumber(++noteNumber));
      const markers = notes.length > 0 ? ` ${notes.join(' ')}` : '';
      text += `### ${idx + 1}. ${arg.pointTitle}\n${arg.explanation}${markers}\n\n`;
      citations.forEach((c, cIdx) => {
        text += `> ${notes[cIdx]} « ${c.exactQuote} » [Réf: ${c.sourceId}, Para. ${c.paragraphIndex}]\n\n`;
      });
    });
  }
  if (includeDeepDive && structured.deepDiveQuestions && structured.deepDiveQuestions.length > 0) {
    text += `### Pistes d'approfondissement\n`;
    structured.deepDiveQuestions.forEach(q => {
      text += `- ${q}\n`;
    });
  }
  return text;
}

/**
 * Lit la réponse en flux : la réponse provisoire est transmise à chaque morceau reçu. Une coupure en cours de flux
 * est traitée comme une réponse tronquée (la nouvelle tentative unique s'applique ensuite).
 */
async function readStreamedResponse(
  client: GeminiCaller,
  params: { model: string; contents: any; config: any },
  onPartialAnswer: (markdown: string) => void
): Promise<{ text: string; candidates: any[]; usageMetadata?: any }> {
  const stream = await client.generateContentStream!(params);
  let text = '';
  let finishReason: any = undefined;
  let usageMetadata: any = undefined;
  let lastEmitted = '';
  try {
    for await (const chunk of stream) {
      const piece = chunk?.text;
      if (piece) {
        text += piece;
        const partial = renderPartialStructuredAnswer(text);
        if (partial && partial !== lastEmitted) {
          lastEmitted = partial;
          try { onPartialAnswer(partial); } catch {}
        }
      }
      const fr = chunk?.candidates?.[0]?.finishReason;
      if (fr) finishReason = fr;
      if (chunk?.usageMetadata) usageMetadata = chunk.usageMetadata;
    }
  } catch (err) {
    if (!text) throw err;
    console.warn('[GenerationAdapter] Flux interrompu, réponse traitée comme tronquée :', (err as any)?.message || err);
    finishReason = 'STREAM_INTERRUPTED';
  }
  return { text, candidates: [{ finishReason }], usageMetadata };
}

/**
 * Exécute la génération New RAG en respectant strictement l'inviolabilité du contrat de génération (Étape 8 - Sortie Structurée).
 */
function buildGenerationContext(
  evidencePackage: RetrievalEvidencePackage,
  query: string,
  useLegacyExtrapolativeDirective6: boolean
): string {
  return evidencePackage.vectorMethod === LONG_CONTEXT_VECTOR_METHOD
    ? `SOURCES SÉLECTIONNÉES :\n============================================================\n${formatLongContextSources(evidencePackage)}\n============================================================\n\n${LONG_CONTEXT_DIRECTIVES}`
    : formatEvidenceContextForGemini(evidencePackage, query, { useLegacyExtrapolativeDirective6 });
}

/**
 * Retire les preuves les moins bien classées (puis, pour une source unique, ses derniers paragraphes)
 * jusqu'à ce que le contexte formaté respecte le plafond de caractères du prompt.
 */
export function enforcePromptBudget(
  evidencePackage: RetrievalEvidencePackage,
  query: string,
  useLegacyExtrapolativeDirective6 = false,
  maxChars: number = aiConfig.tokenBudgetConfig.maxPromptChars
): RetrievalEvidencePackage {
  if (!evidencePackage.answerable || !Array.isArray(evidencePackage.evidence) || evidencePackage.evidence.length === 0) {
    return evidencePackage;
  }
  let pkg = evidencePackage;
  let length = buildGenerationContext(pkg, query, useLegacyExtrapolativeDirective6).length;
  if (length <= maxChars) return pkg;

  while (length > maxChars && pkg.evidence.length > 1) {
    pkg = { ...pkg, evidence: pkg.evidence.slice(0, -1), isPartial: true };
    length = buildGenerationContext(pkg, query, useLegacyExtrapolativeDirective6).length;
  }
  while (length > maxChars && pkg.evidence[0].citationParagraphs.length > 1) {
    const ev = pkg.evidence[0];
    const kept = ev.citationParagraphs.slice(0, Math.max(1, Math.floor(ev.citationParagraphs.length * 0.9)));
    const paragraphIds = kept.map(cp => cp.paragraphIndex);
    pkg = {
      ...pkg,
      isPartial: true,
      evidence: [{ ...ev, citationParagraphs: kept, paragraphIds, endParagraph: paragraphIds[paragraphIds.length - 1] }]
    };
    length = buildGenerationContext(pkg, query, useLegacyExtrapolativeDirective6).length;
  }
  console.log(`[GenerationAdapter] Contexte plafonné à ${length} caractères (${pkg.evidence.length} preuve(s)).`);
  return pkg;
}

export async function generateNewRagResponse(
  options: GenerateNewRagOptions
): Promise<GenerationResult> {
  const {
    query,
    evidencePackage: inputEvidencePackage,
    apiKey,
    geminiClient,
    systemInstruction,
    temperature = 0.2,
    model = 'gemini-3.8-flash',
    history = [],
    useLegacyExtrapolativeDirective6 = false,
    maxPromptChars = aiConfig.tokenBudgetConfig.maxPromptChars,
    answerDepth = 'standard',
    additionalInstruction = '',
    onProgress,
    onPartialAnswer
  } = options;

  // Plafond strict du contexte transmis (préserve le quota Gemini de l'utilisateur, quelle que soit la sélection)
  const evidencePackage = inputEvidencePackage
    ? enforcePromptBudget(inputEvidencePackage, query, useLegacyExtrapolativeDirective6, maxPromptChars)
    : inputEvidencePackage;

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
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0, measured: false },
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: []
    };
  }

  // Formatage déterministe du contexte documentaire (sources intégrales en mode contexte long)
  const context = buildGenerationContext(evidencePackage, query, useLegacyExtrapolativeDirective6);
  const reqLines = extractRequestedLineCount(query);
  const lineInstruction = reqLines ? `\n\nCONSIGNE STRICTE DE LONGUEUR : L'utilisateur exige un résumé / résultat de sa demande en exactement ${reqLines} lignes.` : '';
  const questionBlock = `QUESTION DU CHERCHEUR :\n"${query}"${lineInstruction}`;
  const promptContents = `${context}\n\n============================================================\n${questionBlock}`;

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

    // Cascade limitée aux modèles Flash accessibles avec une clé gratuite : le modèle Pro (quota gratuit nul)
    // et gemini-2.5-flash (404) ne produisaient que des requêtes inutiles et des messages d'erreur trompeurs
    const modelCascade = Array.from(new Set([model, 'gemini-flash-latest'].filter(Boolean)));

    // Une même cascade (clés, modèles, nouvelles tentatives) pour l'appel classique et l'appel en flux
    const runWithCascade = async <T>(call: (googleAi: GoogleGenAI, m: string) => Promise<T>): Promise<T> => {
      let lastErr: any = null;
      let overloadErr: any = null;
      let quotaErr: any = null;
      let authErr: any = null;
      for (const k of allKeys) {
        // Clé déjà refusée (401/403) pendant cette session : inutile de la solliciter à nouveau
        if (invalidGeminiKeys.has(k)) continue;
        const googleAi = new GoogleGenAI({ apiKey: k });
        let switchKey = false;
        for (const m of modelCascade) {
          // Le modèle principal est réessayé après une surcharge passagère (503) ; les autres une seule fois
          const maxAttempts = m === model ? OVERLOAD_RETRY_DELAYS_MS.length + 1 : 1;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              const res = await call(googleAi, m);
              activeModelUsed = m;
              return res;
            } catch (err: any) {
              lastErr = err;
              const kind = classifyGeminiError(err);
              if (kind === 'overloaded') {
                overloadErr = err;
                if (attempt < maxAttempts - 1) {
                  onProgress?.("Le service d'analyse est très sollicité, nouvelle tentative dans quelques secondes...");
                  await new Promise(resolve => setTimeout(resolve, OVERLOAD_RETRY_DELAYS_MS[attempt]));
                  continue;
                }
                break; // Modèle suivant sur la même clé
              }
              if (kind === 'model_unavailable') break; // Modèle suivant sur la même clé
              if (kind === 'quota') {
                // Quota épuisé pour cette clé : seule situation où l'on passe à la clé suivante
                quotaErr = err;
                switchKey = true;
                break;
              }
              if (kind === 'auth') {
                invalidGeminiKeys.add(k);
                authErr = err;
                switchKey = true;
                break;
              }
              throw err;
            }
          }
          if (switchKey) break;
        }
        // Une surcharge touche le modèle pour toutes les clés : solliciter les autres clés serait inutile
        if (!switchKey) break;
      }
      // Erreur la plus représentative de la cause réelle (et non la dernière tentée)
      const meaningfulErr = overloadErr || quotaErr || authErr || lastErr;
      if (meaningfulErr) throw meaningfulErr;
      throw new Error('API key not valid : toutes les clés Gemini enregistrées ont été refusées.');
    };

    client = {
      generateContent: (p) => runWithCascade((googleAi, m) => googleAi.models.generateContent({ ...p, model: m })),
      generateContentStream: (p) => runWithCascade((googleAi, m) => googleAi.models.generateContentStream({ ...p, model: m }))
    };
  }

  const baseSystemInstruction = systemInstruction || `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham et de l'Exposé des Sept Âges.

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
  // Préparation du payload multi-tours pour Gemini si un historique est disponible (réponses compactées)
  const cleanHistory = Array.isArray(history) && history.length > 0 ? buildHistoryForPrompt(history) : [];
  const hasConversation = cleanHistory.length > 0;

  const step8SystemInstruction = baseSystemInstruction
    + ANSWER_QUALITY_RULES
    + NATURAL_PROSE_RULES
    + (answerDepth === 'deep' ? DEEP_STUDY_RULES : '')
    + (hasConversation ? FOLLOW_UP_RULES : '')
    + (additionalInstruction ? `\n\n${additionalInstruction}` : '');

  // Les sources ouvrent la conversation, avant l'historique : d'une relance à l'autre sur les mêmes sources,
  // le début du prompt est identique et Gemini le réutilise automatiquement (mise en cache implicite, tokens économisés)
  const contentsPayload: any = hasConversation
    ? [
        { role: 'user', parts: [{ text: context }] },
        { role: 'model', parts: [{ text: SOURCES_ACKNOWLEDGEMENT }] },
        ...cleanHistory,
        { role: 'user', parts: [{ text: questionBlock }] }
      ]
    : promptContents;

  const t0 = Date.now();
  let parsedJson: StructuredResponseSchema | null = null;
  let isValid = false;

  try {
    const requestParams = {
      model,
      contents: contentsPayload,
      config: {
        systemInstruction: step8SystemInstruction,
        temperature,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: STEP8_RESPONSE_SCHEMA
      }
    };
    const useStreaming = Boolean(onPartialAnswer && client.generateContentStream && aiConfig.featureFlags.useStreamingAnswers);
    const response = useStreaming
      ? await readStreamedResponse(client, requestParams, onPartialAnswer!)
      : await client.generateContent(requestParams);

    const finishReason = response?.candidates?.[0]?.finishReason;
    const responseText = response?.text;
    let promptTok = Number(response?.usageMetadata?.promptTokenCount ?? 0);
    let candTok = Number(response?.usageMetadata?.candidatesTokenCount ?? 0);
    let totTok = Number(response?.usageMetadata?.totalTokenCount ?? (promptTok + candTok));
    let hasMeasuredUsage = Boolean(response?.usageMetadata);

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
                parts: [{ text: `${hasConversation ? questionBlock : promptContents}${retryInstruction}` }]
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

        if (retryResponse?.usageMetadata) {
          const rPrompt = Number(retryResponse.usageMetadata.promptTokenCount ?? 0);
          const rCand = Number(retryResponse.usageMetadata.candidatesTokenCount ?? 0);
          const rTot = Number(retryResponse.usageMetadata.totalTokenCount ?? (rPrompt + rCand));
          promptTok += rPrompt;
          candTok += rCand;
          totTok += rTot;
          hasMeasuredUsage = true;
        }

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
    const measuredUsage: MeasuredUsageMetadata = {
      promptTokenCount: promptTok,
      candidatesTokenCount: candTok,
      totalTokenCount: totTok,
      measured: hasMeasuredUsage
    };

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
          usageMetadata: measuredUsage,
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
        usageMetadata: measuredUsage,
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
        usageMetadata: measuredUsage,
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
    const rawAnswerText = buildStructuredAnswerMarkdown(parsedJson, false);

    // Construction du texte markdown final vérifié et réparé (appels de note ¹ ² renvoyant aux citations)
    const answerText = buildStructuredAnswerMarkdown(verifiedStructured, true);

    // Détection d'exposition d'identifiants techniques
    const exposureCheck = detectTechnicalIdentifierExposure(answerText);

    // Validation des citations (évalue les citations générées et conserve la trace des rejets éventuels)
    const citationsValidation = validateResponseCitations({
      responseText: verificationReport.rejectedCount > 0 ? rawAnswerText : answerText,
      evidencePackage
    });

    // Sources affichées : uniquement les paragraphes réellement cités dans la réponse, dans leur ordre d'apparition
    // (repli : les premiers paragraphes transmis si le modèle n'a cité aucun passage)
    const seenSourceKeys = new Set<string>();
    const sources: Array<{ title: string; uri: string; sermonId: string; paragraphIndex: number }> = [];
    const evidenceByDoc = new Map(evidencePackage.evidence.map(ev => [ev.sermonId, ev]));
    const pushSource = (sermonId: string, paragraphIndex: number) => {
      const key = `${sermonId}_${paragraphIndex}`;
      const ev = evidenceByDoc.get(sermonId);
      if (!ev || seenSourceKeys.has(key)) return;
      seenSourceKeys.add(key);
      sources.push({
        title: `${ev.sermonTitle} (${ev.date || 'Non daté'}) — §${paragraphIndex}`,
        uri: `sermon://${sermonId}/${paragraphIndex}`,
        sermonId,
        paragraphIndex
      });
    };
    for (const arg of verifiedStructured.arguments || []) {
      for (const c of arg.citations || []) {
        if (c && c.sourceId && Number.isFinite(Number(c.paragraphIndex))) pushSource(c.sourceId, Number(c.paragraphIndex));
      }
    }
    if (sources.length === 0) {
      for (const ev of evidencePackage.evidence) {
        for (const cp of ev.citationParagraphs) {
          if (sources.length >= 20) break;
          pushSource(ev.sermonId, cp.paragraphIndex);
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
      usageMetadata: measuredUsage,
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
    let userMessage = errorMsg;
    const errorKind = classifyGeminiError(err);
    if (errorKind === 'quota') {
      errorCode = 'RESOURCE_EXHAUSTED';
      userMessage = "Le service d'analyse a reçu trop de demandes en peu de temps. Patientez environ une minute, puis reposez votre question.";
    } else if (errorKind === 'overloaded' || normErr.includes('unavailable')) {
      errorCode = 'SERVICE_UNAVAILABLE';
      userMessage = "Le service d'analyse est momentanément surchargé. Réessayez dans quelques instants.";
    } else if (errorKind === 'auth') {
      errorCode = 'API_KEY_INVALID';
      userMessage = "La clé Gemini enregistrée est refusée par Google. Vérifiez-la ou remplacez-la via le bouton « Clé Active ».";
    }
    // Le détail technique (codes, quotas, tokens) reste dans la console et n'est jamais montré à l'utilisateur
    console.warn('[GenerationAdapter] Échec de génération :', errorMsg);

    return {
      status: 'error',
      provider: 'none',
      model: null,
      responseOrigin: 'none',
      answerText: null,
      structuredResponse: null,
      errorCode,
      errorMessage: userMessage,
      latencyMs,
      citationsValidation: null,
      chunkIdExposure: false,
      technicalIdentifiersDetected: [],
      sources: []
    };
  }
}
