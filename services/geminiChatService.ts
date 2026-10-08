import { GoogleGenAI } from "@google/genai";
import { ChatMessage, RetrievalEvidencePackage } from '../types';
import { isOllamaAvailable, askOllamaChat, offlineLocalSearchAnalysis } from './ollamaService';
import { getGeminiApiKey, getAllGeminiApiKeys, extractAllApiKeys, cleanApiKey } from '../utils/apiKeyHelper';
import { RetrievedParagraph } from './sermonRagService';
import { aiConfig } from '../config/aiConfig';

export interface GeminiSource {
  title: string;
  uri: string;
  sermonId?: string;
  paragraphIndex?: number;
}

export interface GeminiResponse {
  text: string;
  sources: GeminiSource[];
  retrievedParagraphs?: RetrievedParagraph[];
  evidencePackage?: RetrievalEvidencePackage;
  engineUsed?: 'gemini' | 'ollama' | 'local_fallback';
  errorDetails?: {
    type: string;
    message: string;
  };
}

export interface AskGeminiChatOptions {
  mode?: 'auto-rag' | 'dock';
  retrievedParagraphs?: RetrievedParagraph[];
  evidencePackage?: RetrievalEvidencePackage;
  onStreamChunk?: (token: string) => void;
}

/**
 * Nettoie et masque de manière garantie toute occurrence de clé API ou token dans un texte ou message d'erreur
 */
export const sanitizeErrorText = (rawMessage: string): string => {
  if (!rawMessage) return "Une erreur est survenue.";
  return rawMessage
    .replace(/AIza[0-9A-Za-z-_]{10,}/gi, '[CLÉ_MASQUÉE]')
    .replace(/(?:key|token|api_key|apiKey)=([^&\s]+)/gi, '$1=[CLÉ_MASQUÉE]')
    .replace(/bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [TOKEN_MASQUÉ]');
};

/**
 * Catégorise avec précision les erreurs de l'API Google Gemini sans jamais exposer la clé
 */
export const classifyGeminiError = (error: any): { type: string; userMessage: string } => {
  const rawMsg = sanitizeErrorText(error?.message || String(error || ''));
  const status = error?.status || error?.statusCode;

  if (
    status === 400 || 
    rawMsg.includes('API_KEY_INVALID') || 
    rawMsg.includes('API key not valid') ||
    rawMsg.includes('INVALID_ARGUMENT')
  ) {
    return {
      type: 'API_KEY_INVALID',
      userMessage: 'La clé d\'accès saisie est invalide. Veuillez vérifier la clé collée dans la configuration IA.'
    };
  }

  if (
    status === 429 || 
    rawMsg.includes('429') || 
    rawMsg.includes('RESOURCE_EXHAUSTED') || 
    rawMsg.includes('QUOTA_EXHAUSTED') ||
    rawMsg.includes('quota') ||
    rawMsg.includes('limit')
  ) {
    const isDaily = rawMsg.includes('PerDay') || rawMsg.includes('per day') || rawMsg.includes('daily') || rawMsg.includes('Day');
    return {
      type: 'QUOTA_EXHAUSTED',
      userMessage: isDaily 
        ? "Le quota journalier gratuit de cette clé a été atteint pour aujourd'hui. Vous pouvez ajouter une seconde clé dans la configuration IA pour poursuivre sans interruption."
        : "Le quota de requêtes de cette clé est temporairement saturé. Si le message persiste, ajoutez une clé de secours dans la configuration IA."
    };
  }

  if (
    status === 403 || 
    rawMsg.includes('PERMISSION_DENIED') || 
    rawMsg.includes('The caller does not have permission')
  ) {
    return {
      type: 'PERMISSION_DENIED',
      userMessage: "Accès non autorisé ou service d'analyse IA non activé sur cette clé."
    };
  }

  if (
    status === 404 || 
    rawMsg.includes('NOT_FOUND') || 
    rawMsg.includes('is not found')
  ) {
    return {
      type: 'MODEL_UNAVAILABLE',
      userMessage: "Le service d'analyse n'est pas accessible avec cette clé."
    };
  }

  if (
    status === 503 || 
    rawMsg.includes('503') || 
    rawMsg.includes('UNAVAILABLE') || 
    rawMsg.includes('high demand')
  ) {
    return {
      type: 'SERVICE_UNAVAILABLE',
      userMessage: "Les serveurs d'analyse subissent une forte affluence temporaire (Erreur 503). Veuillez patienter quelques secondes et relancer."
    };
  }

  if (
    rawMsg.includes('Failed to call the Gemini API') ||
    rawMsg.includes('fetch failed') || 
    rawMsg.includes('NetworkError') || 
    rawMsg.includes('Failed to fetch') ||
    !navigator.onLine
  ) {
    return {
      type: 'NETWORK_ERROR',
      userMessage: 'Impossible de joindre les serveurs d\'analyse (connexion réseau interrompue ou bloquée).'
    };
  }

  return {
    type: 'GENERIC_API_ERROR',
    userMessage: `Erreur du service d'analyse IA : ${rawMsg.slice(0, 150)}`
  };
};

export const CANDIDATE_MODELS = aiConfig.models.fastFailoverCascade;

/**
 * Test explicite de la clé API Gemini en envoyant une micro-requête minimale sans aucun outil externe.
 * Déclenché STRICTEMENT au clic de l'utilisateur sur le bouton "Tester la connexion".
 * Ne journalise et n'affiche jamais la clé.
 */
export const testGeminiApiKey = async (
  apiKeyToTest: string
): Promise<{ success: boolean; message: string; errorType?: string }> => {
  const keys = extractAllApiKeys(apiKeyToTest);

  if (keys.length === 0) {
    return {
      success: false,
      message: "La clé saisie semble vide ou trop courte (une clé Google commence généralement par 'AIzaSy...').",
      errorType: 'INVALID_FORMAT'
    };
  }

  if (!navigator.onLine) {
    return {
      success: false,
      message: "Votre appareil est actuellement hors-ligne. Veuillez vérifier votre connexion Internet avant de tester.",
      errorType: 'OFFLINE'
    };
  }

  let lastError: any = null;
  let validatedKeyCount = 0;

  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const key = keys[keyIdx];
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      
      for (const model of CANDIDATE_MODELS) {
        try {
          const response = await ai.models.generateContent({
            model: model,
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
            config: {
              maxOutputTokens: 2,
              temperature: 0.1
            }
          });

          if (response && (response.text || response.candidates?.length)) {
            validatedKeyCount++;
            return {
              success: true,
              message: keys.length > 1 
                ? `Connexion réussie ! ${keys.length} clé(s) active(s) configurée(s) (modèle opérationnel : ${model}).`
                : `Connexion réussie ! Votre clé d'accès est active et opérationnelle.`
            };
          }
        } catch (modelErr: any) {
          lastError = modelErr;
          const cl = classifyGeminiError(modelErr);
          if (cl.type === 'API_KEY_INVALID') {
            break;
          }
        }
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  const classified = classifyGeminiError(lastError);
  return {
    success: false,
    message: classified.userMessage,
    errorType: classified.type
  };
};

const callWithRetry = async (fn: () => Promise<any>, maxRetries = 1, delay = 1500) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const classified = classifyGeminiError(error);
      // Erreurs permanentes ne nécessitant pas de retry
      if (classified.type === 'API_KEY_INVALID' || classified.type === 'PERMISSION_DENIED' || classified.type === 'MODEL_UNAVAILABLE') {
        throw error;
      }
      // Pour les erreurs de saturation temporaire (429 rate-limit ou 503 affluence), patienter brièvement et retenter 1 fois
      if (i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
};

export const askGeminiChat = async (
  prompt: string,
  contextText: string,
  history: ChatMessage[],
  options: AskGeminiChatOptions = {}
): Promise<GeminiResponse> => {
  const availableKeys = getAllGeminiApiKeys();
  const apiKey = availableKeys[0];
  const isAutoRag = options.mode === 'auto-rag' || (options.retrievedParagraphs && options.retrievedParagraphs.length > 0) || !!options.evidencePackage;

  // Si un package d'Evidence indique que la question n'est pas couverte (abstention)
  if (options.evidencePackage && !options.evidencePackage.answerable) {
    return {
      text: "Les documents disponibles dans la base documentaire de l'application ne contiennent pas d'informations suffisantes pour répondre à cette question.",
      sources: [],
      evidencePackage: options.evidencePackage,
      engineUsed: 'gemini'
    };
  }

  // 1. Si au moins une clé est présente et que nous sommes en ligne : tentative prioritaire avec Gemini Cloud
  // RÈGLE STRICTE : AUCUNE RECHERCHE WEB GOOGLE (googleSearch désactivé). Réponses fondées exclusivement sur les sources internes.
  if (availableKeys.length > 0 && navigator.onLine) {
    let lastKeyError: any = null;

    let systemInstruction = '';
    let userPromptWithContext = '';

    if (isAutoRag) {
      systemInstruction = `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham et de l'Exposé des Sept Âges.

DIRECTIVES STRICTES DE RÉPONSE FONDÉE EXCLUSIVEMENT SUR LES SOURCES FOURNIES DANS L'APPLICATION :
1. Réponds à la question posée en te basant EXCLUSIVEMENT sur les extraits de sermons et documents fournis ci-dessous.
2. Si les extraits couvrent plusieurs dates ou documents, structure ton exposé selon la progression chronologique et prophétique de l'enseignement au fil des ans.
3. N'extrapole pas, n'utilise AUCUNE source web externe, et n'invente aucune doctrine ou interprétation qui ne figure pas expressément dans ces extraits.
4. Pour chaque affirmation ou citation tirée d'un extrait, insère obligatoirement la référence exacte au format :
   > « ... » [Réf: ID_SERMON, Para. N]
   (Exemple : > « Le premier sceau a été ouvert... » [Réf: 63-0324M, Para. 2] ou [Réf: expose-ch-4, §12])
5. N'invente JAMAIS d'identifiant de sermon ni de numéro de paragraphe. Utilise UNIQUEMENT les références fournies dans le texte source.
6. Si les extraits fournis ne contiennent pas d'éléments suffisants pour répondre à la question, réponds très exactement :
   « Les documents disponibles dans la base documentaire de l'application ne contiennent pas d'informations suffisantes pour répondre à cette question. »
7. Regroupe toujours en fin de réponse une section "### Sources consultées" listant clairement les sermons et paragraphes cités.
8. Ajoute ensuite une section "### Pistes d'approfondissement" proposant 2 à 3 questions d'étude biblique pertinentes.`;

      userPromptWithContext = `${contextText.substring(0, aiConfig.models.dockMaxChars)}

============================================================
QUESTION DU CHERCHEUR :
"${prompt}"`;
    } else {
      systemInstruction = `Tu es l'assistant d'étude et de recherche théologique de King's Sword, doté d'une rigueur d'analyse et d'une profondeur comparables aux meilleurs outils de recherche exégétique.
    
DIRECTIVES STRICTES DE RÉPONSE FONDÉE EXCLUSIVEMENT SUR LES SOURCES DE L'APPLICATION :
1. Tes réponses doivent provenir EXCLUSIVEMENT des documents sources fournis dans le contexte ci-dessous (sermons, passages bibliques, Dock IA). N'utilise aucune source web externe.
2. Si plusieurs sermons ou documents sont présents, mets en valeur la continuité chronologique et prophétique entre les périodes.
3. Séparation claire du contenu et des sources : Ne mélange jamais les références ou les numéros de paragraphe dans les phrases du corps du texte.
4. Pour les passages bibliques cités : Présente la citation dans un bloc (> « ... ») suivi immédiatement de la référence exacte (ex : **Genèse 2:5 — LSG 1910**).
5. Pour les enseignements/sermons cités : Présente la citation dans un bloc (> « ... ») suivi de **Source :** *Titre du Sermon* — Date, §N.
6. Analyse et prends en compte l'ENSEMBLE de toutes les ressources fournies dans le contexte ci-dessous sans te limiter aux premières.
7. Regroupe toujours en fin de réponse une section "### Sources" numérotée ([1], [2]...) listant clairement les références utilisées.
8. Termine par une section "### Pistes d'approfondissement" proposant 2 à 3 questions de recherche complémentaires.`;

      userPromptWithContext = `DOCUMENTS SOURCES FOURNIS DANS L'APPLICATION (Dock IA / Sermons actifs) :
============================================================
${contextText.substring(0, aiConfig.models.dockMaxChars)}
============================================================

CONSIGNES :
1. Réponds à la question en te basant rigoureusement et exclusivement sur les documents ci-dessus.
2. Inclus des citations textuelles exactes sous la forme : > "Citation..." [Réf: ID_DOC, Para. N]
3. Si la question nécessite un croisement entre plusieurs sermons ou écritures, mets en évidence les liens prophétiques et l'harmonie des messages.

QUESTION DU CHERCHEUR :
"${prompt}"`;
    }

    // Nettoyer et alléger l'historique pour ne pas gaspiller de tokens
    const cleanHistory = history
      .filter(h => !h.content.startsWith('❌') && !h.content.startsWith('> ⏱️') && !h.content.startsWith('> ⚠️') && !h.content.startsWith('> ℹ️'))
      .slice(-2)
      .map(h => ({ 
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content.substring(0, 500) }]
      }));

    const contents = [
      ...cleanHistory,
      {
        role: 'user',
        parts: [{ text: userPromptWithContext }]
      }
    ];

    // Configuration pure sans aucun outil externe (aucun googleSearch)
    const config: any = { 
      systemInstruction,
      temperature: isAutoRag ? aiConfig.models.autoRagTemperature : aiConfig.models.dockTemperature
    };

    let successfulResponse: any = null;

    for (let keyIdx = 0; keyIdx < availableKeys.length; keyIdx++) {
      const currentKey = availableKeys[keyIdx];
      try {
        const ai = new GoogleGenAI({ apiKey: currentKey });
        
        for (const model of CANDIDATE_MODELS) {
          try {
            if (typeof options.onStreamChunk === 'function') {
              const streamRes = await ai.models.generateContentStream({
                model: model,
                contents: contents,
                config
              });
              let fullText = '';
              for await (const chunk of streamRes) {
                const chunkText = chunk.text || '';
                if (chunkText) {
                  fullText += chunkText;
                  options.onStreamChunk(chunkText);
                }
              }
              successfulResponse = { text: fullText };
            } else {
              successfulResponse = await callWithRetry(() => ai.models.generateContent({
                model: model,
                contents: contents,
                config
              }));
            }

            if (successfulResponse && (successfulResponse.text || successfulResponse.candidates?.length)) {
              break;
            }
          } catch (err: any) {
            lastKeyError = err;
            const cl = classifyGeminiError(err);
            // Si l'erreur est liée au quota ou modèle temporairement inaccessible ou restreint régionalement, essayer le modèle suivant
            if (cl.type === 'QUOTA_EXHAUSTED' || cl.type === 'MODEL_UNAVAILABLE' || cl.type === 'SERVICE_UNAVAILABLE' || cl.type === 'PERMISSION_DENIED') {
              continue;
            }
            // Pour les erreurs de clé invalide, passer à la clé suivante
            break;
          }
        }

        if (successfulResponse && (successfulResponse.text || successfulResponse.candidates?.length)) {
          break;
        }
      } catch (err: any) {
        lastKeyError = err;
      }
    }

    if (successfulResponse && (successfulResponse.text || successfulResponse.candidates?.length)) {
      const text = successfulResponse.text || "Aucune réponse générée.";
      const sources: GeminiSource[] = [];

      if (options.evidencePackage && options.evidencePackage.evidence.length > 0) {
        options.evidencePackage.evidence.forEach(ev => {
          ev.citationParagraphs.forEach(cp => {
            sources.push({
              title: `${ev.sermonTitle} (${ev.date || 'Non daté'}) — §${cp.paragraphIndex}`,
              uri: `sermon://${ev.sermonId}/${cp.paragraphIndex}`,
              sermonId: ev.sermonId,
              paragraphIndex: cp.paragraphIndex
            });
          });
        });
      } else if (options.retrievedParagraphs && options.retrievedParagraphs.length > 0) {
        options.retrievedParagraphs.forEach(p => {
          sources.push({
            title: `${p.title} (${p.date || 'Non daté'}) — §${p.paragraphIndex}`,
            uri: `sermon://${p.sermonId}/${p.paragraphIndex}`,
            sermonId: p.sermonId,
            paragraphIndex: p.paragraphIndex
          });
        });
      }

      return { 
        text, 
        sources,
        retrievedParagraphs: options.retrievedParagraphs,
        evidencePackage: options.evidencePackage,
        engineUsed: 'gemini'
      };
    }

    if (lastKeyError) {
      const classified = classifyGeminiError(lastKeyError);

      // Si le quota Google est temporairement saturé ou que les serveurs sont occupés,
      // mais que le moteur RAG local a déjà trouvé les extraits exacts des sermons :
      // On affiche directement ces extraits locaux à l'utilisateur pour ne pas bloquer son étude !
      if ((classified.type === 'QUOTA_EXHAUSTED' || classified.type === 'SERVICE_UNAVAILABLE') && options.retrievedParagraphs && options.retrievedParagraphs.length > 0) {
        let fallbackText = `> ⏱️ **Information Quota d'analyse** : *${classified.userMessage}*\n\n*Voici les extraits exacts sélectionnés directement dans vos sermons locaux pour votre question :*\n\n`;

        options.retrievedParagraphs.forEach((p, idx) => {
          fallbackText += `### Extrait ${idx + 1} : *${p.title}* (${p.date || 'Non daté'}) — §${p.paragraphIndex}\n`;
          fallbackText += `> « ${p.content} » [Réf: ${p.sermonId}, Para. ${p.paragraphIndex}]\n\n`;
        });

        fallbackText += `\n---\n*💡 Astuce : Vous pouvez ajouter une seconde clé dans la fenêtre "Clé Active" pour basculer dessus automatiquement en cas de saturation de quota.*`;

        const sources: GeminiSource[] = options.retrievedParagraphs.map(p => ({
          title: `${p.title} (${p.date || 'Non daté'}) — §${p.paragraphIndex}`,
          uri: `sermon://${p.sermonId}/${p.paragraphIndex}`,
          sermonId: p.sermonId,
          paragraphIndex: p.paragraphIndex
        }));

        return {
          text: fallbackText,
          sources,
          retrievedParagraphs: options.retrievedParagraphs,
          engineUsed: 'local_fallback',
          errorDetails: {
            type: classified.type,
            message: classified.userMessage
          }
        };
      }

      if (classified.type === 'API_KEY_INVALID' || classified.type === 'PERMISSION_DENIED') {
        return {
          text: `❌ **Erreur de clé d'accès IA**\n\n${classified.userMessage}\n\n*Pour vérifier votre clé, cliquez sur "Clé Active" en haut de l'Assistant IA.*`,
          sources: [],
          engineUsed: 'gemini',
          errorDetails: {
            type: classified.type,
            message: classified.userMessage
          }
        };
      }

      console.warn("Panne réseau ou saturation quota, passage au secours local:", classified.type);
    }
  }

  // 2. Si le service est hors-ligne ou injoignable, tester le serveur local si présent
  try {
    const ollamaActive = await isOllamaAvailable();
    if (ollamaActive) {
      const ollamaRes = await askOllamaChat(prompt, contextText, history);
      const fallbackSources: GeminiSource[] = options.retrievedParagraphs && options.retrievedParagraphs.length > 0
        ? options.retrievedParagraphs.map(p => ({
            title: `${p.title} (${p.date || 'Non daté'}) — §${p.paragraphIndex}`,
            uri: `sermon://${p.sermonId}/${p.paragraphIndex}`,
            sermonId: p.sermonId,
            paragraphIndex: p.paragraphIndex
          }))
        : (ollamaRes.sources || [{ title: 'Moteur Local Hors-Ligne', uri: 'local://ollama' }]);

      return {
        text: `> ℹ️ **Mode Local** : *Réponse générée par votre serveur local.*\n\n${ollamaRes.text}`,
        sources: fallbackSources,
        retrievedParagraphs: options.retrievedParagraphs,
        engineUsed: 'ollama'
      };
    }
  } catch (ollamaErr) {
    console.warn("Moteur local non joignable:", ollamaErr);
  }

  // 3. Fallback d'analyse locale textuelle 100% autonome
  let lastReason = "";
  if (apiKey) {
    lastReason = " (Serveurs occupés ou micro-coupure réseau temporaire)";
  }

  const localAnalysis = offlineLocalSearchAnalysis(prompt, contextText);
  const fallbackSources: GeminiSource[] = options.retrievedParagraphs && options.retrievedParagraphs.length > 0
    ? options.retrievedParagraphs.map(p => ({
        title: `${p.title} (${p.date || 'Non daté'}) — §${p.paragraphIndex}`,
        uri: `sermon://${p.sermonId}/${p.paragraphIndex}`,
        sermonId: p.sermonId,
        paragraphIndex: p.paragraphIndex
      }))
    : (localAnalysis.sources || [{ title: 'Index Local Hors-Ligne', uri: 'local://search' }]);

  const notice = !apiKey 
    ? `> ℹ️ **Mode Index Local** : *Aucune clé d'accès configurée. Analyse produite par l'index documentaire local.* (Cliquez sur "Activer IA" en haut pour configurer une clé)\n\n`
    : `> ℹ️ **Mode Secours Local** : *Connexion au service d'analyse indisponible${lastReason}. Analyse produite automatiquement par le moteur local pour ne pas bloquer votre recherche.*\n\n`;

  return {
    text: `${notice}${localAnalysis.text}`,
    sources: fallbackSources,
    retrievedParagraphs: options.retrievedParagraphs,
    engineUsed: 'local_fallback'
  };
};
