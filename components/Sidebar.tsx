
// Add React import to the list of imports from 'react'
import React, { useState, useRef, useEffect, useMemo, memo, useDeferredValue, useTransition, useCallback } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { normalizeText } from '../utils/textUtils';
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
  Clock
} from 'lucide-react';

const ITEM_HEIGHT = 80; // Hauteur totale fixe (pixels) pour une virtualisation parfaite

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
          <div className="max-h-[160px] overflow-y-auto custom-scrollbar">
            <button
              onClick={() => { onChange(null); setIsOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              {placeholder}
            </button>
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setIsOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${
                  value === opt 
                    ? 'text-teal-600 bg-teal-600/5 dark:bg-teal-600/10' 
                    : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'
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
  onSelect: () => void;
  onToggleContext: () => void;
}) => {
  const isEffectivelyInContext = isSelected || isContextSelected;

  return (
    <div 
      style={{ height: ITEM_HEIGHT }} 
      className="px-3 flex items-center"
    >
      <div 
        className={`group w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer h-[72px] ${
          isSelected 
            ? 'bg-teal-600/10 dark:bg-teal-600/20 ring-1 ring-teal-600/20 shadow-md' 
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40 border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800'
        }`}
        onClick={onSelect}
      >
        <div 
          onClick={(e) => {
            if (!isSelected) {
              e.stopPropagation();
              onToggleContext();
            }
          }}
          data-tooltip={isSelected ? "Dans le contexte (auto)" : "Ajouter/Retirer du contexte IA"}
          className={`w-4 h-4 rounded-md border transition-all flex items-center justify-center shrink-0 tooltip-right ${
            isEffectivelyInContext
              ? 'bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-600/20' 
              : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 group-hover:border-teal-600/50'
          } ${isSelected ? 'cursor-not-allowed opacity-75' : ''}`}
        >
          {isEffectivelyInContext && <Sparkles className="w-2.5 h-2.5 stroke-[3]" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className={`text-[12px] font-extrabold truncate transition-colors ${isSelected ? 'text-teal-600 dark:text-blue-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
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
          <div className="flex items-center gap-2 text-[8px] text-zinc-400 font-bold uppercase tracking-widest">
            <Calendar className="w-2 h-2 text-teal-600/50" />
            <span className="font-mono">{sermon.date}</span>
            {sermon.time && (
              <React.Fragment>
                <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" />
                <Clock className="w-2 h-2 text-teal-600/50" />
                <span>{sermon.time}</span>
              </React.Fragment>
            )}
            <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" />
            <MapPin className="w-2 h-2 text-teal-600/50" />
            <span className="truncate">{sermon.city}</span>
          </div>
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
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
  const manualContextIds = useAppStore(s => s.manualContextIds);
  const toggleContextSermon = useAppStore(s => s.toggleContextSermon);
  const setManualContextIds = useAppStore(s => s.setManualContextIds);
  
  const searchQuery = useAppStore(s => s.searchQuery);
  const searchMode = useAppStore(s => s.searchMode);
  const setSearchMode = useAppStore(s => s.setSearchMode);
  const isFullTextSearch = useAppStore(s => s.isFullTextSearch);
  const setIsFullTextSearch = useAppStore(s => s.setIsFullTextSearch);
  const isSearching = useAppStore(s => s.isSearching);
  
  const cityFilter = useAppStore(s => s.cityFilter);
  const yearFilter = useAppStore(s => s.yearFilter);
  const monthFilter = useAppStore(s => s.monthFilter);
  const dayFilter = useAppStore(s => s.dayFilter);
  const languageFilter = useAppStore(s => s.languageFilter);
  const versionFilter = useAppStore(s => s.versionFilter);
  const timeFilter = useAppStore(s => s.timeFilter);
  const audioFilter = useAppStore(s => s.audioFilter);
  const setAudioFilter = useAppStore(s => s.setAudioFilter);
  const resetFilters = useAppStore(s => s.resetFilters);
  
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const resetLibrary = useAppStore(s => s.resetLibrary);

  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [showFilters, setShowFilters] = useState(true);
  const [isFooterVisible, setIsFooterVisible] = useState(true);
  
  // --- ÉTAT DE VIRTUALISATION ---
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(800);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

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

  const setSearchQuery = useCallback((q: string) => {
    startTransition(() => {
      useAppStore.getState().setSearchQuery(q);
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    });
  }, []);

  const setCityFilter = useCallback((val: string | null) => startTransition(() => {
    useAppStore.getState().setCityFilter(val);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }), []);

  const setYearFilter = useCallback((val: string | null) => startTransition(() => {
    useAppStore.getState().setYearFilter(val);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }), []);

  const setMonthFilter = useCallback((val: string | null) => startTransition(() => {
    useAppStore.getState().setMonthFilter(val);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }), []);

  const setDayFilter = useCallback((val: string | null) => startTransition(() => {
    useAppStore.getState().setDayFilter(val);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }), []);

  const setVersionFilter = useCallback((val: string | null) => startTransition(() => {
    useAppStore.getState().setVersionFilter(val);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }), []);

  const setTimeFilter = useCallback((val: string | null) => startTransition(() => {
    useAppStore.getState().setTimeFilter(val);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }), []);

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

  const dynamicMonths = useMemo(() => [
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"
  ], []);

  const getMonthName = (month: string) => {
    const namesFR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const namesEN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const idx = parseInt(month, 10) - 1;
    return lang === 'fr' ? namesFR[idx] : namesEN[idx];
  };

  const dynamicDays = useMemo(() => {
    const days = [];
    for (let i = 1; i <= 31; i++) {
      days.push(i.toString().padStart(2, '0'));
    }
    return days;
  }, []);

  const dynamicCities = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) {
        if (sermons[i].city) set.add(sermons[i].city);
    }
    return Array.from(set).sort();
  }, [sermons]);

  const dynamicVersions = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) {
        if (sermons[i].version) set.add(sermons[i].version);
    }
    return Array.from(set).sort();
  }, [sermons]);

  const dynamicTimes = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sermons.length; i++) {
        if (sermons[i].time) set.add(sermons[i].time);
    }
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

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 5);
  const endIndex = Math.min(filteredSermons.length, startIndex + Math.ceil(containerHeight / ITEM_HEIGHT) + 10);
  const visibleSermons = filteredSermons.slice(startIndex, endIndex);

  const totalListHeight = filteredSermons.length * ITEM_HEIGHT;
  const offsetY = startIndex * ITEM_HEIGHT;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInternalQuery(val);
    if (!isFullTextSearch) {
      setSearchQuery(val);
    }
  };

  const triggerSearch = () => {
    setSearchQuery(internalQuery);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      triggerSearch();
    }
  };

  const areAllFilteredSelected = useMemo(() => {
    if (filteredSermons.length === 0) return false;
    return filteredSermons.every(s => manualContextIds.includes(s.id));
  }, [filteredSermons, manualContextIds]);

  const handleToggleAllFiltered = () => {
    if (areAllFilteredSelected) {
      const filteredIds = filteredSermons.map(s => s.id);
      const newManual = manualContextIds.filter(id => !filteredIds.includes(id));
      setManualContextIds(newManual);
    } else {
      const filteredIds = filteredSermons.map(s => s.id);
      const newManual = Array.from(new Set([...manualContextIds, ...filteredIds]));
      setManualContextIds(newManual);
    }
  };

  if (!sidebarOpen) return null;

  return (
    <div className={`w-full border-r border-zinc-200/50 dark:border-zinc-800 bg-white dark:bg-zinc-900 h-full flex flex-col overflow-hidden transition-all duration-500 ${isPending ? 'opacity-70' : ''}`}>
      <div className={`h-14 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center shrink-0 bg-white dark:bg-zinc-900 z-50 transition-all duration-500 px-4 justify-between`}>
        <button 
          onClick={toggleSidebar} 
          className={`flex items-center gap-2 hover:opacity-80 transition-all active:scale-95 min-w-0 group tooltip-br`}
          data-tooltip="Réduire la bibliothèque"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
            <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-3.5 h-3.5 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
          </div>
          <div className="text-left truncate animate-in fade-in slide-in-from-left-2 duration-500">
            <h2 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-950 dark:text-zinc-50 leading-tight truncate group-hover:text-teal-600 transition-colors">
              {t.sidebar_subtitle}
            </h2>
            <p className="text-[7px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest mt-0.5">
              {filteredSermons.length} {filteredSermons.length > 1 ? t.sermon_count : t.sermon_count_one}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 animate-in fade-in duration-500">
          <button 
            onClick={(e) => { e.stopPropagation(); if (confirm("Actualiser la bibliothèque ?")) resetLibrary(); }}
            data-tooltip="Actualiser"
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-all rounded-lg hover:bg-teal-50 dark:hover:bg-teal-900/20 active:scale-95 tooltip-bottom"
          >
            <RefreshCw className={`w-3 h-3 ${isPending ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={toggleSidebar} 
            data-tooltip={t.tooltip_close}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 tooltip-bottom"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-700">
        <div className="p-4 space-y-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/40 transition-colors duration-500">
          <div className="relative group/search-input flex items-center">
            <input
              type="text"
              placeholder={isFullTextSearch ? "Appuyez sur Entrée pour chercher partout..." : t.search_placeholder}
              className={`w-full pl-9 pr-12 py-2.5 bg-white dark:bg-zinc-800 border rounded-xl text-xs font-bold text-zinc-950 dark:text-white focus:outline-none focus:ring-4 transition-all shadow-sm ${
                isFullTextSearch 
                  ? 'border-teal-600 dark:border-teal-500 focus:ring-teal-600/10' 
                  : 'border-zinc-200/60 dark:border-zinc-700/60 focus:border-teal-500 focus:ring-teal-500/10'
              }`}
              value={internalQuery}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
            />
            <Search className={`absolute left-3 w-3.5 h-3.5 transition-all duration-300 ease-out group-hover/search-input:scale-110 group-hover/search-input:rotate-[-10deg] ${isFullTextSearch ? 'text-teal-600' : 'text-zinc-400'}`} />
            
            <div className="absolute right-1.5 flex items-center gap-1">
              {internalQuery && (
                <button 
                  onClick={() => { setInternalQuery(''); setSearchQuery(''); }}
                  data-tooltip="Effacer"
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all animate-in zoom-in-90 tooltip-bottom"
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
                  {isSearching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 transition-all duration-300 ease-out group-hover/search-btn:translate-x-0.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-4">
              <div 
                onClick={() => {
                  const newVal = !isFullTextSearch;
                  setIsFullTextSearch(newVal);
                  if (!newVal) {
                    setSearchQuery(internalQuery);
                  }
                }}
                data-tooltip="Activer/Désactiver la recherche intégrale"
                className="flex items-center gap-2.5 cursor-pointer group/toggle select-none tooltip-right"
              >
                <div className={`relative w-8 h-4.5 rounded-full transition-all duration-500 flex items-center px-0.5 ${isFullTextSearch ? 'bg-teal-600 shadow-lg shadow-teal-600/20' : 'bg-zinc-200 dark:bg-zinc-700 shadow-inner'}`}>
                  <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transition-all duration-500 transform ${isFullTextSearch ? 'translate-x-3.5 scale-100' : 'translate-x-0 scale-90'}`} />
                </div>
                <span className={`text-[9px] font-black uppercase tracking-widest transition-colors duration-500 ${isFullTextSearch ? 'text-teal-600' : 'text-zinc-400 dark:text-zinc-500'}`}>
                  {t.full_text_search}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeFiltersCount > 0 && (
                <button 
                  onClick={resetFilters}
                  data-tooltip={t.reset_filters}
                  className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-red-500 rounded-xl border border-zinc-200 dark:border-zinc-700 transition-all active:scale-90 tooltip-bottom"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button 
                onClick={() => setShowFilters(!showFilters)}
                data-tooltip={showFilters ? "Masquer filtres" : "Afficher filtres"}
                className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border text-[8px] font-black uppercase tracking-widest transition-all duration-300 ease-out tooltip-left group/filter-btn active:scale-95 ${
                  showFilters || activeFiltersCount > 0
                    ? 'bg-teal-600 text-white border-teal-600 shadow-xl shadow-teal-600/20'
                    : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-teal-500/50 hover:bg-teal-50/30 dark:hover:bg-teal-950/20 shadow-sm'
                }`}
              >
                <Filter className={`w-2.5 h-2.5 transition-all duration-300 ease-out group-hover/filter-btn:rotate-[15deg] group-hover/filter-btn:scale-110 ${showFilters ? 'rotate-180' : ''}`} />
                <span>Filtres</span>
                {activeFiltersCount > 0 && (
                  <span className="w-3.5 h-3.5 flex items-center justify-center bg-white text-teal-600 rounded-full text-[7px] animate-in zoom-in duration-300 group-hover/filter-btn:scale-110 font-black">{activeFiltersCount}</span>
                )}
              </button>
            </div>
          </div>

          {isFullTextSearch && (
            <div className="flex items-stretch gap-1 bg-zinc-100/30 dark:bg-zinc-800/30 p-1.5 rounded-xl animate-in slide-in-from-top-1 duration-300 border border-zinc-200/40 dark:border-zinc-700/40 shadow-inner">
              <SearchModeButton mode={SearchMode.EXACT_PHRASE} label={t.search_mode_exact_phrase} tooltip={t.search_mode_exact_phrase} currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.DIVERSE} label={t.search_mode_diverse} tooltip={t.search_mode_diverse} currentMode={searchMode} setMode={setSearchMode} />
              <SearchModeButton mode={SearchMode.EXACT_WORDS} label={t.search_mode_exact_words} tooltip={t.search_mode_exact_words} currentMode={searchMode} setMode={setSearchMode} />
            </div>
          )}

          {showFilters && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-700/50 animate-in slide-in-from-top-1 duration-300">
              <ModernDropdown value={yearFilter} onChange={setYearFilter} options={dynamicYears} placeholder={t.filter_year} />
              <ModernDropdown value={monthFilter} onChange={setMonthFilter} options={dynamicMonths} placeholder={t.filter_month} displayValue={getMonthName} />
              <ModernDropdown value={dayFilter} onChange={setDayFilter} options={dynamicDays} placeholder={t.filter_day} />
              <ModernDropdown value={cityFilter} onChange={setCityFilter} options={dynamicCities} placeholder={t.filter_city} />
              <ModernDropdown value={versionFilter} onChange={setVersionFilter} options={dynamicVersions} placeholder={t.filter_version} />
              <ModernDropdown value={timeFilter} onChange={setTimeFilter} options={dynamicTimes} placeholder={t.filter_time} />
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center gap-3 bg-white dark:bg-zinc-900 z-40">
          <button 
            onClick={handleToggleAllFiltered}
            data-tooltip={areAllFilteredSelected ? "Tout retirer du contexte IA" : "Tout ajouter au contexte IA (filtrés)"}
            className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all active:scale-90 group/context-all tooltip-right shrink-0 ${
              areAllFilteredSelected 
                ? 'bg-teal-600 text-white border-teal-600 shadow-lg shadow-teal-600/20' 
                : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-teal-600/50 hover:bg-teal-50 dark:hover:bg-teal-900/10'
            }`}
          >
            <Sparkles className={`w-4 h-4 transition-transform duration-500 ${areAllFilteredSelected ? 'scale-110 rotate-12' : 'opacity-60 group-hover/context-all:opacity-100 group-hover/context-all:scale-110'}`} />
          </button>

          <div 
            onClick={() => setAudioFilter(!audioFilter)}
            data-tooltip="Sermons avec audio uniquement"
            className="flex items-center gap-2.5 cursor-pointer group/audio-toggle select-none tooltip-bottom"
          >
            <div className={`relative w-8 h-4.5 rounded-full transition-all duration-500 flex items-center px-0.5 ${audioFilter ? 'bg-amber-500 shadow-lg shadow-amber-500/20' : 'bg-zinc-200 dark:bg-zinc-700 shadow-inner'}`}>
              <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transition-all duration-500 transform ${audioFilter ? 'translate-x-3.5 scale-100' : 'translate-x-0 scale-90'}`} />
            </div>
            <Headphones className={`w-3 h-3 transition-colors ${audioFilter ? 'text-amber-500' : 'text-zinc-400'}`} />
          </div>
        </div>

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto custom-scrollbar relative"
        >
          {filteredSermons.length === 0 ? (
            <div className="p-12 text-center text-zinc-400 text-[10px] font-black uppercase tracking-[0.3em] opacity-30">
              {t.no_results}
            </div>
          ) : (
            <div style={{ height: totalListHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
                {visibleSermons.map((sermon, idx) => (
                  <SermonItem 
                    key={`${sermon.id}-${startIndex + idx}`}
                    sermon={sermon}
                    isSelected={selectedSermonId === sermon.id}
                    isContextSelected={manualContextIds.includes(sermon.id)}
                    onSelect={() => setSelectedSermonId(sermon.id)}
                    onToggleContext={() => toggleContextSermon(sermon.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className={`border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/40 dark:bg-zinc-950/40 no-print group/footer transition-all duration-500 shrink-0 relative ${isFooterVisible ? 'py-6 px-4' : 'py-2 px-4'}`}>
          <button 
            onClick={() => setIsFooterVisible(!isFooterVisible)}
            className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 flex items-center justify-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full text-zinc-400 hover:text-teal-600 shadow-sm transition-all z-[60] active:scale-90"
            data-tooltip={isFooterVisible ? "Masquer les détails" : "Afficher les détails"}
          >
            {isFooterVisible ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {isFooterVisible ? (
            <div className="text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex flex-col items-center mb-3 gap-1">
                <p className="text-[10px] font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-[0.25em]">
                  KING'S SWORD <span className="text-teal-600 dark:text-blue-400 ml-1">v{process.env.APP_VERSION}</span>
                </p>
                <div className="h-0.5 w-8 bg-teal-600/20 dark:bg-blue-400/20 rounded-full" />
                <p className="text-[8px] font-black text-teal-600 uppercase tracking-widest mt-0.5">
                  VISION DE L'AIGLE TABERNACLE
                </p>
              </div>
              
              <div className="pt-1.5 border-t border-zinc-200/30 dark:border-zinc-800/30 opacity-40 group-hover/footer:opacity-100 transition-all duration-500 space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-[7px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                  <MapPin className="w-1.5 h-1.5 text-teal-600" />
                  <span>Koufoli, PNR, Congo</span>
                </div>
                <p className="text-[7px] font-black text-zinc-800 dark:text-zinc-100 uppercase tracking-[0.3em] text-center leading-none">
                  © 2024 Bienvenu Sédin MASSAMBA
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4 animate-in fade-in duration-500">
               <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">KS v{process.env.APP_VERSION}</span>
               </div>
               <div className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
               <div className="flex items-center gap-1.5">
                  <Info className="w-2.5 h-2.5 text-teal-600 opacity-40" />
                  <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Vision de l'Aigle</span>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
