
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';

export interface GeminiResponse {
  text: string;
  sources: { title: string; uri: string }[];
}

// Fonction utilitaire pour gérer les limites de quota avec des tentatives automatiques
const callWithRetry = async (fn: () => Promise<any>, maxRetries = 2, delay = 2000) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isQuotaError = error.message?.includes("429") || 
                           error.message?.includes("RESOURCE_EXHAUSTED") ||
                           error.message?.includes("QUOTA_EXHAUSTED");
      
      if (isQuotaError && i < maxRetries) {
        console.warn(`Quota atteint. Tentative ${i + 1}/${maxRetries} après ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Backoff exponentiel
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
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Clé API non configurée.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const systemInstruction = `Tu es l'assistant de King's Sword. 
    Effectue une analyse théologique profonde et solennelle en utilisant les sermons fournis dans le contexte.
    Mets en lumière les liens prophétiques.
    CITE TOUJOURS LE PARAGRAPHE : > "Texte" [Réf: ID_DOC, Para. N]
    Termine toujours par la référence exacte : [Réf: ID_DOC, Para. N].`;

    // Optimisation du contexte : 100k caractères (~25k tokens) 
    // pour éviter l'erreur RESOURCE_EXHAUSTED sur les comptes gratuits (limite 32k tokens/min)
    const optimizedContext = contextText.substring(0, 100000); 
    
    const userPromptWithContext = `INSTRUCTIONS :
1. Utilise les documents fournis ci-dessous.
2. Format de citation obligatoire : > "Citation" [Réf: ID_DOC, Para. N]

CONTEXTE :
${optimizedContext}

QUESTION : "${prompt}"`;

    const contents = [
      ...history.slice(-6).map(h => ({ 
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userPromptWithContext }]
      }
    ];

    const response = await callWithRetry(() => ai.models.generateContent({
      // Utilisation de Flash pour le chat : quota beaucoup plus élevé et réponse instantanée
      model: "gemini-3-flash-preview",
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
    console.error("Gemini Chat Error:", error);
    
    if (error.message?.includes("429") || error.message?.includes("QUOTA_EXHAUSTED") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("L'IA est très sollicitée. Veuillez patienter 30 à 60 secondes avant le prochain message.");
    }
    
    throw new Error(`Erreur assistant : ${error.message || "Connexion perdue"}`);
  }
};
