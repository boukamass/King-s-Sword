/**
 * King's Sword — Corpus Index Initialization Service (Phase 2F.20)
 * 
 * Gestionnaire d'initialisation, de préparation et d'indexation automatique
 * du corpus complet de sermons au premier lancement chez l'utilisateur.
 */

import { Sermon, SermonChunk } from '../types';
import { createLibraryChunks, computeChunkHash } from './chunkingService';
import { saveChunks, getAllChunks } from './chunkStorageService';
import { runIncrementalEmbeddingIndexing, EmbeddingIndexResult, pauseIndexing, resumeIndexing, getIndexingControlsState } from './embeddingIndexService';
import { validateEmbeddingVector } from './embeddingService';
import { loadExposeAsSermons, hydrateExposePrecalculatedEmbeddings, createExposeDocumentChunks } from './exposeDocumentService';
import { getWorkerDiagnosticState } from './e5WorkerManager';
import { getStaticResourceUrl } from '../utils/fetchHelper';
import { get, set } from 'idb-keyval';

export type IndexingStatus = 'NOT_STARTED' | 'SCANNING' | 'CHUNKING' | 'EMBEDDING' | 'READY' | 'PARTIAL' | 'ERROR';

export interface CorpusIndexProgress {
  status: IndexingStatus;
  sermonsProcessed: number;
  totalSermons: number;
  chunksProcessed: number;
  totalChunks: number;
  embeddingsCreated: number;
  embeddingsReused: number;
  errors: number;
  chunksPerSec: number;
  etaFormatted: string;
  isPaused: boolean;
  pauseReason: string | null;
  sermonSource: string;
  workerStatus: 'NON_INITIALISÉ' | 'EN_COURS' | 'DÉMARRÉ' | 'EN_ERREUR' | 'REPLI_THREAD_PRINCIPAL';
  workerErrorMessage: string | null;
  modelStatus: 'NON_CHARGÉ' | 'CHARGEMENT' | 'CHARGÉ' | 'ERREUR';
  modelErrorMessage: string | null;
  modelInfo: {
    path?: string;
    sizeBytes?: number;
    sha256?: string;
  } | null;
  lastError: string | null;
  lastActivityAt: string | null;
  corpusVersion: string;
  lastIndexedAt: string | null;
  errorMessage: string | null;
}

const INDEX_STATUS_STORAGE_KEY = 'ks_corpus_index_status_v1';
export const INDEXING_PAUSE_ON_STARTUP_KEY = 'ks_indexing_paused_on_startup';

let registeredSermonsMap: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any> | undefined = undefined;

export function registerSermonsMapForIndexing(map: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>): void {
  registeredSermonsMap = map;
}

export function getRegisteredSermonsMap(): Map<string, any> | undefined {
  return registeredSermonsMap;
}

/**
 * Indique si l'indexation doit être mise en pause au démarrage de l'application
 * pour éviter les ralentissements système au lancement.
 * Par défaut : true (en pause au démarrage pour fluidité maximale).
 */
export function isIndexingPausedOnStartup(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(INDEXING_PAUSE_ON_STARTUP_KEY);
      if (stored === null) {
        return true; // En pause par défaut au lancement pour garantir la fluidité
      }
      return stored === 'true';
    }
  } catch (e) {
    // Ignorer
  }
  return true;
}

/**
 * Configure la préférence de pause au lancement
 */
export function setIndexingPausedOnStartup(paused: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(INDEXING_PAUSE_ON_STARTUP_KEY, paused ? 'true' : 'false');
    }
  } catch (e) {
    // Ignorer
  }
}

let isIndexingInProgress = false;
let watchdogInterval: any = null;
let lastProgressSnapshot = 0;
let lastProgressTime = Date.now();

let currentProgress: CorpusIndexProgress = {
  status: 'NOT_STARTED',
  sermonsProcessed: 0,
  totalSermons: 0,
  chunksProcessed: 0,
  totalChunks: 0,
  embeddingsCreated: 0,
  embeddingsReused: 0,
  errors: 0,
  chunksPerSec: 0,
  etaFormatted: 'En attente...',
  isPaused: false,
  pauseReason: null,
  sermonSource: 'Détection...',
  workerStatus: 'NON_INITIALISÉ',
  workerErrorMessage: null,
  modelStatus: 'NON_CHARGÉ',
  modelErrorMessage: null,
  modelInfo: null,
  lastError: null,
  lastActivityAt: null,
  corpusVersion: 'v1.0.0-default',
  lastIndexedAt: null,
  errorMessage: null
};

// Listeners pour l'état d'avancement
type ProgressListener = (progress: CorpusIndexProgress) => void;
const progressListeners: Set<ProgressListener> = new Set();

export function subscribeIndexProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  listener(getCurrentIndexProgress());
  return () => progressListeners.delete(listener);
}

function notifyProgressUpdate(update: Partial<CorpusIndexProgress>): void {
  const wDiag = getWorkerDiagnosticState();
  currentProgress = {
    ...currentProgress,
    workerStatus: wDiag.workerStatus,
    workerErrorMessage: wDiag.workerErrorMessage,
    modelStatus: wDiag.modelStatus,
    modelErrorMessage: wDiag.modelErrorMessage,
    modelInfo: wDiag.modelInfo || currentProgress.modelInfo,
    lastActivityAt: wDiag.lastActivityAt || new Date().toISOString(),
    ...update
  };

  if (update.errorMessage) {
    currentProgress.lastError = update.errorMessage;
  }

  progressListeners.forEach(fn => {
    try {
      fn(currentProgress);
    } catch (e) {
      console.warn('[CorpusIndexInit] Erreur listener:', e);
    }
  });
  const isKeyStatusChange = !!(update.status && (update.status === 'READY' || update.status === 'ERROR' || update.status === 'PARTIAL'));
  persistProgressState(currentProgress, isKeyStatusChange).catch(() => {});
}

let persistProgressTimer: any = null;
let pendingProgressToPersist: CorpusIndexProgress | null = null;

async function doPersistProgress(prog: CorpusIndexProgress): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(INDEX_STATUS_STORAGE_KEY, JSON.stringify(prog));
    }
    if (typeof indexedDB !== 'undefined') {
      await set(INDEX_STATUS_STORAGE_KEY, prog);
    }
  } catch (e) {
    // Ignorer
  }
}

async function persistProgressState(prog: CorpusIndexProgress, immediate: boolean = false): Promise<void> {
  pendingProgressToPersist = prog;

  if (immediate || prog.status === 'READY' || prog.status === 'ERROR' || prog.status === 'PARTIAL') {
    if (persistProgressTimer) {
      clearTimeout(persistProgressTimer);
      persistProgressTimer = null;
    }
    await doPersistProgress(prog);
    return;
  }

  if (!persistProgressTimer) {
    persistProgressTimer = setTimeout(() => {
      persistProgressTimer = null;
      if (pendingProgressToPersist) {
        doPersistProgress(pendingProgressToPersist).catch(() => {});
      }
    }, 2500);
  }
}

export async function loadPersistedProgressState(): Promise<CorpusIndexProgress> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(INDEX_STATUS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        currentProgress = { ...currentProgress, ...parsed };
      }
    }
    if (typeof indexedDB !== 'undefined') {
      const stored = await get<CorpusIndexProgress>(INDEX_STATUS_STORAGE_KEY);
      if (stored) {
        currentProgress = { ...currentProgress, ...stored };
      }
    }
    // RÉINITIALISATION AU DÉMARRAGE : réinitialise tout état 'en cours' hérité d'une session précédente
    if (currentProgress.status === 'SCANNING' || currentProgress.status === 'CHUNKING' || currentProgress.status === 'EMBEDDING') {
      currentProgress.status = currentProgress.chunksProcessed > 0 ? 'PARTIAL' : 'NOT_STARTED';
      currentProgress.errorMessage = null;
    }
    if (isIndexingPausedOnStartup() && currentProgress.status !== 'READY') {
      currentProgress.isPaused = true;
      currentProgress.pauseReason = 'Indexation en pause au démarrage (Démarrer à volonté)';
    }
    isIndexingInProgress = false;
  } catch (e) {
    // Ignorer
  }
  return getCurrentIndexProgress();
}

/**
 * Calcule le SHA-256 canonique des chunks de sermons (chunkId + text)
 * identique à scripts/build_sermons_index.ts.
 */
async function computeSermonChunksSha256(chunks: SermonChunk[]): Promise<string | undefined> {
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const crypto = await import('crypto');
      const hasher = crypto.createHash('sha256');
      for (const c of chunks) {
        hasher.update(c.chunkId + (c.text || ''));
      }
      return hasher.digest('hex');
    }
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      const encoder = new TextEncoder();
      const parts = chunks.map(c => c.chunkId + (c.text || '')).join('');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(parts));
      return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Ignorer
  }
  return undefined;
}

/**
 * Configure l'état initial au démarrage :
 * Tente d'abord de charger l'index précalculé des sermons et de l'Exposé (0 calcul ONNX, sans dépendre du bouton Démarrer).
 * Si aucun index précalculé valide n'est disponible, met l'indexation ONNX en pause au démarrage.
 */
export async function setIndexingPausedInitialState(
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>
): Promise<CorpusIndexProgress> {
  await loadPersistedProgressState();
  // Charge et active automatiquement l'index vectoriel précalculé au démarrage (0 calcul ONNX)
  return initializeCorpusIndex({
    loadedSermonsMap: loadedSermonsMap || registeredSermonsMap,
    precalculatedOnly: true
  });
}

/**
 * Démarre ou reprend l'indexation à la demande de l'utilisateur
 */
export async function startOrResumeIndexing(options: {
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  forceReindex?: boolean;
} = {}): Promise<CorpusIndexProgress> {
  resumeIndexing();
  notifyProgressUpdate({
    isPaused: false,
    pauseReason: null
  });

  if (!isIndexingInProgress) {
    const map = options.loadedSermonsMap || registeredSermonsMap;
    return initializeCorpusIndex({
      loadedSermonsMap: map,
      forceReindex: options.forceReindex
    });
  }

  return getCurrentIndexProgress();
}

/**
 * Met en pause l'indexation en cours
 */
export function pauseActiveIndexing(): void {
  pauseIndexing();
  notifyProgressUpdate({
    isPaused: true,
    pauseReason: 'Indexation mise en pause manuellement'
  });
}

/**
 * Bascule l'état de pause / reprise
 */
export async function toggleIndexingPause(options: {
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
} = {}): Promise<CorpusIndexProgress> {
  const controls = getIndexingControlsState();
  if (currentProgress.isPaused || controls.isPaused) {
    return startOrResumeIndexing(options);
  } else {
    pauseActiveIndexing();
    return getCurrentIndexProgress();
  }
}

function startWatchdog(): void {
  stopWatchdog();
  lastProgressSnapshot = currentProgress.chunksProcessed + currentProgress.embeddingsCreated;
  lastProgressTime = Date.now();

  watchdogInterval = setInterval(() => {
    if (!isIndexingInProgress) {
      stopWatchdog();
      return;
    }

    // SI EN PAUSE : Ne jamais déclencher le watchdog d'erreur
    const indexingControls = getIndexingControlsState();
    if (currentProgress.isPaused || indexingControls.isPaused) {
      lastProgressTime = Date.now();
      return;
    }

    const currentSnap = currentProgress.chunksProcessed + currentProgress.embeddingsCreated;
    const now = Date.now();

    if (currentSnap > lastProgressSnapshot) {
      lastProgressSnapshot = currentSnap;
      lastProgressTime = now;
    } else if (now - lastProgressTime >= 60000) {
      console.warn('[CorpusIndexInit] Watchdog 60s déclenché : aucune progression.');
      notifyProgressUpdate({
        status: 'ERROR',
        errorMessage: 'Indexation interrompue : aucune progression observée depuis 60 secondes (watchdog de sécurité).'
      });
      isIndexingInProgress = false;
      stopWatchdog();
    }
  }, 5000);
}

function stopWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}

export async function forceResetIndexing(): Promise<CorpusIndexProgress> {
  stopWatchdog();
  isIndexingInProgress = false;
  currentProgress = {
    ...currentProgress,
    status: 'NOT_STARTED',
    errorMessage: null,
    lastError: null,
    chunksProcessed: 0,
    embeddingsCreated: 0
  };
  notifyProgressUpdate({ status: 'NOT_STARTED' });
  return initializeCorpusIndex({ forceReindex: true });
}

/**
 * Détecte les sermons disponibles dans l'environnement courant
 */
export async function detectAvailableCorpus(
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>
): Promise<{ sermons: Sermon[]; corpusVersion: string; source: string }> {
  let sermons: Sermon[] = [];
  let source = 'Non identifiée';

  // 1. Map mémoire déjà chargée
  if (loadedSermonsMap && loadedSermonsMap.size > 0) {
    sermons = Array.from(loadedSermonsMap.values()).filter((s): s is Sermon => !!s && typeof (s as any).text === 'string' && (s as any).text.length > 0);
    if (sermons.length > 0) source = 'Map Mémoire UI';
  }

  // 2. Repli Electron / IPC (SQLite)
  if (sermons.length === 0 && typeof window !== 'undefined' && window.electronAPI?.db) {
    try {
      if (window.electronAPI.db.getAllSermonsWithParagraphs) {
        const fullSermons = await window.electronAPI.db.getAllSermonsWithParagraphs();
        if (Array.isArray(fullSermons) && fullSermons.length > 0) {
          sermons = fullSermons;
          source = 'SQLite / IPC Bulk (Electron)';
        }
      }
      
      if (sermons.length === 0 && window.electronAPI.db.getSermonsMetadata) {
        const meta = await window.electronAPI.db.getSermonsMetadata();
        if (Array.isArray(meta) && meta.length > 0) {
          const fullSermons: Sermon[] = [];
          for (const m of meta) {
            const full = await window.electronAPI.db.getSermonFull(m.id);
            if (full) fullSermons.push(full);
          }
          if (fullSermons.length > 0) {
            sermons = fullSermons;
            source = 'SQLite / IPC (Electron)';
          }
        }
      }
    } catch (e) {
      console.warn('[CorpusIndexInit] Erreur détection Electron db:', e);
    }
  }

  // 3. Repli Web / static library.json
  if (sermons.length === 0) {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(getStaticResourceUrl('library.json'));
        if (res.ok) {
          const rawSermons = await res.json();
          const { normalizeSermonsForSqlite } = await import('./chunkingService');
          sermons = normalizeSermonsForSqlite(rawSermons);
          if (sermons.length > 0) source = 'Fichier statique library.json';
        }
      } else {
        const fs = await import('fs');
        const path = await import('path');
        const cand = path.resolve('public/library.json');
        if (fs.existsSync(cand)) {
          const rawSermons = JSON.parse(fs.readFileSync(cand, 'utf8'));
          const { normalizeSermonsForSqlite } = await import('./chunkingService');
          sermons = normalizeSermonsForSqlite(rawSermons);
          if (sermons.length > 0) source = 'Fichier local library.json';
        }
      }
    } catch (e) {
      console.warn('[CorpusIndexInit] Erreur détection library.json:', e);
    }
  }

  // 4. Intégrer l'Exposé complet des 7 Âges
  try {
    const exposeSermons = await loadExposeAsSermons();
    if (exposeSermons && exposeSermons.length > 0) {
      const existingIds = new Set(sermons.map(s => s.id));
      for (const es of exposeSermons) {
        if (!existingIds.has(es.id)) {
          sermons.push(es);
        }
      }
      if (source === 'Non identifiée') source = 'Corpus Exposé seul';
    }
  } catch (e) {
    console.warn('[CorpusIndexInit] Erreur chargement Exposé:', e);
  }

  if (sermons.length === 0) {
    source = 'Aucun sermon disponible';
  }

  const sermonIds = sermons.map(s => s.id).sort().join(',');
  const corpusVersion = `v1-${sermons.length}-${sermonIds.substring(0, 32)}`;

  return { sermons, corpusVersion, source };
}

/**
 * Lance l'initialisation de l'index au premier lancement ou à la reprise.
 */
export async function initializeCorpusIndex(options: {
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  forceReindex?: boolean;
  precalculatedOnly?: boolean;
  apiKey?: string;
  batchSize?: number;
} = {}): Promise<CorpusIndexProgress> {
  if (isIndexingInProgress) {
    console.log('[CorpusIndexInit] Indexation déjà en cours. Ignoré.');
    return getCurrentIndexProgress();
  }

  isIndexingInProgress = true;
  if (!options.precalculatedOnly) {
    startWatchdog();
  }

  try {
    await loadPersistedProgressState();

    // CHARGEMENT AUTOMATIQUE PRIORITAIRE DE L'INDEX VECTORIEL PRÉCALCULÉ (0ms ONNX, 0 blocage SQLite)
    if (!options.forceReindex) {
      try {
        const { loadSermonsPrecalculatedIndex } = await import('./precalculatedIndexService');
        const { loadBinaryVectorStorage } = await import('./binaryVectorStorageService');

        const [sermonsPrecalc, binState, exposeChunks] = await Promise.all([
          loadSermonsPrecalculatedIndex().catch(() => ({ valid: false } as any)),
          loadBinaryVectorStorage({
            target: 'sermons',
            binaryFileName: 'sermons_vectors.bin',
            indexFileName: 'sermons_vectors.idx'
          }).catch(() => ({ loaded: false, totalVectors: 0 } as any)),
          createExposeDocumentChunks().catch(() => [] as SermonChunk[])
        ]);

        if (exposeChunks.length > 0) {
          await hydrateExposePrecalculatedEmbeddings(exposeChunks).catch(() => {});
        }

        if (binState && binState.loaded && binState.totalVectors > 0) {
          const metaSermonsCount = sermonsPrecalc?.indexData?.metadata?.totalSermons ||
            (options.loadedSermonsMap && options.loadedSermonsMap.size > 0 ? options.loadedSermonsMap.size : 1);
          const totalPrecalcChunks = binState.totalVectors + exposeChunks.length;

          console.log(`[CorpusIndexInit] ✓ Index vectoriel précalculé activé automatiquement (${binState.totalVectors} vecteurs de sermons + ${exposeChunks.length} chunks Exposé).`);
          notifyProgressUpdate({
            status: 'READY',
            isPaused: false,
            pauseReason: null,
            embeddingsCreated: 0,
            embeddingsReused: totalPrecalcChunks,
            chunksProcessed: totalPrecalcChunks,
            totalChunks: totalPrecalcChunks,
            sermonsProcessed: metaSermonsCount,
            totalSermons: metaSermonsCount,
            sermonSource: 'Index vectoriel précalculé (KSIX)',
            etaFormatted: 'Terminé',
            lastIndexedAt: new Date().toISOString(),
            errorMessage: null
          });
          isIndexingInProgress = false;
          stopWatchdog();
          return getCurrentIndexProgress();
        }
      } catch (fastPrecalcErr) {
        console.warn('[CorpusIndexInit] Vérification rapide index précalculé:', fastPrecalcErr);
      }
    }

    if (!options.precalculatedOnly) {
      notifyProgressUpdate({
        status: 'SCANNING',
        errorMessage: null
      });
    }

    const { sermons, corpusVersion, source } = await detectAvailableCorpus(options.loadedSermonsMap);
    
    if (sermons.length === 0) {
      if (!options.precalculatedOnly) {
        notifyProgressUpdate({
          status: 'ERROR',
          sermonsProcessed: 0,
          totalSermons: 0,
          sermonSource: source,
          errorMessage: 'Aucun sermon détecté : vérifier la source des sermons.'
        });
      }
      isIndexingInProgress = false;
      stopWatchdog();
      return getCurrentIndexProgress();
    }

    const librarySermonsOnly = sermons.filter(s => !s.id.startsWith('expose-ch-') && !s.id.startsWith('bible-') && !s.id.startsWith('song-'));
    const totalSermonsCount = librarySermonsOnly.length > 0 ? librarySermonsOnly.length : sermons.length;
    
    notifyProgressUpdate({
      totalSermons: totalSermonsCount,
      sermonsProcessed: 0,
      sermonSource: source,
      corpusVersion
    });

    // 1. CHUNKING CANONIQUE AVEC TEXTE COMPLET DEPUIS SQLITE / JSON (Point 3)
    if (!options.precalculatedOnly) {
      notifyProgressUpdate({ status: 'CHUNKING' });
    }
    const tChunkStart = performance.now();
    const sermonChunks = createLibraryChunks(librarySermonsOnly);
    const exposeChunks = await createExposeDocumentChunks();
    const officialChunks = [...sermonChunks, ...exposeChunks];
    const tChunkElapsed = Math.round((performance.now() - tChunkStart) * 100) / 100;
    console.log(`[Diagnostic Indexation] ✓ Chunking terminé : ${officialChunks.length} chunks en ${tChunkElapsed} ms`);
    
    notifyProgressUpdate({
      totalChunks: officialChunks.length,
      sermonsProcessed: 0
    });

    // 2. INDEXATION BM25 / VOCABULAIRE
    const tBm25Start = performance.now();
    try {
      const { buildCorpusVocabulary } = await import('./corpusVocabularyService');
      const vocab = buildCorpusVocabulary(officialChunks);
      const tBm25Elapsed = Math.round((performance.now() - tBm25Start) * 100) / 100;
      console.log(`[Diagnostic Indexation] ✓ Indexation BM25 terminée : ${vocab.terms.size} termes uniques en ${tBm25Elapsed} ms`);
    } catch (e) {
      console.warn('[Diagnostic Indexation] Indexation BM25 ignorée:', e);
    }

    // 3. VÉRIFICATION ET HYDRATATION PRIORITAIRE DE L'INDEX PRÉ-CALCULÉ DES SERMONS (Points 2, 3, 5, 6)
    if (!options.forceReindex) {
      try {
        const { loadSermonsPrecalculatedIndex } = await import('./precalculatedIndexService');
        const { hydrateChunksWithBinaryVectors } = await import('./binaryVectorStorageService');

        const sermonsPrecalc = await loadSermonsPrecalculatedIndex();

        if (sermonsPrecalc.valid) {
          // Hydrate les vecteurs sur sermonChunks dont le texte complet vient de SQLite/JSON (Point 3)
          await hydrateChunksWithBinaryVectors(sermonChunks, {
            target: 'sermons',
            binaryFileName: 'sermons_vectors.bin',
            indexFileName: 'sermons_vectors.idx'
          });
        } else {
          // Même si sermons_meta.json est absent, tente d'hydrater directement depuis sermons_vectors.bin/.idx
          await hydrateChunksWithBinaryVectors(sermonChunks, {
            target: 'sermons',
            binaryFileName: 'sermons_vectors.bin',
            indexFileName: 'sermons_vectors.idx'
          });
        }

        // Hydratation de l'Exposé
        await hydrateExposePrecalculatedEmbeddings(exposeChunks);
      } catch (err) {
        console.warn('[CorpusIndexInit] Erreur vérification index précalculé sermons:', err);
      }
    }

    // Vérification directe en mémoire : si tous les chunks (sermons + Exposé) ont leur vecteur 384D valide ET leur texte non vide, passage immédiat en READY
    let inMemoryValidCount = 0;
    for (const chunk of officialChunks) {
      if (
        chunk.text &&
        chunk.text.trim().length > 0 &&
        chunk.embedding &&
        validateEmbeddingVector(chunk.embedding, 384).valid
      ) {
        inMemoryValidCount++;
      }
    }

    if (inMemoryValidCount === officialChunks.length && !options.forceReindex) {
      console.log(`[CorpusIndexInit] ✓ Corpus 100% hydraté (${officialChunks.length} chunks avec texte et vecteur Int8 384D, 0ms recalcul ONNX).`);
      notifyProgressUpdate({
        status: 'READY',
        isPaused: false,
        pauseReason: null,
        embeddingsCreated: 0,
        embeddingsReused: officialChunks.length,
        chunksProcessed: officialChunks.length,
        totalChunks: officialChunks.length,
        sermonsProcessed: totalSermonsCount,
        totalSermons: totalSermonsCount,
        etaFormatted: 'Terminé',
        lastIndexedAt: new Date().toISOString(),
        errorMessage: null
      });
      isIndexingInProgress = false;
      stopWatchdog();
      return getCurrentIndexProgress();
    }

    // Si on était uniquement en vérification d'index précalculé au démarrage (bouton Démarrer en pause)
    if (options.precalculatedOnly) {
      isIndexingInProgress = false;
      stopWatchdog();
      if (isIndexingPausedOnStartup()) {
        notifyProgressUpdate({
          isPaused: true,
          pauseReason: 'Indexation en pause au démarrage (Démarrer à volonté)'
        });
      }
      return getCurrentIndexProgress();
    }

    // 4. ÉCRITURE SUR DISQUE / STOCKAGE DES CHUNKS (repli recalcul ONNX)
    const tWriteStart = performance.now();
    await saveChunks(officialChunks);
    const tWriteElapsed = Math.round((performance.now() - tWriteStart) * 100) / 100;
    console.log(`[Diagnostic Indexation] ✓ Écriture disque (chunks) terminée en ${tWriteElapsed} ms`);

    // Inspection des embeddings existants
    const existingStored = await getAllChunks();
    const existingMap = new Map(existingStored.map(c => [c.chunkId, c]));

    let alreadyValidCount = 0;
    for (const chunk of officialChunks) {
      const stored = existingMap.get(chunk.chunkId);
      if (stored) {
        const isMatch = Boolean(
          (stored.paragraphSha1 && chunk.paragraphSha1 && stored.paragraphSha1 === chunk.paragraphSha1) ||
          (stored.contentHash && stored.contentHash === computeChunkHash(chunk.sermonId, chunk.paragraphIds, chunk.text)) ||
          (stored.contentHash && chunk.paragraphSha1 && stored.contentHash === chunk.paragraphSha1) ||
          (stored.paragraphSha1 && stored.paragraphSha1 === chunk.contentHash)
        );
        if (isMatch && stored.embedding && (validateEmbeddingVector(stored.embedding, 384).valid || validateEmbeddingVector(stored.embedding, 768).valid)) {
          alreadyValidCount++;
        }
      }
    }

    const initRatio = Math.min(1.0, alreadyValidCount / Math.max(1, officialChunks.length));
    const initSermonsProcessed = Math.min(totalSermonsCount, Math.floor(initRatio * totalSermonsCount));

    notifyProgressUpdate({
      embeddingsReused: alreadyValidCount,
      chunksProcessed: alreadyValidCount,
      totalChunks: officialChunks.length,
      sermonsProcessed: initSermonsProcessed,
      totalSermons: totalSermonsCount
    });

    if (alreadyValidCount === officialChunks.length && !options.forceReindex) {
      notifyProgressUpdate({
        status: 'READY',
        embeddingsCreated: 0,
        chunksProcessed: officialChunks.length,
        totalChunks: officialChunks.length,
        sermonsProcessed: totalSermonsCount,
        totalSermons: totalSermonsCount,
        etaFormatted: 'Terminé',
        lastIndexedAt: new Date().toISOString(),
        errorMessage: null
      });
      isIndexingInProgress = false;
      stopWatchdog();
      return getCurrentIndexProgress();
    }

    // 4. CALCUL DES EMBEDDINGS VECTORIELS
    notifyProgressUpdate({ status: 'EMBEDDING' });
    const tEmbedStart = performance.now();
    console.time('[Diagnostic Indexation] 4. Temps calcul embeddings E5');

    const indexResult = await runIncrementalEmbeddingIndexing(officialChunks, {
      batchSize: options.batchSize || 8,
      delayBetweenBatchesMs: 10,
      maxRetries: 3,
      onProgress: (res: EmbeddingIndexResult) => {
        const processed = res.alreadyIndexed + res.embeddingsCompleted;
        const ratio = Math.min(1.0, processed / Math.max(1, officialChunks.length));
        const procSermons = Math.min(totalSermonsCount, Math.floor(ratio * totalSermonsCount));

        notifyProgressUpdate({
          status: 'EMBEDDING',
          sermonsProcessed: procSermons,
          totalSermons: totalSermonsCount,
          chunksProcessed: processed,
          embeddingsCreated: res.embeddingsCompleted,
          embeddingsReused: res.alreadyIndexed,
          errors: res.embeddingsFailed,
          chunksPerSec: res.chunksPerSec,
          etaFormatted: res.etaFormatted,
          isPaused: res.isPaused,
          pauseReason: res.pauseReason
        });
      }
    });
    console.timeEnd('[Diagnostic Indexation] 4. Temps calcul embeddings E5');
    const tEmbedElapsed = Math.round((performance.now() - tEmbedStart) * 100) / 100;
    console.log(`[Diagnostic Indexation] ✓ Calcul embeddings E5 terminé : ${indexResult.embeddingsCompleted} créés (${tEmbedElapsed} ms)`);

    const finalStored = await getAllChunks();
    let finalValidCount = 0;
    for (const c of finalStored) {
      if (c.embedding && validateEmbeddingVector(c.embedding, 384).valid) {
        finalValidCount++;
      }
    }

    if (finalValidCount === officialChunks.length) {
      notifyProgressUpdate({
        status: 'READY',
        chunksProcessed: officialChunks.length,
        embeddingsCreated: indexResult.embeddingsCompleted,
        embeddingsReused: indexResult.alreadyIndexed,
        errors: indexResult.embeddingsFailed,
        etaFormatted: 'Terminé',
        lastIndexedAt: new Date().toISOString(),
        errorMessage: null
      });
    } else if (finalValidCount > 0) {
      notifyProgressUpdate({
        status: 'PARTIAL',
        chunksProcessed: finalValidCount,
        embeddingsCreated: indexResult.embeddingsCompleted,
        embeddingsReused: indexResult.alreadyIndexed,
        errors: indexResult.embeddingsFailed,
        etaFormatted: indexResult.etaFormatted,
        lastIndexedAt: new Date().toISOString(),
        errorMessage: `Indexation partielle : ${finalValidCount}/${officialChunks.length} chunks prêts.`
      });
    } else {
      notifyProgressUpdate({
        status: 'ERROR',
        errors: indexResult.embeddingsFailed,
        errorMessage: 'Échec d\'indexation vectorielle.'
      });
    }

  } catch (err: any) {
    notifyProgressUpdate({
      status: currentProgress.chunksProcessed > 0 ? 'PARTIAL' : 'ERROR',
      errorMessage: err?.message || String(err)
    });
  } finally {
    isIndexingInProgress = false;
    stopWatchdog();
  }

  return getCurrentIndexProgress();
}

export function getCurrentIndexProgress(): CorpusIndexProgress {
  const wDiag = getWorkerDiagnosticState();
  return {
    ...currentProgress,
    workerStatus: wDiag.workerStatus,
    workerErrorMessage: wDiag.workerErrorMessage,
    modelStatus: wDiag.modelStatus,
    modelErrorMessage: wDiag.modelErrorMessage,
    modelInfo: wDiag.modelInfo || currentProgress.modelInfo,
    lastActivityAt: wDiag.lastActivityAt || currentProgress.lastActivityAt || new Date().toISOString()
  };
}
