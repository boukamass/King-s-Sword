
import React, { useState, useEffect, useRef, useMemo, useCallback, memo, useTransition } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { getDefinition, WordDefinition } from '../services/dictionaryService';
import { getAccentInsensitiveRegex } from '../utils/textUtils';
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
  Clock,
  Feather, 
  Milestone, 
  MonitorPlay,
  Layers,
  Info,
  History,
  Languages,
  Plus,
  ChevronRight,
  PanelLeftOpen
} from 'lucide-react';

interface SimpleWord {
  text: string;
  segmentIndex: number;
  globalIndex: number;
}

const ActionButton = memo(({ onClick, icon: Icon, tooltip, special = false, active = false, isFullscreen = false, baseFontSize = 20 }: any) => (
  <div className="relative group/btn">
    <button 
      onClick={onClick} 
      data-tooltip={tooltip} 
      className={`flex items-center justify-center transition-all border active:scale-95 shadow-sm ${
        special 
          ? "bg-teal-600/10 text-teal-600 border-teal-600/20" 
          : active 
            ? "bg-teal-600 text-white border-teal-600" 
            : "bg-white/50 dark:bg-zinc-800/50 border-zinc-200/50 dark:border-zinc-800/50 hover:bg-teal-600/5 hover:text-teal-600 hover:border-teal-600/20 text-zinc-400 dark:text-zinc-500"
      }`}
      style={isFullscreen ? { 
        width: '1.5em', 
        height: '1.5em', 
        fontSize: `${baseFontSize * 0.6}px`,
        borderRadius: '0.4em'
      } : { 
        width: '2.25rem', 
        height: '2.25rem',
        borderRadius: '0.75rem'
      }}
    >
      <Icon style={isFullscreen ? { width: '0.8em', height: '0.8em' } : { width: '1rem', height: '1rem' }} />
    </button>
  </div>
));

const WordComponent = memo(({ 
  word, 
  isSearchResult, 
  isCurrentResult, 
  isJumpHighlight, 
  citationColor, 
  highlight, 
  onRemoveHighlight, 
  onRemoveJumpHighlight,
  wordRef, 
  onMouseUp 
}: any) => {
  const highlightColorClass = highlight 
    ? PALETTE_HIGHLIGHT_COLORS[highlight.color || 'amber']
    : (isJumpHighlight || isSearchResult) 
      ? PALETTE_HIGHLIGHT_COLORS['amber'] 
      : '';

  const content = (
    <span 
      ref={wordRef}
      data-global-index={word.globalIndex}
      onMouseUp={onMouseUp}
      className={`transition-all duration-300 ${citationColor || ''} ${
        isCurrentResult 
          ? 'bg-amber-600 shadow-[0_0_12px_rgba(245,158,11,0.5)] text-white px-0.5 rounded-sm font-bold' 
          : (isSearchResult || isJumpHighlight)
            ? 'px-0.5 rounded-sm font-bold'
            : ''
      } ${isSearchResult ? 'underline decoration-amber-600/40 underline-offset-2' : ''}`}
    >
      {word.text}
    </span>
  );

  if (highlight || isJumpHighlight || isSearchResult) {
    const handleRemove = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (highlight) {
        onRemoveHighlight(highlight.id);
      } else {
        onRemoveJumpHighlight();
      }
    };

    return (
      <span 
        onClick={handleRemove}
        data-tooltip={highlight ? "Cliquer pour supprimer" : "Masquer le surlignage intelligent"}
        data-tooltip-icon={highlight ? "trash" : "sparkles"}
        className={`${highlightColorClass} cursor-pointer hover:brightness-105 transition-all py-0.5`}
      >
        {content}
      </span>
    );
  }

  return content;
});

let externalMaskWindow: Window | null = null;
let projectionWindow: Window | null = null;

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const setSidebarOpen = useAppStore(s => s.setSidebarOpen);
  const libraryMode = useAppStore(s => s.libraryMode);
  
  const activeSermon = useAppStore(s => s.activeSermon);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  
  const notes = useAppStore(s => s.notes);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const setActiveNoteId = useAppStore(s => s.setActiveNoteId);
  const isExternalMaskOpen = useAppStore(s => s.isExternalMaskOpen);
  const setExternalMaskOpen = useAppStore(s => s.setExternalMaskOpen);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
  const setProjectionBlackout = useAppStore(s => s.setProjectionBlackout);
  const fontSize = useAppStore(s => s.fontSize);
  const setFontSize = useAppStore(s => s.setFontSize);
  
  const languageFilter = useAppStore(s => s.languageFilter);
  const triggerStudyRequest = useAppStore(s => s.triggerStudyRequest);
  const updateSermonHighlights = useAppStore(s => s.updateSermonHighlights);
  const navigatedFromSearch = useAppStore(s => s.navigatedFromSearch);
  const setNavigatedFromSearch = useAppStore(s => s.setNavigatedFromSearch);
  const navigatedFromNoteId = useAppStore(s => s.navigatedFromNoteId);
  const setNavigatedFromNoteId = useAppStore(s => s.setNavigatedFromNoteId);
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
  const jumpToParagraph = useAppStore(s => s.jumpToParagraph);
  const setJumpToParagraph = useAppStore(s => s.setJumpToParagraph);

  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const aiWidth = useAppStore(s => s.aiWidth);
  const notesWidth = useAppStore(s => s.notesWidth);
  const aiOpen = useAppStore(s => s.aiOpen);
  const notesOpen = useAppStore(s => s.notesOpen);
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const sermon = activeSermon;
  
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [selectionIndices, setSelectionIndices] = useState<number[]>([]);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);
  const [projectedSegmentIndex, setProjectedSegmentIndex] = useState<number | null>(null);
  const [isProjectionOpen, setIsProjectionOpen] = useState(false);
  
  const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
  const [isDefining, setIsDefining] = useState(false);
  const [jumpHighlightIndices, setJumpHighlightIndices] = useState<number[]>([]);
  const [syncToggle, setSyncToggle] = useState(0);

  const [localFontSize, setLocalFontSize] = useState<string | number>(fontSize);
  useEffect(() => {
    setLocalFontSize(fontSize);
  }, [fontSize]);

  const readerAreaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !readerAreaRef.current) {
      setSelectionIndices(prev => prev.length > 0 ? [] : prev);
      return;
    }

    try {
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer.nodeType === 1 
        ? (range.commonAncestorContainer as HTMLElement) 
        : range.commonAncestorContainer.parentElement;

      if (!container || !readerAreaRef.current.contains(container)) return;

      const indices: number[] = [];
      const wordElements = container.querySelectorAll('[data-global-index]');
      
      const selfIdx = container.getAttribute('data-global-index');
      if (selfIdx && sel.containsNode(container, true)) {
          indices.push(parseInt(selfIdx));
      }

      wordElements.forEach(el => {
        if (sel.containsNode(el, true)) {
          const idx = el.getAttribute('data-global-index');
          if (idx) indices.push(parseInt(idx));
        }
      });
      
      setSelectionIndices(prev => {
          if (prev.length === indices.length && prev.every((v, i) => v === indices[i])) return prev;
          return indices;
      });
    } catch (e) {}
  }, []);

  const handleTextSelection = useCallback((e?: React.MouseEvent) => {
    if (e && (e.target as HTMLElement).closest('.selection-menu-container')) {
      return;
    }

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 1 && scrollContainerRef.current) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const scrollContainer = scrollContainerRef.current;
      const scrollRect = scrollContainer.getBoundingClientRect();
      
      const menuHeight = 65; 
      const spaceAbove = rect.top - scrollRect.top;
      
      let x = (rect.left + rect.width / 2) - scrollRect.left;
      let y;

      if (spaceAbove > menuHeight + 20) {
        y = (rect.top - scrollRect.top) + scrollContainer.scrollTop - menuHeight - 12;
      } else {
        y = (rect.bottom - scrollRect.top) + scrollContainer.scrollTop + 12;
      }

      setSelection({ 
        text: sel.toString().trim(), 
        x: x, 
        y: y
      });
    } else {
      if (!e || !(e.target as HTMLElement).closest('.selection-menu-container')) {
        setSelection(null);
      }
    }
  }, []);

  useEffect(() => {
    if (selection) {
      handleTextSelection();
    }
  }, [sidebarWidth, aiWidth, notesWidth, sidebarOpen, aiOpen, notesOpen, handleTextSelection]);

  useEffect(() => {
    if (activeDefinition) {
      setSidebarOpen(false);
    }
  }, [activeDefinition, setSidebarOpen]);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');
    const handleReadyMessage = (e: any) => {
      const data = e.data || e;
      if (data && data.type === 'ready') {
        setSyncToggle(prev => prev + 1);
      }
    };
    broadcastChannel.current.onmessage = handleReadyMessage;

    const handleWindowMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'ready') {
        setSyncToggle(prev => prev + 1);
      }
    };
    window.addEventListener('message', handleWindowMessage);

    const checkWindowStatus = setInterval(() => {
      if (externalMaskWindow && externalMaskWindow.closed) {
        setExternalMaskOpen(false);
        externalMaskWindow = null;
      }
      if (projectionWindow && projectionWindow.closed) {
        projectionWindow = null;
        setIsProjectionOpen(false);
        setProjectedSegmentIndex(null);
      }
    }, 1000);
    
    const handleFullscreenChange = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      
      const maxScroll = container.scrollHeight - container.clientHeight;
      const scrollPct = maxScroll > 0 ? container.scrollTop / maxScroll : 0;

      const isFs = !!document.fullscreenElement;
      setIsOSFullscreen(isFs);
      
      const currentFontSize = useAppStore.getState().fontSize;
      if (isFs) {
        if (currentFontSize === 20) useAppStore.getState().setFontSize(48);
      } else {
        if (currentFontSize === 48) useAppStore.getState().setFontSize(20);
      }

      const restoreScroll = () => {
        const c = scrollContainerRef.current;
        if (c) {
          const newMax = c.scrollHeight - c.clientHeight;
          c.scrollTop = scrollPct * newMax;
        }
      };

      setTimeout(restoreScroll, 50);
      setTimeout(restoreScroll, 150);
      setTimeout(restoreScroll, 400);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      broadcastChannel.current?.close();
      window.removeEventListener('message', handleWindowMessage);
      clearInterval(checkWindowStatus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [setExternalMaskOpen, handleSelectionChange]);

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    if (!sermon?.highlights) return map;
    for (const h of sermon.highlights) {
        for (let i = h.start; i <= h.end; i++) map.set(i, h);
    }
    return map;
  }, [sermon?.highlights]);

  const segments = useMemo(() => {
    if (!sermon || !sermon.text) return [];
    return sermon.text.split(/\n\s*\n/); 
  }, [sermon?.id]);

  const structuredSegments = useMemo(() => {
    const result: { words: SimpleWord[]; isNumbered: boolean; text: string }[] = [];
    let globalIdx = 0;
    segments.forEach((seg, segIdx) => {
        const segWords: SimpleWord[] = [];
        const tokens = seg.split(/(\s+)/);
        tokens.forEach(token => {
            if (token !== "") segWords.push({ text: token, segmentIndex: segIdx, globalIndex: globalIdx++ });
        });
        const isNumbered = /^\d+/.test(seg.trim());
        result.push({ words: segWords, isNumbered, text: seg });
    });
    return result;
  }, [segments]);

  const words = useMemo(() => structuredSegments.flatMap(s => s.words), [structuredSegments]);

  const getProjectionPayload = useCallback((targetSegmentIdx?: number | null) => {
    if (!sermon) return null;
    
    const activeIdx = targetSegmentIdx !== undefined 
      ? targetSegmentIdx 
      : projectedSegmentIndex;
    
    if (activeIdx === null || activeIdx < 0 || !structuredSegments[activeIdx]) {
      return {
        type: 'sync',
        title: sermon.title || '',
        date: sermon.date || '',
        city: sermon.city || '',
        time: sermon.time || '',
        text: '',
        projectedWords: [],
        fontSize,
        theme,
        blackout: projectionBlackout,
        highlights: sermon.highlights || [],
        selectionIndices: [],
        searchResults: [],
        currentResultIndex: -1,
        activeDefinition: null
      };
    }

    const activeText = (structuredSegments[activeIdx]?.text || segments[activeIdx] || "").trim();

    let projectedWordsData: { text: string; globalIndex: number; color?: string }[] = [];
    if (structuredSegments[activeIdx]) {
      const seg = structuredSegments[activeIdx];
      const selectionSet = new Set(selectionIndices);
      projectedWordsData = seg.words.map(w => {
        const h = highlightMap.get(w.globalIndex);
        const isJump = jumpHighlightIndices.includes(w.globalIndex);
        const isSearch = searchResults.includes(w.globalIndex);
        
        return {
          text: w.text,
          globalIndex: w.globalIndex,
          color: selectionSet.has(w.globalIndex) 
            ? 'selection' 
            : (h ? (h.color || 'amber') : (isJump || isSearch ? 'amber' : undefined))
        };
      });
    }

    return {
      type: 'sync',
      title: sermon.title || '',
      date: sermon.date || '',
      city: sermon.city || '',
      time: sermon.time || '',
      text: activeText,
      projectedWords: projectedWordsData,
      fontSize,
      theme,
      blackout: projectionBlackout,
      highlights: sermon.highlights || [],
      selectionIndices,
      searchResults,
      currentResultIndex,
      activeDefinition
    };
  }, [sermon, projectedSegmentIndex, structuredSegments, segments, selectionIndices, highlightMap, jumpHighlightIndices, searchResults, currentResultIndex, activeDefinition, fontSize, theme, projectionBlackout]);

  const prevSermonIdRef = useRef(sermon?.id);
  useEffect(() => {
    if (sermon?.id !== prevSermonIdRef.current) {
      prevSermonIdRef.current = sermon?.id;
      setProjectedSegmentIndex(null);
    }
  }, [sermon?.id]);

  useEffect(() => {
    if (sermon && projectedSegmentIndex !== null) {
      const payload = getProjectionPayload(projectedSegmentIndex);
      if (payload) {
        if (broadcastChannel.current) {
          try { broadcastChannel.current.postMessage(payload); } catch (e) {}
        }
        try {
          localStorage.setItem('kings_sword_last_projection_sync', JSON.stringify(payload));
        } catch (e) {}
        if (projectionWindow && !projectionWindow.closed) {
          try { projectionWindow.postMessage(payload, '*'); } catch (e) {}
        }
      }
    }
  }, [projectedSegmentIndex, getProjectionPayload, syncToggle]);

  const stopProjection = useCallback(() => {
    if (projectionWindow) {
      try {
        if (!projectionWindow.closed) {
          projectionWindow.close();
        }
      } catch (e) {}
    }
    projectionWindow = null;
    setIsProjectionOpen(false);
    setProjectedSegmentIndex(null);
    if (broadcastChannel.current) {
      try {
        broadcastChannel.current.postMessage({ type: 'close' });
      } catch (e) {}
    }
    try {
      localStorage.removeItem('kings_sword_last_projection_sync');
    } catch (e) {}
  }, []);

  const toggleProjection = useCallback((initialSegmentIdx?: number) => {
    const targetIdx = typeof initialSegmentIdx === 'number' ? initialSegmentIdx : undefined;
    const isWindowActive = Boolean(projectionWindow && !projectionWindow.closed);

    if (isWindowActive) {
      if (targetIdx !== undefined) {
        setProjectedSegmentIndex(targetIdx);
        const payload = getProjectionPayload(targetIdx);
        if (payload) {
          if (broadcastChannel.current) {
            try { broadcastChannel.current.postMessage(payload); } catch (e) {}
          }
          try { localStorage.setItem('kings_sword_last_projection_sync', JSON.stringify(payload)); } catch (e) {}
          try { projectionWindow?.postMessage(payload, '*'); } catch (e) {}
        }
      } else {
        stopProjection();
      }
      return;
    }

    // Window is NOT active -> open new projection window synchronously
    setIsProjectionOpen(false);
    projectionWindow = null;

    const firstNonEmptyIdx = structuredSegments.findIndex(s => s.text.trim().length > 0);
    const defaultIdx = firstNonEmptyIdx !== -1 ? firstNonEmptyIdx : (structuredSegments.length > 0 ? 0 : null);

    const effectiveIdx = targetIdx !== undefined 
      ? targetIdx 
      : (projectedSegmentIndex !== null ? projectedSegmentIndex : defaultIdx);
    
    if (effectiveIdx !== null) {
      setProjectedSegmentIndex(effectiveIdx);
    }

    const payload = getProjectionPayload(effectiveIdx);
    if (payload) {
      try {
        localStorage.setItem('kings_sword_last_projection_sync', JSON.stringify(payload));
      } catch (e) {}
    }

    // Build URL for projection window
    const url = new URL(window.location.href);
    url.searchParams.set('projection', 'true');

    const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : (window.screenX || 0);
    const dualScreenTop = window.screenTop !== undefined ? window.screenTop : (window.screenY || 0);
    const currentWidth = window.outerWidth || window.innerWidth || (window.screen?.availWidth || 1920);

    let left = dualScreenLeft + currentWidth;
    let top = dualScreenTop;
    let targetWidth = window.screen?.availWidth || 1920;
    let targetHeight = window.screen?.availHeight || 1080;

    const windowFeatures = `popup=yes,fullscreen=yes,frame=no,titlebar=no,scrollbars=no,menubar=no,toolbar=no,location=no,status=no,resizable=no,top=${top},left=${left},width=${targetWidth},height=${targetHeight}`;

    try {
      projectionWindow = window.open(url.toString(), 'KingsSwordProjection', windowFeatures);
    } catch (err) {
      projectionWindow = null;
    }

    if (projectionWindow) {
      setIsProjectionOpen(true);
      try {
        projectionWindow.moveTo(left, top);
        projectionWindow.resizeTo(targetWidth, targetHeight);
      } catch (e) {}

      if (payload) {
        if (broadcastChannel.current) {
          try { broadcastChannel.current.postMessage(payload); } catch (e) {}
        }
        try { projectionWindow.postMessage(payload, '*'); } catch (e) {}
      }
      try { projectionWindow.focus(); } catch (e) {}

      // Asynchronously query multi-screen details if browser supports Window Management API
      if ('getScreenDetails' in window || 'queryLocalScreens' in window) {
        const getDetails = (window as any).getScreenDetails || (window as any).queryLocalScreens;
        getDetails().then((screenDetails: any) => {
          if (screenDetails && screenDetails.screens && screenDetails.screens.length > 1 && projectionWindow && !projectionWindow.closed) {
            const current = screenDetails.currentScreen;
            const secondary = screenDetails.screens.find((s: any) => s !== current || !s.isPrimary) || screenDetails.screens[1];
            if (secondary) {
              const secLeft = secondary.availLeft ?? secondary.left ?? left;
              const secTop = secondary.availTop ?? secondary.top ?? top;
              const secWidth = secondary.availWidth ?? secondary.width ?? targetWidth;
              const secHeight = secondary.availHeight ?? secondary.height ?? targetHeight;
              try {
                projectionWindow.moveTo(secLeft, secTop);
                projectionWindow.resizeTo(secWidth, secHeight);
              } catch (e) {}
            }
          }
        }).catch(() => {});
      }
    } else {
      setIsProjectionOpen(false);
    }
  }, [projectedSegmentIndex, structuredSegments, getProjectionPayload, stopProjection]);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  useEffect(() => {
    if (sermon?.id && !jumpToText && !jumpToParagraph && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
        setProjectedSegmentIndex(null);
        setJumpHighlightIndices([]);
    }
  }, [sermon?.id]);

  useEffect(() => {
    if (jumpToParagraph !== null && sermon && structuredSegments.length > 0) {
        const segmentIdx = jumpToParagraph - 1;
        const segment = structuredSegments[segmentIdx];
        if (segment) {
            setTimeout(() => {
                const segEl = segmentRefs.current.get(segmentIdx);
                if (segEl) {
                    let targetGlobalIndex = segment.words[0].globalIndex;
                    let targetHighlightIndices: number[] = [];
                    
                    if (lastSearchQuery) {
                        const regex = getAccentInsensitiveRegex(lastSearchQuery, lastSearchMode === SearchMode.EXACT_WORDS);
                        const paraText = segment.words.map(w => w.text).join('');
                        const match = regex.exec(paraText);
                        if (match) {
                            let currentChar = 0;
                            let foundFirst = false;
                            for (const w of segment.words) {
                                if (currentChar + w.text.length > match.index && currentChar < match.index + match[0].length) {
                                    targetHighlightIndices.push(w.globalIndex);
                                    if (!foundFirst) { targetGlobalIndex = w.globalIndex; foundFirst = true; }
                                }
                                currentChar += w.text.length;
                            }
                        }
                    }
                    
                    if (targetHighlightIndices.length > 0) setJumpHighlightIndices(targetHighlightIndices);
                    else setJumpHighlightIndices(segment.words.map(w => w.globalIndex));

                    const targetEl = wordRefs.current.get(targetGlobalIndex);
                    if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    else if (segEl) segEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 150);
        }
        setJumpToParagraph(null);
    }
  }, [jumpToParagraph, sermon, structuredSegments, setJumpToParagraph, lastSearchQuery, lastSearchMode]);

  useEffect(() => {
    if (jumpToText && sermon && words.length > 0) {
        const regex = getAccentInsensitiveRegex(jumpToText, false);
        const fullSermonText = words.map(w => w.text).join('');
        const matchIndices: number[] = [];
        const match = regex.exec(fullSermonText);
        if (match) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;
            let firstWordIndex = -1;
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > startChar && currentChar < endChar) {
                    matchIndices.push(words[i].globalIndex);
                    if (firstWordIndex === -1) firstWordIndex = words[i].globalIndex;
                }
                currentChar += wordLen;
            }
            if (firstWordIndex !== -1) {
                setJumpHighlightIndices(matchIndices);
                setTimeout(() => {
                    wordRefs.current.get(firstWordIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
        }
        setJumpToText(null);
    }
  }, [jumpToText, sermon, words, setJumpToText]);
  
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
            const colorClass = PALETTE_HIGHLIGHT_COLORS[activeNote.color || 'default'];
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                if (currentChar + words[i].text.length > match.index && currentChar < match.index + match[0].length) map.set(words[i].globalIndex, { colorClass });
                currentChar += words[i].text.length;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
    }
    return map;
  }, [activeNoteId, notes, sermon?.id, words]);

  useEffect(() => {
    if (readerSearchQuery.length >= 1) {
      startTransition(() => {
        const regex = getAccentInsensitiveRegex(readerSearchQuery, false);
        const fullSermonText = words.map(w => w.text).join('');
        const results = [];
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > match.index) {
                  results.push(words[i].globalIndex);
                  break;
                }
                currentChar += wordLen;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        setSearchResults(results);
        setCurrentResultIndex(results.length > 0 ? 0 : -1);
      });
    } else { setSearchResults([]); setCurrentResultIndex(-1); }
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
      } else audioRef.current.pause();
    } catch (err) {}
    finally { playPromiseRef.current = null; }
  }, []);

  const seek = (seconds: number) => {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
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
        link.href = sermon.audio_url; link.target = "_blank"; link.download = `${sermon.title}.mp3`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }
  };

  const handleHighlight = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sermon || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const getIndexFromNode = (node: Node, offset: number): number | null => {
      const wordEl = node.parentElement?.closest('[data-global-index]');
      if (wordEl) return parseInt(wordEl.getAttribute('data-global-index') || '0');
      const segEl = node.parentElement?.closest('[data-seg-idx]');
      if (!segEl) return null;
      const segIdx = parseInt(segEl.getAttribute('data-seg-idx') || '0');
      const segment = structuredSegments[segIdx];
      if (!segment) return null;
      let charOffsetInSegment = 0;
      const children = segEl.childNodes;
      for (let i = 0; i < children.length; i++) {
        if (children[i] === node) { charOffsetInSegment += offset; break; }
        charOffsetInSegment += children[i].textContent?.length || 0;
      }
      let currentPos = 0;
      for (const w of segment.words) {
        if (currentPos + w.text.length > charOffsetInSegment) return w.globalIndex;
        currentPos += w.text.length;
      }
      return segment.words[segment.words.length - 1].globalIndex;
    };
    const start = getIndexFromNode(range.startContainer, range.startOffset);
    const end = getIndexFromNode(range.endContainer, range.endOffset);
    if (start !== null && end !== null) {
      const newHighlight: Highlight = { id: crypto.randomUUID(), start: Math.min(start, end), end: Math.max(start, end), color: 'amber' };
      updateSermonHighlights(sermon.id, [...(sermon.highlights || []), newHighlight]);
      setSelection(null); sel.removeAllRanges();
    }
  }, [sermon, structuredSegments, updateSermonHighlights]);

  const handleRemoveHighlight = useCallback((id: string) => {
    if (!sermon) return;
    updateSermonHighlights(sermon.id, (sermon.highlights || []).filter(h => h.id !== id));
  }, [sermon, updateSermonHighlights]);

  const handleRemoveJumpHighlight = useCallback(() => {
    setJumpHighlightIndices([]);
  }, []);

  const handleCopy = useCallback(() => {
    if (selection) {
      navigator.clipboard.writeText(selection.text);
      addNotification(t.copy_success, "success");
    }
  }, [selection, addNotification, t.copy_success]);

  const handleDefine = async () => {
    if (!selection) return;
    const word = selection.text.split(' ')[0].replace(/[.,;?!]/g, "");
    setIsDefining(true); setSelection(null);
    try {
      const def = await getDefinition(word);
      setActiveDefinition(def);
    } catch (err: any) { addNotification(err.message || "Erreur", "error"); }
    finally { setIsDefining(false); }
  };

  const handleAddDefinitionToNote = () => {
    if (!activeDefinition) return;
    const defText = `**${activeDefinition.word}**\n\n${activeDefinition.definition}\n\n*Étymologie :* ${activeDefinition.etymology || 'Non spécifiée'}\n*Synonymes :* ${activeDefinition.synonyms.join(', ')}`;
    setNoteSelectorPayload({
      text: defText,
      sermon: {
        id: `definition-${activeDefinition.word}`,
        title: 'Définition du Dictionnaire',
        date: new Date().toISOString().split('T')[0],
        city: 'Système',
        text: ''
      }
    });
    setActiveDefinition(null);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    return `${Math.floor(time/60)}:${Math.floor(time%60).toString().padStart(2,'0')}`;
  };

  const interactiveIndices = useMemo(() => {
    const set = new Set<number>();
    highlightMap.forEach((_, k) => set.add(k));
    citationHighlightMap.forEach((_, k) => set.add(k));
    searchResults.forEach(idx => set.add(idx));
    jumpHighlightIndices.forEach(idx => set.add(idx));
    selectionIndices.forEach(idx => set.add(idx));
    return set;
  }, [highlightMap, citationHighlightMap, searchResults, jumpHighlightIndices, selectionIndices]);

  const handleProjectSegment = useCallback((idx: number, isExplicitToggle = false) => {
    // ONLY explicit projection buttons (verse projection icon, toolbar button, prev/next controls) trigger projection!
    if (!isExplicitToggle) return;

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      return;
    }

    const isWindowActive = Boolean(projectionWindow && !projectionWindow.closed);

    if (projectedSegmentIndex === idx) {
      setProjectedSegmentIndex(null);
      const payload = getProjectionPayload(null);
      if (payload) {
        if (broadcastChannel.current) {
          try { broadcastChannel.current.postMessage(payload); } catch (e) {}
        }
        try { localStorage.setItem('kings_sword_last_projection_sync', JSON.stringify(payload)); } catch (e) {}
        if (projectionWindow && !projectionWindow.closed) {
          try { projectionWindow.postMessage(payload, '*'); } catch (e) {}
        }
      }
    } else {
      setProjectedSegmentIndex(idx);
      if (!isWindowActive) {
        toggleProjection(idx);
      } else {
        const payload = getProjectionPayload(idx);
        if (payload) {
          if (broadcastChannel.current) {
            try { broadcastChannel.current.postMessage(payload); } catch (e) {}
          }
          try { localStorage.setItem('kings_sword_last_projection_sync', JSON.stringify(payload)); } catch (e) {}
          try { projectionWindow?.postMessage(payload, '*'); } catch (e) {}
        }
      }
    }
  }, [projectedSegmentIndex, toggleProjection, getProjectionPayload]);

  const handleProjectNextSegment = useCallback(() => {
    if (!structuredSegments || structuredSegments.length === 0) return;
    if (projectedSegmentIndex === null) {
      const firstNonEmpty = structuredSegments.findIndex(s => s.text.trim().length > 0);
      handleProjectSegment(firstNonEmpty !== -1 ? firstNonEmpty : 0, true);
    } else if (projectedSegmentIndex < structuredSegments.length - 1) {
      let next = projectedSegmentIndex + 1;
      while (next < structuredSegments.length && structuredSegments[next].text.trim() === '') {
        next++;
      }
      if (next < structuredSegments.length) handleProjectSegment(next, true);
    }
  }, [projectedSegmentIndex, structuredSegments, handleProjectSegment]);

  const handleProjectPrevSegment = useCallback(() => {
    if (!structuredSegments || structuredSegments.length === 0 || projectedSegmentIndex === null) return;
    if (projectedSegmentIndex > 0) {
      let prev = projectedSegmentIndex - 1;
      while (prev > 0 && structuredSegments[prev].text.trim() === '') {
        prev--;
      }
      if (prev >= 0 && structuredSegments[prev].text.trim() !== '') handleProjectSegment(prev, true);
    }
  }, [projectedSegmentIndex, structuredSegments, handleProjectSegment]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);

      if (e.key === 'Escape') {
        setSelection(null);
        setActiveDefinition(null);
        setIsSearchVisible(false);
        window.getSelection()?.removeAllRanges();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchVisible(true);
      }

      // Remote controls and scroll for projection window from reader
      if (!isInput && isProjectionOpen) {
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          setProjectionBlackout(!useAppStore.getState().projectionBlackout);
        } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
          e.preventDefault();
          handleProjectNextSegment();
        } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
          e.preventDefault();
          handleProjectPrevSegment();
        } else if (broadcastChannel.current) {
          if (e.shiftKey && e.key === 'PageDown') {
            e.preventDefault();
            broadcastChannel.current.postMessage({ type: 'scroll', direction: 'down', amount: 0.45 });
          } else if (e.shiftKey && e.key === 'PageUp') {
            e.preventDefault();
            broadcastChannel.current.postMessage({ type: 'scroll', direction: 'up', amount: 0.45 });
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProjectionOpen, handleProjectNextSegment, handleProjectPrevSegment, setProjectionBlackout]);

  const renderSegmentContent = useCallback((segWords: SimpleWord[]) => {
    const elements: React.ReactNode[] = [];
    let textBuffer = "";
    segWords.forEach((word) => {
      if (interactiveIndices.has(word.globalIndex)) {
        if (textBuffer) { elements.push(textBuffer); textBuffer = ""; }
        elements.push(
          <WordComponent 
            key={word.globalIndex} 
            word={word} 
            wordRef={(el: any) => { if(el) wordRefs.current.set(word.globalIndex, el); }} 
            isSearchResult={searchResults.includes(word.globalIndex)} 
            isCurrentResult={searchResults[currentResultIndex] === word.globalIndex} 
            isJumpHighlight={jumpHighlightIndices.includes(word.globalIndex)} 
            citationColor={citationHighlightMap.get(word.globalIndex)?.colorClass} 
            highlight={highlightMap.get(word.globalIndex)} 
            onRemoveHighlight={handleRemoveHighlight} 
            onRemoveJumpHighlight={handleRemoveJumpHighlight} 
            onMouseUp={handleTextSelection} 
          />
        );
      } else textBuffer += word.text;
    });
    if (textBuffer) elements.push(textBuffer);
    return elements;
  }, [interactiveIndices, searchResults, currentResultIndex, jumpHighlightIndices, citationHighlightMap, highlightMap, handleRemoveHighlight, handleRemoveJumpHighlight, handleTextSelection]);

  const handleSearchNext = () => {
    if (searchResults.length === 0) return;
    setCurrentResultIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : 0));
  };

  const handleSearchPrev = () => {
    if (searchResults.length === 0) return;
    setCurrentResultIndex(prev => (prev > 0 ? prev - 1 : searchResults.length - 1));
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) handleSearchPrev();
      else handleSearchNext();
    }
  };

  const ThemeIcon = theme === 'light' ? Sun : Moon;

  if (!selectedSermonId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-zinc-950 relative">
        <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center bg-slate-50/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print">
          {!sidebarOpen && (
            <button 
              onClick={toggleSidebar} 
              data-tooltip="Ouvrir la bibliothèque"
              title="Ouvrir la bibliothèque"
              className="flex items-center gap-2.5 text-zinc-600 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 transition-all p-1.5 rounded-xl hover:bg-slate-200/50 dark:hover:bg-zinc-900"
            >
              <PanelLeftOpen className="w-5 h-5 text-teal-600" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">{t.sidebar_subtitle}</span>
            </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center group cursor-default">
          <div className="relative mb-8 transition-transform duration-700 group-hover:scale-110">
            <div className="absolute inset-0 bg-teal-600/20 blur-[60px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <BookOpenCheck className="w-20 h-20 text-zinc-300 dark:text-zinc-800 transition-colors duration-700 group-hover:text-teal-600/50 relative z-10" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-[0.5em] text-zinc-400 dark:text-zinc-600 transition-all duration-700 group-hover:text-teal-600/60 group-hover:tracking-[0.6em]">
            {t.reader_select_prompt}
          </p>
        </div>
      </div>
    );
  }

  if (!sermon) return <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-zinc-950"><Loader2 className="w-10 h-10 animate-spin text-teal-600" /></div>;

  return (
    <div ref={readerAreaRef} className="flex-1 flex flex-col h-full relative bg-slate-50 dark:bg-zinc-950 reader-selection-area">
      <style>{`
        .reader-selection-area ::selection { background-color: black !important; color: white !important; }
        .dark .reader-selection-area ::selection { background-color: white !important; color: black !important; }
      `}</style>
      
      {noteSelectorPayload && <NoteSelectorModal selectionText={noteSelectorPayload.text} sermon={noteSelectorPayload.sermon} paragraphIndex={noteSelectorPayload.paragraphIndex} onClose={() => setNoteSelectorPayload(null)} />}
      
      {activeDefinition && (
        <div className="fixed inset-0 z-[100000] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setActiveDefinition(null)}>
          <div className="bg-slate-50 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 rounded-[40px] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden max-w-md w-full max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-10 pt-10 pb-6 flex items-center justify-between shrink-0 bg-white/5 dark:bg-zinc-900/5 backdrop-blur-sm border-b border-zinc-200/20 dark:border-zinc-800/20">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-[28px] border border-teal-600/20 shadow-inner group transition-transform hover:scale-105">
                  <BookOpenCheck className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-[0.4em] mb-1">Dictionnaire</h3>
                  <p className="text-3xl font-black text-zinc-900 dark:text-white leading-none tracking-tight">{activeDefinition?.word}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleAddDefinitionToNote}
                  data-tooltip="Ajouter au journal"
                  className="w-12 h-12 flex items-center justify-center text-zinc-500 hover:text-teal-600 bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 hover:border-teal-600/30 transition-all active:scale-90 shadow-sm"
                >
                  <NotebookPen className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setActiveDefinition(null)} 
                  className="w-12 h-12 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 hover:border-red-500/20 transition-all active:scale-90 shadow-sm"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 px-10 py-8 overflow-y-auto custom-scrollbar bg-slate-50/30 dark:bg-zinc-950/20">
              <div className="space-y-10 pb-6">
                <section className="animate-in slide-in-from-bottom-2 duration-500">
                  <div className="flex items-center gap-2 mb-4">
                    <div style={{ fontSize: 'inherit' }}><Info className="w-[1.2em] h-[1.2em] text-teal-600/50" /></div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Définition & Sens</h4>
                  </div>
                  <div className="p-8 bg-white dark:bg-zinc-800/40 border border-teal-600/10 dark:border-teal-600/5 rounded-[32px] shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-600/20 group-hover:bg-teal-600 transition-colors duration-500" />
                    <p className="text-[18px] leading-relaxed text-zinc-800 dark:text-zinc-100 font-medium serif-text italic">{activeDefinition.definition}</p>
                  </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <section className="animate-in slide-in-from-bottom-2 duration-700">
                    <div className="flex items-center gap-2 mb-4 px-2">
                      <div style={{ fontSize: 'inherit' }}><History className="w-[1.2em] h-[1.2em] text-teal-600/50" /></div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Étymologie</h4>
                    </div>
                    <div className="p-6 bg-zinc-100/50 dark:bg-zinc-800/20 border border-zinc-200/50 dark:border-zinc-700/50 rounded-3xl min-h-[80px]">
                      <p className="text-[14px] leading-relaxed text-zinc-600 dark:text-zinc-400 font-medium italic">
                        {activeDefinition.etymology || "Détails historiques non répertoriés."}
                      </p>
                    </div>
                  </section>

                  <section className="animate-in slide-in-from-bottom-2 duration-700 delay-100">
                    <div className="flex items-center gap-2 mb-4 px-2">
                      <div style={{ fontSize: 'inherit' }}><Languages className="w-[1.2em] h-[1.2em] text-teal-600/50" /></div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Synonymes</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeDefinition.synonyms.length > 0 ? (
                        activeDefinition.synonyms.map((syn, idx) => (
                          <span 
                            key={idx} 
                            className="px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-[12px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-tight shadow-sm transition-all hover:scale-105 hover:border-teal-600/30 cursor-default"
                          >
                            {syn}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12px] font-medium text-zinc-400 italic">Aucun synonyme trouvé.</span>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
            
            <div className="px-10 py-6 shrink-0 bg-zinc-100/50 dark:bg-zinc-950/40 border-t border-zinc-200/20 dark:border-zinc-800/20 flex items-center justify-center">
               <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-[0.4em] flex items-center gap-3">
                 <Milestone className="w-2.5 h-2.5" />
                 Source : King's Sword Dictionnaire IA
               </p>
            </div>
          </div>
        </div>
      )}
      
      <div className={`px-4 md:px-8 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl z-[100001] no-print overflow-visible-important transition-all duration-300 ${isOSFullscreen ? 'min-h-[3.5rem] h-auto py-6' : 'h-14'}`}>
        <div className="flex items-center gap-4 min-w-0 flex-1 overflow-visible-important">
          {!sidebarOpen && (
            <button 
              onClick={toggleSidebar} 
              data-tooltip="Ouvrir la bibliothèque"
              title="Ouvrir la bibliothèque"
              className="p-2 text-zinc-500 hover:text-teal-600 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-teal-500/30 shadow-sm transition-all shrink-0 active:scale-95 cursor-pointer mr-1"
            >
              <PanelLeftOpen className="w-4 h-4 text-teal-600" />
            </button>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <h1 
              className={`font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight transition-all leading-tight ${isOSFullscreen ? '' : 'truncate'}`}
              style={{ fontSize: isOSFullscreen ? `${fontSize * 0.6}px` : '16px' }}
            >
              {sermon.title}
            </h1>
            <div 
              className="flex items-center gap-x-2 gap-y-1 font-bold text-zinc-400 uppercase tracking-wider leading-none mt-1 transition-all flex-wrap"
              style={{ fontSize: isOSFullscreen ? `${Math.max(10, fontSize * 0.3)}px` : '9px' }}
            >
              <div className="flex items-center gap-1"><Calendar style={{ width: '1em', height: '1em' }} className="text-teal-600" /><span>{sermon.date}</span></div>
              {sermon.time && <div className="flex items-center gap-1"><span className="w-1 h-1 bg-zinc-300 rounded-full mx-1" /><Clock style={{ width: '1em', height: '1em' }} className="text-teal-600" /><span>{sermon.time}</span></div>}
              <div className="flex items-center gap-1"><span className="w-1 h-1 bg-zinc-300 rounded-full mx-1" /><MapPin style={{ width: '1em', height: '1em' }} className="text-teal-600" /><span>{sermon.city}</span></div>
            </div>
          </div>
        </div>
        <div 
          className="flex items-center shrink-0 ml-4 overflow-visible-important flex-wrap justify-end"
          style={isOSFullscreen ? { gap: '0.25em' } : { gap: '0.5rem' }}
        >
            {navigatedFromSearch && (
              <button 
                onClick={() => { startTransition(() => { setSearchQuery(lastSearchQuery); setIsFullTextSearch(true); setSelectedSermonId(null); setNavigatedFromSearch(false); }); }} 
                className="bg-amber-600/10 text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider rounded-xl flex items-center justify-center transition-all"
                style={isOSFullscreen ? { fontSize: `${fontSize * 0.3}px`, padding: '0.8em 1.2em', borderRadius: '0.8em', minHeight: '1.8em' } : { fontSize: '9px', padding: '0.375rem 0.75rem' }}
              >
                <ChevronLeft className="inline mr-1" style={isOSFullscreen ? { width: '1em', height: '1em' } : { width: '12px', height: '12px' }} /> 
                {t.reader_exit_search}
              </button>
            )}
            <ActionButton 
              onClick={() => {
                const s = useAppStore.getState();
                if (s.sidebarOpen && s.libraryMode === 'bible') {
                  s.toggleSidebar();
                } else {
                  s.setLibraryMode('bible');
                  if (!s.sidebarOpen) s.setSidebarOpen(true);
                }
              }} 
              icon={BookOpen} 
              tooltip={sidebarOpen && libraryMode === 'bible' ? "Fermer la bibliothèque (Bible)" : "Sainte Bible (Louis Segond 1910)"} 
              active={sidebarOpen && libraryMode === 'bible'}
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />
            <ActionButton onClick={() => setIsSearchVisible(!isSearchVisible)} icon={Search} tooltip={t.reader_search_tooltip} active={isSearchVisible} isFullscreen={isOSFullscreen} baseFontSize={fontSize} />
            <ActionButton onClick={togglePlay} icon={isPlaying ? Pause : Play} tooltip={isPlaying ? t.tooltip_pause : t.tooltip_play} active={isPlaying} isFullscreen={isOSFullscreen} baseFontSize={fontSize} />
            <ActionButton onClick={() => toggleProjection()} icon={MonitorPlay} tooltip="Projeter" active={isProjectionOpen} special={isProjectionOpen} isFullscreen={isOSFullscreen} baseFontSize={fontSize} />
            <ActionButton onClick={handleFullscreenToggle} icon={isOSFullscreen ? Minimize : Maximize} tooltip="Plein écran" special={isOSFullscreen} isFullscreen={isOSFullscreen} baseFontSize={fontSize} />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} icon={ThemeIcon} tooltip={theme === 'light' ? "Passer au thème sombre" : "Passer au thème clair"} active={theme === 'dark'} isFullscreen={isOSFullscreen} baseFontSize={fontSize} />
            <div 
              className="flex items-center bg-white/50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-zinc-800/50 no-print overflow-hidden transition-all"
              style={isOSFullscreen ? { fontSize: `${fontSize * 0.6}px`, borderRadius: '0.5em', height: '1.5em' } : { borderRadius: '0.75rem' }}
            >
              <button onClick={() => setFontSize(s => s - 2)} className={`flex items-center justify-center text-zinc-400 hover:text-teal-600 ${isOSFullscreen ? '' : 'w-9 h-9'}`} style={isOSFullscreen ? { width: '1.5em', height: '100%' } : {}}>
                <ZoomOut style={isOSFullscreen ? { width: '0.8em', height: '0.8em' } : { width: '1rem', height: '1rem' }} />
              </button>
              <input type="text" value={localFontSize} onDoubleClick={() => setFontSize(20)} onChange={e => /^\d*$/.test(e.target.value) && setLocalFontSize(e.target.value)} onBlur={() => { const val = parseInt(String(localFontSize), 10); setFontSize(isNaN(val) ? fontSize : val); }} className={`bg-transparent text-center font-black outline-none ${isOSFullscreen ? 'text-white' : 'text-zinc-950 dark:text-white'}`} style={isOSFullscreen ? { width: '2.2em', height: '100%', fontSize: '0.8em' } : { width: '3rem', height: '100%', fontSize: '11px' }} />
              <button onClick={() => setFontSize(s => s + 2)} className={`flex items-center justify-center text-zinc-400 hover:text-teal-600 ${isOSFullscreen ? '' : 'w-9 h-9'}`} style={isOSFullscreen ? { width: '1.5em', height: '100%' } : {}}>
                <ZoomIn style={isOSFullscreen ? { width: '0.8em', height: '0.8em' } : { width: '1rem', height: '1rem' }} />
              </button>
            </div>
        </div>
      </div>

      {isProjectionOpen && (
        <div className="shrink-0 min-h-11 py-1.5 bg-teal-950/95 text-white border-b border-teal-800/80 flex items-center justify-between px-4 md:px-8 z-[100000] animate-in slide-in-from-top-2 duration-200 shadow-lg flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-teal-900/90 px-2.5 py-1 rounded-lg border border-teal-700/60 shadow-inner">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[10px] font-black uppercase tracking-widest text-teal-200">Projection Écran 2 Active</span>
            </div>
            {projectedSegmentIndex !== null ? (
              <span className="text-xs font-bold text-teal-100 flex items-center gap-1.5">
                <span>Contenu projeté :</span>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-mono text-[11px]">
                  Paragraphe #{projectedSegmentIndex + 1}
                </span>
              </span>
            ) : (
              <span className="text-xs font-medium italic text-teal-300/80">
                Aucun paragraphe sélectionné — cliquez sur l'icône de projection à côté d'un paragraphe/verset
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setProjectionBlackout(!projectionBlackout)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all shadow-sm ${
                projectionBlackout 
                  ? 'bg-amber-500 text-black ring-2 ring-amber-400/50 shadow-amber-500/20' 
                  : 'bg-teal-900/90 hover:bg-teal-800 text-teal-100 border border-teal-700/60'
              }`}
              title="Basculer l'écran noir (Raccourci : Alt + B)"
            >
              {projectionBlackout ? <EyeOff className="w-3.5 h-3.5 text-black" /> : <Eye className="w-3.5 h-3.5 text-teal-300" />}
              <span>{projectionBlackout ? 'ÉCRAN NOIR ACTIF' : 'Masquer (Noir)'}</span>
            </button>

            <div className="h-4 w-px bg-teal-800/80 mx-1 hidden sm:block" />

            <button
              onClick={handleProjectPrevSegment}
              disabled={projectedSegmentIndex === null || projectedSegmentIndex === 0}
              className="px-2.5 py-1 bg-teal-900/90 hover:bg-teal-800 disabled:opacity-40 rounded-lg text-xs font-bold text-teal-200 border border-teal-700/60 transition-all flex items-center gap-1"
              title="Projeter le paragraphe précédent (Raccourci : Alt + Flèche Gauche)"
            >
              <ChevronUp className="w-3.5 h-3.5" /> Préc.
            </button>

            <button
              onClick={handleProjectNextSegment}
              className="px-2.5 py-1 bg-teal-900/90 hover:bg-teal-800 rounded-lg text-xs font-bold text-teal-200 border border-teal-700/60 transition-all flex items-center gap-1"
              title="Projeter le paragraphe suivant (Raccourci : Alt + Flèche Droite)"
            >
              Suiv. <ChevronDown className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-teal-800/80 mx-1 hidden sm:block" />

            <button
              onClick={stopProjection}
              className="px-2.5 py-1 hover:bg-red-500/20 text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg transition-all text-xs font-bold flex items-center gap-1 cursor-pointer"
              title="Fermer la projection sur le deuxième écran"
            >
              <X className="w-3.5 h-3.5" /> Quitter
            </button>
          </div>
        </div>
      )}

      {isSearchVisible && (
        <div className="shrink-0 h-14 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 md:px-8 z-[100000] animate-in slide-in-from-top-4 duration-300">
          <div className="max-w-4xl mx-auto w-full flex items-center gap-4">
            <div className="relative flex-1 group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 group-focus-within:text-teal-600 transition-colors" />
              <input 
                autoFocus
                type="text" 
                placeholder={t.reader_search_placeholder}
                value={readerSearchQuery}
                onChange={e => setReaderSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="w-full bg-zinc-100 dark:bg-zinc-800 border-none rounded-xl py-2.5 pl-10 pr-4 text-sm font-bold text-zinc-900 dark:text-white outline-none ring-2 ring-transparent focus:ring-teal-600/20 transition-all"
              />
            </div>
            
            {searchResults.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 px-3 py-1.5 rounded-lg border border-teal-100 dark:border-teal-800/50">
                  {currentResultIndex + 1} / {searchResults.length}
                </span>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={handleSearchPrev}
                    data-tooltip="Précédent (Maj+Entrée)"
                    className="w-9 h-9 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-teal-600 text-zinc-600 dark:text-zinc-300 hover:text-white transition-all active:scale-90"
                  >
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleSearchNext}
                    data-tooltip="Suivant (Entrée)"
                    className="w-9 h-9 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-teal-600 text-zinc-600 dark:text-zinc-300 hover:text-white transition-all active:scale-90"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
            
            <button 
              onClick={() => { setIsSearchVisible(false); setReaderSearchQuery(''); }}
              className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-zinc-100 dark:bg-zinc-800 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden flex justify-center">
        <div ref={scrollContainerRef} onMouseUp={handleTextSelection} className={`absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all ${isOSFullscreen ? 'py-6 px-4 md:px-12' : 'py-12 px-4 md:px-12 lg:px-20'}`}>
          <div className="w-full mx-auto printable-content whitespace-pre-wrap text-justify pb-20 max-w-full" style={{ fontSize: `${fontSize}px` }}>
            {structuredSegments.map((seg, segIdx) => {
              if (seg.text.trim() === '') return null;
              const content = renderSegmentContent(seg.words);
              const isProjected = projectedSegmentIndex === segIdx;

              return (
                <div 
                  key={segIdx} 
                  ref={(el: any) => { if (el) segmentRefs.current.set(segIdx, el); }} 
                  data-seg-idx={segIdx}
                  className={`group/seg relative mb-2.5 py-3 px-6 rounded-[20px] transition-all ${
                    seg.isNumbered ? 'border-l-[5px]' : 'border-l-[3px]'
                  } ${
                    isProjected 
                      ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30 shadow-sm' 
                      : seg.isNumbered
                        ? 'bg-slate-50 dark:bg-zinc-900/50 border-teal-600/20 dark:border-zinc-800 hover:border-teal-600/50 hover:bg-teal-500/5'
                        : 'bg-slate-50/60 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800 hover:border-teal-600/40 hover:bg-teal-500/5'
                  }`}
                >
                  <div className="absolute -left-[54px] top-1/2 -translate-y-1/2 opacity-0 group-hover/seg:opacity-100 transition-all no-print flex flex-col gap-2 z-30">
                      <div 
                        onClick={(e) => { e.stopPropagation(); handleProjectSegment(segIdx, true); }} 
                        className={`w-9 h-9 flex items-center justify-center rounded-xl shadow-lg transition-transform active:scale-90 cursor-pointer ${
                          isProjected ? 'bg-amber-500 text-black font-bold' : 'bg-teal-600 hover:bg-teal-500 text-white'
                        }`}
                        title={isProjected ? "Arrêter la projection de ce paragraphe" : "Projeter ce paragraphe"}
                      >
                        <MonitorPlay className="w-4 h-4" />
                      </div>
                      <div 
                        onClick={(e) => { e.stopPropagation(); setNoteSelectorPayload({ text: seg.text.trim(), sermon, paragraphIndex: segIdx + 1 }); }} 
                        className="w-9 h-9 flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg transition-transform active:scale-90 cursor-pointer"
                        title="Ajouter au journal de notes"
                      >
                        <NotebookPen className="w-4 h-4" />
                      </div>
                  </div>
                  {isProjected && (
                    <div className="flex items-center gap-2 mb-2.5 no-print">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleProjectSegment(segIdx, true); }}
                        className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md shadow-sm transition-all cursor-pointer"
                        title="Cliquer pour désactiver la projection"
                      >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        <span>EN PROJECTION SUR ÉCRAN 2</span>
                      </button>
                    </div>
                  )}
                  {content}
                </div>
              );
            })}
          </div>

          {selection && !isOSFullscreen && (
            <div 
              className="absolute z-[200000] no-print selection-menu-container animate-in fade-in zoom-in-95 duration-200 ease-out antialiased" 
              style={{ 
                left: Math.round(selection.x), 
                top: Math.round(selection.y), 
                transform: 'translateX(-50%) translateZ(0)' 
              }}
            >
              <div className="flex items-stretch bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl p-1 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.1)] pointer-events-auto border border-white/30 dark:border-white/10 overflow-hidden transform-gpu">
                <button onClick={handleHighlight} className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 hover:bg-amber-500/15 text-zinc-800 dark:text-zinc-200 hover:text-amber-700 dark:hover:text-amber-400 rounded-lg active:scale-95 group transition-colors">
                  <Highlighter className="w-4 h-4 text-amber-500" /><span className="text-[8.5px] font-bold uppercase tracking-tight">Surligner</span>
                </button>
                <div className="w-px bg-zinc-200/60 dark:bg-zinc-700/60 my-2 mx-0.5" />
                <button onClick={() => { handleCopy(); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 hover:bg-zinc-500/10 text-zinc-800 dark:text-zinc-200 rounded-lg active:scale-95 transition-colors"><Copy className="w-4 h-4 text-zinc-500" /><span className="text-[8.5px] font-bold uppercase tracking-tight">Copier</span></button>
                <div className="w-px bg-zinc-200/60 dark:bg-zinc-700/60 my-2 mx-0.5" />
                <button onClick={() => { handleDefine(); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 hover:bg-sky-500/15 text-zinc-800 dark:text-zinc-200 rounded-lg active:scale-95 transition-colors"><BookOpen className="w-4 h-4 text-sky-500" /><span className="text-[8.5px] font-bold uppercase tracking-tight">Définir</span></button>
                <button onClick={() => { triggerStudyRequest(selection.text); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 hover:bg-teal-600/15 text-zinc-800 dark:text-zinc-200 rounded-lg active:scale-95 transition-colors"><Sparkles className="w-4 h-4 text-teal-600 animate-pulse" /><span className="text-[8.5px] font-bold uppercase tracking-tight">Étudier</span></button>
                <div className="w-px bg-zinc-200/60 dark:bg-zinc-700/60 my-2 mx-0.5" />
                <button onClick={() => { setNoteSelectorPayload({ text: selection.text, sermon }); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 hover:bg-emerald-500/15 text-zinc-800 dark:text-zinc-200 rounded-lg active:scale-95 transition-colors"><NotebookPen className="w-4 h-4 text-emerald-500" /><span className="text-[8.5px] font-bold uppercase tracking-tight">Note</span></button>
              </div>
            </div>
          )}
        </div>
        {sermon.audio_url && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center no-print z-50 overflow-visible-important">
              <audio ref={audioRef} src={sermon.audio_url} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} onEnded={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
              <div onMouseEnter={() => setIsPlayerExpanded(true)} onMouseLeave={() => setIsPlayerExpanded(false)} className={`transition-all duration-500 flex items-center bg-slate-50/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-2xl rounded-full ${isPlayerExpanded ? 'w-[320px] sm:w-[620px] h-12 px-4' : 'w-10 h-10'} ${isOSFullscreen ? 'opacity-40 hover:opacity-100' : ''}`}>
                {!isPlayerExpanded ? <div className="w-full h-full flex items-center justify-center text-zinc-400"><Headphones className="w-4 h-4 text-teal-600/40" /></div> : (
                  <div className="flex items-center gap-4 w-full h-full animate-in fade-in zoom-in-95 overflow-visible-important">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => seek(-10)} className="w-8 h-8 flex items-center justify-center text-zinc-400"><RotateCcw className="w-3.5 h-3.5" /></button>
                      <button onClick={togglePlay} className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-xl active:scale-90">{isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}</button>
                      <button onClick={() => seek(10)} className="w-8 h-8 flex items-center justify-center text-zinc-400"><RotateCw className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
                      <div className="relative h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden"><div className="absolute top-0 left-0 h-full bg-teal-600" style={{ width: `${(currentTime/duration)*100}%` }} /><input type="range" min="0" max={duration} step="0.1" value={currentTime} onChange={e => audioRef.current && (audioRef.current.currentTime = parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" /></div>
                      <div className="flex justify-between text-[8px] font-black text-zinc-500 tracking-tighter"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={toggleMute} className="w-8 h-8 flex items-center justify-center text-zinc-400 transition-colors">{isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}</button>
                      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800 mx-1" />
                      <button onClick={handleDownload} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-all active:scale-90"><Download className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
              </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reader;
