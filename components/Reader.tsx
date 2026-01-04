
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
  Library,
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
  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
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
  const triggerStudyRequest = useAppStore(s => s.triggerStudyRequest);
  const updateSermonHighlights = useAppStore(s => s.updateSermonHighlights);
  const navigatedFromSearch = useAppStore(s => s.navigatedFromSearch);
  const setNavigatedFromSearch = useAppStore(s => s.setNavigatedFromSearch);
  const lastSearchQuery = useAppStore(s => s.lastSearchQuery);
  const lastSearchMode = useAppStore(s => s.lastSearchMode);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setIsFullTextSearch = useAppStore(s => s.setIsFullTextSearch);
  const addNotification = useAppStore(s => s.addNotification);
  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);
  const jumpToText = useAppStore(s => s.jumpToText);
  const setJumpToText = useAppStore(s => s.setJumpToText);
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const sermon = activeSermon;
  const [selection, setSelection] = useState<{ text: string; x: number; y: number; isTop: boolean } | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchOriginMatchIndices, setSearchOriginMatchIndices] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon } | null>(null);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);
  const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
  const [isDefining, setIsDefining] = useState(false);

  const readerAreaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const playPromiseRef = useRef<Promise<void> | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');
    const checkStatus = setInterval(() => {
      if (externalProjectionWindow?.closed) {
        setExternalProjectionOpen(false);
        externalProjectionWindow = null;
      }
      if (externalMaskWindow?.closed) {
        setExternalMaskOpen(false);
        externalMaskWindow = null;
      }
    }, 1000);
    const handleFs = () => setIsOSFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFs);
    return () => {
      broadcastChannel.current?.close();
      clearInterval(checkStatus);
      document.removeEventListener('fullscreenchange', handleFs);
    };
  }, [setExternalProjectionOpen, setExternalMaskOpen]);

  // Synchronisation des données vers le second écran
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
      externalProjectionWindow = null;
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
      externalMaskWindow = null;
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

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 1 && readerAreaRef.current) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const readerRect = readerAreaRef.current.getBoundingClientRect();
      setSelection({ 
        text: sel.toString().trim(), 
        x: (rect.left + rect.width / 2) - readerRect.left, 
        y: rect.top - readerRect.top,
        isTop: rect.top < 150 
      });
    } else setSelection(null);
  }, []);

  const handleHighlight = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sermon || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const startNode = range.startContainer.parentElement?.closest('[data-global-index]');
    const endNode = range.endContainer.parentElement?.closest('[data-global-index]');
    if (startNode && endNode) {
      const start = parseInt(startNode.getAttribute('data-global-index') || '0');
      const end = parseInt(endNode.getAttribute('data-global-index') || '0');
      const newH: Highlight = { id: crypto.randomUUID(), start: Math.min(start, end), end: Math.max(start, end) };
      updateSermonHighlights(sermon.id, [...(sermon.highlights || []), newH]);
      addNotification("Surlignage ajouté", "success");
    }
  }, [sermon, updateSermonHighlights, addNotification]);

  const handleDefine = async () => {
    if (!selection) return;
    const word = selection.text.split(' ')[0].replace(/[.,;?!]/g, "");
    setIsDefining(true);
    setSelection(null);
    try {
      const def = await getDefinition(word);
      setActiveDefinition(def);
    } catch (err: any) {
      addNotification("Erreur de définition", "error");
    } finally { setIsDefining(false); }
  };

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    sermon?.highlights?.forEach(h => { for (let i = h.start; i <= h.end; i++) map.set(i, h); });
    return map;
  }, [sermon?.highlights]);

  return (
    <div ref={readerAreaRef} className="flex-1 flex flex-col h-full relative bg-white dark:bg-zinc-950 transition-colors duration-200 overflow-visible-important">
      {noteSelectorPayload && <NoteSelectorModal selectionText={noteSelectorPayload.text} sermon={noteSelectorPayload.sermon} onClose={() => setNoteSelectorPayload(null)} />}
      
      {(activeDefinition || isDefining) && (
        <div className="fixed inset-0 z-[100000] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setActiveDefinition(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 relative max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="px-8 pt-6 pb-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-[18px] border border-teal-600/20 shadow-sm"><BookOpenCheck className="w-5 h-5" /></div>
                <h3 className="text-[17px] font-extrabold text-zinc-900 dark:text-white">{isDefining ? "Chargement..." : activeDefinition?.word}</h3>
              </div>
              <button onClick={() => setActiveDefinition(null)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-white dark:bg-zinc-800 rounded-xl transition-all border border-zinc-200 dark:border-zinc-700 shadow-sm"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 px-8 py-6 overflow-y-auto custom-scrollbar">
              {isDefining ? <div className="py-20 flex justify-center"><Loader2 className="w-10 h-10 animate-spin text-teal-600" /></div> : activeDefinition && (
                <div className="space-y-6">
                  <div className="p-4 bg-teal-600/5 border border-teal-600/10 rounded-[20px] shadow-sm italic serif-text">{activeDefinition.definition}</div>
                  <div className="grid grid-cols-2 gap-4">
                    {activeDefinition.etymology && <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl text-xs">{activeDefinition.etymology}</div>}
                    {activeDefinition.synonyms?.length > 0 && <div className="flex flex-wrap gap-1">{activeDefinition.synonyms.map(s => <span key={s} className="px-2 py-1 bg-amber-600/10 text-amber-700 dark:text-amber-400 text-[10px] rounded-lg">{s}</span>)}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 md:px-8 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print transition-all duration-300">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          {(!sidebarOpen || isOSFullscreen) && <button onClick={toggleSidebar} className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm"><img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-4 h-4" /></button>}
          <h1 className="text-[16px] font-extrabold text-zinc-900 dark:text-zinc-50 truncate tracking-tight">{sermon?.title}</h1>
        </div>
        
        <div className="flex items-center gap-2 shrink-0 ml-4 overflow-visible-important">
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
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => window.print()} icon={Printer} tooltip={t.print} />
            <ActionButton onClick={() => setIsSearchVisible(!isSearchVisible)} icon={Search} tooltip={t.reader_search_tooltip} active={isSearchVisible} />
            <ActionButton onClick={handleFullscreenToggle} icon={isOSFullscreen ? Minimize : Maximize} tooltip={isOSFullscreen ? "Sortir du plein écran" : "Plein écran"} special={isOSFullscreen} />
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden flex justify-center">
        <div 
          onScroll={handleScroll} 
          ref={scrollContainerRef} 
          onMouseUp={handleTextSelection} 
          className="absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all duration-300 py-16 px-6 sm:px-12 lg:px-20 xl:px-28"
        >
          <div className="w-full mx-auto printable-content whitespace-pre-wrap text-justify pb-64" style={{ fontSize: `${fontSize}px` }}>
            {words.map((word) => (
              <WordComponent 
                key={word.globalIndex} 
                word={word} 
                wordRef={(el: any) => { if(el) wordRefs.current.set(word.globalIndex, el); }} 
                isSearchResult={searchResults.includes(word.globalIndex)} 
                isCurrentResult={searchResults[currentResultIndex] === word.globalIndex} 
                highlight={highlightMap.get(word.globalIndex)}
                onRemoveHighlight={(id: string) => updateSermonHighlights(sermon!.id, sermon!.highlights!.filter(h => h.id !== id))}
                onMouseUp={handleTextSelection}
              />
            ))}
          </div>
        </div>
      </div>

      {selection && (
        <div className="absolute z-[200000] pointer-events-none animate-in fade-in zoom-in-95 no-print" style={{ left: selection.x, top: selection.isTop ? selection.y + 40 : selection.y - 75, transform: 'translateX(-50%)' }}>
          <div className="flex items-center gap-0.5 bg-white/98 dark:bg-zinc-900/98 backdrop-blur-3xl p-1.5 rounded-[24px] shadow-2xl pointer-events-auto border border-zinc-200/50 dark:border-zinc-800/50">
            <button onClick={handleHighlight} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-amber-500/10 text-zinc-600 dark:text-zinc-400 rounded-[18px] transition-all"><Highlighter className="w-4 h-4 text-amber-500/60" /><span className="text-[7.5px] font-black uppercase tracking-widest">Surligner</span></button>
            <button onClick={handleDefine} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-teal-600/10 text-zinc-600 dark:text-zinc-400 rounded-[18px] transition-all"><BookOpen className="w-4 h-4 text-teal-500/60" /><span className="text-[7.5px] font-black uppercase tracking-widest">Définir</span></button>
            <button onClick={() => triggerStudyRequest(selection.text)} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-teal-600/10 text-zinc-600 dark:text-zinc-400 rounded-[18px] transition-all"><Sparkles className="w-4 h-4 text-teal-600/60" /><span className="text-[7.5px] font-black uppercase tracking-widest">Étudier</span></button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reader;
