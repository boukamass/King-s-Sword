
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
        console.warn(`[Study] Quota Pro atteint. Tentative ${i + 1} dans ${delay}ms...`);
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
    // Le modèle Pro est très limité en tokens/minute sur le plan gratuit (souvent 32k tokens)
    // On doit être très économe avec le texte envoyé.
    const otherSermonsContext = allContextSermons
      .filter(s => s.id !== currentSermon.id)
      .slice(0, 3) // On réduit à 3 sermons max
      .map(s => `ID: ${s.id} | ${s.title}\nCONTENU:\n${(s.text || '').substring(0, 8000)}`) // Max 8k par sermon
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
    const errorMsg = error.message || "";
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("Quota d'analyse approfondie (Pro) saturé. Réessayez dans 60 secondes ou utilisez le chat classique.");
    }
    throw new Error("Délai d'attente dépassé ou quota atteint. Réessayez dans une minute.");
  }
};
