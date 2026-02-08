
import React, { useState, useRef, useEffect, useMemo, memo, useDeferredValue, useTransition, useCallback } from 'react';
import { useAppStore, SearchResult } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { normalizeText } from '../utils/textUtils';
import NoteSelectorModal from './NoteSelectorModal';
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
  Library,
  Info,
  RotateCcw,
  Clock,
  BookOpen,
  Hash,
  NotebookPen
} from 'lucide-react';

const ITEM_HEIGHT = 80; 
const SEARCH_ITEM_HEIGHT = 110; 

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

  const currentDisplay = value ? (displayValue ? displayValue(value) : value) : placeholder;

  return (
    <div className={`relative flex-1 min-w-[100px] ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between text-[9px] font-black uppercase tracking-wider p-2 rounded-lg border transition-all duration-300 ${
          isOpen 
            ? 'bg-white border-teal-600 ring-4 ring-teal-600/10 text-teal-600 shadow-lg' 
            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-teal-500/50 text-zinc-900 dark:text-zinc-100 shadow-sm'
        }`}
      >
        <span className="truncate pr-1">{currentDisplay}</span>
        <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-300 ${isOpen ? 'rotate-180 text-teal-600' : 'text-zinc-400'}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 py-1 bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-xl shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-200 overflow-hidden backdrop-blur-xl">
          <div className="max-h-[160px] overflow-y-auto custom-scrollbar p-1">
            <button
              onClick={() => { onChange(null); setIsOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-zinc-400 hover:bg-teal-600/[0.08] dark:hover:bg-teal-400/[0.06] border border-transparent hover:border-teal-600/10 dark:hover:border-teal-400/10 rounded-lg transition-all"
            >
              {placeholder}
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
        className={`group w-full flex flex-col gap-1 p-3 rounded-xl transition-all duration-300 cursor-pointer h-[100px] overflow-hidden ${
          isSelected 
            ? 'bg-teal-600/15 dark:bg-teal-600/25 ring-1 ring-teal-600/30 shadow-md' 
            : 'hover:bg-teal-600/[0.08] dark:hover:bg-teal-400/[0.06] border border-transparent hover:border-teal-600/10 dark:hover:border-teal-400/10'
        }`}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-tight truncate max-w-[70%]">
            {result.title}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[7px] font-mono text-zinc-400">{result.date}</span>
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[7px] font-black text-zinc-500">
               <Hash className="w-2 h-2" />
               <span>{result.paragraphIndex}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 serif-text italic line-clamp-2" dangerouslySetInnerHTML={{ __html: result.snippet || '' }} />
        </div>

        <div className="flex items-center justify-end mt-1">
          <button 
            onClick={onAddToNotes}
            className="w-6 h-6 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-lg hover:bg-teal-600 hover:text-white transition-all active:scale-90"
          >
            <NotebookPen className="w-3 h-3" />
          </button>
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
  
  const searchQuery = useAppStore(s => s.searchQuery);
  const searchMode = useAppStore(s => s.searchMode);
  const setSearchMode = useAppStore(s => s.setSearchMode);
  const isFullTextSearch = useAppStore(s => s.isFullTextSearch);
  const setIsFullTextSearch = useAppStore(s => s.setIsFullTextSearch);
  const isSearching = useAppStore(s => s.isSearching);
  const triggerSearch = useAppStore(s => s.triggerSearch);
  const setSearchQueryStore = useAppStore(s => s.setSearchQuery);
  
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
  
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const resetLibrary = useAppStore(s => s.resetLibrary);

  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [showFilters, setShowFilters] = useState(false);
  const [isFooterVisible, setIsFooterVisible] = useState(false);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);
  
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(800);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const currentItemHeight = isFullTextSearch && searchResults.length > 0 ? SEARCH_ITEM_HEIGHT : ITEM_HEIGHT;

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
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

  const dynamicTimes = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) if (sermons[i].time) set.add(sermons[i].time);
    return Array.from(set).sort();
  }, [sermons]);

  useEffect(() => {
    setInternalQuery(searchQuery);
  }, [searchQuery]);

  const activeFiltersCount = [yearFilter, monthFilter, dayFilter, cityFilter, versionFilter, timeFilter, audioFilter].filter(f => f === true || (typeof f === 'string' && f !== null)).length;

  const filteredSermons = useMemo(() => {
    const q = isFullTextSearch ? "" : normalizeText(deferredSearchQuery);

    return sermons.filter(s => {
      if (!s) return false;
      if (q) {
        const titleText = (s as any)._normalizedTitle || normalizeText(s.title || '');
        if (!titleText.includes(q)) return false;
      }
      if (cityFilter && s.city !== cityFilter) return false;
      if (yearFilter && (!s.date || !s.date.startsWith(yearFilter))) return false;
      if (monthFilter && (!s.date || s.date.substring(5, 7) !== monthFilter)) return false;
      if (dayFilter && (!s.date || s.date.substring(8, 10) !== dayFilter)) return false;
      if (versionFilter && s.version !== versionFilter) return false;
      if (timeFilter && s.time !== timeFilter) return false;
      if (audioFilter && !s.audio_url) return false;
      return true;
    });
  }, [sermons, deferredSearchQuery, cityFilter, yearFilter, monthFilter, dayFilter, versionFilter, timeFilter, audioFilter, isFullTextSearch]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop);

  const displayList = (isFullTextSearch && searchResults.length > 0) ? searchResults : filteredSermons;
  const totalListHeight = displayList.length * currentItemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / currentItemHeight) - 5);
  const endIndex = Math.min(displayList.length, startIndex + Math.ceil(containerHeight / currentItemHeight) + 10);
  const visibleItems = displayList.slice(startIndex, endIndex);
  const offsetY = startIndex * currentItemHeight;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInternalQuery(val);
    updateSearchQuery(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') triggerSearch();
  };

  const handleResultClick = async (res: SearchResult) => {
    await setSelectedSermonId(res.sermonId);
    setJumpToParagraph(res.paragraphIndex);
  };

  const handleAddToNotes = (e: React.MouseEvent, res: SearchResult) => {
    e.stopPropagation();
    const cleanText = res.snippet?.replace(/<mark[^>]*>|<\/mark>/g, '') || '';
    setNoteSelectorPayload({
        text: cleanText,
        sermon: { id: res.sermonId, title: res.title, date: res.date, city: res.city, text: '' },
        paragraphIndex: res.paragraphIndex
    });
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
      <div className={`h-14 border-b border-slate-200 dark:border-slate-800/50 flex items-center shrink-0 bg-slate-50 dark:bg-zinc-950 z-50 transition-all duration-500 px-4 justify-between`}>
        <button 
          onClick={toggleSidebar} 
          className={`flex items-center gap-2 hover:opacity-80 transition-all active:scale-95 min-w-0 group tooltip-br`}
          data-tooltip="Réduire la bibliothèque"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
            <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-3.5 h-3.5 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
          </div>
          <div className="text-left truncate animate-in fade-in slide-in-from-left-2 duration-500">
            <h2 className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-900 dark:text-zinc-50 leading-tight truncate group-hover:text-teal-600 transition-colors">
              {t.sidebar_subtitle}
            </h2>
            <p className="text-[7px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest mt-0.5">
              {isFullTextSearch && searchResults.length > 0 ? `${searchResults.length} résultats` : `${filteredSermons.length} sermons`}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 animate-in fade-in duration-500">
          <button 
            onClick={(e) => { e.stopPropagation(); if (confirm("Actualiser la bibliothèque ?")) resetLibrary(); }}
            data-tooltip="Actualiser"
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-teal-600 transition-all rounded-lg hover:bg-teal-50 dark:hover:bg-teal-900/20 active:scale-95 tooltip-bottom"
          >
            <RefreshCw className={`w-3 h-3 ${isPending ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={toggleSidebar} 
            data-tooltip={t.tooltip_close}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 tooltip-bottom"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-700">
        <div className="p-4 space-y-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-zinc-950/60 transition-colors duration-500">
          <div className="relative group/search-input flex items-center">
            <input
              type="text"
              placeholder={isFullTextSearch ? "Chercher partout..." : t.search_placeholder}
              className={`w-full pl-9 pr-12 py-2.5 bg-white dark:bg-zinc-900 border rounded-xl text-xs font-bold text-slate-950 dark:text-white focus:outline-none focus:ring-4 transition-all shadow-sm ${
                isFullTextSearch 
                  ? 'border-teal-600 dark:border-teal-500 focus:ring-teal-600/10' 
                  : 'border-slate-200 dark:border-zinc-700/60 focus:border-teal-500 focus:ring-teal-500/10'
              }`}
              value={internalQuery}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
            />
            <Search className={`absolute left-3 w-3.5 h-3.5 transition-all duration-300 ease-out group-hover/search-input:scale-110 group-hover/search-input:rotate-[-10deg] ${isFullTextSearch ? 'text-teal-600' : 'text-slate-400'}`} />
            
            <div className="absolute right-1.5 flex items-center gap-1">
              {internalQuery && (
                <button 
                  onClick={() => { setInternalQuery(''); updateSearchQuery(''); useAppStore.getState().setSearchResults([]); }}
                  data-tooltip="Effacer"
                  className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all animate-in zoom-in-90 tooltip-bottom"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {isFullTextSearch && (
                <button 
                  onClick={triggerSearch}
                  disabled={isSearching}
                  data-tooltip="Lancer la recherche intégrale"
                  className="w-8 h-8 flex items-center justify-center bg-teal-600 text-white rounded-lg hover:bg-teal-700 active:scale-90 transition-all shadow-lg shadow-teal-600/20 disabled:opacity-50 tooltip-bottom group/search-btn"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4 transition-all duration-300 group-hover/search-btn:translate-x-0.5" />}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <div 
              onClick={() => setIsFullTextSearch(!isFullTextSearch)}
              data-tooltip="Activer/Désactiver la recherche intégrale"
              className="flex items-center gap-2.5 cursor-pointer group/toggle select-none tooltip-right"
            >
              <div className={`relative w-8 h-4.5 rounded-full transition-all duration-500 flex items-center px-0.5 ${isFullTextSearch ? 'bg-teal-600 shadow-lg shadow-teal-600/20' : 'bg-slate-200 dark:bg-zinc-700 shadow-inner'}`}>
                <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transition-all duration-500 transform ${isFullTextSearch ? 'translate-x-3.5 scale-100' : 'translate-x-0 scale-90'}`} />
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest transition-colors duration-500 ${isFullTextSearch ? 'text-teal-600' : 'text-slate-400 dark:text-zinc-500'}`}>
                {t.full_text_search}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border text-[8px] font-black uppercase tracking-widest transition-all duration-300 ease-out tooltip-left group/filter-btn active:scale-95 ${
                  showFilters || activeFiltersCount > 0
                    ? 'bg-teal-600 text-white border-teal-600 shadow-xl shadow-teal-600/20'
                    : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 hover:border-teal-500/50 hover:bg-teal-50/30 shadow-sm'
                }`}
              >
                <Filter className={`w-2.5 h-2.5 transition-all duration-300 ease-out group-hover/filter-btn:rotate-[15deg] group-hover/filter-btn:scale-110 ${showFilters ? 'rotate-180' : ''}`} />
                <span>Filtres</span>
              </button>
            </div>
          </div>

          {isFullTextSearch && (
            <div className="flex items-stretch gap-1 bg-white dark:bg-zinc-900/30 p-1.5 rounded-xl animate-in slide-in-from-top-1 duration-300 border border-slate-200/40 dark:border-zinc-700/40 shadow-inner">
              <SearchModeButton mode={SearchMode.EXACT_PHRASE} label={t.search_mode_exact_phrase} tooltip={t.search_mode_exact_phrase} currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.DIVERSE} label={t.search_mode_diverse} tooltip={t.search_mode_diverse} currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.EXACT_WORDS} label={t.search_mode_exact_words} tooltip={t.search_mode_exact_words} currentMode={searchMode} setMode={setSearchMode} />
            </div>
          )}

          {showFilters && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-zinc-700/50 animate-in slide-in-from-top-1 duration-300">
              <ModernDropdown value={yearFilter} onChange={setYearFilter} options={dynamicYears} placeholder={t.filter_year} />
              <ModernDropdown value={monthFilter} onChange={setMonthFilter} options={dynamicMonths} placeholder={t.filter_month} displayValue={getMonthName} />
              <ModernDropdown value={dayFilter} onChange={setDayFilter} options={dynamicDays} placeholder={t.filter_day} />
              <ModernDropdown value={cityFilter} onChange={setCityFilter} options={dynamicCities} placeholder={t.filter_city} />
              <ModernDropdown value={versionFilter} onChange={setVersionFilter} options={dynamicVersions} placeholder={t.filter_version} />
            </div>
          )}
        </div>

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto custom-scrollbar relative bg-white dark:bg-zinc-900"
        >
          {isSearching ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 text-teal-600 animate-pulse">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em]">Exploration...</span>
            </div>
          ) : displayList.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] opacity-30">
              {t.no_results}
            </div>
          ) : (
            <div style={{ height: totalListHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
                {visibleItems.map((item, idx) => {
                  if (isFullTextSearch && searchResults.length > 0) {
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
                  }
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
        
        <div className={`border-t border-slate-200 dark:border-slate-800/50 bg-slate-50/60 dark:bg-zinc-950/60 no-print group/footer transition-all duration-500 shrink-0 relative ${isFooterVisible ? 'py-6 px-4' : 'py-2 px-4'}`}>
          <button onClick={() => setIsFooterVisible(!isFooterVisible)} className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 flex items-center justify-center bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-full text-zinc-400 hover:text-teal-600 shadow-sm transition-all z-[60] active:scale-90">
            {isFooterVisible ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <div className="flex items-center justify-center animate-in fade-in duration-500">
             <p className="text-[8px] font-black text-zinc-400 uppercase tracking-[0.2em] text-center leading-none">
                KSW V 1.0.3 © <span className="text-teal-600 dark:text-blue-400">VISION DE L'AIGLE TABERNACLE</span>
             </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
