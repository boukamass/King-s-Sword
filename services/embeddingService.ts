/**
 * King's Sword — Service d'Embedding et de Sérialisation Vectorielle (Phase 2B.2)
 * 
 * Assure la conversion bidirectionnelle binaire haute performance (Float32Array <-> BLOB SQLite)
 * et la validation d'intégrité numérique pour le modèle 'gemini-embedding-2-preview'.
 */

export const EMBEDDING_CONFIG = {
  model: 'gemini-embedding-2-preview',
  defaultDimension: 3072,
  bytesPerVector: 3072 * 4 // 12 288 octets en Float32
};

/**
 * Convertit un tableau de nombres ou Float32Array en Buffer binaire (BLOB).
 */
export function vectorToBlob(vector: number[] | Float32Array): Uint8Array {
  if (!vector || vector.length === 0) {
    return new Uint8Array(0);
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
 * Valide l'intégrité numérique stricte d'un vecteur d'embedding.
 */
export function validateEmbeddingVector(
  vector: number[] | Float32Array | null | undefined,
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
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
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
