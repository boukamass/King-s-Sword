/**
 * King's Sword — Moteur de Recherche Vectorielle Locale (Phase 2C)
 * 
 * Recherche sémantique déterministe et isolée basée sur la similarité cosinus.
 * Permet d'ordonner les chunks d'un corpus selon leur proximité avec une requête textuelle ou un vecteur précalculé.
 * 
 * RÈGLE D'OR : Ce module est totalement indépendant du pipeline Legacy et de l'UI.
 */

import { SermonChunk, VectorSearchResult, VectorSearchOptions, MetadataFilter } from '../types';
import { EMBEDDING_CONFIG, normalizeL2, computeCosineInt8, quantizeToInt8, dequantizeFromInt8, computeE5Embedding } from './embeddingService';

export const DEFAULT_VECTOR_SEARCH_OPTIONS: Required<VectorSearchOptions> = {
  topK: 10,
  minScoreThreshold: -1.0, // Accepte toutes les similarités valides par défaut
  sermonIdFilter: [],
  metadataFilter: {},
  guaranteeTopK: true
};

/**
 * Extrait l'année d'un chunk de manière déterministe depuis sa date ou son identifiant.
 */
export function extractChunkYear(chunk: SermonChunk): number | null {
  if (chunk.date) {
    const m = chunk.date.match(/\b(19\d\d|20\d\d)\b/);
    if (m) return parseInt(m[1], 10);
  }
  if (chunk.sermonId) {
    // Format Branham standard: YY-MMDD ou YY-MMDDA (ex: 63-0324M -> 1963)
    const mYy = chunk.sermonId.match(/^(\d{2})-\d{4}/);
    if (mYy) {
      const yy = parseInt(mYy[1], 10);
      return yy >= 30 ? 1900 + yy : 2000 + yy;
    }
    // Exposé publié en 1965
    if (chunk.sermonId.startsWith('expose-')) {
      return 1965;
    }
  }
  return null;
}

/**
 * Détermine le type de source documentaire d'un chunk.
 */
export function extractChunkSourceType(chunk: SermonChunk): 'sermon' | 'expose' | 'bible' | 'song' {
  if (chunk.documentType) return chunk.documentType;
  if (chunk.sermonId.startsWith('expose-')) return 'expose';
  if (chunk.sermonId.startsWith('bible-')) return 'bible';
  if (chunk.sermonId.startsWith('song-')) return 'song';
  return 'sermon';
}

/**
 * Vérifie si un chunk respecte un filtre de métadonnées donné (Pre-filtering).
 */
export function matchesMetadataFilter(chunk: SermonChunk, filter?: MetadataFilter): boolean {
  if (!filter) return true;

  // 1. Filtrage par source documentaire ('sermon', 'expose', 'bible', 'song')
  if (filter.sources && filter.sources.length > 0) {
    const srcType = extractChunkSourceType(chunk);
    if (!filter.sources.includes(srcType)) {
      return false;
    }
  }

  // 2. Filtrage par identifiants exacts (sermonId ou documentId)
  if (filter.sermonIds && filter.sermonIds.length > 0) {
    if (!filter.sermonIds.includes(chunk.sermonId)) {
      return false;
    }
  }

  // 3. Filtrage par année (min, max, ou liste exacte)
  if (filter.years || filter.yearMin !== undefined || filter.yearMax !== undefined) {
    const year = extractChunkYear(chunk);
    if (year === null) return false;

    if (filter.years && filter.years.length > 0 && !filter.years.includes(year)) {
      return false;
    }
    if (filter.yearMin !== undefined && year < filter.yearMin) {
      return false;
    }
    if (filter.yearMax !== undefined && year > filter.yearMax) {
      return false;
    }
  }

  // 4. Filtrage par séries thématiques (recherche dans le titre du sermon ou section)
  if (filter.series && filter.series.length > 0) {
    const title = (chunk.sermonTitle || chunk.sectionTitle || '').toLowerCase();
    const matchesSeries = filter.series.some(s => title.includes(s.toLowerCase()));
    if (!matchesSeries) return false;
  }

  // 5. Filtrage par version
  if (filter.version) {
    const v = (chunk.version || '').toUpperCase();
    if (v !== filter.version.toUpperCase()) return false;
  }

  // 6. Prédicat personnalisé
  if (filter.predicate && !filter.predicate(chunk)) {
    return false;
  }

  return true;
}

/**
 * Calcule la similarité cosinus de façon hautement optimisée et sécurisée.
 * Tolère les Float32Array, Int8Array et tableaux standards, gère les vecteurs nuls/invalides.
 */
export function computeCosineSimilarity(
  vecA: number[] | Float32Array | Int8Array | null | undefined,
  vecB: number[] | Float32Array | Int8Array | null | undefined
): number {
  if (!vecA || !vecB) return 0;

  // Optimisation Int8 vectorisée
  if (vecA instanceof Int8Array && vecB instanceof Int8Array) {
    return computeCosineInt8(vecA, vecB);
  }

  const lenA = vecA.length;
  const lenB = vecB.length;
  
  if (lenA === 0 || lenB === 0 || lenA !== lenB) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < lenA; i++) {
    const a = vecA[i];
    const b = vecB[i];
    
    // Protection absolue contre NaN et Infinity
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return 0;
    }

    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0) return 0;

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0 || !Number.isFinite(denominator)) return 0;

  const rawSim = dotProduct / denominator;

  // Clamping de sécurité strict dans [-1.0, 1.0] pour éviter les dérives de calcul flottant
  if (rawSim > 1.0) return 1.0;
  if (rawSim < -1.0) return -1.0;
  if (!Number.isFinite(rawSim)) return 0;

  return rawSim;
}

/**
 * Exécute la recherche vectorielle en mémoire sur un ensemble de chunks candidats à partir d'un vecteur requête.
 * Opération 100% locale, instantanée et déterministe avec PRE-FILTERING STRICT.
 */
export function searchByVector(
  queryVector: number[] | Float32Array | Int8Array,
  candidateChunks: SermonChunk[],
  options?: VectorSearchOptions
): VectorSearchResult[] {
  if (!queryVector || queryVector.length === 0 || !Array.isArray(candidateChunks) || candidateChunks.length === 0) {
    return [];
  }

  const opts: Required<VectorSearchOptions> = {
    ...DEFAULT_VECTOR_SEARCH_OPTIONS,
    ...(options || {})
  };

  // Construction du filtre effectif combinant sermonIdFilter et metadataFilter
  const effectiveFilter: MetadataFilter | undefined = opts.metadataFilter
    ? {
        ...opts.metadataFilter,
        sermonIds: opts.sermonIdFilter && opts.sermonIdFilter.length > 0
          ? Array.from(new Set([...(opts.metadataFilter.sermonIds || []), ...opts.sermonIdFilter]))
          : opts.metadataFilter.sermonIds
      }
    : (opts.sermonIdFilter && opts.sermonIdFilter.length > 0 ? { sermonIds: opts.sermonIdFilter } : undefined);

  // ÉTAPE 6 : PRE-FILTERING VECTORIEL STRICT
  // On restreint immédiatement les candidats par métadonnées AVANT tout calcul de similarité.
  // La similarité cosinus n'est calculée QUE sur les vecteurs appartenant au périmètre.
  const filteredChunks = effectiveFilter
    ? candidateChunks.filter(c => matchesMetadataFilter(c, effectiveFilter))
    : candidateChunks;

  const scoredResults: { chunk: SermonChunk; score: number }[] = [];
  const allScoredInPerimeter: { chunk: SermonChunk; score: number }[] = [];

  for (const chunk of filteredChunks) {
    if (!chunk || !chunk.embedding || chunk.embedding.length === 0) {
      continue;
    }

    const sim = computeCosineSimilarity(queryVector, chunk.embedding);
    allScoredInPerimeter.push({ chunk, score: sim });

    if (sim >= opts.minScoreThreshold) {
      scoredResults.push({
        chunk,
        score: sim
      });
    }
  }

  // ÉTAPE 6.1 : Si minScoreThreshold élimine trop de résultats et que guaranteeTopK est actif,
  // on conserve les topK meilleurs scores du périmètre pour garantir la présence de k résultats.
  const guarantee = opts.guaranteeTopK !== undefined ? opts.guaranteeTopK : (effectiveFilter !== undefined);
  const candidatesToRank = (guarantee && scoredResults.length < opts.topK && allScoredInPerimeter.length > scoredResults.length)
    ? allScoredInPerimeter
    : scoredResults;

  // Tri décroissant par score de similarité cosinus
  candidatesToRank.sort((a, b) => b.score - a.score);

  const topK = Math.max(1, opts.topK);
  const sliced = candidatesToRank.slice(0, topK);

  return sliced.map((item, idx) => ({
    chunk: item.chunk,
    score: Math.round(item.score * 10000) / 10000,
    rank: idx + 1
  }));
}

/**
 * Génère l'embedding d'une requête textuelle via le modèle local E5 (384D) avec préfixe "query: ".
 * Strictement local : 0 appel réseau.
 */
export async function embedQueryText(
  query: string,
  _apiKey?: string,
  _options?: { dimension?: number; taskType?: string }
): Promise<number[]> {
  if (!query || !query.trim()) return [];
  const vec = await computeE5Embedding(query, 'query: ');
  if (!vec) return [];
  return Array.from(vec);
}

/**
 * Génère l'embedding d'un passage documentaire via le modèle local E5 (384D) avec préfixe "passage: ".
 * Strictement local : 0 appel réseau.
 */
export async function embedDocumentChunk(
  text: string,
  _apiKey?: string,
  _options?: { dimension?: number }
): Promise<number[]> {
  if (!text || !text.trim()) return [];
  const vec = await computeE5Embedding(text, 'passage: ');
  if (!vec) return [];
  return Array.from(vec);
}

/**
 * Pipeline complet de recherche vectorielle locale à partir d'un texte utilisateur.
 * Utilise exclusivement le modèle local E5 (384D Int8), sans aucun appel réseau.
 */
export async function searchByText(
  query: string,
  candidateChunks: SermonChunk[],
  _apiKey?: string,
  options?: VectorSearchOptions
): Promise<{
  results: VectorSearchResult[];
  embeddingLatencyMs: number;
  searchLatencyMs: number;
}> {
  if (!query || !query.trim()) {
    return { results: [], embeddingLatencyMs: 0, searchLatencyMs: 0 };
  }

  // 1. Génération locale de l'embedding de la question (E5 local)
  const t0Embed = performance.now();
  const queryVector = await embedQueryText(query);
  const embeddingLatencyMs = Math.round((performance.now() - t0Embed) * 100) / 100;

  // 2. Recherche vectorielle locale en mémoire (Calcul Cosinus)
  const t0Search = performance.now();
  const results = searchByVector(queryVector, candidateChunks, options);
  const searchLatencyMs = Math.round((performance.now() - t0Search) * 100) / 100;

  return {
    results,
    embeddingLatencyMs,
    searchLatencyMs
  };
}
