/**
 * King's Sword — Corpus Index Initialization Service (Phase 2F.14)
 * 
 * Gestionnaire d'initialisation, de préparation et d'indexation automatique
 * du corpus complet de sermons au premier lancement chez l'utilisateur.
 * 
 * FONCTIONNALITÉS CLÉS :
 * 1. Détection automatique du corpus disponible (Web & Electron).
 * 2. Découpage en chunks via le pipeline officiel (`createLibraryChunks`).
 * 3. Contrôle d'incrémentalité & déduplication (`computeChunkHash`).
 * 4. Reprise automatique après interruption (fermeture app, perte réseau, 429/503).
 * 5. Verrou anti-concurrence (mutuellement exclusif, 0 indexation en double).
 * 6. Suivi temps réel des états : NOT_STARTED | SCANNING | CHUNKING | EMBEDDING | READY | PARTIAL | ERROR.
 * 7. Non-blocage de l'assistant : Mode PARTIAL opérant uniquement sur les chunks indexés.
 */

import { Sermon, SermonChunk } from '../types';
import { createLibraryChunks, computeChunkHash, parseSermonParagraphs } from './chunkingService';
import { saveChunks, getAllChunks, saveChunk } from './chunkStorageService';
import { runIncrementalEmbeddingIndexing, EmbeddingIndexResult } from './embeddingIndexService';
import { validateEmbeddingVector } from './embeddingService';
import { loadExposeAsSermons, hydrateExposePrecalculatedEmbeddings, createExposeDocumentChunks } from './exposeDocumentService';
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
  corpusVersion: string;
  lastIndexedAt: string | null;
  errorMessage: string | null;
}

const INDEX_STATUS_STORAGE_KEY = 'ks_corpus_index_status_v1';

let isIndexingInProgress = false;
let currentProgress: CorpusIndexProgress = {
  status: 'NOT_STARTED',
  sermonsProcessed: 0,
  totalSermons: 0,
  chunksProcessed: 0,
  totalChunks: 0,
  embeddingsCreated: 0,
  embeddingsReused: 0,
  errors: 0,
  corpusVersion: 'v1.0.0-default',
  lastIndexedAt: null,
  errorMessage: null
};

// Listeners pour l'état d'avancement
type ProgressListener = (progress: CorpusIndexProgress) => void;
const progressListeners: Set<ProgressListener> = new Set();

export function subscribeIndexProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  listener(currentProgress);
  return () => progressListeners.delete(listener);
}

function notifyProgressUpdate(update: Partial<CorpusIndexProgress>): void {
  currentProgress = { ...currentProgress, ...update };
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
    // Ignorer en environnement dégradé
  }
}

export async function loadPersistedProgressState(): Promise<CorpusIndexProgress> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(INDEX_STATUS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        currentProgress = { ...currentProgress, ...parsed };
        return currentProgress;
      }
    }
    if (typeof indexedDB !== 'undefined') {
      const stored = await get<CorpusIndexProgress>(INDEX_STATUS_STORAGE_KEY);
      if (stored) {
        currentProgress = { ...currentProgress, ...stored };
      }
    }
  } catch (e) {
    // Ignorer
  }
  return currentProgress;
}

/**
 * Détecte les sermons disponibles dans l'environnement courant
 */
export async function detectAvailableCorpus(
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>
): Promise<{ sermons: Sermon[]; corpusVersion: string }> {
  let sermons: Sermon[] = [];

  // 1. Map mémoire déjà chargée (React Store)
  if (loadedSermonsMap && loadedSermonsMap.size > 0) {
    sermons = Array.from(loadedSermonsMap.values()).filter((s): s is Sermon => !!s && typeof (s as any).text === 'string' && (s as any).text.length > 0);
  }

  // 2. Repli Electron / IPC
  if (sermons.length === 0 && typeof window !== 'undefined' && window.electronAPI?.db?.getSermonsMetadata) {
    try {
      const meta = await window.electronAPI.db.getSermonsMetadata();
      if (Array.isArray(meta) && meta.length > 0) {
        // En Electron, on charge les sermons par lots ou à la demande
        const fullSermons: Sermon[] = [];
        for (const m of meta) {
          const full = await window.electronAPI.db.getSermonFull(m.id);
          if (full) fullSermons.push(full);
        }
        if (fullSermons.length > 0) {
          sermons = fullSermons;
        }
      }
    } catch (e) {
      console.warn('[CorpusIndexInit] Erreur détection Electron db:', e);
    }
  }

  // 3. Repli Web / Node.js static library.json
  if (sermons.length === 0) {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch('/library.json');
        if (res.ok) {
          sermons = await res.json();
        }
      } else {
        const fs = await import('fs');
        const path = await import('path');
        const cand = path.resolve('public/library.json');
        if (fs.existsSync(cand)) {
          sermons = JSON.parse(fs.readFileSync(cand, 'utf8'));
        }
      }
    } catch (e) {
      console.warn('[CorpusIndexInit] Erreur détection library.json:', e);
    }
  }

  // 4. Intégration systématique du corpus complet de l'Exposé des Sept Âges (11 chapitres)
  try {
    const exposeSermons = await loadExposeAsSermons();
    if (exposeSermons && exposeSermons.length > 0) {
      const existingIds = new Set(sermons.map(s => s.id));
      for (const es of exposeSermons) {
        if (!existingIds.has(es.id)) {
          sermons.push(es);
        }
      }
    }
  } catch (e) {
    console.warn('[CorpusIndexInit] Erreur chargement Exposé:', e);
  }

  // Calcul du hash de version du corpus
  const sermonIds = sermons.map(s => s.id).sort().join(',');
  const corpusVersion = `v1-${sermons.length}-${sermonIds.substring(0, 32)}`;

  return { sermons, corpusVersion };
}

/**
 * Lance l'initialisation de l'index au premier lancement ou à la reprise.
 * REPRÈSENTE LA SÉCURITÉ CONCURRENTIELLE STRICTE : 0 indexation simultanée.
 */
export async function initializeCorpusIndex(options: {
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  forceReindex?: boolean;
  apiKey?: string;
  batchSize?: number;
} = {}): Promise<CorpusIndexProgress> {
  // 1. Verrou de sécurité contre les indexations concurrentes
  if (isIndexingInProgress) {
    console.log('[CorpusIndexInit] Indexation déjà en cours. Ignoré.');
    return currentProgress;
  }

  isIndexingInProgress = true;

  try {
    // Restaurer l'état précédent
    await loadPersistedProgressState();

    notifyProgressUpdate({
      status: 'SCANNING',
      errorMessage: null
    });

    // A. Détection du corpus disponible
    const { sermons, corpusVersion } = await detectAvailableCorpus(options.loadedSermonsMap);
    
    if (sermons.length === 0) {
      notifyProgressUpdate({
        status: 'ERROR',
        errorMessage: 'Aucun sermon trouvé dans la source.'
      });
      isIndexingInProgress = false;
      return currentProgress;
    }

    notifyProgressUpdate({
      totalSermons: sermons.length,
      corpusVersion
    });

    // B. Découpage en Chunks (CHUNKING)
    notifyProgressUpdate({ status: 'CHUNKING' });
    const librarySermonsOnly = sermons.filter(s => !s.id.startsWith('expose-ch-'));
    const sermonChunks = createLibraryChunks(librarySermonsOnly);
    const exposeChunks = await createExposeDocumentChunks();
    const officialChunks = [...sermonChunks, ...exposeChunks];
    
    notifyProgressUpdate({
      totalChunks: officialChunks.length,
      sermonsProcessed: sermons.length
    });

    // Hydratation immédiate avec les embeddings précalculés livrés dans l'application (Exposé + Sermons)
    try {
      await hydrateExposePrecalculatedEmbeddings(officialChunks);
    } catch (e) {
      console.warn('[CorpusIndexInit] Hydratation précalculée ignorée:', e);
    }

    // Sauvegarde initiale dans la base locale (Storage)
    await saveChunks(officialChunks);

    // C. Inspection de l'état des embeddings existants
    const existingStored = await getAllChunks();
    const existingMap = new Map(existingStored.map(c => [c.chunkId, c]));

    let alreadyValidCount = 0;
    for (const chunk of officialChunks) {
      const stored = existingMap.get(chunk.chunkId);
      if (stored && stored.contentHash === computeChunkHash(chunk.sermonId, chunk.paragraphIds, chunk.text)) {
        if (stored.embedding && (validateEmbeddingVector(stored.embedding, 768).valid || validateEmbeddingVector(stored.embedding, 3072).valid || validateEmbeddingVector(stored.embedding, 384).valid)) {
          alreadyValidCount++;
        }
      }
    }

    notifyProgressUpdate({
      embeddingsReused: alreadyValidCount,
      chunksProcessed: alreadyValidCount,
      totalChunks: officialChunks.length,
      sermonsProcessed: sermons.length,
      totalSermons: sermons.length
    });

    // Si tout est déjà indexé et valide -> État READY direct !
    if (alreadyValidCount === officialChunks.length && !options.forceReindex) {
      notifyProgressUpdate({
        status: 'READY',
        embeddingsCreated: 0,
        chunksProcessed: officialChunks.length,
        totalChunks: officialChunks.length,
        sermonsProcessed: sermons.length,
        totalSermons: sermons.length,
        lastIndexedAt: new Date().toISOString(),
        errorMessage: null
      });
      isIndexingInProgress = false;
      return currentProgress;
    }

    // D. Génération Vectorielle Incrémentale Locale E5 (EMBEDDING)
    notifyProgressUpdate({ status: 'EMBEDDING' });

    const indexResult = await runIncrementalEmbeddingIndexing(officialChunks, {
      batchSize: options.batchSize || 10,
      delayBetweenBatchesMs: 50,
      maxRetries: 3,
      onProgress: (res: EmbeddingIndexResult) => {
        notifyProgressUpdate({
          status: 'EMBEDDING',
          chunksProcessed: res.alreadyIndexed + res.embeddingsCompleted,
          embeddingsCreated: res.embeddingsCompleted,
          embeddingsReused: res.alreadyIndexed,
          errors: res.embeddingsFailed
        });
      }
    });

    // E. Diagnostic final et transition d'état
    const finalStored = await getAllChunks();
    let finalValidCount = 0;
    for (const c of finalStored) {
      if (c.embedding && (validateEmbeddingVector(c.embedding, 384).valid || validateEmbeddingVector(c.embedding, 768).valid)) {
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
  }

  return currentProgress;
}

/**
 * Renvoie la progression actuelle
 */
export function getCurrentIndexProgress(): CorpusIndexProgress {
  return currentProgress;
}
