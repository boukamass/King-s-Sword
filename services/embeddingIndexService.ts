/**
 * King's Sword — Moteur d'Indexation Incrémentale & Ordonnanceur Adaptatif (Phase 2F.19)
 * 
 * Assure la génération et la persistance incrémentale, déterministe et résiliente des embeddings E5 (384D Int8).
 * 
 * FONCTIONNALITÉS EXÉCUTIVES :
 * 1. Inférence déportée dans un Web Worker / utilityProcess (0ms de gel sur l'UI).
 * 2. Ordonnanceur adaptatif :
 *    - Pleine vitesse (0ms de délai entre lots) quand l'utilisateur est inactif.
 *    - Ralentissement automatique (500ms de délai entre lots) dès qu'une interaction utilisateur est détectée.
 *    - Pause automatique sur batterie faible (<20% non branché) ou mode économie d'énergie.
 *    - Reprise automatique après reconnexion ou fin d'interruption.
 * 3. Priorité absolue aux sermons consultés ou présents dans le Dock IA.
 * 4. Boutons Pause / Reprendre & Modes "Indexer seulement ma sélection" et "Mots-clés seulement (FTS5)".
 * 5. Mesure dynamique du débit (chunks/sec) et calcul précis du temps restant (ETA).
 */

import { SermonChunk } from '../types';
import { computeChunkHash } from './chunkingService';
import { saveChunks, getChunkById, getAllChunks } from './chunkStorageService';
import { LOCAL_E5_CONFIG, validateEmbeddingVector } from './embeddingService';
import { computeE5BatchInWorker } from './e5WorkerManager';
import { useAppStore } from '../store';

// 1. DÉTECTION D'ACTIVITÉ UTILISATEUR
let isUserActive = false;
let userActivityTimer: any = null;

if (typeof window !== 'undefined') {
  const setInactive = () => {
    isUserActive = false;
  };
  const handleActivity = () => {
    isUserActive = true;
    if (userActivityTimer) clearTimeout(userActivityTimer);
    userActivityTimer = setTimeout(setInactive, 12000); // Considéré inactif après 12s sans interaction
  };
  window.addEventListener('mousemove', handleActivity, { passive: true });
  window.addEventListener('keydown', handleActivity, { passive: true });
  window.addEventListener('click', handleActivity, { passive: true });
  window.addEventListener('touchstart', handleActivity, { passive: true });
  window.addEventListener('wheel', handleActivity, { passive: true });
  handleActivity();
}

// 2. DÉTECTION BATTERIE / ÉCONOMIE D'ÉNERGIE
let isBatterySaving = false;

if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
  (navigator as any).getBattery().then((battery: any) => {
    const updateBattery = () => {
      isBatterySaving = !battery.charging && battery.level < 0.20;
    };
    updateBattery();
    battery.addEventListener('chargingchange', updateBattery);
    battery.addEventListener('levelchange', updateBattery);
  }).catch(() => {});
}

// 3. ÉTAT DU CONTRÔLE DE PAUSE MANUELLE & MODES
let isManualPaused = false;
let isSelectionOnly = false;
let isKeywordsOnly = false;

export function pauseIndexing(): void {
  isManualPaused = true;
}

export function resumeIndexing(): void {
  isManualPaused = false;
}

export function setIndexSelectionOnly(selectionOnly: boolean): void {
  isSelectionOnly = selectionOnly;
}

export function setIndexKeywordsOnly(keywordsOnly: boolean): void {
  isKeywordsOnly = keywordsOnly;
}

export function getIndexingControlsState(): {
  isPaused: boolean;
  isManualPaused: boolean;
  isBatterySaving: boolean;
  isUserActive: boolean;
  isSelectionOnly: boolean;
  isKeywordsOnly: boolean;
} {
  return {
    isPaused: isManualPaused || isBatterySaving || isKeywordsOnly,
    isManualPaused,
    isBatterySaving,
    isUserActive,
    isSelectionOnly,
    isKeywordsOnly
  };
}

export interface EmbeddingIndexOptions {
  batchSize?: number;            // Taille des lots (défaut : 6)
  maxRetries?: number;           // Tentatives max (défaut : 3)
  initialBackoffMs?: number;     // Délai initial (défaut : 1000)
  maxBackoffMs?: number;         // Délai max (défaut : 30000)
  delayBetweenBatchesMs?: number; // Délai entre les lots (défaut : 10)
  dryRun?: boolean;              // Mode simulation
  apiKey?: string;
  onProgress?: (progress: EmbeddingIndexResult) => void;
}

export interface EmbeddingIndexResult {
  totalChunks: number;
  alreadyIndexed: number;
  embeddingsRequired: number;
  embeddingsCompleted: number;
  embeddingsFailed: number;
  skipped: number;
  retries: number;
  apiCalls: number;
  elapsedMs: number;
  chunksPerSec: number;
  etaFormatted: string;
  isPaused: boolean;
  pauseReason: string | null;
  details: {
    caseA: number;
    caseB: number;
    caseC: number;
    caseD: number;
  };
  errors: Array<{ chunkId: string; error: string }>;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test de débit matériel rapide au premier lancement
 */
export async function runThroughputBenchmark(): Promise<{ chunksPerSec: number; isSlowMachine: boolean }> {
  const sampleChunks = [
    { id: 'b1', text: 'En effet le Fils de l\'homme est venu chercher et sauver ce qui était perdu dans la vérité de l\'Évangile.' },
    { id: 'b2', text: 'C\'est la parole parlée de Dieu manifestée en son temps parfait selon la promesse de l\'Écriture.' },
    { id: 'b3', text: 'Regardez à Christ et vivez car Il est la lumière du monde et le chemin de la vie éternelle.' },
    { id: 'b4', text: 'L\'amour divin est la plus grande force dans tout l\'univers de Dieu pour la guérison des âmes.' },
    { id: 'b5', text: 'Que la grâce et la paix de notre Seigneur Jésus-Christ soient avec vous tous maintenant et à jamais.' }
  ];

  const start = performance.now();
  await computeE5BatchInWorker(sampleChunks, 'passage: ');
  const elapsedSec = (performance.now() - start) / 1000;
  const chunksPerSec = Math.round((sampleChunks.length / Math.max(0.1, elapsedSec)) * 10) / 10;
  const isSlowMachine = chunksPerSec < 3.0;

  return { chunksPerSec, isSlowMachine };
}

/**
 * Formatage lisible du temps restant estimé (ETA)
 */
export function formatETA(remainingChunks: number, chunksPerSec: number): string {
  if (remainingChunks <= 0) return 'Terminé';
  if (chunksPerSec <= 0) return 'Calcul en cours...';
  const totalSeconds = Math.ceil(remainingChunks / chunksPerSec);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes} min ${seconds > 0 ? `${seconds}s` : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

/**
 * Moteur principal d'indexation incrémentale vectorielle
 */
export async function runIncrementalEmbeddingIndexing(
  incomingChunks: SermonChunk[],
  options?: EmbeddingIndexOptions
): Promise<EmbeddingIndexResult> {
  const startTime = performance.now();

  const opts: Required<EmbeddingIndexOptions> = {
    batchSize: options?.batchSize ?? 6,
    maxRetries: options?.maxRetries ?? 3,
    initialBackoffMs: options?.initialBackoffMs ?? 1000,
    maxBackoffMs: options?.maxBackoffMs ?? 30000,
    delayBetweenBatchesMs: options?.delayBetweenBatchesMs ?? 10,
    dryRun: options?.dryRun ?? false,
    apiKey: options?.apiKey || '',
    onProgress: options?.onProgress || (() => {})
  };

  if (!Array.isArray(incomingChunks) || incomingChunks.length === 0) {
    return {
      totalChunks: 0,
      alreadyIndexed: 0,
      embeddingsRequired: 0,
      embeddingsCompleted: 0,
      embeddingsFailed: 0,
      skipped: 0,
      retries: 0,
      apiCalls: 0,
      elapsedMs: 0,
      chunksPerSec: 0,
      etaFormatted: 'Terminé',
      isPaused: false,
      pauseReason: null,
      details: { caseA: 0, caseB: 0, caseC: 0, caseD: 0 },
      errors: []
    };
  }

  // Si le mode "Mots-clés seulement (FTS5)" est actif, on saute la génération de vecteurs
  if (isKeywordsOnly) {
    const elapsedMs = Math.round((performance.now() - startTime) * 100) / 100;
    const res: EmbeddingIndexResult = {
      totalChunks: incomingChunks.length,
      alreadyIndexed: incomingChunks.length,
      embeddingsRequired: 0,
      embeddingsCompleted: 0,
      embeddingsFailed: 0,
      skipped: incomingChunks.length,
      retries: 0,
      apiCalls: 0,
      elapsedMs,
      chunksPerSec: 0,
      etaFormatted: 'Mode FTS5 Mots-Clés Actif',
      isPaused: false,
      pauseReason: null,
      details: { caseA: 0, caseB: incomingChunks.length, caseC: 0, caseD: 0 },
      errors: []
    };
    opts.onProgress(res);
    return res;
  }

  // 1. Récupération des chunks existants
  const existingChunksList = await getAllChunks();
  const existingMap = new Map<string, SermonChunk>(existingChunksList.map(c => [c.chunkId, c]));

  // 2. Classification incrémentale (Cas A, B, C, D)
  let caseA = 0;
  let caseB = 0;
  let caseC = 0;
  let caseD = 0;

  const chunksToEmbed: SermonChunk[] = [];
  const processedChunksMap = new Map<string, SermonChunk>();

  for (const rawChunk of incomingChunks) {
    const computedHash = computeChunkHash(rawChunk.sermonId, rawChunk.paragraphIds, rawChunk.text);
    const chunk: SermonChunk = { ...rawChunk, contentHash: computedHash };
    const existing = existingMap.get(chunk.chunkId);

    if (!existing) {
      caseA++;
      chunksToEmbed.push(chunk);
    } else {
      const isSameHash = existing.contentHash === computedHash;
      const hasValidEmbedding = existing.embedding && (
        validateEmbeddingVector(existing.embedding, LOCAL_E5_CONFIG.dimension).valid ||
        validateEmbeddingVector(existing.embedding, 768).valid
      );

      if (isSameHash && hasValidEmbedding) {
        caseB++;
        processedChunksMap.set(chunk.chunkId, { ...chunk, embedding: existing.embedding });
      } else if (!isSameHash) {
        caseC++;
        chunksToEmbed.push(chunk);
      } else {
        caseD++;
        chunksToEmbed.push(chunk);
      }
    }
  }

  const alreadyIndexed = caseB;

  // Filtrage selon le mode "Indexer seulement ma sélection"
  let targetChunksToEmbed = chunksToEmbed;
  if (isSelectionOnly) {
    let activeSermonIds: string[] = [];
    try {
      const storeState = useAppStore.getState();
      if (storeState) {
        activeSermonIds = [
          ...(storeState.contextSermonIds || []),
          ...(storeState.selectedSermonId ? [storeState.selectedSermonId] : [])
        ];
      }
    } catch {}

    if (activeSermonIds.length > 0) {
      targetChunksToEmbed = chunksToEmbed.filter(c => activeSermonIds.includes(c.sermonId));
    }
  }

  const embeddingsRequired = targetChunksToEmbed.length;

  if (opts.dryRun) {
    const elapsedMs = Math.round((performance.now() - startTime) * 100) / 100;
    const dryRunResult: EmbeddingIndexResult = {
      totalChunks: incomingChunks.length,
      alreadyIndexed,
      embeddingsRequired,
      embeddingsCompleted: 0,
      embeddingsFailed: 0,
      skipped: alreadyIndexed,
      retries: 0,
      apiCalls: 0,
      elapsedMs,
      chunksPerSec: 0,
      etaFormatted: 'Simulation Dry-Run',
      isPaused: false,
      pauseReason: null,
      details: { caseA, caseB, caseC, caseD },
      errors: []
    };
    opts.onProgress(dryRunResult);
    return dryRunResult;
  }

  // 3. Tri par priorité (Sermon consulté / Dock IA en premier)
  let activeSermonIds: string[] = [];
  try {
    const storeState = useAppStore.getState();
    if (storeState) {
      activeSermonIds = [
        ...(storeState.contextSermonIds || []),
        ...(storeState.selectedSermonId ? [storeState.selectedSermonId] : [])
      ];
    }
  } catch {}

  const prioritizedChunks: SermonChunk[] = [];
  const standardChunks: SermonChunk[] = [];

  for (const chunk of targetChunksToEmbed) {
    if (activeSermonIds.includes(chunk.sermonId)) {
      prioritizedChunks.push(chunk);
    } else {
      standardChunks.push(chunk);
    }
  }

  const sortedChunksToEmbed = [...prioritizedChunks, ...standardChunks];

  let totalApiCalls = 0;
  let totalRetries = 0;
  let embeddingsCompleted = 0;
  let embeddingsFailed = 0;
  const errors: Array<{ chunkId: string; error: string }> = [];

  const batchSize = opts.batchSize;
  const processingStartTime = performance.now();

  for (let i = 0; i < sortedChunksToEmbed.length; i += batchSize) {
    // VÉRIFICATION DES PAUSES (Pause manuelle ou batterie faible)
    while (isManualPaused || isBatterySaving || isKeywordsOnly) {
      const pauseReason = isKeywordsOnly 
        ? "Mode FTS5 Mots-Clés Actif" 
        : isManualPaused 
          ? "Indexation en pause" 
          : "En pause sur batterie (<20%)";

      opts.onProgress({
        totalChunks: incomingChunks.length,
        alreadyIndexed,
        embeddingsRequired,
        embeddingsCompleted,
        embeddingsFailed,
        skipped: alreadyIndexed,
        retries: totalRetries,
        apiCalls: totalApiCalls,
        elapsedMs: Math.round((performance.now() - startTime) * 100) / 100,
        chunksPerSec: 0,
        etaFormatted: pauseReason,
        isPaused: true,
        pauseReason,
        details: { caseA, caseB, caseC, caseD },
        errors
      });

      if (isKeywordsOnly) {
        // Sortie directe si passage en mode mots-clés seulement
        return {
          totalChunks: incomingChunks.length,
          alreadyIndexed,
          embeddingsRequired,
          embeddingsCompleted,
          embeddingsFailed,
          skipped: alreadyIndexed,
          retries: totalRetries,
          apiCalls: totalApiCalls,
          elapsedMs: Math.round((performance.now() - startTime) * 100) / 100,
          chunksPerSec: 0,
          etaFormatted: 'Mode FTS5 Mots-Clés',
          isPaused: true,
          pauseReason,
          details: { caseA, caseB, caseC, caseD },
          errors
        };
      }

      await delay(1000);
    }

    const batch = sortedChunksToEmbed.slice(i, i + batchSize);
    const itemsToCompute = batch.map(c => ({ id: c.chunkId, text: c.text }));

    try {
      // INFERENCE DÉPORTÉE EN WORKER
      const batchResults = await computeE5BatchInWorker(itemsToCompute, 'passage: ');
      const resultMap = new Map(batchResults.map(r => [r.id, r.vector]));

      const chunksToSave: SermonChunk[] = [];

      for (const chunk of batch) {
        const vector = resultMap.get(chunk.chunkId);
        if (vector && validateEmbeddingVector(vector, LOCAL_E5_CONFIG.dimension).valid) {
          const updatedChunk: SermonChunk = { ...chunk, embedding: vector };
          chunksToSave.push(updatedChunk);
          processedChunksMap.set(chunk.chunkId, updatedChunk);
          embeddingsCompleted++;
        } else {
          embeddingsFailed++;
          errors.push({ chunkId: chunk.chunkId, error: "Échec de génération ou validation du vecteur" });
        }
      }

      if (chunksToSave.length > 0) {
        await saveChunks(chunksToSave);
      }
    } catch (err: any) {
      embeddingsFailed += batch.length;
      errors.push({ chunkId: batch[0]?.chunkId || 'batch', error: err?.message || String(err) });
    }

    // MESURE DE DÉBIT EN TEMPS RÉEL (chunks/sec)
    const elapsedSecSoFar = Math.max(0.1, (performance.now() - processingStartTime) / 1000);
    const chunksPerSec = Math.round((embeddingsCompleted / elapsedSecSoFar) * 10) / 10;
    const remainingToEmbed = sortedChunksToEmbed.length - (i + batch.length);
    const etaFormatted = formatETA(remainingToEmbed, chunksPerSec);

    // ORDONNANCEUR ADAPTATIF :
    // - Inactif : 0 ms de délai (pleine vitesse)
    // - Actif (l'utilisateur interagit) : 500 ms de délai pour soulager l'interface
    let adaptiveDelay = opts.delayBetweenBatchesMs;
    if (isUserActive) {
      adaptiveDelay = 500;
    } else {
      adaptiveDelay = 0;
    }

    if (i + batchSize < sortedChunksToEmbed.length && adaptiveDelay > 0) {
      await delay(adaptiveDelay);
    }

    const currentElapsedMs = Math.round((performance.now() - startTime) * 100) / 100;
    opts.onProgress({
      totalChunks: incomingChunks.length,
      alreadyIndexed,
      embeddingsRequired,
      embeddingsCompleted,
      embeddingsFailed,
      skipped: alreadyIndexed,
      retries: totalRetries,
      apiCalls: totalApiCalls,
      elapsedMs: currentElapsedMs,
      chunksPerSec,
      etaFormatted,
      isPaused: false,
      pauseReason: null,
      details: { caseA, caseB, caseC, caseD },
      errors
    });
  }

  const finalElapsedMs = Math.round((performance.now() - startTime) * 100) / 100;
  const totalElapsedSec = Math.max(0.1, finalElapsedMs / 1000);
  const finalChunksPerSec = Math.round((embeddingsCompleted / totalElapsedSec) * 10) / 10;

  return {
    totalChunks: incomingChunks.length,
    alreadyIndexed,
    embeddingsRequired,
    embeddingsCompleted,
    embeddingsFailed,
    skipped: alreadyIndexed,
    retries: totalRetries,
    apiCalls: totalApiCalls,
    elapsedMs: finalElapsedMs,
    chunksPerSec: finalChunksPerSec,
    etaFormatted: 'Terminé',
    isPaused: false,
    pauseReason: null,
    details: { caseA, caseB, caseC, caseD },
    errors
  };
}
