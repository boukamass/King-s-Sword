import React, { useEffect, useState } from 'react';
import {
  CorpusIndexProgress,
  subscribeIndexProgress,
  loadPersistedProgressState,
  forceResetIndexing,
  IndexingStatus
} from '../services/corpusIndexInitializationService';
import {
  pauseIndexing,
  resumeIndexing,
  setIndexSelectionOnly,
  setIndexKeywordsOnly,
  getIndexingControlsState
} from '../services/embeddingIndexService';
import {
  subscribeResourceLoadErrors,
  ResourceLoadError
} from '../utils/fetchHelper';
import { Database, CheckCircle2, AlertTriangle, RefreshCw, X, Pause, Play, Settings, Zap, Terminal, RotateCcw } from 'lucide-react';

export function getFrenchStatusMessage(status: IndexingStatus, errorMessage?: string | null, totalSermons?: number): string {
  if (totalSermons === 0 || errorMessage?.includes('Aucun sermon')) {
    return 'Aucun sermon détecté : vérifier la source des sermons';
  }
  switch (status) {
    case 'SCANNING':
      return 'Analyse de votre bibliothèque...';
    case 'CHUNKING':
      return 'Indexation FTS5 texte immédiate...';
    case 'EMBEDDING':
      return 'Indexation vectorielle en arrière-plan...';
    case 'PARTIAL':
      return 'Indexation partielle. Reprise automatique.';
    case 'READY':
      return 'Votre bibliothèque est 100% prête.';
    case 'ERROR':
      return errorMessage || 'Indexation interrompue. Relancez l\'indexation.';
    case 'NOT_STARTED':
    default:
      return 'Indexation non démarrée.';
  }
}

export const CorpusIndexingIndicator: React.FC<{
  className?: string;
  collapsible?: boolean;
}> = ({ className = '', collapsible = true }) => {
  const [progress, setProgress] = useState<CorpusIndexProgress | null>(null);
  const [resourceErrors, setResourceErrors] = useState<ResourceLoadError[]>([]);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const [controls, setControls] = useState(getIndexingControlsState());

  useEffect(() => {
    loadPersistedProgressState().then(initial => setProgress(initial));
    const unsubProgress = subscribeIndexProgress(updated => {
      setProgress(updated);
      setControls(getIndexingControlsState());
      if (updated.status === 'READY') {
        const timer = setTimeout(() => {
          setIsDismissed(true);
        }, 5000);
        return () => clearTimeout(timer);
      } else {
        setIsDismissed(false);
      }
    });

    const unsubResources = subscribeResourceLoadErrors(errs => {
      setResourceErrors(errs);
    });

    return () => {
      unsubProgress();
      unsubResources();
    };
  }, []);

  if (!progress) return null;
  if (progress.status === 'NOT_STARTED' && !progress.errorMessage && progress.totalSermons > 0 && isDismissed) return null;

  const totalChunks = progress.totalChunks || 1;
  const processedChunks = Math.min(progress.chunksProcessed || 0, totalChunks);
  const percent = Math.min(100, Math.max(0, Math.round((processedChunks / totalChunks) * 100)));

  const statusMessage = getFrenchStatusMessage(progress.status, progress.errorMessage, progress.totalSermons);
  const isNoSermonsError = progress.totalSermons === 0 || progress.errorMessage?.includes('Aucun sermon');

  const togglePause = () => {
    if (controls.isManualPaused) {
      resumeIndexing();
    } else {
      pauseIndexing();
    }
    setControls(getIndexingControlsState());
  };

  const toggleSelectionOnly = (val: boolean) => {
    setIndexSelectionOnly(val);
    setControls(getIndexingControlsState());
  };

  const toggleKeywordsOnly = (val: boolean) => {
    setIndexKeywordsOnly(val);
    setControls(getIndexingControlsState());
  };

  const handleRestartIndexing = async () => {
    setIsRestarting(true);
    try {
      await forceResetIndexing();
    } finally {
      setIsRestarting(false);
    }
  };

  return (
    <div
      className={`bg-slate-900/95 dark:bg-zinc-900/95 backdrop-blur-md border border-amber-500/30 rounded-2xl p-3.5 text-slate-200 shadow-xl text-xs transition-all duration-300 select-none ${className}`}
      role="region"
      aria-label="Progression de préparation de la bibliothèque"
    >
      {/* Alerte si aucun sermon détecté (Y = 0) */}
      {isNoSermonsError && (
        <div className="mb-2.5 p-2.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-[11px] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-bold">Aucun sermon détecté : vérifier la source des sermons</span>
          </div>
          <button
            onClick={handleRestartIndexing}
            disabled={isRestarting}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg shadow transition cursor-pointer flex items-center gap-1 shrink-0"
          >
            <RotateCcw className={`w-3 h-3 ${isRestarting ? 'animate-spin' : ''}`} />
            <span>Relancer</span>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-amber-300 dark:text-amber-200 truncate">
          {progress.status === 'READY' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : progress.status === 'ERROR' || progress.status === 'PARTIAL' || isNoSermonsError ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : controls.isPaused ? (
            <Pause className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          )}
          <span className="truncate font-semibold">{statusMessage}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {progress.status !== 'READY' && !isNoSermonsError && (
            <span className="font-bold text-amber-400 font-mono bg-amber-950/60 px-2 py-0.5 rounded-lg border border-amber-500/20 text-[11px]">
              {percent}%
            </span>
          )}

          {(progress.status === 'ERROR' || progress.status === 'PARTIAL') && (
            <button
              onClick={handleRestartIndexing}
              disabled={isRestarting}
              className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold rounded-lg transition cursor-pointer flex items-center gap-1 text-[11px]"
              title="Forcer la réinitialisation et relancer l'indexation"
            >
              <RotateCcw className={`w-3 h-3 ${isRestarting ? 'animate-spin' : ''}`} />
              <span>Relancer</span>
            </button>
          )}

          {progress.status === 'EMBEDDING' && (
            <button
              onClick={togglePause}
              className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
              title={controls.isManualPaused ? "Reprendre l'indexation" : "Mettre en pause l'indexation"}
            >
              {controls.isManualPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition cursor-pointer ${showSettings ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title="Options d'indexation"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {collapsible && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`p-1.5 rounded-lg transition cursor-pointer ${isExpanded ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title={isExpanded ? "Masquer les détails" : "Afficher les détails de diagnostic"}
            >
              <Database className="w-3.5 h-3.5" />
            </button>
          )}

          {progress.status === 'READY' && (
            <button
              onClick={() => setIsDismissed(true)}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
              title="Fermer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Barre de progression */}
      {progress.status !== 'READY' && !isNoSermonsError && (
        <div className="mt-2.5 w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${controls.isPaused ? 'bg-amber-500/50' : 'bg-gradient-to-r from-amber-500 to-teal-400'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* Panneau de configuration avancée */}
      {showSettings && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-col gap-2 text-[11px] bg-slate-950/60 p-2.5 rounded-xl">
          <div className="font-bold text-amber-300 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Mode d'indexation adaptatif :</span>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white transition">
            <input
              type="checkbox"
              checked={controls.isSelectionOnly}
              onChange={(e) => toggleSelectionOnly(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-teal-500 focus:ring-teal-500/20"
            />
            <span>Indexer seulement ma sélection (Dock IA & Sermon actif)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white transition">
            <input
              type="checkbox"
              checked={controls.isKeywordsOnly}
              onChange={(e) => toggleKeywordsOnly(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-teal-500 focus:ring-teal-500/20"
            />
            <span>Mots-clés seulement (Recherche lexicale FTS5 instantanée)</span>
          </label>
        </div>
      )}

      {/* PANNEAU DE DIAGNOSTIC DÉTAILLÉ */}
      {(isExpanded || isNoSermonsError) && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-col gap-2 bg-slate-950/80 p-3 rounded-xl text-[11px] text-slate-300 font-mono">
          <div className="font-bold text-teal-300 flex items-center justify-between not-mono font-sans border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-teal-400" />
              <span>Rapport de Diagnostic Moteur E5 & Indexation</span>
            </div>
            <button
              onClick={handleRestartIndexing}
              disabled={isRestarting}
              className="px-2 py-0.5 bg-amber-600/80 hover:bg-amber-600 text-white rounded flex items-center gap-1 text-[10px] cursor-pointer"
            >
              <RotateCcw className={`w-3 h-3 ${isRestarting ? 'animate-spin' : ''}`} />
              <span>Relancer L'Indexation</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="text-slate-400">Sermons trouvés :</span>{' '}
              <span className="font-bold text-amber-300">{progress.sermonsProcessed || 0} sur {progress.totalSermons || 0}</span>
            </div>
            <div>
              <span className="text-slate-400">Source de lecture :</span>{' '}
              <span className="font-bold text-teal-200">{progress.sermonSource || 'En cours...'}</span>
            </div>
            <div>
              <span className="text-slate-400">État Worker :</span>{' '}
              <span className={`font-bold ${progress.workerStatus === 'DÉMARRÉ' ? 'text-emerald-400' : progress.workerStatus === 'EN_ERREUR' ? 'text-rose-400' : 'text-amber-300'}`}>
                {progress.workerStatus || 'Non initialisé'}
              </span>
            </div>
            <div>
              <span className="text-slate-400">État Modèle E5 :</span>{' '}
              <span className={`font-bold ${progress.modelStatus === 'CHARGÉ' ? 'text-emerald-400' : progress.modelStatus === 'ERREUR' ? 'text-rose-400' : 'text-amber-300'}`}>
                {progress.modelStatus || 'Non chargé'}
              </span>
            </div>
          </div>

          {progress.modelInfo && (
            <div className="mt-1 p-2 bg-slate-900 rounded-lg border border-slate-800 text-[10px] space-y-1">
              <div className="truncate"><span className="text-slate-400">Chemin .onnx :</span> {progress.modelInfo.path || 'Non spécifié'}</div>
              <div><span className="text-slate-400">Taille :</span> {progress.modelInfo.sizeBytes ? `${(progress.modelInfo.sizeBytes / (1024 * 1024)).toFixed(1)} Mo` : 'Inconnue'}</div>
              <div className="truncate"><span className="text-slate-400">SHA-256 :</span> {progress.modelInfo.sha256 || 'Non calculé'}</div>
            </div>
          )}

          {(progress.lastError || progress.errorMessage || progress.modelErrorMessage) && (
            <div className="p-2 bg-rose-950/60 border border-rose-500/30 rounded-lg text-rose-300 text-[10px] space-y-0.5">
              <span className="font-bold block">Dernière erreur Moteur :</span>
              <p className="break-all">{progress.lastError || progress.errorMessage || progress.modelErrorMessage}</p>
            </div>
          )}

          {resourceErrors.length > 0 && (
            <div className="p-2 bg-rose-950/60 border border-rose-500/30 rounded-lg text-rose-300 text-[10px] space-y-1">
              <span className="font-bold block">Échecs de chargement de fichiers ({resourceErrors.length}) :</span>
              {resourceErrors.slice(-3).map((err, i) => (
                <div key={i} className="border-t border-rose-900/50 pt-1">
                  <span className="font-semibold">{err.primaryUrl}</span> : {err.reason} ({err.failedAt})
                  <div className="text-[9px] text-rose-400 truncate">Tentés : {err.attemptedUrls.join(', ')}</div>
                </div>
              ))}
            </div>
          )}

          <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-slate-900">
            <span>Dernière activité :</span>
            <span>{progress.lastActivityAt ? new Date(progress.lastActivityAt).toLocaleTimeString('fr-FR') : '--:--:--'}</span>
          </div>
        </div>
      )}

      {/* Métriques temps réel compactes */}
      {!isExpanded && !isNoSermonsError && (progress.status === 'EMBEDDING' || progress.status === 'CHUNKING') && (
        <div className="mt-2.5 pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-300">
          <div>
            <span className="text-slate-400 block">Sermons :</span>
            <span className="font-semibold text-slate-100">{progress.sermonsProcessed} / {progress.totalSermons}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Chunks :</span>
            <span className="font-semibold text-slate-100">{progress.chunksProcessed} / {progress.totalChunks}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Débit :</span>
            <span className="font-semibold text-teal-300 font-mono">
              {progress.chunksPerSec ? `${progress.chunksPerSec} chunks/s` : '--'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block">Temps restant :</span>
            <span className="font-semibold text-amber-300 font-mono">
              {progress.etaFormatted || 'Calcul...'}
            </span>
          </div>
        </div>
      )}

      {progress.status !== 'READY' && !isNoSermonsError && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 italic">
          <span>
            {controls.isBatterySaving
              ? "En pause automatique sur batterie (<20%)."
              : controls.isUserActive
                ? "Interaction utilisateur détectée : vitesse réduite."
                : "Pleine vitesse (Worker en arrière-plan)."}
          </span>
          <span className="font-semibold text-teal-400 not-italic">FTS5 Actif</span>
        </div>
      )}
    </div>
  );
};
