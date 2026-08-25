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
      
      const systemInstruction = `Tu es l'assistant de King's Sword. 
      Effectue une analyse théologique profonde et solennelle en utilisant les sermons fournis dans le contexte.
      Mets en lumière les liens prophétiques.
      CITE TOUJOURS LE PARAGRAPHE : > "Texte" [Réf: ID_DOC, Para. N]
      Termine toujours par la référence exacte : [Réf: ID_DOC, Para. N].`;

      const optimizedContext = contextText.substring(0, 60000); 
      
      const userPromptWithContext = `INSTRUCTIONS :
1. Utilise les documents fournis ci-dessous.
2. Format de citation obligatoire : > "Citation" [Réf: ID_DOC, Para. N]

CONTEXTE :
${optimizedContext}

QUESTION : "${prompt}"`;

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
