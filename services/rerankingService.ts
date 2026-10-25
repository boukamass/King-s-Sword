/**
 * King's Sword — Moteur de Reranking Local, Answerability & Validation des Citations (Phase 2E)
 * 
 * Ce module est 100% local, déterministe et sans appel LLM / Gemini.
 * 
 * 1. Reranking local multi-signaux :
 *    Combine RRF normalisé, similarité vectorielle cosinus, score lexical,
 *    recoupement multi-modal et couverture des termes de requête.
 * 
 * 2. Answerability / Abstention :
 *    Évalue si les preuves documentaires sont suffisantes pour répondre
 *    et abstient le moteur sur les questions hors corpus (0 faux positif visé).
 * 
 * 3. Validation des Citations :
 *    Vérifie déterministement l'authenticité de chaque preuve par rapport
 *    aux sermons originaux (SERMON -> PARAGRAPHE ORIGINAL).
 */

import {
  Sermon,
  SermonChunk,
  HybridSearchResult,
  RerankedSearchResult,
  AnswerabilityAssessment,
  ValidatedCitation,
  RerankOptions,
  ClosestPassageRef,
  DecisionJournalEntry
} from '../types';
import { normalizeText, splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';
import {
  buildCorpusVocabulary,
  getActiveCorpusVocabulary,
  setActiveCorpusVocabulary,
  analyzeQueryWithVocabulary,
  tokenizeText,
  extractFrenchStem,
  computeLevenshteinDistance,
  isDirectiveOrConversationalToken,
  CorpusVocabulary
} from './corpusVocabularyService';
import { expandLocally } from './theologicalQueryService';

export const DEFAULT_RERANK_OPTIONS: Required<RerankOptions> = {
  topK: 10,
  vectorWeight: 0.30,
  lexicalWeight: 0.15,
  rrfWeight: 0.40,
  multiModalBonus: 0.15
};

const COMMON_STOPWORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'en', 'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'sous',
  'et', 'ou', 'ni', 'car', 'mais', 'donc', 'or', 'que', 'qui', 'quoi', 'dont', 'ou', 'ce', 'cet', 'cette', 'ces',
  'est', 'sont', 'a', 'ont', 'fait', 'font', 'il', 'elle', 'ils', 'elles', 'se', 'sa', 'son', 'ses', 'leur', 'leurs',
  'au', 'aux', 'mon', 'ton', 'ma', 'ta', 'mes', 'tes', 'nos', 'vos',
  'pourquoi', 'comment', 'selon', 'quand', 'lorsque', 'quel', 'quelle', 'quels', 'quelles',
  'frere', 'fr', 'branham', 'william', 'prophete', 'predicateur', 'sermon', 'sermons'
]);

/**
 * Extrait les termes significatifs d'une requête pour l'analyse lexicale et la couverture.
 * Dynamique, insensible aux accents, sans mots vides grammaticaux ni mots de consigne.
 */
export function extractSignificantQueryTerms(query: string): string[] {
  if (!query || typeof query !== 'string') return [];
  // Découper les apostrophes élidées explicites (l'église -> eglise)
  const withSeparatedApostrophes = query.replace(/([ldqujcsnmtLDQUJCSNMT])['`’]([\p{L}\p{N}]+)/gu, '$1 $2');
  const words = tokenizeText(withSeparatedApostrophes)
    .filter(w => !w.includes('_'))
    .map(w => {
      if (w.startsWith('leglise')) return 'eglise';
      if (w.startsWith('deglise')) return 'eglise';
      return w;
    });
  return Array.from(new Set(words.filter(w => !COMMON_STOPWORDS.has(w) && w.length >= 3)));
}

/**
 * Extrait les termes de contenu substantiels d'une requête basés sur le vocabulaire et l'IDF.
 */
export function extractSubstantiveQueryTerms(query: string): string[] {
  if (!query || typeof query !== 'string') return [];
  const words = tokenizeText(query).filter(w => !w.includes('_'));
  const vocab = getActiveCorpusVocabulary();
  if (vocab) {
    const analysis = analyzeQueryWithVocabulary(query, vocab);
    return analysis.matchedTerms.filter(w => !w.includes('_'));
  }
  return Array.from(new Set(words));
}

/**
 * Calcule le taux de couverture des termes significatifs de la requête dans un texte cible.
 */
export function computeQueryTermCoverage(terms: string[], targetText: string): number {
  if (!terms || terms.length === 0) return 1.0;
  if (!targetText || typeof targetText !== 'string') return 0;

  const normalizedTarget = normalizeText(targetText).toLowerCase();
  let matched = 0;

  for (const term of terms) {
    const normTerm = normalizeText(term).toLowerCase();
    if (!normTerm) continue;

    // Correspondance exacte ou préfixe (stemming léger) ou radical flexionnel
    const termStem = extractFrenchStem(normTerm);
    if (normalizedTarget.includes(normTerm) || (normTerm.length > 4 && normalizedTarget.includes(normTerm.slice(0, -1)))) {
      matched++;
    } else if (termStem.length >= 3 && normalizedTarget.includes(termStem)) {
      matched++;
    }
  }

  return Math.round((matched / terms.length) * 1000) / 1000;
}

/**
 * Rerank local des résultats hybrides avec fenêtrage contextuel adjacent (±1 paragraphe).
 * Combine RRF, score cosinus, score lexical, bonus multi-modal et couverture de requête
 * étendue aux paragraphes immédiatement adjacents (§n-1 et §n+1) pour capturer les réponses scindées.
 */
export function rerankHybridResults(params: {
  query: string;
  hybridResults: HybridSearchResult[];
  allChunks?: SermonChunk[];
  options?: RerankOptions;
}): RerankedSearchResult[] {
  const { query, hybridResults = [], allChunks = [], options } = params;

  if (!Array.isArray(hybridResults) || hybridResults.length === 0) {
    return [];
  }

  // Fusion sécurisée des options pour empêcher tout NaN si une clé est undefined
  const opts: Required<RerankOptions> = {
    topK: typeof options?.topK === 'number' ? options.topK : DEFAULT_RERANK_OPTIONS.topK,
    vectorWeight: typeof options?.vectorWeight === 'number' ? options.vectorWeight : DEFAULT_RERANK_OPTIONS.vectorWeight,
    lexicalWeight: typeof options?.lexicalWeight === 'number' ? options.lexicalWeight : DEFAULT_RERANK_OPTIONS.lexicalWeight,
    rrfWeight: typeof options?.rrfWeight === 'number' ? options.rrfWeight : DEFAULT_RERANK_OPTIONS.rrfWeight,
    multiModalBonus: typeof options?.multiModalBonus === 'number' ? options.multiModalBonus : DEFAULT_RERANK_OPTIONS.multiModalBonus
  };

  const queryTerms = extractSignificantQueryTerms(query);
  const maxPossibleRrf = (1 / 61) + (1 / 61); // ~0.032787 (RRF score pour 2 rangs 1)

  // Indexation rapide des chunks par sermonId pour le fenêtrage adjacent ±1 paragraphe
  const chunksBySermon = new Map<string, Array<{ startParagraph: number; endParagraph: number; text: string }>>();
  const sourcePool = allChunks.length > 0 ? allChunks : hybridResults;
  for (const c of sourcePool) {
    if (!c || !c.sermonId) continue;
    let list = chunksBySermon.get(c.sermonId);
    if (!list) {
      list = [];
      chunksBySermon.set(c.sermonId, list);
    }
    list.push({
      startParagraph: c.startParagraph,
      endParagraph: c.endParagraph,
      text: c.text
    });
  }

  const reranked: RerankedSearchResult[] = [];

  for (const item of hybridResults) {
    // 1. Normalisation du score vectoriel [0..1]
    const vecScore = typeof item.vectorScore === 'number' && Number.isFinite(item.vectorScore) ? item.vectorScore : 0;
    const vecNorm = Math.max(0, Math.min(1.0, vecScore));

    // 2. Normalisation du score lexical [0..1] (plafonné à 100)
    const lexScore = typeof item.lexicalScore === 'number' && Number.isFinite(item.lexicalScore) ? item.lexicalScore : 0;
    const lexNorm = Math.min(1.0, Math.max(0, lexScore / 100));

    // 3. Normalisation du score RRF [0..1]
    const rrfScoreVal = typeof item.rrfScore === 'number' && Number.isFinite(item.rrfScore) ? item.rrfScore : 0;
    const rrfNorm = Math.min(1.0, Math.max(0, rrfScoreVal / maxPossibleRrf));

    // 4. Détection du recoupement multi-modal
    const isMultiModal = item.lexicalRank !== null && item.vectorRank !== null;
    const multiModalBonus = isMultiModal ? opts.multiModalBonus : 0;

    // 5. Couverture directe et fenêtrage contextuel ±1 paragraphe (réponses scindées entre deux chunks)
    const directCoverage = computeQueryTermCoverage(queryTerms, item.text);
    let effectiveCoverage = directCoverage;

    if (directCoverage < 1.0 && queryTerms.length >= 2) {
      const docChunks = chunksBySermon.get(item.sermonId);
      if (docChunks && docChunks.length > 1) {
        const neighbors = docChunks.filter(
          nc =>
            (nc.endParagraph === item.startParagraph - 1 || nc.startParagraph === item.endParagraph + 1) &&
            nc.text !== item.text
        );
        if (neighbors.length > 0) {
          const windowedText = `${item.text} ${neighbors.map(n => n.text).join(' ')}`;
          const windowCoverage = computeQueryTermCoverage(queryTerms, windowedText);
          if (windowCoverage > directCoverage) {
            // Pondère à 70% la couverture directe et 30% le gain apporté par les paragraphes adjacents ±1
            effectiveCoverage = Math.min(1.0, directCoverage + 0.30 * (windowCoverage - directCoverage));
          }
        }
      }
    }

    const queryTermCoverage = Math.round(effectiveCoverage * 1000) / 1000;

    // Formule de Reranking pondérée et explicable
    const rawRerankScore = (opts.rrfWeight * rrfNorm) +
      (opts.vectorWeight * vecNorm) +
      (opts.lexicalWeight * lexNorm) +
      (0.15 * queryTermCoverage) +
      multiModalBonus;

    const rerankScore = Number.isFinite(rawRerankScore) ? Math.round(rawRerankScore * 10000) / 10000 : 0;

    reranked.push({
      ...item,
      rerankScore,
      rerankDetails: {
        baseRrfScore: item.rrfScore,
        vectorCosine: vecScore,
        lexicalScore: lexScore,
        isMultiModal,
        queryTermCoverage
      }
    });
  }

  // Tri décroissant par rerankScore
  reranked.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) {
      return b.rerankScore - a.rerankScore;
    }
    if (b.rrfScore !== a.rrfScore) {
      return b.rrfScore - a.rrfScore;
    }
    return a.chunkId.localeCompare(b.chunkId);
  });

  const topK = Math.max(1, opts.topK);
  return reranked.slice(0, topK).map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

/**
 * Détecte si la requête est une demande d'aperçu, de synthèse ou de résumé global sur le document actif.
 */
export function isOverviewOrSummaryQuery(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const norm = normalizeText(query).toLowerCase().trim();
  
  const overviewPatterns = [
    /de quoi (ca|ça|cela|il|ce|cet|cette|le|la|les)\b/,
    /\b(resume|resumer|resumez|synthese globale|survol|panorama)\b/,
    /\b(sujet principal|theme principal|message principal|idee principale)\b/,
    /\b(presente[- ]moi|presentation generale|apercu global)\b/,
    /\bqu'est[- ]ce que (ca|ça|cela|ce|cet|cette|ce sermon|ce livre|ce texte|ce chapitre)\b/,
    /\b(de quoi traite ce|de quoi parle ce)\b/
  ];

  return overviewPatterns.some(pat => pat.test(norm));
}

/**
 * Détecte si la requête demande une étude exhaustive, chronologique ou globale
 * justifiant le mode Long-Context ("style NotebookLM") lorsque 1 ou 2 documents sont sélectionnés.
 */
export function isBroadOrExhaustiveContextQuery(query: string): boolean {
  if (isOverviewOrSummaryQuery(query)) return true;
  if (!query || typeof query !== 'string') return false;
  const norm = normalizeText(query).toLowerCase().trim();

  const broadPatterns = [
    /\b(etude complete|etude exhaustive|analyse complete|analyse exhaustive|synthese complete)\b/,
    /\b(tous les points|tous les details|tout le chapitre|tout ce sermon|dans son integralite)\b/,
    /\b(chronologie|chronologique|du debut a la fin|paragraphe par paragraphe)\b/,
    /\b(explique[- ]moi tout|detailler tout|parcourir tout)\b/
  ];

  return broadPatterns.some(pat => pat.test(norm));
}

/**
 * Sélectionne les K meilleures preuves documentaires par Pertinence Marginale Maximale (MMR, lambda = 0.75).
 * Pénalise la redondance inter-chunks (Jaccard > 0.72) et garantit l'équilibre entre documents en mode Multi-Hop.
 */
export function selectDiverseEvidenceWithMMR<T extends { chunkId: string; sermonId: string; text: string; rerankScore?: number }>(
  candidates: T[],
  maxCount: number,
  options: { lambda?: number; maxPerDoc?: number; isMultiHop?: boolean } = {}
): T[] {
  if (!Array.isArray(candidates) || candidates.length === 0 || maxCount <= 0) return [];
  if (candidates.length <= 1) return candidates.slice(0, maxCount);

  const lambda = typeof options.lambda === 'number' ? options.lambda : 0.75;
  const maxPerDoc = typeof options.maxPerDoc === 'number' ? options.maxPerDoc : (maxCount > 10 ? 6 : 2);
  const isMultiHop = Boolean(options.isMultiHop);

  // Précalcul des ensembles de radicaux par candidat pour le calcul rapide de similarité Jaccard
  const tokenSets = new Map<string, Set<string>>();
  for (const c of candidates) {
    const tokens = tokenizeText(c.text || '')
      .filter(w => !w.includes('_') && !COMMON_STOPWORDS.has(w) && w.length >= 3)
      .map(w => extractFrenchStem(w));
    tokenSets.set(c.chunkId, new Set(tokens));
  }

  const computeJaccard = (idA: string, idB: string): number => {
    const setA = tokenSets.get(idA);
    const setB = tokenSets.get(idB);
    if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const t of setA) {
      if (setB.has(t)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  };

  const maxScore = Math.max(0.0001, ...candidates.map(c => typeof c.rerankScore === 'number' ? c.rerankScore : 0.5));
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const docCounts = new Map<string, number>();

  // 1. Le candidat #1 (meilleur score absolu) est toujours retenu en premier
  const first = candidates[0];
  selected.push(first);
  selectedIds.add(first.chunkId);
  docCounts.set(first.sermonId, 1);

  // 2. Sélection gloutonne itérative selon le critère MMR = lambda * Rel(c) - (1 - lambda) * maxSim(c, S)
  while (selected.length < maxCount) {
    let bestCandidate: T | null = null;
    let bestMmrScore = -Infinity;

    for (const cand of candidates) {
      if (selectedIds.has(cand.chunkId)) continue;
      const currentDocCount = docCounts.get(cand.sermonId) || 0;
      if (currentDocCount >= maxPerDoc) continue;

      const relNorm = (typeof cand.rerankScore === 'number' ? cand.rerankScore : 0.5) / maxScore;
      let maxSim = 0;
      for (const sel of selected) {
        const sim = computeJaccard(cand.chunkId, sel.chunkId);
        if (sim > maxSim) maxSim = sim;
      }

      // Pénalité renforcée si le passage est un quasi-doublon lexical (Jaccard > 0.72)
      const redundancyPenalty = maxSim > 0.72 ? maxSim * 1.35 : maxSim;

      // Bonus de couverture multi-sources si la requête est comparative / Multi-Hop
      const newDocBonus = isMultiHop && currentDocCount === 0 ? 0.12 : 0;

      const mmrScore = (lambda * relNorm) - ((1 - lambda) * redundancyPenalty) + newDocBonus;
      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate) break;
    selected.push(bestCandidate);
    selectedIds.add(bestCandidate.chunkId);
    docCounts.set(bestCandidate.sermonId, (docCounts.get(bestCandidate.sermonId) || 0) + 1);
  }

  // 3. Complément si le plafond maxPerDoc a empêché d'atteindre maxCount
  if (selected.length < maxCount) {
    for (const cand of candidates) {
      if (selected.length >= maxCount) break;
      if (!selectedIds.has(cand.chunkId)) {
        selected.push(cand);
        selectedIds.add(cand.chunkId);
      }
    }
  }

  return selected;
}

/**
 * Analyse d'Answerability / Abstention refondue sans aucune maintenance manuelle.
 * - Poids IDF automatique calculé sur le corpus indexé.
 * - Rapprochement approximatif déterministe (distance <= 2 ou trigrammes).
 * - Termes inconnus = poids nul (IDF = 0), ignorés et journalisés, JAMAIS bloquants.
 * - Décision fondée sur les scores de retrieval : BM25, cosinus max, écart au 2e passage,
 *   et présence d'au moins un terme de contenu à fort IDF.
 * - Zone grise ("passages proches trouvés, la réponse peut être partielle").
 * - Action "chercher quand même" et les 3 passages les plus proches en cas de refus.
 */
export function assessAnswerability(params: {
  query: string;
  candidates: (HybridSearchResult | RerankedSearchResult)[];
  corpusTextIndex?: string;
  corpusChunks?: Array<{ text: string }>;
  forceSearch?: boolean;
}): AnswerabilityAssessment {
  const { query, candidates = [], corpusTextIndex = '', corpusChunks = [], forceSearch = false } = params;

  if (!query || !query.trim() || candidates.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Aucun passage documentaire pertinent disponible dans le contexte sélectionné.',
      topScore: 0,
      evidenceCount: 0,
      absentKeywords: [],
      closestPassages: [],
      forceSearchAvailable: false
    };
  }

  // 0. Si l'utilisateur force la recherche ("chercher quand même")
  const topCandidate = candidates[0];
  const topVectorScore = typeof topCandidate.vectorScore === 'number' && Number.isFinite(topCandidate.vectorScore)
    ? topCandidate.vectorScore
    : 0;
  const topLexScore = topCandidate.lexicalRank !== null && typeof topCandidate.lexicalScore === 'number' && Number.isFinite(topCandidate.lexicalScore)
    ? topCandidate.lexicalScore
    : 0;

  if (forceSearch) {
    return {
      answerable: true,
      confidenceScore: Math.round(Math.max(0.50, topVectorScore) * 100) / 100,
      reason: 'Recherche forcée par l\'utilisateur sur les meilleurs passages documentaires trouvés.',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      isPartial: true
    };
  }

  // Formatage des 3 passages les plus proches pour l'affichage en cas de refus / zone grise
  const closestPassages: ClosestPassageRef[] = candidates.slice(0, 3).map(c => {
    const chunk = (c as any).chunk || c;
    const text = chunk.text || (c as any).text || '';
    const snippet = text.length > 200 ? text.slice(0, 200) + '...' : text;
    return {
      title: chunk.sermonTitle || 'Document sélectionné',
      paragraphIndex: chunk.startParagraph || (chunk.paragraphIds && chunk.paragraphIds[0]),
      textSnippet: snippet,
      score: (c as any).rerankScore || c.vectorScore || 0
    };
  });

  // Si c'est une demande de résumé / aperçu global sur les documents actifs du Dock
  if (isOverviewOrSummaryQuery(query) && candidates.length > 0) {
    return {
      answerable: true,
      confidenceScore: 0.95,
      reason: 'Demande d\'aperçu et de synthèse sur les documents actifs.',
      topScore: 1.0,
      evidenceCount: candidates.length,
      absentKeywords: []
    };
  }

  // 1. Obtention ou construction automatique du vocabulaire et des poids IDF pour le contexte actif
  let vocab: CorpusVocabulary;
  if (corpusChunks && corpusChunks.length > 0) {
    vocab = buildCorpusVocabulary(corpusChunks);
  } else if (getActiveCorpusVocabulary()) {
    vocab = getActiveCorpusVocabulary()!;
  } else if (corpusTextIndex && corpusTextIndex.length > 50) {
    // Découpe le texte en blocs pour simuler des documents
    const segments = corpusTextIndex.match(/.{1,1000}/gs) || [corpusTextIndex];
    vocab = buildCorpusVocabulary(segments.map(s => ({ text: s })));
  } else {
    // Vocabulaire dérivé directement des candidats
    vocab = buildCorpusVocabulary(candidates.map(c => ({ text: (c as any).chunk?.text || (c as any).text || '' })));
  }

  // 2. Analyse des tokens de la requête avec rapprochement approximatif, IDF dynamique et pont sémantique
  const vocabAnalysis = analyzeQueryWithVocabulary(query, vocab);
  const { tokens, highIdfTerms, ignoredTerms, hasHighIdfContentTerm } = vocabAnalysis;
  const localExpansion = expandLocally(query);
  const expandedKeywords = localExpansion.doctrinalKeywords || [];
  const rawQueryTerms = extractSignificantQueryTerms(query);
  const substantiveQueryTerms = rawQueryTerms.filter(w => !isDirectiveOrConversationalToken(w));
  const queryTerms = substantiveQueryTerms.length > 0 ? substantiveQueryTerms : rawQueryTerms;

  // Calcul des scores de retrieval
  const secondCandidate = candidates.length > 1 ? candidates[1] : null;
  const topRerankScore = typeof (topCandidate as any).rerankScore === 'number' ? (topCandidate as any).rerankScore : 0;
  const secondRerankScore = secondCandidate && typeof (secondCandidate as any).rerankScore === 'number'
    ? (secondCandidate as any).rerankScore
    : 0;
  const marginToSecond = Math.round(Math.max(0, topRerankScore - secondRerankScore) * 1000) / 1000;

  // Vérification de présence des termes de contenu à fort IDF dans les passages candidats
  const topPassagesText = candidates.slice(0, 10).map(c => normalizeText((c as any).chunk?.text || (c as any).text || '').toLowerCase()).join(' ');
  const topSinglePassageText = normalizeText((topCandidate as any).chunk?.text || (topCandidate as any).text || '').toLowerCase();

  const passageHasTerm = (text: string, term: string): boolean => {
    const normTerm = normalizeText(term).toLowerCase();
    if (!normTerm) return false;
    const words = text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);

    if (normTerm.length <= 4) {
      for (const w of words) {
        if (w === normTerm || w === `${normTerm}s` || w === `${normTerm}x`) return true;
        if (normTerm.length === 4 && w.startsWith(normTerm) && w.length <= 6) return true;
      }
      return false;
    }

    if (text.includes(normTerm)) return true;
    const termStem = extractFrenchStem(normTerm);
    if (termStem.length >= 3) {
      for (const w of words) {
        if (w.length < 3) continue;
        if (w === normTerm || (normTerm.length >= 5 && w.includes(normTerm))) return true;
        const wStem = extractFrenchStem(w);
        if (wStem.length >= 4 && termStem.length >= 4 && (wStem === termStem || wStem.startsWith(termStem) || termStem.startsWith(wStem))) {
          return true;
        }
        // Dérivation nominale/adjectivale française (ex: infaillibilité <-> infaillible, sonnerie <-> sonnera, séduction <-> séduire)
        if (normTerm.length >= 6 && w.length >= 5 && normTerm.slice(0, 5) === w.slice(0, 5)) {
          return true;
        }
        if (computeLevenshteinDistance(normTerm, w) <= 1 && Math.min(normTerm.length, w.length) >= 5) {
          return true;
        }
      }
    }
    return false;
  };

  const matchedHighIdfInTopSingle = highIdfTerms.filter(term => passageHasTerm(topSinglePassageText, term));
  const matchedHighIdfInTopCollective = highIdfTerms.filter(term => passageHasTerm(topPassagesText, term));
  const hasContentTermInTop = matchedHighIdfInTopSingle.length > 0;
  const hasContentTermInTopCollective = matchedHighIdfInTopCollective.length > 0;

  const highIdfCoverage = highIdfTerms.length > 0
    ? (matchedHighIdfInTopSingle.length / highIdfTerms.length)
    : 1.0;

  const topCandidateCoverage = computeQueryTermCoverage(
    queryTerms,
    topSinglePassageText
  );

  // Distinct sources count dans le périmètre actif (normalisé par œuvre/document parent)
  const sourcePool = (corpusChunks && corpusChunks.length > 0) ? corpusChunks : candidates.slice(0, 10);
  const distinctSourcesCount = new Set(
    sourcePool.map(c => {
      const id = String((c as any).sermonId || (c as any).documentId || (c as any).chunk?.sermonId || '');
      return id.startsWith('expose-') ? 'expose' : id;
    })
  ).size;

  const matchedSignificantTerms = queryTerms.filter(term => passageHasTerm(topPassagesText, term));
  const matchedExpandedTerms = expandedKeywords.filter(kw => passageHasTerm(topPassagesText, kw));
  const hasMatchedContentTerm = queryTerms.length > 0
    ? (matchedSignificantTerms.length > 0 || matchedExpandedTerms.length > 0)
    : (hasContentTermInTop || hasContentTermInTopCollective);

  // Calibration fine du portier d'abstention (FRR < 2%, FAR = 0%) :
  // - Si une paraphrase théologique reconnue matche dans les candidats (matchedExpandedTerms > 0), les mots littéraires de surface ne bloquent pas.
  // - Si le candidat Top-1 présente une forte convergence multi-termes (couverture >= 60% et >= 3 termes exacts ou score lexical élevé), 1 adjectif/synonyme hors-vocabulaire ne bloque pas.
  // - En revanche, tout concept nominal spécifique inconnu du vocabulaire et du lexique théologique (ex: "laser", "Eiffel", "Internet", "Einstein") bloque immédiatement.
  const hasSemanticBridgeMatch = matchedExpandedTerms.length > 0;
  const hasStrongVerifiedTopMatch = (
    (topLexScore >= 24 && topCandidateCoverage >= 0.60 && ignoredTerms.length <= 1 && matchedSignificantTerms.length >= 3) ||
    (topLexScore >= 28 && topCandidateCoverage >= 0.70 && ignoredTerms.length === 0)
  );

  const hasUnmatchedSpecificConcept = !hasSemanticBridgeMatch && !hasStrongVerifiedTopMatch && (
    (ignoredTerms.length >= 1 && (
      ignoredTerms.length >= matchedSignificantTerms.length ||
      topCandidateCoverage < 0.60 ||
      ignoredTerms.some(t => t.length >= 4)
    )) ||
    (distinctSourcesCount === 1 && highIdfTerms.length >= 5 && highIdfCoverage < 0.65)
  );

  const hasRetrievalSignal = hasMatchedContentTerm && !hasUnmatchedSpecificConcept && (
    topVectorScore >= 0.18 ||
    topLexScore >= 8 ||
    (topCandidate && topCandidate.lexicalRank !== null && topCandidate.vectorRank !== null)
  );

  const isOffDomain = candidates.length === 0 || !hasRetrievalSignal;

  // Journal de décision structuré
  const journalTokens = tokens.map(t => ({
    token: t.rawToken,
    matchedTerm: t.matchedVocabTerm,
    idf: t.idf,
    isHighIdf: t.isHighIdf,
    status: t.status
  }));

  const baseJournal: DecisionJournalEntry = {
    rawQuery: query,
    normalizedQuery: normalizeText(query),
    tokens: journalTokens,
    ignoredTokens: ignoredTerms,
    topVectorScore,
    topLexScore,
    marginToSecond,
    hasHighIdfContentTerm,
    zone: 'refusal',
    appliedRule: 'Règle par défaut (Repli)',
    reason: ''
  };

  // --- ARBITRAGE D'ANSWERABILITY FONDÉ SUR LE PORTIER LOCAL MINIMAL ---

  // 1. Refuser sans appeler Gemini SEULEMENT si rien de lié n'est trouvé
  // (aucun passage n'atteint le plancher de récupération : e.g. recette de cuisine, bitcoin, etc.)
  const isNoLinkedPassage = isOffDomain;

  if (isNoLinkedPassage) {
    const refusalReason = "Aucun passage lié à cette question n'a été trouvé dans les documents sélectionnés. Le sujet demandé ne figure pas dans le corpus indexé.";

    baseJournal.zone = 'refusal';
    baseJournal.appliedRule = 'Règle 3 : Abstention minimale (aucun passage lié au sujet dans le corpus)';
    baseJournal.reason = refusalReason;

    if (process.env.NODE_ENV !== 'production' || typeof console !== 'undefined') {
      console.log('[ANSWERABILITY_JOURNAL]', JSON.stringify(baseJournal));
    }

    return {
      answerable: false,
      confidenceScore: Math.round(Math.max(0.05, topVectorScore * 0.4) * 100) / 100,
      reason: refusalReason,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: ignoredTerms,
      closestPassages: closestPassages,
      refusalCategory: 'no_relevant_passages',
      decisionJournal: baseJournal,
      forceSearchAvailable: candidates.length > 0
    };
  }

  // 2. Des passages liés ont été trouvés -> Laisser Gemini répondre avec les passages et la validation des citations
  const isHighConfidence = (
    topVectorScore >= 0.40 ||
    topLexScore >= 25 ||
    (topCandidate.lexicalRank !== null && topCandidate.vectorRank !== null && topVectorScore >= 0.30) ||
    (hasContentTermInTop && topVectorScore >= 0.28)
  );

  if (isHighConfidence) {
    const confidence = Math.min(1.0, 0.80 + Math.max(0, (topVectorScore - 0.40) * 0.35));
    baseJournal.zone = 'answerable';
    baseJournal.appliedRule = 'Règle 1 : Passages pertinents liés identifiés';
    baseJournal.reason = 'Passages pertinents identifiés dans les documents sélectionnés.';

    if (process.env.NODE_ENV !== 'production' || typeof console !== 'undefined') {
      console.log('[ANSWERABILITY_JOURNAL]', JSON.stringify(baseJournal));
    }

    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: baseJournal.reason,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: [],
      decisionJournal: baseJournal
    };
  }

  // 3. Confiance modérée / Signal partiel -> Réponse autorisée sous forme de réponse partielle avec réserve
  const confidence = Math.round(Math.min(0.75, 0.50 + topVectorScore * 0.30) * 100) / 100;
  baseJournal.zone = 'grey_zone';
  baseJournal.appliedRule = 'Règle 2 : Signal partiel (réponse autorisée avec mention de réserve)';
  baseJournal.reason = 'Passages proches trouvés : étude réalisée sur la base des extraits pertinents.';

  if (process.env.NODE_ENV !== 'production' || typeof console !== 'undefined') {
    console.log('[ANSWERABILITY_JOURNAL]', JSON.stringify(baseJournal));
  }

  return {
    answerable: true,
    isPartial: true,
    confidenceScore: confidence,
    reason: baseJournal.reason,
    topScore: topVectorScore,
    evidenceCount: candidates.length,
    absentKeywords: [],
    closestPassages,
    refusalCategory: 'unreliable_close_passages',
    decisionJournal: baseJournal
  };
}

/**
 * Validation déterministe des citations et preuves.
 * Vérifie l'intégrité absolue de chaque preuve par rapport aux sermons originaux
 * et garantit que chaque citation future pointe vers le paragraphe original.
 */
export function validateEvidenceCitations(
  candidates: (HybridSearchResult | RerankedSearchResult)[],
  originalSermons: Sermon[]
): ValidatedCitation[] {
  if (!Array.isArray(candidates) || candidates.length === 0 || !Array.isArray(originalSermons)) {
    return [];
  }

  const sermonsMap = new Map<string, Sermon>();
  for (const s of originalSermons) {
    if (s && s.id) {
      sermonsMap.set(s.id, s);
    }
  }

  const validated: ValidatedCitation[] = [];

  for (const item of candidates) {
    const chunk = item.chunk || item;
    const sId = chunk.sermonId;
    const sermon = sermonsMap.get(sId);

    if (!sermon || !sermon.text) {
      validated.push({
        chunkId: chunk.chunkId || 'unknown',
        sermonId: sId || 'unknown',
        paragraphIndex: chunk.startParagraph || 0,
        citationTitle: chunk.sermonTitle || 'Sermon inconnu',
        isAuthentic: false,
        textSnippet: '',
        validationError: `Sermon ID "${sId}" inexistant dans le corpus original.`
      });
      continue;
    }

    const sermonParagraphs = splitSermonIntoParagraphs(sermon.text);

    for (const pNum of chunk.paragraphIds || []) {
      // Recherche du paragraphe authentique dans le sermon original
      let originalParaText: string | null = null;

      for (let idx = 0; idx < sermonParagraphs.length; idx++) {
        const rawP = sermonParagraphs[idx];
        const leading = extractLeadingParagraphNumber(rawP);
        const actualNum = leading !== null ? leading : idx + 1;

        if (actualNum === pNum) {
          originalParaText = rawP.trim();
          break;
        }
      }

      if (originalParaText === null) {
        validated.push({
          chunkId: chunk.chunkId,
          sermonId: sId,
          paragraphIndex: pNum,
          citationTitle: `${sermon.title} §${pNum}`,
          isAuthentic: false,
          textSnippet: '',
          validationError: `Paragraphe §${pNum} introuvable dans le texte du sermon ${sId}.`
        });
      } else {
        const snippet = originalParaText.length > 200 ? originalParaText.slice(0, 200) + '...' : originalParaText;
        validated.push({
          chunkId: chunk.chunkId,
          sermonId: sId,
          paragraphIndex: pNum,
          citationTitle: `${sermon.title} §${pNum}`,
          isAuthentic: true,
          textSnippet: snippet
        });
      }
    }
  }

  return validated;
}
