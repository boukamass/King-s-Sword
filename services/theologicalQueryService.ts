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
  'dynamis': ['mecanique et dynamique', 'foi parfaite', 'saint-esprit en action', 'puissance divine'],

  // Paraphrases conceptuelles et littéraires (pont sémantique zéro terme commun)
  'interrogations matinales': ['questions et reponses', 'etude tres profonde ce matin', 'clarifier les points', 'reunions du soir'],
  'confusion vesperale': ['reunions du soir', 'mal compris', 'questions et reponses', 'lumiere du soir'],
  'usurpateur equestre': ['cavalier sur le cheval blanc', 'antichrist', 'premier sceau', 'arc', 'fleche', 'bluff'],
  'equestre immacule': ['cavalier sur le cheval blanc', 'premier sceau', 'antichrist', 'arc', 'aucune fleche'],
  'projectile': ['fleche', 'arc', 'cavalier', 'cheval blanc', 'premier sceau'],
  'eclat vesperal': ['lumiere parfaite du soir', 'zacharie', 'au temps du soir la lumiere paraitra', 'septieme ange', 'clairon'],
  'anarchie mesopotamienne': ['confusion babylonienne', 'babylone', 'rassemble ses elus', 'lumiere parfaite du soir'],
  'batisses fastueuses': ['grandeur des edifices', 'apparences exterieures', 'eloquence humaine', 'discernement spirituel'],
  'rhetorique profane': ['eloquence humaine', 'apparences exterieures', 'parole ecrite et revelee', 'verite infaillible'],
  'galette azyme': ['morceau de pain sans levain', 'communion', 'jus de cep', 'union spirituelle vivante'],
  'liqueur de vigne': ['jus de cep', 'pain sans levain', 'service de communion', 'seigneur'],
  'supplice du golgotha': ['sacrifice parfait accompli', 'calvaire', 'crucifie avec christ', 'mangez la chair', 'buvez son sang'],
  'trepasse': ['crucifie avec christ', 'ne vis plus pour moi-meme', 'christ qui vit en moi', 'resurrection'],
  'subsistance dissimulee': ['manne cachee', 'lieu tres saint', 'ancien testament', 'parole revelee'],
  'rideau sanctuaire': ['lieu tres saint', 'manne cachee', 'parole revelee de dieu', 'peuple de la promesse'],
  'instrument d\'airain': ['fete des trompettes', 'trompettes', 'rassemblement d\'israel', 'deux temoins'],
  'descendance d\'abraham': ['israel', 'cent quarante-quatre mille juifs', 'fete des trompettes', 'epouse des nations'],
  'elue ravie': ['epouse des nations est enlevee', 'enlevement', 'gloire', 'reveil d\'israel'],
  'embleme a six pointes': ['drapeau a l\'etoile de david', 'jerusalem', 'nation d\'israel est erigee', 'figuier'],
  'arbuste nourricier': ['figuier a repousse ses feuilles', 'etoile de david', 'jerusalem', 'venue du seigneur'],
  'supplication ininterrompue': ['veillons et prions sans cesse', 'trompette de dieu sonnera', 'enlevement'],
  'rapt celeste': ['enlevement', 'trompette de dieu sonnera tres bientot', 'veillons et prions'],
  'ultime admonestation': ['avertissements les plus solennels', 'derniers jours', 'eglise', 'oints du temps de la fin'],
  'averse celeste': ['pluie tombe sur le bon ble et sur l\'ivraie', 'faux christs', 'faux prophetes', 'matthieu 24'],
  'mauvaise herbe': ['ivraie', 'bon ble', 'pluie', 'semence incorruptible', 'onction'],
  'authenticite surnaturelle': ['dons spirituels', 'fruit', 'ainsi dit le seigneur', 'miracles spectaculaires'],
  'onguent ophtalmique': ['collyre divin', 'yeux spirituels oints', 'coeur pur', 'reconnaitre la verite'],
  'recif maritime': ['revelation de jesus-christ', 'montrer a ses serviteurs', 'choses qui doivent arriver bientot', 'patmos'],
  'port antique d\'ionie': ['jean a patmos', 'moi jean votre frere', 'part avec vous a la tribulation', 'royaume', 'ephese'],
  'cite martyre': ['introduction aux ages de l\'eglise', 'pleinement comprendre le message des ages', 'smyrne', 'persecution'],
  'resine broyee': ['introduction aux ages de l\'eglise', 'pleinement comprendre le message des ages', 'smyrne', 'myrrhe'],
  'pourpre cesarienne': ['ecris a l\'ange de l\'eglise de smyrne', 'le premier et le dernier', 'etait mort et qui est revenu a la vie', 'pergame'],
  'reine usurpatrice': ['ecris a l\'ange de l\'eglise de pergame', 'epee aigue a deux tranchants', 'trone de satan', 'thyatire'],
  'torpeur germanique': ['ecris a l\'ange de l\'eglise de thyatire', 'yeux comme une flamme de feu', 'fils de dieu', 'sardes'],
  'theses contestataires': ['ecris a l\'ange de l\'eglise de thyatire', 'yeux comme une flamme de feu', 'pieds semblables a de l\'airain', 'luther'],
  'sainte cene': ['communion', 'service de communion', 'pain sans levain', 'jus de cep', 'union spirituelle'],
  'cene': ['communion', 'service de communion', 'pain sans levain', 'jus de cep'],
  'imposteur': ['antichrist', 'imitant le veritable', 'cavalier sur le cheval blanc', 'bluff religieux', 'arc'],
  'etendard': ['drapeau', 'etoile de david', 'jerusalem', 'nation d\'israel'],
  'clarte vesperale': ['lumiere du soir', 'lumiere parfaite du soir', 'zacharie', 'temps du soir'],
  'magnificence': ['grandeur des edifices', 'apparences exterieures', 'eloquence humaine', 'parole'],
  'temples': ['edifices', 'grandeur des edifices', 'apparences exterieures'],
  'nourriture sacree': ['manne cachee', 'lieu tres saint', 'ancien testament', 'parole revelee'],
  'etre interieur': ['ame interieure', 'semence incorruptible', 'esprit exterieur'],
  'reverdi': ['figuier a repousse ses feuilles', 'nation d\'israel', 'jerusalem'],
  'reverdit': ['figuier a repousse ses feuilles', 'nation d\'israel', 'venue du seigneur'],
  'supercherie': ['grand bluff religieux', 'aucune fleche', 'cavalier sur le cheval blanc', 'antichrist'],
  'armement': ['portait un arc', 'aucune fleche', 'cavalier sur le cheval blanc'],
  'memorial': ['communion', 'sacrifice parfait', 'calvaire', 'pain sans levain'],
  'regeneration': ['ame interieure', 'semence incorruptible', 'esprit exterieur'],
  'seducteurs': ['faux christs', 'faux prophetes', 'miracles', 'ainsi dit le seigneur'],
  'demasques': ['discerner', 'epouse de christ', 'ainsi dit le seigneur'],
  'naitre': ['nee', 'semence incorruptible', 'ame interieure', 'nouvelle naissance'],
  'retablissement': ['nation d\'israel est erigee', 'figuier a repousse ses feuilles', 'jerusalem']
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
    /\b(compare|comparer|comparaison|difference entre|distinction.*entre)\b/,
    /\b(articule[- ]t[- ]il|relation entre|lien entre|rapport entre)\b/,
    /\b(complete[- ]t[- ]il|differe[- ]t[- ]elle|differe[- ]t[- ]il|fait[- ]elle echo|fait[- ]il echo)\b/,
    /\b(d'un cote.*de l'autre|a la fois.*et|ni les .* ni les )\b/,
    /\b(avant.*apres|evolution|comment.*alors que)\b/,
    /\b(passage de.*vers|differents aspects)\b/
  ];

  if (multiHopIndicators.some(pattern => pattern.test(norm))) {
    return true;
  }

  // Détection de 2 ou plusieurs codes de sermons distincts dans la même question (ex: 63-0324M et 65-0725M)
  const sermonCodes = norm.match(/\b\d{2}[-_]\d{4}[a-z]?\b/g);
  if (sermonCodes && new Set(sermonCodes).size >= 2) {
    return true;
  }

  return false;
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
    // Découpage heuristique local sur les connecteurs comparatifs et multi-entités
    const parts = query.split(
      /\b(?: et dans | et l['’]| et le | et la | et les | ainsi que | par rapport à | comparé à | complète-t-il | diffère-t-elle des? | diffère-t-il des? | fait-elle écho aux? | fait-il écho aux? | ni les | versus | vs )\b/i
    );
    if (parts.length > 1) {
      const cleaned = parts.map(p => p.trim()).filter(p => p.length > 3);
      if (cleaned.length >= 2) {
        subQueries = cleaned;
      }
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
Analyse la question conceptuelle ou doctrinale suivante :
"${cleanQuery}"

Tâches :
1. Mappe les termes modernes, génériques ou abstraits vers le vocabulaire historique et doctrinal exact employé par William Branham dans ses sermons et l'Exposé :
   - Exemples de transposition lexicale :
     * finances / économie / budget -> argent, dîme, offrandes, richesses, biens, dettes
     * couple / vie conjugale -> mariage, mari, femme, foyer, vie de famille, époux, épouse
     * souffrance / maladies -> guérison divine, épreuve, foi, prière
     * nouvelle naissance / conversion -> jeton, baptême du Saint-Esprit, semence prédestinée
2. Extrais 4 à 8 synonymes et mots-clés du corpus indispensables pour retrouver les passages pertinents dans les prédications (doctrinalKeywords).
3. Produis une "expandedQuery" enrichie intégrant ces termes du corpus tout en préservant rigoureusement l'intention de la question originale.
4. Si la question est comparative ou multi-facettes, divise-la en 2 sous-questions ciblées, sinon répète la question.

Réponds STRICTEMENT sous format JSON valide sans texte avant ni après :
{
  "expandedQuery": "question enrichie avec les termes clés doctrinaux du Message",
  "doctrinalKeywords": ["terme1", "terme2", "terme3", "terme4"],
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
