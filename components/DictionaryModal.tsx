import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModalActive } from '../utils/modalUtils';
import { useAppStore } from '../store';
import { X, BookA, Search, Copy, Check, Loader2, SearchX } from 'lucide-react';
import {
  ensureOfflineDictionaryLoaded,
  searchOfflineDictionarySuggestions,
  getOfflineDefinition,
  WordDefinition
} from '../services/dictionaryService';

/**
 * Fenêtre « Dictionnaire Webster (français) » : recherche d'un mot et de sa définition,
 * entièrement hors ligne (dictionnaire local public/dictionary-fr.json, jamais d'IA ni d'internet).
 */
export const DictionaryModal: React.FC = () => {
  const isOpen = useAppStore(s => s.isDictionaryModalOpen);
  const setIsOpen = useAppStore(s => s.setIsDictionaryModalOpen);
  const addNotification = useAppStore(s => s.addNotification);
  useModalActive(isOpen);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ key: string; word: string }>>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [result, setResult] = useState<WordDefinition | null>(null);
  const [notFoundWord, setNotFoundWord] = useState<string | null>(null);
  const [isDictReady, setIsDictReady] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const onClose = useCallback(() => setIsOpen(false), [setIsOpen]);

  // Chargement du dictionnaire local à l'ouverture + focus sur le champ
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    ensureOfflineDictionaryLoaded()
      .then(d => { if (!cancelled) setIsDictReady(!!d); })
      .catch(() => { if (!cancelled) setIsDictReady(false); });
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isOpen]);

  // Échap pour fermer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Suggestions au fil de la frappe
  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }
    const t = setTimeout(() => {
      searchOfflineDictionarySuggestions(q, 40)
        .then(list => { setSuggestions(list); setActiveIndex(-1); })
        .catch(() => setSuggestions([]));
    }, 120);
    return () => clearTimeout(t);
  }, [query, isOpen]);

  const lookup = useCallback(async (word: string) => {
    const w = word.trim();
    if (!w) return;
    const reqId = ++requestIdRef.current;
    setIsSearching(true);
    setCopied(false);
    try {
      const def = await getOfflineDefinition(w);
      if (reqId !== requestIdRef.current) return;
      setResult(def);
      setNotFoundWord(def ? null : w);
    } catch {
      if (reqId !== requestIdRef.current) return;
      setResult(null);
      setNotFoundWord(w);
    } finally {
      if (reqId === requestIdRef.current) setIsSearching(false);
    }
  }, []);

  const handleKeyDownInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = activeIndex >= 0 ? suggestions[activeIndex] : null;
      lookup(chosen ? chosen.word : query);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const parts = [`${result.word} : ${result.definition}`];
    if (result.etymology) parts.push(`Étymologie : ${result.etymology}`);
    if (result.synonyms && result.synonyms.length > 0) parts.push(`Synonymes : ${result.synonyms.join(', ')}`);
    try {
      navigator.clipboard.writeText(parts.join('\n'));
      setCopied(true);
      addNotification('Définition copiée dans le presse-papiers.', 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      addNotification('Impossible de copier automatiquement', 'error');
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250000] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200 text-zinc-800 dark:text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-500/20 flex items-center justify-center shrink-0 shadow-xs">
              <BookA className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
                Dictionnaire Webster
              </h2>
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                Version française — consultation hors ligne
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            data-tooltip="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Champ de recherche */}
        <div className="px-5 sm:px-6 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2 px-3 h-11 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus-within:border-teal-500/60 focus-within:ring-2 focus-within:ring-teal-500/15 transition-all">
            <Search className="w-4 h-4 text-zinc-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDownInput}
              placeholder="Rechercher un mot (ex. grâce, foi, rédemption)…"
              className="flex-1 bg-transparent outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResult(null); setNotFoundWord(null); inputRef.current?.focus(); }}
                className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
                data-tooltip="Effacer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => lookup(query)}
              disabled={!query.trim()}
              className="h-8 px-3 flex items-center justify-center bg-teal-600 text-white text-xs font-bold rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-all active:scale-95 cursor-pointer"
            >
              Définir
            </button>
          </div>
          {!isDictReady && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold">
              <Loader2 className="w-3 h-3 animate-spin text-teal-600" />
              <span className="text-zinc-500 dark:text-zinc-400">Chargement du dictionnaire…</span>
            </div>
          )}
        </div>

        {/* Corps : suggestions + définition */}
        <div className="flex-1 min-h-0 px-5 sm:px-6 pb-5 grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3">
          {/* Suggestions */}
          <div className="min-h-0 max-h-40 sm:max-h-[55vh] overflow-y-auto custom-scrollbar border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl bg-zinc-50/40 dark:bg-zinc-950/40">
            {suggestions.length > 0 ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {suggestions.map((s, idx) => {
                  const isActive = idx === activeIndex || (result && result.word.toLowerCase() === s.word.toLowerCase());
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => { setActiveIndex(idx); lookup(s.word); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-teal-600 text-white'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-teal-500/10 hover:text-teal-700 dark:hover:text-teal-300'
                        }`}
                      >
                        {s.word}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4 text-center text-[11px] italic text-zinc-400">
                {query.trim() ? 'Aucun mot ne commence par ces lettres.' : 'Tapez un mot pour voir les suggestions.'}
              </div>
            )}
          </div>

          {/* Définition */}
          <div className="min-h-0 sm:max-h-[55vh] overflow-y-auto custom-scrollbar">
            {isSearching ? (
              <div className="h-full min-h-[120px] flex items-center justify-center gap-2 text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
                <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                <span className="text-xs font-medium">Recherche dans le dictionnaire…</span>
              </div>
            ) : result ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white leading-snug break-words">
                      {result.word}
                    </h3>
                    {result.grammarNote && (
                      <p className="text-[11px] font-medium text-teal-700 dark:text-teal-300 mt-0.5">{result.grammarNote}</p>
                    )}
                  </div>
                  <button
                    onClick={handleCopy}
                    className="w-8 h-8 shrink-0 flex items-center justify-center text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 rounded-xl transition-colors cursor-pointer"
                    data-tooltip="Copier la définition"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <div className="p-4 sm:p-5 bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 rounded-2xl relative overflow-hidden shadow-2xs">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-600 dark:bg-teal-500" />
                  <p className="text-sm sm:text-base leading-relaxed text-zinc-800 dark:text-zinc-100 pl-2 serif-text select-text">
                    {result.definition}
                  </p>
                </div>

                {result.etymology && (
                  <div className="flex flex-col text-xs">
                    <span className="font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">Étymologie</span>
                    <span className="text-zinc-700 dark:text-zinc-300 mt-0.5 leading-relaxed select-text">{result.etymology}</span>
                  </div>
                )}

                {result.synonyms && result.synonyms.length > 0 && (
                  <div className="flex flex-col text-xs">
                    <span className="font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">Synonymes</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {result.synonyms.map(syn => (
                        <button
                          key={syn}
                          type="button"
                          onClick={() => { setQuery(syn); lookup(syn); }}
                          className="px-2 py-0.5 rounded-lg bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20 hover:bg-teal-500/20 transition-colors cursor-pointer"
                        >
                          {syn}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-zinc-400 pt-1">{result.source}</p>
              </div>
            ) : notFoundWord ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-center p-4 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
                <SearchX className="w-6 h-6 text-zinc-400" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Le mot <span className="font-semibold text-zinc-700 dark:text-zinc-200">{notFoundWord}</span> n'a pas été trouvé dans le dictionnaire hors ligne.
                </p>
                <p className="text-[11px] text-zinc-400">Vérifiez l'orthographe ou choisissez un mot dans les suggestions.</p>
              </div>
            ) : (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-center p-4 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
                <BookA className="w-6 h-6 text-teal-500/60" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Recherchez un mot pour afficher sa définition.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
