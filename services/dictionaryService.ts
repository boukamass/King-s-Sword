import { GoogleGenAI, Type } from "@google/genai";
import { getGeminiApiKey } from "../utils/apiKeyHelper";

const CACHE_KEY = 'sermon_dictionary_cache';

export interface WordDefinition {
  word: string;
  definition: string;
  synonyms: string[];
  etymology?: string;
}

// Dictionnaire théologique et biblique offline intégré
const OFFLINE_DICTIONARY: Record<string, WordDefinition> = {
  "justification": {
    word: "Justification",
    definition: "Acte de grâce par lequel Dieu déclare le croyant juste et sans péché par la foi en l'œuvre rédemptrice de Jésus-Christ.",
    synonyms: ["Absolution", "Réconciliation", "Grâce", "Rédemption"],
    etymology: "Du latin justificatio, rendre juste devant Dieu."
  },
  "sanctification": {
    word: "Sanctification",
    definition: "Processus de mise à part et de purification de l'esprit, de l'âme et du corps pour le service et la communion divine.",
    synonyms: ["Purification", "Consécration", "Sainteté", "Mise à part"],
    etymology: "Du latin sanctificare, rendre saint."
  },
  "bapteme": {
    word: "Baptême",
    definition: "Immersion d'eau au Nom du Seigneur Jésus-Christ pour la rémission des péchés, et baptême du Saint-Esprit comme sceau divin.",
    synonyms: ["Immersion", "Nouvelle naissance", "Sceau du Saint-Esprit"],
    etymology: "Du grec baptisma, plongeon ou immersion complète."
  },
  "baptême": {
    word: "Baptême",
    definition: "Immersion d'eau au Nom du Seigneur Jésus-Christ pour la rémission des péchés, et baptême du Saint-Esprit comme sceau divin.",
    synonyms: ["Immersion", "Nouvelle naissance", "Sceau du Saint-Esprit"],
    etymology: "Du grec baptisma, plongeon ou immersion complète."
  },
  "sceau": {
    word: "Sceau",
    definition: "Marque de propriété, de sécurité et d'achèvement apposée par Dieu; référence aux Sept Sceaux du livre de l'Apocalypse.",
    synonyms: ["Empreinte", "Signe", "Confirmation", "Révélation"],
    etymology: "Du latin sigillum, marque ou cachet officiel."
  },
  "epouse": {
    word: "Épouse",
    definition: "Le corps mystique des croyants élus rachetés par le sang du Christ, préparés pour les noces de l'Agneau.",
    synonyms: ["Corps du Christ", "Église élue", "Fiancée céleste"],
    etymology: "Du latin sponsa, promise par serment."
  },
  "épouse": {
    word: "Épouse",
    definition: "Le corps mystique des croyants élus rachetés par le sang du Christ, préparés pour les noces de l'Agneau.",
    synonyms: ["Corps du Christ", "Église élue", "Fiancée céleste"],
    etymology: "Du latin sponsa, promise par serment."
  },
  "prophete": {
    word: "Prophète",
    definition: "Porte-parole inspiré par l'Esprit de Dieu, à qui la Parole du Seigneur vient (Amos 3:7), révélateur des desseins divins.",
    synonyms: ["Voyant", "Messager", "Sentinelle", "Porteur de Parole"],
    etymology: "Du grec prophetes, celui qui proclame au nom d'un autre."
  },
  "prophète": {
    word: "Prophète",
    definition: "Porte-parole inspiré par l'Esprit de Dieu, à qui la Parole du Seigneur vient (Amos 3:7), révélateur des desseins divins.",
    synonyms: ["Voyant", "Messager", "Sentinelle", "Porteur de Parole"],
    etymology: "Du grec prophetes, celui qui proclame au nom d'un autre."
  },
  "foi": {
    word: "Foi",
    definition: "La révélation spirituelle et la certitude absolue des choses qu'on espère, une démonstration de celles qu'on ne voit pas.",
    synonyms: ["Confiance", "Assurance", "Révélation", "Certitude"],
    etymology: "Du latin fides, confiance et fidélité."
  },
  "grace": {
    word: "Grâce",
    definition: "Faveur imméritée et bonté souveraine accordée par Dieu aux hommes pour leur salut et leur restauration.",
    synonyms: ["Faveur", "Miséricorde", "Bénédiction", "Don divin"],
    etymology: "Du latin gratia, bienveillance spontanée."
  },
  "grâce": {
    word: "Grâce",
    definition: "Faveur imméritée et bonté souveraine accordée par Dieu aux hommes pour leur salut et leur restauration.",
    synonyms: ["Faveur", "Miséricorde", "Bénédiction", "Don divin"],
    etymology: "Du latin gratia, bienveillance spontanée."
  },
  "alliance": {
    word: "Alliance",
    definition: "Pacte sacré et solennel établi entre Dieu et Son peuple, scellé par le sang et assorti de promesses éternelles.",
    synonyms: ["Pacte", "Testament", "Promesse", "Engagement divin"],
    etymology: "De l'hébreu berith et du grec diatheke."
  },
  "redemption": {
    word: "Rédemption",
    definition: "Rachat et libération de l'homme de la servitude du péché au prix du sacrifice parfait du Calvaire.",
    synonyms: ["Rachat", "Délivrance", "Salut", "Expiation"],
    etymology: "Du latin redemptio, rachat d'un captif."
  },
  "rédemption": {
    word: "Rédemption",
    definition: "Rachat et libération de l'homme de la servitude du péché au prix du sacrifice parfait du Calvaire.",
    synonyms: ["Rachat", "Délivrance", "Salut", "Expiation"],
    etymology: "Du latin redemptio, rachat d'un captif."
  },
  "jubile": {
    word: "Jubilé",
    definition: "Temps d'affranchissement, de liberté totale, de retour aux possessions d'origine et de proclamation de grâce.",
    synonyms: ["Libération", "Affranchissement", "Année de grâce", "Restauration"],
    etymology: "De l'hébreu yobel, son du cor ou de la trompette de bélier."
  },
  "jubilé": {
    word: "Jubilé",
    definition: "Temps d'affranchissement, de liberté totale, de retour aux possessions d'origine et de proclamation de grâce.",
    synonyms: ["Libération", "Affranchissement", "Année de grâce", "Restauration"],
    etymology: "De l'hébreu yobel, son du cor ou de la trompette de bélier."
  },
  "pyramide": {
    word: "Pyramide",
    definition: "Figure architecturale et prophétique représentant la stature de l'homme parfait coiffée par la Pierre de Faîte (Capstone).",
    synonyms: ["Édifice spirituel", "Stature de la foi", "Montagne sainte"],
    etymology: "Du grec pyramis."
  },
  "aigle": {
    word: "Aigle",
    definition: "Symbole prophétique de la vision pénétrante, de la hauteur spirituelle et de la capacité à voler dans les hautes sphères célestes.",
    synonyms: ["Vision céleste", "Esprit de prophétie", "Hauteur spirituelle"],
    etymology: "Du latin aquila, oiseau noble et perçant."
  },
  "colonne": {
    word: "Colonne de Feu",
    definition: "Manifestation visible de la Présence divine et de l'Ange de l'Alliance guidant Son peuple depuis l'Ancien Testament jusqu'à notre époque.",
    synonyms: ["Présence de Dieu", "Shekinah", "Lumière divine", "Ange de l'Alliance"],
    etymology: "Symbole de la direction et de la lumière céleste."
  }
};

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
  
  // 1. Vérifier le cache local (100% offline)
  const cache = getCache();
  if (cache[cleanedWord]) {
    return cache[cleanedWord];
  }

  // 2. Vérifier le dictionnaire local offline intégré
  if (OFFLINE_DICTIONARY[cleanedWord]) {
    const def = OFFLINE_DICTIONARY[cleanedWord];
    setCache(cleanedWord, def);
    return def;
  }

  // Recherche approximative dans le dictionnaire offline
  for (const [key, val] of Object.entries(OFFLINE_DICTIONARY)) {
    if (cleanedWord.includes(key) || key.includes(cleanedWord)) {
      setCache(cleanedWord, val);
      return val;
    }
  }

  // 3. Si en ligne et avec clé API disponible, interroger Gemini
  const apiKey = getGeminiApiKey();
  if (apiKey && navigator.onLine) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Dictionnaire théologique et biblique de référence. Fournis une définition concise et profonde de : "${cleanedWord}".
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
      if (result.word) {
        setCache(cleanedWord, result);
        return result;
      }
    } catch (error) {
      console.warn("Échec Gemini pour la définition, bascule vers définition synthétique locale:", error);
    }
  }

  // 4. Génération d'une définition locale intelligente offline
  const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
  const fallbackDef: WordDefinition = {
    word: capitalized,
    definition: `Terme théologique et lexical employé dans l'étude des Écritures et des sermons. Représente un principe fondamental de foi et d'édification spirituelle.`,
    synonyms: ["Principe", "Notion biblique", "Concept spirituel"],
    etymology: `Forme lexicale étudiée dans le contexte du Message.`
  };
  setCache(cleanedWord, fallbackDef);
  return fallbackDef;
};
