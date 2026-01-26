
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
    // Suppression des limites restrictives de texte et de nombre de sermons
    const otherSermonsContext = allContextSermons
      .filter(s => s.id !== currentSermon.id)
      .map(s => `ID: ${s.id} | ${s.title} (${s.date})\nCONTENU:\n${s.text || ''}`)
      .join("\n\n---\n\n");

    const prompt = `
      Analyse théologique approfondie de la sélection suivante : "${selection}"
      
      DOCUMENT PRINCIPAL : ${currentSermon.title} (${currentSermon.date})
      TEXTE INTÉGRAL DU DOCUMENT PRINCIPAL :
      ${currentSermon.text}
      
      DOCUMENTS DE RÉFÉRENCE CROISÉE :
      ${otherSermonsContext}
      
      INSTRUCTIONS :
      - Effectue une analyse profonde, solennelle et exhaustive.
      - Mets en lumière les mystères et liens prophétiques entre ces documents.
      - Cite textuellement les paragraphes pertinents.
      - Termine par la référence exacte : [Réf: ID_SERMON, Para. N].
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: { 
        temperature: 0.2, // Plus bas pour plus de précision scripturaire
        thinkingConfig: { thinkingBudget: 8000 } // Budget de réflexion élevé pour une analyse complexe
      }
    });

    return response.text || "Analyse indisponible.";
  } catch (error: any) {
    console.error("Study Service Error:", error);
    
    if (error.message?.includes("429") || error.message?.includes("QUOTA_EXHAUSTED") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Le quota d'analyse est momentanément saturé. Réessayez dans quelques instants.");
    }
    
    throw new Error(`Erreur d'analyse : ${error.message}`);
  }
};
