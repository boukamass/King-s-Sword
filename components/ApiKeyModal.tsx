import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useModalActive } from '../utils/modalUtils';
import { Key, Lightbulb, Check, ExternalLink, X, CheckCircle2, AlertCircle, Loader2, Wifi, WifiOff, Lock } from 'lucide-react';
import { cleanApiKey, AiProviderId, getActiveAiProvider, setActiveAiProvider, getProviderApiKey, setProviderApiKey } from '../utils/apiKeyHelper';
import { testGeminiApiKey } from '../services/geminiChatService';
import { AI_PROVIDERS, AI_PROVIDER_ORDER, testProviderApiKey } from '../services/aiProviderService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSaved }) => {
  useModalActive(isOpen);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [provider, setProvider] = useState<AiProviderId>('gemini');
  const [isSaved, setIsSaved] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; errorType?: string } | null>(null);

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
      const active = getActiveAiProvider();
      setProvider(active);
      const existing = getProviderApiKey(active) || '';
      setApiKeyInput(existing);
      setIsSaved(false);
      setTestResult(null);
      setIsTesting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const providerInfo = AI_PROVIDERS[provider];

  // Changement de fournisseur : affiche la clé déjà enregistrée pour celui-ci (rien n'est enregistré avant « Enregistrer »)
  const handleSelectProvider = (id: AiProviderId) => {
    if (id === provider) return;
    setProvider(id);
    setApiKeyInput(getProviderApiKey(id) || '');
    setTestResult(null);
    setIsSaved(false);
  };

  // Déclenché STRICTEMENT sur clic utilisateur : aucun appel automatique
  const handleTestConnection = async () => {
    const cleaned = cleanApiKey(apiKeyInput);
    if (!cleaned) {
      setTestResult({
        success: false,
        message: "Veuillez coller votre clé API avant de lancer le test.",
        errorType: "EMPTY"
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = provider === 'gemini'
        ? await testGeminiApiKey(cleaned)
        : await testProviderApiKey(provider, cleaned);
      setTestResult(result);
    } catch (e: any) {
      setTestResult({
        success: false,
        message: "Une erreur inattendue est survenue lors du test de connexion.",
        errorType: "UNKNOWN"
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const cleaned = cleanApiKey(apiKeyInput);
    await setProviderApiKey(provider, cleaned);
    await setActiveAiProvider(provider);
    setIsSaved(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleClear = async () => {
    setApiKeyInput('');
    await setProviderApiKey(provider, '');
    setTestResult(null);
    setIsSaved(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      onClose();
    }, 500);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[250000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-teal-600/10 text-teal-600 border border-teal-600/20 flex items-center justify-center shadow-inner">
              <Lightbulb className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-50">Configuration IA</h3>
            </div>
          </div>
          <button 
            onClick={onClose}
            data-tooltip="Fermer la fenêtre"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            Pour activer la recherche intelligente et l'analyse approfondie de vos sermons :
          </p>

          {/* Choix du fournisseur d'IA */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Choisissez votre service d'IA
            </label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Service d'IA">
              {AI_PROVIDER_ORDER.map(id => {
                const info = AI_PROVIDERS[id];
                const selected = id === provider;
                const configured = Boolean(getProviderApiKey(id));
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectProvider(id)}
                    className={`text-left px-3 py-2.5 rounded-2xl border transition-all cursor-pointer ${
                      selected
                        ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-500 ring-2 ring-teal-500/20'
                        : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-teal-300 dark:hover:border-teal-800'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-bold ${selected ? 'text-teal-800 dark:text-teal-200' : 'text-zinc-800 dark:text-zinc-200'}`}>
                        {info.label}
                      </span>
                      {configured && (
                        <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400 flex items-center gap-0.5 shrink-0">
                          <Check className="w-3 h-3" /> Clé
                        </span>
                      )}
                    </span>
                    <span className="block mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                      {info.tagline}
                    </span>
                  </button>
                );
              })}
            </div>
            {provider !== 'gemini' && (
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug">
                Les réponses de l'Assistant IA seront rédigées par {providerInfo.label}. Les fonctions annexes (définitions du dictionnaire, contexte Strong, analyse d'une sélection) utilisent toujours une clé Gemini si elle est enregistrée.
              </p>
            )}
          </div>

          <a
            href={providerInfo.keyUrl}
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 rounded-2xl text-teal-800 dark:text-teal-200 hover:bg-teal-100/70 transition-all group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Key className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span className="text-xs font-bold">1. Obtenir une clé d'accès gratuite ({providerInfo.label})</span>
            </div>
            <ExternalLink className="w-4 h-4 text-teal-600 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </a>

          {/* Guide multi-clés */}
          <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 rounded-2xl text-[11px] space-y-1.5 text-amber-900 dark:text-amber-200">
            <p className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
              <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>{provider === 'gemini' ? 'Astuce pour un accès continu :' : 'Comment obtenir la clé :'}</span>
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[10.5px] leading-relaxed opacity-90 pl-0.5">
              {providerInfo.keySteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                2. Collez votre clé d'accès
              </label>
              {apiKeyInput.trim() && (
                <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-2 py-0.5 rounded-md">
                  {apiKeyInput.split(/[\n,;]+/).filter(k => k.trim().length > 5).length} clé(s) détectée(s)
                </span>
              )}
            </div>
            <div className="relative">
              <textarea 
                rows={2}
                placeholder={providerInfo.keyPlaceholder}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setTestResult(null);
                }}
                className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all resize-none"
              />
            </div>
            <p className="text-[10px] text-zinc-400 leading-tight flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-slate-400 shrink-0 inline" />
              <span>Stockage 100% sécurisé et privé sur votre appareil. Vos données restent confidentielles.</span>
            </p>
          </div>

          {/* Bouton de test et Résultat du test */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !apiKeyInput.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 transition-all cursor-pointer"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600" />
                    <span>Vérification en cours...</span>
                  </>
                ) : (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-teal-600" />
                    <span>Tester la clé</span>
                  </>
                )}
              </button>
              <span className="text-[10px] text-zinc-400">
                (Vérifie la validité de votre clé)
              </span>
            </div>

            {testResult && (
              <div className={`p-3 rounded-2xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-200 ${
                testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              }`}>
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 text-[11px] leading-relaxed">
                  <p className="font-bold">{testResult.success ? "Test Réussi" : "Échec du test"}</p>
                  <p className="mt-0.5">{testResult.message}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between gap-3">
            <button 
              onClick={handleClear}
              className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-red-500 transition-colors cursor-pointer"
            >
              Effacer la clé
            </button>
            <div className="flex items-center gap-2">
              <button 
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
              >
                Fermer
              </button>
              <button 
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/20 active:scale-95 transition-all cursor-pointer"
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
    </div>,
    document.body
  );
};
