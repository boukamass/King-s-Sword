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
export const INDEXING_CHECKPOINT_KEY = 'ks_indexing_checkpoint_v1';

export interface IndexingCheckpoint {
  checkpointId: string;
  savedAt: string;
  totalChunks: number;
  /**
   * Structure compacte remplaçant le tableau lourd de milliers de string chunk_id :
   * - compactBitset: chaîne Base64 représentant un bitmap compact (1 bit par chunk).
   *   Pour 37 450 chunks, cela ne pèse que 4.6 Ko au lieu de 1.5 Mo de strings !
   * - completedRanges: liste compacte d'intervalles [start, end] consécutifs déjà complétés.
   * - completedChunkIds: conservé en optionnel pour stricte rétrocompatibilité.
   */
  compactBitset?: string;
  completedRanges?: Array<[number, number]>;
  completedChunkIds?: string[];
  lastProcessedIndex?: number;
  embeddingsCompleted: number;
  embeddingsFailed: number;
  alreadyIndexed: number;
  details?: { caseA: number; caseB: number; caseC: number; caseD: number };
}

/**
 * Fonctions utilitaires pour le bitmap compact de checkpoint.
 */
export function createCompactBitset(totalChunks: number): Uint8Array {
  const byteLen = Math.ceil(totalChunks / 8);
  return new Uint8Array(byteLen);
}

export function setChunkInBitset(bitset: Uint8Array, index: number): void {
  const byteIdx = index >> 3;
  const bitIdx = index & 7;
  if (byteIdx < bitset.length) {
    bitset[byteIdx] |= (1 << bitIdx);
  }
}

export function isChunkInBitset(bitset: Uint8Array, index: number): boolean {
  const byteIdx = index >> 3;
  const bitIdx = index & 7;
  if (byteIdx >= bitset.length) return false;
  return (bitset[byteIdx] & (1 << bitIdx)) !== 0;
}

export function bitsetToBase64(bitset: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bitset.buffer, bitset.byteOffset, bitset.byteLength).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bitset.byteLength; i++) {
    binary += String.fromCharCode(bitset[i]);
  }
  return btoa(binary);
}

export function base64ToBitset(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bitsetToRanges(bitset: Uint8Array, totalChunks: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inRange = false;
  let start = 0;

  for (let i = 0; i < totalChunks; i++) {
    const isSet = isChunkInBitset(bitset, i);
    if (isSet && !inRange) {
      inRange = true;
      start = i;
    } else if (!isSet && inRange) {
      inRange = false;
      ranges.push([start, i - 1]);
    }
  }
  if (inRange) {
    ranges.push([start, totalChunks - 1]);
  }
  return ranges;
}

let inMemoryCheckpoint: IndexingCheckpoint | null = null;

export async function saveIndexingCheckpoint(checkpoint: IndexingCheckpoint): Promise<void> {
  inMemoryCheckpoint = checkpoint;
  if (typeof indexedDB !== 'undefined') {
    try {
      await set(INDEXING_CHECKPOINT_KEY, checkpoint);
    } catch (e) {
      // ignore
    }
  }
}

export async function loadIndexingCheckpoint(): Promise<IndexingCheckpoint | null> {
  if (inMemoryCheckpoint) return inMemoryCheckpoint;
  if (typeof indexedDB !== 'undefined') {
    try {
      const stored = await get<IndexingCheckpoint>(INDEXING_CHECKPOINT_KEY);
      if (stored) {
        inMemoryCheckpoint = stored;
        return stored;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

export async function clearIndexingCheckpoint(): Promise<void> {
  inMemoryCheckpoint = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      await del(INDEXING_CHECKPOINT_KEY);
    } catch (e) {
      // ignore
    }
  }
}

// Cache mémoire pour accès synchrone rapide en mode Web
let webMemoryCache: Map<string, SermonChunk> | null = null;
let persistTimer: any = null;

async function initWebMemoryCache(): Promise<Map<string, SermonChunk>> {
  if (webMemoryCache) return webMemoryCache;
  webMemoryCache = new Map();
  if (typeof indexedDB === 'undefined') return webMemoryCache;
  try {
    const raw = await get<SermonChunk[]>(WEB_CHUNKS_KEY);
    if (Array.isArray(raw)) {
      raw.forEach(c => webMemoryCache!.set(c.chunkId, c));
    }
  } catch (e) {
    // ignore
  }
  return webMemoryCache;
}

/**
 * Force l'écriture immédiate du cache mémoire dans IndexedDB (flush)
 */
export async function flushChunkStorage(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistWebMemoryCache();
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

function scheduleDebouncedPersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const scheduleIdle = typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? (fn: () => void) => (window as any).requestIdleCallback(fn, { timeout: 8000 })
      : (fn: () => void) => fn();

    scheduleIdle(() => {
      persistWebMemoryCache().catch(() => {});
    });
  }, 2500);
}

/**
 * Enregistre un ensemble de chunks de manière incrémentale avec détection de contentHash.
 */
export async function saveChunks(
  chunks: SermonChunk[],
  options?: { immediate?: boolean }
): Promise<{ count: number; saved: number; unchanged: number }> {
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
    const hasExistingEmbedding = existing && (Array.isArray(existing.embedding) || ArrayBuffer.isView(existing.embedding)) && (existing.embedding as any).length > 0;
    const incomingHasEmbedding = chunk.embedding && (Array.isArray(chunk.embedding) || ArrayBuffer.isView(chunk.embedding)) && (chunk.embedding as any).length > 0;

    // Si le chunk entrant définit explicitement embedding comme null/undefined, forcer la mise à jour pour le Cas D
    const isExplicitClearEmbedding = ('embedding' in chunk) && (chunk.embedding === null || chunk.embedding === undefined) && hasExistingEmbedding;

    const isSameHash = Boolean(existing && (
      (existing.paragraphSha1 && chunk.paragraphSha1 && existing.paragraphSha1 === chunk.paragraphSha1) ||
      (existing.contentHash && chunk.contentHash && existing.contentHash === chunk.contentHash) ||
      (existing.contentHash && chunk.paragraphSha1 && existing.contentHash === chunk.paragraphSha1) ||
      (existing.paragraphSha1 && chunk.contentHash && existing.paragraphSha1 === chunk.contentHash)
    ));

    if (!isExplicitClearEmbedding && existing && isSameHash && (!incomingHasEmbedding || hasExistingEmbedding)) {
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
    if (options?.immediate) {
      await flushChunkStorage();
    } else {
      scheduleDebouncedPersist();
    }
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
    } else {
      const isUnchanged = Boolean(
        (existing.paragraphSha1 && inc.paragraphSha1 && existing.paragraphSha1 === inc.paragraphSha1) ||
        (existing.contentHash && inc.contentHash && existing.contentHash === inc.contentHash) ||
        (existing.contentHash && inc.paragraphSha1 && existing.contentHash === inc.paragraphSha1) ||
        (existing.paragraphSha1 && inc.contentHash && existing.paragraphSha1 === inc.contentHash)
      );
      if (isUnchanged) {
        unchangedChunks.push(inc);
      } else {
        changedChunks.push(inc);
      }
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
