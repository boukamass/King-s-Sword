
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
  Info
} from 'lucide-react';

// Composant d'élément de liste ultra-performant
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
}) => (
  <div 
    className={`group flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer mb-1 border-l-4 ${
      isSelected 
        ? 'bg-teal-600/5 dark:bg-teal-600/10 border-teal-600 shadow-sm' 
        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40 border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
    }`}
    onClick={onSelect}
  >
    <div 
      onClick={(e) => { e.stopPropagation(); onToggleContext(); }}
      className={`w-4 h-4 rounded-md border transition-all flex items-center justify-center shrink-0 ${
        isContextSelected 
          ? 'bg-teal-600 border-teal-600 text-white' 
          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700'
      }`}
    >
      {isContextSelected && <Sparkles className="w-2.5 h-2.5" />}
    </div>

    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className={`text-[12px] font-extrabold truncate ${isSelected ? 'text-teal-600' : 'text-zinc-900 dark:text-zinc-100'}`}>
          {sermon.title}
        </span>
        <span className="text-[7px] font-black bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 uppercase">
          {sermon.version || 'VGR'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[8px] text-zinc-400 font-bold uppercase tracking-widest">
        <span className="font-mono">{sermon.date}</span>
        <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
        <span className="truncate">{sermon.city}</span>
      </div>
    </div>
  </div>
));

const Sidebar: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const { 
    sermons, 
    selectedSermonId, 
    setSelectedSermonId, 
    contextSermonIds, 
    toggleContextSermon, 
    searchQuery, 
    setSearchQuery, 
    isFullTextSearch, 
    setIsFullTextSearch, 
    isSearching, 
    sidebarOpen, 
    toggleSidebar, 
    resetLibrary,
    cityFilter,
    yearFilter,
    versionFilter,
    timeFilter,
    setCityFilter,
    setYearFilter,
    setVersionFilter,
    setTimeFilter,
    languageFilter
  } = useAppStore();

  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [displayLimit, setDisplayLimit] = useState(40);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const t = translations[languageFilter === 'Anglais' ? 'en' : 'fr'];

  // Filtrage ultra-rapide avec mémorisation
  const filteredSermons = useMemo(() => {
    const q = isFullTextSearch ? "" : normalizeText(deferredSearchQuery);
    if (!q && !cityFilter && !yearFilter && !versionFilter && !timeFilter) return sermons;

    return sermons.filter(s => {
      if (q && !normalizeText(s.title).includes(q)) return false;
      if (cityFilter && s.city !== cityFilter) return false;
      if (yearFilter && !s.date.startsWith(yearFilter)) return false;
      if (versionFilter && s.version !== versionFilter) return false;
      if (timeFilter && s.time !== timeFilter) return false;
      return true;
    });
  }, [sermons, deferredSearchQuery, cityFilter, yearFilter, versionFilter, timeFilter, isFullTextSearch]);

  const visibleSermons = useMemo(() => filteredSermons.slice(0, displayLimit), [filteredSermons, displayLimit]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInternalQuery(val);
    startTransition(() => {
      if (!isFullTextSearch) setSearchQuery(val);
      setDisplayLimit(40);
    });
  };

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      if (displayLimit < filteredSermons.length) setDisplayLimit(p => p + 40);
    }
  }, [displayLimit, filteredSermons.length]);

  if (!sidebarOpen) return null;

  return (
    <div className="w-full h-full border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
      <div className="h-14 px-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        <div className="flex flex-col">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-900 dark:text-zinc-100">{t.sidebar_subtitle}</h2>
          <p className="text-[7px] font-black text-teal-600 uppercase mt-0.5">{filteredSermons.length} sermons</p>
        </div>
        <button onClick={toggleSidebar} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-4 space-y-3 border-b border-zinc-50 dark:border-zinc-800/50 bg-zinc-50/20 dark:bg-zinc-900/20">
        <div className="relative group">
          <input
            type="text"
            placeholder={t.search_placeholder}
            value={internalQuery}
            onChange={handleInputChange}
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold focus:ring-4 focus:ring-teal-600/5 outline-none transition-all"
          />
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400 group-focus-within:text-teal-600" />
        </div>
        
        <div className="flex items-center gap-2">
            <div 
              onClick={() => setIsFullTextSearch(!isFullTextSearch)}
              className="flex items-center gap-2 cursor-pointer select-none flex-1"
            >
              <div className={`w-8 h-4.5 rounded-full transition-all flex items-center px-0.5 ${isFullTextSearch ? 'bg-teal-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                <div className={`w-3.5 h-3.5 bg-white rounded-full transition-all transform ${isFullTextSearch ? 'translate-x-3.5' : 'translate-x-0'}`} />
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest ${isFullTextSearch ? 'text-teal-600' : 'text-zinc-400'}`}>{t.full_text_search}</span>
            </div>
            {isFullTextSearch && (
              <button 
                onClick={() => setSearchQuery(internalQuery)} 
                className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-[9px] font-black uppercase shadow-lg shadow-teal-600/20"
              >
                Chercher
              </button>
            )}
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto custom-scrollbar p-3"
      >
        {visibleSermons.map(s => (
          <SermonItem 
            key={s.id}
            sermon={s}
            isSelected={selectedSermonId === s.id}
            isContextSelected={contextSermonIds.includes(s.id)}
            onSelect={() => setSelectedSermonId(s.id)}
            onToggleContext={() => toggleContextSermon(s.id)}
          />
        ))}
        {isPending && (
          <div className="py-4 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600/50" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
