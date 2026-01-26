
import { GoogleGenAI } from "@google/genai";
import { Sermon } from "../types";

const callWithRetry = async (fn: () => Promise<any>, maxRetries = 2, delay = 3000) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isQuotaError = error.message?.includes("429") || 
                           error.message?.includes("RESOURCE_EXHAUSTED");
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
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Clé API manquante.");

  const ai = new GoogleGenAI({ apiKey });

  try {
    // On limite le contexte global à 150k pour le modèle Pro pour rester sous les limites TPM
    const otherSermonsContext = allContextSermons
      .filter(s => s.id !== currentSermon.id)
      .slice(0, 5) // On prend les 5 plus pertinents max pour le contexte croisé direct
      .map(s => `ID: ${s.id} | ${s.title}\nCONTENU:\n${(s.text || '').substring(0, 20000)}`)
      .join("\n\n---\n\n");

    const prompt = `
      Analyse théologique de la sélection : "${selection}"
      
      DOCUMENT PRINCIPAL : ${currentSermon.title}
      TEXTE :
      ${currentSermon.text.substring(0, 50000)}
      
      RÉFÉRENCES CROISÉES :
      ${otherSermonsContext}
      
      INSTRUCTIONS :
      - Analyse profonde et solennelle.
      - Cite les paragraphes : [Réf: ID_SERMON, Para. N].
    `;
    
    const response = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: { 
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 8000 }
      }
    }));

    return response.text || "Analyse indisponible.";
  } catch (error: any) {
    console.error("Study Service Error:", error);
    throw new Error("Délai d'attente dépassé ou quota atteint. Réessayez dans une minute.");
  }
};
