
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';

export const askGeminiChat = async (
  prompt: string,
  contextText: string,
  history: ChatMessage[]
): Promise<string> => {
  // Initialisation à l'intérieur de la fonction pour garantir l'accès à process.env.API_KEY
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Clé API non configurée.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const systemInstruction = `Tu es un assistant théologique expert de King's Sword.
    Ton ton est solennel, précis et respectueux.
    
    BASE DE CONNAISSANCES :
    Utilise EXCLUSIVEMENT les sermons fournis dans le contexte ci-dessous.
    
    RÈGLES DE RÉPONSE :
    1. Cite William Branham fidèlement en utilisant des blockquotes (>).
    2. Pour chaque citation ou point doctrinal, ajoute IMPÉRATIVEMENT la référence : [Réf: ID_SERMON].
    3. Si une information n'est pas dans les sermons fournis, indique-le clairement avec humilité.
    4. Formate tes réponses avec Markdown (##, **, lists).`;

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
      },
    });
    
    return response.text || "Aucune réponse générée.";
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    throw new Error(`Erreur assistant : ${error.message || "Connexion perdue"}`);
  }
};
