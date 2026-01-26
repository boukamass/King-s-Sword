
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';

export interface GeminiResponse {
  text: string;
  sources: { title: string; uri: string }[];
}

// Fonction utilitaire pour gérer les limites de quota avec des tentatives automatiques
const callWithRetry = async (fn: () => Promise<any>, maxRetries = 3, delay = 5000) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error.message || "";
      const isQuotaError = errorMsg.includes("429") || 
                           errorMsg.includes("RESOURCE_EXHAUSTED") ||
                           errorMsg.includes("QUOTA_EXHAUSTED");
      
      if (isQuotaError && i < maxRetries) {
        console.warn(`[AI] Quota atteint. Tentative ${i + 1}/${maxRetries} dans ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Augmentation progressive de l'attente
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

    // Réduction du contexte à ~60k caractères (environ 15k tokens)
    // Cela laisse une marge pour l'historique et la réponse sans saturer le quota de 32k/min
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
    
    const errorMsg = error.message || "";
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Limite de messages atteinte (Quota API). Veuillez attendre 60 secondes.");
    }
    
    throw new Error(`Erreur assistant : ${error.message || "Connexion perdue"}`);
  }
};
