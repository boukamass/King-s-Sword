
import { GoogleGenAI, Type } from "@google/genai";

const CACHE_KEY = 'sermon_dictionary_cache';

export interface WordDefinition {
  word: string;
  definition: string;
  synonyms: string[];
  etymology?: string;
}

const getCache = (): Record<string, WordDefinition> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

const setCache = (word: string, definition: WordDefinition) => {
  const cache = getCache();
  cache[word.toLowerCase()] = definition;
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

export const getDefinition = async (word: string): Promise<WordDefinition> => {
  const cleanedWord = word.trim().toLowerCase();
  const cache = getCache();

  if (cache[cleanedWord]) {
    return cache[cleanedWord];
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key manquante.");

  const ai = new GoogleGenAI({ apiKey });

  try {
    const prompt = `Dictionnaire de référence. Fournis une définition concise et profonde de : "${cleanedWord}".
    Format JSON: word, definition, synonyms (array), etymology.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            definition: { type: Type.STRING },
            synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
            etymology: { type: Type.STRING },
          },
          required: ["word", "definition", "synonyms"],
        },
      },
    });

    const result = JSON.parse(response.text || '{}') as WordDefinition;
    if (result.word) setCache(cleanedWord, result);
    return result;
  } catch (error) {
    console.error("Dictionary Service Error:", error);
    throw new Error("Définition indisponible.");
  }
};
