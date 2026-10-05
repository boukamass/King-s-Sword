/**
 * King's Sword — Moteur de Cache Sémantique Local (0 ms)
 * 
 * Assure la mémorisation locale instantanée des réponses d'études,
 * synthèses RAG et plans d'exégèse pour les requêtes récurrentes.
 * 
 * 1. Clé de hachage déterministe (Requête normalisée + AI Context).
 * 2. Cache bidirectionnel Mémoire + IndexedDB / localStorage.
 * 3. Zéro latence (0 ms), économie totale de quota API.
 */

import { normalizeText } from '../utils/textUtils';
import { get, set } from 'idb-keyval';

export interface CachedAssistantResponse {
  query: string;
  contextKey: string;
  answerText: string;
  sources?: any[];
  evidenceCount?: number;
  timestamp: number;
}

const CACHE_PREFIX = 'ks_semantic_rag_cache_';
const MAX_MEMORY_ITEMS = 100;
const memoryCache = new Map<string, CachedAssistantResponse>();

/**
 * Calcule une clé canonique de cache pour une requête et un contexte donnés.
 */
export function computeCacheKey(query: string, contextIds: string[] = []): string {
  const normQuery = normalizeText(query).toLowerCase().replace(/[^\w\s]/g, '').trim();
  const sortedContext = [...contextIds].sort().join(',');
  return `${normQuery}__ctx_${sortedContext}`;
}

/**
 * Récupère une réponse en cache si disponible (Mémoire ou IndexedDB).
 */
export async function getCachedRagResponse(
  query: string,
  contextIds: string[] = []
): Promise<CachedAssistantResponse | null> {
  const key = computeCacheKey(query, contextIds);
  
  // 1. Vérification en mémoire vive (0 ms)
  if (memoryCache.has(key)) {
    return memoryCache.get(key) || null;
  }

  // 2. Vérification IndexedDB / Storage local
  try {
    const stored = await get<CachedAssistantResponse>(CACHE_PREFIX + key);
    if (stored) {
      memoryCache.set(key, stored);
      return stored;
    }
  } catch (e) {
    // Ignorer en environnement dégradé
  }

  return null;
}

/**
 * Enregistre une réponse générée dans le cache sémantique local.
 */
export async function setCachedRagResponse(
  query: string,
  contextIds: string[],
  answerText: string,
  sources: any[] = [],
  evidenceCount: number = 0
): Promise<void> {
  if (!query || !answerText) return;
  const key = computeCacheKey(query, contextIds);

  const entry: CachedAssistantResponse = {
    query,
    contextKey: contextIds.sort().join(','),
    answerText,
    sources,
    evidenceCount,
    timestamp: Date.now()
  };

  // Éviction LRU simple si la mémoire dépasse MAX_MEMORY_ITEMS
  if (memoryCache.size >= MAX_MEMORY_ITEMS) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }

  memoryCache.set(key, entry);

  try {
    await set(CACHE_PREFIX + key, entry);
  } catch (e) {
    // Ignorer en mode restreint
  }
}
