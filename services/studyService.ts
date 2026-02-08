
import { GoogleGenAI } from "@google/genai";
import { Sermon } from "../types";

const callWithRetry = async (fn: () => Promise<any>, maxRetries = 2, delay = 6000) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error.message || "";
      const isQuotaError = errorMsg.includes("429") || 
                           errorMsg.includes("RESOURCE_EXHAUSTED");
      if (isQuotaError && i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
};

export const analyzeSelectionContext = async (
  selection: string,
  currentSermon: Sermon,
  allContextSermons: Sermon[]
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const otherSermonsContext = allContextSermons
      .filter(s => s.id !== currentSermon.id)
      .slice(0, 5)
      .map(s => `ID: ${s.id} | ${s.title}\nCONTENU:\n${(s.text || '').substring(0, 10000)}`)
      .join("\n\n---\n\n");

    const prompt = `
      Analyse théologique de la sélection : "${selection}"
      
      DOCUMENT PRINCIPAL : ${currentSermon.title}
      TEXTE PARTIEL :
      ${currentSermon.text.substring(0, 30000)} 
      
      RÉFÉRENCES CROISÉES :
      ${otherSermonsContext}
      
      INSTRUCTIONS :
      - Analyse profonde et solennelle.
      - Cite les paragraphes : [Réf: ID_SERMON, Para. N].
    `;
    
    const response = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        temperature: 0.2,
      }
    }));

    return response.text || "Analyse indisponible.";
  } catch (error: any) {
    const errorMsg = error.message || "";
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("L'assistant d'analyse est saturé. Réessayez dans 60 secondes.");
    }
    throw new Error("Délai d'attente dépassé. Réessayez dans une minute.");
  }
};
