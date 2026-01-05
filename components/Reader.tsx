
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
  MonitorUp,
  Presentation
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

const WordComponent = memo(({ word, isSearchResult, isCurrentResult, citationColor, highlight, onRemoveHighlight, wordRef, onMouseUp }: any) => {
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
  
  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);
  const languageFilter = useAppStore(s => s.languageFilter);
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const sermon = activeSermon;
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number | null>(null);

  const [localFontSize, setLocalFontSize] = useState<string | number>(fontSize);
  useEffect(() => setLocalFontSize(fontSize), [fontSize]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
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

  const projectSlide = useCallback((text: string, index: number) => {
    setActiveSlideIndex(index);
    if (broadcastChannel.current) {
      broadcastChannel.current.postMessage({
        type: 'sync',
        title: sermon?.title,
        date: sermon?.date,
        city: sermon?.city,
        text: text, 
        fontSize: fontSize,
        blackout: isExternalMaskOpen,
        theme: theme,
        highlights: sermon?.highlights || [],
        isSlideMode: true 
      });
    }
  }, [sermon, fontSize, isExternalMaskOpen, theme]);

  const toggleExternalProjection = () => {
    if (isExternalProjectionOpen && (externalProjectionWindow || true)) {
      if (externalProjectionWindow) externalProjectionWindow.close();
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
    if (isExternalMaskOpen && (externalMaskWindow || true)) {
      if (externalMaskWindow) externalMaskWindow.close();
      externalMaskWindow = null;
      setExternalMaskOpen(false);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set('mask', 'true');
      externalMaskWindow = window.open(url.toString(), 'KingsSwordMask');
      if (externalMaskWindow) setExternalMaskOpen(true);
    }
  };

  if (!selectedSermonId) return (
    <div className="flex-1 flex flex-col h-full items-center justify-center p-12 text-center bg-white dark:bg-zinc-950">
      <div className="w-24 h-24 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-[32px] border border-zinc-100 dark:border-zinc-800 mb-8">
        <MonitorUp className="w-10 h-10 text-zinc-300" />
      </div>
      <p className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-400">Sélectionnez un sermon</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full relative bg-white dark:bg-zinc-950 transition-colors duration-200">
      <div className="px-4 md:px-8 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print transition-all duration-300">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex flex-col min-w-0 flex-1">
            <h1 className="text-[16px] font-extrabold text-zinc-900 dark:text-zinc-50 truncate tracking-tight leading-tight">{sermon?.title}</h1>
            <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-400 uppercase tracking-wider leading-none mt-1">
              <Calendar className="w-2.5 h-2.5 text-teal-600" /><span>{sermon?.date}</span>
              <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-1" />
              <MapPin className="w-2.5 h-2.5 text-teal-600" /><span>{sermon?.city}</span>
            </div>
          </div>
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
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => window.print()} icon={Printer} tooltip={t.print} />
            <ActionButton onClick={() => setIsSearchVisible(!isSearchVisible)} icon={Search} tooltip={t.reader_search_tooltip} active={isSearchVisible} />
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            
            <div className="flex items-center bg-white/50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm overflow-hidden no-print">
              <button onClick={() => setFontSize(fontSize - 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 border-r border-zinc-200/50 dark:border-zinc-800/50 active:scale-95"><ZoomOut className="w-4 h-4" /></button>
              <input type="text" value={localFontSize} onChange={e => /^\d*$/.test(e.target.value) && setLocalFontSize(e.target.value)} onBlur={() => { const v = parseInt(String(localFontSize), 10); if(!isNaN(v)) setFontSize(v); else setLocalFontSize(fontSize); }} className="w-12 h-9 bg-transparent text-center text-[11px] font-black text-zinc-600 dark:text-zinc-300 outline-none focus:text-teal-600" />
              <button onClick={() => setFontSize(fontSize + 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 border-l border-zinc-200/50 dark:border-zinc-800/50 active:scale-95"><ZoomIn className="w-4 h-4" /></button>
            </div>
            
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} icon={theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor} tooltip="Changer Thème" active={theme !== 'system'} />
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden flex justify-center">
        <div 
          ref={scrollContainerRef} 
          className="absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all duration-300 py-16 px-6 sm:px-12 lg:px-20 xl:px-28"
        >
          <div className="w-full mx-auto whitespace-pre-wrap text-justify pb-64" style={{ fontSize: `${fontSize}px` }}>
            {segments.map((seg, sIdx) => {
              const segTrim = seg.trim();
              const startsWithNumber = /^\d+/.test(segTrim);
              
              if (startsWithNumber) {
                return (
                  <div 
                    key={sIdx} 
                    onClick={() => projectSlide(segTrim, sIdx)}
                    className={`relative p-1 -mx-4 my-[0.5px] rounded-[10px] cursor-pointer transition-all duration-300 group/slide border-l-4 ${
                      activeSlideIndex === sIdx 
                        ? 'bg-teal-600/10 dark:bg-teal-600/20 border-teal-600' 
                        : 'bg-transparent border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="absolute -left-10 top-1.5 opacity-0 group-hover/slide:opacity-100 transition-opacity">
                      <Presentation className={`w-3.5 h-3.5 ${activeSlideIndex === sIdx ? 'text-teal-600' : 'text-zinc-400'}`} />
                    </div>
                    {words.filter(w => w.segmentIndex === sIdx).map(word => (
                      <WordComponent 
                        key={word.globalIndex} 
                        word={word} 
                        wordRef={(el: any) => el && wordRefs.current.set(word.globalIndex, el)} 
                        isSearchResult={searchResults.includes(word.globalIndex)} 
                        isCurrentResult={searchResults[currentResultIndex] === word.globalIndex} 
                      />
                    ))}
                  </div>
                );
              }
              
              return (
                <div key={sIdx} className="my-[0.5px]">
                  {words.filter(w => w.segmentIndex === sIdx).map(word => (
                    <WordComponent 
                      key={word.globalIndex} 
                      word={word} 
                      wordRef={(el: any) => el && wordRefs.current.set(word.globalIndex, el)} 
                      isSearchResult={searchResults.includes(word.globalIndex)} 
                      isCurrentResult={searchResults[currentResultIndex] === word.globalIndex} 
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reader;
