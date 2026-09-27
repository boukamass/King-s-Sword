import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { isOllamaAvailable, askOllamaChat, offlineLocalSearchAnalysis } from './ollamaService';
import { getGeminiApiKey, cleanApiKey } from '../utils/apiKeyHelper';
import { RetrievedParagraph } from './sermonRagService';

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
  engineUsed?: 'gemini' | 'ollama' | 'local_fallback';
  errorDetails?: {
    type: string;
    message: string;
  };
}

export interface AskGeminiChatOptions {
  mode?: 'auto-rag' | 'dock';
  retrievedParagraphs?: RetrievedParagraph[];
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
      userMessage: 'La clé API Google Gemini saisie est invalide ou non reconnue par Google AI Studio. Veuillez vérifier la clé collée dans la configuration.'
    };
  }

  if (
    status === 429 || 
    rawMsg.includes('429') || 
    rawMsg.includes('RESOURCE_EXHAUSTED') || 
    rawMsg.includes('QUOTA_EXHAUSTED') ||
    rawMsg.includes('quota')
  ) {
    return {
      type: 'QUOTA_EXHAUSTED',
      userMessage: 'Le quota de requêtes de votre clé Google Gemini est temporairement saturé. Veuillez patienter une minute avant de réessayer.'
    };
  }

  if (
    status === 403 || 
    rawMsg.includes('PERMISSION_DENIED') || 
    rawMsg.includes('The caller does not have permission')
  ) {
    return {
      type: 'PERMISSION_DENIED',
      userMessage: "Accès non autorisé ou API Google Generative Language non activée sur votre compte/projet Google Cloud."
    };
  }

  if (
    status === 404 || 
    rawMsg.includes('NOT_FOUND') || 
    rawMsg.includes('is not found')
  ) {
    return {
      type: 'MODEL_UNAVAILABLE',
      userMessage: "Le modèle sélectionné n'est pas accessible avec cette clé sur cette région géographique."
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
      userMessage: "Les serveurs de Google Gemini subissent une forte affluence temporaire (Erreur 503). Veuillez patienter quelques secondes et relancer."
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
      userMessage: 'Impossible de joindre les serveurs Google (connexion réseau interrompue ou bloquée).'
    };
  }

  return {
    type: 'GENERIC_API_ERROR',
    userMessage: `Erreur API Google Gemini : ${rawMsg.slice(0, 150)}`
  };
};

const CANDIDATE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

/**
 * Test explicite de la clé API Gemini en envoyant une micro-requête minimale sans aucun outil externe.
 * Déclenché STRICTEMENT au clic de l'utilisateur sur le bouton "Tester la connexion".
 * Ne journalise et n'affiche jamais la clé.
 */
export const testGeminiApiKey = async (
  apiKeyToTest: string
): Promise<{ success: boolean; message: string; errorType?: string }> => {
  const cleanedKey = cleanApiKey(apiKeyToTest);

  if (!cleanedKey || cleanedKey.length < 8) {
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

  try {
    const ai = new GoogleGenAI({ apiKey: cleanedKey });
    
    // Essayer les modèles candidats
    let lastError: any = null;
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
          return {
            success: true,
            message: `Connexion réussie ! Votre clé Google Gemini (${model}) est active et opérationnelle.`
          };
        }
      } catch (err: any) {
        lastError = err;
        const cl = classifyGeminiError(err);
        if (cl.type === 'API_KEY_INVALID' || cl.type === 'PERMISSION_DENIED') {
          throw err;
        }
      }
    }

    if (lastError) throw lastError;

    return {
      success: true,
      message: "Connexion établie avec succès avec Google AI Studio."
    };
  } catch (error: any) {
    const classified = classifyGeminiError(error);
    return {
      success: false,
      message: classified.userMessage,
      errorType: classified.type
    };
  }
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
  const apiKey = getGeminiApiKey();
  const isAutoRag = options.mode === 'auto-rag' || (options.retrievedParagraphs && options.retrievedParagraphs.length > 0);

  // 1. Si une clé est présente et que nous sommes en ligne : tentative prioritaire avec Gemini Cloud
  // RÈGLE STRICTE : AUCUNE RECHERCHE WEB GOOGLE (googleSearch désactivé). Réponses fondées exclusivement sur les sources internes.
  if (apiKey && navigator.onLine) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      let systemInstruction = '';
      let userPromptWithContext = '';

      if (isAutoRag) {
        systemInstruction = `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham.

DIRECTIVES STRICTES DE RÉPONSE FONDÉE EXCLUSIVEMENT SUR LES SOURCES FOURNIES DANS L'APPLICATION :
1. Réponds à la question posée en te basant EXCLUSIVEMENT sur les extraits de sermons et documents fournis ci-dessous.
2. N'extrapole pas, n'utilise AUCUNE source web externe, et n'invente aucune doctrine ou interprétation qui ne figure pas expressément dans ces extraits.
3. Pour chaque affirmation ou citation tirée d'un extrait, insère obligatoirement la référence exacte au format :
   > « ... » [Réf: ID_SERMON, Para. N]
   (Exemple : > « Le premier sceau a été ouvert... » [Réf: 63-0324M, Para. 2])
4. N'invente JAMAIS d'identifiant de sermon ni de numéro de paragraphe. Utilise UNIQUEMENT les références fournies dans le texte source.
5. Si les extraits fournis ne contiennent pas d'éléments suffisants pour répondre à la question, réponds très exactement :
   « Les documents disponibles dans la base documentaire de l'application ne contiennent pas d'informations suffisantes pour répondre à cette question. »
6. Regroupe toujours en fin de réponse une section "### Sources consultées" listant clairement les sermons et paragraphes cités.`;

        userPromptWithContext = `${contextText.substring(0, 25000)}

============================================================
QUESTION DU CHERCHEUR :
"${prompt}"`;
      } else {
        systemInstruction = `Tu es l'assistant d'étude et de recherche théologique de King's Sword, doté d'une rigueur d'analyse et d'une profondeur comparables aux meilleurs outils de recherche exégétique.
      
DIRECTIVES STRICTES DE RÉPONSE FONDÉE EXCLUSIVEMENT SUR LES SOURCES DE L'APPLICATION :
1. Tes réponses doivent provenir EXCLUSIVEMENT des documents sources fournis dans le contexte ci-dessous (sermons, passages bibliques, Dock IA). N'utilise aucune source web externe.
2. Séparation claire du contenu et des sources : Ne mélange jamais les références ou les numéros de paragraphe dans les phrases du corps du texte.
3. Pour les passages bibliques cités : Présente la citation dans un bloc (> « ... ») suivi immédiatement de la référence exacte (ex : **Genèse 2:5 — LSG 1910**).
4. Pour les enseignements/sermons cités : Présente la citation dans un bloc (> « ... ») suivi de **Source :** *Titre du Sermon* — Date, §N.
5. Regroupe toujours en fin de réponse une section "### Sources" numérotée ([1], [2]...) listant clairement les références utilisées.`;

        userPromptWithContext = `DOCUMENTS SOURCES FOURNIS DANS L'APPLICATION (Dock IA / Sermons actifs) :
============================================================
${contextText.substring(0, 25000)}
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
        .filter(h => !h.content.startsWith('❌') && !h.content.startsWith('> ⏱️') && !h.content.startsWith('> ⚠️'))
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
        temperature: isAutoRag ? 0.2 : 0.4
      };

      let response: any = null;
      let lastModelError: any = null;

      for (const model of CANDIDATE_MODELS) {
        try {
          response = await callWithRetry(() => ai.models.generateContent({
            model: model,
            contents: contents,
            config
          }));
          if (response && (response.text || response.candidates?.length)) {
            break;
          }
        } catch (err: any) {
          lastModelError = err;
          const cl = classifyGeminiError(err);
          // Si l'erreur est liée au quota ou modèle temporairement inaccessible, essayer le modèle suivant
          if (cl.type === 'QUOTA_EXHAUSTED' || cl.type === 'MODEL_UNAVAILABLE' || cl.type === 'SERVICE_UNAVAILABLE') {
            continue;
          }
          // Pour les erreurs de clé invalide ou permissions, propager immédiatement
          throw err;
        }
      }

      if (!response && lastModelError) {
        throw lastModelError;
      }
      
      const text = response?.text || "Aucune réponse générée.";
      const sources: GeminiSource[] = [];

      if (options.retrievedParagraphs && options.retrievedParagraphs.length > 0) {
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
        engineUsed: 'gemini'
      };
    } catch (error: any) {
      const classified = classifyGeminiError(error);

      // Si le quota Google est temporairement saturé ou que les serveurs sont occupés,
      // mais que le moteur RAG local a déjà trouvé les extraits exacts des sermons :
      // On affiche directement ces extraits locaux à l'utilisateur pour ne pas bloquer son étude !
      if ((classified.type === 'QUOTA_EXHAUSTED' || classified.type === 'SERVICE_UNAVAILABLE') && options.retrievedParagraphs && options.retrievedParagraphs.length > 0) {
        let fallbackText = `> ⏱️ **Information Quota Google AI Studio** : *La limite de requêtes par minute de votre clé gratuite est temporairement atteinte. Pour ne pas interrompre votre étude, voici les extraits exacts sélectionnés directement dans vos sermons locaux pour votre question :*\n\n`;

        options.retrievedParagraphs.forEach((p, idx) => {
          fallbackText += `### Extrait ${idx + 1} : *${p.title}* (${p.date || 'Non daté'}) — §${p.paragraphIndex}\n`;
          fallbackText += `> « ${p.content} » [Réf: ${p.sermonId}, Para. ${p.paragraphIndex}]\n\n`;
        });

        fallbackText += `\n---\n*💡 Astuce : Dès que la minute s'écoule, vous pouvez renvoyer votre question pour obtenir une exégèse rédigée complète par Gemini.*`;

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

      if (classified.type === 'API_KEY_INVALID' || classified.type === 'PERMISSION_DENIED' || classified.type === 'QUOTA_EXHAUSTED') {
        return {
          text: `❌ **Erreur d'accès à Google Gemini**\n\n${classified.userMessage}\n\n*Pour vérifier votre clé, cliquez sur l'icône de clé en haut de l'Assistant IA.*`,
          sources: [],
          engineUsed: 'gemini',
          errorDetails: {
            type: classified.type,
            message: classified.userMessage
          }
        };
      }

      console.warn("Panne réseau ou indisponibilité temporaire Gemini, passage au secours local:", classified.type);
    }
  }

  // 2. Si Gemini est hors-ligne ou injoignable, tester Ollama local (signalé explicitement)
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
        : (ollamaRes.sources || [{ title: 'Ollama Local (Hors-Ligne)', uri: 'local://ollama' }]);

      return {
        text: `> ℹ️ **Mode Local (Ollama)** : *Réponse générée par votre serveur local Ollama (Google Gemini non sollicité ou inaccessible).*\n\n${ollamaRes.text}`,
        sources: fallbackSources,
        retrievedParagraphs: options.retrievedParagraphs,
        engineUsed: 'ollama'
      };
    }
  } catch (ollamaErr) {
    console.warn("Ollama non joignable:", ollamaErr);
  }

  // 3. Fallback d'analyse locale textuelle 100% autonome (signalé explicitement)
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
    ? `> ℹ️ **Mode Index Local** : *Aucune clé Google Gemini n'a été configurée. Cliquez sur "Activer IA" pour connecter votre clé Google AI Studio.*\n\n`
    : `> ℹ️ **Mode Secours Local** : *Connexion à Google Gemini impossible. Analyse produite par le moteur de recherche local hors-ligne.*\n\n`;

  return {
    text: `${notice}${localAnalysis.text}`,
    sources: fallbackSources,
    retrievedParagraphs: options.retrievedParagraphs,
    engineUsed: 'local_fallback'
  };
};
