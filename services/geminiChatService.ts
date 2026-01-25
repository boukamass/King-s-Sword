
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
    Réponds de manière concise et solennelle en utilisant les sermons fournis.
    CITE TOUJOURS LE PARAGRAPHE : > "Texte" [Réf: ID_SERMON, Para. N]`;

    // Optimisation : réduction du contexte à 12000 caractères pour rester sous les TPM (Tokens Per Minute)
    const truncatedContext = contextText.substring(0, 12000); 
    const userPromptWithContext = `CONTEXTE :\n${truncatedContext}\n\nQUESTION : "${prompt}"`;

    const contents = [
      ...history.slice(-6).map(h => ({ // On ne garde que les 6 derniers messages pour économiser les tokens d'historique
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userPromptWithContext }]
      }
    ];

    const response = await ai.models.generateContent({
      // Utilisation du modèle Lite : plus rapide et économise le quota sur les chats simples
      model: "gemini-flash-lite-latest",
      contents: contents,
      config: { 
        systemInstruction,
        temperature: 0.7,
        tools: [{ googleSearch: {} }]
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
    
    // Gestion propre de l'erreur de quota (Rate Limit) pour éviter l'affichage de JSON brut
    if (error.message?.includes("429") || error.message?.includes("QUOTA_EXHAUSTED") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Limite de messages atteinte (Quota API). Veuillez attendre 60 secondes avant de poser une nouvelle question ou vérifiez votre forfait dans Google AI Studio.");
    }
    
    throw new Error(`Erreur assistant : ${error.message || "Connexion perdue"}`);
  }
};
