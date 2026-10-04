import React, { useEffect, useState } from 'react';
import {
  CorpusIndexProgress,
  subscribeIndexProgress,
  loadPersistedProgressState,
  IndexingStatus
} from '../services/corpusIndexInitializationService';
import { Database, Sparkles, CheckCircle2, AlertTriangle, RefreshCw, X } from 'lucide-react';

export function getFrenchStatusMessage(status: IndexingStatus, errorMessage?: string | null): string {
  switch (status) {
    case 'SCANNING':
      return 'Analyse de votre bibliothèque...';
    case 'CHUNKING':
      return 'Préparation des sermons...';
    case 'EMBEDDING':
      return 'Optimisation de la recherche intelligente...';
    case 'PARTIAL':
      return 'La préparation a été interrompue. Elle reprendra automatiquement.';
    case 'READY':
      return 'Votre bibliothèque est prête.';
    case 'ERROR':
      if (errorMessage && (errorMessage.includes('429') || errorMessage.includes('503') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED'))) {
        return 'L\'optimisation de la recherche est temporairement suspendue. Elle reprendra automatiquement.';
      }
      return 'Impossible de terminer la préparation de votre bibliothèque. La reprise sera tentée automatiquement.';
    case 'NOT_STARTED':
    default:
      return 'Préparation de la bibliothèque non démarrée.';
  }
}

export const CorpusIndexingIndicator: React.FC<{
  className?: string;
  collapsible?: boolean;
}> = ({ className = '', collapsible = true }) => {
  const [progress, setProgress] = useState<CorpusIndexProgress | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    loadPersistedProgressState().then(initial => setProgress(initial));
    const unsubscribe = subscribeIndexProgress(updated => {
      setProgress(updated);
      if (updated.status === 'READY') {
        // Auto-dismiss 4 secondes après l'état READY
        const timer = setTimeout(() => {
          setIsDismissed(true);
        }, 4000);
        return () => clearTimeout(timer);
      } else {
        setIsDismissed(false);
      }
    });
    return () => unsubscribe();
  }, []);

  if (!progress || isDismissed) return null;

  // Ne pas afficher si tout est prêt et qu'aucun message d'erreur n'est actif
  if (progress.status === 'NOT_STARTED') return null;

  const totalChunks = progress.totalChunks || 1;
  const processedChunks = Math.min(progress.chunksProcessed || 0, totalChunks);
  const percent = Math.min(100, Math.max(0, Math.round((processedChunks / totalChunks) * 100)));

  const statusMessage = getFrenchStatusMessage(progress.status, progress.errorMessage);

  return (
    <div
      className={`bg-slate-900/90 dark:bg-amber-950/40 backdrop-blur-md border border-amber-500/30 rounded-lg p-3 text-slate-200 shadow-md text-xs transition-all duration-300 ${className}`}
      role="region"
      aria-label="Progression de préparation de la bibliothèque"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-amber-300 dark:text-amber-200">
          {progress.status === 'READY' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : progress.status === 'ERROR' || progress.status === 'PARTIAL' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          )}
          <span>{statusMessage}</span>
        </div>

        <div className="flex items-center gap-2">
          {progress.status !== 'READY' && (
            <span className="font-bold text-amber-400 font-mono bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/20">
              {percent}%
            </span>
          )}

          {collapsible && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
              title={isExpanded ? "Masquer les détails" : "Afficher les détails"}
            >
              <Database className="w-3.5 h-3.5" />
            </button>
          )}

          {progress.status === 'READY' && (
            <button
              onClick={() => setIsDismissed(true)}
              className="text-slate-400 hover:text-white p-1 rounded"
              title="Fermer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Barre de progression */}
      {progress.status !== 'READY' && (
        <div className="mt-2 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-amber-500 to-amber-300 h-full transition-all duration-300 rounded-full"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* Détails étendus */}
      {(isExpanded || progress.status === 'EMBEDDING' || progress.status === 'CHUNKING') && progress.status !== 'READY' && (
        <div className="mt-2.5 pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px] text-slate-300">
          <div>
            <span className="text-slate-400 block">Sermons :</span>
            <span className="font-semibold text-slate-100">{progress.sermonsProcessed} / {progress.totalSermons}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Chunks :</span>
            <span className="font-semibold text-slate-100">{progress.chunksProcessed} / {progress.totalChunks}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Embeddings :</span>
            <span className="font-semibold text-slate-100">{progress.embeddingsCreated + progress.embeddingsReused} / {progress.totalChunks}</span>
          </div>
        </div>
      )}

      {progress.status !== 'READY' && (
        <div className="mt-1 text-[10px] text-slate-400 italic">
          L'indexation se poursuit en arrière-plan. Vous pouvez continuer à utiliser l'application.
        </div>
      )}
    </div>
  );
};
