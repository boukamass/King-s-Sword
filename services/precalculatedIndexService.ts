/**
 * King's Sword — Service d'Index Pré-calculé & Contrôle de Validité (Étape 1)
 * 
 * Assure le chargement instantané de l'index pré-calculé (chunks, BM25, vecteurs)
 * et garantit la reconstruction automatique en cas de non-concordance :
 * - version du modèle (modelId / modelVersion)
 * - version de l'index (indexVersion)
 * - version du chunking (chunkingVersion)
 * - quantification (quantization)
 * - hash du corpus (corpusHash)
 */

import { SermonChunk } from '../types';
import { getStaticResourceUrl } from '../utils/fetchHelper';

export const EXPECTED_INDEX_VERSION = '1.0.0';
export const EXPECTED_MODEL_ID = 'Xenova/multilingual-e5-small';
export const EXPECTED_MODEL_VERSION = '1.0.0';
export const EXPECTED_QUANTIZATION = 'int8';
export const EXPECTED_CHUNKING_VERSION = '1.0.0';

export interface PrecalculatedIndexMetadata {
  indexVersion: string;
  modelId: string;
  modelVersion: string;
  quantization: string;
  chunkingVersion: string;
  corpusHash: string;
  sourceJsonSha256?: string;
  totalSermons?: number;
  totalChunks: number;
  dimension: number;
  isPartial?: boolean;
  generatedAt: string;
}

export interface PrecalculatedIndexBM25 {
  vocabSize: number;
  avgDocLength: number;
  totalDocs: number;
  terms: Record<string, { df: number; idf: number }>;
  docLengths: Record<string, number>;
}

export interface PrecalculatedVectorStorageMeta {
  binaryFile: string;
  indexFile?: string;
  format: 'int8' | 'float32' | string;
  dimension: number;
  totalVectors: number;
}

export interface PrecalculatedIndexData {
  metadata: PrecalculatedIndexMetadata;
  vectorStorage?: PrecalculatedVectorStorageMeta;
  bm25?: PrecalculatedIndexBM25;
  chunks: SermonChunk[];
  vectors?: Record<string, number[]>;
}

export interface IndexValidationResult {
  valid: boolean;
  reason?: string;
  indexData?: PrecalculatedIndexData;
  hydratedChunks?: SermonChunk[];
}

export interface LoadPrecalculatedIndexOptions {
  target?: 'expose' | 'sermons';
  currentCorpusHash?: string;
  expectedSourceJsonSha256?: string;
  expectedTotalSermons?: number;
}

const memoryCacheByTarget = new Map<'expose' | 'sermons', {
  indexData: PrecalculatedIndexData;
  chunks: SermonChunk[];
}>();

/**
 * Valide si les métadonnées de l'index correspondent strictement aux attentes.
 */
export function validateIndexMetadata(
  meta: Partial<PrecalculatedIndexMetadata>,
  currentCorpusHash?: string,
  extraChecks?: {
    expectedSourceJsonSha256?: string;
    expectedTotalSermons?: number;
  }
): { valid: boolean; reason?: string } {
  if (!meta) {
    return { valid: false, reason: 'Métadonnées introuvables' };
  }
  if (meta.isPartial === true) {
    return { valid: false, reason: 'Index partiel (--limit) refusé en production' };
  }
  if (meta.indexVersion !== EXPECTED_INDEX_VERSION) {
    return { valid: false, reason: `Version index incompatible: ${meta.indexVersion} !== ${EXPECTED_INDEX_VERSION}` };
  }
  if (meta.modelId !== EXPECTED_MODEL_ID) {
    return { valid: false, reason: `Modèle incompatible: ${meta.modelId} !== ${EXPECTED_MODEL_ID}` };
  }
  if (meta.modelVersion !== EXPECTED_MODEL_VERSION) {
    return { valid: false, reason: `Version modèle incompatible: ${meta.modelVersion} !== ${EXPECTED_MODEL_VERSION}` };
  }
  if (meta.quantization !== EXPECTED_QUANTIZATION) {
    return { valid: false, reason: `Quantification incompatible: ${meta.quantization} !== ${EXPECTED_QUANTIZATION}` };
  }
  if (meta.chunkingVersion !== EXPECTED_CHUNKING_VERSION) {
    return { valid: false, reason: `Version chunking incompatible: ${meta.chunkingVersion} !== ${EXPECTED_CHUNKING_VERSION}` };
  }
  if (currentCorpusHash && meta.corpusHash && meta.corpusHash !== currentCorpusHash) {
    return { valid: false, reason: `Hash corpus incompatible: ${meta.corpusHash} !== ${currentCorpusHash}` };
  }
  if (
    extraChecks?.expectedSourceJsonSha256 &&
    meta.sourceJsonSha256 &&
    meta.sourceJsonSha256 !== extraChecks.expectedSourceJsonSha256
  ) {
    return {
      valid: false,
      reason: `SHA-256 JSON source incompatible: ${meta.sourceJsonSha256} !== ${extraChecks.expectedSourceJsonSha256}`
    };
  }
  if (
    typeof extraChecks?.expectedTotalSermons === 'number' &&
    extraChecks.expectedTotalSermons > 0 &&
    typeof meta.totalSermons === 'number' &&
    meta.totalSermons !== extraChecks.expectedTotalSermons
  ) {
    return {
      valid: false,
      reason: `Nombre de sermons incompatible: ${meta.totalSermons} !== ${extraChecks.expectedTotalSermons}`
    };
  }
  return { valid: true };
}

/**
 * Charge l'index pré-calculé depuis l'environnement disponible (Node.js, Electron ou Web).
 * Sépare explicitement la cible 'expose' (défaut) et la cible 'sermons'.
 */
export async function loadPrecalculatedIndex(
  hashOrOptions?: string | LoadPrecalculatedIndexOptions
): Promise<IndexValidationResult> {
  const opts: LoadPrecalculatedIndexOptions = typeof hashOrOptions === 'string'
    ? { currentCorpusHash: hashOrOptions, target: 'expose' }
    : (hashOrOptions || { target: 'expose' });

  const target: 'expose' | 'sermons' = opts.target || 'expose';
  const currentCorpusHash = opts.currentCorpusHash;

  const cached = memoryCacheByTarget.get(target);
  if (cached) {
    const val = validateIndexMetadata(cached.indexData.metadata, currentCorpusHash, {
      expectedSourceJsonSha256: opts.expectedSourceJsonSha256,
      expectedTotalSermons: opts.expectedTotalSermons
    });
    if (val.valid) {
      return {
        valid: true,
        indexData: cached.indexData,
        hydratedChunks: cached.chunks
      };
    }
  }

  let rawData: PrecalculatedIndexData | null = null;
  let detectedSourceJsonSha256: string | undefined = opts.expectedSourceJsonSha256;

  // 1. Environnement Node.js (scripts / CLI / tests)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const candidates = target === 'sermons'
        ? [
            path.resolve('sermons_meta.json'),
            path.resolve('public', 'sermons_meta.json'),
            path.resolve('dist', 'sermons_meta.json'),
            path.resolve('public', 'precalculated_sermons_index.json'),
            path.resolve('dist', 'precalculated_sermons_index.json'),
            path.resolve('precalculated_sermons_index.json')
          ]
        : [
            path.resolve('public', 'precalculated_index.json'),
            path.resolve('dist', 'precalculated_index.json'),
            path.resolve('precalculated_index.json')
          ];
      const foundPath = candidates.find(c => fs.existsSync(c));
      if (foundPath) {
        rawData = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
      }
      if (target === 'sermons' && !detectedSourceJsonSha256) {
        const libCandidates = [
          path.resolve('public', 'library.json'),
          path.resolve('dist', 'library.json'),
          path.resolve('library.json')
        ];
        const foundLib = libCandidates.find(c => fs.existsSync(c));
        if (foundLib) {
          const crypto = await import('crypto');
          detectedSourceJsonSha256 = crypto.createHash('sha256').update(fs.readFileSync(foundLib)).digest('hex');
        }
      }
    } catch {
      // Ignorer
    }
  }

  // 2. Environnement Electron IPC (pour 'sermons' via extraResources / dist)
  if (
    !rawData &&
    target === 'sermons' &&
    typeof window !== 'undefined' &&
    (window as any).electronAPI?.system?.getSermonsPrecalculatedIndex
  ) {
    try {
      const ipcRes = await (window as any).electronAPI.system.getSermonsPrecalculatedIndex();
      if (ipcRes && ipcRes.success && ipcRes.metaJson) {
        rawData = typeof ipcRes.metaJson === 'string' ? JSON.parse(ipcRes.metaJson) : ipcRes.metaJson;
        if (!detectedSourceJsonSha256 && ipcRes.embeddedLibrarySha256) {
          detectedSourceJsonSha256 = ipcRes.embeddedLibrarySha256;
        }
      }
    } catch {
      // Ignorer
    }
  }

  // 3. Environnement Navigateur / Electron Renderer (fetch)
  if (!rawData && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      if (target === 'sermons') {
        const resMeta = await fetch(getStaticResourceUrl('sermons_meta.json'));
        if (resMeta.ok) {
          rawData = await resMeta.json();
        } else {
          const resSermons = await fetch(getStaticResourceUrl('precalculated_sermons_index.json'));
          if (resSermons.ok) {
            rawData = await resSermons.json();
          }
        }
      } else {
        const resExp = await fetch(getStaticResourceUrl('precalculated_index.json'));
        if (resExp.ok) {
          rawData = await resExp.json();
        }
      }
    } catch {
      // Ignorer
    }
  }

  if (!rawData) {
    return { valid: false, reason: `Fichier index pré-calculé (${target}) introuvable` };
  }

  const metaToValidate = rawData.metadata || (rawData as any);
  const validation = validateIndexMetadata(metaToValidate, currentCorpusHash, {
    expectedSourceJsonSha256: detectedSourceJsonSha256,
    expectedTotalSermons: opts.expectedTotalSermons
  });
  if (!validation.valid) {
    return { valid: false, reason: validation.reason };
  }

  // Hydratation binaire des vecteurs (Étape 2 : Zero-Copy Buffer)
  const baseChunks: SermonChunk[] = (rawData.chunks || []).map(c => ({
    ...c
  }));

  try {
    const { hydrateChunksWithBinaryVectors } = await import('./binaryVectorStorageService');
    if (target === 'sermons') {
      await hydrateChunksWithBinaryVectors(baseChunks, {
        target: 'sermons',
        binaryFileName: 'sermons_vectors.bin',
        indexFileName: 'sermons_vectors.idx'
      });
    } else {
      await hydrateChunksWithBinaryVectors(baseChunks, {
        target: 'expose',
        binaryFileName: 'corpus_vectors.bin',
        indexFileName: 'corpus_vectors_index.json'
      });
    }
  } catch (err) {
    console.warn('[PrecalculatedIndex] Hydratation binaire principale en échec, essai repli:', err);
    if (rawData.vectors) {
      for (const c of baseChunks) {
        const v = rawData.vectors[c.chunkId];
        if (v && Array.isArray(v)) {
          c.embedding = new Int8Array(v);
        }
      }
    }
  }

  memoryCacheByTarget.set(target, {
    indexData: rawData,
    chunks: baseChunks
  });

  return {
    valid: true,
    indexData: rawData,
    hydratedChunks: baseChunks
  };
}

/**
 * Fonction dédiée au chargement de l'index pré-calculé des sermons (sermons_meta.json + sermons_vectors.bin/.idx).
 */
export async function loadSermonsPrecalculatedIndex(options?: {
  currentCorpusHash?: string;
  expectedSourceJsonSha256?: string;
  expectedTotalSermons?: number;
}): Promise<IndexValidationResult> {
  return loadPrecalculatedIndex({
    ...(options || {}),
    target: 'sermons'
  });
}

/**
 * Réinitialise le cache en mémoire (utile lors de reconstruction)
 */
export function clearPrecalculatedIndexMemoryCache(): void {
  memoryCacheByTarget.clear();
}
