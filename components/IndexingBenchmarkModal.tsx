import React, { useEffect, useState } from 'react';
import { runThroughputBenchmark, setIndexKeywordsOnly, setIndexSelectionOnly } from '../services/embeddingIndexService';
import { Zap, Cpu, Check, FileText, Search } from 'lucide-react';

export const IndexingBenchmarkModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<{ chunksPerSec: number; isSlowMachine: boolean } | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;

    const done = localStorage.getItem('ks_benchmark_done_v1');
    if (!done) {
      runThroughputBenchmark().then((res) => {
        localStorage.setItem('ks_benchmark_done_v1', 'true');
        setBenchmarkResult(res);
        if (res.isSlowMachine) {
          setIsOpen(true);
        }
      }).catch((err) => {
        console.warn('[Benchmark] Erreur lors du test de débit:', err);
      });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Auto-validation recommandée si pas de réponse utilisateur
          handleChooseMode('fts5');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen || !benchmarkResult) return null;

  const handleChooseMode = (mode: 'fts5' | 'selection' | 'full') => {
    if (mode === 'fts5') {
      setIndexKeywordsOnly(true);
    } else if (mode === 'selection') {
      setIndexSelectionOnly(true);
    }
    setIsOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-amber-500/30 rounded-3xl p-6 shadow-2xl max-w-md w-full text-slate-100 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-amber-300">Capacité matérielle mesurée</h3>
            <p className="text-xs text-slate-400 font-mono">
              Débit mesuré : {benchmarkResult.chunksPerSec} chunks/sec
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Pour garantir que l'application reste 100% fluide et réactive sur votre ordinateur, choisissez votre mode d'indexation (validation auto dans {countdown}s) :
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={() => handleChooseMode('fts5')}
            className="flex items-start gap-3 p-3 rounded-2xl bg-teal-950/50 hover:bg-teal-900/60 border border-teal-500/40 text-left transition cursor-pointer group"
          >
            <Search className="w-4 h-4 text-teal-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
            <div>
              <div className="text-xs font-bold text-teal-200">Recherche mots-clés FTS5 seule (Recommandé)</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Recherche textuelle instantanée ultra-rapide. 0% de charge CPU.</p>
            </div>
          </button>

          <button
            onClick={() => handleChooseMode('selection')}
            className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700 text-left transition cursor-pointer group"
          >
            <FileText className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
            <div>
              <div className="text-xs font-bold text-slate-200">Indexer seulement ma sélection</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Vectorise uniquement les sermons que vous consultez ou placez dans le Dock IA.</p>
            </div>
          </button>

          <button
            onClick={() => handleChooseMode('full')}
            className="flex items-start gap-3 p-3 rounded-2xl bg-slate-800/30 hover:bg-slate-800/60 border border-slate-800 text-left transition cursor-pointer group"
          >
            <Zap className="w-4 h-4 text-slate-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
            <div>
              <div className="text-xs font-bold text-slate-300">Indexation vectorielle complète</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Se poursuit doucement en arrière-plan pendant votre inactivité.</p>
            </div>
          </button>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
          <span>Auto-validation ({countdown}s)</span>
          <button
            onClick={() => handleChooseMode('fts5')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-md transition cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Valider mon choix</span>
          </button>
        </div>
      </div>
    </div>
  );
};
