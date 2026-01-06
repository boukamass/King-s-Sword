
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
  MonitorPlay,
  Library
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

let externalMaskWindow: Window | null = null;

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  
  const activeSermon = useAppStore(s => s.activeSermon);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  
  const notes = useAppStore(s => s.notes);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const isExternalMaskOpen = useAppStore(s => s.isExternalMaskOpen);
  const setExternalMaskOpen = useAppStore(s => s.setExternalMaskOpen);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
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
  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
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
  const [projectedSegmentIndex, setProjectedSegmentIndex] = useState<number | null>(null);
  
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

  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');

    const checkWindowStatus = setInterval(() => {
      if (externalMaskWindow && externalMaskWindow.closed) {
        setExternalMaskOpen(false);
        externalMaskWindow = null;
      }
    }, 1000);

    const handleFullscreenChange = () => setIsOSFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      broadcastChannel.current?.close();
      clearInterval(checkWindowStatus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [setExternalMaskOpen]);

  // Sync with projection channel
  useEffect(() => {
    if (broadcastChannel.current && sermon) {
      const activeText = projectedSegmentIndex !== null 
        ? segments[projectedSegmentIndex].trim()
        : sermon.text;

      broadcastChannel.current.postMessage({
        type: 'sync',
        title: sermon.title,
        date: sermon.date,
        city: sermon.city,
        text: activeText,
        fontSize,
        theme,
        blackout: projectionBlackout,
        highlights: sermon.highlights || [],
        selectionIndices: [],
        searchResults,
        currentResultIndex,
        activeDefinition
      });
    }
  }, [sermon, projectedSegmentIndex, fontSize, theme, projectionBlackout, searchResults, currentResultIndex, activeDefinition]);

  const handleProjectSegment = (idx: number) => {
    if (projectedSegmentIndex === idx) {
      setProjectedSegmentIndex(null);
    } else {
      setProjectedSegmentIndex(idx);
      addNotification("Paragraphe projeté", "success");
    }
  };

  const handleOpenProjection = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('projection', 'true');
      url.hash = '';
      const projWindow = window.open(url.toString(), 'KingsSwordProjection');
      if (projWindow) {
        addNotification("Fenêtre de projection ouverte", "success");
      } else {
        addNotification("Action bloquée : vérifiez les fenêtres surgissantes", "error");
      }
    } catch (err) {
      addNotification("Erreur de projection", "error");
    }
  };

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
  }, [sermon?.id]);

  const structuredSegments = useMemo(() => {
    const result: { words: SimpleWord[]; isNumbered: boolean; text: string }[] = [];
    let globalIdx = 0;
    
    segments.forEach((seg, segIdx) => {
        const segWords: SimpleWord[] = [];
        const tokens = seg.split(/(\s+)/);
        tokens.forEach(token => {
            if (token !== "") {
                segWords.push({ text: token, segmentIndex: segIdx, globalIndex: globalIdx++ });
            }
        });
        
        const isNumbered = /^\d+/.test(seg.trim());
        result.push({ words: segWords, isNumbered, text: seg });
    });
    return result;
  }, [segments]);

  const words = useMemo(() => {
    return structuredSegments.flatMap(s => s.words);
  }, [structuredSegments]);

  useEffect(() => {
    if (sermon && words.length > 0 && lastSearchQuery) {
        const regex = getAccentInsensitiveRegex(lastSearchQuery, lastSearchMode === SearchMode.EXACT_WORDS);
        const fullSermonText = words.map(w => w.text).join('');
        const matchIndices: number[] = [];

        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;
            
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > startChar && currentChar < endChar) {
                    matchIndices.push(words[i].globalIndex);
                }
                currentChar += wordLen;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        setSearchOriginMatchIndices(matchIndices);
    } else {
        setSearchOriginMatchIndices([]);
    }
  }, [sermon?.id, words, lastSearchQuery, lastSearchMode]);

  useEffect(() => {
    if (sermon?.id && !jumpToText && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
        setProjectedSegmentIndex(null);
    }
  }, [sermon?.id]);

  useEffect(() => {
    if (jumpToText && sermon && words.length > 0) {
      const handleJump = () => {
        const regex = getAccentInsensitiveRegex(jumpToText, false);
        const fullSermonText = words.map(w => w.text).join('');
        const match = regex.exec(fullSermonText);

        if (match) {
          const startChar = match.index;
          let foundStartIndex = -1;
          let currentChar = 0;
          for (let i = 0; i < words.length; i++) {
              if (currentChar >= startChar) {
                  foundStartIndex = words[i].globalIndex;
                  break;
              }
              currentChar += words[i].text.length;
          }

          if (foundStartIndex !== -1) {
            setTimeout(() => {
              const firstEl = wordRefs.current.get(foundStartIndex);
              if (firstEl) {
                firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                window.getSelection()?.removeAllRanges();
              }
            }, 400); 
            setJumpToText(null);
          }
        }
      };
      handleJump();
    }
  }, [jumpToText, sermon, words, setJumpToText]);

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

    const fullSermonText = words.map(w => w.text).join('');

    for (const citation of relevantCitations) {
        const regex = getAccentInsensitiveRegex(citation.quoted_text, false);
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;
            const colorClass = PALETTE_HIGHLIGHT_COLORS[activeNote.color || 'default'];
            
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > startChar && currentChar < endChar) {
                    map.set(words[i].globalIndex, { colorClass });
                }
                currentChar += wordLen;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
    }
    return map;
  }, [activeNoteId, notes, sermon?.id, words]);

  useEffect(() => {
    if (readerSearchQuery.length > 2) {
      startTransition(() => {
        const regex = getAccentInsensitiveRegex(readerSearchQuery, false);
        const fullSermonText = words.map(w => w.text).join('');
        const results = [];
        
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                if (currentChar >= match.index) {
                    results.push(words[i].globalIndex);
                    break;
                }
                currentChar += words[i].text.length;
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
  }, [readerSearchQuery, words]);

  useEffect(() => {
      if (currentResultIndex !== -1 && searchResults.length > 0) {
          wordRefs.current.get(searchResults[currentResultIndex])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
  }, [currentResultIndex, searchResults]);

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

  const handleDownload = () => {
    if (sermon?.audio_url) {
        const link = document.createElement('a');
        link.href = sermon.audio_url;
        link.target = "_blank";
        link.download = `${sermon.title}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
    } else {
      setSelection(null);
    }
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

  const closeSelectionMenu = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    return `${Math.floor(time/60)}:${Math.floor(time%60).toString().padStart(2,'0')}`;
  };

  const handleAddDefinitionToNotes = () => {
    if (!activeDefinition) return;
    const content = `**Définition de "${activeDefinition.word}"**\n\n${activeDefinition.definition}\n\n*Étymologie : ${activeDefinition.etymology || 'N/A'}*\n*Synonymes : ${activeDefinition.synonyms?.join(', ') || 'Aucun'}*`;
    setNoteSelectorPayload({ 
      text: content, 
      sermon: { 
        id: `definition-${Date.now()}`, 
        title: `Dictionnaire: ${activeDefinition.word}`, 
        date: new Date().toISOString().split('T')[0], 
        city: 'Dictionnaire', 
        text: '' 
      } 
    });
    setActiveDefinition(null);
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const checkIsSearchResult = useCallback((idx: number) => searchResults.includes(idx), [searchResults]);
  const checkIsCurrentResult = useCallback((idx: number) => searchResults[currentResultIndex] === idx, [searchResults, currentResultIndex]);
  const checkIsSearchOriginMatch = useCallback((idx: number) => searchOriginMatchIndices.includes(idx), [searchOriginMatchIndices]);

  if (!selectedSermonId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 relative">
        <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print">
          {!sidebarOpen && (
             <button 
               onClick={toggleSidebar}
               data-tooltip="Ouvrir la Bibliothèque"
               className="flex items-center gap-3 hover:opacity-80 transition-all active:scale-95 group shrink-0 mr-1"
             >
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {activeDefinition.etymology && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400"><Feather className="w-3.5 h-3.5" /><h4 className="text-[9px] font-black uppercase tracking-[0.2em]">Étymologie</h4></div>
                          <div className="px-4 py-3 bg-teal-600/[0.03] dark:bg-teal-400/[0.05] border border-teal-600/10 rounded-[18px]">
                            <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400 serif-text italic">{activeDefinition.etymology}</p>
                          </div>
                        </div>
                      )}
                      {activeDefinition.synonyms && activeDefinition.synonyms.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400"><Milestone className="w-3.5 h-3.5" /><h4 className="text-[9px] font-black uppercase tracking-[0.2em]">Synonymes</h4></div>
                          <div className="flex flex-wrap gap-1.5">{activeDefinition.synonyms.map((syn, idx) => (
                              <span key={idx} className="px-2.5 py-1 bg-amber-600/5 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 rounded-lg text-[11px] font-bold border border-amber-600/10">{syn}</span>
                            ))}</div>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
            <div className="px-8 py-5 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
              <button onClick={handleAddDefinitionToNotes} disabled={!activeDefinition} className="w-full py-3.5 bg-teal-600 text-white rounded-[18px] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-teal-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"><NotebookPen className="w-4 h-4" />Journaliser</button>
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
              <button onClick={() => { setSearchQuery(lastSearchQuery); setIsFullTextSearch(true); setSelectedSermonId(null); setNavigatedFromSearch(false); setSearchOriginMatchIndices([]); }} className="px-3 py-1.5 bg-amber-600/10 text-amber-700 dark:text-amber-400 text-[9px] font-bold uppercase tracking-wider rounded-xl hover:bg-amber-600/20 transition-colors mr-2">
                <ChevronLeft className="w-3 h-3 inline mr-1" /> {t.reader_exit_search}
              </button>
            )}

            <ActionButton 
              onClick={handleOpenProjection} 
              icon={MonitorPlay} 
              tooltip="Ouvrir la fenêtre de projection" 
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
            <ActionButton onClick={() => { setIsSearchVisible(!isSearchVisible); if(isSearchVisible) setSearchResults([]); }} icon={Search} tooltip={t.reader_search_tooltip} active={isSearchVisible} />
            <ActionButton onClick={handleFullscreenToggle} icon={isOSFullscreen ? Minimize : Maximize} tooltip={isOSFullscreen ? "Sortir du plein écran" : "Plein écran"} special={isOSFullscreen} />
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} icon={ThemeIcon} tooltip="Changer Thème" active={theme !== 'system'} />
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            
            <div onDoubleClick={() => setFontSize(20)} className="flex items-center bg-white/50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm overflow-hidden no-print">
              <button onClick={() => setFontSize(fontSize - 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors border-r border-zinc-200/50 dark:border-zinc-800/50 active:scale-95" data-tooltip={t.reader_zoom_out}><ZoomOut className="w-4 h-4" /></button>
              <input 
                type="text" 
                value={localFontSize} 
                onChange={e => { if (/^\d*$/.test(e.target.value)) setLocalFontSize(e.target.value); }} 
                onBlur={() => { const val = parseInt(String(localFontSize), 10); if (!isNaN(val)) setFontSize(val); else setLocalFontSize(fontSize); }} 
                onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} 
                className="w-12 h-9 bg-transparent text-center text-[11px] font-black text-zinc-600 dark:text-zinc-300 outline-none focus:text-teal-600 cursor-pointer" 
                data-tooltip="Taille police (Double-clic pour réinitialiser)" 
              />
              <button onClick={() => setFontSize(fontSize + 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors border-l border-zinc-200/50 dark:border-zinc-800/50 active:scale-95" data-tooltip={t.reader_zoom_in}><ZoomIn className="w-4 h-4" /></button>
            </div>
        </div>
      </div>

      {isSearchVisible && (
        <div className="absolute top-14 left-0 right-0 z-[30] px-4 md:px-8 py-3 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-100 dark:border-zinc-800/50 flex justify-center">
           <div className="flex items-center gap-4 w-full max-w-2xl">
             <div className="relative flex-1 group/reader-search">
               <input autoFocus type="text" placeholder={t.reader_search_placeholder} value={readerSearchQuery} onChange={e => setReaderSearchQuery(e.target.value)} className="w-full pl-10 pr-10 py-2.5 bg-zinc-100/50 dark:bg-zinc-900/50 border border-zinc-200/50 dark:border-zinc-800/50 rounded-2xl text-sm font-bold outline-none" />
               <Search className="absolute left-3.5 top-3 w-4 h-4 text-zinc-400 group-focus-within/reader-search:text-teal-600" />
               {readerSearchQuery && <button onClick={() => { setReaderSearchQuery(''); setSearchResults([]); }} className="absolute right-3 top-2.5 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg"><X className="w-3.5 h-3.5" /></button>}
             </div>
             {searchResults.length > 0 && (
               <div className="flex items-center gap-3 shrink-0 animate-in fade-in zoom-in-95">
                  <div className="flex flex-col items-center justify-center px-3 py-1 bg-teal-600/5 dark:bg-teal-600/10 rounded-xl border border-teal-600/10 min-w-[70px]"><span className="text-[10px] font-black text-teal-600">{currentResultIndex + 1} / {searchResults.length}</span></div>
                  <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <button onClick={() => setCurrentResultIndex(prev => (prev > 0 ? prev - 1 : searchResults.length - 1))} className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-teal-600 rounded-lg transition-all"><ChevronUp className="w-4 h-4" /></button>
                    <button onClick={() => setCurrentResultIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : 0))} className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-teal-600 rounded-lg transition-all"><ChevronDown className="w-4 h-4" /></button>
                  </div>
               </div>
             )}
             <button onClick={() => { setIsSearchVisible(false); setReaderSearchQuery(''); setSearchResults([]); }} className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-2xl transition-all active:scale-90"><X className="w-5 h-5" /></button>
           </div>
        </div>
      )}

      <div className={`flex-1 relative overflow-hidden flex justify-center`}>
        <div 
          onScroll={() => {}} 
          ref={scrollContainerRef} 
          onMouseUp={handleTextSelection} 
          className={`absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all duration-300 ${isOSFullscreen ? 'py-4 px-4 md:px-8' : 'py-16 px-6 sm:px-12 lg:px-20 xl:px-28'}`}
        >
          <div className={`w-full mx-auto printable-content whitespace-pre-wrap text-justify pb-64 ${isPending ? 'opacity-50' : ''} max-w-[95%]`} style={{ fontSize: `${fontSize}px` }}>
            {structuredSegments.map((seg, segIdx) => {
              const isActiveProjection = projectedSegmentIndex === segIdx;
              
              if (seg.isNumbered) {
                return (
                  <div 
                    key={segIdx}
                    onClick={() => handleProjectSegment(segIdx)}
                    className={`group/seg relative mb-1.5 py-2.5 px-6 rounded-[20px] border-l-[5px] transition-all duration-300 cursor-pointer shadow-sm hover:shadow-xl hover:scale-[1.005] active:scale-[0.995] ${
                      isActiveProjection 
                        ? 'bg-teal-600/10 border-teal-600 ring-2 ring-teal-600/20' 
                        : 'bg-white dark:bg-zinc-900/50 border-teal-600/20 hover:border-teal-600 dark:border-zinc-800'
                    }`}
                  >
                    <div className="absolute -left-[54px] top-1/2 -translate-y-1/2 opacity-0 group-hover/seg:opacity-100 transition-all translate-x-4 group-hover/seg:translate-x-0 no-print flex flex-col gap-2">
                        <div 
                          onClick={(e) => { e.stopPropagation(); handleProjectSegment(segIdx); }}
                          data-tooltip="Projeter ce paragraphe"
                          className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-xl shadow-lg shadow-teal-600/30 hover:scale-110 transition-transform"
                        >
                          <MonitorPlay className="w-4 h-4" />
                        </div>
                        <div 
                          onClick={(e) => { e.stopPropagation(); setNoteSelectorPayload({ text: seg.text.trim(), sermon }); }}
                          data-tooltip="Ajouter aux notes"
                          className="w-9 h-9 flex items-center justify-center bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-600/30 hover:scale-110 transition-transform"
                        >
                          <NotebookPen className="w-4 h-4" />
                        </div>
                    </div>
                    {seg.words.map((word) => (
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
                );
              }

              if (seg.text.trim() === '') return null;

              return (
                <div key={segIdx} className="mb-4 px-6">
                  {seg.words.map((word) => (
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
              );
            })}
          </div>
        </div>
        
        {sermon.audio_url && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center no-print z-50 overflow-visible-important">
              <audio ref={audioRef} src={sermon.audio_url} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} onEnded={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
              <div onMouseEnter={() => setIsPlayerExpanded(true)} onMouseLeave={() => setIsPlayerExpanded(false)} className={`transition-all duration-500 flex items-center bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-2xl rounded-full overflow-visible-important ${isPlayerExpanded ? 'w-[320px] sm:w-[580px] h-12 px-4' : 'w-10 h-10'} ${isOSFullscreen ? 'opacity-40 hover:opacity-100' : ''}`}>
                {!isPlayerExpanded ? <div className="w-full h-full flex items-center justify-center text-zinc-400"><Headphones className="w-4 h-4 animate-pulse text-teal-600/40" /></div> : (
                  <div className="flex items-center gap-4 w-full h-full animate-in fade-in zoom-in-95 overflow-visible-important">
                    <div className="flex items-center gap-0.5 overflow-visible-important">
                        <button onClick={() => seek(-10)} data-tooltip="-10s" className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600"><RotateCcw className="w-3.5 h-3.5" /></button>
                        <button onClick={togglePlay} data-tooltip={isPlaying ? "Pause" : "Lecture"} className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-xl active:scale-90">{isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-0.5" />}</button>
                        <button onClick={() => seek(10)} data-tooltip="+10s" className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600"><RotateCw className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
                      <div className="relative h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div className="absolute top-0 left-0 h-full bg-teal-600" style={{ width: `${(currentTime/duration)*100}%` }} />
                        <input type="range" min="0" max={duration} step="0.1" value={currentTime} onChange={e => { if(audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                      </div>
                      <div className="flex justify-between text-[8px] font-black text-zinc-500 uppercase tracking-tighter"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 px-2 border-l border-zinc-200 dark:border-zinc-800 ml-2 overflow-visible-important">
                        <button onClick={toggleMute} data-tooltip={isMuted ? "Son" : "Muet"} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600">{isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
                        <button onClick={handleDownload} data-tooltip="Audio" className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600"><Download className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
              </div>
          </div>
        )}
      </div>

      {selection && (
        <div className="absolute z-[200000] pointer-events-none animate-in fade-in zoom-in-95 no-print" style={{ left: selection.x, top: selection.isTop ? selection.y + 40 : selection.y - 75, transform: 'translateX(-50%)' }}>
          <div className="flex items-center gap-0.5 bg-white/98 dark:bg-zinc-900/98 backdrop-blur-3xl p-1.5 rounded-[24px] shadow-2xl pointer-events-auto border border-zinc-200/50 dark:border-zinc-800/50 overflow-visible-important">
            <button onClick={() => { handleHighlight(); closeSelectionMenu(); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-amber-500/10 text-zinc-600 dark:text-zinc-400 hover:text-amber-600 rounded-[18px] transition-all group">
              <Highlighter className="w-4 h-4 text-amber-500/60 group-hover:text-amber-500" /><span className="text-[7.5px] font-black uppercase tracking-widest">Surligner</span>
            </button>
            <button onClick={() => { handleCopy(); closeSelectionMenu(); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 rounded-[18px] transition-all group">
              <Copy className="w-4 h-4 text-zinc-400/60 group-hover:text-zinc-500" /><span className="text-[7.5px] font-black uppercase tracking-widest">Copier</span>
            </button>
            <button onClick={() => { handleDefine(); closeSelectionMenu(); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-teal-600/10 text-zinc-600 dark:text-zinc-400 hover:text-teal-600 rounded-[18px] transition-all group">
              <BookOpen className="w-4 h-4 text-teal-500/60 group-hover:text-teal-600" /><span className="text-[7.5px] font-black uppercase tracking-widest">Définir</span>
            </button>
            <button onClick={() => { triggerStudyRequest(selection.text); closeSelectionMenu(); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-teal-600/10 text-zinc-600 dark:text-zinc-400 hover:text-teal-600 rounded-[18px] transition-all group">
              <Sparkles className="w-4 h-4 text-teal-600/60 group-hover:text-teal-600" /><span className="text-[7.5px] font-black uppercase tracking-widest">Étudier</span>
            </button>
            <button onClick={() => { setNoteSelectorPayload({ text: selection.text, sermon }); closeSelectionMenu(); }} className="flex flex-col items-center gap-0.5 px-3 py-2 hover:bg-emerald-500/10 text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 rounded-[18px] transition-all group">
              <NotebookPen className="w-4 h-4 text-emerald-500/60 group-hover:text-emerald-500" /><span className="text-[7.5px] font-black uppercase tracking-widest">Note</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reader;
