
import React, { useState, useEffect, useRef, useMemo, useCallback, memo, useTransition } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { getDefinition, WordDefinition } from '../services/dictionaryService';
import { getAccentInsensitiveRegex, getSearchHighlightRegex } from '../utils/textUtils';
import { Sermon, Highlight, SearchMode } from '../types';
import { PALETTE_HIGHLIGHT_COLORS } from '../constants';
import { formatSongContent } from '../services/songService';
import NoteSelectorModal from './NoteSelectorModal';
import { 
  openProjectionWindow, 
  broadcastProjectionPayload, 
  closeProjectionWindow, 
  ProjectionSyncPayload 
} from '../services/projectionService';
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
  Sword,
  Quote, 
  MapPin, 
  Calendar, 
  Clock,
  Feather, 
  Milestone, 
  MonitorPlay,
  Image as ImageIcon,
  Layers,
  Info,
  History,
  Languages,
  Plus,
  ChevronRight,
  PanelLeftOpen,
  Music,
  Edit3,
  Library,
  BookText,
  ListOrdered
} from 'lucide-react';
import SongModal from './SongModal';

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

const getWordIndexFromDomPoint = (
  node: Node, 
  offset: number, 
  isEnd: boolean, 
  structuredSegments: { words: SimpleWord[]; isNumbered: boolean; text: string }[]
): number | null => {
  // 1. Check if node is inside a [data-para-content] container
  const paraEl = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest('[data-para-content]');
  const effectiveParaEl = paraEl || (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest('[data-seg-idx]')?.querySelector('[data-para-content]');
  
  if (!effectiveParaEl) {
    const wordEl = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest('[data-global-index]');
    if (wordEl) {
      return parseInt(wordEl.getAttribute('data-global-index') || '0', 10);
    }
    return null;
  }

  const segIdxStr = effectiveParaEl.getAttribute('data-para-content');
  if (segIdxStr === null) return null;
  const segIdx = parseInt(segIdxStr, 10);
  const segment = structuredSegments[segIdx];
  if (!segment || segment.words.length === 0) return null;

  // 2. Compute exact character offset inside effectiveParaEl
  let charOffset = 0;
  let reachedNode = false;

  const walker = document.createTreeWalker(effectiveParaEl, NodeFilter.SHOW_TEXT, null);
  let currentTextNode: Node | null = walker.nextNode();

  while (currentTextNode) {
    if (currentTextNode === node) {
      charOffset += Math.min(offset, currentTextNode.textContent?.length || 0);
      reachedNode = true;
      break;
    }
    charOffset += currentTextNode.textContent?.length || 0;
    currentTextNode = walker.nextNode();
  }

  if (!reachedNode) {
    if (node === effectiveParaEl) {
      charOffset = 0;
      for (let i = 0; i < Math.min(offset, effectiveParaEl.childNodes.length); i++) {
        charOffset += effectiveParaEl.childNodes[i].textContent?.length || 0;
      }
    } else if (effectiveParaEl.contains(node)) {
      charOffset = 0;
      const elWalker = document.createTreeWalker(effectiveParaEl, NodeFilter.SHOW_TEXT, null);
      let tn: Node | null = elWalker.nextNode();
      while (tn) {
        if (node.contains(tn)) {
          break;
        }
        charOffset += tn.textContent?.length || 0;
        tn = elWalker.nextNode();
      }
    }
  }

  // 3. Map character offset to exact global word index
  const targetChar = isEnd && charOffset > 0 ? charOffset - 1 : charOffset;

  let currentPos = 0;
  for (let i = 0; i < segment.words.length; i++) {
    const w = segment.words[i];
    if (currentPos + w.text.length > targetChar) {
      return w.globalIndex;
    }
    currentPos += w.text.length;
  }

  return segment.words[segment.words.length - 1].globalIndex;
};

let externalMaskWindow: Window | null = null;
let projectionWindow: Window | null = null;

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const setSidebarOpen = useAppStore(s => s.setSidebarOpen);
  const libraryMode = useAppStore(s => s.libraryMode);
  const setLibraryMode = useAppStore(s => s.setLibraryMode);
  const manualContextIds = useAppStore(s => s.manualContextIds);
  const toggleContextSermon = useAppStore(s => s.toggleContextSermon);
  
  const activeSermon = useAppStore(s => s.activeSermon);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  
  const notes = useAppStore(s => s.notes);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const setActiveNoteId = useAppStore(s => s.setActiveNoteId);
  const isExternalMaskOpen = useAppStore(s => s.isExternalMaskOpen);
  const setExternalMaskOpen = useAppStore(s => s.setExternalMaskOpen);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
  const setProjectionBlackout = useAppStore(s => s.setProjectionBlackout);
  const projectedImage = useAppStore(s => s.projectedImage);
  const setProjectedImage = useAppStore(s => s.setProjectedImage);
  const toggleImageModal = useAppStore(s => s.toggleImageModal);
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
  const selectedBibleVerse = useAppStore(s => s.selectedBibleVerse);
  const setSelectedBibleVerse = useAppStore(s => s.setSelectedBibleVerse);

  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const aiWidth = useAppStore(s => s.aiWidth);
  const notesWidth = useAppStore(s => s.notesWidth);
  const aiOpen = useAppStore(s => s.aiOpen);
  const notesOpen = useAppStore(s => s.notesOpen);
  const toggleNotes = useAppStore(s => s.toggleNotes);
  const toggleAI = useAppStore(s => s.toggleAI);
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const sermon = activeSermon;

  const isSong = Boolean(sermon?.date === 'Cantique' || sermon?.time === 'Chant' || sermon?.id?.startsWith('song-'));
  const isBible = Boolean(sermon?.id?.startsWith('bible-'));
  const isBibleChapter = Boolean(sermon?.id?.startsWith('bible-') && !sermon?.id?.endsWith('-all'));
  const isExpose = Boolean(sermon?.id?.startsWith('expose-'));
  const isSermon = Boolean(sermon && !isSong && !isBible && !isExpose);

  const [selectedSermonParagraph, setSelectedSermonParagraph] = useState<number | null>(null);

  const safeScrollToElement = useCallback((el: HTMLElement | null | undefined) => {
    if (!el) return;
    try {
      requestAnimationFrame(() => {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
          try { el.scrollIntoView(); } catch (err) {}
        }
      });
    } catch (e) {
      try { el.scrollIntoView(); } catch (err) {}
    }
  }, []);

  useEffect(() => {
    setSelectedSermonParagraph(null);
  }, [sermon?.id]);

  const processedText = useMemo(() => {
    if (!sermon || !sermon.text) return '';
    if (isSong) {
      const pureTitle = sermon.title ? sermon.title.replace(/^\d+\.\s*/, '') : '';
      return formatSongContent(sermon.text, pureTitle);
    }
    return sermon.text;
  }, [sermon?.id, sermon?.text, isSong, sermon?.title]);

  const segments = useMemo(() => {
    if (!processedText) return [];
    return processedText.split(/\n\s*\n+/); 
  }, [processedText]);

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

  const fullSermonText = useMemo(() => {
    if (words.length === 0) return '';
    return words.map(w => w.text).join('');
  }, [words]);

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    if (!sermon?.highlights) return map;
    for (const h of sermon.highlights) {
        for (let i = h.start; i <= h.end; i++) map.set(i, h);
    }
    return map;
  }, [sermon?.highlights]);
  
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [selectionIndices, setSelectionIndices] = useState<number[]>([]);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchMatchWordIndices, setSearchMatchWordIndices] = useState<Set<number>>(new Set());
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);
  const [projectedSegmentIndex, setProjectedSegmentIndex] = useState<number | null>(null);
  const projectedSegmentIndexRef = useRef<number | null>(null);

  const updateProjectedSegmentIndex = useCallback((idx: number | null) => {
    projectedSegmentIndexRef.current = idx;
    setProjectedSegmentIndex(idx);
  }, []);

  const sendProjectionPayloadRef = useRef<((targetSegmentIdx?: number | null) => void) | null>(null);
  const handleNextSourceRef = useRef<(() => void) | null>(null);
  const handlePrevSourceRef = useRef<(() => void) | null>(null);
  const [isProjectionOpen, setIsProjectionOpen] = useState(false);
  
  const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
  const [isDefining, setIsDefining] = useState(false);
  const [jumpHighlightIndices, setJumpHighlightIndices] = useState<number[]>([]);
  const [syncToggle, setSyncToggle] = useState(0);
  const [isSongModalOpen, setIsSongModalOpen] = useState(false);
  const [isNavPanelOpen, setIsNavPanelOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth > 768 : true);
  const [navFilterText, setNavFilterText] = useState('');

  const filteredSegments = useMemo(() => {
    return structuredSegments.map((seg, idx) => ({ seg, idx, num: idx + 1 }))
      .filter(({ num, seg }) => {
        if (!navFilterText.trim()) return true;
        const q = navFilterText.trim().toLowerCase();
        if (String(num).includes(q)) return true;
        return seg.text.toLowerCase().includes(q);
      });
  }, [structuredSegments, navFilterText]);

  const isCurrentInDock = useMemo(() => {
    if (!activeSermon?.id) return false;
    return manualContextIds.includes(activeSermon.id);
  }, [activeSermon, manualContextIds]);

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

  // --- Silky Smooth Keyboard Arrow Scroll Engine ---
  const readerTargetScrollTopRef = useRef<number>(0);
  const readerIsAnimatingScrollRef = useRef<boolean>(false);
  const readerSmoothAnimFrameRef = useRef<number | null>(null);

  const stepReaderSmoothScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      readerIsAnimatingScrollRef.current = false;
      return;
    }
    const current = el.scrollTop;
    const target = readerTargetScrollTopRef.current;
    const diff = target - current;

    if (Math.abs(diff) < 0.5) {
      el.scrollTop = target;
      readerIsAnimatingScrollRef.current = false;
      return;
    }

    // Perfectly calibrated easing (0.22): instant responsiveness, fluid 60/120fps glide, zero abrupt notches
    el.scrollTop = current + diff * 0.22;
    readerSmoothAnimFrameRef.current = requestAnimationFrame(stepReaderSmoothScroll);
  }, []);

  const smoothScrollReaderBy = useCallback((amount: number) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    if (!readerIsAnimatingScrollRef.current) {
      readerTargetScrollTopRef.current = el.scrollTop;
    }

    readerTargetScrollTopRef.current = Math.max(0, Math.min(maxScroll, readerTargetScrollTopRef.current + amount));

    if (!readerIsAnimatingScrollRef.current) {
      readerIsAnimatingScrollRef.current = true;
      if (readerSmoothAnimFrameRef.current) cancelAnimationFrame(readerSmoothAnimFrameRef.current);
      readerSmoothAnimFrameRef.current = requestAnimationFrame(stepReaderSmoothScroll);
    }
  }, [stepReaderSmoothScroll]);

  const handleScrollContainerScroll = useCallback(() => {
    if (!readerIsAnimatingScrollRef.current && scrollContainerRef.current) {
      readerTargetScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }
  }, []);

  const handleScrollContainerWheel = useCallback(() => {
    if (readerIsAnimatingScrollRef.current) {
      readerIsAnimatingScrollRef.current = false;
      if (readerSmoothAnimFrameRef.current) {
        cancelAnimationFrame(readerSmoothAnimFrameRef.current);
        readerSmoothAnimFrameRef.current = null;
      }
    }
    if (scrollContainerRef.current) {
      readerTargetScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (readerSmoothAnimFrameRef.current) {
        cancelAnimationFrame(readerSmoothAnimFrameRef.current);
      }
    };
  }, []);

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelection(prev => (prev !== null ? null : prev));
      setSelectionIndices(prev => (prev.length > 0 ? [] : prev));
    }
  }, []);

  const handleTextSelection = useCallback((e?: React.MouseEvent) => {
    if (e && (e.target as HTMLElement).closest('.selection-menu-container')) {
      return;
    }

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0 && scrollContainerRef.current) {
      if (sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const scrollContainer = scrollContainerRef.current;
      const scrollRect = scrollContainer.getBoundingClientRect();
      
      const menuHeight = 55; 
      const spaceAbove = rect.top - scrollRect.top;
      
      let x = (rect.left + rect.width / 2) - scrollRect.left;
      let y;

      if (spaceAbove > menuHeight + 16) {
        y = (rect.top - scrollRect.top) + scrollContainer.scrollTop - menuHeight - 12;
      } else {
        y = (rect.bottom - scrollRect.top) + scrollContainer.scrollTop + 12;
      }

      // Keep menu inside container horizontally
      x = Math.max(160, Math.min(scrollContainer.clientWidth - 160, x));

      setSelection({ 
        text: sel.toString().trim(), 
        x: x, 
        y: y
      });

      try {
        const start = getWordIndexFromDomPoint(range.startContainer, range.startOffset, false, structuredSegments);
        const end = getWordIndexFromDomPoint(range.endContainer, range.endOffset, true, structuredSegments);
        if (start !== null && end !== null) {
          const s = Math.min(start, end);
          const e = Math.max(start, end);
          const indices: number[] = [];
          for (let i = s; i <= e; i++) {
            indices.push(i);
          }
          setSelectionIndices(indices);
        }
      } catch (err) {}
    } else {
      if (!e || !(e.target as HTMLElement).closest('.selection-menu-container')) {
        setSelection(null);
        setSelectionIndices([]);
      }
    }
  }, [structuredSegments]);

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
    let lastCmdTime = 0;
    let lastCmdType = '';

    const processIncomingCommand = (data: any) => {
      if (!data) return;
      const now = Date.now();

      if (data.type === 'ready') {
        if (sendProjectionPayloadRef.current) {
          sendProjectionPayloadRef.current(projectedSegmentIndexRef.current);
        }
        setSyncToggle(prev => prev + 1);
        return;
      }

      // Deduplicate commands arriving across multiple channels within 150ms
      if (data.type === lastCmdType && now - lastCmdTime < 150) {
        return;
      }
      lastCmdTime = now;
      lastCmdType = data.type;

      if (data.type === 'next_segment') {
        handleProjectNextSegment();
      } else if (data.type === 'prev_segment') {
        handleProjectPrevSegment();
      } else if (data.type === 'next_source') {
        if (handleNextSourceRef.current) handleNextSourceRef.current();
      } else if (data.type === 'prev_source') {
        if (handlePrevSourceRef.current) handlePrevSourceRef.current();
      } else if (data.type === 'toggle_blackout') {
        setProjectionBlackout(!useAppStore.getState().projectionBlackout);
      } else if (data.type === 'close') {
        stopProjection();
      }
    };

    const handleBroadcastMessage = (e: any) => {
      processIncomingCommand(e.data || e);
    };
    broadcastChannel.current.onmessage = handleBroadcastMessage;

    const handleWindowMessage = (e: MessageEvent) => {
      processIncomingCommand(e.data);
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
        updateProjectedSegmentIndex(null);
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

  const getProjectionPayload = useCallback((targetSegmentIdx?: number | null): ProjectionSyncPayload | null => {
    if (projectedImage) {
      return {
        type: 'sync' as const,
        title: projectedImage.name || '',
        date: '',
        city: '',
        time: '',
        text: '',
        projectedWords: [],
        fontSize,
        theme,
        blackout: projectionBlackout,
        highlights: [],
        selectionIndices: [],
        searchResults: [],
        currentResultIndex: -1,
        activeDefinition: null,
        isBible: false,
        projectedImage
      };
    }

    if (!sermon) return null;
    
    const activeIdx = targetSegmentIdx !== undefined 
      ? targetSegmentIdx 
      : projectedSegmentIndexRef.current;
    
    if (activeIdx === null || activeIdx < 0 || !structuredSegments[activeIdx]) {
      return {
        type: 'sync' as const,
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
        activeDefinition: null,
        isBible,
        projectedImage: null
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
      type: 'sync' as const,
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
      activeDefinition,
      isBible,
      projectedImage: null
    };
  }, [sermon, structuredSegments, segments, selectionIndices, highlightMap, jumpHighlightIndices, searchResults, currentResultIndex, activeDefinition, fontSize, theme, projectionBlackout, isBible, projectedImage]);

  const prevSermonIdRef = useRef(sermon?.id);
  useEffect(() => {
    if (sermon?.id !== prevSermonIdRef.current) {
      prevSermonIdRef.current = sermon?.id;
      updateProjectedSegmentIndex(null);
    }
  }, [sermon?.id, updateProjectedSegmentIndex]);

  const sendProjectionPayload = useCallback((targetSegmentIdx?: number | null) => {
    const payload = getProjectionPayload(targetSegmentIdx);
    if (!payload) return;
    broadcastProjectionPayload(payload);
  }, [getProjectionPayload]);

  useEffect(() => {
    sendProjectionPayloadRef.current = sendProjectionPayload;
  }, [sendProjectionPayload]);

  useEffect(() => {
    if ((sermon || projectedImage) && isProjectionOpen) {
      sendProjectionPayload(projectedSegmentIndexRef.current);
    }
  }, [sermon, projectedSegmentIndex, isProjectionOpen, sendProjectionPayload, syncToggle, projectedImage]);

  const stopProjection = useCallback(() => {
    closeProjectionWindow();
    projectionWindow = null;
    setIsProjectionOpen(false);
    updateProjectedSegmentIndex(null);
  }, [updateProjectedSegmentIndex]);

  const ensureProjectionWindow = useCallback((targetIdx?: number) => {
    if (projectedImage) {
      setProjectedImage(null);
    }

    const firstNonEmptyIdx = structuredSegments.findIndex(s => s.text.trim().length > 0);
    const defaultIdx = firstNonEmptyIdx !== -1 ? firstNonEmptyIdx : (structuredSegments.length > 0 ? 0 : null);

    const effectiveIdx = typeof targetIdx === 'number' 
      ? targetIdx 
      : (projectedSegmentIndexRef.current !== null ? projectedSegmentIndexRef.current : defaultIdx);

    if (effectiveIdx !== null) {
      updateProjectedSegmentIndex(effectiveIdx);
    }

    setIsProjectionOpen(true);
    const payload = getProjectionPayload(effectiveIdx);
    if (payload) {
      const win = openProjectionWindow(payload);
      projectionWindow = win;
    }
  }, [structuredSegments, updateProjectedSegmentIndex, getProjectionPayload, projectedImage, setProjectedImage]);

  const reopenProjectionWindow = useCallback(() => {
    ensureProjectionWindow();
  }, [ensureProjectionWindow]);

  const toggleProjection = useCallback((initialSegmentIdx?: number) => {
    const isWindowActive = Boolean(projectionWindow && !projectionWindow.closed);

    if (isWindowActive || isProjectionOpen) {
      if (typeof initialSegmentIdx === 'number') {
        ensureProjectionWindow(initialSegmentIdx);
      } else {
        stopProjection();
      }
    } else {
      ensureProjectionWindow(initialSegmentIdx);
    }
  }, [isProjectionOpen, ensureProjectionWindow, stopProjection]);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  useEffect(() => {
    if (sermon?.id && !jumpToText && !jumpToParagraph && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
        updateProjectedSegmentIndex(null);
        setJumpHighlightIndices([]);
    }
  }, [sermon?.id, updateProjectedSegmentIndex]);

  useEffect(() => {
    if (jumpToParagraph !== null && sermon && structuredSegments.length > 0) {
        if (isSermon) {
            setSelectedSermonParagraph(jumpToParagraph);
        }
        const segmentIdx = jumpToParagraph - 1;
        const segment = structuredSegments[segmentIdx];
        if (segment) {
            setTimeout(() => {
                const segEl = segmentRefs.current.get(segmentIdx);
                if (segEl) {
                    let targetGlobalIndex = segment.words[0]?.globalIndex ?? 0;
                    let targetHighlightIndices: number[] = [];
                    
                    if (lastSearchQuery) {
                        const isExact = lastSearchMode === SearchMode.EXACT_PHRASE || lastSearchMode === SearchMode.EXACT_WORDS;
                        const regex = getSearchHighlightRegex(lastSearchQuery, isExact);
                        const paraText = segment.words.map(w => w.text).join('');
                        let match: RegExpExecArray | null;
                        let foundFirst = false;

                        while ((match = regex.exec(paraText)) !== null) {
                            const matchStart = match.index;
                            const matchEnd = match.index + match[0].length;
                            let currentChar = 0;

                            for (const w of segment.words) {
                                const wordStart = currentChar;
                                const wordEnd = currentChar + w.text.length;
                                if (wordEnd > matchStart && wordStart < matchEnd) {
                                    if (!targetHighlightIndices.includes(w.globalIndex)) {
                                        targetHighlightIndices.push(w.globalIndex);
                                    }
                                    if (!foundFirst) {
                                        targetGlobalIndex = w.globalIndex;
                                        foundFirst = true;
                                    }
                                }
                                currentChar += w.text.length;
                            }
                            if (regex.lastIndex === match.index) regex.lastIndex++;
                        }
                    }
                    
                    setJumpHighlightIndices(targetHighlightIndices);

                    const targetEl = wordRefs.current.get(targetGlobalIndex);
                    if (targetEl) safeScrollToElement(targetEl);
                    else if (segEl) safeScrollToElement(segEl);
                }
            }, 150);
        }
        setJumpToParagraph(null);
    }
  }, [jumpToParagraph, sermon, structuredSegments, setJumpToParagraph, lastSearchQuery, lastSearchMode]);

  useEffect(() => {
    if (jumpToText && sermon && words.length > 0) {
        const regex = getAccentInsensitiveRegex(jumpToText, false);
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
  }, [jumpToText, sermon, words, fullSermonText, setJumpToText]);
  
  const citationHighlightMap = useMemo(() => {
    const map = new Map<number, { colorClass: string }>();
    if (!activeNoteId || !sermon) return map;
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote) return map;
    const relevantCitations = activeNote.citations.filter(c => c.sermon_id === sermon.id);
    if (relevantCitations.length === 0) return map;
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
  }, [activeNoteId, notes, sermon?.id, words, fullSermonText]);

  useEffect(() => {
    if (readerSearchQuery.length >= 1) {
      startTransition(() => {
        const regex = getAccentInsensitiveRegex(readerSearchQuery, false);
        const matchStarts: number[] = [];
        const matchWords = new Set<number>();
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            const matchStartChar = match.index;
            const matchEndChar = match.index + match[0].length;
            let currentChar = 0;
            let isFirstWordInMatch = true;

            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                const wordStart = currentChar;
                const wordEnd = currentChar + wordLen;

                if (wordEnd > matchStartChar && wordStart < matchEndChar) {
                  matchWords.add(words[i].globalIndex);
                  if (isFirstWordInMatch) {
                    matchStarts.push(words[i].globalIndex);
                    isFirstWordInMatch = false;
                  }
                }
                currentChar += wordLen;
                if (wordStart >= matchEndChar) break;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        setSearchResults(matchStarts);
        setSearchMatchWordIndices(matchWords);
        setCurrentResultIndex(matchStarts.length > 0 ? 0 : -1);
      });
    } else { 
      setSearchResults([]); 
      setSearchMatchWordIndices(new Set());
      setCurrentResultIndex(-1); 
    }
  }, [readerSearchQuery, words, fullSermonText]);

  useEffect(() => {
      if (currentResultIndex !== -1 && searchResults.length > 0) {
          const el = wordRefs.current.get(searchResults[currentResultIndex]);
          if (el) safeScrollToElement(el);
      }
  }, [currentResultIndex, searchResults, safeScrollToElement]);

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

  const handleHighlight = useCallback((color: string = 'amber') => {
    const sel = window.getSelection();
    if (!sel || !sermon || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    const start = getWordIndexFromDomPoint(range.startContainer, range.startOffset, false, structuredSegments);
    const end = getWordIndexFromDomPoint(range.endContainer, range.endOffset, true, structuredSegments);

    if (start !== null && end !== null) {
      const startIdx = Math.min(start, end);
      const endIdx = Math.max(start, end);
      const newHighlight: Highlight = { 
        id: crypto.randomUUID(), 
        start: startIdx, 
        end: endIdx, 
        color: color 
      };
      updateSermonHighlights(sermon.id, [...(sermon.highlights || []), newHighlight]);
      setSelection(null); 
      sel.removeAllRanges();
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
    searchMatchWordIndices.forEach(idx => set.add(idx));
    jumpHighlightIndices.forEach(idx => set.add(idx));
    return set;
  }, [highlightMap, citationHighlightMap, searchMatchWordIndices, jumpHighlightIndices]);

  const handleProjectSegment = useCallback((idx: number, isExplicitToggle = false) => {
    // ONLY explicit projection buttons (verse projection icon, toolbar button, prev/next controls, or paragraph click in projection mode) trigger projection!
    if (!isExplicitToggle) return;

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      return;
    }

    if (projectedSegmentIndex === idx) {
      // Toggle off this segment
      updateProjectedSegmentIndex(null);
      sendProjectionPayload(null);
    } else {
      ensureProjectionWindow(idx);

      // Automatically keep the projected paragraph centered and visible in reader view
      setTimeout(() => {
        const el = segmentRefs.current.get(idx);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  }, [projectedSegmentIndex, ensureProjectionWindow, updateProjectedSegmentIndex, sendProjectionPayload]);

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

  const handleNextSource = useCallback(async () => {
    const currentId = useAppStore.getState().selectedSermonId;
    if (!currentId) return;

    // 1. Cantique / Chant (song-*)
    if (currentId.startsWith('song-')) {
      try {
        const { loadAllSongs } = await import('../services/songService');
        const songs = await loadAllSongs();
        if (songs.length === 0) return;
        const rawId = currentId.replace('song-', '');
        const idx = songs.findIndex(s => String(s.id) === rawId);
        if (idx !== -1 && idx < songs.length - 1) {
          const nextSong = songs[idx + 1];
          await setSelectedSermonId(`song-${nextSong.id}`);
          addNotification(`Cantique suivant : ${nextSong.id}. ${nextSong.title}`, 'success');
        }
      } catch (e) {}
      return;
    }

    // 2. Exposé des Sept Âges (expose-pg-* ou expose-ch-*)
    if (currentId.startsWith('expose-')) {
      try {
        const { loadExposeData } = await import('../services/exposeService');
        const data = await loadExposeData();
        if (currentId.startsWith('expose-pg-')) {
          const pageNum = parseInt(currentId.replace('expose-pg-', ''), 10);
          const maxPage = data?.book?.total_pages || 374;
          if (pageNum < maxPage) {
            await setSelectedSermonId(`expose-pg-${pageNum + 1}`);
            addNotification(`Exposé : Page ${pageNum + 1}`, 'success');
          }
        } else if (currentId.startsWith('expose-ch-')) {
          const chNum = parseInt(currentId.replace('expose-ch-', ''), 10);
          const chapters = data?.chapters || [];
          const currentChapIdx = chapters.findIndex(c => String(c.chapter_number) === String(chNum));
          if (currentChapIdx !== -1 && currentChapIdx < chapters.length - 1) {
            const nextCh = chapters[currentChapIdx + 1];
            await setSelectedSermonId(`expose-ch-${nextCh.chapter_number}`);
            addNotification(`Exposé : ${nextCh.title}`, 'success');
          }
        }
      } catch (e) {}
      return;
    }

    // 3. Bible (bible-BOOK-CHAPTER)
    if (currentId.startsWith('bible-')) {
      try {
        const parts = currentId.split('-');
        const bookId = parts[1];
        const chapter = parseInt(parts[2], 10) || 1;
        const { BIBLE_BOOKS_META } = await import('../services/bibleMetadata');
        const bookIdx = BIBLE_BOOKS_META.findIndex(b => b.id.toUpperCase() === bookId.toUpperCase());
        if (bookIdx !== -1) {
          const currentBook = BIBLE_BOOKS_META[bookIdx];
          if (chapter < currentBook.chaptersCount) {
            await setSelectedSermonId(`bible-${bookId}-${chapter + 1}`);
            addNotification(`Bible : ${currentBook.name} ${chapter + 1}`, 'success');
          } else if (bookIdx < BIBLE_BOOKS_META.length - 1) {
            const nextBook = BIBLE_BOOKS_META[bookIdx + 1];
            await setSelectedSermonId(`bible-${nextBook.id}-1`);
            addNotification(`Bible : ${nextBook.name} 1`, 'success');
          }
        }
      } catch (e) {}
      return;
    }

    // 4. Prédications ordinaires (sermons)
    const sermonsList = useAppStore.getState().sermons;
    const currentIdx = sermonsList.findIndex(s => s.id === currentId);
    if (currentIdx !== -1 && currentIdx < sermonsList.length - 1) {
      const nextSermon = sermonsList[currentIdx + 1];
      await setSelectedSermonId(nextSermon.id);
      addNotification(`Prédication suivante : ${nextSermon.title}`, 'success');
    }
  }, [setSelectedSermonId, addNotification]);

  const handlePrevSource = useCallback(async () => {
    const currentId = useAppStore.getState().selectedSermonId;
    if (!currentId) return;

    // 1. Cantique / Chant (song-*)
    if (currentId.startsWith('song-')) {
      try {
        const { loadAllSongs } = await import('../services/songService');
        const songs = await loadAllSongs();
        if (songs.length === 0) return;
        const rawId = currentId.replace('song-', '');
        const idx = songs.findIndex(s => String(s.id) === rawId);
        if (idx > 0) {
          const prevSong = songs[idx - 1];
          await setSelectedSermonId(`song-${prevSong.id}`);
          addNotification(`Cantique précédent : ${prevSong.id}. ${prevSong.title}`, 'success');
        }
      } catch (e) {}
      return;
    }

    // 2. Exposé des Sept Âges (expose-pg-* ou expose-ch-*)
    if (currentId.startsWith('expose-')) {
      try {
        const { loadExposeData } = await import('../services/exposeService');
        const data = await loadExposeData();
        if (currentId.startsWith('expose-pg-')) {
          const pageNum = parseInt(currentId.replace('expose-pg-', ''), 10);
          if (pageNum > 1) {
            await setSelectedSermonId(`expose-pg-${pageNum - 1}`);
            addNotification(`Exposé : Page ${pageNum - 1}`, 'success');
          }
        } else if (currentId.startsWith('expose-ch-')) {
          const chNum = parseInt(currentId.replace('expose-ch-', ''), 10);
          const chapters = data?.chapters || [];
          const currentChapIdx = chapters.findIndex(c => String(c.chapter_number) === String(chNum));
          if (currentChapIdx > 0) {
            const prevCh = chapters[currentChapIdx - 1];
            await setSelectedSermonId(`expose-ch-${prevCh.chapter_number}`);
            addNotification(`Exposé : ${prevCh.title}`, 'success');
          }
        }
      } catch (e) {}
      return;
    }

    // 3. Bible (bible-BOOK-CHAPTER)
    if (currentId.startsWith('bible-')) {
      try {
        const parts = currentId.split('-');
        const bookId = parts[1];
        const chapter = parseInt(parts[2], 10) || 1;
        const { BIBLE_BOOKS_META } = await import('../services/bibleMetadata');
        const bookIdx = BIBLE_BOOKS_META.findIndex(b => b.id.toUpperCase() === bookId.toUpperCase());
        if (bookIdx !== -1) {
          const currentBook = BIBLE_BOOKS_META[bookIdx];
          if (chapter > 1) {
            await setSelectedSermonId(`bible-${bookId}-${chapter - 1}`);
            addNotification(`Bible : ${currentBook.name} ${chapter - 1}`, 'success');
          } else if (bookIdx > 0) {
            const prevBook = BIBLE_BOOKS_META[bookIdx - 1];
            await setSelectedSermonId(`bible-${prevBook.id}-${prevBook.chaptersCount}`);
            addNotification(`Bible : ${prevBook.name} ${prevBook.chaptersCount}`, 'success');
          }
        }
      } catch (e) {}
      return;
    }

    // 4. Prédications ordinaires (sermons)
    const sermonsList = useAppStore.getState().sermons;
    const currentIdx = sermonsList.findIndex(s => s.id === currentId);
    if (currentIdx > 0) {
      const prevSermon = sermonsList[currentIdx - 1];
      await setSelectedSermonId(prevSermon.id);
      addNotification(`Prédication précédente : ${prevSermon.title}`, 'success');
    }
  }, [setSelectedSermonId, addNotification]);

  useEffect(() => {
    handleNextSourceRef.current = handleNextSource;
    handlePrevSourceRef.current = handlePrevSource;
  }, [handleNextSource, handlePrevSource]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;

      const isProjectionActive = isProjectionOpen || projectedSegmentIndex !== null || isOSFullscreen;

      // F5 or Ctrl+Shift+P to launch / toggle projection from anywhere (when not in input)
      if (!isInput && (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')))) {
        e.preventDefault();
        toggleProjection();
        return;
      }

      if (e.key === 'Escape') {
        if (isProjectionActive) {
          stopProjection();
        }
        setSelection(null);
        setActiveDefinition(null);
        setIsSearchVisible(false);
        window.getSelection()?.removeAllRanges();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsSearchVisible(true);
      }

      // Keyboard navigation when not in an input field
      if (!isInput && !e.ctrlKey && !e.metaKey) {
        // Stop projection with 'q' or 'Q'
        if ((e.key === 'q' || e.key === 'Q') && isProjectionActive) {
          e.preventDefault();
          stopProjection();
          return;
        }

        // Toggle blackout: B or . (presentation remote standard)
        if ((e.key === 'b' || e.key === 'B' || e.key === '.') && isProjectionActive) {
          e.preventDefault();
          setProjectionBlackout(!useAppStore.getState().projectionBlackout);
          return;
        }

        // 1. Next / Previous Source (Chants, Sermons, Exposé, Bible): PageDown / PageUp
        if (e.key === 'PageDown') {
          e.preventDefault();
          handleNextSource();
          return;
        }
        if (e.key === 'PageUp') {
          e.preventDefault();
          handlePrevSource();
          return;
        }

        // 2. Next / Previous Paragraph in current source: ArrowRight (→) / ArrowLeft (←)
        if (e.key === 'ArrowRight' || (e.key === ' ' && !e.shiftKey && isProjectionActive)) {
          e.preventDefault();
          handleProjectNextSegment();
          return;
        }
        if (e.key === 'ArrowLeft' || (e.key === ' ' && e.shiftKey && isProjectionActive)) {
          e.preventDefault();
          handleProjectPrevSegment();
          return;
        }

        // 3. Scroll view Up / Down: ArrowDown (↓) / ArrowUp (↑)
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          smoothScrollReaderBy(85);
          if (broadcastChannel.current && isProjectionActive) {
            broadcastChannel.current.postMessage({ type: 'scroll', direction: 'down', amount: 0.15 });
          }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          smoothScrollReaderBy(-85);
          if (broadcastChannel.current && isProjectionActive) {
            broadcastChannel.current.postMessage({ type: 'scroll', direction: 'up', amount: 0.15 });
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProjectionOpen, projectedSegmentIndex, isOSFullscreen, handleProjectNextSegment, handleProjectPrevSegment, handleNextSource, handlePrevSource, setProjectionBlackout, toggleProjection, stopProjection]);

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
            isSearchResult={searchMatchWordIndices.has(word.globalIndex)} 
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
  }, [interactiveIndices, searchMatchWordIndices, searchResults, currentResultIndex, jumpHighlightIndices, citationHighlightMap, highlightMap, handleRemoveHighlight, handleRemoveJumpHighlight, handleTextSelection]);

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
            <Sword className="w-20 h-20 text-zinc-300 dark:text-zinc-800 transition-colors duration-700 group-hover:text-teal-600/50 relative z-10" />
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
              className="flex items-center gap-x-2.5 gap-y-1 font-bold text-zinc-400 uppercase tracking-wider leading-none mt-1 transition-all flex-wrap"
              style={{ fontSize: isOSFullscreen ? `${Math.max(10, fontSize * 0.3)}px` : '9px' }}
            >
              {sermon.id.startsWith('song-') ? (
                <>
                  <div className="inline-flex items-center gap-1.5"><Music className="w-3 h-3 text-teal-600 shrink-0" /><span>{sermon.date || 'Cantique'}</span></div>
                  {sermon.city && <div className="inline-flex items-center gap-1.5"><span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" /><span>{sermon.city}</span></div>}
                </>
              ) : sermon.id.startsWith('bible-') ? (
                <>
                  <div className="inline-flex items-center gap-1.5"><BookOpen className="w-3 h-3 text-teal-600 shrink-0" /><span>Sainte Bible</span></div>
                  {sermon.date && <div className="inline-flex items-center gap-1.5"><span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" /><span>{sermon.date}</span></div>}
                  {sermon.city && <div className="inline-flex items-center gap-1.5"><span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" /><span>{sermon.city}</span></div>}
                </>
              ) : sermon.id.startsWith('expose-') ? (
                <>
                  <div className="inline-flex items-center gap-1.5"><BookText className="w-3 h-3 text-teal-600 shrink-0" /><span>Exposé des 7 Âges</span></div>
                  {sermon.city && <div className="inline-flex items-center gap-1.5"><span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" /><span>{sermon.city}</span></div>}
                </>
              ) : (
                <>
                  <div className="inline-flex items-center gap-1.5"><Calendar className="w-3 h-3 text-teal-600 shrink-0" /><span>{sermon.date}</span></div>
                  {sermon.time && <div className="inline-flex items-center gap-1.5"><span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" /><Clock className="w-3 h-3 text-teal-600 shrink-0" /><span>{sermon.time}</span></div>}
                  {sermon.city && <div className="inline-flex items-center gap-1.5"><span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-0.5" /><MapPin className="w-3 h-3 text-teal-600 shrink-0" /><span>{sermon.city}</span></div>}
                </>
              )}
            </div>
          </div>
        </div>
        <div 
          className="flex items-center shrink-0 ml-4 overflow-visible-important flex-wrap justify-end gap-1.5"
          style={isOSFullscreen ? { gap: '0.25em' } : {}}
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

            {/* Document Content Tools */}
            <ActionButton 
              onClick={() => setIsSearchVisible(!isSearchVisible)} 
              icon={Search} 
              tooltip={t.reader_search_tooltip} 
              active={isSearchVisible} 
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />
            <ActionButton 
              onClick={() => {
                if (!activeSermon?.id) {
                  addNotification("Aucun document ouvert à ajouter au dock IA", "info");
                  return;
                }
                toggleContextSermon(activeSermon.id, true);
                addNotification(
                  isCurrentInDock 
                    ? "Document retiré du dock IA" 
                    : "Document ajouté au dock IA", 
                  "success"
                );
              }} 
              icon={Sparkles} 
              tooltip={isCurrentInDock ? "Retirer ce document du dock IA" : "Ajouter ce document au dock IA"} 
              active={isCurrentInDock}
              special={isCurrentInDock}
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />
            {isSong && (
              <ActionButton 
                onClick={() => {
                  setIsSongModalOpen(true);
                  setSidebarOpen(false);
                }} 
                icon={Edit3} 
                tooltip="Modifier les données de ce cantique" 
                isFullscreen={isOSFullscreen} 
                baseFontSize={fontSize} 
              />
            )}
            {sermon.audio_url && (
              <ActionButton 
                onClick={togglePlay} 
                icon={isPlaying ? Pause : Play} 
                tooltip={isPlaying ? t.tooltip_pause : t.tooltip_play} 
                active={isPlaying} 
                isFullscreen={isOSFullscreen} 
                baseFontSize={fontSize} 
              />
            )}
            <ActionButton 
              onClick={() => toggleProjection()} 
              icon={MonitorPlay} 
              tooltip="Projeter sur un deuxième écran" 
              active={isProjectionOpen} 
              special={isProjectionOpen} 
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />
            <ActionButton 
              onClick={() => toggleImageModal()} 
              icon={ImageIcon} 
              tooltip="Projeter des Images (Détection Auto Paysage/Portrait)" 
              active={Boolean(projectedImage)} 
              special={Boolean(projectedImage)} 
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />
            {structuredSegments.length > 0 && (
              <ActionButton 
                onClick={() => setIsNavPanelOpen(prev => !prev)} 
                icon={ListOrdered} 
                tooltip={isNavPanelOpen ? "Masquer le sélecteur vertical de versets / paragraphes" : "Afficher le sélecteur vertical de versets / paragraphes"} 
                active={isNavPanelOpen} 
                special={isNavPanelOpen}
                isFullscreen={isOSFullscreen} 
                baseFontSize={fontSize} 
              />
            )}

            {/* Zoom / Font controls */}
            <div 
              className="flex items-center bg-white/50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-zinc-800/50 no-print overflow-hidden transition-all"
              style={isOSFullscreen ? { fontSize: `${fontSize * 0.6}px`, borderRadius: '0.5em', height: '1.5em' } : { borderRadius: '0.75rem' }}
            >
              <button onClick={() => setFontSize(s => s - 2)} className={`flex items-center justify-center text-zinc-400 hover:text-teal-600 ${isOSFullscreen ? '' : 'w-9 h-9'}`} style={isOSFullscreen ? { width: '1.5em', height: '100%' } : {}}>
                <ZoomOut style={isOSFullscreen ? { width: '0.8em', height: '0.8em' } : { width: '1rem', height: '1rem' }} />
              </button>
              <input type="text" value={localFontSize} onDoubleClick={() => setFontSize(20)} onChange={e => /^\d*$/.test(e.target.value) && setLocalFontSize(e.target.value)} onBlur={() => { const val = parseInt(String(localFontSize), 10); setFontSize(isNaN(val) ? fontSize : val); }} className="bg-transparent text-center font-black outline-none text-zinc-950 dark:text-white" style={isOSFullscreen ? { width: '2.2em', height: '100%', fontSize: '0.8em' } : { width: '3rem', height: '100%', fontSize: '11px' }} />
              <button onClick={() => setFontSize(s => s + 2)} className={`flex items-center justify-center text-zinc-400 hover:text-teal-600 ${isOSFullscreen ? '' : 'w-9 h-9'}`} style={isOSFullscreen ? { width: '1.5em', height: '100%' } : {}}>
                <ZoomIn style={isOSFullscreen ? { width: '0.8em', height: '0.8em' } : { width: '1rem', height: '1rem' }} />
              </button>
            </div>

            {/* View Settings */}
            <ActionButton 
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} 
              icon={ThemeIcon} 
              tooltip={theme === 'light' ? "Passer au thème sombre" : "Passer au thème clair"} 
              active={theme === 'dark'} 
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />
            <ActionButton 
              onClick={handleFullscreenToggle} 
              icon={isOSFullscreen ? Minimize : Maximize} 
              tooltip={isOSFullscreen ? "Quitter le plein écran" : "Plein écran"} 
              special={isOSFullscreen} 
              isFullscreen={isOSFullscreen} 
              baseFontSize={fontSize} 
            />


        </div>
      </div>

      {isProjectionOpen && (
        <div className="shrink-0 min-h-11 py-1.5 bg-teal-950/95 text-white border-b border-teal-800/80 flex items-center justify-center sm:justify-end px-4 md:px-8 z-[100000] animate-in slide-in-from-top-2 duration-200 shadow-lg flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setProjectionBlackout(!projectionBlackout)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all shadow-sm ${
                projectionBlackout 
                  ? 'bg-amber-500 text-black ring-2 ring-amber-400/50 shadow-amber-500/20' 
                  : 'bg-teal-900/90 hover:bg-teal-800 text-teal-100 border border-teal-700/60'
              }`}
              data-tooltip="Basculer l'écran noir (Raccourci : Touche B ou .)"
            >
              {projectionBlackout ? <EyeOff className="w-3.5 h-3.5 text-black" /> : <Eye className="w-3.5 h-3.5 text-teal-300" />}
              <span>{projectionBlackout ? 'ÉCRAN NOIR' : 'Écran Noir (B)'}</span>
            </button>

            <div className="h-4 w-px bg-teal-800/80 mx-0.5 hidden sm:block" />

            <button
              onClick={handleProjectPrevSegment}
              disabled={projectedSegmentIndex === null || projectedSegmentIndex === 0}
              className="px-2.5 py-1 bg-teal-900/90 hover:bg-teal-800 disabled:opacity-40 rounded-lg text-xs font-bold text-teal-200 border border-teal-700/60 transition-all flex items-center gap-1"
              data-tooltip="Projeter le paragraphe précédent (Raccourci : Flèche Gauche ← / Maj+Espace)"
            >
              <ChevronUp className="w-3.5 h-3.5" /> Préc.
            </button>

            <button
              onClick={handleProjectNextSegment}
              className="px-2.5 py-1 bg-teal-900/90 hover:bg-teal-800 rounded-lg text-xs font-bold text-teal-200 border border-teal-700/60 transition-all flex items-center gap-1"
              data-tooltip="Projeter le paragraphe suivant (Raccourci : Flèche Droite → / Espace)"
            >
              Suiv. <ChevronDown className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-teal-800/80 mx-0.5 hidden sm:block" />

            <button
              onClick={() => toggleImageModal()}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-xs ${
                projectedImage 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/80 ring-1 ring-emerald-300 animate-pulse' 
                  : 'bg-teal-900/90 hover:bg-teal-800 text-teal-200 border-teal-700/60'
              }`}
              data-tooltip="Ouvrir la médiathèque d'images (Détection automatique Paysage/Portrait)"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{projectedImage ? 'Image active' : 'Images'}</span>
            </button>

            <div className="h-4 w-px bg-teal-800/80 mx-0.5 hidden sm:block" />

            <button
              onClick={stopProjection}
              className="px-2.5 py-1 hover:bg-red-500/20 text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg transition-all text-xs font-bold flex items-center gap-1 cursor-pointer"
              data-tooltip="Arrêter et fermer la projection (Raccourci : Touche Échap / Escape ou Q)"
            >
              <X className="w-3.5 h-3.5" /> Quitter (Échap)
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

      <div className="flex-1 relative overflow-hidden flex">
        {/* Menu vertical de sélection des versets / paragraphes (Pleine hauteur, toggable & responsive horizontalement) */}
        {isNavPanelOpen && structuredSegments.length > 0 && (
          <aside 
            className="h-full flex flex-col shrink-0 border-r border-zinc-200/90 dark:border-zinc-800/90 bg-slate-50/95 dark:bg-zinc-950/95 backdrop-blur-2xl transition-all duration-200 select-none z-30 shadow-sm w-20 sm:w-28 md:w-36 lg:w-40 overflow-hidden no-print"
            aria-label="Sélecteur vertical de versets et paragraphes"
          >
            {/* En-tête du sélecteur vertical */}
            <div className="p-1.5 sm:p-2 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 shrink-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-1 min-w-0">
                  {isBibleChapter ? (
                    <BookOpen className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  ) : isSong ? (
                    <Music className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  ) : isExpose ? (
                    <BookText className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  ) : (
                    <Layers className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  )}
                  <span className="text-[9.5px] font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 truncate">
                    {isBibleChapter ? 'Versets' : isSong ? 'Strophes' : isExpose ? 'Pages' : 'Paragraphes'}
                  </span>
                  <span className="text-[8.5px] font-black text-teal-600 dark:text-teal-400 bg-teal-600/10 px-1 py-0.5 rounded-full font-mono">
                    {structuredSegments.length}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsNavPanelOpen(false)}
                  data-tooltip="Masquer le sélecteur vertical"
                  className="w-4.5 h-4.5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* Filtre / saut rapide par numéro */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="N°..."
                  value={navFilterText}
                  onChange={(e) => setNavFilterText(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 transition-all font-mono"
                />
                {navFilterText && (
                  <button
                    type="button"
                    onClick={() => setNavFilterText('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-[9px] font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Grille responsive des numéros */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1 sm:p-1.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {filteredSegments.map(({ seg, idx, num }) => {
                  const isProjected = projectedSegmentIndex === idx;
                  const isSelected = (isBibleChapter && selectedBibleVerse === num) || (isSermon && selectedSermonParagraph === num);
                  const previewSnippet = seg.text ? seg.text.replace(/\s+/g, ' ').trim().slice(0, 80) : '';

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isBibleChapter) {
                          setSelectedBibleVerse(num);
                        } else if (isSermon) {
                          setSelectedSermonParagraph(num);
                        }
                        const segEl = segmentRefs.current.get(idx);
                        if (segEl) {
                          safeScrollToElement(segEl);
                        } else {
                          setJumpToParagraph(num);
                        }
                        handleProjectSegment(idx, true);
                      }}
                      data-tooltip={`${isBibleChapter ? 'Verset' : isSong ? 'Strophe' : 'Paragraphe'} ${num}${previewSnippet ? ` : "${previewSnippet}..."` : ''}`}
                      className={`h-7 rounded-md text-[10.5px] font-black flex items-center justify-center transition-all cursor-pointer select-none font-mono active:scale-90 shadow-2xs relative ${
                        isProjected
                          ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-400 scale-105 z-10'
                          : isSelected
                            ? 'bg-teal-600 text-white shadow-sm ring-2 ring-teal-500/50 scale-105 z-10'
                            : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200/90 dark:border-zinc-800 hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-400'
                      }`}
                    >
                      <span>{num}</span>
                      {isProjected && (
                        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                      )}
                    </button>
                  );
                })}
              </div>

              {filteredSegments.length === 0 && (
                <div className="p-3 text-center text-[10px] text-zinc-400 font-medium">
                  Aucun résultat
                </div>
              )}
            </div>

            {/* Pied de page avec raccourcis rapides */}
            <div className="p-1 sm:p-1.5 border-t border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 flex items-center justify-between text-[8.5px] font-black text-zinc-500 shrink-0 gap-1">
              <button
                type="button"
                onClick={() => {
                  const segEl = segmentRefs.current.get(0);
                  if (segEl) safeScrollToElement(segEl);
                  else if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
                }}
                className="px-1 py-0.5 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-teal-600 transition-colors uppercase tracking-wider"
                data-tooltip="Aller au début (1)"
              >
                Haut
              </button>

              {(selectedBibleVerse || selectedSermonParagraph) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBibleVerse(null);
                    setSelectedSermonParagraph(null);
                  }}
                  className="px-1 py-0.5 rounded text-red-500 hover:bg-red-500/10 transition-colors uppercase tracking-wider"
                  data-tooltip="Effacer la sélection"
                >
                  Reset
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const lastIdx = structuredSegments.length - 1;
                  const segEl = segmentRefs.current.get(lastIdx);
                  if (segEl) safeScrollToElement(segEl);
                }}
                className="px-1 py-0.5 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-teal-600 transition-colors uppercase tracking-wider"
                data-tooltip={`Aller à la fin (${structuredSegments.length})`}
              >
                Fin
              </button>
            </div>
          </aside>
        )}

        {/* Bouton d'ouverture flottant lorsque le panneau est masqué */}
        {!isNavPanelOpen && structuredSegments.length > 0 && (
          <button 
            onClick={() => setIsNavPanelOpen(true)}
            data-tooltip={isBibleChapter ? "Afficher le sélecteur vertical de versets" : isSong ? "Afficher le sélecteur de strophes" : "Afficher le sélecteur vertical de paragraphes"}
            className="absolute top-4 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/90 dark:bg-zinc-900/90 hover:bg-teal-600 hover:text-white dark:hover:bg-teal-600 dark:hover:text-white text-zinc-700 dark:text-zinc-200 border border-zinc-200/90 dark:border-zinc-800 rounded-xl shadow-md transition-all duration-200 text-xs font-bold active:scale-95 group cursor-pointer backdrop-blur-md no-print"
          >
            <ListOrdered className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 group-hover:text-white shrink-0" />
            <span className="font-mono text-[10.5px] hidden sm:inline">{structuredSegments.length} {isBibleChapter ? 'versets' : isSong ? 'strophes' : '§'}</span>
          </button>
        )}

        <div 
          ref={scrollContainerRef} 
          onScroll={handleScrollContainerScroll}
          onWheel={handleScrollContainerWheel}
          onMouseUp={handleTextSelection} 
          className={`flex-1 h-full overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all ${
            isOSFullscreen 
              ? 'py-4 px-3 sm:px-6 md:px-8' 
              : isNavPanelOpen 
                ? 'py-6 pl-2 pr-3 sm:pl-3 sm:pr-4 md:pl-4 md:pr-6 lg:pl-5 lg:pr-8' 
                : 'py-8 pl-12 pr-4 sm:pl-14 sm:pr-6 md:px-8 lg:px-12'
          }`}
        >
          <div className={`w-full mx-auto printable-content whitespace-pre-wrap ${isSong ? 'text-left max-w-4xl' : 'text-justify max-w-full'} pb-20`} style={{ fontSize: `${fontSize}px` }}>
            {structuredSegments.map((seg, segIdx) => {
              if (seg.text.trim() === '') return null;
              const content = renderSegmentContent(seg.words);
              const isProjected = projectedSegmentIndex === segIdx;
              const isChorus = isSong && /^(ch[oœ]eur|refrain|chorus)\s*:/i.test(seg.text.trim());
              const isSelectedParagraph = (isBibleChapter && selectedBibleVerse === (segIdx + 1)) || (isSermon && selectedSermonParagraph === (segIdx + 1));

              return (
                <div 
                  key={segIdx} 
                  ref={(el: any) => { if (el) segmentRefs.current.set(segIdx, el); }} 
                  data-seg-idx={segIdx}
                  onClick={(e) => {
                    // Only trigger projection on whole paragraph click if projection mode is currently active
                    if (!isProjectionOpen && projectedSegmentIndex === null) {
                      return;
                    }
                    // If user is selecting text, do not trigger projection
                    const sel = window.getSelection();
                    if (sel && sel.toString().trim().length > 0) {
                      return;
                    }
                    handleProjectSegment(segIdx, true);
                  }}
                  className={`group/seg relative mb-2.5 py-3 px-4 sm:px-5 rounded-2xl transition-all select-text ${
                    isProjectionOpen ? 'cursor-pointer' : 'cursor-text'
                  } ${
                    isProjected 
                      ? 'bg-amber-500/10 border-l-[5px] border-amber-500 ring-2 ring-amber-500/40 shadow-md' 
                      : isSelectedParagraph
                        ? 'bg-teal-500/10 dark:bg-teal-500/15 border-l-[5px] border-teal-600 ring-2 ring-teal-500/30 shadow-md'
                        : isChorus
                          ? 'bg-teal-500/5 dark:bg-teal-500/10 border-l-[5px] border-teal-600 dark:border-teal-500 hover:bg-teal-500/10 shadow-xs'
                          : seg.isNumbered
                            ? 'bg-slate-50 dark:bg-zinc-900/50 border-l-[5px] border-teal-600/20 dark:border-zinc-800 hover:border-teal-600/50 hover:bg-teal-500/5'
                            : 'bg-slate-50/60 dark:bg-zinc-900/30 border-l-[3px] border-zinc-200 dark:border-zinc-800 hover:border-teal-600/40 hover:bg-teal-500/5'
                  } ${
                    isProjectionOpen && !isProjected ? 'hover:ring-1 hover:ring-teal-500/30' : ''
                  }`}
                >
                  {/* Top quick badges for projection state and hover actions */}
                  <div className="flex items-center justify-between gap-2 mb-2 no-print">
                    {isProjected ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleProjectSegment(segIdx, true); }}
                        className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black text-[10.5px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-sm transition-all active:scale-95 cursor-pointer"
                        data-tooltip="Cliquer pour désactiver la projection"
                      >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        <span>EN PROJECTION SUR ÉCRAN 2 • CLIQUER POUR ARRÊTER</span>
                      </button>
                    ) : isProjectionOpen ? (
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-teal-600 dark:text-teal-400 opacity-60 group-hover/seg:opacity-100 transition-opacity">
                        <MonitorPlay className="w-3 h-3" />
                        <span>Cliquer sur ce paragraphe pour le projeter</span>
                      </div>
                    ) : null}

                    {/* Inline Quick Action Buttons (visible on hover) */}
                    <div className="ml-auto opacity-0 group-hover/seg:opacity-100 transition-opacity duration-150 flex items-center gap-1.5">
                      {!isProjected && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleProjectSegment(segIdx, true); }}
                          className="inline-flex items-center gap-1 bg-teal-600/10 hover:bg-teal-600 text-teal-700 dark:text-teal-300 hover:text-white border border-teal-600/30 text-[11px] font-bold px-2.5 py-0.5 rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
                          data-tooltip="Projeter ce paragraphe sur grand écran"
                        >
                          <MonitorPlay className="w-3 h-3" />
                          <span>Projeter</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setNoteSelectorPayload({ text: seg.text.trim(), sermon, paragraphIndex: segIdx + 1 }); 
                        }}
                        className="inline-flex items-center gap-1 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 hover:text-white border border-emerald-600/30 text-[11px] font-bold px-2.5 py-0.5 rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer"
                        data-tooltip="Ajouter ce paragraphe au journal d'étude"
                        data-tooltip-icon="notes"
                      >
                        <NotebookPen className="w-3 h-3" />
                        <span>Note</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (activeSermon?.id) {
                            const inDock = manualContextIds.includes(activeSermon.id);
                            toggleContextSermon(activeSermon.id, true);
                            addNotification(
                              inDock 
                                ? `Retiré du dock IA` 
                                : `Ajouté au dock IA`, 
                              "success"
                            );
                          }
                        }}
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer border ${
                          isCurrentInDock
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-teal-600/10 hover:bg-teal-600 text-teal-700 dark:text-teal-300 hover:text-white border-teal-600/30'
                        }`}
                        data-tooltip={isCurrentInDock ? "Retirer ce sermon du dock IA" : "Ajouter ce sermon au dock IA"}
                        data-tooltip-icon="sparkles"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>{isCurrentInDock ? "Dans le Dock IA" : "+ Dock IA"}</span>
                      </button>
                    </div>
                  </div>

                  <div data-para-content={segIdx} className="para-text-content select-text leading-relaxed">
                    {content}
                  </div>
                </div>
              );
            })}
          </div>

          {selection && (
            <div 
              className="absolute z-[200000] no-print selection-menu-container animate-in fade-in zoom-in-95 duration-200 ease-out antialiased" 
              style={{ 
                left: Math.round(selection.x), 
                top: Math.round(selection.y), 
                transform: 'translateX(-50%) translateZ(0)' 
              }}
            >
              <div className="flex items-center bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl p-1.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.1)] pointer-events-auto border border-white/40 dark:border-zinc-800 overflow-hidden transform-gpu">
                <div className="flex items-center">
                  <button 
                    onClick={() => handleHighlight('amber')} 
                    className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-amber-500/15 text-zinc-800 dark:text-zinc-200 hover:text-amber-700 dark:hover:text-amber-400 rounded-xl active:scale-95 group transition-colors cursor-pointer"
                    data-tooltip="Surligner en jaune"
                  >
                    <Highlighter className="w-4 h-4 text-amber-500" />
                    <span className="text-[8px] font-bold uppercase tracking-tight">Surligner</span>
                  </button>
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    {[
                      { key: 'amber', bg: 'bg-amber-400 dark:bg-amber-500', label: 'Jaune' },
                      { key: 'teal', bg: 'bg-teal-400 dark:bg-teal-500', label: 'Turquoise' },
                      { key: 'sky', bg: 'bg-sky-400 dark:bg-sky-500', label: 'Bleu ciel' },
                      { key: 'rose', bg: 'bg-rose-400 dark:bg-rose-500', label: 'Rose' },
                      { key: 'violet', bg: 'bg-violet-400 dark:bg-violet-500', label: 'Violet' }
                    ].map(c => (
                      <button
                        key={c.key}
                        onClick={(e) => { e.stopPropagation(); handleHighlight(c.key); }}
                        className={`w-4 h-4 rounded-full ${c.bg} hover:scale-130 active:scale-90 transition-transform shadow-xs border border-black/15 dark:border-white/20 cursor-pointer`}
                        data-tooltip={`Surligner en ${c.label}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-700/80 my-auto mx-1" />
                <button onClick={() => { handleCopy(); setSelection(null); }} data-tooltip="Copier le texte sélectionné" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-zinc-500/10 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><Copy className="w-4 h-4 text-zinc-500" /><span className="text-[8px] font-bold uppercase tracking-tight">Copier</span></button>
                <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-700/80 my-auto mx-1" />
                <button onClick={() => { handleDefine(); setSelection(null); }} data-tooltip="Définir ce mot dans le dictionnaire" data-tooltip-icon="book" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-sky-500/15 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><BookOpen className="w-4 h-4 text-sky-500" /><span className="text-[8px] font-bold uppercase tracking-tight">Définir</span></button>
                <button onClick={() => { triggerStudyRequest(selection.text); setSelection(null); }} data-tooltip="Étudier avec l'assistant IA" data-tooltip-icon="sparkles" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-teal-600/15 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><Sparkles className="w-4 h-4 text-teal-600 animate-pulse" /><span className="text-[8px] font-bold uppercase tracking-tight">Étudier</span></button>
                <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-700/80 my-auto mx-1" />
                <button onClick={() => { setNoteSelectorPayload({ text: selection.text, sermon }); setSelection(null); }} data-tooltip="Ajouter cet extrait au journal de notes" data-tooltip-icon="notes" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-emerald-500/15 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><NotebookPen className="w-4 h-4 text-emerald-500" /><span className="text-[8px] font-bold uppercase tracking-tight">Note</span></button>
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

      {isSong && sermon && (
        <SongModal
          isOpen={isSongModalOpen}
          songId={sermon.id ? String(sermon.id).replace('song-', '') : null}
          onClose={() => setIsSongModalOpen(false)}
          onSaved={async (savedSong) => {
            const { getSongAsSermon } = await import('../services/songService');
            const updatedSermon = await getSongAsSermon(savedSong.id);
            if (updatedSermon) {
              useAppStore.setState({ 
                activeSermon: updatedSermon, 
                selectedSermonId: updatedSermon.id 
              });
            }
          }}
          onSongSaved={async (savedSong) => {
            const { getSongAsSermon } = await import('../services/songService');
            const updatedSermon = await getSongAsSermon(savedSong.id);
            if (updatedSermon) {
              useAppStore.setState({ 
                activeSermon: updatedSermon, 
                selectedSermonId: updatedSermon.id 
              });
            }
          }}
        />
      )}
    </div>
  );
};

export default Reader;
