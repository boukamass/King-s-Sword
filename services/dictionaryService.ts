import { GoogleGenAI, Type } from "@google/genai";
import { getAllGeminiApiKeys } from "../utils/apiKeyHelper";
import { fetchJsonSafe } from "../utils/fetchHelper";
import { get as idbGet, set as idbSet } from "idb-keyval";

const CACHE_KEY = 'sermon_dictionary_cache_v2';
const IDB_DICT_KEY = 'kings_sword_offline_dictionary_fr_v2';

export interface WordDefinition {
  word: string;
  definition: string;
  synonyms: string[];
  etymology?: string;
  source?: string;
  grammarNote?: string;
}

interface DictionaryEntry {
  w: string;
  d: string;
  s?: string[];
  e?: string;
}

// Base en mémoire du dictionnaire intégral français téléchargé
let offlineDictionaryMap: Record<string, DictionaryEntry> | null = null;
let offlineDictionaryPromise: Promise<Record<string, DictionaryEntry> | null> | null = null;

/**
 * Charge le dictionnaire complet français (55 000+ mots) au format JSON comme pour la Bible
 * Priorité 1 : Mémoire vive
 * Priorité 2 : IndexedDB (cache local permanent hors-ligne)
 * Priorité 3 : /dictionary-fr.json (avec mise en cache IndexedDB automatique)
 */
export const ensureOfflineDictionaryLoaded = async (): Promise<Record<string, DictionaryEntry> | null> => {
  if (offlineDictionaryMap && Object.keys(offlineDictionaryMap).length > 0) {
    return offlineDictionaryMap;
  }
  if (!offlineDictionaryPromise) {
    offlineDictionaryPromise = (async () => {
      // 1. Tenter le chargement depuis IndexedDB
      try {
        if (typeof window !== 'undefined') {
          const cachedIdb = await idbGet<Record<string, DictionaryEntry>>(IDB_DICT_KEY);
          if (cachedIdb && typeof cachedIdb === 'object' && Object.keys(cachedIdb).length > 1000) {
            offlineDictionaryMap = cachedIdb;
            return cachedIdb;
          }
        }
      } catch (idbErr) {
        console.warn("IndexedDB dictionary read failed, will fetch json:", idbErr);
      }

      // 2. Télécharger depuis le fichier local public /dictionary-fr.json (comme pour la Bible)
      try {
        const data = await fetchJsonSafe<Record<string, DictionaryEntry>>(
          'dictionary-fr.json',
          ['./dictionary-fr.json']
        );
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          offlineDictionaryMap = data;
          // Sauvegarder dans IndexedDB en arrière-plan sans bloquer
          if (typeof window !== 'undefined') {
            idbSet(IDB_DICT_KEY, data).catch(() => {});
          }
          return data;
        }
      } catch (err) {
        console.warn("Échec du chargement du dictionnaire offline /dictionary-fr.json:", err);
      }
      return null;
    })();
  }
  return offlineDictionaryPromise;
};

// Démarrer le préchargement transparent en arrière-plan sans bloquer
if (typeof window !== 'undefined') {
  setTimeout(() => {
    ensureOfflineDictionaryLoaded().catch(() => {});
  }, 500);
}

/**
 * Normalise un mot ou une expression en retirant les guillemets, ponctuations et articles élidés français
 */
export const normalizeWord = (raw: string): string => {
  if (!raw) return "";
  let w = raw.trim();
  w = w.replace(/^[«"'\u2018\u201C\(\[\{]+/g, "").replace(/[»"'\u2019\u201D\)\]\}.,;:!?;\-]+$/g, "");
  w = w.replace(/^[ldjqcsnmtLDJQCSNMT]['’]/, "");
  w = w.replace(/^[«"'\u2018\u201C\(\[\{]+/g, "").replace(/[»"'\u2019\u201D\)\]\}.,;:!?;\-]+$/g, "");
  return w.trim();
};

/**
 * Transforme en clé canonique de recherche (sans accents, sans ponctuation, avec gestion des ligatures œ et æ)
 */
export const toLookupKey = (raw: string): string => {
  const norm = normalizeWord(raw);
  return norm
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
};

// Modèles Gemini officiels recommandés par ordre de priorité si en ligne
const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-latest"
];

/**
 * Nettoie le cache local de toute entrée polluée par l'ancien message générique
 */
const getCache = (): Record<string, WordDefinition> => {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    let hasChanged = false;
    for (const key of Object.keys(raw)) {
      const def = raw[key];
      if (
        !def ||
        !def.definition ||
        def.definition.includes("Terme théologique et lexical employé") ||
        def.definition.includes("Représente un principe fondamental de foi") ||
        def.definition.includes("Forme lexicale étudiée dans le contexte du Message")
      ) {
        delete raw[key];
        hasChanged = true;
      }
    }
    if (hasChanged) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
    }
    return raw;
  } catch {
    return {};
  }
};

const setCache = (lookupKey: string, definition: WordDefinition) => {
  try {
    if (
      !definition || 
      !definition.definition || 
      definition.definition.includes("Terme théologique et lexical employé")
    ) {
      return;
    }
    const cache = getCache();
    cache[lookupKey] = definition;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("Échec d'écriture dans le cache dictionnaire:", e);
  }
};

interface ResolvedDictionaryMatch {
  entry: DictionaryEntry;
  baseWord?: string;
  grammarNote?: string;
}

/**
 * Recherche avec lemmatisation avancée (pluriels, féminins, verbes conjugués, formes dérivées)
 * et résolution des renvois ("Du verbe X", "Féminin de Y", "Pluriel de Z")
 */
const resolveEntry = (
  key: string,
  dict: Record<string, DictionaryEntry>,
  depth = 0
): ResolvedDictionaryMatch | null => {
  if (!key || depth > 2) return null;

  let entry: DictionaryEntry | undefined = dict[key];
  let grammarNote: string | undefined = undefined;

  if (!entry) {
    // 1. Pluriel en aux -> al (animaux -> animal, journaux -> journal)
    if (key.endsWith('aux')) {
      const cand = key.slice(0, -3) + 'al';
      if (dict[cand]) {
        entry = dict[cand];
        grammarNote = `Forme plurielle (pluriel de ${dict[cand].w})`;
      }
    }

    // 2. Pluriel en eaux -> eau (oiseaux -> oiseau, châteaux -> château)
    if (!entry && key.endsWith('eaux')) {
      const cand = key.slice(0, -1);
      if (dict[cand]) {
        entry = dict[cand];
        grammarNote = `Forme plurielle (pluriel de ${dict[cand].w})`;
      }
    }

    // 3. Pluriel en -s ou -x
    if (!entry && (key.endsWith('s') || key.endsWith('x'))) {
      const cand = key.slice(0, -1);
      if (dict[cand]) {
        entry = dict[cand];
        grammarNote = `Forme plurielle (de ${dict[cand].w})`;
      } else if (cand.endsWith('e') && dict[cand.slice(0, -1)]) {
        const base = cand.slice(0, -1);
        entry = dict[base];
        grammarNote = `Forme féminine plurielle (de ${dict[base].w})`;
      }
    }

    // 4. Formes féminines en -e, -ée, -ive, -rice, -euse
    if (!entry && key.endsWith('rice') && dict[key.slice(0, -4) + 'teur']) {
      const base = key.slice(0, -4) + 'teur';
      entry = dict[base];
      grammarNote = `Forme féminine (de ${dict[base].w})`;
    }
    if (!entry && key.endsWith('ive') && dict[key.slice(0, -3) + 'if']) {
      const base = key.slice(0, -3) + 'if';
      entry = dict[base];
      grammarNote = `Forme féminine (de ${dict[base].w})`;
    }
    if (!entry && key.endsWith('euse') && dict[key.slice(0, -4) + 'eur']) {
      const base = key.slice(0, -4) + 'eur';
      entry = dict[base];
      grammarNote = `Forme féminine (de ${dict[base].w})`;
    }
    if (!entry && key.endsWith('ee') && dict[key.slice(0, -1)]) {
      const cand = key.slice(0, -1);
      entry = dict[cand];
      grammarNote = `Participe passé / forme féminine (de ${dict[cand].w})`;
    }
    if (!entry && key.endsWith('e') && key.length > 3 && dict[key.slice(0, -1)]) {
      const cand = key.slice(0, -1);
      entry = dict[cand];
      grammarNote = `Forme féminine (de ${dict[cand].w})`;
    }

    // 5. Terminaisons verbales courantes du français
    if (!entry) {
      const verbEndings: [string, string][] = [
        ['aient', 'er'], ['erait', 'er'], ['eraient', 'er'], ['eront', 'er'],
        ['erions', 'er'], ['eriez', 'er'], ['erent', 'er'],
        ['ait', 'er'], ['ais', 'er'], ['ant', 'er'], ['ent', 'er'],
        ['era', 'er'], ['eras', 'er'], ['ons', 'er'], ['ez', 'er'],
        ['issant', 'ir'], ['issaient', 'ir'], ['issait', 'ir'], ['issent', 'ir'],
        ['irait', 'ir'], ['ira', 'ir'], ['iront', 'ir']
      ];
      for (const [end, repl] of verbEndings) {
        if (key.endsWith(end) && key.length > end.length + 2) {
          const cand = key.slice(0, -end.length) + repl;
          if (dict[cand]) {
            entry = dict[cand];
            grammarNote = `Forme conjuguée du verbe ${dict[cand].w}`;
            break;
          }
          const cand2 = key.slice(0, -end.length);
          if (dict[cand2]) {
            entry = dict[cand2];
            grammarNote = `Forme dérivée de ${dict[cand2].w}`;
            break;
          }
        }
      }
    }
  }

  if (entry) {
    // Si l'entrée trouvée est elle-même un renvoi grammatical laconique (ex. "Du verbe enseigner", "Féminin de saint")
    const dLower = entry.d.toLowerCase();
    const verbMatch = entry.d.match(/du verbe\s+([a-zà-ÿœæ-]+)/i);
    const femMatch = entry.d.match(/féminin\s+(?:singulier|pluriel)?\s+de\s+([a-zà-ÿœæ-]+)/i);
    const plurMatch = entry.d.match(/pluriel\s+de\s+([a-zà-ÿœæ-]+)/i);
    const targetWord = (verbMatch && verbMatch[1]) || (femMatch && femMatch[1]) || (plurMatch && plurMatch[1]);
    
    if (targetWord) {
      const targetKey = toLookupKey(targetWord);
      if (targetKey && targetKey !== key && dict[targetKey]) {
        const sub = resolveEntry(targetKey, dict, depth + 1);
        if (sub && sub.entry && sub.entry.d && sub.entry.d.length > 20) {
          return {
            entry: sub.entry,
            baseWord: sub.entry.w || targetWord,
            grammarNote: `${entry.w} : ${entry.d.replace(/\.$/, '')}`
          };
        }
      }
    }

    return {
      entry,
      grammarNote
    };
  }

  return null;
};

/**
 * Récupère la définition d'un mot ou d'une expression
 * 1. Vérifie le cache local nettoyé
 * 2. Vérifie le dictionnaire hors-ligne intégral (55 000+ mots) avec lemmatisation
 * 3. En ligne avec clé API : interroge Gemini pour enrichir l'exégèse
 * 4. Fallback informatif et noble sans texte générique
 */
export const getDefinition = async (word: string): Promise<WordDefinition> => {
  const displayWord = normalizeWord(word) || word.trim();
  const lookupKey = toLookupKey(word);

  if (!lookupKey) {
    return {
      word: displayWord || "Terme",
      definition: "Veuillez sélectionner un mot ou une expression valide à définir.",
      synonyms: []
    };
  }

  // 1. Vérifier le cache local nettoyé
  const cache = getCache();
  if (cache[lookupKey]) {
    return cache[lookupKey];
  }

  // 2. Vérifier le dictionnaire hors-ligne complet chargé depuis /dictionary-fr.json
  const dictData = await ensureOfflineDictionaryLoaded();
  if (dictData) {
    const resolved = resolveEntry(lookupKey, dictData);

    if (resolved && resolved.entry && resolved.entry.d) {
      const wordResult: WordDefinition = {
        word: resolved.entry.w || (displayWord.charAt(0).toUpperCase() + displayWord.slice(1)),
        definition: resolved.entry.d,
        synonyms: resolved.entry.s && resolved.entry.s.length > 0 ? resolved.entry.s : [displayWord],
        etymology: resolved.entry.e || undefined,
        source: "Dictionnaire Webster & Français",
        grammarNote: resolved.grammarNote
      };
      setCache(lookupKey, wordResult);
      return wordResult;
    }
  }

  // 3. Si en ligne et qu'une clé API Gemini est disponible, interroger Gemini
  const availableKeys = getAllGeminiApiKeys();
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  if (availableKeys.length > 0 && isOnline) {
    for (const currentKey of availableKeys) {
      try {
        const ai = new GoogleGenAI({ apiKey: currentKey });
        const prompt = `Tu es un dictionnaire de référence de langue française (style Webster 1828 et Littré) et un lexique d'autorité biblique et théologique.
Fournis la définition rigoureuse, noble et complète du terme suivant : "${displayWord}".

Format de réponse OBLIGATOIRE en JSON valide strict avec les propriétés suivantes :
- "word": "${displayWord}" (avec la casse et les accents français corrects)
- "definition": "Définition substantielle, claire et soignée (environ 2 à 4 phrases complètes, précisant le sens premier et, s'il y a lieu, le sens biblique ou moral)."
- "synonyms": ["tableau", "de 3 à 6", "termes ou synonymes", "associés"]
- "etymology": "Origine étymologique précise (grecque, latine, hébraïque ou historique du mot)."
`;

        for (const modelName of CANDIDATE_MODELS) {
          try {
            const response = await ai.models.generateContent({
              model: modelName,
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
                temperature: 0.2,
              },
            });

            let cleanText = (response.text || '').trim();
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              cleanText = jsonMatch[0];
            }

            const result = JSON.parse(cleanText) as WordDefinition;
            if (result.word && result.definition && result.definition.length > 15) {
              if (!result.word || result.word.toLowerCase() === 'word') {
                result.word = displayWord.charAt(0).toUpperCase() + displayWord.slice(1);
              }
              result.source = "King's Sword Exégèse & Dictionnaire";
              setCache(lookupKey, result);
              return result;
            }
          } catch (modelErr: any) {
            continue;
          }
        }
      } catch (keyErr) {
        continue;
      }
    }
  }

  // 4. Fallback propre si hors-ligne et non trouvé dans le dictionnaire
  const capitalized = displayWord.charAt(0).toUpperCase() + displayWord.slice(1);
  return {
    word: capitalized,
    definition: `Définition pour « ${capitalized} » : ce terme spécifique n'a pas été trouvé dans le dictionnaire hors-ligne. Veuillez vérifier l'orthographe ou vous connecter à Internet pour interroger le service étendu.`,
    synonyms: [capitalized],
    etymology: undefined,
    source: "Dictionnaire Hors-ligne"
  };
};
