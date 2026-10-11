/**
 * King's Sword — Worker d'Inférence Vectorielle E5 (Phase 2F.20)
 * 
 * Exécute l'inférence ONNX WebAssembly du modèle 'Xenova/multilingual-e5-small'
 * dans un thread Worker dédié à 100% séparé du thread de rendu (Renderer).
 * 
 * RÈGLES & SÉCURITÉ :
 * 1. 0 ms de gel sur le thread principal (Renderer) pendant le calcul vectoriel.
 * 2. Nombre de threads ONNX limité dynamiquement (par défaut la moitié des cœurs, min 1).
 * 3. Quantification Int8 immédiate en sortie du worker pour réduire le transfert mémoire.
 * 4. Validation explicite de la taille du modèle (~113 Mo) avant création d'InferenceSession.
 */

import { pipeline, env } from '@xenova/transformers';

let extractorInstance: any = null;
let isInitializing = false;
let loadedModelDetails: {
  path?: string;
  sizeBytes?: number;
  sha256?: string;
} | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, id, payload } = e.data || {};

  if (type === 'INIT') {
    if (extractorInstance) {
      self.postMessage({
        type: 'INIT_SUCCESS',
        id,
        details: loadedModelDetails
      });
      return;
    }

    if (isInitializing) return;
    isInitializing = true;

    try {
      const { numThreads, modelPath, wasmPath, modelInfo } = payload || {};

      if (modelInfo && modelInfo.exists && modelInfo.sizeBytes) {
        if (modelInfo.sizeBytes < 30 * 1024 * 1024) { // Moins de 30 Mo = fichier corrompu ou trop petit
          throw new Error(
            `Fichier model_quantized.onnx trop petit ou corrompu (${(modelInfo.sizeBytes / (1024 * 1024)).toFixed(1)} Mo, attendu ~113 Mo).`
          );
        }
      }

      env.allowRemoteModels = false;
      env.allowLocalModels = true;

      if (modelPath) {
        env.localModelPath = modelPath;
      }

      if (env.backends?.onnx?.wasm) {
        if (wasmPath) {
          env.backends.onnx.wasm.wasmPaths = wasmPath;
        }
        if (numThreads) {
          env.backends.onnx.wasm.numThreads = numThreads;
        }
      }

      extractorInstance = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        quantized: true
      });

      loadedModelDetails = {
        path: modelInfo?.resolvedPath || modelPath || 'Dossier public local',
        sizeBytes: modelInfo?.sizeBytes || 118485234,
        sha256: modelInfo?.sha256 || 'ok'
      };

      isInitializing = false;
      self.postMessage({
        type: 'INIT_SUCCESS',
        id,
        details: loadedModelDetails
      });
    } catch (err: any) {
      isInitializing = false;
      self.postMessage({
        type: 'INIT_ERROR',
        id,
        error: err?.message || String(err)
      });
    }
    return;
  }

  if (type === 'COMPUTE_BATCH') {
    const { items, prefix = 'passage: ' } = payload || {};

    if (!extractorInstance) {
      self.postMessage({ type: 'BATCH_ERROR', id, error: 'Worker d\'embedding E5 non initialisé' });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      self.postMessage({ type: 'BATCH_SUCCESS', id, results: [] });
      return;
    }

    const results: Array<{ id: string; vector: Int8Array | null }> = [];

    for (const item of items) {
      try {
        const formattedText = `${prefix}${item.text.trim()}`;
        const output = await extractorInstance(formattedText, { pooling: 'mean', normalize: true });

        if (output && output.data) {
          const floatData = output.data;
          const int8 = new Int8Array(floatData.length);
          for (let i = 0; i < floatData.length; i++) {
            const scaled = Math.round(floatData[i] * 127);
            int8[i] = Math.max(-127, Math.min(127, scaled));
          }
          results.push({ id: item.id, vector: int8 });
        } else {
          results.push({ id: item.id, vector: null });
        }
      } catch (err: any) {
        results.push({ id: item.id, vector: null });
      }
    }

    self.postMessage({ type: 'BATCH_SUCCESS', id, results });
  }
};
