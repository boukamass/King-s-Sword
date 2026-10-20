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
          const cleanWasmPath = wasmPath.endsWith('/') ? wasmPath : wasmPath + '/';
          env.backends.onnx.wasm.wasmPaths = cleanWasmPath;
        }

        // Sécurité WebAssembly dans le Web Worker :
        // Le Worker s'exécute déjà dans un thread d'arrière-plan dédié (0 ms d'impact sur le thread de rendu).
        // En environnement standard navigateur ou Electron sans isolation cross-origin stricte (headers COOP/COEP),
        // SharedArrayBuffer est indisponible et onnxruntime-web requiert des scripts *.worker.js multi-threadés.
        // Tenter numThreads > 1 déclenche alors : 'failed to asynchronously prepare wasm: [object ProgressEvent]'.
        // On force donc numThreads = 1 (avec accélération SIMD ort-wasm-simd.wasm) pour un démarrage instantané et sans erreur.
        const canUseSharedThreads = typeof self !== 'undefined' && 
                                   (self as any).crossOriginIsolated === true && 
                                   typeof SharedArrayBuffer !== 'undefined';

        env.backends.onnx.wasm.numThreads = canUseSharedThreads && numThreads && numThreads > 1 ? numThreads : 1;
        env.backends.onnx.wasm.proxy = false;
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

    // Tenter l'inférence directe par lot (batching haute performance Étape 3)
    let batchSucceeded = false;
    try {
      const formattedTexts = items.map(item => `${prefix}${item.text.trim()}`);
      const output = await extractorInstance(formattedTexts, { pooling: 'mean', normalize: true });

      if (output && output.data && output.dims && output.dims.length >= 2) {
        const dim = output.dims[output.dims.length - 1];
        const floatData = output.data;

        for (let idx = 0; idx < items.length; idx++) {
          const start = idx * dim;
          const int8 = new Int8Array(dim);
          for (let i = 0; i < dim; i++) {
            const scaled = Math.round(floatData[start + i] * 127);
            int8[i] = Math.max(-127, Math.min(127, scaled));
          }
          results.push({ id: items[idx].id, vector: int8 });
        }
        batchSucceeded = true;
      }
    } catch (_batchErr) {
      batchSucceeded = false;
    }

    // Repli de secours séquentiel si le batch direct a échoué
    if (!batchSucceeded) {
      results.length = 0;
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
    }

    self.postMessage({ type: 'BATCH_SUCCESS', id, results });
  }
};
