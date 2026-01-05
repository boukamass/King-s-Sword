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
  Library,
  Tv,
  Presentation
} from 'lucide-react';

interface SimpleWord {
  text: string;
  segmentIndex: number;
  globalIndex: number;
}

interface ParagraphData {
  text: string;
  words: SimpleWord[];
  isNumbered: boolean;
  paragraphIndex: number;
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

let externalMaskWindow: Window | null = null;
let externalProjectionWindow: Window | null = null;

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  
  const activeSermon = useAppStore(s => s.activeSermon);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  
  const notes = useAppStore(s => s.notes);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  // Fix: add addNote from store
  const addNote = useAppStore(s => s.addNote);
  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
  const isExternalMaskOpen = useAppStore(s => s.isExternalMaskOpen);
  const setExternalMaskOpen = useAppStore(s => s.setExternalMaskOpen);
  const isExternalProjectionOpen = useAppStore(s => s.isExternalProjectionOpen);
  const setExternalProjectionOpen = useAppStore(s => s.setExternalProjectionOpen);

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

  const [localFontSize, setLocalFontSize] = useState<string | number>(fontSize);
  useEffect(() => {
    setLocalFontSize(fontSize);
  }, [fontSize]);

  const readerAreaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const playPromiseRef = useRef<Promise<void> | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  
  const [activeProjectionIndex, setActiveProjectionIndex] = useState<number | null>(null);

  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');

    const checkWindowStatus = setInterval(() => {
      if (externalMaskWindow && externalMaskWindow.closed) {
        setExternalMaskOpen(false);
        externalMaskWindow = null;
      }
      if (externalProjectionWindow && externalProjectionWindow.closed) {
        setExternalProjectionOpen(false);
        externalProjectionWindow = null;
      }
    }, 1000);

    const handleFullscreenChange = () => setIsOSFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      broadcastChannel.current?.close();
      clearInterval(checkWindowStatus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [setExternalMaskOpen, setExternalProjectionOpen]);

  // Synchronisation continue vers la projection
  useEffect(() => {
    if (broadcastChannel.current && sermon) {
      // Si on n'est pas en train de projeter un paragraphe spécifique, on envoie le flux complet
      if (activeProjectionIndex === null) {
        broadcastChannel.current.postMessage({
          type: 'sync',
          title: sermon.title,
          date: sermon.date,
          city: sermon.city,
          text: sermon.text,
          fontSize: fontSize,
          theme: theme,
          highlights: sermon.highlights || [],
          selectionIndices: [],
          searchResults: searchResults,
          currentResultIndex: currentResultIndex,
          activeDefinition: activeDefinition,
          projectedMode: false
        });
      }
    }
  }, [sermon, fontSize, theme, searchResults, currentResultIndex, activeDefinition, activeProjectionIndex]);

  const toggleExternalMask = () => {
    if (isExternalMaskOpen && externalMaskWindow && !externalMaskWindow.closed) {
      externalMaskWindow.close();
      externalMaskWindow = null;
      setExternalMaskOpen(false);
      addNotification("Écran secondaire démasqué.", "success");
    } else {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('mask', 'true');
        url.hash = '';
        const finalUrl = url.toString();
        externalMaskWindow = window.open(finalUrl, 'KingsSwordMask');
        if (externalMaskWindow) {
          setExternalMaskOpen(true);
          addNotification("Écran secondaire masqué.", "success");
        } else {
          addNotification("Action refusée : Aucun second écran détecté.", "error");
        }
      } catch (err) {
        addNotification("Erreur lors du masquage.", "error");
      }
    }
  };

  const toggleExternalProjection = () => {
    if (isExternalProjectionOpen && externalProjectionWindow && !externalProjectionWindow.closed) {
      externalProjectionWindow.close();
      externalProjectionWindow = null;
      setExternalProjectionOpen(false);
      addNotification("Projection arrêtée.", "success");
    } else {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('projection', 'true');
        url.hash = '';
        const finalUrl = url.toString();
        externalProjectionWindow = window.open(finalUrl, 'KingsSwordProjection');
        if (externalProjectionWindow) {
          setExternalProjectionOpen(true);
          addNotification("Écran de projection ouvert.", "success");
        } else {
          addNotification("Impossible d'ouvrir l'écran de projection.", "error");
        }
      } catch (err) {
        addNotification("Erreur lors de l'ouverture de la projection.", "error");
      }
    }
  };

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const segments = useMemo(() => {
    if (!sermon || !sermon.text) return [];
    return sermon.text.split(/(\n\s*\n)/); 
  }, [sermon?.id, sermon?.text]);

  const paragraphs: ParagraphData[] = useMemo(() => {
    const result: ParagraphData[] = [];
    let wordCursor = 0;
    
    segments.forEach((seg, segIdx) => {
      if (/^\n\s*\n$/.test(seg)) return;
      
      const paraWords: SimpleWord[] = [];
      seg.split(/(\s+)/).forEach(token => {
        if (token !== "") {
          paraWords.push({ text: token, segmentIndex: segIdx, globalIndex: wordCursor++ });
        }
      });
      
      if (paraWords.length > 0) {
        const text = seg.trim();
        result.push({
          text: text,
          words: paraWords,
          isNumbered: /^\d+/.test(text),
          paragraphIndex: result.length
        });
      }
    });
    return result;
  }, [segments]);

  const words = useMemo(() => paragraphs.flatMap(p => p.words), [paragraphs]);

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    if (!sermon?.highlights) return map;
    for (const h of sermon.highlights) {
        for (let i = h.start; i <= h.end; i++) map.set(i, h);
    }
    return map;
  }, [sermon?.highlights]);
  
  const citationHighlightMap = useMemo(() => {
    const map = new Map<number, { colorClass: string }>();
    if (!activeNoteId || !sermon) return map;
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote) return map;
    const relevantCitations = activeNote.citations.filter(c => c.sermon_id === sermon.id);
    if (relevantCitations.length === 0) return map;

    const contentWords = words.filter(w => /\S/.test(w.text));
    const sermonWordsNormalized = contentWords.map(w => normalizeText(w.text));

    for (const citation of relevantCitations) {
        const searchWordsNormalized = normalizeText(citation.quoted_text).split(' ').filter(Boolean);
        if (searchWordsNormalized.length === 0) continue;
        for (let i = 0; i <= sermonWordsNormalized.length - searchWordsNormalized.length; i++) {
            const sermonSlice = sermonWordsNormalized.slice(i, i + searchWordsNormalized.length);
            if (JSON.stringify(sermonSlice) === JSON.stringify(searchWordsNormalized)) {
                const startGlobalIndex = contentWords[i].globalIndex;
                const endGlobalIndex = contentWords[i + searchWordsNormalized.length - 1].globalIndex;
                const colorClass = PALETTE_HIGHLIGHT_COLORS[activeNote.color || 'default'];
                for (let k = startGlobalIndex; k <= endGlobalIndex; k++) map.set(k, { colorClass });
                i += searchWordsNormalized.length - 1;
            }
        }
    }
    return map;
  }, [activeNoteId, notes, sermon?.id, words]);

  useEffect(() => {
    if (readerSearchQuery.length > 2) {
      startTransition(() => {
        const queryNormalized = normalizeText(readerSearchQuery);
        const results = [];
        for (let i = 0; i < words.length; i++) {
            if (/\S/.test(words[i].text) && normalizeText(words[i].text).includes(queryNormalized)) {
                results.push(words[i].globalIndex);
            }
        }
        setSearchResults(results);
        setCurrentResultIndex(results.length > 0 ? 0 : -1);
      });
    } else {
        setSearchResults([]);
        setCurrentResultIndex(-1);
    }
  }, [readerSearchQuery, words]);

  const togglePlay = useCallback(async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!audioRef.current) return;
    try {
      if (audioRef.current.paused) {
        if (playPromiseRef.current) await playPromiseRef.current;
        playPromiseRef.current = audioRef.current.play();
        await playPromiseRef.current;
      } else {
        audioRef.current.pause();
      }
    } catch (err) { console.error(err); }
    finally { playPromiseRef.current = null; }
  }, []);

  const seek = (seconds: number) => {
    if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
        const newState = !isMuted;
        audioRef.current.muted = newState;
        setIsMuted(newState);
    }
  };

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
      if (searchOriginMatchIndices.length > 0) setSearchOriginMatchIndices([]);
    } else {
      setSelection(null);
    }
  }, [searchOriginMatchIndices]);

  const handleHighlight = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sermon || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const startNode = range.startContainer.parentElement?.closest('[data-global-index]');
    const endNode = range.endContainer.parentElement?.closest('[data-global-index]');
    if (startNode && endNode) {
      const start = parseInt(startNode.getAttribute('data-global-index') || '0');
      const end = parseInt(endNode.getAttribute('data-global-index') || '0');
      const newHighlight: Highlight = { id: crypto.randomUUID(), start: Math.min(start, end), end: Math.max(start, end) };
      updateSermonHighlights(sermon.id, [...(sermon.highlights || []), newHighlight]);
      addNotification("Surlignage ajouté", "success");
    }
  }, [sermon, updateSermonHighlights, addNotification]);

  const handleRemoveHighlight = useCallback((id: string) => {
    if (!sermon) return;
    updateSermonHighlights(sermon.id, (sermon.highlights || []).filter(h => h.id !== id));
  }, [sermon, updateSermonHighlights]);

  const handleCopy = useCallback(() => {
    if (selection) {
      navigator.clipboard.writeText(selection.text);
      addNotification(t.copy_success, "success");
    }
  }, [selection, addNotification, t.copy_success]);

  const handleDefine = async () => {
    if (!selection) return;
    const word = selection.text.split(' ')[0].replace(/[.,;?!]/g, "");
    setIsDefining(true);
    setSelection(null);
    try {
      const def = await getDefinition(word);
      setActiveDefinition(def);
    } catch (err: any) {
      addNotification(err.message || "Erreur de définition", "error");
    } finally {
      setIsDefining(false);
    }
  };

  const projectParagraph = useCallback((para: ParagraphData) => {
    if (activeProjectionIndex === para.paragraphIndex) {
      // Si on reclique sur le même, on désactive la projection focalisée
      setActiveProjectionIndex(null);
      return;
    }

    setActiveProjectionIndex(para.paragraphIndex);
    if (broadcastChannel.current) {
        broadcastChannel.current.postMessage({
            type: 'sync',
            title: sermon?.title || '',
            date: sermon?.date || '',
            city: sermon?.city || '',
            text: para.text, 
            fontSize: fontSize,
            theme: theme,
            highlights: [], 
            selectionIndices: para.words.map(w => w.globalIndex), 
            projectedMode: true
        });
    }
  }, [sermon, fontSize, theme, activeProjectionIndex]);

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const checkIsSearchResult = useCallback((idx: number) => searchResults.includes(idx), [searchResults]);
  const checkIsCurrentResult = useCallback((idx: number) => searchResults[currentResultIndex] === idx, [searchResults, currentResultIndex]);
  const checkIsSearchOriginMatch = useCallback((idx: number) => searchOriginMatchIndices.includes(idx), [searchOriginMatchIndices]);

  if (!selectedSermonId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 relative">
        <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print">
          {!sidebarOpen && (
             <button onClick={toggleSidebar} data-tooltip="Ouvrir la Bibliothèque" className="flex items-center gap-3 hover:opacity-80 transition-all active:scale-95 group shrink-0 mr-1">
               <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
                 <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-4 h-4 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
               </div>
               <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 group-hover:text-teal-600 transition-colors">Bibliothèque</span>
             </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-700">
          <div className="relative mb-10 group">
            <div className="absolute inset-0 bg-teal-600/10 dark:bg-teal-600/5 blur-[80px] rounded-full scale-[2.5] animate-pulse"></div>
            <div className="relative w-24 h-24 flex items-center justify-center bg-white dark:bg-zinc-900 rounded-[32px] shadow-2xl border border-zinc-100 dark:border-zinc-800 transform group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-500">
              <Library className="w-10 h-10 text-zinc-300 dark:text-zinc-700 group-hover:text-teal-600 transition-all duration-500" />
            </div>
          </div>
          <div className="max-w-xs space-y-4">
            <p className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-400 dark:text-zinc-600 animate-in slide-in-from-bottom-2 duration-700 delay-100">
              {t.reader_select_prompt}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!sermon) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-zinc-950">
        <Loader2 className="w-10 h-10 animate-spin text-teal-600" />
        <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Ouverture...</p>
      </div>
    );
  }

  return (
    <div ref={readerAreaRef} className={`flex-1 flex flex-col h-full relative bg-white dark:bg-zinc-950 transition-colors duration-200 overflow-visible-important`}>
      {noteSelectorPayload && <NoteSelectorModal selectionText={noteSelectorPayload.text} sermon={noteSelectorPayload.sermon} onClose={() => setNoteSelectorPayload(null)} />}
      
      {(activeDefinition || isDefining) && (
        <div className="fixed inset-0 z-[100000] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setActiveDefinition(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 relative max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="px-8 pt-6 pb-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-[18px] border border-teal-600/20 shadow-sm"><BookOpenCheck className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.2em]">Dictionnaire</h3>
                  <p className="text-[17px] font-extrabold text-zinc-900 dark:text-white mt-0.5 truncate">{isDefining ? "..." : activeDefinition?.word}</p>
                </div>
              </div>
              <button onClick={() => setActiveDefinition(null)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-white dark:bg-zinc-800 rounded-xl transition-all border border-zinc-200 dark:border-zinc-700 shadow-sm"><X className="w-4 h-4" /></button>
            </div>
            
            <div className="flex-1 px-8 py-6 overflow-y-auto custom-scrollbar">
              {isDefining ? (
                <div className="py-20 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-teal-600" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Recherche...</p>
                </div>
              ) : activeDefinition && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400"><Quote className="w-3.5 h-3.5" /><h4 className="text-[9px] font-black uppercase tracking-[0.2em]">Définition</h4></div>
                    <div className="p-4 bg-teal-600/5 dark:bg-teal-600/10 border border-teal-600/10 rounded-[20px] shadow-sm">
                      <p className="text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-100 font-medium serif-text italic">{activeDefinition.definition}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-8 py-5 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
              <button onClick={() => { if(activeDefinition) { addNote({ title: `Dico: ${activeDefinition.word}`, content: activeDefinition.definition, citations: [] }); setActiveDefinition(null); } }} disabled={!activeDefinition} className="w-full py-3.5 bg-teal-600 text-white rounded-[18px] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-teal-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"><NotebookPen className="w-4 h-4" />Journaliser</button>
            </div>
          </div>
        </div>
      )}
      
      <div className={`px-4 md:px-8 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print transition-all duration-300 overflow-visible-important`}>
        <div className="flex items-center gap-4 min-w-0 flex-1 overflow-visible-important">
          {(!sidebarOpen || isOSFullscreen) && (
             <button onClick={toggleSidebar} data-tooltip="Ouvrir la Bibliothèque" className="flex items-center gap-3 hover:opacity-80 transition-all active:scale-95 group shrink-0 mr-1">
               <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
                 <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-4 h-4 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
               </div>
             </button>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <h1 className="text-[16px] font-extrabold text-zinc-900 dark:text-zinc-50 truncate tracking-tight transition-all leading-tight">{sermon.title}</h1>
            <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-400 uppercase tracking-wider leading-none mt-1">
              <Calendar className="w-2.5 h-2.5 text-teal-600 dark:text-blue-400" /><span className="font-mono">{sermon.date}</span>
              <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-1" /><MapPin className="w-2.5 h-2.5 text-teal-600 dark:text-blue-400" /><span className="truncate">{sermon.city}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0 ml-4 overflow-visible-important">
            {navigatedFromSearch && (
              <button onClick={() => { setSearchQuery(lastSearchQuery); setIsFullTextSearch(true); setSelectedSermonId(null); setNavigatedFromSearch(false); }} className="px-3 py-1.5 bg-amber-600/10 text-amber-700 dark:text-amber-400 text-[9px] font-bold uppercase tracking-wider rounded-xl hover:bg-amber-600/20 transition-colors mr-2">
                <ChevronLeft className="w-3 h-3 inline mr-1" /> {t.reader_exit_search}
              </button>
            )}

            <ActionButton 
              onClick={toggleExternalProjection} 
              icon={Presentation} 
              tooltip={isExternalProjectionOpen ? "Arrêter la projection" : "Ouvrir l'écran de projection"} 
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
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} icon={ThemeIcon} tooltip="Changer Thème" active={theme !== 'system'} />
            
            <div className="hidden sm:flex items-center bg-white/50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm overflow-hidden no-print">
              <button onClick={() => setFontSize(fontSize - 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors border-r border-zinc-200/50 dark:border-zinc-800/50 active:scale-95"><ZoomOut className="w-4 h-4" /></button>
              <button onClick={() => setFontSize(fontSize + 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors border-l border-zinc-200/50 dark:border-zinc-800/50 active:scale-95"><ZoomIn className="w-4 h-4" /></button>
            </div>
        </div>
      </div>

      <div className={`flex-1 relative overflow-hidden flex justify-center`}>
        <div 
          ref={scrollContainerRef} 
          onMouseUp={handleTextSelection} 
          className={`absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all duration-300 ${isOSFullscreen ? 'py-4 px-4 md:px-8' : 'py-16 px-6 sm:px-12 lg:px-20 xl:px-28'}`}
        >
          <div className={`w-full mx-auto printable-content whitespace-pre-wrap text-justify pb-64 ${isPending ? 'opacity-50' : ''} max-w-[95%]`} style={{ fontSize: `${fontSize}px` }}>
            {paragraphs.map((para) => {
              const isActiveProjection = activeProjectionIndex === para.paragraphIndex;
              const paraNumber = para.isNumbered ? para.text.match(/^\d+/)?.[0] : null;
              
              return (
                <div 
                  key={para.paragraphIndex}
                  className={`relative mb-8 group/para transition-all duration-500 rounded-[32px] ${
                    para.isNumbered 
                      ? `p-6 border border-transparent hover:border-teal-600/20 dark:hover:border-teal-600/10 ${
                          isActiveProjection 
                            ? 'bg-teal-600/10 dark:bg-teal-600/5 border-teal-600/30 ring-2 ring-teal-600/10 shadow-2xl scale-[1.01]' 
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'
                        }`
                      : ''
                  }`}
                >
                  {para.isNumbered && (
                    <div className="absolute -left-14 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 transition-all duration-500 no-print">
                       {/* Badge du numéro de paragraphe interactif */}
                       <button 
                         onClick={() => projectParagraph(para)}
                         data-tooltip="Projeter ce paragraphe"
                         className={`w-10 h-10 flex flex-col items-center justify-center rounded-2xl text-[11px] font-black transition-all duration-500 shadow-xl active:scale-90 border overflow-hidden ${
                           isActiveProjection 
                             ? 'bg-teal-600 border-teal-600 text-white shadow-teal-600/40 rotate-[-5deg]' 
                             : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-teal-600 hover:border-teal-600/40 opacity-0 group-hover/para:opacity-100 translate-x-4 group-hover/para:translate-x-0'
                         }`}
                       >
                          <span className="leading-none">{paraNumber}</span>
                          <Presentation className="w-3 h-3 mt-1 opacity-60" />
                       </button>

                       {/* Indicateur de statut de projection */}
                       {isActiveProjection && (
                          <div className="flex gap-1 animate-pulse">
                            <div className="w-1 h-1 bg-teal-600 rounded-full" />
                            <div className="w-1 h-1 bg-teal-600 rounded-full" />
                          </div>
                       )}
                    </div>
                  )}

                  {/* Bouton de projection flottant interne pour plus d'ergonomie */}
                  {para.isNumbered && !isActiveProjection && (
                    <button 
                      onClick={() => projectParagraph(para)}
                      className="absolute top-2 right-4 flex items-center gap-2 px-3 py-1.5 bg-teal-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest opacity-0 group-hover/para:opacity-100 transition-all translate-y-2 group-hover/para:translate-y-0 shadow-lg active:scale-95 no-print"
                    >
                      <Presentation className="w-3 h-3" />
                      Projeter
                    </button>
                  )}

                  <div onClick={() => para.isNumbered && projectParagraph(para)} className={para.isNumbered ? 'cursor-pointer' : ''}>
                    {para.words.map((word) => (
                      <WordComponent 
                        key={word.globalIndex} 
                        word={word} 
                        wordRef={(el: any) => { if(el) wordRefs.current.set(word.globalIndex, el); }} 
                        isSearchResult={checkIsSearchResult(word.globalIndex)} 
                        isCurrentResult={checkIsCurrentResult(word.globalIndex)} 
                        isSearchOriginMatch={checkIsSearchOriginMatch(word.globalIndex)}
                        citationColor={citationHighlightMap.get(word.globalIndex)?.colorClass}
                        highlight={highlightMap.get(word.globalIndex)}
                        onRemoveHighlight={handleRemoveHighlight}
                        onMouseUp={handleTextSelection}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selection && (
        <div className="absolute z-[200000] pointer-events-none animate-in fade-in zoom-in-95 no-print" style={{ left: selection.x, top: selection.isTop ? selection.y + 40 : selection.y - 75, transform: 'translateX(-50%)' }}>
          <div className="flex items-center gap-0.5 bg-white/98 dark:bg-zinc-900/98 backdrop-blur-3xl p-1.5 rounded-[24px] shadow-2xl pointer-events-auto border border-zinc-200/50 dark:border-zinc-800/50 overflow-visible-important">
            <button onClick={() => { handleHighlight(); setSelection(null); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-amber-500/10 text-zinc-600 dark:text-zinc-400 hover:text-amber-600 rounded-[18px] transition-all group">
              <Highlighter className="w-4 h-4 text-amber-500/60 group-hover:text-amber-500" /><span className="text-[7.5px] font-black uppercase tracking-widest">Surligner</span>
            </button>
            <button onClick={() => { handleCopy(); setSelection(null); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 rounded-[18px] transition-all group">
              <Copy className="w-4 h-4 text-zinc-400/60 group-hover:text-zinc-500" /><span className="text-[7.5px] font-black uppercase tracking-widest">Copier</span>
            </button>
            <button onClick={() => { handleDefine(); setSelection(null); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-teal-600/10 text-zinc-600 dark:text-zinc-400 hover:text-teal-600 rounded-[18px] transition-all group">
              <BookOpen className="w-4 h-4 text-teal-500/60 group-hover:text-teal-600" /><span className="text-[7.5px] font-black uppercase tracking-widest">Définir</span>
            </button>
            <button onClick={() => { triggerStudyRequest(selection.text); setSelection(null); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-teal-600/10 text-zinc-600 dark:text-zinc-400 hover:text-teal-600 rounded-[18px] transition-all group">
              <Sparkles className="w-4 h-4 text-teal-600/60 group-hover:text-teal-600" /><span className="text-[7.5px] font-black uppercase tracking-widest">Étudier</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reader;