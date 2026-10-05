/**
 * King's Sword — Theological Query Expansion & Multi-Hop Decomposition Service
 * 
 * Module de traitement amont des requêtes pour l'Assistant IA :
 * 1. Expansion sémantique & doctrinale : Traduit le langage naturel ou moderne vers
 *    la terminologie exacte des sermons de William Branham et de l'Exposé.
 * 2. Décomposition Multi-Hop : Isole les sous-facettes d'une question complexe ou comparative.
 * 3. Résilience totale : Fallback instantané sur la requête d'origine en cas d'absence de réseau ou d'erreur API.
 */

import { GoogleGenAI } from '@google/genai';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { normalizeText } from '../utils/textUtils';

export interface ExpandedTheologicalQuery {
  originalQuery: string;
  expandedQuery: string;
  doctrinalKeywords: string[];
  subQueries: string[];
  isMultiHop: boolean;
}

// Table d'équivalence lexicale et doctrinale rapide locale (0 ms, 100% hors-ligne)
const LOCAL_THEOLOGICAL_LEXICON: Record<string, string[]> = {
  'saint-esprit': ['jeton', 'token', 'bapteme du saint-esprit', 'sceau de dieu', 'nouvelle naissance', 'vie de christ'],
  'saint esprit': ['jeton', 'token', 'bapteme du saint-esprit', 'sceau de dieu', 'nouvelle naissance'],
  'nouvelle naissance': ['bapteme du saint-esprit', 'jeton', 'token', 'conversion', 'troisieme pull'],
  'sceaux': ['sept sceaux', 'ouverture des sceaux', 'agneau', 'livre de redemption', '1963'],
  'sceau': ['sept sceaux', 'ouverture des sceaux', 'agneau', 'livre de redemption'],
  'septieme sceau': ['septieme sceau', 'silence au ciel', 'sept trompettes', 'troisieme pull', 'retour du seigneur'],
  'ages': ['sept ages de l\'eglise', 'messagers', 'ephese', 'smyrne', 'pergame', 'thyatire', 'sardes', 'philadelphie', 'laodicee'],
  'ephese': ['paul', 'premier age', 'arbre de vie', 'nicolaïsme'],
  'laodicee': ['dernier age', 'messager du septieme age', 'elu', 'apostasie', 'vomir'],
  'colonne de feu': ['lumiere surnaturelle', 'ange du seigneur', 'ange de l\'alliance', 'apparition', 'photo houston 1950'],
  'nuee': ['nuage surnaturel', 'sunset mountain', 'sept anges', 'arizona', 'fevrier 1963'],
  'pyramide': ['pierre de faite', 'chapeau de la pyramide', 'stature d\'un homme parfait', 'vertus'],
  'troisieme pull': ['epopee', 'petite chambre', 'parole parlee', 'creation', 'troisieme phase'],
  'semence du serpent': ['serpent', 'sedution', 'eve', 'cain', 'arbre de la connaissance du bien et du mal'],
  'enlevement': ['depart', 'epouse', 'trompette de dieu', 'resurrection des morts', 'changement de corps'],
  'epouse': ['corps mystique de christ', 'vierge pure', 'parole faite chair', 'membres de son corps'],
  'guerison': ['foi', 'discernement', 'don de guerison', 'vision', 'crois seulement']
};

/**
 * Détecte si une requête comporte plusieurs facettes nécessitant une décomposition Multi-Hop.
 */
export function detectMultiHopComplexity(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const norm = normalizeText(query).toLowerCase();
  
  const multiHopIndicators = [
    /\b(compare|comparer|comparaison|difference entre|distinction entre)\b/,
    /\b(articule[- ]t[- ]il|relation entre|lien entre|rapport entre)\b/,
    /\b(d'un cote.*de l'autre|a la fois.*et)\b/,
    /\b(avant.*apres|evolution|comment.*alors que)\b/,
    /\b(passage de.*vers|differents aspects)\b/
  ];

  return multiHopIndicators.some(pattern => pattern.test(norm));
}

/**
 * Effectue l'expansion locale déterministe (sans appel réseau).
 */
export function expandLocally(query: string): ExpandedTheologicalQuery {
  const norm = normalizeText(query).toLowerCase();
  const addedKeywords: string[] = [];

  for (const [key, equivalents] of Object.entries(LOCAL_THEOLOGICAL_LEXICON)) {
    if (norm.includes(key)) {
      addedKeywords.push(...equivalents);
    }
  }

  const uniqueKeywords = Array.from(new Set(addedKeywords));
  const expandedQuery = uniqueKeywords.length > 0 
    ? `${query} ${uniqueKeywords.slice(0, 6).join(' ')}` 
    : query;

  const isMultiHop = detectMultiHopComplexity(query);
  let subQueries: string[] = [query];

  if (isMultiHop) {
    // Découpage heuristique local
    const parts = query.split(/\b(?: et | ainsi que | par rapport à | comparé à | versus | vs )\b/i);
    if (parts.length > 1) {
      subQueries = parts.map(p => p.trim()).filter(p => p.length > 3);
    }
  }

  return {
    originalQuery: query,
    expandedQuery,
    doctrinalKeywords: uniqueKeywords,
    subQueries,
    isMultiHop
  };
}

/**
 * Expande la requête avec le LLM en ligne si la clé API est disponible,
 * avec repli automatique sur l'expansion locale déterministe.
 */
export async function expandTheologicalQuery(
  query: string,
  apiKey?: string
): Promise<ExpandedTheologicalQuery> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return {
      originalQuery: '',
      expandedQuery: '',
      doctrinalKeywords: [],
      subQueries: [],
      isMultiHop: false
    };
  }

  const localResult = expandLocally(cleanQuery);
  const activeKey = apiKey || getGeminiApiKey();

  // Si pas de clé ou hors-ligne, retourner l'expansion locale instantanée
  if (!activeKey || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return localResult;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: activeKey });
    const prompt = `En tant qu'assistant exégétique spécialisé dans les sermons de William Marrion Branham et l'Exposé des Sept Âges de l'Église :
Analyse la question suivante :
"${cleanQuery}"

Tâches :
1. Génère 3 à 5 synonymes ou termes doctrinaux exacts du Message associés (ex: nouvelle naissance -> jeton, baptême du Saint-Esprit).
2. Si la question est comparative ou multi-facettes, divise-la en 2 sous-questions ciblées, sinon répète la question.

Réponds STRICTEMENT sous format JSON valide sans texte avant ni après :
{
  "expandedQuery": "question enrichie avec les termes clés doctrinaux",
  "doctrinalKeywords": ["mot1", "mot2", "mot3"],
  "subQueries": ["sous_question1", "sous_question2"],
  "isMultiHop": true_ou_false
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const rawJson = response?.text;
    if (rawJson) {
      const parsed = JSON.parse(rawJson);
      return {
        originalQuery: cleanQuery,
        expandedQuery: parsed.expandedQuery || localResult.expandedQuery,
        doctrinalKeywords: Array.isArray(parsed.doctrinalKeywords) && parsed.doctrinalKeywords.length > 0 
          ? parsed.doctrinalKeywords 
          : localResult.doctrinalKeywords,
        subQueries: Array.isArray(parsed.subQueries) && parsed.subQueries.length > 0 
          ? parsed.subQueries 
          : localResult.subQueries,
        isMultiHop: Boolean(parsed.isMultiHop || localResult.isMultiHop)
      };
    }
  } catch (err) {
    console.warn('[TheologicalQueryService] Repli sur expansion locale déterministe:', err);
  }

  return localResult;
}
