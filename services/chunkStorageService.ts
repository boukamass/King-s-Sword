/**
 * King's Sword — Service de Stockage Persistant des Chunks (Phase 2B.1)
 * 
 * Assure la persistance locale et déterministe des chunks :
 * - Mode Electron : Table SQLite `sermon_chunks` via IPC
 * - Mode Web : IndexedDB / Cache mémoire unifié
 * - Détection incrémentale par contentHash pour éviter les réindexations inutiles.
 */

import { SermonChunk } from '../types';
import { get, set, del } from 'idb-keyval';

const WEB_CHUNKS_KEY = 'ks_sermon_chunks_store_v1';

// Cache mémoire pour accès synchrone rapide en mode Web
let webMemoryCache: Map<string, SermonChunk> | null = null;

async function initWebMemoryCache(): Promise<Map<string, SermonChunk>> {
  if (webMemoryCache) return webMemoryCache;
  try {
    const raw = await get<SermonChunk[]>(WEB_CHUNKS_KEY);
    webMemoryCache = new Map();
    if (Array.isArray(raw)) {
      raw.forEach(c => webMemoryCache!.set(c.chunkId, c));
    }
  } catch (e) {
    webMemoryCache = new Map();
  }
  return webMemoryCache;
}

async function persistWebMemoryCache(): Promise<void> {
  if (!webMemoryCache) return;
  if (typeof indexedDB === 'undefined') return;
  try {
    const array = Array.from(webMemoryCache.values());
    await set(WEB_CHUNKS_KEY, array);
  } catch (e) {
    console.warn('[ChunkStorage] Erreur de persistance IndexedDB:', e);
  }
}

/**
 * Enregistre un ensemble de chunks de manière incrémentale avec détection de contentHash.
 */
export async function saveChunks(chunks: SermonChunk[]): Promise<{ count: number; saved: number; unchanged: number }> {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { count: 0, saved: 0, unchanged: 0 };
  }

  // 1. Environnement Electron avec SQLite
  if (typeof window !== 'undefined' && window.electronAPI?.db?.saveChunks) {
    try {
      const res = await window.electronAPI.db.saveChunks(chunks);
      return {
        count: res.count || chunks.length,
        saved: res.saved || 0,
        unchanged: res.unchanged || 0
      };
    } catch (e) {
      console.warn('[ChunkStorage] Erreur Electron saveChunks, repli Web:', e);
    }
  }

  // 2. Environnement Web / In-Memory
  const cache = await initWebMemoryCache();
  let saved = 0;
  let unchanged = 0;
  const now = new Date().toISOString();

  for (const chunk of chunks) {
    const existing = cache.get(chunk.chunkId);
    const hasExistingEmbedding = existing && Array.isArray(existing.embedding) && existing.embedding.length > 0;
    const incomingHasEmbedding = chunk.embedding && Array.isArray(chunk.embedding) && chunk.embedding.length > 0;

    // Si le chunk entrant définit explicitement embedding comme null/undefined, forcer la mise à jour pour le Cas D
    const isExplicitClearEmbedding = ('embedding' in chunk) && (chunk.embedding === null || chunk.embedding === undefined) && hasExistingEmbedding;

    if (!isExplicitClearEmbedding && existing && existing.contentHash && existing.contentHash === chunk.contentHash && (!incomingHasEmbedding || hasExistingEmbedding)) {
      unchanged++;
    } else {
      cache.set(chunk.chunkId, {
        ...chunk,
        createdAt: existing?.createdAt || chunk.createdAt || now,
        updatedAt: now
      });
      saved++;
    }
  }

  if (saved > 0) {
    await persistWebMemoryCache();
  }

  return { count: chunks.length, saved, unchanged };
}

/**
 * Enregistre un chunk unique.
 */
export async function saveChunk(chunk: SermonChunk): Promise<void> {
  await saveChunks([chunk]);
}

/**
 * Récupère un chunk par son identifiant unique.
 */
export async function getChunkById(chunkId: string): Promise<SermonChunk | null> {
  if (!chunkId) return null;

  if (typeof window !== 'undefined' && window.electronAPI?.db?.getChunk) {
    try {
      return await window.electronAPI.db.getChunk(chunkId);
    } catch (e) {
      console.warn('[ChunkStorage] Erreur Electron getChunk, repli Web:', e);
    }
  }

  const cache = await initWebMemoryCache();
  return cache.get(chunkId) || null;
}

/**
 * Récupère tous les chunks appartenant à un sermon donné.
 */
export async function getChunksBySermonId(sermonId: string): Promise<SermonChunk[]> {
  if (!sermonId) return [];

  if (typeof window !== 'undefined' && window.electronAPI?.db?.getChunksBySermon) {
    try {
      return await window.electronAPI.db.getChunksBySermon(sermonId);
    } catch (e) {
      console.warn('[ChunkStorage] Erreur Electron getChunksBySermon, repli Web:', e);
    }
  }

  const cache = await initWebMemoryCache();
  const results: SermonChunk[] = [];
  for (const chunk of cache.values()) {
    if (chunk.sermonId === sermonId) {
      results.push(chunk);
    }
  }
  return results.sort((a, b) => a.startParagraph - b.startParagraph);
}

/**
 * Récupère la totalité des chunks enregistrés.
 */
export async function getAllChunks(): Promise<SermonChunk[]> {
  if (typeof window !== 'undefined' && window.electronAPI?.db?.getAllChunks) {
    try {
      return await window.electronAPI.db.getAllChunks();
    } catch (e) {
      console.warn('[ChunkStorage] Erreur Electron getAllChunks, repli Web:', e);
    }
  }

  const cache = await initWebMemoryCache();
  return Array.from(cache.values());
}

/**
 * Supprime les chunks d'un sermon spécifique.
 */
export async function deleteChunksBySermonId(sermonId: string): Promise<void> {
  if (!sermonId) return;

  if (typeof window !== 'undefined' && window.electronAPI?.db?.deleteChunksBySermon) {
    try {
      await window.electronAPI.db.deleteChunksBySermon(sermonId);
      return;
    } catch (e) {
      console.warn('[ChunkStorage] Erreur Electron deleteChunksBySermon, repli Web:', e);
    }
  }

  const cache = await initWebMemoryCache();
  let modified = false;
  for (const [id, chunk] of cache.entries()) {
    if (chunk.sermonId === sermonId) {
      cache.delete(id);
      modified = true;
    }
  }

  if (modified) {
    await persistWebMemoryCache();
  }
}

/**
 * Détecte les chunks nouveaux, modifiés, inchangés ou obsolètes.
 */
export function detectChangedChunks(
  incomingChunks: SermonChunk[],
  existingChunks: SermonChunk[] | Map<string, SermonChunk>
): {
  newChunks: SermonChunk[];
  changedChunks: SermonChunk[];
  unchangedChunks: SermonChunk[];
  deletedChunkIds: string[];
} {
  const existingMap = existingChunks instanceof Map
    ? existingChunks
    : new Map(existingChunks.map(c => [c.chunkId, c]));

  const incomingIds = new Set(incomingChunks.map(c => c.chunkId));
  const newChunks: SermonChunk[] = [];
  const changedChunks: SermonChunk[] = [];
  const unchangedChunks: SermonChunk[] = [];

  for (const inc of incomingChunks) {
    const existing = existingMap.get(inc.chunkId);
    if (!existing) {
      newChunks.push(inc);
    } else if (existing.contentHash && inc.contentHash && existing.contentHash === inc.contentHash) {
      unchangedChunks.push(inc);
    } else {
      changedChunks.push(inc);
    }
  }

  const deletedChunkIds: string[] = [];
  for (const id of existingMap.keys()) {
    if (!incomingIds.has(id)) {
      deletedChunkIds.push(id);
    }
  }

  return {
    newChunks,
    changedChunks,
    unchangedChunks,
    deletedChunkIds
  };
}
