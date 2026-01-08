
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
    Utilise EXCLUSIVEMENT les sermons fournis dans le contexte ci-dessous. Chaque paragraphe du contexte est préfixé par son numéro (ex: "[Para. 1]").
    
    RÈGLES DE RÉPONSE :
    1. Pour chaque citation, tu DOIS inclure le numéro du paragraphe source. Utilise le format EXACT : une citation dans un blockquote (>), suivie IMMÉDIATEMENT par la référence.
    > "Citation textuelle exacte et complète ici..." [Réf: ID_SERMON, Para. NUMERO_DU_PARAGRAPHE]
    2. Ne mets RIEN d'autre sur la même ligne que la référence (ni avant le blockquote, ni après la référence).
    3. Si une information n'est pas dans les sermons fournis, indique-le clairement avec humilité.
    4. Formate le reste de tes réponses avec Markdown (##, **, listes).`;

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
