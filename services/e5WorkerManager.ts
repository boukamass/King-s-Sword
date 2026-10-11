/**
 * King's Sword — Gestionnaire de Worker d'Embedding E5 & Offloading (Phase 2F.20)
 * 
 * Assure que le calcul d'embeddings s'exécute dans un Worker séparé
 * sans jamais bloquer ou geler le thread principal de l'interface utilisateur.
 */

export interface WorkerBatchItem {
  id: string;
  text: string;
}

export interface WorkerBatchResultItem {
  id: string;
  vector: Int8Array | null;
}

export interface WorkerDiagnosticState {
  workerStatus: 'NON_INITIALISÉ' | 'EN_COURS' | 'DÉMARRÉ' | 'EN_ERREUR' | 'REPLI_THREAD_PRINCIPAL';
  workerErrorMessage: string | null;
  modelStatus: 'NON_CHARGÉ' | 'CHARGEMENT' | 'CHARGÉ' | 'ERREUR';
  modelErrorMessage: string | null;
  modelInfo: {
    path?: string;
    sizeBytes?: number;
    sha256?: string;
  } | null;
  lastActivityAt: string | null;
}

let workerInstance: Worker | null = null;
let isWorkerReady = false;
let initPromise: Promise<boolean> | null = null;
let requestIdCounter = 0;

let diagnosticState: WorkerDiagnosticState = {
  workerStatus: 'NON_INITIALISÉ',
  workerErrorMessage: null,
  modelStatus: 'NON_CHARGÉ',
  modelErrorMessage: null,
  modelInfo: null,
  lastActivityAt: null
};

export function getWorkerDiagnosticState(): WorkerDiagnosticState {
  return diagnosticState;
}

/**
 * Nombre optimal de threads ONNX (la moitié des cœurs du système, minimum 1)
 */
export function getRecommendedThreadCount(): number {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
  }
  return 2;
}

/**
 * Initialise le Worker d'embedding E5 en arrière-plan
 */
export async function initE5Worker(): Promise<boolean> {
  if (isWorkerReady) return true;
  if (initPromise) return initPromise;

  diagnosticState.workerStatus = 'EN_COURS';
  diagnosticState.modelStatus = 'CHARGEMENT';
  diagnosticState.lastActivityAt = new Date().toISOString();

  initPromise = (async () => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      console.warn('[E5WorkerManager] Web Workers non supportés dans cet environnement.');
      diagnosticState.workerStatus = 'REPLI_THREAD_PRINCIPAL';
      diagnosticState.workerErrorMessage = 'Web Workers non supportés';
      return false;
    }

    try {
      if (!workerInstance) {
        workerInstance = new Worker(new URL('./e5EmbeddingWorker.ts', import.meta.url), { type: 'module' });

        workerInstance.onmessage = (e: MessageEvent) => {
          const { type, id, results, error, details } = e.data || {};
          const pending = pendingRequests.get(id);

          diagnosticState.lastActivityAt = new Date().toISOString();

          if (type === 'INIT_SUCCESS') {
            isWorkerReady = true;
            diagnosticState.workerStatus = 'DÉMARRÉ';
            diagnosticState.modelStatus = 'CHARGÉ';
            diagnosticState.modelErrorMessage = null;
            if (details) {
              diagnosticState.modelInfo = details;
            }
            if (pending) {
              pendingRequests.delete(id);
              pending.resolve(true);
            }
          } else if (type === 'INIT_ERROR') {
            isWorkerReady = false;
            diagnosticState.workerStatus = 'EN_ERREUR';
            diagnosticState.modelStatus = 'ERREUR';
            diagnosticState.modelErrorMessage = error || 'Erreur initialisation modèle E5';
            diagnosticState.workerErrorMessage = error;
            if (pending) {
              pendingRequests.delete(id);
              pending.reject(new Error(error || 'Erreur initialisation Worker E5'));
            }
          } else if (type === 'BATCH_SUCCESS') {
            if (pending) {
              pendingRequests.delete(id);
              pending.resolve(results);
            }
          } else if (type === 'BATCH_ERROR') {
            if (pending) {
              pendingRequests.delete(id);
              pending.reject(new Error(error || 'Erreur calcul batch Worker E5'));
            }
          }
        };

        workerInstance.onerror = (err) => {
          console.warn('[E5WorkerManager] Erreur globale du Worker E5:', err);
          isWorkerReady = false;
          diagnosticState.workerStatus = 'EN_ERREUR';
          diagnosticState.workerErrorMessage = err?.message || String(err);
        };
      }

      const reqId = `init-${++requestIdCounter}`;
      const numThreads = getRecommendedThreadCount();

      let modelInfo: any = null;
      if (typeof window !== 'undefined' && window.electronAPI?.system?.getModelInfo) {
        try {
          modelInfo = await window.electronAPI.system.getModelInfo();
        } catch (e) {
          console.warn('[E5WorkerManager] Erreur appel IPC getModelInfo:', e);
        }
      }

      const loc = window.location;
      let baseUrl = './';
      if (loc) {
        if (loc.protocol === 'file:') {
          baseUrl = loc.href.substring(0, loc.href.lastIndexOf('/') + 1);
        } else {
          baseUrl = loc.origin + loc.pathname.replace(/\/[^\/]*$/, '/');
        }
      }

      let modelPath = baseUrl + 'models/';
      let wasmPath = baseUrl + 'wasm/';

      if (modelInfo && modelInfo.resourcesPath) {
        let cleanResPath = modelInfo.resourcesPath.replace(/\\/g, '/');
        if (!cleanResPath.startsWith('/')) cleanResPath = '/' + cleanResPath;
        const resUrl = 'file://' + cleanResPath + '/';
        modelPath = resUrl + 'models/';
        wasmPath = resUrl + 'wasm/';
      }

      const promise = new Promise<boolean>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Délai d\'attente de 8s dépassé pour l\'initialisation du Worker E5'));
        }, 8000);

        pendingRequests.set(reqId, {
          resolve: (v) => { clearTimeout(timeout); resolve(v); },
          reject: (r) => { clearTimeout(timeout); reject(r); }
        });
      });

      workerInstance.postMessage({
        type: 'INIT',
        id: reqId,
        payload: {
          numThreads,
          modelPath,
          wasmPath,
          modelInfo
        }
      });

      return await promise;
    } catch (err: any) {
      console.warn('[E5WorkerManager] Échec de création du Worker E5, bascule vers le thread principal découpé:', err);
      workerInstance = null;
      isWorkerReady = false;
      diagnosticState.workerStatus = 'REPLI_THREAD_PRINCIPAL';
      diagnosticState.workerErrorMessage = err?.message || String(err);
      diagnosticState.modelStatus = 'ERREUR';
      diagnosticState.modelErrorMessage = err?.message || String(err);
      return false;
    }
  })();

  return initPromise;
}

const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}>();

/**
 * Exécute un lot d'embeddings dans le Worker séparé
 */
export async function computeE5BatchInWorker(
  items: WorkerBatchItem[],
  prefix: 'query: ' | 'passage: ' = 'passage: '
): Promise<WorkerBatchResultItem[]> {
  const ready = await initE5Worker();

  if (ready && workerInstance) {
    const reqId = `batch-${++requestIdCounter}`;
    const promise = new Promise<WorkerBatchResultItem[]>((resolve, reject) => {
      pendingRequests.set(reqId, { resolve, reject });
    });

    workerInstance.postMessage({
      type: 'COMPUTE_BATCH',
      id: reqId,
      payload: { items, prefix }
    });

    return await promise;
  }

  // Repli sécurisé en thread principal avec découpage asynchrone
  const { computeE5Embedding } = await import('./embeddingService');
  const results: WorkerBatchResultItem[] = [];

  for (const item of items) {
    await new Promise(resolve => setTimeout(resolve, 0));
    const vec = await computeE5Embedding(item.text, prefix);
    results.push({ id: item.id, vector: vec });
  }

  return results;
}
