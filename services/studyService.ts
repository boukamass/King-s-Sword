import { GoogleGenAI } from "@google/genai";
import { Sermon } from "../types";
import { isOllamaAvailable, askOllamaChat } from "./ollamaService";
import { getGeminiApiKey } from "../utils/apiKeyHelper";

const callWithRetry = async (fn: () => Promise<any>, maxRetries = 2, delay = 2000) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error.message || "";
      const isQuotaError = errorMsg.includes("429") || 
                           errorMsg.includes("RESOURCE_EXHAUSTED") ||
                           errorMsg.includes("QUOTA_EXHAUSTED");
      if (isQuotaError) {
        throw error; // Basculement immédiat vers le mode local pour éviter le blocage
      }
      if (i < maxRetries) {
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
  const apiKey = getGeminiApiKey();
  const currentText = currentSermon?.text || '';

  const otherSermonsContext = allContextSermons
    .filter(s => s.id !== currentSermon?.id)
    .slice(0, 5)
    .map(s => `ID: ${s.id} | ${s.title}\nCONTENU:\n${(s.text || '').substring(0, 10000)}`)
    .join("\n\n---\n\n");

  const prompt = `
    Analyse théologique de la sélection : "${selection}"
    
    DOCUMENT PRINCIPAL : ${currentSermon?.title || 'Document'} (${currentSermon?.date || ''})
    EXTRAIT :
    ${currentText.substring(0, 20000)} 
    
    RÉFÉRENCES CROISÉES :
    ${otherSermonsContext}
    
    INSTRUCTIONS :
    - Analyse profonde et solennelle.
    - Cite les paragraphes au format : [Réf: ID_SERMON, Para. N].
  `;

  // 1. Tenter Gemini Cloud si disponible
  if (apiKey && navigator.onLine) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { 
          temperature: 0.2,
        }
      }));

      return response.text || "Analyse indisponible.";
    } catch (error: any) {
      console.warn("Échec Gemini pour analyse contextuelle, passage au mode local:", error);
    }
  }

  // 2. Tenter Ollama Local
  try {
    const ollamaActive = await isOllamaAvailable();
    if (ollamaActive) {
      const res = await askOllamaChat(
        `Analyse la citation suivante dans le contexte du sermon "${currentSermon.title}" :\n"${selection}"`,
        currentSermon.text.substring(0, 10000),
        []
      );
      return res.text;
    }
  } catch (ollamaErr) {
    console.warn("Ollama non joignable pour l'analyse:", ollamaErr);
  }

  // 3. Synthèse locale offline de la sélection
  return `### Analyse Thématique (Mode Hors-Ligne)

**Extrait ciblé :**
> "${selection}"

**Contexte du sermon :** *${currentSermon.title} (${currentSermon.date}, ${currentSermon.city})*

Cet extrait s'inscrit au cœur du message délivré. Les thèmes de foi, de révélation de la Parole et de positionnement du croyant y sont abordés. Pour une étude approfondie assistée par modèle de langage en mode déconnecté, vous pouvez activer **Ollama** en arrière-plan sur votre machine.`;
};
