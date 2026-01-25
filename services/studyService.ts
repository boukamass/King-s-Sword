
import { GoogleGenAI } from "@google/genai";
import { Sermon } from "../types";

export const analyzeSelectionContext = async (
  selection: string,
  currentSermon: Sermon,
  allContextSermons: Sermon[]
): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Clé API manquante.");

  const ai = new GoogleGenAI({ apiKey });

  try {
    // On limite drastiquement le texte des sermons secondaires pour économiser les tokens
    const otherSermonsContext = allContextSermons
      .filter(s => s.id !== currentSermon.id)
      .slice(0, 3) // Maximum 3 sermons en plus pour l'analyse croisée
      .map(s => `ID: ${s.id} | ${s.title} (${s.date})\nExtrait: ${s.text ? s.text.substring(0, 500) : ''}...`)
      .join("\n\n");

    const prompt = `
      Analyse théologique de : "${selection}"
      Source principale : ${currentSermon.title} (${currentSermon.date})
      
      DOCS COMPLÉMENTAIRES POUR RÉFÉRENCE :
      ${otherSermonsContext}
      
      INSTRUCTIONS :
      - Analyse courte, profonde et solennelle.
      - Mets en lumière les liens prophétiques.
      - Termine par la référence exacte : [Réf: ID_SERMON, Para. N].
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        temperature: 0.4,
        maxOutputTokens: 1000 // Limite la taille de la réponse pour économiser le quota de tokens de sortie
      }
    });

    return response.text || "Analyse indisponible.";
  } catch (error: any) {
    console.error("Study Service Error:", error);
    
    // Gestion de l'erreur de quota pour les analyses
    if (error.message?.includes("429") || error.message?.includes("QUOTA_EXHAUSTED") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Quota d'analyse épuisé. Veuillez patienter environ une minute. L'utilisation gratuite de l'IA est limitée en fréquence.");
    }
    
    throw new Error(`Erreur d'analyse : ${error.message}`);
  }
};
