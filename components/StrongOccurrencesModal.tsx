import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalActive } from '../utils/modalUtils';
import { Search, X, BookOpen, Copy, Check } from 'lucide-react';

interface StrongOccurrence {
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
}

interface StrongOccurrencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  strongNumber: string;
  word: string;
  original?: string;
  occurrences: StrongOccurrence[];
}

export const StrongOccurrencesModal: React.FC<StrongOccurrencesModalProps> = ({
  isOpen,
  onClose,
  strongNumber,
  word,
  original,
  occurrences = []
}) => {
  useModalActive(isOpen);

  const [searchQuery, setSearchQuery] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const filteredOccurrences = useMemo(() => {
    if (!searchQuery.trim()) return occurrences;
    const q = searchQuery.toLowerCase().trim();
    return occurrences.filter(occ => 
      occ.bookName.toLowerCase().includes(q) ||
      `${occ.chapter}:${occ.verse}`.includes(q) ||
      occ.text.toLowerCase().includes(q)
    );
  }, [occurrences, searchQuery]);

  if (!isOpen) return null;

  const handleCopyVerse = (occ: StrongOccurrence, idx: number) => {
    const textToCopy = `${occ.bookName} ${occ.chapter}:${occ.verse} — « ${occ.text.trim()} »`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedIndex(idx);
    setTimeout(() => {
      setCopiedIndex(null);
    }, 1800);
  };

  // Met en valeur le mot dans le texte du verset
  const renderHighlightedVerse = (text: string) => {
    if (!word) return text;
    const parts = text.split(new RegExp(`(${word})`, 'gi'));
    return parts.map((part, i) => {
      if (part.toLowerCase() === word.toLowerCase()) {
        return (
          <span 
            key={i} 
            className="font-black text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/70 px-1 py-0.5 rounded-sm underline decoration-amber-500/80 decoration-2"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return createPortal(
    <div 
      className="fixed inset-0 z-[250000] bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-w-2xl w-full max-h-[88vh] animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-teal-700 text-white dark:bg-teal-600 dark:text-white flex items-center justify-center border border-teal-600/40 shadow-xs shrink-0 font-mono text-xs font-black">
              {strongNumber}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                <span>Occurrences Bibliques Complètes</span>
              </div>
              <h3 className="text-xl font-black text-zinc-900 dark:text-white leading-tight truncate">
                {word} {original ? <span className="font-semibold text-teal-700 dark:text-teal-300 font-mono text-sm">({original})</span> : null}
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                {occurrences.length} verset{occurrences.length > 1 ? 's' : ''} répertorié{occurrences.length > 1 ? 's' : ''} dans les Écritures
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            data-tooltip="Fermer cette fenêtre"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-all cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-5 sm:px-6 py-3 border-b border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input 
              type="text"
              placeholder="Filtrer par livre (ex: Genèse, Matthieu) ou mot..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-teal-500 text-zinc-900 dark:text-zinc-100 font-medium"
            />
          </div>
        </div>

        {/* Occurrences List Body */}
        <div className="flex-1 px-5 sm:px-6 py-4 overflow-y-auto custom-scrollbar space-y-2.5 bg-slate-50/50 dark:bg-zinc-950/40">
          {filteredOccurrences.length > 0 ? (
            filteredOccurrences.map((occ, idx) => (
              <div 
                key={`${occ.bookName}-${occ.chapter}-${occ.verse}-${idx}`}
                className="p-3.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 rounded-2xl shadow-2xs hover:border-teal-500/40 transition-all group"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-black text-teal-800 dark:text-teal-300 font-mono tracking-tight flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                    {occ.bookName} {occ.chapter}:{occ.verse}
                  </span>
                  <button 
                    onClick={() => handleCopyVerse(occ, idx)}
                    data-tooltip="Copier ce verset"
                    className="p-1 rounded-lg text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer opacity-80 group-hover:opacity-100 flex items-center gap-1 text-[10px] font-bold"
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">Copié</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span className="hidden sm:inline">Copier</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs sm:text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200 italic serif-text">
                  « {renderHighlightedVerse(occ.text.trim())} »
                </p>
              </div>
            ))
          ) : (
            <div className="text-center py-12 space-y-2 text-zinc-400">
              <Search className="w-6 h-6 mx-auto opacity-40" />
              <p className="text-xs font-semibold">Aucun verset trouvé pour cette recherche.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-950/50 flex items-center justify-between shrink-0 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5 font-medium">
            <BookOpen className="w-3.5 h-3.5 text-teal-600" />
            <span>Affichage de {filteredOccurrences.length} sur {occurrences.length} verset{occurrences.length > 1 ? 's' : ''}</span>
          </span>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
