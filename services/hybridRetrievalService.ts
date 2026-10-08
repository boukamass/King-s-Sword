/**
 * King's Sword — Moteur de Recherche Hybride & RRF (Phase 2D)
 * 
 * Fusionne les résultats du retrieval lexical et du retrieval vectoriel
 * via l'algorithme Reciprocal Rank Fusion (RRF).
 * 
 * Formule RRF : RRF(d) = Σ w_m / (k + rank_m(d))  (avec k=60 par défaut)
 * 
 * RÈGLE D'OR : Ce module est totalement isolé du pipeline Legacy et de l'UI.
 * Les scores cosinus et scores lexicaux ne sont pas comparés directement,
 * seuls leurs rangs ordonnés sont fusionnés par RRF.
 */

import { SermonChunk, VectorSearchResult, VectorSearchOptions, LexicalChunkHit, HybridSearchResult, HybridSearchOptions } from '../types';
import { searchByVector, searchByText } from './vectorSearchService';

export const DEFAULT_HYBRID_OPTIONS: Required<HybridSearchOptions> = {
  k: 40,
  topK: 10,
  minRrfScore: 0,
  sermonIdFilter: [],
  vectorWeight: 0.20,
  lexicalWeight: 0.80
};

/**
 * Calcule le score RRF combiné d'un document pour les rangs fournis.
 * RRF(d) = (w_lex / (k + rank_lex)) + (w_vec / (k + rank_vec))
 */
export function computeRrfScore(
  lexicalRank: number | null | undefined,
  vectorRank: number | null | undefined,
  k: number = 40,
  lexicalWeight: number = 0.80,
  vectorWeight: number = 0.20
): number {
  if (k <= 0) k = 60;
  let rrf = 0;

  if (typeof lexicalRank === 'number' && lexicalRank > 0 && Number.isFinite(lexicalRank)) {
    rrf += lexicalWeight / (k + lexicalRank);
  }

  if (typeof vectorRank === 'number' && vectorRank > 0 && Number.isFinite(vectorRank)) {
    rrf += vectorWeight / (k + vectorRank);
  }

  // Arrondi sécurisé à 6 décimales pour éviter les bruits de virgule flottante
  return Math.round(rrf * 1000000) / 1000000;
}

/**
 * Adapte une liste de paragraphes récupérés par la recherche lexicale
 * en une liste de hits de chunks ordonnée sans modifier le moteur lexical.
 */
export function mapParagraphsToChunkHits(
  retrievedParagraphs: { sermonId: string; paragraphIndex: number; score?: number }[],
  allChunks: SermonChunk[]
): LexicalChunkHit[] {
  if (!Array.isArray(retrievedParagraphs) || retrievedParagraphs.length === 0 || !Array.isArray(allChunks) || allChunks.length === 0) {
    return [];
  }

  // Indexation rapide des chunks par sermonId
  const chunksBySermon = new Map<string, SermonChunk[]>();
  for (const chunk of allChunks) {
    const list = chunksBySermon.get(chunk.sermonId) || [];
    list.push(chunk);
    chunksBySermon.set(chunk.sermonId, list);
  }

  const chunkHitsMap = new Map<string, {
    chunkId: string;
    firstSeenOrder: number;
    highestScore: number;
    matchedParagraphIds: Set<number>;
  }>();

  let orderCounter = 1;

  for (let pRank = 0; pRank < retrievedParagraphs.length; pRank++) {
    const p = retrievedParagraphs[pRank];
    const candidateChunks = chunksBySermon.get(p.sermonId) || [];

    for (const chunk of candidateChunks) {
      if (chunk.paragraphIds.includes(p.paragraphIndex)) {
        const existing = chunkHitsMap.get(chunk.chunkId);
        const score = typeof p.score === 'number' ? p.score : 0;

        if (!existing) {
          chunkHitsMap.set(chunk.chunkId, {
            chunkId: chunk.chunkId,
            firstSeenOrder: orderCounter++,
            highestScore: score,
            matchedParagraphIds: new Set([p.paragraphIndex])
          });
        } else {
          existing.matchedParagraphIds.add(p.paragraphIndex);
          if (score > existing.highestScore) {
            existing.highestScore = score;
          }
        }
      }
    }
  }

  // Tri des chunks selon l'ordre d'apparition lexical (rang du meilleur paragraphe)
  const sortedHits = Array.from(chunkHitsMap.values()).sort(
    (a, b) => a.firstSeenOrder - b.firstSeenOrder
  );

  return sortedHits.map((hit, idx) => ({
    chunkId: hit.chunkId,
    rank: idx + 1,
    score: hit.highestScore,
    matchedParagraphIds: Array.from(hit.matchedParagraphIds)
  }));
}

/**
 * Fusionne les hits lexicaux et les hits vectoriels selon l'algorithme RRF.
 * Fonction 100% pure, déterministe et isolée.
 */
export function fuseRankings(params: {
  lexicalHits: LexicalChunkHit[];
  vectorHits: VectorSearchResult[];
  allChunks: SermonChunk[];
  options?: HybridSearchOptions;
}): HybridSearchResult[] {
  const { lexicalHits = [], vectorHits = [], allChunks = [], options } = params;

  if (!Array.isArray(allChunks) || allChunks.length === 0) {
    return [];
  }

  const opts: Required<HybridSearchOptions> = {
    ...DEFAULT_HYBRID_OPTIONS,
    ...(options || {})
  };

  const chunksMap = new Map<string, SermonChunk>();
  for (const c of allChunks) {
    if (c && c.chunkId) {
      chunksMap.set(c.chunkId, c);
    }
  }

  const sermonFilterSet = opts.sermonIdFilter.length > 0 ? new Set(opts.sermonIdFilter) : null;

  // Dictionnaires de recherche des hits par chunkId
  const lexicalMap = new Map<string, LexicalChunkHit>();
  for (const lh of lexicalHits) {
    if (lh && lh.chunkId && !lexicalMap.has(lh.chunkId)) {
      lexicalMap.set(lh.chunkId, lh);
    }
  }

  const vectorMap = new Map<string, VectorSearchResult>();
  for (const vh of vectorHits) {
    if (vh && vh.chunk?.chunkId && !vectorMap.has(vh.chunk.chunkId)) {
      vectorMap.set(vh.chunk.chunkId, vh);
    }
  }

  // Ensemble de tous les chunkIds uniques candidats
  const allCandidateIds = new Set<string>([
    ...Array.from(lexicalMap.keys()),
    ...Array.from(vectorMap.keys())
  ]);

  if (allCandidateIds.size === 0) {
    return [];
  }

  const fusedCandidates: HybridSearchResult[] = [];

  for (const chunkId of allCandidateIds) {
    const chunk = chunksMap.get(chunkId);
    if (!chunk) continue;

    if (sermonFilterSet && !sermonFilterSet.has(chunk.sermonId)) {
      continue;
    }

    const lexHit = lexicalMap.get(chunkId);
    const vecHit = vectorMap.get(chunkId);

    const lexicalRank = lexHit ? lexHit.rank : null;
    const lexicalScore = lexHit && typeof lexHit.score === 'number' ? lexHit.score : null;

    const vectorRank = vecHit ? vecHit.rank : null;
    const vectorScore = vecHit && typeof vecHit.score === 'number' ? vecHit.score : null;

    const rrfScore = computeRrfScore(
      lexicalRank,
      vectorRank,
      opts.k,
      opts.lexicalWeight,
      opts.vectorWeight
    );

    if (rrfScore >= opts.minRrfScore) {
      fusedCandidates.push({
        chunkId: chunk.chunkId,
        sermonId: chunk.sermonId,
        paragraphIds: [...chunk.paragraphIds],
        startParagraph: chunk.startParagraph,
        endParagraph: chunk.endParagraph,
        text: chunk.text,
        sermonTitle: chunk.sermonTitle,
        date: chunk.date,
        city: chunk.city,
        version: chunk.version,
        lexicalRank,
        lexicalScore,
        vectorRank,
        vectorScore,
        rrfScore,
        rank: 0, // Sera assigné après le tri
        chunk
      });
    }
  }

  // Tri déterministe des résultats hybrides :
  // 1. Score RRF décroissant
  // 2. Présence dans les deux modalités (lexical ET vectoriel)
  // 3. Meilleur rang individuel minimum
  // 4. Score vectoriel décroissant
  // 5. chunkId alphabétique (déterminisme absolu)
  fusedCandidates.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) {
      return b.rrfScore - a.rrfScore;
    }

    const aBoth = a.lexicalRank !== null && a.vectorRank !== null ? 1 : 0;
    const bBoth = b.lexicalRank !== null && b.vectorRank !== null ? 1 : 0;
    if (bBoth !== aBoth) {
      return bBoth - aBoth;
    }

    const aMinRank = Math.min(a.lexicalRank ?? Infinity, a.vectorRank ?? Infinity);
    const bMinRank = Math.min(b.lexicalRank ?? Infinity, b.vectorRank ?? Infinity);
    if (aMinRank !== bMinRank) {
      return aMinRank - bMinRank;
    }

    const aVecScore = a.vectorScore ?? -1;
    const bVecScore = b.vectorScore ?? -1;
    if (bVecScore !== aVecScore) {
      return bVecScore - aVecScore;
    }

    return a.chunkId.localeCompare(b.chunkId);
  });

  const topK = Math.max(1, opts.topK);
  const sliced = fusedCandidates.slice(0, topK);

  return sliced.map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

/**
 * Pipeline de recherche hybride complet.
 * Combine recherche lexicale, vectorielle et fusion RRF.
 */
export async function searchHybrid(params: {
  query: string;
  allChunks: SermonChunk[];
  apiKey?: string;
  queryVector?: number[] | Float32Array;
  lexicalHits?: LexicalChunkHit[];
  vectorHits?: VectorSearchResult[];
  options?: HybridSearchOptions;
}): Promise<{
  results: HybridSearchResult[];
  lexicalHitsCount: number;
  vectorHitsCount: number;
  fusionLatencyMs: number;
}> {
  const { query, allChunks, apiKey, queryVector, options } = params;
  let lexicalHits = params.lexicalHits || [];
  let vectorHits = params.vectorHits || [];

  const t0 = performance.now();

  // 1. Retrieval vectoriel si pas déjà fourni
  if (vectorHits.length === 0 && (queryVector || (apiKey && query))) {
    const vecOpts: VectorSearchOptions = {
      topK: (options?.topK || 10) * 2, // Récupère plus de candidats pour une fusion plus riche
      sermonIdFilter: options?.sermonIdFilter
    };

    if (queryVector) {
      vectorHits = searchByVector(queryVector, allChunks, vecOpts);
    } else if (apiKey && query) {
      const vecSearchRes = await searchByText(query, allChunks, apiKey, vecOpts);
      vectorHits = vecSearchRes.results;
    }
  }

  // 2. Fusion RRF
  const results = fuseRankings({
    lexicalHits,
    vectorHits,
    allChunks,
    options
  });

  const fusionLatencyMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    results,
    lexicalHitsCount: lexicalHits.length,
    vectorHitsCount: vectorHits.length,
    fusionLatencyMs
  };
}
