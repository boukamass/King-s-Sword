
import React, { useState, useEffect, useRef, useMemo, useCallback, memo, useTransition } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { getDefinition, WordDefinition } from '../services/dictionaryService';
import { normalizeText } from '../utils/textUtils';
import { Sermon, Highlight, SearchMode } from '../types';
import { PALETTE_HIGHLIGHT_COLORS } from '../constants';
import NoteSelectorModal from './NoteSelectorModal';
import { 
  Printer, 
  Search, 
  Maximize, 
  Minimize, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronUp,
  ChevronDown,
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Highlighter, 
  Sparkles, 
  NotebookPen, 
  X, 
  Headphones, 
  Copy, 
  Sun, 
  Moon, 
  Monitor, 
  Eye, 
  EyeOff, 
  Volume2, 
  VolumeX, 
  Download, 
  BookOpen,
  Loader2,
  BookOpenCheck,
  Quote,
  MapPin,
  Calendar,
  Feather,
  Milestone,
  MonitorUp
} from 'lucide-react';

interface SimpleWord {
  text: string;
  segmentIndex: number;
  globalIndex: number;
}

const ActionButton = memo(({ onClick, icon: Icon, tooltip, special = false, active = false }: any) => (
  <div className="relative group/btn">
    <button 
      onClick={onClick} 
      data-tooltip={tooltip} 
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all border active:scale-95 shadow-sm ${
        special 
          ? "bg-teal-600/10 text-teal-600 border-teal-600/20" 
          : active 
            ? "bg-teal-600 text-white border-teal-600" 
            : "bg-white/50 dark:bg-zinc-800/50 border-zinc-200/50 dark:border-zinc-800/50 hover:bg-teal-600/5 hover:text-teal-600 hover:border-teal-600/20 text-zinc-400 dark:text-zinc-500"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  </div>
));

const WordComponent = memo(({ word, isSearchResult, isCurrentResult, isSearchOriginMatch, citationColor, highlight, onRemoveHighlight, wordRef, onMouseUp }: any) => {
  const content = (
    <span 
      ref={wordRef}
      data-global-index={word.globalIndex}
      onMouseUp={onMouseUp}
      className={`rounded-sm transition-colors duration-150 ${citationColor || ''} ${
        isCurrentResult 
          ? 'bg-teal-600 shadow-[0_0_8px_rgba(13,148,136,0.4)] text-white' 
          : isSearchResult 
            ? 'bg-teal-600/15 ring-1 ring-teal-600/20' 
            : isSearchOriginMatch
              ? 'bg-amber-600/30 text-amber-900 dark:text-amber-300 ring-1 ring-amber-500/40 font-bold shadow-[0_0_5px_rgba(245,158,11,0.2)]'
              : ''
      }`}
    >
      {word.text}
    </span>
  );

  if (highlight) {
    return (
      <span 
        onClick={(e) => { e.stopPropagation(); onRemoveHighlight(highlight.id); }}
        className="bg-yellow-400/60 dark:bg-yellow-300/50 border-b border-yellow-500/30 dark:border-yellow-400/40 rounded-sm cursor-pointer hover:bg-yellow-400/70 dark:hover:bg-yellow-300/60 transition-all"
      >
        {content}
      </span>
    );
  }

  return content;
});

let externalProjectionWindow: Window | null = null;
let externalMaskWindow: Window | null = null;

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const activeSermon = useAppStore(s => s.activeSermon);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  const notes = useAppStore(s => s.notes);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const isExternalProjectionOpen = useAppStore(s => s.isExternalProjectionOpen);
  const setExternalProjectionOpen = useAppStore(s => s.setExternalProjectionOpen);
  const isExternalMaskOpen = useAppStore(s => s.isExternalMaskOpen);
  const setExternalMaskOpen = useAppStore(s => s.setExternalMaskOpen);
  const fontSize = useAppStore(s => s.fontSize);
  const setFontSize = useCallback((size: number) => {
    startTransition(() => {
      const safeSize = Math.max(8, Math.min(150, size));
      useAppStore.getState().setFontSize(safeSize);
    });
  }, []);
  
  const languageFilter = useAppStore(s => s.languageFilter);
  const updateSermonHighlights = useAppStore(s => s.updateSermonHighlights);
  const navigatedFromSearch = useAppStore(s => s.navigatedFromSearch);
  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);
  const jumpToText = useAppStore(s => s.jumpToText);
  const setJumpToText = useAppStore(s => s.setJumpToText);
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const sermon = activeSermon;
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchOriginMatchIndices, setSearchOriginMatchIndices] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');
    const checkStatus = setInterval(() => {
      if (externalProjectionWindow?.closed) setExternalProjectionOpen(false);
      if (externalMaskWindow?.closed) setExternalMaskOpen(false);
    }, 1000);
    return () => {
      broadcastChannel.current?.close();
      clearInterval(checkStatus);
    };
  }, [setExternalProjectionOpen, setExternalMaskOpen]);

  // Sync totale des données
  useEffect(() => {
    if (broadcastChannel.current && sermon) {
      broadcastChannel.current.postMessage({
        type: 'sync',
        title: sermon.title,
        date: sermon.date,
        city: sermon.city,
        text: sermon.text,
        fontSize: fontSize,
        blackout: isExternalMaskOpen,
        theme: theme,
        highlights: sermon.highlights || [],
        searchResults,
        currentResultIndex,
        activeDefinition
      });
    }
  }, [sermon, fontSize, isExternalMaskOpen, theme, searchResults, currentResultIndex, activeDefinition]);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && broadcastChannel.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const scrollPercent = scrollTop / (scrollHeight - clientHeight);
      broadcastChannel.current.postMessage({ type: 'scroll', scrollPercent });
    }
  }, []);

  const toggleExternalProjection = () => {
    if (isExternalProjectionOpen && externalProjectionWindow) {
      externalProjectionWindow.close();
      setExternalProjectionOpen(false);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set('projection', 'true');
      externalProjectionWindow = window.open(url.toString(), 'KingsSwordProjection');
      if (externalProjectionWindow) setExternalProjectionOpen(true);
    }
  };

  const toggleExternalMask = () => {
    if (isExternalMaskOpen && externalMaskWindow) {
      externalMaskWindow.close();
      setExternalMaskOpen(false);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set('mask', 'true');
      externalMaskWindow = window.open(url.toString(), 'KingsSwordMask');
      if (externalMaskWindow) setExternalMaskOpen(true);
    }
  };

  const segments = useMemo(() => sermon?.text.split(/(\n\s*\n)/) || [], [sermon?.id]);
  const words: SimpleWord[] = useMemo(() => {
    const all: SimpleWord[] = [];
    let idx = 0;
    segments.forEach((seg, sIdx) => {
      seg.split(/(\s+)/).forEach(token => {
        if (token !== "") all.push({ text: token, segmentIndex: sIdx, globalIndex: idx++ });
      });
    });
    return all;
  }, [segments]);

  return (
    <div className="flex-1 flex flex-col h-full relative bg-white dark:bg-zinc-950 transition-colors duration-200">
      <div className="px-4 md:px-8 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <h1 className="text-[16px] font-extrabold text-zinc-900 dark:text-zinc-50 truncate tracking-tight">{sermon?.title}</h1>
        </div>
        
        <div className="flex items-center gap-2 shrink-0 ml-4">
            <ActionButton 
              onClick={toggleExternalProjection} 
              icon={MonitorUp} 
              tooltip={isExternalProjectionOpen ? "Arrêter la projection" : "Lancer la projection"} 
              active={isExternalProjectionOpen} 
              special={isExternalProjectionOpen} 
            />
            <ActionButton 
              onClick={toggleExternalMask} 
              icon={isExternalMaskOpen ? Eye : EyeOff} 
              tooltip={isExternalMaskOpen ? "Retirer le masque" : "Masquer l'écran secondaire"} 
              active={isExternalMaskOpen} 
              special={isExternalMaskOpen} 
            />
            <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} icon={theme === 'light' ? Sun : Moon} tooltip="Changer Thème" active={theme !== 'system'} />
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden flex justify-center">
        <div 
          onScroll={handleScroll} 
          ref={scrollContainerRef} 
          className="absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 py-16 px-6 sm:px-12 lg:px-20 xl:px-28"
        >
          <div className="w-full mx-auto whitespace-pre-wrap text-justify pb-64" style={{ fontSize: `${fontSize}px` }}>
            {words.map((word) => (
              <WordComponent 
                key={word.globalIndex} 
                word={word} 
                wordRef={(el: any) => { if(el) wordRefs.current.set(word.globalIndex, el); }} 
                isSearchResult={searchResults.includes(word.globalIndex)} 
                isCurrentResult={searchResults[currentResultIndex] === word.globalIndex} 
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reader;
