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
  totalChunks: number;
  dimension: number;
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
  bm25: PrecalculatedIndexBM25;
  chunks: SermonChunk[];
  vectors?: Record<string, number[]>;
}

export interface IndexValidationResult {
  valid: boolean;
  reason?: string;
  indexData?: PrecalculatedIndexData;
  hydratedChunks?: SermonChunk[];
}

let memoryCachedIndex: PrecalculatedIndexData | null = null;
let memoryCachedChunks: SermonChunk[] | null = null;

/**
 * Valide si les métadonnées de l'index correspondent strictement aux attentes.
 */
export function validateIndexMetadata(
  meta: Partial<PrecalculatedIndexMetadata>,
  currentCorpusHash?: string
): { valid: boolean; reason?: string } {
  if (!meta) {
    return { valid: false, reason: 'Métadonnées introuvables' };
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
  return { valid: true };
}

/**
 * Charge l'index pré-calculé depuis l'environnement disponible (Node.js, Electron ou Web).
 */
export async function loadPrecalculatedIndex(
  currentCorpusHash?: string
): Promise<IndexValidationResult> {
  if (memoryCachedIndex && memoryCachedChunks) {
    const val = validateIndexMetadata(memoryCachedIndex.metadata, currentCorpusHash);
    if (val.valid) {
      return {
        valid: true,
        indexData: memoryCachedIndex,
        hydratedChunks: memoryCachedChunks
      };
    }
  }

  let rawData: PrecalculatedIndexData | null = null;

  // 1. Environnement Node.js (scripts / CLI / tests)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const candidates = [
        path.resolve('sermons_meta.json'),
        path.resolve('public', 'sermons_meta.json'),
        path.resolve('dist', 'sermons_meta.json'),
        path.resolve('public', 'precalculated_sermons_index.json'),
        path.resolve('dist', 'precalculated_sermons_index.json'),
        path.resolve('precalculated_sermons_index.json'),
        path.resolve('public', 'precalculated_full_corpus_index.json'),
        path.resolve('dist', 'precalculated_full_corpus_index.json'),
        path.resolve('precalculated_full_corpus_index.json'),
        path.resolve('public', 'precalculated_index.json'),
        path.resolve('dist', 'precalculated_index.json'),
        path.resolve('precalculated_index.json')
      ];
      const target = candidates.find(c => fs.existsSync(c));
      if (target) {
        rawData = JSON.parse(fs.readFileSync(target, 'utf8'));
      }
    } catch (e) {
      // Ignorer
    }
  }

  // 2. Environnement Navigateur / SPA
  if (!rawData && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      // Priorité 1 : Index métadonnées sermons si présent
      const resMeta = await fetch(getStaticResourceUrl('sermons_meta.json'));
      if (resMeta.ok) {
        rawData = await resMeta.json();
      } else {
        const resSermons = await fetch(getStaticResourceUrl('precalculated_sermons_index.json'));
        if (resSermons.ok) {
          rawData = await resSermons.json();
        } else {
          // Priorité 2 : Index pré-calculé du grand corpus
          const resFull = await fetch(getStaticResourceUrl('precalculated_full_corpus_index.json'));
          if (resFull.ok) {
            rawData = await resFull.json();
          } else {
            // Priorité 3 : Index pré-calculé Exposé seul
            const resExp = await fetch(getStaticResourceUrl('precalculated_index.json'));
            if (resExp.ok) {
              rawData = await resExp.json();
            }
          }
        }
      }
    } catch (e) {
      // Ignorer
    }
  }

  if (!rawData) {
    return { valid: false, reason: 'Fichier index pré-calculé introuvable' };
  }

  const metaToValidate = rawData.metadata || (rawData as any);
  const validation = validateIndexMetadata(metaToValidate, currentCorpusHash);
  if (!validation.valid) {
    return { valid: false, reason: validation.reason };
  }

  // Hydratation binaire des vecteurs (Étape 2 : Zero-Copy Buffer)
  const baseChunks: SermonChunk[] = (rawData.chunks || []).map(c => ({
    ...c
  }));

  try {
    const { hydrateChunksWithBinaryVectors, getBinaryVectorForChunk } = await import('./binaryVectorStorageService');
    await hydrateChunksWithBinaryVectors(baseChunks);
  } catch (err) {
    console.warn('[PrecalculatedIndex] Hydratation binaire principale en échec, essai repli:', err);
    // Repli de secours rétrocompatible si des vecteurs JSON étaient présents
    if (rawData.vectors) {
      for (const c of baseChunks) {
        const v = rawData.vectors[c.chunkId];
        if (v && Array.isArray(v)) {
          c.embedding = new Int8Array(v);
        }
      }
    }
  }

  memoryCachedIndex = rawData;
  memoryCachedChunks = baseChunks;

  return {
    valid: true,
    indexData: rawData,
    hydratedChunks: baseChunks
  };
}

/**
 * Réinitialise le cache en mémoire (utile lors de reconstruction)
 */
export function clearPrecalculatedIndexMemoryCache(): void {
  memoryCachedIndex = null;
  memoryCachedChunks = null;
}
