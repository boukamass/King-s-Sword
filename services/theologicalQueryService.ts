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
import { aiConfig } from '../config/aiConfig';

export interface ChronologicalContext {
  year?: number;
  period?: 'pre-seals' | 'post-seals' | 'early-ministry';
  location?: string;
}

export interface ExpandedTheologicalQuery {
  originalQuery: string;
  expandedQuery: string;
  doctrinalKeywords: string[];
  subQueries: string[];
  isMultiHop: boolean;
  chronologicalFilter?: ChronologicalContext;
}

// Table d'équivalence lexicale et doctrinale rapide locale (0 ms, 100% hors-ligne)
// Couvre l'ensemble des thèmes capitaux du Message du Temps de la Fin et de l'Exposé complet
const LOCAL_THEOLOGICAL_LEXICON: Record<string, string[]> = {
  // Finances, Foyer et Mariage
  'finances': ['argent', 'dime', 'richesse', 'foyer', 'couple', 'mariage', 'providence', 'materiel'],
  'argent': ['finances', 'richesse', 'dime', 'or', 'biens', 'mammon', 'providence', 'materiel'],
  'mariage': ['couple', 'mari', 'femme', 'foyer', 'famille', 'union', 'alliance', 'fiançailles', 'seduction'],
  'couple': ['mari', 'femme', 'foyer', 'mariage', 'famille', 'union', 'alliance'],
  'foyer': ['couple', 'mariage', 'famille', 'mari', 'femme', 'enfants', 'foyer chretien'],
  'dime': ['finances', 'argent', 'offrandes', 'dîme', 'melchisedek', 'sacrificateur', 'donner à dieu'],
  'dîme': ['finances', 'argent', 'offrandes', 'melchisedek', 'sacrificateur', 'donner à dieu'],

  // Le Saint-Esprit, le Jeton et la Nouvelle Naissance
  'saint-esprit': ['jeton', 'token', 'bapteme du saint-esprit', 'sceau de dieu', 'nouvelle naissance', 'vie de christ'],
  'saint esprit': ['jeton', 'token', 'bapteme du saint-esprit', 'sceau de dieu', 'nouvelle naissance'],
  'jeton': ['token', 'sang applique', 'saint-esprit lui-meme', 'vie de christ', 'signe requis', 'passeport du croyant'],
  'token': ['jeton', 'sang applique', 'vie de christ', 'bapteme du saint-esprit', 'sceau'],
  'nouvelle naissance': ['bapteme du saint-esprit', 'jeton', 'token', 'conversion', 'troisieme pull', 'genes de dieu'],

  // La Divinité, Elohim, Logos et Théophanie
  'divinite': ['elohim', 'logos', 'unite de dieu', 'jesus est dieu', 'monotheisme', 'yahweh en christ'],
  'elohim': ['dieu auto-existant', 'avant la creation', 'pensees eternelles', 'logos', 'theophanie'],
  'logos': ['parole sortie d\'elohim', 'theophanie', 'corps de parole', 'lumiere', 'christ avant l\'incarnation'],
  'theophanie': ['corps de parole', 'sixieme dimension', 'corps celeste', 'apparition', 'avant le corps de chair'],
  'théophanie': ['corps de parole', 'sixieme dimension', 'corps celeste', 'logos', 'demeure de l\'ame'],
  'melchisedek': ['roi de salem', 'sacrificateur du tres-haut', 'sans pere sans mere', 'theophanie', 'elohim en homme'],
  'melchisédek': ['roi de salem', 'sacrificateur du tres-haut', 'sans pere sans mere', 'theophanie', 'elohim en homme'],
  'melchisedec': ['roi de salem', 'sacrificateur du tres-haut', 'theophanie', 'elohim'],

  // Les Sept Sceaux et la Rédemption
  'sceaux': ['sept sceaux', 'ouverture des sceaux', 'agneau', 'livre de redemption', '1963', 'mystere de dieu'],
  'sceau': ['sept sceaux', 'ouverture des sceaux', 'agneau', 'livre de redemption'],
  'sept sceaux': ['ouverture des sceaux 1963', 'livre de redemption', 'livre scelle de sept sceaux', 'agneau immole', 'apocalypse 5 et 6'],
  '7 sceaux': ['ouverture des sceaux 1963', 'livre de redemption', 'apocalypse 5', 'sept sceaux'],
  'septieme sceau': ['septieme sceau', 'silence au ciel', 'sept trompettes', 'troisieme pull', 'retour du seigneur', 'fin du mystere'],
  '7eme sceau': ['septieme sceau', 'silence au ciel', 'troisieme pull', 'retour du seigneur'],
  'livre de redemption': ['livre de vie de l\'agneau', 'titre de propriete', 'apocalypse 5', 'rachat'],

  // Les Sept Âges de l'Église et l'Exposé complet
  'sept ages': ['expose des sept ages', 'messagers des sept ages', 'sept eglises', 'apocalypse 2 et 3'],
  '7 ages': ['sept ages de l\'eglise', 'messagers', 'expose des sept ages'],
  'ephese': ['paul', 'premier age', 'arbre de vie', 'nicolaisme', '33-170'],
  'smyrne': ['irenee', 'deuxieme age', 'persecution', 'couronne de vie', '170-312'],
  'pergame': ['martin', 'troisieme age', 'mariage de l\'eglise et de l\'etat', 'concile de nicee', '312-606'],
  'thyatire': ['colomban', 'quatrieme age', 'jezabel', 'age des tenebres', 'pape', '606-1520'],
  'sardes': ['luther', 'cinquieme age', 'justification', 'reforme', 'nom de vivre mais mort', '1520-1750'],
  'philadelphie': ['wesley', 'sixieme age', 'sanctification', 'porte ouverte', 'amour fraternel', '1750-1906'],
  'laodicee': ['dernier age', 'messager du septieme age', 'elu', 'apostasie', 'vomir', 'branham', 'malachie 4', '1906-enlevement'],
  'laodicée': ['dernier age', 'messager du septieme age', 'elu', 'apostasie', 'vomir', 'branham', 'malachie 4'],
  'messager': ['ange de l\'age', 'etoile dans sa main', 'paul', 'irenee', 'martin', 'colomban', 'luther', 'wesley', 'branham'],
  'nicolaisme': ['conquerir les laics', 'hierarchie', 'clerge', 'dogme denominational'],

  // Les Signes surnaturels et Manifestations prophétiques
  'colonne de feu': ['lumiere surnaturelle', 'ange du seigneur', 'ange de l\'alliance', 'apparition', 'photo houston 1950', 'buisson ardent'],
  'nuee': ['nuage surnaturel', 'sunset mountain', 'sept anges', 'arizona', 'fevrier 1963', 'apocalypse 10:1', 'face comme le soleil'],
  'nuée': ['nuage surnaturel', 'sunset mountain', 'sept anges', 'arizona', 'fevrier 1963', 'apocalypse 10:1'],
  'pyramide': ['pierre de faite', 'chapeau de la pyramide', 'stature d\'un homme parfait', 'vertus', 'sept vertus'],
  'pierre de faite': ['pierre de faite', 'capstone', 'chapeau de la pyramide', 'amour divin', 'couronnement'],
  'pierre de faîte': ['pierre de faite', 'capstone', 'amour divin', 'stature d\'un homme parfait'],
  'troisieme pull': ['troisieme etape', 'petite chambre', 'parole parlee', 'creation', 'troisieme phase', 'cureuils', 'poisson'],
  '3e pull': ['troisieme pull', 'petite chambre', 'parole parlee', 'creation'],

  // Doctrines et Révélations spécifiques
  'semence du serpent': ['serpent', 'seduction', 'eve', 'cain', 'arbre de la connaissance du bien et du mal', 'genese 3'],
  'predestination': ['election eternelle', 'livre de vie de l\'agneau', 'avant la fondation du monde', 'genes de dieu', 'foreordination'],
  'prédestination': ['election eternelle', 'livre de vie de l\'agneau', 'avant la fondation du monde', 'genes de dieu'],
  'bapteme d eau': ['bapteme au nom de jesus-christ', 'actes 2:38', 'immersion', 'titres pere fils saint-esprit'],
  'baptême': ['bapteme au nom de jesus-christ', 'actes 2:38', 'immersion'],
  'deux ames': ['l\'ame', 'corps esprit ame', 'nature de l\'ame', 'siege de la foi ou du doute'],
  'enlevement': ['depart', 'epouse', 'trompette de dieu', 'resurrection des morts', 'changement de corps', 'cri voix trompette'],
  'enlèvement': ['depart', 'epouse', 'trompette de dieu', 'resurrection des morts', 'changement de corps', 'cri voix trompette'],
  'cri': ['le cri est le message', 'voix de l\'archange', 'trompette de dieu', '1 thessaloniciens 4:16', 'reveil'],
  'voix de l\'archange': ['voix de l\'archange', 'resurrection', 'le cri la voix la trompette', '1 thessaloniciens 4:16'],
  'epouse': ['corps mystique de christ', 'vierge pure', 'parole faite chair', 'membres de son corps', 'union invisible'],
  'épouse': ['corps mystique de christ', 'vierge pure', 'parole faite chair', 'membres de son corps', 'union invisible'],
  'mariage de l\'agneau': ['repas des noces', 'epouse', 'union invisible de l\'epouse de christ'],
  'guerison': ['foi', 'discernement', 'don de guerison', 'vision', 'crois seulement', 'expiation'],
  'guérison': ['foi', 'discernement', 'don de guerison', 'vision', 'crois seulement', 'expiation'],
  'absolu': ['l\'ancre de l\'ame', 'parole de dieu', 'poteau d\'amarrage', 'la parole et rien d\'autre'],
  'aigle': ['nourriture emmagasinee', 'vision d\'aigle', 'prophete messager', 'la ou sera le corps mort'],
  'dynamis': ['mecanique et dynamique', 'foi parfaite', 'saint-esprit en action', 'puissance divine']
};

/**
 * Extrait les filtres chronologiques et géographiques éventuels de la requête
 */
export function extractChronologicalAndGeographicalContext(query: string): ChronologicalContext | undefined {
  if (!query || typeof query !== 'string') return undefined;
  const norm = normalizeText(query).toLowerCase();
  const context: ChronologicalContext = {};

  // 1. Détection de l'année (1933 à 1965 dans le ministère du frère Branham)
  const yearMatch = norm.match(/\b(19[3-6][0-9])\b/);
  if (yearMatch) {
    context.year = parseInt(yearMatch[1], 10);
  }

  // 2. Détection de période historique
  if (/\b(avant les sceaux|avant 1963|premier ministere|premiere etape)\b/.test(norm)) {
    context.period = 'pre-seals';
  } else if (/\b(apres les sceaux|ouverture des sceaux|apres 1963|ministere parfait)\b/.test(norm)) {
    context.period = 'post-seals';
  } else if (/\b(debut du ministere|annees 40|annees 50)\b/.test(norm)) {
    context.period = 'early-ministry';
  }

  // 3. Détection des villes ou lieux clés
  const keyLocations = [
    'jeffersonville', 'chicago', 'shreveport', 'tucson', 'phoenix', 
    'los angeles', 'houston', 'sunset mountain', 'branham tabernacle',
    'zurich', 'lausanne', 'dallas', 'indiana', 'arizona'
  ];

  for (const loc of keyLocations) {
    if (norm.includes(loc)) {
      context.location = loc;
      break;
    }
  }

  return (context.year || context.period || context.location) ? context : undefined;
}

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

  // Tri par longueur décroissante pour privilégier les expressions spécifiques sur les termes génériques
  const sortedKeys = Object.keys(LOCAL_THEOLOGICAL_LEXICON).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[.,;!?'"()\\-])${escaped}($|\\s|[.,;!?'"()\\-])`, 'i');
    if (regex.test(norm)) {
      addedKeywords.push(...LOCAL_THEOLOGICAL_LEXICON[key]);
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
      model: 'gemini-3.8-flash',
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
