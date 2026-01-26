
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';

export interface GeminiResponse {
  text: string;
  sources: { title: string; uri: string }[];
}

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

    // Augmentation massive de la limite de caractères pour éviter les "problèmes de limites"
    // Gemini 3 Pro supporte un contexte immense, 12k était trop restrictif.
    const expandedContext = contextText.substring(0, 500000); 
    
    const userPromptWithContext = `INSTRUCTIONS CRITIQUES :
1. Utilise les documents fournis ci-dessous pour répondre.
2. Pour chaque citation ou preuve, utilise obligatoirement ce format exact : > "Citation" [Réf: ID_DOC, Para. N]
3. Termine impérativement par la référence du sermon concerné : [Réf: ID_DOC, Para. N]

CONTEXTE DES SERMONS :
${expandedContext}

QUESTION : "${prompt}"`;

    const contents = [
      ...history.slice(-10).map(h => ({ 
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userPromptWithContext }]
      }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: contents,
      config: { 
        systemInstruction,
        temperature: 0.3,
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingBudget: 4000 } // Ajout d'un budget de réflexion pour la profondeur théologique
      },
    });
    
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
      throw new Error("Limite de messages atteinte (Quota API). Veuillez attendre 60 secondes.");
    }
    
    throw new Error(`Erreur assistant : ${error.message || "Connexion perdue"}`);
  }
};
