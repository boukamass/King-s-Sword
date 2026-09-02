import React, { memo, useCallback, useEffect, useMemo, useRef, useState, Component, ErrorInfo, ReactNode } from 'react';
import { BookOpenCheck, Calendar, Clock, ChevronDown, ChevronUp, MapPin, Image as ImageIcon, RefreshCw, Camera } from 'lucide-react';
import html2canvas from 'html2canvas';
import { Highlight, ProjectedImageMedia } from '../types';
import { WordDefinition } from '../services/dictionaryService';
import { getBroadcastChannel, CHANNEL_NAME, STORAGE_KEY } from '../services/projectionService';
import { executeProjectionCapture } from '../services/projectionCaptureService';
import { detectImageMeta } from '../services/imageMediaService';
import { useAppStore } from '../store';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ProjectionErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ProjectionView ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 text-center text-white font-sans">
          <div className="w-16 h-16 rounded-full bg-teal-600/20 border border-teal-500/40 flex items-center justify-center text-teal-400 mb-6">
            <RefreshCw className="w-8 h-8 animate-spin" />
          </div>
          <h2 className="text-2xl font-bold uppercase tracking-widest text-teal-400 mb-2">King's Sword Projection</h2>
          <p className="text-sm text-zinc-400 max-w-md mb-6">
            Réinitialisation du module de projection en cours...
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 cursor-pointer"
          >
            Recharger la fenêtre
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const PROJECTION_HIGHLIGHT_STYLING: Record<string, string> = {
  sky: 'bg-sky-500/40 border-b-[3px] border-sky-400/60',
  teal: 'bg-teal-500/40 border-b-[3px] border-teal-400/60',
  amber: 'bg-amber-500/50 border-b-[3px] border-amber-400/60 shadow-[0_4px_12px_rgba(245,158,11,0.2)]',
  rose: 'bg-rose-500/40 border-b-[3px] border-rose-400/60',
  violet: 'bg-violet-500/40 border-b-[3px] border-violet-400/60',
  lime: 'bg-lime-500/40 border-b-[3px] border-lime-400/60',
  orange: 'bg-orange-500/40 border-b-[3px] border-orange-400/60',
  selection: 'bg-white text-black font-bold shadow-md',
  default: 'bg-white/20 border-b-[3px] border-white/30'
};

export interface ProjectionSyncPayload {
  title: string;
  date: string;
  city: string;
  time: string;
  text: string;
  projectedWords?: { text: string; globalIndex: number; color?: string }[];
  fontSize: number;
  blackout: boolean;
  theme: string;
  highlights: Highlight[];
  selectionIndices: number[];
  searchResults: number[];
  currentResultIndex: number;
  activeDefinition: WordDefinition | null;
  isBible?: boolean;
  projectedImage?: ProjectedImageMedia | null;
  projectionBgImage?: ProjectedImageMedia | null;
}

const DEFAULT_SYNC_DATA: ProjectionSyncPayload = {
  title: '',
  date: '',
  city: '',
  time: '',
  text: '',
  fontSize: 42,
  blackout: false,
  theme: 'light',
  highlights: [],
  selectionIndices: [],
  searchResults: [],
  currentResultIndex: -1,
  activeDefinition: null,
  isBible: false,
  projectedImage: null,
  projectionBgImage: null
};

const ProjectionViewInternal: React.FC = memo(() => {
  const [syncData, setSyncData] = useState<ProjectionSyncPayload>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_SYNC_DATA,
            ...parsed,
            highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
            selectionIndices: Array.isArray(parsed.selectionIndices) ? parsed.selectionIndices : [],
            searchResults: Array.isArray(parsed.searchResults) ? parsed.searchResults : [],
            projectedWords: Array.isArray(parsed.projectedWords) ? parsed.projectedWords : []
          };
        }
      }
    } catch (e) {}
    return DEFAULT_SYNC_DATA;
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRefs = useRef<Map<number, HTMLElement>>(new Map());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const addMediaImage = useAppStore(s => s.addMediaImage);
  const addNotification = useAppStore(s => s.addNotification);

  const [isCursorIdle, setIsCursorIdle] = useState(false);
  const isCursorIdleRef = useRef(false);
  const idleTimerRef = useRef<any>(null);

  const updateCursorIdle = useCallback((idle: boolean) => {
    isCursorIdleRef.current = idle;
    setIsCursorIdle(idle);
  }, []);

  // Fullscreen helper triggered on user gesture or auto-attempt
  const triggerFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      const el = document.documentElement as any;
      const req =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen ||
        el.msRequestFullscreen;
      if (req) {
        try {
          const promise = req.call(el);
          if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {});
          }
        } catch (err) {}
      }
    }
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  // Automatic fullscreen immersion on mount & on user gesture
  useEffect(() => {
    const tryFs = () => {
      if (!document.fullscreenElement) {
        triggerFullscreen();
      }
    };

    // Attempt immediately upon opening
    tryFs();

    // Auto-trigger immediately on user gesture on the window (excluding Escape)
    const gestureEvents = ['mousemove', 'pointermove', 'pointerdown', 'mousedown', 'keydown', 'touchstart', 'focus', 'wheel'];
    const handleGesture = (e?: Event) => {
      // Do not re-trigger fullscreen on Escape or Q keystroke (used to exit projection)
      if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.key === 'q' || e.key === 'Q')) {
        return;
      }
      tryFs();
      if (isCursorIdleRef.current) {
        updateCursorIdle(false);
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => updateCursorIdle(true), 2500);
    };

    gestureEvents.forEach(evt => window.addEventListener(evt, handleGesture, { passive: true }));

    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    document.addEventListener('mozfullscreenchange', handleFsChange);
    document.addEventListener('MSFullscreenChange', handleFsChange);

    return () => {
      gestureEvents.forEach(evt => window.removeEventListener(evt, handleGesture));
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      document.removeEventListener('mozfullscreenchange', handleFsChange);
      document.removeEventListener('MSFullscreenChange', handleFsChange);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [triggerFullscreen, updateCursorIdle]);

  const updateScrollState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const hasScroll = maxScroll > 15;
    const up = scrollTop > 10;
    const down = scrollTop < maxScroll - 10;
    const progress = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0;
    
    setIsScrollable(hasScroll);
    setCanScrollUp(up);
    setCanScrollDown(down);
    setScrollProgress(progress);

    // Precise detection of visible words and top visible line snippet for Screen 1
    let topVisibleGlobalIndex: number | null = null;
    let bottomVisibleGlobalIndex: number | null = null;
    let topVisibleSnippet = '';

    if (activeWordRefs.current.size > 0) {
      const containerRect = el.getBoundingClientRect();
      const visibleWords: { index: number; el: HTMLElement; rect: DOMRect; text: string }[] = [];

      const sortedEntries = Array.from(activeWordRefs.current.entries()).sort((a, b) => a[0] - b[0]);

      for (const [gIdx, domEl] of sortedEntries) {
        if (!domEl) continue;
        const wRect = domEl.getBoundingClientRect();
        // Check if word is inside container viewport
        if (wRect.bottom >= containerRect.top + 6 && wRect.top <= containerRect.bottom - 6) {
          visibleWords.push({
            index: gIdx,
            el: domEl,
            rect: wRect,
            text: domEl.textContent || ''
          });
        }
      }

      if (visibleWords.length > 0) {
        topVisibleGlobalIndex = visibleWords[0].index;
        bottomVisibleGlobalIndex = visibleWords[visibleWords.length - 1].index;

        // Extract the first 2 visible lines (words with top coordinate within ~2.3 line heights)
        const firstTop = visibleWords[0].rect.top;
        const lineThreshold = Math.max(28, visibleWords[0].rect.height * 2.3);
        const topLinesWords = visibleWords.filter(w => w.rect.top <= firstTop + lineThreshold);
        topVisibleSnippet = topLinesWords.map(w => w.text).join('').trim();

        // Fallback: if snippet is too short, take up to the first 16 visible words
        if (topVisibleSnippet.length < 25 && visibleWords.length > topLinesWords.length) {
          topVisibleSnippet = visibleWords.slice(0, 16).map(w => w.text).join('').trim();
        }
      }
    }

    if (!topVisibleSnippet && syncData.text) {
      const lines = syncData.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const lineIdx = Math.min(lines.length - 1, Math.floor((progress / 100) * lines.length));
        topVisibleSnippet = lines.slice(lineIdx, lineIdx + 2).join(' / ');
      }
    }

    // Broadcast scroll state & live reading indicator to Screen 1
    const syncMsg = {
      type: 'projection_scroll_sync',
      progress,
      ratio: maxScroll > 0 ? scrollTop / maxScroll : 0,
      isScrollable: hasScroll,
      canScrollUp: up,
      canScrollDown: down,
      topVisibleGlobalIndex,
      bottomVisibleGlobalIndex,
      topVisibleSnippet,
      timestamp: Date.now()
    };
    if (channelRef.current) {
      try { channelRef.current.postMessage(syncMsg); } catch (e) {}
    }
    if (window.opener) {
      try { window.opener.postMessage(syncMsg, '*'); } catch (e) {}
    }
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(syncMsg, '*'); } catch (e) {}
    }
    try { window.postMessage(syncMsg, '*'); } catch (e) {}
  }, [syncData.text]);

  // --- Silky Smooth Physics-based Wheel & Key Scroll Engine ---
  const targetScrollTopRef = useRef<number>(0);
  const isAnimatingScrollRef = useRef<boolean>(false);
  const smoothAnimFrameRef = useRef<number | null>(null);

  const stepSmoothScroll = useCallback(() => {
    if (!scrollContainerRef.current) {
      isAnimatingScrollRef.current = false;
      return;
    }
    const current = scrollContainerRef.current.scrollTop;
    const target = targetScrollTopRef.current;
    const diff = target - current;

    if (Math.abs(diff) < 0.6) {
      scrollContainerRef.current.scrollTop = target;
      isAnimatingScrollRef.current = false;
      updateScrollState();
      return;
    }

    // Perfectly balanced easing (0.16) for fluid, non-abrupt and responsive scrolling
    scrollContainerRef.current.scrollTop = current + diff * 0.16;
    updateScrollState();
    smoothAnimFrameRef.current = requestAnimationFrame(stepSmoothScroll);
  }, [updateScrollState]);

  const smoothScrollBy = useCallback((amount: number) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    if (!isAnimatingScrollRef.current) {
      targetScrollTopRef.current = el.scrollTop;
    }
    targetScrollTopRef.current = Math.max(0, Math.min(maxScroll, targetScrollTopRef.current + amount));

    if (!isAnimatingScrollRef.current) {
      isAnimatingScrollRef.current = true;
      if (smoothAnimFrameRef.current) cancelAnimationFrame(smoothAnimFrameRef.current);
      smoothAnimFrameRef.current = requestAnimationFrame(stepSmoothScroll);
    }
  }, [stepSmoothScroll]);

  const handleScrollDown = useCallback((amountMultiplier = 0.4) => {
    smoothScrollBy(window.innerHeight * amountMultiplier);
  }, [smoothScrollBy]);

  const handleScrollUp = useCallback((amountMultiplier = 0.4) => {
    smoothScrollBy(-window.innerHeight * amountMultiplier);
  }, [smoothScrollBy]);

  // --- Middle-Click (Molette / Bouton Central) Autoscroll Engine ---
  const [autoScrollOrigin, setAutoScrollOrigin] = useState<{ x: number; y: number } | null>(null);
  const [autoScrollDirection, setAutoScrollDirection] = useState<'up' | 'down' | 'idle'>('idle');
  const autoScrollOriginRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollVelocityRef = useRef<number>(0);
  const autoScrollLoopRef = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollLoopRef.current) {
      cancelAnimationFrame(autoScrollLoopRef.current);
      autoScrollLoopRef.current = null;
    }
    autoScrollOriginRef.current = null;
    autoScrollVelocityRef.current = 0;
    setAutoScrollOrigin(null);
    setAutoScrollDirection('idle');
  }, []);

  const runAutoScrollLoop = useCallback(() => {
    if (!autoScrollOriginRef.current || !scrollContainerRef.current) {
      stopAutoScroll();
      return;
    }

    if (Math.abs(autoScrollVelocityRef.current) > 0.02) {
      scrollContainerRef.current.scrollTop += autoScrollVelocityRef.current;
      targetScrollTopRef.current = scrollContainerRef.current.scrollTop;
      updateScrollState();
    }

    autoScrollLoopRef.current = requestAnimationFrame(runAutoScrollLoop);
  }, [stopAutoScroll, updateScrollState]);

  const startAutoScroll = useCallback((x: number, y: number) => {
    if (autoScrollOriginRef.current) {
      stopAutoScroll();
      return;
    }

    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    // Stop any ongoing wheel animation
    if (isAnimatingScrollRef.current) {
      isAnimatingScrollRef.current = false;
      if (smoothAnimFrameRef.current) cancelAnimationFrame(smoothAnimFrameRef.current);
    }

    autoScrollOriginRef.current = { x, y };
    autoScrollVelocityRef.current = 0;
    setAutoScrollOrigin({ x, y });
    setAutoScrollDirection('idle');

    if (autoScrollLoopRef.current) cancelAnimationFrame(autoScrollLoopRef.current);
    autoScrollLoopRef.current = requestAnimationFrame(runAutoScrollLoop);
  }, [runAutoScrollLoop, stopAutoScroll]);

  // Wheel listener for ultra-smooth fluid scrolling
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;

      if (autoScrollOriginRef.current) {
        stopAutoScroll();
      }

      e.preventDefault();
      const step = e.deltaY * 0.85;
      smoothScrollBy(step);
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [smoothScrollBy, stopAutoScroll]);

  // Mouse listeners for middle button (button 1) autoscroll
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        startAutoScroll(e.clientX, e.clientY);
        return;
      }

      if (autoScrollOriginRef.current) {
        stopAutoScroll();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!autoScrollOriginRef.current) return;
      const dy = e.clientY - autoScrollOriginRef.current.y;
      const deadzone = 10;

      if (Math.abs(dy) <= deadzone) {
        autoScrollVelocityRef.current = 0;
        setAutoScrollDirection('idle');
      } else {
        const sign = Math.sign(dy);
        const distance = Math.abs(dy) - deadzone;
        const speed = Math.min(15, Math.pow(distance / 9, 1.25) * 0.7);
        autoScrollVelocityRef.current = sign * speed;
        setAutoScrollDirection(sign > 0 ? 'down' : 'up');
      }
    };

    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('auxclick', handleAuxClick);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('auxclick', handleAuxClick);
      if (smoothAnimFrameRef.current) cancelAnimationFrame(smoothAnimFrameRef.current);
      if (autoScrollLoopRef.current) cancelAnimationFrame(autoScrollLoopRef.current);
    };
  }, [startAutoScroll, stopAutoScroll]);

  const performCapture = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      await executeProjectionCapture();
    } catch (err) {
      console.error('Erreur lors de la capture de projection:', err);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const performCaptureRef = useRef(performCapture);
  useEffect(() => {
    performCaptureRef.current = performCapture;
  }, [performCapture]);

  // Multi-channel Communication: BroadcastChannel, window.opener postMessage, localStorage
  useEffect(() => {
    const handlePayload = (data: any) => {
      if (!data) return;
      if (data.type === 'sync') {
        const payload: ProjectionSyncPayload = {
          title: String(data.title || ''),
          date: String(data.date || ''),
          city: String(data.city || ''),
          time: String(data.time || ''),
          text: String(data.text || ''),
          projectedWords: Array.isArray(data.projectedWords) ? data.projectedWords : [],
          fontSize: typeof data.fontSize === 'number' ? data.fontSize : 42,
          blackout: Boolean(data.blackout),
          theme: data.theme || 'light',
          highlights: Array.isArray(data.highlights) ? data.highlights : [],
          selectionIndices: Array.isArray(data.selectionIndices) ? data.selectionIndices : [],
          searchResults: Array.isArray(data.searchResults) ? data.searchResults : [],
          currentResultIndex: typeof data.currentResultIndex === 'number' ? data.currentResultIndex : -1,
          activeDefinition: data.activeDefinition || null,
          isBible: Boolean(data.isBible),
          projectedImage: data.projectedImage || null,
          projectionBgImage: data.projectionBgImage || null
        };
        setSyncData(payload);
      } else if (data.type === 'scroll') {
        if (data.direction === 'down') handleScrollDown(data.amount || 0.45);
        else if (data.direction === 'up') handleScrollUp(data.amount || 0.45);
        else if (data.direction === 'top' && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (data.direction === 'bottom' && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
        } else if (data.direction === 'ratio' && typeof data.ratio === 'number' && scrollContainerRef.current) {
          const el = scrollContainerRef.current;
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (maxScroll > 0) {
            el.scrollTo({ top: data.ratio * maxScroll, behavior: 'smooth' });
          }
        }
      } else if (data.type === 'capture') {
        if (performCaptureRef.current) {
          performCaptureRef.current();
        }
      }
    };

    try {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.onmessage = (e) => handlePayload(e.data);
    } catch (err) {}

    const handleWindowMessage = (e: MessageEvent) => handlePayload(e.data);
    window.addEventListener('message', handleWindowMessage);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && typeof parsed === 'object') {
            handlePayload({ type: 'sync', ...parsed });
          }
        } catch (err) {}
      }
    };
    window.addEventListener('storage', handleStorage);

    const announceReady = () => {
      if (channelRef.current) {
        try { channelRef.current.postMessage({ type: 'ready' }); } catch (e) {}
      }
      if (window.opener) {
        try { window.opener.postMessage({ type: 'ready' }, '*'); } catch (e) {}
      }
    };

    announceReady();
    const retryTimer1 = setTimeout(announceReady, 250);
    const retryTimer2 = setTimeout(announceReady, 800);

    return () => {
      if (channelRef.current) {
        channelRef.current.close();
        channelRef.current = null;
      }
      window.removeEventListener('message', handleWindowMessage);
      window.removeEventListener('storage', handleStorage);
      clearTimeout(retryTimer1);
      clearTimeout(retryTimer2);
    };
  }, [handleScrollDown, handleScrollUp]);

  useEffect(() => {
    if (syncData.theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [syncData.theme]);

  // Reset scroll to top when paragraph text changes and broadcast initial line positions
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      targetScrollTopRef.current = 0;
      updateScrollState();
    }
    const t1 = setTimeout(() => updateScrollState(), 60);
    const t2 = setTimeout(() => updateScrollState(), 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [syncData.text, syncData.projectedWords, updateScrollState]);

  // Selection indices change handler (no auto-scroll during continuous drag selection to avoid text jumping)
  useEffect(() => {
    // Selection state is rendered via syncData.selectionIndices in the template without moving the screen
  }, [syncData.selectionIndices]);

  // Keyboard navigation reusing channelRef
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if (isInput) return;

      const sendNext = () => {
        if (channelRef.current) try { channelRef.current.postMessage({ type: 'next_segment' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'next_segment' }, '*'); } catch (err) {}
      };

      const sendPrev = () => {
        if (channelRef.current) try { channelRef.current.postMessage({ type: 'prev_segment' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'prev_segment' }, '*'); } catch (err) {}
      };

      const sendNextSource = () => {
        if (channelRef.current) try { channelRef.current.postMessage({ type: 'next_source' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'next_source' }, '*'); } catch (err) {}
      };

      const sendPrevSource = () => {
        if (channelRef.current) try { channelRef.current.postMessage({ type: 'prev_source' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'prev_source' }, '*'); } catch (err) {}
      };

      const sendBlackout = () => {
        if (channelRef.current) try { channelRef.current.postMessage({ type: 'toggle_blackout' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'toggle_blackout' }, '*'); } catch (err) {}
        setSyncData(prev => ({ ...prev, blackout: !prev.blackout }));
      };

      const closeProjectionWindow = () => {
        if (channelRef.current) try { channelRef.current.postMessage({ type: 'close' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'close' }, '*'); } catch (err) {}
        try { window.close(); } catch (err) {}
      };

      // Fullscreen shortcut
      if (e.key === 'f' || e.key === 'F' || e.key === 'F11' || e.key === 'F5') {
        e.preventDefault();
        triggerFullscreen();
        return;
      }

      // Escape / q / Q: close / stop projection
      if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        closeProjectionWindow();
        return;
      }

      // Blackout toggle: B or . (presentation remote standard)
      if (e.key === 'b' || e.key === 'B' || e.key === '.') {
        e.preventDefault();
        sendBlackout();
        return;
      }

      // Next Paragraph in same source: ArrowRight (→)
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        sendNext();
        return;
      }

      // Prev Paragraph in same source: ArrowLeft (←)
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        sendPrev();
        return;
      }

      // Next / Prev Source: PageDown (Source Suivante) / PageUp (Source Précédente)
      if (e.key === 'PageDown') {
        e.preventDefault();
        sendNextSource();
        return;
      }

      if (e.key === 'PageUp') {
        e.preventDefault();
        sendPrevSource();
        return;
      }

      // Scroll Down inside content: ArrowDown (↓)
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        smoothScrollBy(90);
        return;
      }

      // Scroll Up inside content: ArrowUp (↑)
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        smoothScrollBy(-90);
        return;
      }

      // Space: Next segment / Shift+Space: Prev segment
      if (e.key === ' ') {
        e.preventDefault();
        if (e.shiftKey) sendPrev();
        else sendNext();
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateScrollState);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState, triggerFullscreen, smoothScrollBy]);

  const hasTitle = Boolean(syncData.title && syncData.title.trim().length > 0);
  const hasText = Boolean(syncData.text && syncData.text.trim().length > 0);

  const isSong =
    syncData.date === 'Cantique' ||
    syncData.time === 'Chant' ||
    Boolean(syncData.title && /^\d+\.\s*/.test(syncData.title) && syncData.date === 'Cantique');

  const isBible = Boolean(
    syncData.isBible ||
    (syncData.city && (syncData.city.includes('Testament') || syncData.city.includes('Bible'))) ||
    (syncData.date && ['LSG 1910', 'KJV', 'DARBY', 'OSTERVALD', 'MARTIN', 'BIBLE'].includes(syncData.date.toUpperCase()))
  );

  const songLines = useMemo(() => {
    if (!syncData.text) return [];
    return syncData.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }, [syncData.text]);

  const songLinesCount = Math.max(songLines.length, 1);
  const maxLineLength = Math.max(...(songLines.length > 0 ? songLines.map(l => l.length) : [1]), 1);

  // Dynamic font sizing for songs
  const songFitWidthVw = Math.max(1.2, 80 / (maxLineLength * 0.58));
  const songFitHeightVh = Math.max(1.5, 68 / (songLinesCount * 1.32));
  const songFontSizeCSS = `min(${songFitWidthVw.toFixed(2)}vw, ${songFitHeightVh.toFixed(2)}vh, 8.5vmin)`;
  const songLineHeight = 1.32;

  // Fixed optimal font sizing calibrated for 1080p screen viewed at 15-18 meters
  const sermonFixedFontSize = '5.4vmin';
  const sermonLineHeight = 1.48;

  // Fixed optimal font size for Bible verses
  const bibleCalculatedSize = '5.2vmin';
  const bibleLineHeight = 1.44;

  // Instant preloading of projection background image
  useEffect(() => {
    if (syncData.projectionBgImage?.url) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = syncData.projectionBgImage.url;
    }
  }, [syncData.projectionBgImage?.url]);

  const calculatedFontSize = isSong
    ? songFontSizeCSS
    : isBible
    ? bibleCalculatedSize
    : sermonFixedFontSize;
  const headerFontSizeCSS = useMemo(() => {
    const titleStr = syncData.title || '';
    const metaStr = (syncData.date || '') + (syncData.time || '') + (syncData.city || '');
    const totalChars = Math.max(12, titleStr.length + (metaStr.length > 0 ? metaStr.length + 8 : 0));
    // Calculate max size in vmin so title & metadata fit generously on 1 single line without overflow, truncation or wrapping
    const maxFitVmin = Math.max(1.85, 115 / (totalChars * 0.48));
    return `min(${calculatedFontSize}, ${maxFitVmin.toFixed(2)}vmin)`;
  }, [calculatedFontSize, syncData.title, syncData.date, syncData.time, syncData.city]);
  const calculatedLineHeight = isSong
    ? songLineHeight
    : isBible
    ? bibleLineHeight
    : sermonLineHeight;

  // Split projected words into lines so song lines never wrap safely
  const songLinesOfWords = useMemo(() => {
    if (!isSong || !syncData.projectedWords || syncData.projectedWords.length === 0) return null;
    const lines: { text: string; globalIndex: number; color?: string }[][] = [];
    let currentLine: { text: string; globalIndex: number; color?: string }[] = [];

    for (const w of syncData.projectedWords) {
      if (w && typeof w.text === 'string' && w.text.includes('\n')) {
        const parts = w.text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            currentLine.push({ ...w, text: parts[i] });
          }
          if (i < parts.length - 1) {
            lines.push(currentLine.length > 0 ? currentLine : [{ text: '\u00A0', globalIndex: -1 }]);
            currentLine = [];
          }
        }
      } else if (w) {
        currentLine.push(w);
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    return lines;
  }, [isSong, syncData.projectedWords]);

  if (syncData.blackout) return <div className="fixed inset-0 bg-black z-[99999] cursor-none" />;

  // Image Projection Module (VideoPsalm / Broadcast Quality Presentation)
  if (syncData.projectedImage && syncData.projectedImage.url) {
    const img = syncData.projectedImage;

    return (
      <div 
        onClick={!isFullscreen ? triggerFullscreen : undefined}
        className={`fixed inset-0 bg-black flex items-center justify-center select-none overflow-hidden h-screen w-screen font-sans animate-in fade-in duration-300 relative ${
          isCursorIdle ? 'cursor-none' : 'cursor-default'
        }`}
      >
        <img
          src={img.url}
          alt={img.name || 'Image projetée'}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          className="w-full h-full object-cover select-none animate-in fade-in duration-300 transform-gpu"
        />
      </div>
    );
  }

  // Idle Projection Screen (When no paragraph text is currently selected)
  if (!hasText) {
    const displayTitle = syncData.title || "KING'S SWORD";
    const hasMeta = Boolean(syncData.date || syncData.time || syncData.city);

    return (
      <div 
        onClick={triggerFullscreen}
        className="fixed inset-0 w-screen h-screen bg-black flex items-center justify-center p-4 md:p-8 text-center select-none font-sans cursor-pointer animate-in fade-in duration-300 relative overflow-hidden"
      >
        {/* Fullscreen Background Image Layer */}
        {syncData.projectionBgImage && syncData.projectionBgImage.url && (
          <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
            <img
              src={syncData.projectionBgImage.url}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              className="w-full h-full object-cover opacity-80 brightness-95 transition-all duration-700 transform-gpu"
            />
            <div className="absolute inset-0 bg-black/40" />
          </div>
        )}

        {/* Centered Aesthetic Card (Logo, Title & Metadata strictly 100% centered) */}
        <div className="relative z-10 flex flex-col items-center justify-center max-w-4xl w-full p-8 md:p-12 rounded-3xl bg-black/50 backdrop-blur-md border border-white/15 shadow-2xl space-y-6 animate-in zoom-in-95 duration-300">
          {/* Logo Emblem */}
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-teal-500/10 border-2 border-teal-500/40 flex items-center justify-center shadow-2xl overflow-hidden ring-4 ring-teal-500/10">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              className="w-14 h-14 md:w-16 md:h-16 object-cover rounded-full"
            />
          </div>

          {/* Main Title */}
          <h1 className="text-[5.5vmin] font-black text-white tracking-tight leading-tight uppercase drop-shadow-2xl">
            {displayTitle}
          </h1>

          {/* Metadata: Date, Time, City */}
          {hasMeta && (
            <div className="flex items-center gap-4 md:gap-6 text-[1.8vmin] font-bold text-teal-300 uppercase tracking-widest flex-wrap justify-center">
              {syncData.date && (
                <div className="flex items-center gap-2 bg-black/50 px-4 py-1.5 rounded-full border border-teal-500/20">
                  <Calendar className="w-4 h-4 text-teal-400" />
                  <span>{syncData.date}</span>
                </div>
              )}
              {syncData.time && (
                <div className="flex items-center gap-2 bg-black/50 px-4 py-1.5 rounded-full border border-teal-500/20">
                  <Clock className="w-4 h-4 text-teal-400" />
                  <span>{syncData.time}</span>
                </div>
              )}
              {syncData.city && (
                <div className="flex items-center gap-2 bg-black/50 px-4 py-1.5 rounded-full border border-teal-500/20">
                  <MapPin className="w-4 h-4 text-teal-400" />
                  <span>{syncData.city}</span>
                </div>
              )}
            </div>
          )}

          {/* Status Instruction Badge */}
          <div className="pt-2">
            <span className="text-[1.2vmin] font-bold uppercase tracking-[0.25em] text-zinc-300 bg-teal-950/80 border border-teal-500/30 px-5 py-2 rounded-full shadow-lg inline-block">
              SÉLECTIONNEZ UN PARAGRAPHE POUR PROJETER
            </span>
          </div>

          {/* Fullscreen Hint */}
          {!isFullscreen && (
            <span className="text-[1vmin] font-semibold uppercase tracking-[0.2em] text-zinc-400 border border-zinc-800 bg-zinc-950/80 px-4 py-1.5 rounded-full hover:border-teal-500 hover:text-teal-400 transition-all">
              Cliquez ou appuyez sur F pour le Plein Écran
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      id="projection-view-container"
      data-projection-view="true"
      ref={containerRef}
      onClick={!isFullscreen ? triggerFullscreen : undefined}
      className={`fixed inset-0 bg-black flex flex-col items-center select-none overflow-hidden h-screen w-screen font-sans animate-in fade-in duration-300 relative ${
        isCursorIdle ? 'cursor-none' : 'cursor-default'
      }`}
    >
      {/* Projection Background Image Layer */}
      {syncData.projectionBgImage && syncData.projectionBgImage.url && (
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
          <img
            src={syncData.projectionBgImage.url}
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            className="w-full h-full object-cover opacity-80 brightness-90 transition-all duration-700 transform-gpu"
          />
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

      {/* Top Header Bar with Title & Metadata (Strict single-line height to maximize projected text area) */}
      <div className="w-full bg-gradient-to-b from-black/90 via-black/75 to-transparent border-b border-white/10 backdrop-blur-md flex flex-nowrap items-center justify-between px-6 md:px-10 py-2.5 shrink-0 z-30 gap-6 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1 whitespace-nowrap">
          <div className="w-[1.2em] h-[1.2em] rounded-full bg-teal-600/20 border border-teal-600/30 flex items-center justify-center shadow-lg overflow-hidden shrink-0" style={{ fontSize: headerFontSizeCSS }}>
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              className="w-[0.9em] h-[0.9em] object-cover rounded-full"
            />
          </div>
          <h1 
            className="font-black text-teal-400 tracking-tight drop-shadow-md whitespace-nowrap shrink-0"
            style={{ fontSize: headerFontSizeCSS }}
          >
            {syncData.title}
          </h1>
        </div>
        
        <div 
          className="flex items-center gap-5 font-bold text-zinc-300 uppercase tracking-wider whitespace-nowrap shrink-0"
          style={{ fontSize: headerFontSizeCSS }}
        >
          {syncData.date && (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-[0.9em] h-[0.9em] text-teal-400/80 shrink-0" />
              <span className="font-mono">{syncData.date}</span>
            </div>
          )}
          {syncData.time && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-[0.9em] h-[0.9em] text-teal-400/80 shrink-0" />
              <span>{syncData.time}</span>
            </div>
          )}
          {syncData.city && (
            <div className="flex items-center gap-1.5">
              <MapPin className="w-[0.9em] h-[0.9em] text-teal-400/80 shrink-0" />
              <span>{syncData.city}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Text Presentation Area with Vertical Scroll */}
      <div className="flex-1 w-full relative z-10 overflow-hidden flex flex-col pb-0 mb-0">
        {/* Top Gradient Overflow Mask */}
        <div
          className={`absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black via-black/70 to-transparent z-20 pointer-events-none transition-opacity duration-300 ${
            canScrollUp ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Scrollable Text Body */}
        <div
          ref={scrollContainerRef}
          onScroll={updateScrollState}
          className={`flex-1 overflow-y-auto custom-scrollbar py-6 flex flex-col justify-start items-stretch w-full ${
            isSong ? 'px-3 sm:px-4 md:px-6' : 'pl-5 sm:pl-7 md:pl-10 pr-3 sm:pr-4 md:pr-6'
          }`}
        >
          <div
            className={`text-white font-bold my-auto w-full max-w-none whitespace-pre-wrap ${
              isSong ? 'text-center' : 'text-left'
            }`}
            style={{
              fontSize: calculatedFontSize,
              lineHeight: calculatedLineHeight,
              textShadow: '0 4px 30px rgba(0,0,0,0.6)',
              wordBreak: 'break-word',
              overflowWrap: 'break-word'
            }}
          >
            {isSong ? (
              songLinesOfWords ? (
                songLinesOfWords.map((lineWords, lineIdx) => (
                  <div key={lineIdx} className="whitespace-nowrap overflow-visible leading-snug min-h-[1em]">
                    {lineWords.map((word, wIdx) => {
                      const isSelected = Array.isArray(syncData.selectionIndices) && typeof word.globalIndex === 'number' && syncData.selectionIndices.includes(word.globalIndex);
                      const styleClass = isSelected
                        ? PROJECTION_HIGHLIGHT_STYLING.selection
                        : word.color
                        ? PROJECTION_HIGHLIGHT_STYLING[word.color] || PROJECTION_HIGHLIGHT_STYLING.default
                        : '';

                      return (
                        <span
                          key={wIdx}
                          ref={(el) => {
                            if (typeof word.globalIndex === 'number' && word.globalIndex >= 0) {
                              if (el) activeWordRefs.current.set(word.globalIndex, el);
                              else activeWordRefs.current.delete(word.globalIndex);
                            }
                          }}
                          className={`py-0.5 ${styleClass}`}
                        >
                          {word.text}
                        </span>
                      );
                    })}
                  </div>
                ))
              ) : (
                syncData.text.split(/\r?\n/).map((line, lIdx) => (
                  <div key={lIdx} className="whitespace-nowrap overflow-visible leading-snug min-h-[1em]">
                    {line || '\u00A0'}
                  </div>
                ))
              )
            ) : Array.isArray(syncData.projectedWords) && syncData.projectedWords.length > 0 ? (
              syncData.projectedWords.map((word, idx) => {
                const isSelected = Array.isArray(syncData.selectionIndices) && typeof word.globalIndex === 'number' && syncData.selectionIndices.includes(word.globalIndex);
                const styleClass = isSelected
                  ? PROJECTION_HIGHLIGHT_STYLING.selection
                  : word.color
                  ? PROJECTION_HIGHLIGHT_STYLING[word.color] || PROJECTION_HIGHLIGHT_STYLING.default
                  : '';

                return (
                  <span
                    key={idx}
                    ref={(el) => {
                      if (typeof word.globalIndex === 'number' && word.globalIndex >= 0) {
                        if (el) activeWordRefs.current.set(word.globalIndex, el);
                        else activeWordRefs.current.delete(word.globalIndex);
                      }
                    }}
                    className={`py-1 ${styleClass}`}
                  >
                    {word.text}
                  </span>
                );
              })
            ) : (
              syncData.text
            )}
          </div>
        </div>

        {/* Bottom Gradient Overflow Mask */}
        <div
          className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black via-black/80 to-transparent z-20 pointer-events-none transition-opacity duration-300 ${
            canScrollDown ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Elegant Application Name Watermark (Bottom Right) */}
        <div className="absolute right-6 bottom-3.5 z-20 pointer-events-none select-none flex items-center gap-2 opacity-60 hover:opacity-90 transition-opacity">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)] shrink-0" />
          <span className="text-[1.1vmin] font-black tracking-[0.2em] text-zinc-200 uppercase drop-shadow-md">
            King’s Sword
          </span>
        </div>

        {/* Floating Discreet Scroll Controls (Only if scrollable) */}
        {isScrollable && (
          <div 
            className="no-capture absolute right-6 bottom-11 z-30 flex items-center gap-2 bg-zinc-900/85 backdrop-blur-md border border-white/20 px-3 py-1.5 rounded-full shadow-2xl transition-all select-none"
            data-html2canvas-ignore="true"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleScrollUp(0.4);
              }}
              className={`p-1 text-zinc-300 hover:text-teal-400 active:scale-90 transition-all ${
                !canScrollUp ? 'opacity-30 cursor-not-allowed' : ''
              }`}
              data-tooltip="Défiler vers le haut (Flèche Haut / Molette)"
            >
              <ChevronUp className="w-5 h-5" />
            </button>
            <span className="text-[1.2vmin] font-mono font-bold text-teal-400 tracking-wider">
              {scrollProgress}%
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleScrollDown(0.4);
              }}
              className={`p-1 text-zinc-300 hover:text-teal-400 active:scale-90 transition-all ${
                !canScrollDown ? 'opacity-30 cursor-not-allowed' : ''
              }`}
              data-tooltip="Défiler vers le bas (Flèche Bas / Molette / Espace)"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Middle Mouse Button (Molette) AutoScroll HUD Disc */}
      {autoScrollOrigin && (
        <div
          className="fixed pointer-events-none z-[999999] flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${autoScrollOrigin.x}px`, top: `${autoScrollOrigin.y}px` }}
        >
          <div className="relative w-12 h-12 rounded-full bg-zinc-950/90 border-2 border-teal-500/90 shadow-[0_0_30px_rgba(20,184,166,0.5)] backdrop-blur-md flex items-center justify-center animate-in zoom-in-75 duration-150">
            {/* Top Directional Arrow */}
            <ChevronUp
              className={`w-4 h-4 absolute top-0.5 transition-all duration-150 ${
                autoScrollDirection === 'up'
                  ? 'text-teal-300 scale-125 -translate-y-0.5 drop-shadow-[0_0_8px_rgba(45,212,191,0.9)]'
                  : 'text-zinc-600 opacity-60'
              }`}
            />
            {/* Center Anchor Indicator */}
            <div
              className={`w-2.5 h-2.5 rounded-full transition-all duration-150 ${
                autoScrollDirection !== 'idle'
                  ? 'bg-teal-400 scale-110 shadow-[0_0_10px_rgba(45,212,191,0.9)]'
                  : 'bg-zinc-400'
              }`}
            />
            {/* Bottom Directional Arrow */}
            <ChevronDown
              className={`w-4 h-4 absolute bottom-0.5 transition-all duration-150 ${
                autoScrollDirection === 'down'
                  ? 'text-teal-300 scale-125 translate-y-0.5 drop-shadow-[0_0_8px_rgba(45,212,191,0.9)]'
                  : 'text-zinc-600 opacity-60'
              }`}
            />
          </div>
        </div>
      )}

      {/* Definition Pop-up Modal on Grand Screen */}
      {syncData.activeDefinition && (
        <div className="fixed inset-0 z-[100000] bg-black/95 flex items-center justify-center p-12 md:p-20 animate-in fade-in duration-500">
          <div className="max-w-5xl w-full space-y-10 text-center">
            <div className="flex items-center justify-center gap-8">
              <div className="w-20 h-20 flex items-center justify-center bg-teal-600/10 text-teal-500 rounded-[28px] border border-teal-600/20">
                <BookOpenCheck className="w-10 h-10" />
              </div>
              <h3 className="text-6xl font-black text-white leading-none uppercase tracking-tight">
                {syncData.activeDefinition.word}
              </h3>
            </div>
            <div className="p-12 md:p-16 bg-teal-600/10 border border-teal-600/20 rounded-[48px]">
              <p className="text-4xl md:text-5xl leading-tight text-zinc-100 font-medium italic">
                {syncData.activeDefinition.definition}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export const ProjectionView: React.FC = memo(() => {
  return (
    <ProjectionErrorBoundary>
      <ProjectionViewInternal />
    </ProjectionErrorBoundary>
  );
});

export const MaskView: React.FC = memo(() => {
  return <div className="fixed inset-0 bg-black z-[999999] cursor-none" />;
});

