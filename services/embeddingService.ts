/**
 * King's Sword — Service d'Embedding et de Sérialisation Vectorielle (Phase 2B.2 & 768D / Int8)
 * 
 * Assure la conversion bidirectionnelle binaire haute performance (Float32Array <-> BLOB SQLite, Int8Array <-> BLOB),
 * la normalisation L2 et la quantification Int8 pour le modèle 'text-embedding-004' (768D).
 */

/**
 * Configuration du modèle d'embedding vectoriel local E5 (384D)
 * Strictement local : aucun appel réseau, aucun envoi vers une API distante.
 */
export const LOCAL_E5_CONFIG = {
  modelId: 'Xenova/multilingual-e5-small',
  dimension: 384,
  bytesPerVectorInt8: 384, // 384 octets en Int8
  bytesPerVectorFloat32: 384 * 4 // 1536 octets en Float32
};

/**
 * Configuration API Gemini distincte (réservée exclusivement aux scripts hors-ligne d'évaluation)
 */
export const GEMINI_EMBEDDING_API_CONFIG = {
  model: 'gemini-embedding-2-preview',
  defaultDimension: 768
};

// Rétrocompatibilité d'alias pour les modules existants : cible le modèle local E5
export const EMBEDDING_CONFIG = {
  model: LOCAL_E5_CONFIG.modelId,
  defaultDimension: LOCAL_E5_CONFIG.dimension,
  legacyDimension: 3072,
  bytesPerVectorInt8: LOCAL_E5_CONFIG.bytesPerVectorInt8,
  bytesPerVectorFloat32: LOCAL_E5_CONFIG.bytesPerVectorFloat32
};

/**
 * Normalisation L2 d'un vecteur flottant (rend la norme euclidienne égale à 1.0)
 */
export function normalizeL2(vector: number[] | Float32Array | Int8Array | any): Float32Array {
  const v = vector instanceof Float32Array ? vector : new Float32Array(vector);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0 || !Number.isFinite(norm)) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * Quantification Int8 symétrique d'un vecteur L2-normalisé vers Int8Array [-127, 127]
 */
export function quantizeToInt8(vector: number[] | Float32Array | Int8Array | any): Int8Array {
  const norm = normalizeL2(vector);
  const out = new Int8Array(norm.length);
  for (let i = 0; i < norm.length; i++) {
    const scaled = Math.round(norm[i] * 127);
    out[i] = Math.max(-127, Math.min(127, scaled));
  }
  return out;
}

/**
 * Dé-quantification Int8 vers Float32Array L2-normalisé
 */
export function dequantizeFromInt8(int8Vec: Int8Array | number[]): Float32Array {
  const arr = int8Vec instanceof Int8Array ? int8Vec : new Int8Array(int8Vec);
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[i] / 127.0;
  }
  return normalizeL2(out);
}

/**
 * Similarité cosinus ultra-rapide entre deux vecteurs Int8
 */
export function computeCosineInt8(vecA: Int8Array, vecB: Int8Array): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(-1.0, Math.min(1.0, sim));
}

/**
 * Convertit un tableau de nombres ou Float32Array en Buffer binaire (BLOB).
 */
export function vectorToBlob(vector: number[] | Float32Array | Int8Array): Uint8Array {
  if (!vector || vector.length === 0) {
    return new Uint8Array(0);
  }
  if (vector instanceof Int8Array) {
    return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  }
  const float32 = vector instanceof Float32Array ? vector : new Float32Array(vector);
  return new Uint8Array(float32.buffer, float32.byteOffset, float32.byteLength);
}

/**
 * Reconstitue un tableau de nombres à partir d'un Buffer binaire (BLOB SQLite).
 */
export function blobToVector(blob: Uint8Array | ArrayBuffer | Buffer | null | undefined): number[] {
  if (!blob) return [];

  if (blob instanceof ArrayBuffer) {
    if (blob.byteLength % 4 !== 0) return [];
    return Array.from(new Float32Array(blob));
  }

  if (ArrayBuffer.isView(blob)) {
    if (blob.byteLength % 4 !== 0) return [];
    const uint8 = new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
    const copy = new Uint8Array(uint8);
    const float32 = new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
    return Array.from(float32);
  }

  return [];
}

/**
 * Reconstitue un Int8Array à partir d'un Buffer binaire (BLOB Int8).
 */
export function blobToInt8Vector(blob: Uint8Array | ArrayBuffer | Buffer | null | undefined): Int8Array {
  if (!blob) return new Int8Array(0);
  if (blob instanceof ArrayBuffer) {
    return new Int8Array(blob);
  }
  if (ArrayBuffer.isView(blob)) {
    return new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  }
  return new Int8Array(0);
}

let e5ExtractorInstance: any = null;
let e5ExtractorLoadingPromise: Promise<any> | null = null;

export async function getE5Extractor(): Promise<any> {
  if (e5ExtractorInstance) return e5ExtractorInstance;
  if (!e5ExtractorLoadingPromise) {
    e5ExtractorLoadingPromise = (async () => {
      try {
        const { pipeline, env } = await import('@xenova/transformers');
        
        // Sécurité et intégrité locale stricte : interdiction des téléchargements distants silencieux
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        
        // Résolution du chemin du dossier des modèles :
        // 1. Electron packaged : process.resourcesPath / 'models'
        // 2. Node / Développement : ./models
        // 3. Navigateur Web : /models
        if (typeof process !== 'undefined' && (process as any).resourcesPath) {
          const path = await import('path');
          env.localModelPath = path.join((process as any).resourcesPath, 'models');
        } else if (typeof process !== 'undefined' && process.cwd) {
          const path = await import('path');
          env.localModelPath = path.join(process.cwd(), 'models');
        } else {
          env.localModelPath = '/models';
        }

        const ext = await pipeline('feature-extraction', LOCAL_E5_CONFIG.modelId, { quantized: true });
        e5ExtractorInstance = ext;
        return ext;
      } catch (err) {
        console.warn('[E5_LOCAL] Artefact E5 / ONNX introuvable ou indisponible:', err);
        e5ExtractorLoadingPromise = null;
        throw err;
      }
    })();
  }
  return await e5ExtractorLoadingPromise;
}

/**
 * Calcule l'embedding local E5 (384D) avec préfixe ("query: " ou "passage: ") et normalisation L2.
 * En cas d'erreur ou d'indisponibilité, retourne null. AUCUN faux vecteur n'est produit.
 */
export async function computeE5Embedding(
  text: string,
  prefix: 'query: ' | 'passage: ' = 'query: '
): Promise<Int8Array | null> {
  if (!text || !text.trim()) return null;
  try {
    const extractor = await getE5Extractor();
    const formattedText = `${prefix}${text.trim()}`;
    const output = await extractor(formattedText, { pooling: 'mean', normalize: true });
    if (!output || !output.data) return null;
    return quantizeToInt8(output.data);
  } catch (err) {
    console.warn('[E5_LOCAL] Impossible de calculer l\'embedding E5:', err);
    return null;
  }
}

/**
 * Valide l'intégrité numérique stricte d'un vecteur d'embedding.
 */
export function validateEmbeddingVector(
  vector: number[] | Float32Array | Int8Array | null | undefined,
  expectedDim?: number
): { valid: boolean; error?: string; dimension: number } {
  if (!vector || vector.length === 0) {
    return { valid: false, error: "Vecteur vide ou null", dimension: 0 };
  }

  const dim = vector.length;
  if (expectedDim && dim !== expectedDim) {
    return { valid: false, error: `Dimension incorrecte: ${dim} (attendu ${expectedDim})`, dimension: dim };
  }

  for (let i = 0; i < dim; i++) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      return { valid: false, error: `Valeur numérique invalide à l'index ${i}: ${val}`, dimension: dim };
    }
  }

  return { valid: true, dimension: dim };
}

/**
 * Calcule la similarité cosinus pure entre deux vecteurs de même dimension.
 */
export function cosineSimilarity(vecA: number[] | Float32Array, vecB: number[] | Float32Array): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
