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
  history?: ChatMessage[];
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
    model = 'gemini-3.8-flash',
    history = []
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

  // Phase B.1 : Exploitation généreuse des preuves documentaires
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

  // Ajustement généreux du nombre de passages max selon le niveau de détail
  const targetPassageCount = detailLevel === 'etude' ? 35 : detailLevel === 'court' ? 6 : 22;
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

  // Configuration dynamique par Niveau de Détail : budget généreux de tokens pour éviter toute condensation
  const effectiveTemperature = detailLevel === 'court' ? 0.2 : 0.35;
  const effectiveMaxOutputTokens = detailLevel === 'court' ? 2000 : 8192;

  const defaultSysInstruction = `Tu es l'assistant d'étude théologique de King's Sword, doté de la rigueur, de la profondeur d'analyse et de la capacité de raisonnement des systèmes d'IA les plus avancés (comme Google NotebookLM, Claude ou ChatGPT), expert des sermons de William Marrion Branham, de l'Exposé des Sept Âges et des Saintes Écritures.

DIRECTIVES FONDAMENTALES DE RAISONNEMENT, D'EXÉGÈSE ET FORMAT STRICT (JSON) :
Tu dois impérativement renvoyer un objet JSON respectant le schéma avec les champs 'sources_suffisantes', 'reponse' et facultativement 'avertissement', 'pistes_approfondissement'.

1. DÉCISION DU CHAMP 'sources_suffisantes' (EXPLOITATION MAXIMALE DU CORPUS) :
- Ton devoir d'assistant de recherche est d'exploiter TOUT ce qui est présent dans les extraits textuels fournis pour instruire, éclairer et nourrir la réflexion du chercheur.
- Renvoyer "suffisantes" si les extraits fournis traitent directement et amplement du sujet demandé.
- Renvoyer "partielles" si le sujet est abordé de manière indirecte, sous l'angle de principes spirituels plus larges, ou si certains aspects manquent dans les extraits reçus (par exemple : si la question porte sur un aspect pratique comme « la gestion des finances dans un couple », et que les extraits disponibles abordent les richesses matérielles de Laodicée, la foi, l'intendance, la mise en garde contre l'amour de l'argent, ou les rôles spirituels). Dans ce cas, NE REFUSE EN AUCUN CAS LA QUESTION : qualifie la couverture de "partielles", analyse en profondeur ces principes, cite tous les extraits pertinents et explique leur portée spirituelle.
- Renvoyer "insuffisantes" UNIQUEMENT si la requête est totalement étrangère au domaine spirituel, prophétique et biblique (sujet profane sans aucun rapport comme une recette de cuisine, du code informatique, etc.) et qu'aucun extrait fourni ne contient le moindre principe scripturaire exploitable.

2. EN CAS DE COUVERTURE PARTIELLE OU PRINCIPES CONNEXES (sources_suffisantes = "partielles") :
- NE JAMAIS expédier la réponse avec un refus laconique de deux phrases. Déploie au contraire une étude théologique substantielle, développée et pédagogique.
- Explique avec clarté et discernement ce que les textes fournis contiennent : expose ce qui est directement affirmé dans les extraits disponibles, et dégage avec rigueur les principes spirituels, éthiques et bibliques applicables.
- Inclus OBLIGATOIREMENT des blocs de citations textuelles exactes des extraits fournis avec leur référence : > « ... » [Réf: ID_SERMON, §N].
- Si le sujet spécifique fait l'objet de prédications majeures de William Marrion Branham non encore chargées dans la sélection active (par exemple pour le couple et la famille : « Le Mariage et le Divorce », « Questions et Réponses », « La Conduite, l'Ordre et la Doctrine de l'Église »), mentionne explicitement ces sermons de référence pour guider l'étudiant et lui suggérer de les importer dans l'application.

3. DÉVELOPPEMENT MAGISTRAL ET CITATIONS OBLIGATOIRES (sources_suffisantes = "suffisantes" ou "partielles") :
- RAISONNEMENT PROFOND ET DÉVELOPPÉ : Déploie une explication magistrale, très détaillée, pédagogique et structurée en profondeur (comme une note de synthèse approfondie de NotebookLM). Ne condense JAMAIS artificiellement tes explications.
- SUITE DE DISCUSSION & MULTI-TURN : Si cette question fait suite à un échange précédent (question de relance, demande d'approfondissement, clarification), prends pleinement en compte l'historique de la conversation, assure une continuité sans faille, et réponds précisément dans le prolongement de ce qui a été dit tout en restant rigoureusement fondé sur les documents fournis.
- CITATIONS TEXTUELLES INTÉGRALES INDISPENSABLES : Chaque point doctrinal, argument spirituel ou principe DOIT IMPÉRATIVEMENT être étayé par une ou plusieurs citations textuelles authentiques en bloc sous la forme :
  > « Extrait textuel exact du sermon ou passage... » [Réf: ID_SERMON, §N]
- EXÉGÈSE ET ANALYSE DE CHAQUE EXTRAIT : Pour chaque citation, analyse en détail le contexte de la prédication (date, lieu), la pensée de William Marrion Branham ou du passage biblique, et démontre l'harmonie avec les autres sermons et l'Exposé.
- Structure recommandée de l'étude dans le champ 'reponse' :
  ## [Titre du thème étudié]
  ### Introduction & Fondement
  (Cadre historique et scripturaire, mise en perspective avec le corpus disponible)

  ### Développement doctrinal & Analyse approfondie des citations
  (Exposé substantiel section par section, intégrant systématiquement des blocs de citations exactes > « ... » [Réf: ID_SERMON, §N] immédiatement suivis de leur commentaire théologique et prophétique détaillé)

  ### Synthèse spirituelle & Application pratique
  (Harmonie doctrinale, principes d'intendance, de foi et de conduite pour l'Épouse du Seigneur Jésus-Christ)

  ### Sermons de référence conseillés (si pertinent)
  (Mention des titres de prédications majeures de William Branham pour approfondir si le sujet dépasse le corpus actuellement actif)

  ### Passages consultés
  (Liste des références exactes [Réf: ID_SERMON, §N] citées dans la réponse)

4. EN CAS D'INSUFFISANCE TOTALE (sources_suffisantes = "insuffisantes", réservé aux sujets profanes/hors-domaine) :
- Rédige un message clair et bienveillant expliquant pourquoi la requête ne relève pas des ressources spirituelles et scripturaires disponibles.

- 'pistes_approfondissement' : Retourne 2 à 3 questions d'étude biblique pertinentes et stimulantes dans le champ JSON séparé.`;

  const sysInstruction = systemInstruction || defaultSysInstruction;

  // Préparation du payload multi-tours pour Gemini si un historique est disponible
  let contentsPayload: any;
  if (Array.isArray(history) && history.length > 0) {
    const cleanHistory = history
      .filter(h => h.content && !h.content.startsWith('❌') && !h.content.startsWith('> ⏱️') && !h.content.startsWith('🔍 **Aucun passage'))
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

  try {
    const response = await client.generateContent({
      model,
      contents: contentsPayload,
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
              description: "Évalue la couverture : 'suffisantes' (sujet directement traité), 'partielles' (sujet abordé via des principes spirituels connexes, ou corpus restreint), ou 'insuffisantes' (sujet totalement profane ou hors-domaine spirituel)."
            },
            reponse: {
              type: Type.STRING,
              description: "Si 'suffisantes' ou 'partielles': étude théologique approfondie structurée avec citations exactes > « ... » [Réf: ID, §N], analyse et synthèse. Si 'insuffisantes': explication claire et courtoise."
            },
            avertissement: {
              type: Type.STRING,
              description: "Si sources_suffisantes='partielles', message précisant la portée des extraits disponibles et les principes dégagés. Sinon, laisser vide ou null."
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
