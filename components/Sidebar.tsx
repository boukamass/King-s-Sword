import React, { useState, useRef, useEffect, useMemo, memo, useDeferredValue, useTransition, useCallback } from 'react';
import { useAppStore, SearchResult } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { normalizeText } from '../utils/textUtils';
import NoteSelectorModal from './NoteSelectorModal';
import { BIBLE_BOOKS_META, BibleBookMeta } from '../services/bibleMetadata';
import { BibleVersion, BIBLE_VERSIONS_META } from '../types/bible';
import { 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  X, 
  ArrowRight, 
  Headphones, 
  Sparkles, 
  MapPin, 
  Loader2, 
  RefreshCw, 
  Calendar, 
  Clock, 
  Hash, 
  NotebookPen, 
  Layers, 
  Type, 
  BookOpen,
  Library,
  BookMarked
} from 'lucide-react';

const ITEM_HEIGHT = 80; 
const SEARCH_ITEM_HEIGHT = 125; 

interface DropdownProps {
  value: string | null;
  onChange: (val: string | null) => void;
  options: string[];
  placeholder: string;
  className?: string;
  displayValue?: (val: string) => string;
}

const ModernDropdown: React.FC<DropdownProps> = ({ value, onChange, options, placeholder, className = "", displayValue }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all duration-300 ${
          value 
            ? 'bg-teal-600/10 dark:bg-teal-500/10 border-teal-600/40 text-teal-700 dark:text-teal-400 shadow-sm' 
            : 'bg-white dark:bg-zinc-800/80 border-slate-200 dark:border-zinc-700 text-slate-500 hover:border-teal-500/50'
        }`}
      >
        <span className="truncate pr-1">{value ? (displayValue ? displayValue(value) : value) : placeholder}</span>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <span 
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="hover:text-red-500 transition-colors p-0.5 rounded-full"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isOpen ? 'rotate-180 text-teal-600' : 'text-slate-400'}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1.5 left-0 w-48 max-h-60 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-slate-200 dark:border-zinc-700/80 rounded-xl shadow-2xl z-[1000] overflow-hidden flex flex-col p-1.5 animate-in fade-in zoom-in-95 duration-200">
          <div className="overflow-y-auto custom-scrollbar flex-1 space-y-0.5">
            <button
              onClick={() => { onChange(null); setIsOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Tous
            </button>
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setIsOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all rounded-lg border ${
                  value === opt 
                    ? 'text-teal-700 dark:text-teal-400 bg-teal-600/15 dark:bg-teal-600/25 border-teal-600/30' 
                    : 'text-zinc-800 dark:text-zinc-200 hover:bg-teal-600/[0.08] dark:hover:bg-teal-400/[0.06] border-transparent hover:border-teal-600/10 dark:hover:border-teal-400/10'
                }`}
              >
                {displayValue ? displayValue(opt) : opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SermonItem = memo(({ 
  sermon, 
  isSelected, 
  isContextSelected, 
  onSelect, 
  onToggleContext 
}: { 
  sermon: any; 
  isSelected: boolean; 
  isContextSelected: boolean; 
  onSelect: (multi: boolean) => void; 
  onToggleContext: (multi: boolean) => void;
}) => {
  return (
    <div 
      style={{ height: ITEM_HEIGHT }} 
      className="px-3 flex items-center relative border-b border-slate-200/60 dark:border-slate-800/40 last:border-0"
    >
      <div 
        className={`group w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-300 cursor-pointer h-[72px] ${
          isSelected 
            ? 'bg-teal-600/15 dark:bg-teal-600/25 ring-1 ring-teal-600/30 shadow-md' 
            : 'hover:bg-teal-600/[0.08] dark:hover:bg-teal-400/[0.06] border border-transparent hover:border-teal-600/10 dark:hover:border-teal-400/10'
        }`}
        onClick={(e) => onSelect(e.ctrlKey || e.metaKey)}
      >
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onToggleContext(e.ctrlKey || e.metaKey);
          }}
          data-tooltip={isContextSelected ? "Retirer du contexte IA" : "Ajouter au contexte IA"}
          className={`w-4 h-4 rounded-md border transition-all flex items-center justify-center shrink-0 tooltip-right ${
            isContextSelected
              ? 'bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-600/20' 
              : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 group-hover:border-teal-600/50'
          }`}
        >
          {isContextSelected && <Sparkles className="w-2.5 h-2.5 stroke-[3]" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className={`text-[12px] font-extrabold truncate transition-colors ${isSelected ? 'text-teal-700 dark:text-blue-400' : 'text-zinc-900 dark:text-zinc-100 group-hover:text-teal-700 dark:group-hover:text-teal-400'}`}>
              {sermon.title || "Sermon sans titre"}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {sermon.audio_url && <Headphones className="w-2.5 h-2.5 text-teal-500 tooltip-right" data-tooltip="Audio disponible" />}
              {sermon.version && (
                <span className="text-[7px] font-black bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 uppercase tracking-tighter">
                  {sermon.version}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[8px] text-zinc-400 font-bold uppercase tracking-widest group-hover:text-zinc-500 transition-colors">
            <Calendar className="w-2 h-2 text-teal-600/50 group-hover:text-teal-600/70" />
            <span className="font-mono">{sermon.date}</span>
            {sermon.time && (
              <React.Fragment>
                <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" />
                <Clock className="w-2 h-2 text-teal-600/50 group-hover:text-teal-600/70" />
                <span>{sermon.time}</span>
              </React.Fragment>
            )}
            <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" />
            <MapPin className="w-2 h-2 text-teal-600/50 group-hover:text-teal-600/70" />
            <span className="truncate">{sermon.city}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

const BibleBookItem = memo(({
  book,
  isExpanded,
  onToggleExpand,
  selectedBookId,
  selectedChapter,
  onSelectChapter,
  isBookInDock,
  onToggleBookInDock
}: {
  book: BibleBookMeta;
  isExpanded: boolean;
  onToggleExpand: () => void;
  selectedBookId: string | null;
  selectedChapter: number | null;
  onSelectChapter: (ch: number) => void;
  isBookInDock: boolean;
  onToggleBookInDock: () => void;
}) => {
  const isThisBookActive = selectedBookId === book.id;

  return (
    <div className="px-3 py-1 border-b border-slate-200/60 dark:border-slate-800/40 last:border-0">
      <div 
        onClick={onToggleExpand}
        className={`group w-full flex items-center justify-between p-2.5 rounded-xl transition-all duration-200 cursor-pointer ${
          isExpanded || isThisBookActive
            ? 'bg-teal-600/10 dark:bg-teal-600/20 ring-1 ring-teal-600/30 shadow-xs' 
            : 'hover:bg-teal-600/[0.08] dark:hover:bg-teal-400/[0.06] border border-transparent hover:border-teal-600/10'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookInDock();
            }}
            data-tooltip={isBookInDock ? "Retirer du dock IA" : "Ajouter le livre au dock IA"}
            className={`w-4 h-4 rounded-md border transition-all flex items-center justify-center shrink-0 tooltip-right ${
              isBookInDock
                ? 'bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-600/20' 
                : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 group-hover:border-teal-600/50'
            }`}
          >
            {isBookInDock && <Sparkles className="w-2.5 h-2.5 stroke-[3]" />}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[12px] font-extrabold truncate transition-colors ${
                isThisBookActive ? 'text-teal-700 dark:text-teal-400' : 'text-zinc-900 dark:text-zinc-100 group-hover:text-teal-700 dark:group-hover:text-teal-400'
              }`}>
                {book.name}
              </span>
              <span className={`text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tight ${
                book.testament === 'OT' 
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800' 
                  : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
              }`}>
                {book.testament === 'OT' ? 'AT' : 'NT'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[8px] font-bold text-zinc-400 uppercase tracking-widest mt-0.5">
              <span>{book.category}</span>
              <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
              <span className="text-teal-600 dark:text-teal-400 font-mono">{book.chaptersCount} chap.</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div className="w-6 h-6 flex items-center justify-center text-zinc-400 group-hover:text-teal-600 transition-transform">
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-teal-600" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="pt-2 pb-2.5 px-1 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[7.5px] font-black text-zinc-400 uppercase tracking-widest">
              Chapitres (1 à {book.chaptersCount}) :
            </span>
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 max-h-48 overflow-y-auto custom-scrollbar p-0.5">
            {Array.from({ length: book.chaptersCount }, (_, i) => i + 1).map((ch) => {
              const isSelected = isThisBookActive && selectedChapter === ch;
              return (
                <button
                  key={ch}
                  onClick={() => onSelectChapter(ch)}
                  className={`h-6.5 rounded-lg text-[9.5px] font-black flex items-center justify-center transition-all active:scale-90 ${
                    isSelected
                      ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30 ring-2 ring-teal-500/40'
                      : 'bg-white dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/60 hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-400 shadow-2xs'
                  }`}
                  title={`${book.name} ${ch}`}
                >
                  {ch}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

const SearchResultItem = memo(({ 
  result, 
  isSelected, 
  onSelect,
  onAddToNotes
}: { 
  result: SearchResult; 
  isSelected: boolean; 
  onSelect: () => void;
  onAddToNotes: (e: React.MouseEvent) => void;
}) => {
  return (
    <div 
      style={{ height: SEARCH_ITEM_HEIGHT }} 
      className="px-3 flex items-center relative border-b border-slate-200/60 dark:border-slate-800/40 last:border-0"
    >
      <div 
        className={`group w-full flex flex-col gap-2 p-3 rounded-xl transition-all duration-300 cursor-pointer h-[115px] overflow-hidden ${
          isSelected 
            ? 'bg-teal-600/15 dark:bg-teal-600/25 ring-1 ring-teal-600/30 shadow-md' 
            : 'hover:bg-teal-600/[0.08] dark:hover:bg-teal-400/[0.06] border border-transparent hover:border-teal-600/10 dark:hover:border-teal-400/10'
        }`}
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
             <span className="text-[10px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-tight truncate block mb-1">
                {result.title}
             </span>
             <div className="flex items-center gap-1.5 overflow-hidden">
                {result.audio_url && <Headphones className="w-2.5 h-2.5 text-teal-500 shrink-0" />}
                <span className="text-[7px] font-mono text-zinc-400 font-bold shrink-0">{result.date}</span>
                <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[7px] font-black text-zinc-500 shrink-0">
                   <Hash className="w-2 h-2 text-teal-500/50" />
                   <span>{result.paragraphIndex}</span>
                </div>
             </div>
          </div>
          <button 
            onClick={onAddToNotes}
            className="w-7 h-7 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-lg border border-teal-600/10 hover:bg-teal-600 hover:text-white transition-all active:scale-90 shrink-0"
            data-tooltip="Ajouter à une note"
          >
            <NotebookPen className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <p 
            className="text-[11.5px] leading-[1.45] text-zinc-600 dark:text-zinc-300 serif-text italic line-clamp-4 border-l-2 border-teal-600/20 pl-2.5 py-0.5" 
            dangerouslySetInnerHTML={{ __html: result.snippet || '' }} 
          />
        </div>
      </div>
    </div>
  );
});

const SearchModeButton = memo(({ mode, label, tooltip, currentMode, setMode }: { 
  mode: SearchMode; 
  label: string; 
  tooltip: string;
  currentMode: SearchMode;
  setMode: (mode: SearchMode) => void;
}) => (
  <button
    onClick={() => setMode(mode)}
    data-tooltip={tooltip}
    className={`flex-1 text-center px-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all duration-300 tooltip-bottom border ${
      currentMode === mode
        ? 'bg-teal-600 text-white border-teal-600 shadow-lg shadow-teal-600/20'
        : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-teal-500/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
    }`}
  >
    {label}
  </button>
));

const Sidebar: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sermons = useAppStore(s => s.sermons);
  const searchResults = useAppStore(s => s.searchResults);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
  const manualContextIds = useAppStore(s => s.manualContextIds);
  const toggleContextSermon = useAppStore(s => s.toggleContextSermon);
  const setManualContextIds = useAppStore(s => s.setManualContextIds);
  const setJumpToParagraph = useAppStore(s => s.setJumpToParagraph);
  
  const libraryMode = useAppStore(s => s.libraryMode);
  const setLibraryMode = useAppStore(s => s.setLibraryMode);
  const bibleTestamentFilter = useAppStore(s => s.bibleTestamentFilter);
  const setBibleTestamentFilter = useAppStore(s => s.setBibleTestamentFilter);
  const bibleVersion = useAppStore(s => s.bibleVersion);
  const setBibleVersion = useAppStore(s => s.setBibleVersion);
  const selectedBibleBookId = useAppStore(s => s.selectedBibleBookId);
  const selectedBibleChapter = useAppStore(s => s.selectedBibleChapter);
  
  const searchQuery = useAppStore(s => s.searchQuery);
  const searchMode = useAppStore(s => s.searchMode);
  const setSearchMode = useAppStore(s => s.setSearchMode);
  const isFullTextSearch = useAppStore(s => s.isFullTextSearch);
  const setIsFullTextSearch = useAppStore(s => s.setIsFullTextSearch);
  const isSearching = useAppStore(s => s.isSearching);
  const triggerSearch = useAppStore(s => s.triggerSearch);
  const setSearchQueryStore = useAppStore(s => s.setSearchQuery);
  
  const includeSynonyms = useAppStore(s => s.includeSynonyms);
  const setIncludeSynonyms = useAppStore(s => s.setIncludeSynonyms);
  const showOnlySynonyms = useAppStore(s => s.showOnlySynonyms);
  const setShowOnlySynonyms = useAppStore(s => s.setShowOnlySynonyms);
  const showOnlyQuery = useAppStore(s => s.showOnlyQuery);
  const setShowOnlyQuery = useAppStore(s => s.setShowOnlyQuery);
  const activeSynonyms = useAppStore(s => s.activeSynonyms);
  const selectedSynonym = useAppStore(s => s.selectedSynonym);
  const setSelectedSynonym = useAppStore(s => s.setSelectedSynonym);

  const cityFilter = useAppStore(s => s.cityFilter);
  const setCityFilter = useAppStore(s => s.setCityFilter);
  const yearFilter = useAppStore(s => s.yearFilter);
  const setYearFilter = useAppStore(s => s.setYearFilter);
  const monthFilter = useAppStore(s => s.monthFilter);
  const setMonthFilter = useAppStore(s => s.setMonthFilter);
  const dayFilter = useAppStore(s => s.dayFilter);
  const setDayFilter = useAppStore(s => s.setDayFilter);
  const languageFilter = useAppStore(s => s.languageFilter);
  const versionFilter = useAppStore(s => s.versionFilter);
  const setVersionFilter = useAppStore(s => s.setVersionFilter);
  const timeFilter = useAppStore(s => s.timeFilter);
  const setTimeFilter = useAppStore(s => s.setTimeFilter);
  const audioFilter = useAppStore(s => s.audioFilter);
  const setAudioFilter = useAppStore(s => s.setAudioFilter);
  const resetFilters = useAppStore(s => s.resetFilters);
  const addNotification = useAppStore(s => s.addNotification);
  
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const resetLibrary = useAppStore(s => s.resetLibrary);

  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [showFilters, setShowFilters] = useState(false);
  const [isFooterExpanded, setIsFooterExpanded] = useState(false);
  const [isSynonymFilterExpanded, setIsSynonymFilterExpanded] = useState(true);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);
  
  const [expandedBibleBookId, setExpandedBibleBookId] = useState<string | null>(selectedBibleBookId || 'GEN');
  const [bibleCategoryFilter, setBibleCategoryFilter] = useState<string | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(800);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const currentItemHeight = (isFullTextSearch && searchResults.length > 0) ? SEARCH_ITEM_HEIGHT : ITEM_HEIGHT;

  useEffect(() => {
    if (isFullTextSearch && searchQuery.trim().length >= 2) {
      triggerSearch();
    }
  }, [
    yearFilter, monthFilter, dayFilter, cityFilter, versionFilter, audioFilter, triggerSearch, 
    isFullTextSearch, showOnlySynonyms, showOnlyQuery, selectedSynonym, includeSynonyms,
    libraryMode, bibleTestamentFilter, bibleVersion
  ]);

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) setContainerHeight(entry.contentRect.height);
    });
    resizeObserver.observe(scrollContainerRef.current);
    setContainerHeight(scrollContainerRef.current.clientHeight);
    return () => resizeObserver.disconnect();
  }, [sidebarOpen]);

  const updateSearchQuery = useCallback((q: string) => {
    startTransition(() => {
      setSearchQueryStore(q);
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    });
  }, [setSearchQueryStore]);

  const dynamicYears = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) {
        const d = sermons[i].date;
        if (d && d.length >= 4) {
            const year = d.substring(0, 4);
            if (/^\d{4}$/.test(year)) set.add(year);
        }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [sermons]);

  const dynamicMonths = useMemo(() => ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"], []);

  const getMonthName = (month: string) => {
    const namesFR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const namesEN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const idx = parseInt(month, 10) - 1;
    return lang === 'fr' ? namesFR[idx] : namesEN[idx];
  };

  const dynamicDays = useMemo(() => {
    const days = [];
    for (let i = 1; i <= 31; i++) days.push(i.toString().padStart(2, '0'));
    return days;
  }, []);

  const dynamicCities = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) if (sermons[i].city) set.add(sermons[i].city);
    return Array.from(set).sort();
  }, [sermons]);

  const dynamicVersions = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) if (sermons[i].version) set.add(sermons[i].version);
    return Array.from(set).sort();
  }, [sermons]);

  const filteredSermons = useMemo(() => {
    const q = normalizeText(deferredSearchQuery.trim());
    return sermons.filter(sermon => {
      if (yearFilter) {
        if (!sermon.date || !sermon.date.startsWith(yearFilter)) return false;
      }
      if (monthFilter) {
        if (!sermon.date || sermon.date.length < 7) return false;
        const m = sermon.date.substring(5, 7);
        if (m !== monthFilter) return false;
      }
      if (dayFilter) {
        if (!sermon.date || sermon.date.length < 10) return false;
        const d = sermon.date.substring(8, 10);
        if (d !== dayFilter) return false;
      }
      if (cityFilter && sermon.city !== cityFilter) return false;
      if (versionFilter && sermon.version !== versionFilter) return false;
      if (audioFilter && !sermon.audio_url) return false;

      if (!q) return true;

      const titleNorm = normalizeText(sermon.title || '');
      const cityNorm = normalizeText(sermon.city || '');
      const dateNorm = normalizeText(sermon.date || '');
      
      return titleNorm.includes(q) || cityNorm.includes(q) || dateNorm.includes(q);
    });
  }, [sermons, deferredSearchQuery, yearFilter, monthFilter, dayFilter, cityFilter, versionFilter, audioFilter]);

  const bibleCategories = useMemo(() => {
    const list = ['Pentateuque', 'Historique', 'Poétique', 'Prophètes', 'Évangiles', 'Actes', 'Épîtres', 'Apocalypse'];
    return list;
  }, []);

  const filteredBibleBooks = useMemo(() => {
    const q = normalizeText(deferredSearchQuery.trim());
    return BIBLE_BOOKS_META.filter(book => {
      if (bibleTestamentFilter === 'OT' && book.testament !== 'OT') return false;
      if (bibleTestamentFilter === 'NT' && book.testament !== 'NT') return false;
      if (bibleCategoryFilter && book.category !== bibleCategoryFilter) return false;

      if (!q) return true;

      const nameNorm = normalizeText(book.name);
      const catNorm = normalizeText(book.category);
      const idNorm = normalizeText(book.id);
      return nameNorm.includes(q) || catNorm.includes(q) || idNorm.includes(q);
    });
  }, [deferredSearchQuery, bibleTestamentFilter, bibleCategoryFilter]);

  const displayList = useMemo(() => {
    if (isFullTextSearch && searchResults.length > 0) return searchResults;
    if (libraryMode === 'bible') return filteredBibleBooks;
    return filteredSermons;
  }, [isFullTextSearch, searchResults, libraryMode, filteredBibleBooks, filteredSermons]);

  const totalListHeight = (isFullTextSearch && searchResults.length > 0)
    ? searchResults.length * SEARCH_ITEM_HEIGHT
    : libraryMode === 'bible'
      ? filteredBibleBooks.length * 75 // dynamic estimate
      : filteredSermons.length * ITEM_HEIGHT;

  const isVirtualized = (isFullTextSearch && searchResults.length > 0) || libraryMode === 'sermons';

  const visibleRange = useMemo(() => {
    if (!isVirtualized) {
      return { startIndex: 0, endIndex: displayList.length };
    }
    const startIndex = Math.max(0, Math.floor(scrollTop / currentItemHeight) - 3);
    const endIndex = Math.min(displayList.length, Math.ceil((scrollTop + containerHeight) / currentItemHeight) + 3);
    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, displayList.length, currentItemHeight, isVirtualized]);

  const visibleItems = useMemo(() => {
    if (!isVirtualized) return displayList;
    return displayList.slice(visibleRange.startIndex, visibleRange.endIndex);
  }, [displayList, visibleRange, isVirtualized]);

  const offsetY = isVirtualized ? visibleRange.startIndex * currentItemHeight : 0;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    setScrollTop(top);
    if (isFullTextSearch) {
      savedSearchScrollTop = top;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInternalQuery(val);
    updateSearchQuery(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerSearch();
    }
  };

  const handleSynonymClick = (syn: string) => {
    if (selectedSynonym === syn) {
      setSelectedSynonym(null);
    } else {
      setSelectedSynonym(syn);
    }
  };

  const activeFiltersCount = useMemo(() => {
    if (libraryMode === 'bible') {
      let count = 0;
      if (bibleTestamentFilter !== 'ALL') count++;
      if (bibleCategoryFilter) count++;
      return count;
    }
    let count = 0;
    if (yearFilter) count++;
    if (monthFilter) count++;
    if (dayFilter) count++;
    if (cityFilter) count++;
    if (versionFilter) count++;
    if (audioFilter) count++;
    return count;
  }, [libraryMode, bibleTestamentFilter, bibleCategoryFilter, yearFilter, monthFilter, dayFilter, cityFilter, versionFilter, audioFilter]);

  const handleResultClick = (result: SearchResult) => {
    setSelectedSermonId(result.sermonId);
    setJumpToParagraph(result.paragraphIndex);
    useAppStore.getState().setJumpToText(null);
  };

  const handleAddToNotes = (e: React.MouseEvent, res: SearchResult) => {
    e.stopPropagation();
    const sermonObj: Sermon = {
        id: res.sermonId,
        title: res.title,
        date: res.date,
        city: res.city,
        text: ''
    };
    setNoteSelectorPayload({
        text: res.snippet || '',
        sermon: sermonObj,
        paragraphIndex: res.paragraphIndex
    });
  };

  const handleSelectBibleChapter = (bookId: string, chapter: number) => {
    setSelectedSermonId(`bible-${bookId}-${chapter}`);
  };

  const currentItemsForDock = useMemo(() => {
    if (isFullTextSearch && searchResults.length > 0) {
      return Array.from(new Set(searchResults.map(r => r.sermonId)));
    }
    if (libraryMode === 'bible') {
      return filteredBibleBooks.map(b => `bible-${b.id}-all`);
    }
    return filteredSermons.map(s => s.id);
  }, [isFullTextSearch, searchResults, libraryMode, filteredBibleBooks, filteredSermons]);

  const areAllItemsInDock = useMemo(() => {
    if (currentItemsForDock.length === 0) return false;
    return currentItemsForDock.every(id => manualContextIds.includes(id));
  }, [currentItemsForDock, manualContextIds]);

  const handleToggleAllToContext = () => {
    if (currentItemsForDock.length === 0) return;
    if (areAllItemsInDock) {
      const newManual = manualContextIds.filter(id => !currentItemsForDock.includes(id));
      setManualContextIds(newManual);
      addNotification("Éléments retirés du dock IA", 'success');
    } else {
      const newManual = Array.from(new Set([...manualContextIds, ...currentItemsForDock]));
      setManualContextIds(newManual);
      addNotification(`${currentItemsForDock.length} éléments ajoutés au dock IA`, 'success');
    }
  };

  if (!sidebarOpen) return null;

  return (
    <div className={`w-full border-r border-slate-200/50 dark:border-slate-800/80 bg-slate-50 dark:bg-zinc-950 h-full flex flex-col overflow-hidden transition-all duration-500 ${isPending ? 'opacity-70' : ''}`}>
      {noteSelectorPayload && (
        <NoteSelectorModal 
            selectionText={noteSelectorPayload.text} 
            sermon={noteSelectorPayload.sermon} 
            paragraphIndex={noteSelectorPayload.paragraphIndex}
            onClose={() => setNoteSelectorPayload(null)} 
        />
      )}

      {/* Header Top Bar */}
      <div className="h-14 border-b border-slate-200 dark:border-slate-800/50 flex items-center shrink-0 bg-slate-50 dark:bg-zinc-950 z-50 transition-all duration-500 px-3 justify-between">
        <div 
          onClick={toggleSidebar} 
          className="flex items-center gap-2.5 min-w-0 cursor-pointer group hover:opacity-90 active:scale-95 transition-all"
          title={sidebarOpen ? "Fermer la bibliothèque" : "Ouvrir la bibliothèque"}
        >
          <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-xl border border-teal-600/20 shadow-sm shrink-0 transition-transform group-hover:bg-teal-600/20 group-hover:border-teal-600/40">
            <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="Logo" className="w-4 h-4 object-contain" />
          </div>
          <div className="text-left truncate">
            <h2 className="text-[9.5px] font-black uppercase tracking-[0.2em] text-slate-900 dark:text-zinc-50 leading-tight truncate">
              {libraryMode === 'bible' ? "Sainte Bible" : t.sidebar_subtitle}
            </h2>
            <p className="text-[7.5px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest mt-0.5">
              {isFullTextSearch && searchResults.length > 0 
                ? `${searchResults.length} résultats` 
                : libraryMode === 'bible' 
                  ? `${filteredBibleBooks.length} livres (${BIBLE_VERSIONS_META[bibleVersion]?.shortName || 'LSG 1910'})` 
                  : `${filteredSermons.length} sermons`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); if (confirm("Actualiser la bibliothèque ?")) resetLibrary(); }} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-teal-600 transition-all active:scale-95" title="Actualiser"><RefreshCw className={`w-3 h-3 ${isPending ? 'animate-spin' : ''}`} /></button>
          <button onClick={toggleSidebar} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-all active:scale-95" title="Fermer"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Library Mode Switcher (Sermons vs Bible) & Bible Version Selector */}
      <div className="px-3 pt-2 pb-2 bg-slate-50/80 dark:bg-zinc-950/80 border-b border-slate-200/50 dark:border-slate-800/40 space-y-2">
        <div className="grid grid-cols-2 p-1 bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300/40 dark:border-zinc-800">
          <button
            onClick={() => {
              setLibraryMode('sermons');
              if (isFullTextSearch && searchResults.length > 0) {
                useAppStore.getState().setSearchResults([]);
              }
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${
              libraryMode === 'sermons'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <Library className="w-3 h-3" />
            <span>Sermons</span>
          </button>

          <button
            onClick={() => {
              setLibraryMode('bible');
              if (isFullTextSearch && searchResults.length > 0) {
                useAppStore.getState().setSearchResults([]);
              }
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${
              libraryMode === 'bible'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-3 h-3" />
            <span>Sainte Bible</span>
          </button>
        </div>

        {/* Dynamic Version Selector for Bible Mode */}
        {libraryMode === 'bible' && (
          <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-200/60 dark:border-zinc-800/80">
            <span className="text-[8.5px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1 pl-1">
              <BookMarked className="w-3 h-3 text-teal-600 dark:text-teal-400" />
              Version :
            </span>
            <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-zinc-900 p-0.5 rounded-lg border border-slate-300/40 dark:border-zinc-800">
              {(['lsg1910', 'darby', 'kjv'] as BibleVersion[]).map((v) => {
                const meta = BIBLE_VERSIONS_META[v];
                const isActive = bibleVersion === v;
                return (
                  <button
                    key={v}
                    onClick={() => setBibleVersion(v)}
                    className={`px-2 py-1 rounded-md text-[8.5px] font-black uppercase tracking-wider transition-all duration-150 ${
                      isActive
                        ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-slate-300/50 dark:hover:bg-zinc-800'
                    }`}
                    title={`${meta.label} (${meta.subtext})`}
                  >
                    {meta.shortName}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3.5 space-y-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-zinc-950/60">
          {/* Search Input */}
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder={
                isFullTextSearch 
                  ? (libraryMode === 'bible' ? "Recherche de versets bibliques..." : "Recherche intégrale...") 
                  : (libraryMode === 'bible' ? "Filtrer livres bibliques..." : t.search_placeholder)
              }
              className={`w-full pl-9 pr-12 py-2.5 bg-white dark:bg-zinc-900 border rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-4 transition-all shadow-sm ${isFullTextSearch ? 'border-teal-600 dark:border-teal-500 focus:ring-teal-600/10' : 'border-slate-200 dark:border-zinc-700/60 focus:border-teal-500 focus:ring-teal-500/10'}`}
              value={internalQuery}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
            />
            <Search className={`absolute left-3 w-3.5 h-3.5 ${isFullTextSearch ? 'text-teal-600' : 'text-slate-400'}`} />
            <div className="absolute right-1.5 flex items-center gap-1">
              {internalQuery && <button onClick={() => { setInternalQuery(''); updateSearchQuery(''); useAppStore.getState().setSearchResults([]); }} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
              {isFullTextSearch && <button onClick={triggerSearch} disabled={isSearching} className="w-8 h-8 flex items-center justify-center bg-teal-600 text-white rounded-lg hover:bg-teal-700 shadow-lg shadow-teal-600/20 active:scale-90">{isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}</button>}
            </div>
          </div>

          {/* Quick Toolbar */}
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div onClick={() => setIsFullTextSearch(!isFullTextSearch)} className="flex items-center gap-2 cursor-pointer group select-none">
              <div className={`relative w-8 h-4.5 rounded-full transition-all flex items-center px-0.5 ${isFullTextSearch ? 'bg-teal-600 shadow-lg shadow-teal-600/20' : 'bg-slate-200 dark:bg-zinc-700 shadow-inner'}`}>
                <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transition-all transform ${isFullTextSearch ? 'translate-x-3.5 scale-100' : 'translate-x-0 scale-90'}`} />
              </div>
              <span className={`text-[8.5px] font-black uppercase tracking-widest ${isFullTextSearch ? 'text-teal-600' : 'text-slate-400 dark:text-zinc-500'}`}>
                {t.full_text_search}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
                <button 
                  onClick={handleToggleAllToContext}
                  data-tooltip={areAllItemsInDock ? "Tout retirer du dock IA" : "Tout ajouter au dock IA"}
                  className={`w-7.5 h-7.5 flex items-center justify-center rounded-lg border transition-all active:scale-95 shadow-sm tooltip-bottom ${
                    areAllItemsInDock 
                      ? 'bg-amber-500 border-amber-600 text-white shadow-amber-500/20' 
                      : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-teal-600 hover:bg-teal-50 dark:hover:bg-zinc-700'
                  }`}
                >
                  <Sparkles className={`w-3.5 h-3.5 ${areAllItemsInDock ? 'animate-pulse' : ''}`} />
                </button>
                
                {libraryMode === 'sermons' && (
                  <button 
                    onClick={() => setAudioFilter(!audioFilter)}
                    data-tooltip={audioFilter ? "Afficher tous les sermons" : "Sermons avec audio uniquement"}
                    className={`w-7.5 h-7.5 flex items-center justify-center rounded-lg border transition-all active:scale-95 shadow-sm tooltip-bottom ${
                      audioFilter ? 'bg-teal-600 border-teal-600 text-white shadow-teal-600/20' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <Headphones className="w-3.5 h-3.5" />
                  </button>
                )}

              {isFullTextSearch && (
                  <button 
                    onClick={() => setIncludeSynonyms(!includeSynonyms)}
                    className={`flex items-center gap-1.5 px-2.5 h-7.5 rounded-lg border transition-all active:scale-95 shadow-sm ${includeSynonyms ? 'bg-amber-600 border-amber-600 text-white' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400'}`}
                  >
                    <Layers className="w-3 h-3" />
                    <span className="text-[7.5px] font-black uppercase tracking-widest">Synonymes</span>
                  </button>
              )}

              <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center justify-center gap-1 px-2.5 h-7.5 rounded-lg border text-[7.5px] font-black uppercase tracking-widest transition-all ${showFilters || activeFiltersCount > 0 ? 'bg-teal-600 text-white border-teal-600 shadow-xl shadow-teal-600/20' : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500'}`}>
                <Filter className="w-2.5 h-2.5" />
                <span>Filtres</span>
              </button>
            </div>
          </div>

          {/* Synonym Expansion Toolbar */}
          {isFullTextSearch && includeSynonyms && activeSynonyms.length > 0 && (
             <div className="flex flex-col gap-2.5 p-2.5 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 rounded-xl animate-in slide-in-from-top-2 duration-300">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-1.5">
                     <Sparkles className="w-3 h-3 text-amber-600" />
                     <span className="text-[8px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-500">Filtrage des segments</span>
                   </div>
                   <button 
                     onClick={() => setIsSynonymFilterExpanded(!isSynonymFilterExpanded)}
                     className="w-5 h-5 flex items-center justify-center text-amber-600 hover:bg-amber-600/10 rounded-lg transition-all"
                   >
                     {isSynonymFilterExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                   </button>
                </div>

                {isSynonymFilterExpanded && (
                  <div className="space-y-2 animate-in fade-in zoom-in-95 duration-300 origin-top">
                    <div className="flex items-center gap-2">
                        <button 
                          onClick={() => { 
                            const nextVal = !showOnlyQuery;
                            setShowOnlyQuery(nextVal); 
                            if(nextVal) setShowOnlySynonyms(false); 
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition-all active:scale-95 ${showOnlyQuery ? 'bg-amber-600 border-amber-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 border-amber-200 dark:border-amber-800 text-amber-600'}`}
                        >
                            <Type className="w-3 h-3" />
                            <span className="text-[7.5px] font-black uppercase tracking-widest">Mot Strict</span>
                        </button>
                        <button 
                          onClick={() => { 
                            const nextVal = !showOnlySynonyms;
                            setShowOnlySynonyms(nextVal); 
                            if(nextVal) setShowOnlyQuery(false); 
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition-all active:scale-95 ${showOnlySynonyms ? 'bg-teal-600 border-teal-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 border-teal-200 dark:border-teal-800 text-teal-600'}`}
                        >
                            <Layers className="w-3 h-3" />
                            <span className="text-[7.5px] font-black uppercase tracking-widest">Synonymes</span>
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1 max-h-[55px] overflow-y-auto custom-scrollbar pt-0.5">
                       {activeSynonyms.map(s => {
                         const isActive = selectedSynonym === s;
                         return (
                           <button 
                            key={s} 
                            onClick={() => handleSynonymClick(s)}
                            className={`text-[7.5px] font-bold px-1.5 py-0.5 rounded-md border transition-all active:scale-90 shadow-xs ${
                              isActive 
                                ? 'bg-teal-600 text-white border-teal-600 ring-2 ring-teal-600/30 animate-pulse' 
                                : 'bg-white/80 dark:bg-zinc-800/80 border-amber-100 dark:border-amber-900/50 text-amber-800 dark:text-amber-400 hover:bg-amber-600 hover:text-white hover:border-amber-600'
                            }`}
                           >
                              {s}
                           </button>
                         );
                       })}
                    </div>
                  </div>
                )}
             </div>
          )}

          {/* Search Mode Bar */}
          {isFullTextSearch && (
            <div className="flex items-stretch gap-1 bg-white dark:bg-zinc-900/30 p-1 rounded-xl border border-slate-200/40 dark:border-zinc-700/40 shadow-inner">
              <SearchModeButton mode={SearchMode.EXACT_PHRASE} label="PHRASE" tooltip="Recherche exacte" currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.DIVERSE} label="LARGES" tooltip="Au moins un mot" currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.EXACT_WORDS} label="STRICTS" tooltip="Tous les mots" currentMode={searchMode} setMode={setSearchMode} />
            </div>
          )}

          {/* Conditional Filters Bar */}
          {showFilters && (
            <div className="pt-2.5 border-t border-slate-200 dark:border-zinc-700/50 space-y-2">
              {libraryMode === 'bible' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1 bg-white dark:bg-zinc-900/40 p-1 rounded-xl border border-slate-200 dark:border-zinc-800">
                    <button
                      onClick={() => setBibleTestamentFilter('ALL')}
                      className={`flex-1 py-1 text-[8px] font-black uppercase rounded-lg transition-all ${
                        bibleTestamentFilter === 'ALL'
                          ? 'bg-teal-600 text-white shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      Tous (66)
                    </button>
                    <button
                      onClick={() => setBibleTestamentFilter('OT')}
                      className={`flex-1 py-1 text-[8px] font-black uppercase rounded-lg transition-all ${
                        bibleTestamentFilter === 'OT'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      Ancien (39)
                    </button>
                    <button
                      onClick={() => setBibleTestamentFilter('NT')}
                      className={`flex-1 py-1 text-[8px] font-black uppercase rounded-lg transition-all ${
                        bibleTestamentFilter === 'NT'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      Nouveau (27)
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setBibleCategoryFilter(null)}
                      className={`px-2 py-0.5 rounded text-[7.5px] font-black uppercase border transition-all ${
                        bibleCategoryFilter === null
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500'
                      }`}
                    >
                      Toutes catégories
                    </button>
                    {bibleCategories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setBibleCategoryFilter(bibleCategoryFilter === cat ? null : cat)}
                        className={`px-2 py-0.5 rounded text-[7.5px] font-bold border transition-all ${
                          bibleCategoryFilter === cat
                            ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-teal-500'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <ModernDropdown value={yearFilter} onChange={setYearFilter} options={dynamicYears} placeholder={t.filter_year} />
                  <ModernDropdown value={monthFilter} onChange={setMonthFilter} options={dynamicMonths} placeholder={t.filter_month} displayValue={getMonthName} />
                  <ModernDropdown value={dayFilter} onChange={setDayFilter} options={dynamicMonths} placeholder={t.filter_day} />
                  <ModernDropdown value={cityFilter} onChange={setCityFilter} options={dynamicCities} placeholder={t.filter_city} />
                  <ModernDropdown value={versionFilter} onChange={setVersionFilter} options={dynamicVersions} placeholder={t.filter_version} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content View: Bible Books or Sermons or Search Results */}
        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar relative bg-white dark:bg-zinc-900">
          {isSearching ? (
            <div className="p-20 flex flex-col items-center justify-center gap-6 text-teal-600">
                <div className="relative">
                   <div className="absolute inset-0 bg-teal-500/20 blur-xl rounded-full animate-pulse" />
                   <Loader2 className="w-10 h-10 animate-spin relative z-10" />
                </div>
                <div className="flex flex-col items-center gap-1">
                   <span className="text-[11px] font-black uppercase tracking-[0.4em] animate-pulse">Exploration</span>
                   <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">
                     {libraryMode === 'bible' ? "Recherche dans la Sainte Bible..." : "Analyse de la bibliothèque..."}
                   </span>
                </div>
            </div>
          ) : displayList.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] opacity-30">
              {t.no_results}
            </div>
          ) : isFullTextSearch && searchResults.length > 0 ? (
            /* Virtualized Search Results (Works for both Sermons and Bible) */
            <div style={{ height: totalListHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
                {visibleItems.map((item) => {
                  const res = item as SearchResult;
                  return (
                    <SearchResultItem 
                      key={res.paragraphId} 
                      result={res} 
                      isSelected={selectedSermonId === res.sermonId && useAppStore.getState().jumpToParagraph === res.paragraphIndex} 
                      onSelect={() => handleResultClick(res)} 
                      onAddToNotes={(e) => handleAddToNotes(e, res)} 
                    />
                  );
                })}
              </div>
            </div>
          ) : libraryMode === 'bible' ? (
            /* Bible Books View */
            <div className="py-2">
              {filteredBibleBooks.map(book => {
                const isExpanded = expandedBibleBookId === book.id;
                const isBookInDock = manualContextIds.some(id => id.startsWith(`bible-${book.id}-`));

                return (
                  <BibleBookItem
                    key={book.id}
                    book={book}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpandedBibleBookId(isExpanded ? null : book.id)}
                    selectedBookId={selectedBibleBookId}
                    selectedChapter={selectedBibleChapter}
                    onSelectChapter={(ch) => handleSelectBibleChapter(book.id, ch)}
                    isBookInDock={isBookInDock}
                    onToggleBookInDock={() => {
                      if (isBookInDock) {
                        const newManual = manualContextIds.filter(id => !id.startsWith(`bible-${book.id}-`));
                        setManualContextIds(newManual);
                      } else {
                        const bookAllId = `bible-${book.id}-all`;
                        const newManual = Array.from(new Set([...manualContextIds, bookAllId]));
                        setManualContextIds(newManual);
                      }
                    }}
                  />
                );
              })}
            </div>
          ) : (
            /* Sermons List View (Virtualized) */
            <div style={{ height: totalListHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
                {visibleItems.map((item) => {
                  const s = item as Omit<Sermon, 'text'>;
                  return (
                    <SermonItem 
                      key={s.id} 
                      sermon={s} 
                      isSelected={selectedSermonId === s.id} 
                      isContextSelected={manualContextIds.includes(s.id)} 
                      onSelect={(multi) => setSelectedSermonId(s.id, multi)} 
                      onToggleContext={(multi) => toggleContextSermon(s.id, multi)} 
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
        
        {/* Footer Ultra Compact & Élégant */}
        <div className={`border-t border-zinc-200/40 dark:border-zinc-800/60 bg-white/60 dark:bg-zinc-950/80 backdrop-blur-2xl transition-all duration-500 overflow-hidden flex flex-col shrink-0 relative ${isFooterExpanded ? 'py-4 px-4 h-auto' : 'py-1 px-4 h-[26px]'}`}>
          
          {/* Poignée Chevron Centrée */}
          <button 
            onClick={() => setIsFooterExpanded(!isFooterExpanded)}
            className={`absolute left-1/2 -translate-x-1/2 w-10 h-4 flex items-center justify-center text-zinc-300 dark:text-zinc-600 hover:text-teal-600 transition-all z-20 ${isFooterExpanded ? 'top-0' : 'top-[-2px]'}`}
          >
            {isFooterExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-2.5 h-2.5" />}
          </button>

          <div className="flex flex-col items-center text-center">
            {!isFooterExpanded && (
              <div className="flex items-center justify-center gap-3 animate-in fade-in duration-500 mt-1">
                <span className="text-[6px] font-black text-zinc-400/80 uppercase tracking-[0.2em]">KSW 1.0.3</span>
                <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
                <span className="text-[6px] font-bold text-zinc-400/80 uppercase tracking-tight">Vision de l'Aigle Tabernacle, Koufoli, PNR, Congo</span>
              </div>
            )}

            <div className={`space-y-2 transition-all duration-500 origin-top flex flex-col items-center ${isFooterExpanded ? 'opacity-100 scale-y-100 mt-2 pb-2' : 'opacity-0 scale-y-0 h-0 overflow-hidden'}`}>
              <div className="flex flex-col items-center mb-1">
                <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="Logo" className="w-4 h-4 mb-0.5 object-contain" />
                <h3 className="text-[8px] font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-[0.3em] leading-none">King's Sword</h3>
              </div>
              
              <p className="text-[6.5px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-[0.2em] pour-message-par-W.M.BRANHAM">Logiciel d'étude du message par W.M.BRANHAM & Sainte Bible</p>
              
              <div className="flex flex-col items-center gap-1 mt-1">
                <p className="text-[6.5px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest leading-none">Développé par Bienvenu Sédin Massamba</p>
                <p className="text-[6.5px] font-bold text-zinc-400 uppercase tracking-tight leading-none opacity-80">Vision de l'Aigle Tabernacle, Koufoli, PNR, Congo</p>
              </div>

              <p className="text-[6.5px] font-black text-zinc-400/60 uppercase tracking-[0.25em] flex items-center justify-center gap-2 mt-2">
                KSW 1.0.3 <span className="w-0.5 h-0.5 bg-teal-600/20 rounded-full" /> © 2026 Tous droits réservés
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

let savedSearchScrollTop = 0;

export default Sidebar;
