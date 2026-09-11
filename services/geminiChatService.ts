import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { isOllamaAvailable, askOllamaChat, offlineLocalSearchAnalysis } from './ollamaService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';

export interface GeminiResponse {
  text: string;
  sources: { title: string; uri: string }[];
}

const callWithRetry = async (fn: () => Promise<any>, maxRetries = 2, delay = 2000) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error.message || "";
      const isQuotaError = errorMsg.includes("429") || 
                           errorMsg.includes("RESOURCE_EXHAUSTED") ||
                           errorMsg.includes("QUOTA_EXHAUSTED");
      if (isQuotaError) {
        throw error; // Basculement immédiat vers le mode local
      }
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
  history: ChatMessage[]
): Promise<GeminiResponse> => {
  const apiKey = getGeminiApiKey();

  // 1. Si en ligne et avec une clé API valide, tenter Gemini Cloud
  if (apiKey && navigator.onLine) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const systemInstruction = `Tu es l'assistant d'étude et de recherche théologique de King's Sword, doté d'une rigueur d'analyse et d'une profondeur comparables à Google NotebookLM et aux meilleurs outils de recherche exégétique.
      
DIRECTIVES DE FORMATAGE ET DE STRUCTURE ÉDITORIALE STRICTES :
1. Séparation claire du contenu et des sources : Ne mélange jamais les références ou les numéros de paragraphe dans les phrases du corps du texte.
2. Pour les passages bibliques cités : Présente la citation dans un bloc (> « ... ») suivi immédiatement de la référence exacte (ex : **Genèse 2:5 — LSG 1910**). Si le numéro de verset exact n'est pas certain, ne l'invente pas.
3. Pour les enseignements/sermons cités : Présente la citation dans un bloc (> « ... ») suivi de **Source :** *Titre du Sermon* — Date, §N.
4. N'affiche JAMAIS d'artefact cassé comme "Para.", "Para. ", "[[[NOTE_EXTERNE]]]" ou des références collées.
5. Regroupe toujours en fin de réponse une section "### Sources" numérotée ([1], [2]...) listant clairement les références utilisées.`;

      const optimizedContext = contextText.substring(0, 120000); 
      
      const userPromptWithContext = `DOCUMENTS SOURCES FOURNIS DANS LE CONTEXTE (Dock IA / Sermons actifs) :
============================================================
${optimizedContext}
============================================================

CONSIGNES :
1. Réponds à la question de manière détaillée, approfondie et structurée en te basant prioritairement sur les documents ci-dessus.
2. Inclus des citations textuelles exactes sous la forme : > "Citation..." [Réf: ID_DOC, Para. N]
3. Si la question nécessite un croisement entre plusieurs sermons ou écritures, mets en évidence les liens prophétiques et l'harmonie des messages.

QUESTION DU CHERCHEUR :
"${prompt}"`;

      const contents = [
        ...history.slice(-4).map(h => ({ 
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }]
        })),
        {
          role: 'user',
          parts: [{ text: userPromptWithContext }]
        }
      ];

      const response = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: { 
          systemInstruction,
          temperature: 0.4,
          tools: [{ googleSearch: {} }]
        },
      }));
      
      const text = response.text || "Aucune réponse générée.";
      const sources: { title: string; uri: string }[] = [];
      
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        chunks.forEach((chunk: any) => {
          if (chunk.web && chunk.web.uri) {
            sources.push({
              title: chunk.web.title || "Source Web",
              uri: chunk.web.uri
            });
          }
        });
      }

      return { text, sources };
    } catch (error: any) {
      console.warn("Échec Gemini Cloud, passage au mode local/hors-ligne:", error);
    }
  }

  // 2. Si Gemini échoue ou est hors-ligne, tester Ollama local
  try {
    const ollamaActive = await isOllamaAvailable();
    if (ollamaActive) {
      const ollamaRes = await askOllamaChat(prompt, contextText, history);
      return {
        text: ollamaRes.text,
        sources: ollamaRes.sources || [{ title: 'Ollama Local (Offline)', uri: 'local://ollama' }]
      };
    }
  } catch (ollamaErr) {
    console.warn("Ollama non joignable:", ollamaErr);
  }

  // 3. Fallback d'analyse locale textuelle 100% autonome
  const localAnalysis = offlineLocalSearchAnalysis(prompt, contextText);
  return {
    text: localAnalysis.text,
    sources: localAnalysis.sources || [{ title: 'Index Local Hors-Ligne', uri: 'local://search' }]
  };
};
