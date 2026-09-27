import { searchSermons, getSermonById } from './db';
import { SearchMode, Sermon } from '../types';
import { useAppStore } from '../store';
import { normalizeText } from '../utils/textUtils';

export interface RetrievedParagraph {
  sermonId: string;
  title: string;
  date: string;
  city?: string;
  version?: string;
  paragraphIndex: number;
  content: string;
  snippet?: string;
  score?: number;
}

export interface RagSearchResult {
  query: string;
  keywordsUsed: string[];
  paragraphs: RetrievedParagraph[];
  hasResults: boolean;
  totalCandidates: number;
  message?: string;
}

export interface RagOptions {
  maxParagraphs?: number;
  minScoreThreshold?: number;
  preferredSermonIds?: string[];
}

// Mots vides (stop words) en français et anglais à ignorer lors de l'extraction des mots-clés doctrinaux
const STOP_WORDS = new Set([
  // Français
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont', 'ou',
  'a', 'dans', 'en', 'par', 'pour', 'sur', 'sous', 'vers', 'avec', 'sans', 'chez',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'lui', 'leur', 'y', 'en',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes',
  'a', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'faire', 'fais', 'font', 'dis', 'dit', 'disent', 'dire', 'parle', 'parlent', 'parler',
  'selon', 'comme', 'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles',
  'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors',
  'si', 'ne', 'pas', 'point', 'non', 'oui', 'peut', 'peuvent', 'pouvoir',
  'branham', 'william', 'frere', 'brother', 'message', 'sermon', 'sermons',
  // Anglais
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'doing', 'say', 'says', 'said', 'what', 'which', 'who',
  'whom', 'this', 'that', 'these', 'those', 'am', 'it', 'its'
]);

/**
 * Extrait les termes doctrinaux significatifs d'une question en langage naturel
 */
export const extractSearchKeywords = (query: string): string[] => {
  if (!query || typeof query !== 'string') return [];

  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const filtered = words.filter(w => !STOP_WORDS.has(w));

  // Si le filtrage a tout supprimé (ex: requête très courte comme "Que dit-il ?"), garder les mots de plus de 3 lettres
  if (filtered.length === 0) {
    return words.filter(w => w.length > 3);
  }

  // Dédupliquer tout en préservant l'ordre d'apparition
  return Array.from(new Set(filtered));
};

/**
 * Récupère le texte complet d'un paragraphe donné à partir du store ou de la base
 */
const fetchFullParagraphContent = async (sermonId: string, paragraphIndex: number): Promise<string | null> => {
  const store = useAppStore.getState();
  
  // 1. Essayer depuis le cache en mémoire (store Zustand)
  const cachedSermon = store.sermonsMap.get(sermonId) as Sermon | undefined;
  if (cachedSermon?.text) {
    const paragraphs = cachedSermon.text.split(/\n\s*\n/);
    if (paragraphIndex >= 1 && paragraphIndex <= paragraphs.length) {
      return paragraphs[paragraphIndex - 1].trim();
    }
  }

  // 2. Essayer via le service de base de données
  try {
    const dbSermon = await getSermonById(sermonId);
    if (dbSermon?.text) {
      const paragraphs = dbSermon.text.split(/\n\s*\n/);
      if (paragraphIndex >= 1 && paragraphIndex <= paragraphs.length) {
        return paragraphs[paragraphIndex - 1].trim();
      }
    }
  } catch (err) {
    console.warn(`[RAG] Erreur lors de la récupération du sermon ${sermonId}:`, err);
  }

  return null;
};

/**
 * Calcule un score de pertinence pour classer les paragraphes récupérés
 */
const calculateParagraphRelevance = (
  content: string,
  keywords: string[],
  cleanQuestion: string,
  title: string
): number => {
  let score = 0;
  const normalizedContent = normalizeText(content);
  const normalizedQuestion = normalizeText(cleanQuestion);
  const normalizedTitle = normalizeText(title);

  // Bonus 1: Correspondance exacte de l'expression ou sous-phrase (très forte valeur)
  if (normalizedQuestion.length > 6 && normalizedContent.includes(normalizedQuestion)) {
    score += 60;
  }

  // Bonus 2: Présence des mots-clés
  let matchedKeywordsCount = 0;
  keywords.forEach(kw => {
    const kwNorm = normalizeText(kw);
    if (!kwNorm) return;
    
    // Fréquence du mot-clé dans le paragraphe
    const regex = new RegExp(`\\b${kwNorm}`, 'gi');
    const matches = normalizedContent.match(regex);
    if (matches && matches.length > 0) {
      matchedKeywordsCount++;
      // Score plafonné par mot-clé pour éviter qu'un mot très répété n'écrase tout
      score += Math.min(matches.length * 10, 30);
    }

    // Bonus si le mot-clé est aussi présent dans le titre du sermon
    if (normalizedTitle.includes(kwNorm)) {
      score += 15;
    }
  });

  // Bonus 3: Couverture complète des mots-clés recherchés
  if (keywords.length > 0 && matchedKeywordsCount === keywords.length) {
    score += 40;
  } else if (keywords.length > 1 && matchedKeywordsCount >= Math.ceil(keywords.length / 2)) {
    score += 15;
  }

  return score;
};

/**
 * Service principal de RAG hybride :
 * Recherche automatique des paragraphes de sermons les plus pertinents pour une question
 */
export const retrieveRelevantSermonPassages = async (
  question: string,
  options: RagOptions = {}
): Promise<RagSearchResult> => {
  const maxParagraphs = options.maxParagraphs || 10;
  const minScoreThreshold = options.minScoreThreshold || 10;

  const rawTrimmed = (question || '').trim();
  if (!rawTrimmed) {
    return {
      query: question,
      keywordsUsed: [],
      paragraphs: [],
      hasResults: false,
      totalCandidates: 0,
      message: 'Question vide.'
    };
  }

  const keywords = extractSearchKeywords(rawTrimmed);

  if (keywords.length === 0) {
    return {
      query: question,
      keywordsUsed: [],
      paragraphs: [],
      hasResults: false,
      totalCandidates: 0,
      message: "Aucun mot-clé significatif identifié dans la question pour cibler les sermons."
    };
  }

  // Stratégie de recherche multi-passes
  const candidatesMap = new Map<string, RetrievedParagraph>();

  const executeSearchPass = async (queryStr: string, mode: SearchMode, limit: number) => {
    try {
      const results = await searchSermons({
        query: queryStr,
        mode,
        limit,
        offset: 0
      });

      if (results && Array.isArray(results)) {
        for (const item of results) {
          const dedupeKey = `${item.sermonId}#${item.paragraphIndex}`;
          if (!candidatesMap.has(dedupeKey)) {
            candidatesMap.set(dedupeKey, {
              sermonId: item.sermonId,
              title: item.title || 'Sermon',
              date: item.date || '',
              city: item.city || '',
              paragraphIndex: Number(item.paragraphIndex) || 1,
              content: item.content || item.snippet?.replace(/<[^>]+>/g, '') || '',
              snippet: item.snippet,
              score: 0
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[RAG] Erreur recherche pass '${queryStr}' (mode ${mode}):`, err);
    }
  };

  // 1. Première passe : recherche par combinaison stricte (EXACT_WORDS) des mots-clés
  const combinedAllQuery = keywords.slice(0, 4).join(' ');
  await executeSearchPass(combinedAllQuery, SearchMode.EXACT_WORDS, 30);

  // 2. Deuxième passe : si peu de résultats, recherche par combinaison large (DIVERSE)
  if (candidatesMap.size < 5 && keywords.length > 1) {
    const combinedDiverseQuery = keywords.slice(0, 6).join(' ');
    await executeSearchPass(combinedDiverseQuery, SearchMode.DIVERSE, 40);
  }

  // 3. Troisième passe : si toujours aucun résultat, tenter les 2 premiers mots-clés individuellement
  if (candidatesMap.size === 0) {
    for (const kw of keywords.slice(0, 2)) {
      await executeSearchPass(kw, SearchMode.EXACT_PHRASE, 20);
      if (candidatesMap.size >= 5) break;
    }
  }

  const allCandidates = Array.from(candidatesMap.values());

  if (allCandidates.length === 0) {
    return {
      query: question,
      keywordsUsed: keywords,
      paragraphs: [],
      hasResults: false,
      totalCandidates: 0,
      message: `Aucun passage de sermon correspondant aux termes [${keywords.join(', ')}] n'a été trouvé.`
    };
  }

  // Enrichissement et scoring des candidats
  const scoredParagraphs: RetrievedParagraph[] = [];

  for (const candidate of allCandidates) {
    // Si le contenu complet n'était pas fourni par le FTS/WebSearch, le charger
    let fullContent = candidate.content;
    if (!fullContent || fullContent.length < 80) {
      const fetched = await fetchFullParagraphContent(candidate.sermonId, candidate.paragraphIndex);
      if (fetched) {
        fullContent = fetched;
      }
    }

    const calculatedScore = calculateParagraphRelevance(
      fullContent,
      keywords,
      rawTrimmed,
      candidate.title
    );

    scoredParagraphs.push({
      ...candidate,
      content: fullContent,
      score: calculatedScore
    });
  }

  // Filtrer par score minimum et trier par pertinence décroissante
  const filtered = scoredParagraphs
    .filter(p => (p.score ?? 0) >= minScoreThreshold)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Si le seuil a tout éliminé mais qu'on avait des résultats, conserver les meilleurs
  const finalResults = filtered.length > 0
    ? filtered.slice(0, maxParagraphs)
    : scoredParagraphs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, Math.min(3, maxParagraphs));

  return {
    query: question,
    keywordsUsed: keywords,
    paragraphs: finalResults,
    hasResults: finalResults.length > 0,
    totalCandidates: allCandidates.length
  };
};

/**
 * Formate les paragraphes récupérés en un bloc de contexte structuré et non ambigu pour le modèle Gemini
 */
export const formatRagContextForGemini = (
  paragraphs: RetrievedParagraph[],
  question: string
): string => {
  if (!paragraphs || paragraphs.length === 0) {
    return "AUCUNE SOURCE DISPONIBLE DANS LA BASE DOCUMENTAIRE.";
  }

  const sourcesList = paragraphs.map((p, idx) => {
    return `[SOURCE ${idx + 1}]
Sermon : "${p.title}"
Date : ${p.date || 'Date inconnue'} | Lieu : ${p.city || 'Inconnu'}
RÉFÉRENCE OBLIGATOIRE : [Réf: ${p.sermonId}, Para. ${p.paragraphIndex}]
TEXTE EXACT DU PARAGRAPHE ${p.paragraphIndex} :
"""
${p.content}
"""`;
  }).join('\n\n------------------------------------------------------------\n\n');

  return `EXTRAITS DES SERMONS RETROUVÉS DANS LA BIBLIOTHÈQUE POUR CETTE QUESTION :
============================================================
${sourcesList}
============================================================

CONSIGNES STRICTES POUR LA RÉPONSE :
1. Réponds à la question en t'appuyant EXCLUSIVEMENT sur les extraits ci-dessus.
2. Pour chaque point explicité, cite obligatoirement la référence correspondante sous la forme exacte :
   > « Citation du sermon... » [Réf: ID_SERMON, Para. N]
3. N'invente aucun enseignement qui ne figure pas clairement dans ces extraits.
4. Si les extraits ci-dessus ne répondent pas directement à la question, réponds : « Les sermons disponibles dans la base documentaire ne contiennent pas d'informations suffisantes pour répondre à cette question. »`;
};
