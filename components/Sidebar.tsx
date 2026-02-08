
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
  Clock,
  Hash,
  NotebookPen,
  Layers,
  Type,
  User
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
    isFullTextSearch, showOnlySynonyms, showOnlyQuery, selectedSynonym, includeSynonyms
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

  useEffect(() => { setInternalQuery(searchQuery); }, [searchQuery]);

  const activeFiltersCount = [yearFilter, monthFilter, dayFilter, cityFilter, versionFilter, timeFilter].filter(f => typeof f === 'string' && f !== null).length;

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
      if (audioFilter && !s.audio_url) return false;
      return true;
    });
  }, [sermons, deferredSearchQuery, cityFilter, yearFilter, monthFilter, dayFilter, versionFilter, audioFilter, isFullTextSearch]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') triggerSearch(); };

  const handleResultClick = async (res: SearchResult) => {
    savedSearchScrollTop = scrollTop;
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

  const handleSynonymClick = (syn: string) => {
    const newVal = selectedSynonym === syn ? null : syn;
    setSelectedSynonym(newVal);
  };

  const currentItemsForDock = useMemo(() => {
    if (isFullTextSearch && searchResults.length > 0) {
      const ids = new Set(searchResults.map(r => r.sermonId));
      return Array.from(ids);
    }
    return filteredSermons.map(s => s.id);
  }, [isFullTextSearch, searchResults, filteredSermons]);

  const areAllItemsInDock = useMemo(() => {
    if (currentItemsForDock.length === 0) return false;
    return currentItemsForDock.every(id => manualContextIds.includes(id));
  }, [currentItemsForDock, manualContextIds]);

  const handleToggleAllToContext = () => {
    if (currentItemsForDock.length === 0) return;
    
    if (areAllItemsInDock) {
      const currentIdsSet = new Set(currentItemsForDock);
      const newManual = manualContextIds.filter(id => !currentIdsSet.has(id));
      setManualContextIds(newManual);
      addNotification(`${currentItemsForDock.length} sermons retirés du dock IA`, 'success');
    } else {
      const newManual = Array.from(new Set([...manualContextIds, ...currentItemsForDock]));
      setManualContextIds(newManual);
      addNotification(`${currentItemsForDock.length} sermons ajoutés au dock IA`, 'success');
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
      <div className={`h-14 border-b border-slate-200 dark:border-slate-800/50 flex items-center shrink-0 bg-slate-50 dark:bg-zinc-950 z-50 transition-all duration-500 px-4 justify-between`}>
        <button onClick={toggleSidebar} className="flex items-center gap-2 hover:opacity-80 transition-all active:scale-95 group">
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0">
            <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-3.5 h-3.5 grayscale group-hover:grayscale-0 transition-all" />
          </div>
          <div className="text-left truncate">
            <h2 className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-900 dark:text-zinc-50 leading-tight truncate">
              {t.sidebar_subtitle}
            </h2>
            <p className="text-[7px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest mt-0.5">
              {isFullTextSearch && searchResults.length > 0 ? `${searchResults.length} résultats` : `${filteredSermons.length} sermons`}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); if (confirm("Actualiser ?")) resetLibrary(); }} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-teal-600 transition-all active:scale-95"><RefreshCw className={`w-3 h-3 ${isPending ? 'animate-spin' : ''}`} /></button>
          <button onClick={toggleSidebar} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-all active:scale-95"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 space-y-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-zinc-950/60">
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder={isFullTextSearch ? "Recherche intégrale..." : t.search_placeholder}
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

          <div className="flex items-center justify-between gap-2 px-1">
            <div onClick={() => setIsFullTextSearch(!isFullTextSearch)} className="flex items-center gap-2.5 cursor-pointer group select-none">
              <div className={`relative w-8 h-4.5 rounded-full transition-all flex items-center px-0.5 ${isFullTextSearch ? 'bg-teal-600 shadow-lg shadow-teal-600/20' : 'bg-slate-200 dark:bg-zinc-700 shadow-inner'}`}>
                <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transition-all transform ${isFullTextSearch ? 'translate-x-3.5 scale-100' : 'translate-x-0 scale-90'}`} />
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest ${isFullTextSearch ? 'text-teal-600' : 'text-slate-400 dark:text-zinc-500'}`}>
                {t.full_text_search}
              </span>
            </div>

            <div className="flex items-center gap-2">
                <button 
                  onClick={handleToggleAllToContext}
                  data-tooltip={areAllItemsInDock ? "Tout retirer du dock IA" : "Tout ajouter au dock IA"}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all active:scale-95 shadow-sm tooltip-bottom ${
                    areAllItemsInDock 
                      ? 'bg-amber-500 border-amber-600 text-white shadow-amber-500/20' 
                      : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-teal-600 hover:bg-teal-50 dark:hover:bg-zinc-700'
                  }`}
                >
                  <Sparkles className={`w-4 h-4 ${areAllItemsInDock ? 'animate-pulse' : ''}`} />
                </button>
                <button 
                  onClick={() => setAudioFilter(!audioFilter)}
                  data-tooltip={audioFilter ? "Afficher tous les sermons" : "Sermons avec audio uniquement"}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all active:scale-95 shadow-sm tooltip-bottom ${
                    audioFilter ? 'bg-teal-600 border-teal-600 text-white shadow-teal-600/20' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400'
                  }`}
                >
                  <Headphones className="w-4 h-4" />
                </button>
              {isFullTextSearch && (
                  <button 
                    onClick={() => setIncludeSynonyms(!includeSynonyms)}
                    className={`flex items-center gap-2 px-3 h-8 rounded-lg border transition-all active:scale-95 shadow-sm ${includeSynonyms ? 'bg-amber-600 border-amber-600 text-white' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400'}`}
                  >
                    <Layers className="w-3 h-3" />
                    <span className="text-[8px] font-black uppercase tracking-widest">Synonymes</span>
                  </button>
              )}
              <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border text-[8px] font-black uppercase tracking-widest transition-all ${showFilters || activeFiltersCount > 0 ? 'bg-teal-600 text-white border-teal-600 shadow-xl shadow-teal-600/20' : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500'}`}>
                <Filter className="w-2.5 h-2.5" />
                <span>Filtres</span>
              </button>
            </div>
          </div>

          {isFullTextSearch && includeSynonyms && activeSynonyms.length > 0 && (
             <div className="flex flex-col gap-3 p-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 rounded-xl animate-in slide-in-from-top-2 duration-300">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-1.5">
                     <Sparkles className="w-3 h-3 text-amber-600" />
                     <span className="text-[8px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-500">Filtrage des segments</span>
                   </div>
                   <button 
                     onClick={() => setIsSynonymFilterExpanded(!isSynonymFilterExpanded)}
                     className="w-6 h-6 flex items-center justify-center text-amber-600 hover:bg-amber-600/10 rounded-lg transition-all"
                   >
                     {isSynonymFilterExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                   </button>
                </div>

                {isSynonymFilterExpanded && (
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-300 origin-top">
                    <div className="flex items-center gap-2">
                        <button 
                          onClick={() => { 
                            const nextVal = !showOnlyQuery;
                            setShowOnlyQuery(nextVal); 
                            if(nextVal) setShowOnlySynonyms(false); 
                          }}
                          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition-all active:scale-95 ${showOnlyQuery ? 'bg-amber-600 border-amber-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 border-amber-200 dark:border-amber-800 text-amber-600'}`}
                        >
                            <Type className="w-3 h-3" />
                            <span className="text-[8px] font-black uppercase tracking-widest">Mot Strict</span>
                        </button>
                        <button 
                          onClick={() => { 
                            const nextVal = !showOnlySynonyms;
                            setShowOnlySynonyms(nextVal); 
                            if(nextVal) setShowOnlyQuery(false); 
                          }}
                          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition-all active:scale-95 ${showOnlySynonyms ? 'bg-teal-600 border-teal-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 border-teal-200 dark:border-teal-800 text-teal-600'}`}
                        >
                            <Layers className="w-3 h-3" />
                            <span className="text-[8px] font-black uppercase tracking-widest">Synonymes</span>
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-[60px] overflow-y-auto custom-scrollbar pt-1">
                       {activeSynonyms.map(s => {
                         const isActive = selectedSynonym === s;
                         return (
                           <button 
                            key={s} 
                            onClick={() => handleSynonymClick(s)}
                            className={`text-[8px] font-bold px-2 py-1 rounded-md border transition-all active:scale-90 shadow-sm ${
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

          {isFullTextSearch && (
            <div className="flex items-stretch gap-1 bg-white dark:bg-zinc-900/30 p-1 rounded-xl border border-slate-200/40 dark:border-zinc-700/40 shadow-inner">
              <SearchModeButton mode={SearchMode.EXACT_PHRASE} label="PHRASE" tooltip="Recherche exacte" currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.DIVERSE} label="LARGES" tooltip="Au moins un mot" currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.EXACT_WORDS} label="STRICTS" tooltip="Tous les mots" currentMode={searchMode} setMode={setSearchMode} />
            </div>
          )}

          {showFilters && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-zinc-700/50">
              <ModernDropdown value={yearFilter} onChange={setYearFilter} options={dynamicYears} placeholder={t.filter_year} />
              <ModernDropdown value={monthFilter} onChange={setMonthFilter} options={dynamicMonths} placeholder={t.filter_month} displayValue={getMonthName} />
              <ModernDropdown value={dayFilter} onChange={setDayFilter} options={dynamicMonths} placeholder={t.filter_day} />
              <ModernDropdown value={cityFilter} onChange={setCityFilter} options={dynamicCities} placeholder={t.filter_city} />
              <ModernDropdown value={versionFilter} onChange={setVersionFilter} options={dynamicVersions} placeholder={t.filter_version} />
            </div>
          )}
        </div>

        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar relative bg-white dark:bg-zinc-900">
          {isSearching ? (
            <div className="p-20 flex flex-col items-center justify-center gap-6 text-teal-600">
                <div className="relative">
                   <div className="absolute inset-0 bg-teal-500/20 blur-xl rounded-full animate-pulse" />
                   <Loader2 className="w-10 h-10 animate-spin relative z-10" />
                </div>
                <div className="flex flex-col items-center gap-1">
                   <span className="text-[11px] font-black uppercase tracking-[0.4em] animate-pulse">Exploration</span>
                   <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Analyse de la bibliothèque...</span>
                </div>
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
                    return <SearchResultItem key={res.paragraphId} result={res} isSelected={selectedSermonId === res.sermonId && useAppStore.getState().jumpToParagraph === res.paragraphIndex} onSelect={() => handleResultClick(res)} onAddToNotes={(e) => handleAddToNotes(e, res)} />;
                  }
                  const s = item as Omit<Sermon, 'text'>;
                  return <SermonItem key={s.id} sermon={s} isSelected={selectedSermonId === s.id} isContextSelected={manualContextIds.includes(s.id)} onSelect={(multi) => setSelectedSermonId(s.id, multi)} onToggleContext={(multi) => toggleContextSermon(s.id, multi)} />;
                })}
              </div>
            </div>
          )}
        </div>
        
        {/* Footer Ultra Compact, Elégant et Non-intrusif */}
        <div className={`border-t border-zinc-200/40 dark:border-zinc-800/60 bg-white/60 dark:bg-zinc-950/80 backdrop-blur-2xl transition-all duration-500 overflow-hidden flex flex-col shrink-0 relative ${isFooterExpanded ? 'py-4 px-4 h-auto' : 'py-1 px-4 h-[26px]'}`}>
          
          {/* Poignée Chevron Centrée */}
          <button 
            onClick={() => setIsFooterExpanded(!isFooterExpanded)}
            className={`absolute left-1/2 -translate-x-1/2 w-10 h-4 flex items-center justify-center text-zinc-300 dark:text-zinc-600 hover:text-teal-600 transition-all z-20 ${isFooterExpanded ? 'top-0' : 'top-[-2px]'}`}
          >
            {isFooterExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-2.5 h-2.5" />}
          </button>

          <div className="flex flex-col items-center text-center">
            {/* Mode Réduit : KSW 1.0.3 et Localisation uniquement, sans logo */}
            {!isFooterExpanded && (
              <div className="flex items-center justify-center gap-3 animate-in fade-in duration-500 mt-1">
                <span className="text-[6px] font-black text-zinc-400/80 uppercase tracking-[0.2em]">KSW 1.0.3</span>
                <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
                <span className="text-[6px] font-bold text-zinc-400/80 uppercase tracking-tight">Vision de l'Aigle Tabernacle, Koufoli, PNR, Congo</span>
              </div>
            )}

            {/* Mode Étendu : Détails complets avec Logo */}
            <div className={`space-y-2 transition-all duration-500 origin-top flex flex-col items-center ${isFooterExpanded ? 'opacity-100 scale-y-100 mt-2 pb-2' : 'opacity-0 scale-y-0 h-0 overflow-hidden'}`}>
              <div className="flex flex-col items-center mb-1">
                <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-3.5 h-3.5 grayscale opacity-60 mb-0.5" />
                <h3 className="text-[8px] font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-[0.3em] leading-none">King's Sword</h3>
              </div>
              
              <p className="text-[6.5px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-[0.2em] pour-message-par-W.M.BRANHAM">Logiciel d'étude du message par W.M.BRANHAM</p>
              
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
