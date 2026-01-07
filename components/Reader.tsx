
import React, { useState, useEffect, useRef, useMemo, useCallback, memo, useTransition } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { getDefinition, WordDefinition } from '../services/dictionaryService';
import { normalizeText, getAccentInsensitiveRegex } from '../utils/textUtils';
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
  MonitorPlay
} from 'lucide-react';

// Composant pour un paragraphe hautement optimisé
const ParagraphComponent = memo(({ 
  seg, 
  segIdx, 
  isActiveProjection, 
  onProject, 
  onNote, 
  fontSize,
  searchHits,
  highlights,
  citationHits,
  originHits,
  onRemoveHighlight,
  onMouseUp
}: any) => {
  
  // Cette fonction reconstruit le paragraphe en injectant des spans uniquement là où c'est nécessaire
  const renderContent = () => {
    if (!seg.words.length) return null;
    
    // Si aucune interaction spéciale sur ce paragraphe, on rend du texte brut (Très rapide)
    const hasInterests = seg.words.some((w: any) => 
      searchHits.has(w.globalIndex) || 
      highlights.has(w.globalIndex) || 
      citationHits.has(w.globalIndex) || 
      originHits.has(w.globalIndex)
    );

    if (!hasInterests) {
      return seg.text;
    }

    return seg.words.map((word: any) => {
      const isSearch = searchHits.has(word.globalIndex);
      const isOrigin = originHits.has(word.globalIndex);
      const h = highlights.get(word.globalIndex);
      const cit = citationHits.get(word.globalIndex);

      let className = "rounded-sm transition-colors duration-150 ";
      if (isSearch) className += "bg-teal-600/20 ring-1 ring-teal-600/30 ";
      if (isOrigin) className += "bg-amber-600/30 text-amber-900 dark:text-amber-300 ring-1 ring-amber-500/40 font-bold ";
      if (cit) className += cit.colorClass + " ";
      
      const content = (
        <span 
          key={word.globalIndex}
          data-global-index={word.globalIndex}
          className={className}
        >
          {word.text}
        </span>
      );

      if (h) {
        return (
          <span 
            key={`h-${word.globalIndex}`}
            onClick={(e) => { e.stopPropagation(); onRemoveHighlight(h.id); }}
            className="bg-yellow-400/60 dark:bg-yellow-300/50 border-b border-yellow-500/30 cursor-pointer hover:bg-yellow-400/80 transition-all"
          >
            {content}
          </span>
        );
      }

      return content;
    });
  };

  return (
    <div 
      onClick={() => onProject(segIdx)}
      className={`group/seg relative mb-2 py-3 px-6 rounded-[24px] border-l-[4px] transition-all duration-300 cursor-pointer ${
        isActiveProjection 
          ? 'bg-teal-600/10 border-teal-600 shadow-md ring-2 ring-teal-600/10' 
          : 'bg-white dark:bg-zinc-900/40 border-transparent hover:border-teal-600/30 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
      }`}
    >
      <div className="absolute -left-[54px] top-4 opacity-0 group-hover/seg:opacity-100 transition-all translate-x-4 group-hover/seg:translate-x-0 no-print flex flex-col gap-2 z-50">
          <button 
            onClick={(e) => { e.stopPropagation(); onProject(segIdx); }}
            className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-xl shadow-lg hover:scale-110 active:scale-95 transition-all"
          >
            <MonitorPlay className="w-4 h-4" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onNote(seg.text.trim()); }}
            className="w-9 h-9 flex items-center justify-center bg-emerald-600 text-white rounded-xl shadow-lg hover:scale-110 active:scale-95 transition-all"
          >
            <NotebookPen className="w-4 h-4" />
          </button>
      </div>
      <div onMouseUp={onMouseUp} className="serif-text">
        {renderContent()}
      </div>
    </div>
  );
});

const ActionButton = memo(({ onClick, icon: Icon, tooltip, special = false, active = false }: any) => (
  <button 
    onClick={onClick} 
    data-tooltip={tooltip} 
    className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all border active:scale-95 shadow-sm shrink-0 ${
      special 
        ? "bg-teal-600/10 text-teal-600 border-teal-600/20" 
        : active 
          ? "bg-teal-600 text-white border-teal-600" 
          : "bg-white/50 dark:bg-zinc-800/50 border-zinc-200/50 dark:border-zinc-800/50 hover:bg-teal-600/5 hover:text-teal-600 hover:border-teal-600/20 text-zinc-400 dark:text-zinc-500"
    }`}
  >
    <Icon className="w-4 h-4" />
  </button>
));

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const { 
    activeSermon, 
    selectedSermonId, 
    sidebarOpen, 
    toggleSidebar, 
    notes, 
    activeNoteId, 
    fontSize, 
    setFontSize,
    theme, 
    setTheme,
    projectionBlackout,
    isExternalMaskOpen,
    setExternalMaskOpen,
    languageFilter,
    triggerStudyRequest,
    updateSermonHighlights,
    navigatedFromSearch,
    setNavigatedFromSearch,
    lastSearchQuery,
    lastSearchMode,
    setSearchQuery,
    setIsFullTextSearch,
    setSelectedSermonId,
    addNotification,
    jumpToText,
    setJumpToText
  } = useAppStore();
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const [selection, setSelection] = useState<{ text: string; x: number; y: number; isTop: boolean } | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchOriginMatchIndices, setSearchOriginMatchIndices] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon } | null>(null);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);
  const [projectedSegmentIndex, setProjectedSegmentIndex] = useState<number | null>(null);
  const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
  const [isDefining, setIsDefining] = useState(false);

  const readerAreaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const broadcastChannel = useRef<BroadcastChannel | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');
    const handleFullscreenChange = () => setIsOSFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      broadcastChannel.current?.close();
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const segments = useMemo(() => {
    if (!activeSermon?.text) return [];
    return activeSermon.text.split(/(\n\s*\n)/); 
  }, [activeSermon?.id]);

  const structuredSegments = useMemo(() => {
    let globalIdx = 0;
    return segments.map((seg, segIdx) => {
        const words: any[] = [];
        const tokens = seg.split(/(\s+)/);
        tokens.forEach(token => {
            if (token !== "") words.push({ text: token, segmentIndex: segIdx, globalIndex: globalIdx++ });
        });
        return { words, isNumbered: /^\d+/.test(seg.trim()), text: seg };
    });
  }, [segments]);

  const allWords = useMemo(() => structuredSegments.flatMap(s => s.words), [structuredSegments]);

  // Recherche optimisée dans le texte du Reader
  useEffect(() => {
    if (readerSearchQuery.length > 2) {
      startTransition(() => {
        const regex = getAccentInsensitiveRegex(readerSearchQuery, false);
        const fullSermonText = allWords.map(w => w.text).join('');
        const results: number[] = [];
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            let currentChar = 0;
            for (let i = 0; i < allWords.length; i++) {
                if (currentChar >= match.index) {
                    results.push(allWords[i].globalIndex);
                    break;
                }
                currentChar += allWords[i].text.length;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        setSearchResults(results);
        setCurrentResultIndex(results.length > 0 ? 0 : -1);
      });
    } else {
        setSearchResults([]);
        setCurrentResultIndex(-1);
    }
  }, [readerSearchQuery, allWords]);

  const searchHits = useMemo(() => new Set(searchResults), [searchResults]);
  const originHits = useMemo(() => {
    if (!activeSermon || !lastSearchQuery) return new Set();
    const regex = getAccentInsensitiveRegex(lastSearchQuery, lastSearchMode === SearchMode.EXACT_WORDS);
    const fullSermonText = allWords.map(w => w.text).join('');
    const hits = new Set<number>();
    let match;
    while ((match = regex.exec(fullSermonText)) !== null) {
        let currentChar = 0;
        for (let i = 0; i < allWords.length; i++) {
            const wordLen = allWords[i].text.length;
            if (currentChar + wordLen > match.index && currentChar < match.index + match[0].length) {
                hits.add(allWords[i].globalIndex);
            }
            currentChar += wordLen;
        }
        if (regex.lastIndex === match.index) regex.lastIndex++;
    }
    return hits;
  }, [activeSermon?.id, allWords, lastSearchQuery, lastSearchMode]);

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    activeSermon?.highlights?.forEach(h => {
        for (let i = h.start; i <= h.end; i++) map.set(i, h);
    });
    return map;
  }, [activeSermon?.highlights]);

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
    } else {
      setSelection(null);
    }
  }, []);

  if (!selectedSermonId || !activeSermon) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-zinc-950 text-center p-12 animate-in fade-in duration-700">
        <div className="relative mb-10">
          <div className="absolute inset-0 bg-teal-600/10 blur-[80px] rounded-full scale-[2.5] animate-pulse"></div>
          <div className="relative w-24 h-24 flex items-center justify-center bg-white dark:bg-zinc-900 rounded-[32px] shadow-2xl border border-zinc-100 dark:border-zinc-800">
            <BookOpen className="w-10 h-10 text-zinc-300 dark:text-zinc-700" />
          </div>
        </div>
        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-400 dark:text-zinc-600">
          {t.reader_select_prompt}
        </p>
      </div>
    );
  }

  return (
    <div ref={readerAreaRef} className="flex-1 flex flex-col h-full relative bg-white dark:bg-zinc-950 transition-colors duration-300">
      {noteSelectorPayload && <NoteSelectorModal selectionText={noteSelectorPayload.text} sermon={noteSelectorPayload.sermon} onClose={() => setNoteSelectorPayload(null)} />}
      
      {/* Barre d'outils Reader */}
      <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-2xl z-20 no-print">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex flex-col min-w-0">
            <h1 className="text-[15px] font-extrabold text-zinc-900 dark:text-zinc-50 truncate tracking-tight leading-tight">{activeSermon.title}</h1>
            <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-400 uppercase tracking-wider mt-1">
              <span className="font-mono">{activeSermon.date}</span>
              <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
              <span className="truncate">{activeSermon.city}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 shrink-0 ml-4">
            <ActionButton onClick={() => setIsSearchVisible(!isSearchVisible)} icon={Search} tooltip={t.reader_search_tooltip} active={isSearchVisible} />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} icon={theme === 'light' ? Moon : Sun} tooltip="Thème" />
            <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-xl p-0.5 border border-zinc-200 dark:border-zinc-800">
              <button onClick={() => setFontSize(fontSize - 2)} className="w-8 h-8 flex items-center justify-center text-zinc-500"><ZoomOut className="w-3.5 h-3.5" /></button>
              <span className="px-2 text-[10px] font-bold font-mono">{fontSize}</span>
              <button onClick={() => setFontSize(fontSize + 2)} className="w-8 h-8 flex items-center justify-center text-zinc-500"><ZoomIn className="w-3.5 h-3.5" /></button>
            </div>
            <button onClick={() => setSelectedSermonId(null)} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Zone de lecture avec rendu optimisé */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-8 md:p-16 lg:p-24 selection:bg-teal-600/20"
      >
        <div 
          className="max-w-4xl mx-auto leading-relaxed text-justify pb-64"
          style={{ fontSize: `${fontSize}px` }}
        >
          {structuredSegments.map((seg, segIdx) => (
            <ParagraphComponent 
              key={`${activeSermon.id}-${segIdx}`}
              seg={seg}
              segIdx={segIdx}
              fontSize={fontSize}
              isActiveProjection={projectedSegmentIndex === segIdx}
              searchHits={searchHits}
              originHits={originHits}
              highlights={highlightMap}
              citationHits={new Map()}
              onProject={(idx: number) => setProjectedSegmentIndex(idx === projectedSegmentIndex ? null : idx)}
              onNote={(text: string) => setNoteSelectorPayload({ text, sermon: activeSermon })}
              onRemoveHighlight={(id: string) => updateSermonHighlights(activeSermon.id, (activeSermon.highlights || []).filter(h => h.id !== id))}
              onMouseUp={handleTextSelection}
            />
          ))}
        </div>
      </div>

      {/* Menu contextuel de sélection */}
      {selection && (
        <div 
          className="absolute z-[100] animate-in fade-in zoom-in-95 pointer-events-none"
          style={{ left: selection.x, top: selection.y - 60, transform: 'translateX(-50%)' }}
        >
          <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-1 rounded-2xl shadow-2xl pointer-events-auto">
            <button onClick={() => { triggerStudyRequest(selection.text); setSelection(null); }} className="px-3 py-1.5 flex items-center gap-2 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded-xl text-teal-600">
              <Sparkles className="w-3.5 h-3.5" /> <span className="text-[9px] font-black uppercase">Étudier</span>
            </button>
            <button onClick={() => { setNoteSelectorPayload({ text: selection.text, sermon: activeSermon }); setSelection(null); }} className="px-3 py-1.5 flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl text-emerald-600">
              <NotebookPen className="w-3.5 h-3.5" /> <span className="text-[9px] font-black uppercase">Note</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reader;
