/**
 * King's Sword — Moteur de Recherche Vectorielle Locale (Phase 2C)
 * 
 * Recherche sémantique déterministe et isolée basée sur la similarité cosinus.
 * Permet d'ordonner les chunks d'un corpus selon leur proximité avec une requête textuelle ou un vecteur précalculé.
 * 
 * RÈGLE D'OR : Ce module est totalement indépendant du pipeline Legacy et de l'UI.
 */

import { GoogleGenAI } from '@google/genai';
import { SermonChunk, VectorSearchResult, VectorSearchOptions } from '../types';
import { EMBEDDING_CONFIG, normalizeL2, computeCosineInt8, quantizeToInt8, dequantizeFromInt8 } from './embeddingService';

export const DEFAULT_VECTOR_SEARCH_OPTIONS: Required<VectorSearchOptions> = {
  topK: 10,
  minScoreThreshold: -1.0, // Accepte toutes les similarités valides par défaut
  sermonIdFilter: []
};

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
 * Opération 100% locale, instantanée et déterministe.
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

  const sermonFilterSet = opts.sermonIdFilter.length > 0 ? new Set(opts.sermonIdFilter) : null;
  const scoredResults: { chunk: SermonChunk; score: number }[] = [];

  for (const chunk of candidateChunks) {
    if (!chunk || !chunk.embedding || chunk.embedding.length === 0) {
      continue;
    }

    if (sermonFilterSet && !sermonFilterSet.has(chunk.sermonId)) {
      continue;
    }

    const sim = computeCosineSimilarity(queryVector, chunk.embedding);
    
    if (sim >= opts.minScoreThreshold) {
      scoredResults.push({
        chunk,
        score: sim
      });
    }
  }

  // Tri décroissant par score de similarité cosinus
  scoredResults.sort((a, b) => b.score - a.score);

  const topK = Math.max(1, opts.topK);
  const sliced = scoredResults.slice(0, topK);

  return sliced.map((item, idx) => ({
    chunk: item.chunk,
    score: Math.round(item.score * 10000) / 10000,
    rank: idx + 1
  }));
}

/**
 * Génère l'embedding d'une requête textuelle via le SDK @google/genai avec normalisation L2.
 */
export async function embedQueryText(
  query: string,
  apiKey: string,
  options?: { dimension?: number; taskType?: string }
): Promise<number[]> {
  if (!query || !query.trim() || !apiKey) return [];

  const dim = options?.dimension || EMBEDDING_CONFIG.defaultDimension;
  const taskType = options?.taskType || 'RETRIEVAL_QUERY';

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.embedContent({
    model: EMBEDDING_CONFIG.model,
    contents: query.trim(),
    config: {
      taskType: taskType as any,
      outputDimensionality: dim
    }
  });

  const vector = res.embeddings?.[0]?.values;
  if (!Array.isArray(vector)) {
    throw new Error(`Réponse d'embedding invalide pour la requête "${query}"`);
  }

  // Normalisation L2 systématique pour une géométrie cosinus parfaite
  return Array.from(normalizeL2(vector));
}

/**
 * Génère l'embedding d'un chunk documentaire via le SDK @google/genai avec taskType RETRIEVAL_DOCUMENT.
 */
export async function embedDocumentChunk(
  text: string,
  apiKey: string,
  options?: { dimension?: number }
): Promise<number[]> {
  if (!text || !text.trim() || !apiKey) return [];
  const dim = options?.dimension || EMBEDDING_CONFIG.defaultDimension;

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.embedContent({
    model: EMBEDDING_CONFIG.model,
    contents: text.trim(),
    config: {
      taskType: 'RETRIEVAL_DOCUMENT' as any,
      outputDimensionality: dim
    }
  });

  const vector = res.embeddings?.[0]?.values;
  if (!Array.isArray(vector)) {
    throw new Error(`Réponse d'embedding invalide pour le chunk`);
  }

  // Normalisation L2 systématique
  return Array.from(normalizeL2(vector));
}

/**
 * Pipeline complet de recherche vectorielle à partir d'un texte utilisateur.
 * Isole précisément la latence d'appel réseau API d'embedding et la latence de calcul local.
 */
export async function searchByText(
  query: string,
  candidateChunks: SermonChunk[],
  apiKey: string,
  options?: VectorSearchOptions
): Promise<{
  results: VectorSearchResult[];
  embeddingLatencyMs: number;
  searchLatencyMs: number;
}> {
  if (!query || !query.trim()) {
    return { results: [], embeddingLatencyMs: 0, searchLatencyMs: 0 };
  }

  // 1. Génération de l'embedding de la question (Appel API)
  const t0Embed = performance.now();
  const queryVector = await embedQueryText(query, apiKey);
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
