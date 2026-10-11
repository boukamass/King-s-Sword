/**
 * King's Sword — Corpus Index Initialization Service (Phase 2F.20)
 * 
 * Gestionnaire d'initialisation, de préparation et d'indexation automatique
 * du corpus complet de sermons au premier lancement chez l'utilisateur.
 */

import { Sermon, SermonChunk } from '../types';
import { createLibraryChunks, computeChunkHash } from './chunkingService';
import { saveChunks, getAllChunks } from './chunkStorageService';
import { runIncrementalEmbeddingIndexing, EmbeddingIndexResult } from './embeddingIndexService';
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
  persistProgressState(currentProgress).catch(() => {});
}

async function persistProgressState(prog: CorpusIndexProgress): Promise<void> {
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
      currentProgress.errorMessage = 'Session précédente interrompue. Prêt à relancer.';
    }
    isIndexingInProgress = false;
  } catch (e) {
    // Ignorer
  }
  return getCurrentIndexProgress();
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
          sermons = await res.json();
          if (sermons.length > 0) source = 'Fichier statique library.json';
        }
      } else {
        const fs = await import('fs');
        const path = await import('path');
        const cand = path.resolve('public/library.json');
        if (fs.existsSync(cand)) {
          sermons = JSON.parse(fs.readFileSync(cand, 'utf8'));
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
  apiKey?: string;
  batchSize?: number;
} = {}): Promise<CorpusIndexProgress> {
  if (isIndexingInProgress) {
    console.log('[CorpusIndexInit] Indexation déjà en cours. Ignoré.');
    return getCurrentIndexProgress();
  }

  isIndexingInProgress = true;
  startWatchdog();

  try {
    await loadPersistedProgressState();

    notifyProgressUpdate({
      status: 'SCANNING',
      errorMessage: null
    });

    const { sermons, corpusVersion, source } = await detectAvailableCorpus(options.loadedSermonsMap);
    
    if (sermons.length === 0) {
      notifyProgressUpdate({
        status: 'ERROR',
        sermonsProcessed: 0,
        totalSermons: 0,
        sermonSource: source,
        errorMessage: 'Aucun sermon détecté : vérifier la source des sermons.'
      });
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

    // CHUNKING (et indexation FTS5 texte immédiate)
    notifyProgressUpdate({ status: 'CHUNKING' });
    const sermonChunks = createLibraryChunks(librarySermonsOnly);
    const exposeChunks = await createExposeDocumentChunks();
    const officialChunks = [...sermonChunks, ...exposeChunks];
    
    notifyProgressUpdate({
      totalChunks: officialChunks.length,
      sermonsProcessed: 0
    });

    // Hydratation immédiate avec les embeddings précalculés
    try {
      await hydrateExposePrecalculatedEmbeddings(officialChunks);
    } catch (e) {
      console.warn('[CorpusIndexInit] Hydratation précalculée ignorée:', e);
    }

    // Sauvegarde immédiate dans FTS5 / Storage pour recherche lexicale textuelle instantanée
    await saveChunks(officialChunks);

    // Inspection des embeddings existants
    const existingStored = await getAllChunks();
    const existingMap = new Map(existingStored.map(c => [c.chunkId, c]));

    let alreadyValidCount = 0;
    for (const chunk of officialChunks) {
      const stored = existingMap.get(chunk.chunkId);
      if (stored && stored.contentHash === computeChunkHash(chunk.sermonId, chunk.paragraphIds, chunk.text)) {
        if (stored.embedding && (validateEmbeddingVector(stored.embedding, 384).valid || validateEmbeddingVector(stored.embedding, 768).valid)) {
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

    // EMBEDDING VECTORIEL EN ARRIÈRE-PLAN DÉPORTÉ WORKER
    notifyProgressUpdate({ status: 'EMBEDDING' });

    const indexResult = await runIncrementalEmbeddingIndexing(officialChunks, {
      batchSize: options.batchSize || 6,
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
