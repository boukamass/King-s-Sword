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
import { isDeepDiveStudyRequest } from './theologicalExegesisService';
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

  // Phase B.2 : Détermination du Niveau de détail choisi par la question/utilisateur
  const queryLower = query.toLowerCase();
  const isStudy = /\b(etude|étude|approfondi|approfondie|panorama|exhaustif|exhaustive|complet|complete)\b/i.test(queryLower);
  const isExplain = /\b(explique|expliquer|pourquoi|comment|developpe|développe|enseigne|enseignement|doctrine|analyse|analyser|synthese|synthèse)\b/i.test(queryLower);
  const isShortRequested = /\b(court|bref|brève|en 1 phrase|en deux mots|direct)\b/i.test(queryLower);

  let detailLevel: 'court' | 'detaill' | 'etude' = 'detaill'; // DÉTAILLÉ PAR DÉFAUT !
  if (isShortRequested) detailLevel = 'court';
  else if (isStudy) detailLevel = 'etude';
  else if (isExplain) detailLevel = 'detaill';

  // Phase B.1 : Désactivation du plafond artificiel à 2 passages déclenché par l'absence d'E5
  let effectiveEvidence = evidencePackage.evidence;
  const decisionJournal = evidencePackage.decisionJournal;
  const hasVectorSignal = evidencePackage.vectorMethod && evidencePackage.vectorMethod !== 'BM25_ONLY' && (decisionJournal?.topVectorScore ?? 0) > 0;
  
  // Le plafond de 2 passages ne s'applique que si le signal lexical ET vectoriel est quasi-nul (zone de refus avérée)
  const isLowConfidence = 
    detailLevel === 'court' && (
      decisionJournal?.zone === 'refusal' ||
      (hasVectorSignal && (decisionJournal?.topVectorScore ?? 0) < 0.25) ||
      ((decisionJournal?.topLexScore ?? 0) < 2)
    );

  if (isLowConfidence && effectiveEvidence.length > 2) {
    effectiveEvidence = effectiveEvidence.slice(0, 2);
  }

  // Ajustement du nombre de passages max et de la taille de sortie selon le niveau de détail
  const targetPassageCount = detailLevel === 'etude' ? 25 : detailLevel === 'detaill' ? 12 : 5;
  if (effectiveEvidence.length > targetPassageCount) {
    effectiveEvidence = effectiveEvidence.slice(0, targetPassageCount);
  }

  const effectivePackage: RetrievalEvidencePackage = {
    ...evidencePackage,
    evidence: effectiveEvidence
  };

  // Formatage déterministe du contexte documentaire
  const context = formatEvidenceContextForGemini(effectivePackage, query);
  const reqLines = extractRequestedLineCount(query);
  const lineInstruction = reqLines ? `\n\nCONSIGNE STRICTE DE LONGUEUR : L'utilisateur exige un résumé / résultat de sa demande en exactement ${reqLines} lignes. Rédige ta réponse de façon concise et synthétique en respectant rigoureusement la limite de ${reqLines} lignes.` : '';
  const promptContents = `${context}\n\n============================================================\nQUESTION DU CHERCHEUR (Niveau exigé : ${detailLevel.toUpperCase()}) :\n"${query}"${lineInstruction}`;

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

  // Configuration dynamique par Niveau de Détail (Phase B.2 & B.5)
  const effectiveTemperature = detailLevel === 'court' ? 0.2 : 0.35;
  const effectiveMaxOutputTokens = detailLevel === 'etude' ? 6000 : detailLevel === 'detaill' ? 3500 : 1500;

  const defaultSysInstruction = `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham et des Écritures.

DIRECTIVES DE RÉPONSE ET FORMAT STRICT (JSON) :
Tu dois impérativement renvoyer un objet JSON respectant le schéma avec les champs 'sources_suffisantes', 'reponse' et facultativement 'avertissement'.

1. DÉCISION DU CHAMP 'sources_suffisantes' (3 ÉTATS STRICTS) :
- Évalue si les extraits textuels fournis contiennent les éléments nécessaires pour traiter le sujet doctrinal, prophétique ou scripturaire de la question.
- Renvoyer "suffisantes" si les extraits fournis traitent pleinement et directement du sujet de la question.
- Renvoyer "partielles" si les extraits abordent le sujet de manière indirecte, incomplète, ou si de nombreux aspects doctrinaux importants de la question manquent dans les extraits reçus. (Dans ce cas, spécifie dans le champ 'avertissement' un message expliquant la couverture partielle).
- Renvoyer "insuffisantes" si le sujet est totalement absent des extraits, profane ou hors-domaine.

2. EN CAS DE REFUS (sources_suffisantes = "insuffisantes") :
- Rédige dans le champ 'reponse' un message très court de 2 phrases au maximum.
- Commence obligatoirement par : « Les textes disponibles ne traitent pas de ce sujet. »
- Si pertinent, ajoute une brève suggestion de reformulation ou de recherche orientée vers le Message.
- Ne dresse AUCUNE liste des thèmes des passages non pertinents reçus.
- N'inclus AUCUNE section "### Sources consultées" ni "### Pistes d'approfondissement".

3. EN CAS D'ACCEPTATION (sources_suffisantes = "suffisantes" ou "partielles") :
- Rédige une réponse substantielle, très bien développée, pédagogique et structurée.
- Contextualise chaque extrait (cadre historique, spirituel et doctrinal de la prédication ou du passage).
- Détailler minutieusement les arguments et le raisonnement du prédicateur / texte.
- Mentionne les exemples, illustrations et versets bibliques cités.
- Informations factuelles (lieu, date, personnes) : doivent IMPÉRATIVEMENT provenir d'un passage ou des métadonnées fournies. Sinon ne l'énonce pas.
- Structure obligatoirement ton exposé en deux grandes parties :
  ### Ce que disent les textes
  (Analyse détaillée, citations exactes avec leurs références [Réf: ID_SERMON, §N], explication du contexte)

  ### Synthèse & Enseignement
  (Synthèse doctrinale explicative. Ne recopie PAS les blocs de citations déjà donnés ci-dessus ; explique, relie les passages entre eux, et indique ce qui est explicite dans le texte et ce qui est interprétation. Toute affirmation de synthèse doit être étayée par une référence de paragraphe [Réf: ID_SERMON, §N] ou marquée explicitement comme "(interprétation)".)

- Termine obligatoirement par la section "### Passages consultés" listant UNIQUEMENT les paragraphes et documents réellement cités dans la réponse avec leurs numéros de paragraphes exacts [Réf: ID_SERMON, §N].
- Les "Pistes d'approfondissement" seront retournées dans le champ JSON séparé 'pistes_approfondissement' pour garantir zéro troncation.`;

  const sysInstruction = systemInstruction || defaultSysInstruction;

  const t0 = Date.now();

  try {
    const response = await client.generateContent({
      model,
      contents: promptContents,
      config: {
        systemInstruction: sysInstruction,
        temperature: effectiveTemperature,
        maxOutputTokens: effectiveMaxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sources_suffisantes: {
              type: Type.STRING,
              description: "Évalue la couverture : 'suffisantes' (sujet pleinement traité), 'partielles' (sujet abordé de façon parcellaire ou incomplète), ou 'insuffisantes' (sujet absent, profane ou hors-domaine)."
            },
            reponse: {
              type: Type.STRING,
              description: "Si 'suffisantes' ou 'partielles': étude théologique structurée en '### Ce que disent les textes', '### Synthèse & Enseignement', et '### Passages consultés'. Si 'insuffisantes': message court de 2 phrases max débutant par 'Les textes disponibles ne traitent pas de ce sujet.'"
            },
            avertissement: {
              type: Type.STRING,
              description: "Si sources_suffisantes='partielles', réclame ou propose un court avertissement expliquant la couverture partielle. Sinon, laisser vide ou null."
            },
            pistes_approfondissement: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Tableau de 2 à 3 questions de recherche complémentaires pertinentes."
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

    let coverageState: 'suffisantes' | 'partielles' | 'insuffisantes' = 'suffisantes';
    let sourcesSuffisantes = true;
    let finalAnswerText = responseText;
    let warningText: string | null = null;

    const parseJsonResult = (textStr: string): boolean => {
      try {
        const parsed = JSON.parse(textStr);
        if (typeof parsed?.sources_suffisantes === 'string') {
          const s = parsed.sources_suffisantes.toLowerCase();
          if (s.includes('partiel')) coverageState = 'partielles';
          else if (s.includes('insuffis') || s.includes('faux') || s.includes('false')) coverageState = 'insuffisantes';
          else coverageState = 'suffisantes';
        } else if (typeof parsed?.sources_suffisantes === 'boolean') {
          coverageState = parsed.sources_suffisantes ? 'suffisantes' : 'insuffisantes';
        }
        sourcesSuffisantes = (coverageState !== 'insuffisantes');
        if (typeof parsed?.reponse === 'string' && parsed.reponse.trim()) {
          finalAnswerText = parsed.reponse.trim();
        }
        if (typeof parsed?.avertissement === 'string' && parsed.avertissement.trim()) {
          warningText = parsed.avertissement.trim();
        }
        return true;
      } catch (_) {
        return false;
      }
    };

    let parseOk = parseJsonResult(responseText);
    if (!parseOk) {
      // Tenter de réparer le JSON tronqué
      let cleaned = responseText.trim();
      if (!cleaned.startsWith('{')) {
        const firstBrace = cleaned.indexOf('{');
        if (firstBrace !== -1) cleaned = cleaned.substring(firstBrace);
      }
      if (cleaned.startsWith('{')) {
        if (!cleaned.endsWith('}')) {
          cleaned = cleaned + '"}';
        }
        parseOk = parseJsonResult(cleaned);
        if (!parseOk) {
          cleaned = cleaned.substring(0, cleaned.length - 2) + '}';
          parseOk = parseJsonResult(cleaned);
        }
      }
    }

    if (!parseOk) {
      console.warn('[GenerationAdapter] JSON invalide, tentative de réessai de génération...');
      try {
        const retryResponse = await client.generateContent({
          model,
          contents: promptContents + "\n\nIMPORTANT : Réponds impérativement sous forme de JSON valide. Si tu n'y arrives pas, commence simplement ta réponse par 'TEXTE_BRUT:'.",
          config: {
            systemInstruction: sysInstruction,
            temperature: 0.1,
          }
        });
        const retryText = retryResponse?.text;
        if (retryText && retryText.trim()) {
          if (retryText.startsWith('TEXTE_BRUT:') || !retryText.includes('{')) {
            finalAnswerText = retryText.replace('TEXTE_BRUT:', '').trim();
            coverageState = 'suffisantes';
            sourcesSuffisantes = true;
            parseOk = true;
          } else {
            parseOk = parseJsonResult(retryText);
          }
        }
      } catch (retryErr) {
        console.warn('[GenerationAdapter] Échec du réessai de génération.', retryErr);
      }
    }

    if (!parseOk) {
      console.warn('[GenerationAdapter] Échec complet du parsing JSON, repli sur texte brut.');
      finalAnswerText = responseText;
      coverageState = 'suffisantes';
      sourcesSuffisantes = true;
    }

    // Si couverture insuffisante (refus Gemini propre)
    if ((coverageState as string) === 'insuffisantes') {
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

    // Si couverture partielle, injecter l'avertissement au début de la réponse
    if ((coverageState as string) === 'partielles') {
      const warnMsg = warningText || "Note : Les textes disponibles dans le corpus ne couvrent que partiellement cette question. Les éléments présentés ci-dessous s'appuient strictement sur les extraits disponibles.";
      if (!finalAnswerText.includes('⚠️')) {
        finalAnswerText = `⚠️ **Couverture partielle** : ${warnMsg}\n\n${finalAnswerText}`;
      }
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
