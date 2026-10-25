/**
 * King's Sword — Service de Stockage Binaire Haute Performance des Vecteurs (Étape 2)
 * 
 * Remplace tout stockage JSON des vecteurs par :
 * 1. Fichier binaire compact (.bin) contenant les vecteurs contigus (Int8Array / Float32Array).
 * 2. Fichier d'index d'offsets associant chunk_id et position (offset / length).
 * 3. Chargement ultra-rapide en un seul buffer (Node.js Buffer / Browser ArrayBuffer)
 *    avec vues typées zero-copy instantanées (< 2 ms pour hydrater 1 450+ vecteurs).
 */

import { SermonChunk } from '../types';
import { getStaticResourceUrl } from '../utils/fetchHelper';

export interface VectorIndexEntry {
  chunkId: string;
  offset: number;
  length: number;
}

export interface BinaryVectorFileMetadata {
  version: string;
  modelId: string;
  dimension: number;
  quantization: 'int8' | 'float32';
  bytesPerVector: number;
  totalVectors: number;
  binaryFileName: string;
  generatedAt: string;
  chunks: VectorIndexEntry[];
}

export interface BinaryVectorStorageState {
  loaded: boolean;
  totalVectors: number;
  dimension: number;
  format: 'int8' | 'float32';
  binarySize: number;
  loadTimeMs: number;
}

interface CachedChunkVectorLocation extends VectorIndexEntry {
  nodeBuffer?: any;
  binaryBuffer?: ArrayBuffer | null;
  bufferByteLength: number;
}

let cachedBinaryBuffer: ArrayBuffer | null = null;
let cachedNodeBuffer: any = null;
let cachedIndexMap: Map<string, CachedChunkVectorLocation> | null = null;
let cachedMeta: BinaryVectorFileMetadata | null = null;
const loadedStorageByFile = new Map<string, BinaryVectorStorageState>();
let isStorageLoading = false;

/**
 * Analyse binaire directe de l'index sans JSON.parse (format compact KSIX).
 */
export function parseBinaryIndex(buf: ArrayBuffer | Uint8Array | Buffer): {
  dimension: number;
  quantization: 'int8' | 'float32';
  totalVectors: number;
  chunks: VectorIndexEntry[];
} | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 16) return null;

  // Header Magic "KSIX" : 0x4B 0x53 0x49 0x58
  if (bytes[0] !== 0x4B || bytes[1] !== 0x53 || bytes[2] !== 0x49 || bytes[3] !== 0x58) {
    return null;
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const quantType = dv.getUint8(6) === 1 ? 'int8' : 'float32';
  const dimension = dv.getUint16(7, true);
  const totalVectors = dv.getUint32(9, true);

  const chunks: VectorIndexEntry[] = [];
  let offset = 16;
  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

  for (let i = 0; i < totalVectors && offset < bytes.length; i++) {
    const idLen = dv.getUint16(offset, true);
    offset += 2;
    const idBytes = bytes.subarray(offset, offset + idLen);
    const chunkId = decoder ? decoder.decode(idBytes) : String.fromCharCode(...idBytes);
    offset += idLen;
    const vecOffset = dv.getUint32(offset, true);
    offset += 4;
    const vecLen = dv.getUint16(offset, true);
    offset += 2;

    chunks.push({ chunkId, offset: vecOffset, length: vecLen });
  }

  return { dimension, quantization: quantType, totalVectors: chunks.length, chunks };
}

export function createBinaryIndexBuffer(
  entries: VectorIndexEntry[],
  dimension = 384,
  quantization: 'int8' | 'float32' = 'int8'
): Buffer {
  let totalBytes = 16;
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const encodedIds = entries.map(e => {
    const bytes = encoder ? encoder.encode(e.chunkId) : Buffer.from(e.chunkId, 'utf8');
    totalBytes += 2 + bytes.length + 4 + 2;
    return bytes;
  });

  const buf = Buffer.alloc(totalBytes);
  buf.write('KSIX', 0, 4, 'ascii');
  buf.writeUInt16LE(1, 4);
  buf.writeUInt8(quantization === 'int8' ? 1 : 4, 6);
  buf.writeUInt16LE(dimension, 7);
  buf.writeUInt32LE(entries.length, 9);

  let offset = 16;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const idBytes = encodedIds[i];
    buf.writeUInt16LE(idBytes.length, offset);
    offset += 2;
    Buffer.from(idBytes).copy(buf, offset);
    offset += idBytes.length;
    buf.writeUInt32LE(e.offset, offset);
    offset += 4;
    buf.writeUInt16LE(e.length || dimension, offset);
    offset += 2;
  }
  return buf;
}

/**
 * Charge le fichier binaire de vecteurs et son fichier d'index (zéro JSON.parse si .idx disponible).
 * Respecte strictement binaryFileName / indexFileName / target ('expose' | 'sermons').
 */
export async function loadBinaryVectorStorage(options: {
  binaryFileName?: string;
  indexFileName?: string;
  target?: 'expose' | 'sermons';
  forceReload?: boolean;
} = {}): Promise<BinaryVectorStorageState> {
  const isSermonsTarget = options.target === 'sermons' || options.binaryFileName === 'sermons_vectors.bin';
  const binaryFileName = options.binaryFileName || (isSermonsTarget ? 'sermons_vectors.bin' : 'corpus_vectors.bin');
  const indexFileName = options.indexFileName || (isSermonsTarget ? 'sermons_vectors.idx' : 'corpus_vectors_index.json');
  const binaryIdxName = indexFileName.endsWith('.idx')
    ? indexFileName
    : indexFileName.replace(/\.json$/, '.idx');

  const cacheKey = `${binaryFileName}::${binaryIdxName}`;
  if (!options.forceReload && loadedStorageByFile.has(cacheKey) && cachedIndexMap) {
    const existing = loadedStorageByFile.get(cacheKey)!;
    return { ...existing, loadTimeMs: 0 };
  }

  const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  isStorageLoading = true;

  try {
    let rawIndexJson: BinaryVectorFileMetadata | null = null;
    let parsedBinIndex: ReturnType<typeof parseBinaryIndex> | null = null;
    let loadedBinaryBuffer: ArrayBuffer | null = null;
    let loadedNodeBuf: any = null;

    // 1. Environnement Node.js (scripts / CLI / tests / SSR)
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const fs = await import('fs');
        const path = await import('path');

        const idxCandidates = isSermonsTarget
          ? [
              path.resolve(binaryIdxName),
              path.resolve('public', binaryIdxName),
              path.resolve('dist', binaryIdxName),
              path.resolve('public', 'sermons_vectors.idx'),
              path.resolve('dist', 'sermons_vectors.idx')
            ]
          : [
              path.resolve(binaryIdxName),
              path.resolve('public', binaryIdxName),
              path.resolve('dist', binaryIdxName),
              path.resolve('public', 'corpus_vectors.idx'),
              path.resolve('dist', 'corpus_vectors.idx')
            ];

        const targetIdx = idxCandidates.find(p => fs.existsSync(p));
        if (targetIdx) {
          const idxBuf = fs.readFileSync(targetIdx);
          parsedBinIndex = parseBinaryIndex(idxBuf);
        }

        const binCandidates = isSermonsTarget
          ? [
              path.resolve(binaryFileName),
              path.resolve('public', binaryFileName),
              path.resolve('dist', binaryFileName),
              path.resolve('public', 'sermons_vectors.bin'),
              path.resolve('dist', 'sermons_vectors.bin')
            ]
          : [
              path.resolve(binaryFileName),
              path.resolve('public', binaryFileName),
              path.resolve('dist', binaryFileName),
              path.resolve('public', 'corpus_embeddings_384d.bin'),
              path.resolve('dist', 'corpus_embeddings_384d.bin')
            ];

        const targetBin = binCandidates.find(p => fs.existsSync(p));
        if (targetBin) {
          loadedNodeBuf = fs.readFileSync(targetBin);
        }

        if (!parsedBinIndex) {
          const indexCandidates = isSermonsTarget
            ? [
                path.resolve(indexFileName),
                path.resolve('public', 'sermons_meta.json'),
                path.resolve('dist', 'sermons_meta.json')
              ]
            : [
                path.resolve(indexFileName),
                path.resolve('public', indexFileName),
                path.resolve('dist', indexFileName),
                path.resolve('public', 'corpus_embeddings_384d_meta.json'),
                path.resolve('dist', 'corpus_embeddings_384d_meta.json')
              ];
          const targetIndex = indexCandidates.find(p => fs.existsSync(p) && p.endsWith('.json'));
          if (targetIndex) {
            rawIndexJson = JSON.parse(fs.readFileSync(targetIndex, 'utf8'));
          }
        }
      } catch (err) {
        console.warn('[BinaryVectorStorage] Erreur lecture fichier Node.js:', err);
      }
    }

    // 2. Environnement Electron IPC (si disponible pour les ressources extraResources / dist)
    if (
      !parsedBinIndex &&
      !loadedBinaryBuffer &&
      !loadedNodeBuf &&
      isSermonsTarget &&
      typeof window !== 'undefined' &&
      (window as any).electronAPI?.system?.getSermonsPrecalculatedIndex
    ) {
      try {
        const ipcRes = await (window as any).electronAPI.system.getSermonsPrecalculatedIndex();
        const rawBin = ipcRes?.binaryBuffer || ipcRes?.binBuffer;
        const rawIdx = ipcRes?.indexBuffer || ipcRes?.idxBuffer;
        if (ipcRes && ipcRes.success && rawBin && rawIdx) {
          const toUint8 = (b: any): Uint8Array => {
            if (b instanceof Uint8Array) return b;
            if (b instanceof ArrayBuffer) return new Uint8Array(b);
            if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
            if (b && typeof b === 'object' && Array.isArray(b.data)) return new Uint8Array(b.data);
            return new Uint8Array(b);
          };
          const idxBytes = toUint8(rawIdx);
          const binBytes = toUint8(rawBin);
          parsedBinIndex = parseBinaryIndex(idxBytes);
          loadedBinaryBuffer = binBytes.slice().buffer as ArrayBuffer;
        }
      } catch (err) {
        console.warn('[BinaryVectorStorage] Erreur chargement IPC Electron sermons:', err);
      }
    }

    // 3. Environnement Navigateur Web / Electron Renderer (fetch)
    if (!parsedBinIndex && !rawIndexJson && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      try {
        const safeFetch = async (url: string): Promise<Response | null> => {
          try {
            const res = await fetch(url);
            return res && (res.ok || res.status === 0 || res.status === 200) ? res : null;
          } catch {
            return null;
          }
        };

        const idxRes = await safeFetch(getStaticResourceUrl(binaryIdxName));
        if (idxRes) {
          const idxBuf = await idxRes.arrayBuffer();
          parsedBinIndex = parseBinaryIndex(idxBuf);
        }

        let binRes = await safeFetch(getStaticResourceUrl(binaryFileName));
        if (!binRes && !isSermonsTarget) {
          binRes = await safeFetch(getStaticResourceUrl('corpus_embeddings_384d.bin'));
        }
        if (binRes) {
          loadedBinaryBuffer = await binRes.arrayBuffer();
        }

        if (!parsedBinIndex) {
          const fallbackJsonName = isSermonsTarget ? 'sermons_meta.json' : indexFileName;
          let indexRes = await safeFetch(getStaticResourceUrl(fallbackJsonName));
          if (!indexRes && !isSermonsTarget) {
            indexRes = await safeFetch(getStaticResourceUrl('corpus_embeddings_384d_meta.json'));
          }
          if (indexRes) {
            rawIndexJson = await indexRes.json();
          }
        }
      } catch (err) {
        console.warn('[BinaryVectorStorage] Erreur chargement fetch Web:', err);
      }
    }

    const chunksToUse = parsedBinIndex ? parsedBinIndex.chunks : (rawIndexJson?.chunks || []);
    if (chunksToUse.length === 0 || (!loadedBinaryBuffer && !loadedNodeBuf)) {
      throw new Error(`Fichiers de stockage binaire introuvables (${binaryFileName} / ${indexFileName})`);
    }

    const binarySize = loadedBinaryBuffer ? loadedBinaryBuffer.byteLength : loadedNodeBuf.length;

    if (!cachedIndexMap || options.forceReload) {
      cachedIndexMap = new Map<string, CachedChunkVectorLocation>();
    }

    let fileVectorsCount = 0;
    for (const entry of chunksToUse) {
      if (entry.chunkId && typeof entry.offset === 'number') {
        const loc: CachedChunkVectorLocation = {
          chunkId: entry.chunkId,
          offset: entry.offset,
          length: entry.length || 384,
          nodeBuffer: loadedNodeBuf || undefined,
          binaryBuffer: loadedBinaryBuffer || null,
          bufferByteLength: binarySize
        };
        cachedIndexMap.set(entry.chunkId, loc);
        // Alias sans suffixe de version (ex: 63-0324M-VGR_c1_p1_p2 -> 63-0324M_c1_p1_p2)
        const baseMatch = entry.chunkId.match(/^(.+?)-(?:VGR|Shp|SHP|vgr|shp)(_c\d+_p\d+_p\d+)$/);
        if (baseMatch) {
          const baseChunkId = `${baseMatch[1]}${baseMatch[2]}`;
          if (!cachedIndexMap.has(baseChunkId)) {
            cachedIndexMap.set(baseChunkId, loc);
          }
        }
        fileVectorsCount++;
      }
    }

    cachedMeta = rawIndexJson || {
      version: '1.0.0',
      modelId: 'Xenova/multilingual-e5-small',
      dimension: parsedBinIndex?.dimension || 384,
      quantization: parsedBinIndex?.quantization || 'int8',
      bytesPerVector: parsedBinIndex?.dimension || 384,
      totalVectors: chunksToUse.length,
      binaryFileName,
      generatedAt: new Date().toISOString(),
      chunks: chunksToUse
    };
    cachedBinaryBuffer = loadedBinaryBuffer;
    cachedNodeBuffer = loadedNodeBuf;

    const tEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const loadTimeMs = Math.round((tEnd - tStart) * 100) / 100;

    const state: BinaryVectorStorageState = {
      loaded: true,
      totalVectors: fileVectorsCount,
      dimension: cachedMeta.dimension || 384,
      format: cachedMeta.quantization || 'int8',
      binarySize,
      loadTimeMs
    };
    loadedStorageByFile.set(cacheKey, state);
    return state;
  } finally {
    isStorageLoading = false;
  }
}

/**
 * Récupère un vecteur sous forme de vue Int8Array zero-copy à partir du buffer binaire,
 * avec vérification stricte des bornes du buffer.
 */
export function getBinaryVectorForChunk(chunkId: string): Int8Array | null {
  if (!cachedIndexMap || !chunkId) return null;

  let entry = cachedIndexMap.get(chunkId);
  if (!entry) {
    const baseMatch = chunkId.match(/^(.+?)-(?:VGR|Shp|SHP|vgr|shp)(_c\d+_p\d+_p\d+)$/);
    if (baseMatch) {
      entry = cachedIndexMap.get(`${baseMatch[1]}${baseMatch[2]}`);
    } else {
      const suffixMatch = chunkId.match(/^(.+?)(_c\d+_p\d+_p\d+)$/);
      if (suffixMatch) {
        entry = cachedIndexMap.get(`${suffixMatch[1]}-VGR${suffixMatch[2]}`) ||
                cachedIndexMap.get(`${suffixMatch[1]}-SHP${suffixMatch[2]}`) ||
                cachedIndexMap.get(`${suffixMatch[1]}-Shp${suffixMatch[2]}`) ||
                cachedIndexMap.get(`${suffixMatch[1]}-vgr${suffixMatch[2]}`) ||
                cachedIndexMap.get(`${suffixMatch[1]}-shp${suffixMatch[2]}`);
      }
    }
  }
  if (!entry) return null;

  const len = entry.length || 384;
  if (entry.offset < 0 || len <= 0) return null;

  const nodeBuf = entry.nodeBuffer ?? cachedNodeBuffer;
  if (nodeBuf) {
    const bufLen = typeof entry.bufferByteLength === 'number' ? entry.bufferByteLength : nodeBuf.length;
    if (entry.offset + len > bufLen) {
      return null;
    }
    const baseOffset = nodeBuf.byteOffset || 0;
    return new Int8Array(nodeBuf.buffer, baseOffset + entry.offset, len);
  }

  const binBuf = entry.binaryBuffer ?? cachedBinaryBuffer;
  if (binBuf) {
    const bufLen = typeof entry.bufferByteLength === 'number' ? entry.bufferByteLength : binBuf.byteLength;
    if (entry.offset + len > bufLen) {
      return null;
    }
    return new Int8Array(binBuf, entry.offset, len);
  }

  return null;
}

/**
 * Hydrate une collection de chunks avec leurs vecteurs binaires directement depuis le buffer mémoire.
 * Exécution instantanée (< 2 ms) car basée sur des vues typées sans copie de mémoire ni JSON.
 */
export async function hydrateChunksWithBinaryVectors(
  chunks: SermonChunk[],
  options?: {
    binaryFileName?: string;
    indexFileName?: string;
    target?: 'expose' | 'sermons';
    forceReload?: boolean;
  }
): Promise<number> {
  if (!Array.isArray(chunks) || chunks.length === 0) return 0;

  try {
    await loadBinaryVectorStorage(options || {});
  } catch {
    // Si le fichier demandé est absent, on tente avec les entrées déjà en mémoire
  }

  if (!cachedIndexMap) return 0;

  let hydratedCount = 0;
  for (const c of chunks) {
    if (!c.embedding || c.embedding.length === 0) {
      const vec = getBinaryVectorForChunk(c.chunkId);
      if (vec) {
        c.embedding = vec;
        hydratedCount++;
      }
    } else {
      hydratedCount++;
    }
  }

  return hydratedCount;
}

/**
 * Écrit un fichier binaire et son fichier d'index d'offsets à partir d'un dictionnaire ou tableau de vecteurs.
 * Utile pour les scripts de génération (build_index.mjs).
 */
export function writeBinaryVectorFiles(
  binaryPath: string,
  indexPath: string,
  vectors: Array<{ chunkId: string; vector: Int8Array | number[]; sermonId?: string }>,
  options: {
    modelId?: string;
    dimension?: number;
    quantization?: 'int8' | 'float32';
  } = {}
): { totalVectors: number; binaryBytes: number; indexBytes: number } {
  const fs = require('fs');
  const path = require('path');

  const dimension = options.dimension || 384;
  const quantization = options.quantization || 'int8';
  const modelId = options.modelId || 'Xenova/multilingual-e5-small';

  const bytesPerElement = quantization === 'int8' ? 1 : 4;
  const bytesPerVector = dimension * bytesPerElement;
  const totalVectors = vectors.length;
  const totalBinaryBytes = totalVectors * bytesPerVector;

  // Création du buffer binaire contigu
  const binaryBuffer = Buffer.alloc(totalBinaryBytes);
  const indexEntries: VectorIndexEntry[] = [];

  let currentOffset = 0;
  for (const item of vectors) {
    const rawVec = item.vector;
    if (quantization === 'int8') {
      const int8Arr = rawVec instanceof Int8Array ? rawVec : new Int8Array(rawVec);
      for (let i = 0; i < dimension; i++) {
        binaryBuffer.writeInt8(int8Arr[i] ?? 0, currentOffset + i);
      }
    } else {
      const f32Arr = rawVec instanceof Float32Array ? rawVec : new Float32Array(rawVec);
      for (let i = 0; i < dimension; i++) {
        binaryBuffer.writeFloatLE(f32Arr[i] ?? 0, currentOffset + i * 4);
      }
    }

    indexEntries.push({
      chunkId: item.chunkId,
      offset: currentOffset,
      length: bytesPerVector
    });

    currentOffset += bytesPerVector;
  }

  // Écriture du fichier binaire
  fs.writeFileSync(binaryPath, binaryBuffer);

  // Écriture du fichier d'index d'offsets
  const indexPayload: BinaryVectorFileMetadata = {
    version: '1.0.0',
    modelId,
    dimension,
    quantization,
    bytesPerVector,
    totalVectors,
    binaryFileName: path.basename(binaryPath),
    generatedAt: new Date().toISOString(),
    chunks: indexEntries
  };

  const serializedIndex = JSON.stringify(indexPayload);
  fs.writeFileSync(indexPath, serializedIndex, 'utf8');

  // Écriture complémentaire du fichier d'index binaire compact KSIX (.idx) sans JSON.parse
  const binaryIdxPath = indexPath.replace(/\.json$/, '.idx');
  const compactIdxBuf = createBinaryIndexBuffer(indexEntries, dimension, quantization);
  fs.writeFileSync(binaryIdxPath, compactIdxBuf);

  return {
    totalVectors,
    binaryBytes: totalBinaryBytes,
    indexBytes: Buffer.byteLength(serializedIndex, 'utf8')
  };
}
