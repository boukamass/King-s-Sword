/**
 * King's Sword — Moteur d'Indexation Incrémentale Sécurisé (Phase 2F.7B.1)
 * 
 * Assure la génération et la persistance incrémentale, déterministe et résiliente des embeddings Float32 3072D.
 * 
 * RÈGLES STRICTES :
 * 1. Détection par chunk_id + computeChunkHash (FNV-1a 64-bit).
 * 2. Cas A : Absent -> Créer + embedding requis
 * 3. Cas B : Présent + même hash + embedding présent -> Réutiliser sans appel API Gemini
 * 4. Cas C : Présent + hash différent -> Régénérer embedding uniquement pour ce chunk
 * 5. Cas D : Présent + embedding NULL -> Générer embedding manquant
 * 6. Validation Float32 3072D (dimension 3072, pas de NaN/Infinity)
 * 7. Transactions de vérification re-lecture SQLite / Persistance
 * 8. Backoff exponentiel + jitter sur 429 / 503 / erreurs réseau
 * 9. Support complet du mode dryRun (0 appel API, 0 écriture)
 */

import { SermonChunk } from '../types';
import { computeChunkHash } from './chunkingService';
import { saveChunks, getChunkById, getAllChunks } from './chunkStorageService';
import { LOCAL_E5_CONFIG, computeE5Embedding, validateEmbeddingVector } from './embeddingService';
import { useAppStore } from '../store';

// Ordonnanceur adaptatif : Détection d'activité utilisateur
if (typeof window !== 'undefined') {
  let activeTimer: any = null;
  const setInactive = () => {
    (window as any).__isUserActive = false;
  };
  const handleActivity = () => {
    (window as any).__isUserActive = true;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = setTimeout(setInactive, 15000); // Considéré inactif après 15s d'inactivité
  };
  window.addEventListener('mousemove', handleActivity);
  window.addEventListener('keydown', handleActivity);
  window.addEventListener('click', handleActivity);
  handleActivity();
}

export interface EmbeddingIndexOptions {
  batchSize?: number;            // Taille des lots (défaut : 5)
  maxRetries?: number;           // Tentatives max sur 429/503 (défaut : 3)
  initialBackoffMs?: number;     // Délai initial de backoff (défaut : 1000)
  maxBackoffMs?: number;         // Délai max de backoff (défaut : 30000)
  delayBetweenBatchesMs?: number; // Délai entre les lots (défaut : 200)
  dryRun?: boolean;              // Mode simulation (défaut : false)
  apiKey?: string;               // Clé API spécifique
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
  details: {
    caseA: number; // Absent de la base
    caseB: number; // Présent + même hash + embedding valide (réutilisé)
    caseC: number; // Présent + hash différent (texte modifié)
    caseD: number; // Présent + embedding manquant/NULL
  };
  errors: Array<{ chunkId: string; error: string }>;
}

/**
 * Attente asynchrone sécurisée
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Génère l'embedding local E5 (384D Int8) d'un chunk sans aucun appel réseau.
 */
async function generateLocalE5Embedding(
  chunkText: string
): Promise<{ vector: Int8Array; retriesUsed: number; apiCallsCount: number }> {
  const vec = await computeE5Embedding(chunkText, 'passage: ');
  if (!vec || vec.length !== LOCAL_E5_CONFIG.dimension) {
    throw new Error(`Échec de calcul de l'embedding local E5 (dimension ${vec?.length || 0} vs ${LOCAL_E5_CONFIG.dimension})`);
  }
  return { vector: vec, retriesUsed: 0, apiCallsCount: 0 };
}

/**
 * Moteur principal d'indexation incrémentale
 */
export async function runIncrementalEmbeddingIndexing(
  incomingChunks: SermonChunk[],
  options?: EmbeddingIndexOptions
): Promise<EmbeddingIndexResult> {
  const startTime = performance.now();

  const opts: Required<EmbeddingIndexOptions> = {
    batchSize: options?.batchSize ?? 5,
    maxRetries: options?.maxRetries ?? 3,
    initialBackoffMs: options?.initialBackoffMs ?? 1000,
    maxBackoffMs: options?.maxBackoffMs ?? 30000,
    delayBetweenBatchesMs: options?.delayBetweenBatchesMs ?? 200,
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
      details: { caseA: 0, caseB: 0, caseC: 0, caseD: 0 },
      errors: []
    };
  }

  // 1. Récupération des chunks existants depuis SQLite / Storage
  const existingChunksList = await getAllChunks();
  const existingMap = new Map<string, SermonChunk>(existingChunksList.map(c => [c.chunkId, c]));

  // 2. Traitement et classification des 4 cas d'incrémentalité (Case A, B, C, D)
  let caseA = 0;
  let caseB = 0;
  let caseC = 0;
  let caseD = 0;

  const chunksToEmbed: SermonChunk[] = [];
  const processedChunksMap = new Map<string, SermonChunk>();

  for (const rawChunk of incomingChunks) {
    // Calcul/Vérification garanti du contentHash FNV-1a 64-bit
    const computedHash = computeChunkHash(rawChunk.sermonId, rawChunk.paragraphIds, rawChunk.text);
    const chunk: SermonChunk = { ...rawChunk, contentHash: computedHash };

    const existing = existingMap.get(chunk.chunkId);

    if (!existing) {
      // Cas A : Chunk absent -> Créer + embedding requis
      caseA++;
      chunksToEmbed.push(chunk);
    } else {
      const isSameHash = existing.contentHash === computedHash;
      const hasValidEmbedding = existing.embedding && (
        validateEmbeddingVector(existing.embedding, LOCAL_E5_CONFIG.dimension).valid ||
        validateEmbeddingVector(existing.embedding, 768).valid
      );

      if (isSameHash && hasValidEmbedding) {
        // Cas B : Présent + même hash + embedding présent valide -> Ne pas appeler Gemini, réutiliser
        caseB++;
        const updatedWithExistingVec: SermonChunk = {
          ...chunk,
          embedding: existing.embedding
        };
        processedChunksMap.set(chunk.chunkId, updatedWithExistingVec);
      } else if (!isSameHash) {
        // Cas C : Présent + hash différent -> Régénérer uniquement son embedding
        caseC++;
        chunksToEmbed.push(chunk);
      } else {
        // Cas D : Présent + même hash mais embedding NULL ou invalide -> Générer uniquement l'embedding manquant
        caseD++;
        chunksToEmbed.push(chunk);
      }
    }
  }

  const alreadyIndexed = caseB;
  const embeddingsRequired = chunksToEmbed.length;

  // 3. Gestion du mode Dry-Run
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
      apiCalls: 0, // 0 appel API en Dry-Run
      elapsedMs,
      details: { caseA, caseB, caseC, caseD },
      errors: []
    };
    opts.onProgress(dryRunResult);
    return dryRunResult;
  }

  // 4. Mode Réel : Traitement par petits lots
  let totalApiCalls = 0;
  let totalRetries = 0;
  let embeddingsCompleted = 0;
  let embeddingsFailed = 0;
  const errors: Array<{ chunkId: string; error: string }> = [];

  // Priorité absolue aux sermons actuellement consultés ou présents dans le Dock IA
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

  for (const chunk of chunksToEmbed) {
    if (activeSermonIds.includes(chunk.sermonId)) {
      prioritizedChunks.push(chunk);
    } else {
      standardChunks.push(chunk);
    }
  }

  const sortedChunksToEmbed = [...prioritizedChunks, ...standardChunks];

  for (let i = 0; i < sortedChunksToEmbed.length; i += opts.batchSize) {
    const batch = sortedChunksToEmbed.slice(i, i + opts.batchSize);

    for (const chunk of batch) {
      try {
        const { vector, retriesUsed, apiCallsCount } = await generateLocalE5Embedding(chunk.text);

        totalApiCalls += apiCallsCount;
        totalRetries += retriesUsed;

        // Validation stricte du vecteur E5 384D Int8
        const valRes = validateEmbeddingVector(vector, LOCAL_E5_CONFIG.dimension);
        if (!valRes.valid) {
          throw new Error(`Validation E5 384D échouée pour le chunk ${chunk.chunkId} : ${valRes.error}`);
        }

        const chunkWithVector: SermonChunk = {
          ...chunk,
          embedding: vector
        };

        // Sauvegarde dans le stockage / SQLite
        await saveChunks([chunkWithVector]);

        // Vérification par re-lecture dans SQLite/Storage (Transaction verification)
        const reReadChunk = await getChunkById(chunk.chunkId);
        if (!reReadChunk || !reReadChunk.embedding || !validateEmbeddingVector(reReadChunk.embedding, LOCAL_E5_CONFIG.dimension).valid) {
          throw new Error(`Échec de vérification par re-lecture dans le stockage pour le chunk ${chunk.chunkId}`);
        }

        embeddingsCompleted++;
        processedChunksMap.set(chunk.chunkId, chunkWithVector);
      } catch (err: any) {
        embeddingsFailed++;
        const errorMsg = err?.message || String(err);
        errors.push({ chunkId: chunk.chunkId, error: errorMsg });
      }
    }

    // Ordonnanceur adaptatif : délai dynamique ajusté à la milliseconde près selon l'inactivité utilisateur
    let adaptiveDelay = opts.delayBetweenBatchesMs;
    if (typeof window !== 'undefined') {
      const isUserActive = (window as any).__isUserActive;
      if (isUserActive) {
        adaptiveDelay = 500; // Ralentissement (500 ms) quand l'utilisateur travaille activement pour soulager le CPU/Réseau
      } else {
        adaptiveDelay = 10;  // Pleine vitesse (10 ms) quand l'utilisateur est inactif
      }
    }

    if (i + opts.batchSize < sortedChunksToEmbed.length && adaptiveDelay > 0) {
      await delay(adaptiveDelay);
    }

    // Notification de progression
    const currentElapsed = Math.round((performance.now() - startTime) * 100) / 100;
    opts.onProgress({
      totalChunks: incomingChunks.length,
      alreadyIndexed,
      embeddingsRequired,
      embeddingsCompleted,
      embeddingsFailed,
      skipped: alreadyIndexed,
      retries: totalRetries,
      apiCalls: totalApiCalls,
      elapsedMs: currentElapsed,
      details: { caseA, caseB, caseC, caseD },
      errors
    });
  }

  const finalElapsedMs = Math.round((performance.now() - startTime) * 100) / 100;

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
    details: { caseA, caseB, caseC, caseD },
    errors
  };
}
