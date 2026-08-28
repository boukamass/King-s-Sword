import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, Calendar, Clock, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { Highlight } from '../types';
import { WordDefinition } from '../services/dictionaryService';

const PROJECTION_HIGHLIGHT_STYLING: Record<string, string> = {
  sky: 'bg-sky-500/40 border-b-[3px] border-sky-400/60',
  teal: 'bg-teal-500/40 border-b-[3px] border-teal-400/60',
  amber: 'bg-amber-500/50 border-b-[3px] border-amber-400/60 shadow-[0_4px_12px_rgba(245,158,11,0.2)]',
  rose: 'bg-rose-500/40 border-b-[3px] border-rose-400/60',
  violet: 'bg-violet-500/40 border-b-[3px] border-violet-400/60',
  lime: 'bg-lime-500/40 border-b-[3px] border-lime-400/60',
  orange: 'bg-orange-500/40 border-b-[3px] border-orange-400/60',
  selection: 'bg-white text-black font-bold shadow-lg',
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
  activeDefinition: null
};

export const ProjectionView: React.FC = memo(() => {
  const [syncData, setSyncData] = useState<ProjectionSyncPayload>(() => {
    try {
      const saved = localStorage.getItem('kings_sword_last_projection_sync') || sessionStorage.getItem('kings_sword_last_projection_sync');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return { ...DEFAULT_SYNC_DATA, ...parsed };
      }
    } catch (e) {}
    return DEFAULT_SYNC_DATA;
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeWordRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [scrollProgress, setScrollProgress] = useState(0);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);

  const [isCursorIdle, setIsCursorIdle] = useState(false);
  const idleTimerRef = useRef<any>(null);

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

  // Automatic fullscreen immersion on mount & on the very first user gesture anywhere
  useEffect(() => {
    const tryFs = () => {
      if (!document.fullscreenElement) {
        triggerFullscreen();
      }
    };

    // Attempt immediately upon opening
    tryFs();

    // Auto-trigger immediately on ANY user gesture on the window (mousemove, keydown, click, touch, focus)
    const gestureEvents = ['mousemove', 'pointermove', 'pointerdown', 'mousedown', 'keydown', 'touchstart', 'focus', 'wheel'];
    const handleGesture = () => {
      tryFs();
      // Manage cursor auto-hide for total immersion
      setIsCursorIdle(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setIsCursorIdle(true), 2500);
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
  }, [triggerFullscreen]);

  const updateScrollState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const hasScroll = maxScroll > 15;
    setIsScrollable(hasScroll);
    setCanScrollUp(scrollTop > 10);
    setCanScrollDown(scrollTop < maxScroll - 10);
    setScrollProgress(maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0);
  }, []);

  const handleScrollDown = useCallback((amountMultiplier = 0.45) => {
    if (scrollContainerRef.current) {
      const scrollStep = window.innerHeight * amountMultiplier;
      scrollContainerRef.current.scrollBy({ top: scrollStep, behavior: 'smooth' });
    }
  }, []);

  const handleScrollUp = useCallback((amountMultiplier = 0.45) => {
    if (scrollContainerRef.current) {
      const scrollStep = window.innerHeight * amountMultiplier;
      scrollContainerRef.current.scrollBy({ top: -scrollStep, behavior: 'smooth' });
    }
  }, []);

  // Multi-channel Communication: BroadcastChannel, window.opener postMessage, localStorage
  useEffect(() => {
    const handlePayload = (data: any) => {
      if (!data) return;
      if (data.type === 'sync') {
        const payload: ProjectionSyncPayload = {
          title: data.title || '',
          date: data.date || '',
          city: data.city || '',
          time: data.time || '',
          text: data.text || '',
          projectedWords: data.projectedWords || [],
          fontSize: data.fontSize || 42,
          blackout: data.blackout ?? false,
          theme: data.theme || 'light',
          highlights: data.highlights || [],
          selectionIndices: data.selectionIndices || [],
          searchResults: data.searchResults || [],
          currentResultIndex: data.currentResultIndex ?? -1,
          activeDefinition: data.activeDefinition || null
        };
        setSyncData(prev => {
          if (!payload.text && prev.text && payload.title === prev.title && !payload.blackout) {
            return { ...prev, ...payload, text: prev.text, projectedWords: prev.projectedWords };
          }
          return payload;
        });
      } else if (data.type === 'scroll') {
        if (data.direction === 'down') handleScrollDown(data.amount || 0.45);
        else if (data.direction === 'up') handleScrollUp(data.amount || 0.45);
        else if (data.direction === 'top' && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('kings_sword_projection');
      channel.onmessage = (e) => handlePayload(e.data);
    } catch (err) {}

    const handleWindowMessage = (e: MessageEvent) => handlePayload(e.data);
    window.addEventListener('message', handleWindowMessage);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'kings_sword_last_projection_sync' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          handlePayload({ type: 'sync', ...parsed });
        } catch (err) {}
      }
    };
    window.addEventListener('storage', handleStorage);

    const announceReady = () => {
      if (channel) {
        try { channel.postMessage({ type: 'ready' }); } catch (e) {}
      }
      if (window.opener) {
        try { window.opener.postMessage({ type: 'ready' }, '*'); } catch (e) {}
      }
    };

    announceReady();
    const retryTimer = setTimeout(announceReady, 500);

    return () => {
      if (channel) channel.close();
      window.removeEventListener('message', handleWindowMessage);
      window.removeEventListener('storage', handleStorage);
      clearTimeout(retryTimer);
    };
  }, [handleScrollDown, handleScrollUp]);

  useEffect(() => {
    if (syncData.theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [syncData.theme]);

  // Reset scroll to top when paragraph text changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      updateScrollState();
    }
  }, [syncData.text, updateScrollState]);

  // Auto-scroll to selected word if a specific selection is made
  useEffect(() => {
    if (syncData.selectionIndices && syncData.selectionIndices.length > 0) {
      const firstIdx = syncData.selectionIndices[0];
      const targetSpan = activeWordRefs.current.get(firstIdx);
      if (targetSpan) {
        targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [syncData.selectionIndices]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let channel: BroadcastChannel | null = null;
      try { channel = new BroadcastChannel('kings_sword_projection'); } catch (err) {}

      const sendNext = () => {
        if (channel) try { channel.postMessage({ type: 'next_segment' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'next_segment' }, '*'); } catch (err) {}
      };

      const sendPrev = () => {
        if (channel) try { channel.postMessage({ type: 'prev_segment' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'prev_segment' }, '*'); } catch (err) {}
      };

      const sendBlackout = () => {
        if (channel) try { channel.postMessage({ type: 'toggle_blackout' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'toggle_blackout' }, '*'); } catch (err) {}
        setSyncData(prev => ({ ...prev, blackout: !prev.blackout }));
      };

      const closeProjectionWindow = () => {
        if (channel) try { channel.postMessage({ type: 'close' }); } catch (err) {}
        if (window.opener) try { window.opener.postMessage({ type: 'close' }, '*'); } catch (err) {}
        window.close();
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

      // Next Paragraph navigation: PageDown, ArrowRight (→)
      if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        sendNext();
        return;
      }

      // Prev Paragraph navigation: PageUp, ArrowLeft (←)
      if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        sendPrev();
        return;
      }

      // Explicit scroll down inside paragraph (Shift+ArrowDown, Shift+PageDown, 'd', 'D')
      if ((e.shiftKey && (e.key === 'ArrowDown' || e.key === 'PageDown')) || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleScrollDown(0.45);
        return;
      }

      // Explicit scroll up inside paragraph (Shift+ArrowUp, Shift+PageUp, 'u', 'U')
      if ((e.shiftKey && (e.key === 'ArrowUp' || e.key === 'PageUp')) || e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        handleScrollUp(0.45);
        return;
      }

      // ArrowDown / Space: if scrollable and not at bottom, scroll down; else go to next paragraph
      if (e.key === 'ArrowDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        if (canScrollDown) {
          handleScrollDown(0.45);
        } else {
          sendNext();
        }
        return;
      }

      // ArrowUp / Shift+Space: if scrollable and not at top, scroll up; else go to prev paragraph
      if (e.key === 'ArrowUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        if (canScrollUp) {
          handleScrollUp(0.45);
        } else {
          sendPrev();
        }
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
  }, [handleScrollDown, handleScrollUp, canScrollDown, canScrollUp, updateScrollState, triggerFullscreen]);

  const hasTitle = Boolean(syncData.title && syncData.title.trim().length > 0);
  const hasText = Boolean(syncData.text && syncData.text.trim().length > 0);

  const chars = syncData.text ? syncData.text.length : 1;
  const isSong =
    syncData.date === 'Cantique' ||
    syncData.time === 'Chant' ||
    Boolean(syncData.title && /^\d+\.\s*/.test(syncData.title) && syncData.date === 'Cantique');

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

  // For sermon paragraphs: readable sizing
  const sermonCalculatedSize = Math.max(5.6, Math.min(13.5, (102 / Math.sqrt(Math.min(chars, 420))) * 1.5));
  const sermonLineHeight = Math.max(1.25, Math.min(1.48, 1.62 - sermonCalculatedSize / 20));

  const calculatedFontSize = isSong ? songFontSizeCSS : `${sermonCalculatedSize}vmin`;
  const calculatedLineHeight = isSong ? songLineHeight : sermonLineHeight;

  // Split projected words into lines so song lines never wrap (MUST be called on every render)
  const songLinesOfWords = useMemo(() => {
    if (!isSong || !syncData.projectedWords || syncData.projectedWords.length === 0) return null;
    const lines: { text: string; globalIndex: number; color?: string }[][] = [];
    let currentLine: { text: string; globalIndex: number; color?: string }[] = [];

    for (const w of syncData.projectedWords) {
      if (w.text.includes('\n')) {
        const parts = w.text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            currentLine.push({ ...w, text: parts[i] });
          }
          if (i < parts.length - 1) {
            lines.push(currentLine);
            currentLine = [];
          }
        }
      } else {
        currentLine.push(w);
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    return lines;
  }, [isSong, syncData.projectedWords]);

  if (syncData.blackout) return <div className="fixed inset-0 bg-black z-[99999] cursor-none" />;

  if (!hasText && !hasTitle) {
    return (
      <div 
        onClick={triggerFullscreen}
        className="fixed inset-0 bg-black flex flex-col items-center justify-center p-20 text-center select-none font-sans cursor-pointer animate-in fade-in duration-300"
      >
        <img
          src="/logo.png"
          alt="Logo"
          className="w-20 h-20 opacity-80 mb-6 object-cover rounded-full shadow-lg"
        />
        <p className="text-[13px] font-black uppercase tracking-[0.5em] text-zinc-600">King's Sword Projection</p>
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-teal-600/70 mt-2">En attente de paragraphe...</p>
        {!isFullscreen && (
          <span className="mt-8 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 border border-zinc-800 bg-zinc-950 px-3.5 py-1.5 rounded-full hover:border-teal-500 hover:text-teal-400 transition-all">
            Cliquez ou appuyez sur F pour passer en Plein Écran
          </span>
        )}
      </div>
    );
  }

  if (!hasText && hasTitle) {
    return (
      <div 
        onClick={triggerFullscreen}
        className="fixed inset-0 bg-black flex flex-col items-center justify-between p-12 text-center select-none font-sans cursor-pointer animate-in fade-in duration-300"
      >
        <div className="w-full flex items-center justify-between opacity-60">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-8 h-8 object-cover rounded-full"
            />
            <span className="text-[12px] font-black uppercase tracking-[0.4em] text-teal-400">King's Sword</span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full">
            Prêt pour la projection
          </span>
        </div>

        <div className="max-w-5xl my-auto flex flex-col items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-teal-600/10 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-2 shadow-2xl overflow-hidden">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-12 h-12 object-cover rounded-full"
            />
          </div>
          <h1 className="text-[5.5vmin] font-black text-white tracking-tight leading-tight uppercase drop-shadow-2xl">
            {syncData.title}
          </h1>
          <div className="flex items-center gap-6 text-[1.8vmin] font-bold text-teal-400 uppercase tracking-widest flex-wrap justify-center mt-2">
            {syncData.date && (
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 opacity-70" />
                <span>{syncData.date}</span>
              </div>
            )}
            {syncData.time && (
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 opacity-70" />
                <span>{syncData.time}</span>
              </div>
            )}
            {syncData.city && (
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 opacity-70" />
                <span>{syncData.city}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-500">
            Sélectionnez un paragraphe dans le lecteur pour le projeter
          </div>
          {!isFullscreen && (
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 border border-zinc-800 bg-zinc-950 px-3.5 py-1.5 rounded-full hover:border-teal-500 hover:text-teal-400 transition-all">
              Cliquez ou appuyez sur F pour passer en Plein Écran
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      onClick={!isFullscreen ? triggerFullscreen : undefined}
      className={`fixed inset-0 bg-black flex flex-col items-center select-none overflow-hidden h-screen w-screen font-sans animate-in fade-in duration-300 ${
        isCursorIdle ? 'cursor-none' : 'cursor-default'
      }`}
    >
      {/* Main Text Presentation Area with Vertical Scroll */}
      <div className="h-[94%] w-full relative overflow-hidden flex flex-col">
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
          className={`flex-1 overflow-y-auto custom-scrollbar scroll-smooth py-6 flex flex-col justify-start items-stretch w-full ${
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
                  <div key={lineIdx} className="whitespace-nowrap overflow-visible leading-snug">
                    {lineWords.map((word, wIdx) => {
                      const isSelected = syncData.selectionIndices.includes(word.globalIndex);
                      const styleClass = isSelected
                        ? PROJECTION_HIGHLIGHT_STYLING.selection
                        : word.color
                        ? PROJECTION_HIGHLIGHT_STYLING[word.color] || PROJECTION_HIGHLIGHT_STYLING.default
                        : '';

                      return (
                        <span
                          key={wIdx}
                          ref={(el) => {
                            if (el) activeWordRefs.current.set(word.globalIndex, el);
                            else activeWordRefs.current.delete(word.globalIndex);
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
                  <div key={lIdx} className="whitespace-nowrap overflow-visible leading-snug">
                    {line}
                  </div>
                ))
              )
            ) : syncData.projectedWords && syncData.projectedWords.length > 0 ? (
              syncData.projectedWords.map((word, idx) => {
                const isSelected = syncData.selectionIndices.includes(word.globalIndex);
                const styleClass = isSelected
                  ? PROJECTION_HIGHLIGHT_STYLING.selection
                  : word.color
                  ? PROJECTION_HIGHLIGHT_STYLING[word.color] || PROJECTION_HIGHLIGHT_STYLING.default
                  : '';

                return (
                  <span
                    key={idx}
                    ref={(el) => {
                      if (el) activeWordRefs.current.set(word.globalIndex, el);
                      else activeWordRefs.current.delete(word.globalIndex);
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

        {/* Floating Discreet Scroll Controls & Indicator */}
        {isScrollable && (
          <div className="absolute right-6 bottom-4 z-30 flex items-center gap-2 bg-zinc-900/80 backdrop-blur-md border border-white/15 px-3.5 py-1.5 rounded-full shadow-2xl transition-all">
            <button
              onClick={() => handleScrollUp(0.4)}
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
              onClick={() => handleScrollDown(0.4)}
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

      {/* Footer Bar with Metadata (Compact Height to maximize vertical space) */}
      <div className="h-[6%] w-full bg-gradient-to-b from-zinc-950 to-black border-t border-white/10 backdrop-blur-2xl flex items-center justify-between px-6 md:px-10 shrink-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-[3.2vmin] h-[3.2vmin] rounded-full bg-teal-600/20 border border-teal-600/30 flex items-center justify-center shadow-lg overflow-hidden shrink-0">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-[2.4vmin] h-[2.4vmin] object-cover rounded-full"
            />
          </div>
          <h1 className="text-[1.8vmin] font-black text-teal-500 tracking-tighter drop-shadow-md truncate">
            {syncData.title}
          </h1>
        </div>
        <div className="flex items-center gap-5 text-[1.2vmin] font-bold text-zinc-400 uppercase tracking-[0.2em] shrink-0">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-[1.4vmin] h-[1.4vmin] text-teal-500/60" />
            <span className="font-mono">{syncData.date}</span>
          </div>
          {syncData.time && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-[1.4vmin] h-[1.4vmin] text-teal-500/60" />
              <span>{syncData.time}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <MapPin className="w-[1.4vmin] h-[1.4vmin] text-teal-500/60" />
            <span>{syncData.city}</span>
          </div>
        </div>
      </div>

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

export const MaskView: React.FC = memo(() => {
  return <div className="fixed inset-0 bg-black z-[999999] cursor-none" />;
});
