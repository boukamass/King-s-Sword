
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
    const otherSermonsContext = allContextSermons
      .filter(s => s.id !== currentSermon.id)
      .map(s => `ID: ${s.id}\nTitre: ${s.title}\nDate: ${s.date}\nExtrait: ${s.text ? s.text.substring(0, 1000) : ''}...`)
      .join("\n\n");

    const prompt = `
      Effectue une analyse théologique et prophétique de cet extrait spécifique :
      
      EXTRAIT : "${selection}"
      
      SOURCE PRINCIPALE : ${currentSermon.title} (${currentSermon.date})
      
      AUTRES SOURCES EN CONTEXTE :
      ${otherSermonsContext}
      
      CONSIGNES :
      - Explique la profondeur spirituelle du passage.
      - Fais des liens avec les autres sermons fournis si pertinent.
      - Utilise des titres (##) et des listes.
      - Termine par les références [Réf: ID_SERMON].
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { temperature: 0.4 }
    });

    return response.text || "Analyse indisponible.";
  } catch (error: any) {
    console.error("Study Service Error:", error);
    throw new Error(`Erreur d'analyse : ${error.message}`);
  }
};
