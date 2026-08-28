import React, { useState, useEffect } from 'react';
import { Key, Sparkles, Check, ExternalLink, X, ShieldAlert, Cpu } from 'lucide-react';
import { getGeminiApiKey, setGeminiApiKey } from '../utils/apiKeyHelper';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      const existing = getGeminiApiKey() || '';
      setApiKeyInput(existing);
      setIsSaved(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    setGeminiApiKey(apiKeyInput);
    setIsSaved(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      onClose();
    }, 800);
  };

  const handleClear = () => {
    setApiKeyInput('');
    setGeminiApiKey('');
    setIsSaved(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-teal-600/10 text-teal-600 border border-teal-600/20 flex items-center justify-center shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-50">Configuration IA</h3>
              <p className="text-[11px] text-zinc-500 font-medium">Clé Personnelle Google Gemini</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            data-tooltip="Fermer la fenêtre"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Status Network Badge */}
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 text-xs">
            <span className="text-zinc-600 dark:text-zinc-400 font-medium">État de la connexion :</span>
            {isOnline ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                En Ligne (Online)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Hors-Ligne (Offline)
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            Pour utiliser les fonctionnalités IA approfondies avec votre propre compte Google gratuit :
          </p>

          <a 
            href="https://aistudio.google.com/app/apikey" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 rounded-2xl text-teal-800 dark:text-teal-200 hover:bg-teal-100/70 transition-all group"
          >
            <div className="flex items-center gap-2.5">
              <Key className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span className="text-xs font-bold">1. Obtenir ma clé gratuite Google AI Studio</span>
            </div>
            <ExternalLink className="w-4 h-4 text-teal-600 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </a>

          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              2. Collez votre clé API ici
            </label>
            <input 
              type="password"
              placeholder="AIzaSy..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
            />
            <p className="text-[10px] text-zinc-400">
              🔒 Votre clé reste strictement enregistrée sur votre machine et n'est jamais transmise à des tiers.
            </p>
          </div>

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between gap-3">
            <button 
              onClick={handleClear}
              className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-red-500 transition-colors"
            >
              Effacer
            </button>
            <div className="flex items-center gap-2">
              <button 
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
              >
                Annuler
              </button>
              <button 
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/20 active:scale-95 transition-all"
              >
                {isSaved ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Enregistré !
                  </>
                ) : (
                  'Enregistrer'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
