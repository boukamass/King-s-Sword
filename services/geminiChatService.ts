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
    const systemInstruction = `Tu es un assistant théologique expert de King's Sword.
    Ton ton est solennel, précis et respectueux.
    
    BASE DE CONNAISSANCES :
    Utilise les sermons fournis dans le contexte ci-dessous. Chaque paragraphe est préfixé par "[Para. N]".
    Tu as également accès à Google Search pour fournir du contexte historique ou géographique sur les lieux et dates mentionnés dans les sermons.
    
    RÈGLES DE RÉPONSE :
    1. Pour chaque citation de sermon, tu DOIS inclure le numéro du paragraphe. Format : > "Citation..." [Réf: ID_SERMON, Para. NUMERO]
    2. Si tu utilises des informations de Google Search, intègre-les naturellement pour enrichir l'exégèse.
    3. Formate tes réponses avec Markdown.`;

    const userPromptWithContext = `CONTEXTE DES SERMONS SÉLECTIONNÉS :\n${contextText}\n\nQUESTION : "${prompt}"`;

    const contents = [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userPromptWithContext }]
      }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
      config: { 
        systemInstruction,
        temperature: 0.5,
        tools: [{ googleSearch: {} }]
      },
    });
    
    const text = response.text || "Aucune réponse générée.";
    const sources: { title: string; uri: string }[] = [];
    
    // Extraction des sources Google Search si présentes
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
    throw new Error(`Erreur assistant : ${error.message || "Connexion perdue"}`);
  }
};