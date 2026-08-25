
import React, { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar';
import Reader from './components/Reader';
import AIAssistant from './components/AIAssistant';
import NotesPanel from './components/NotesPanel';
import Notifications from './components/Notifications';
import NoteEditor from './components/NoteEditor';
import { Sparkles, NotebookPen, Info, Trash2, HelpCircle, Calendar, MapPin, Quote, BookOpenCheck, Feather, Milestone, Loader2, Clock, ChevronUp, ChevronDown, BookOpen, Maximize, Minimize, Eye, EyeOff, X } from 'lucide-react';
import { Highlight } from './types';
import { WordDefinition } from './services/dictionaryService';

const GlobalTooltip = memo(({ data }: { data: { x: number, y: number, text: string, icon?: string } | null }) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!data || !tooltipRef.current) return;
    const tooltipWidth = tooltipRef.current.offsetWidth || 150;
    const tooltipHeight = tooltipRef.current.offsetHeight || 32;
    let targetX = data.x + 15;
    let targetY = data.y + 15;
    if (targetX + tooltipWidth > window.innerWidth) targetX = data.x - tooltipWidth - 10;
    if (targetY + tooltipHeight > window.innerHeight) targetY = data.y - tooltipHeight - 10;
    setAdjustedPos({ x: targetX, y: targetY });
  }, [data]);

  if (!data) return null;

  const getIcon = () => {
    switch (data.icon) {
      case 'trash': return <Trash2 className="w-3 h-3 text-red-500" />;
      case 'sparkles': return <Sparkles className="w-3 h-3 text-blue-400" />;
      case 'info': return <Info className="w-3 h-3 text-blue-400" />;
      default: return <HelpCircle className="w-3 h-3 text-zinc-500/50" />;
    }
  };

  return (
    <div ref={tooltipRef} className="fixed pointer-events-none z-[999999] bg-[#0c0c0f] text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-2xl border border-white/15 animate-in fade-in zoom-in-95 duration-150 flex items-center gap-2 whitespace-nowrap" style={{ left: adjustedPos.x, top: adjustedPos.y }}>
      {getIcon()}{data.text}
    </div>
  );
});

const MainContent = memo(({ activeNoteId }: { activeNoteId: string | null }) => {
  if (activeNoteId) return <NoteEditor />;
  return <Reader />;
});

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

const ProjectionView = memo(() => {
  const [syncData, setSyncData] = useState<{ 
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
  }>(() => {
    try {
      const saved = localStorage.getItem('kings_sword_last_projection_sync');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      title: '', date: '', city: '', time: '', text: '', fontSize: 42, blackout: false, theme: 'light',
      highlights: [], selectionIndices: [], searchResults: [], currentResultIndex: -1, activeDefinition: null
    };
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeWordRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [scrollProgress, setScrollProgress] = useState(0);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  // Auto-fullscreen & full 100% screen resolution handling
  useEffect(() => {
    const triggerFullscreen = () => {
      if (!document.fullscreenElement) {
        const el = document.documentElement as any;
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        } else if (el.mozRequestFullScreen) {
          el.mozRequestFullScreen();
        } else if (el.msRequestFullscreen) {
          el.msRequestFullscreen();
        }
      }
    };

    triggerFullscreen();
    const timers = [10, 50, 100, 250, 500, 1000, 2000].map(ms => setTimeout(triggerFullscreen, ms));

    try {
      if (window.screen) {
        window.moveTo(window.screen.availLeft || 0, window.screen.availTop || 0);
        window.resizeTo(window.screen.availWidth || screen.width, window.screen.availHeight || screen.height);
      }
    } catch (e) {}

    const events = ['click', 'touchstart', 'pointerdown', 'keydown', 'focus', 'mousemove', 'mouseenter', 'load'];
    events.forEach(evt => window.addEventListener(evt, triggerFullscreen));

    return () => {
      events.forEach(evt => window.removeEventListener(evt, triggerFullscreen));
      timers.forEach(t => clearTimeout(t));
    };
  }, []);

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

  useEffect(() => {
    const handlePayload = (data: any) => {
      if (!data) return;
      if (data.type === 'sync') {
        const payload = { 
          title: data.title || '', date: data.date || '', city: data.city || '', time: data.time || '', text: data.text || '', 
          projectedWords: data.projectedWords,
          fontSize: data.fontSize || 42, blackout: data.blackout ?? false, theme: data.theme || 'light',
          highlights: data.highlights || [], selectionIndices: data.selectionIndices || [],
          searchResults: data.searchResults || [], currentResultIndex: data.currentResultIndex ?? -1, activeDefinition: data.activeDefinition || null
        };
        setSyncData(payload);
        try { localStorage.setItem('kings_sword_last_projection_sync', JSON.stringify(payload)); } catch(err) {}
      } else if (data.type === 'scroll') {
        if (data.direction === 'down') handleScrollDown(data.amount || 0.45);
        else if (data.direction === 'up') handleScrollUp(data.amount || 0.45);
        else if (data.direction === 'top' && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    };

    const channel = new BroadcastChannel('kings_sword_projection');
    channel.onmessage = (e) => handlePayload(e.data);

    const handleWindowMessage = (e: MessageEvent) => handlePayload(e.data);
    window.addEventListener('message', handleWindowMessage);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'kings_sword_last_projection_sync' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setSyncData(parsed);
        } catch (err) {}
      }
    };
    window.addEventListener('storage', handleStorage);

    channel.postMessage({ type: 'ready' });
    if (window.opener) {
      try { window.opener.postMessage({ type: 'ready' }, '*'); } catch (e) {}
    }

    const timer = setInterval(() => {
      channel.postMessage({ type: 'ready' });
      if (window.opener) {
        try { window.opener.postMessage({ type: 'ready' }, '*'); } catch (e) {}
      }
    }, 1500);

    return () => {
      channel.close();
      window.removeEventListener('message', handleWindowMessage);
      window.removeEventListener('storage', handleStorage);
      clearInterval(timer);
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
      setTimeout(updateScrollState, 100);
      setTimeout(updateScrollState, 300);
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

  // Keyboard navigation for vertical scroll (ArrowDown, ArrowUp, PageDown, PageUp, Space, Home, End)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        handleScrollDown(e.key === ' ' ? 0.6 : 0.4);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        handleScrollUp(e.key === ' ' ? 0.6 : 0.4);
      } else if (e.key === 'Home') {
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
  }, [handleScrollDown, handleScrollUp, updateScrollState]);

  if (syncData.blackout) return <div className="fixed inset-0 bg-black z-[99999] cursor-none transition-opacity duration-300" />;

  const hasTitle = Boolean(syncData.title && syncData.title.trim().length > 0);
  const hasText = Boolean(syncData.text && syncData.text.trim().length > 0);

  if (!hasText && !hasTitle) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center p-20 text-center animate-pulse">
         <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="Logo" className="w-32 h-32 opacity-20 mb-8 object-contain" />
         <p className="text-[14px] font-black uppercase tracking-[0.6em] text-zinc-400">King's Sword Projection</p>
         <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-teal-500/80 mt-2">En attente de prêche...</p>
      </div>
    );
  }

  if (!hasText && hasTitle) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-between p-12 text-center select-none font-sans">
        <div className="w-full flex items-center justify-between opacity-60">
           <div className="flex items-center gap-3">
             <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="Logo" className="w-8 h-8 object-contain" />
             <span className="text-[12px] font-black uppercase tracking-[0.4em] text-teal-400">King's Sword</span>
           </div>
           <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full">Prêt pour la projection</span>
        </div>

        <div className="max-w-5xl my-auto flex flex-col items-center gap-6">
           <div className="w-20 h-20 rounded-full bg-teal-600/10 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-2 shadow-2xl">
             <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="Logo" className="w-10 h-10 object-contain" />
           </div>
           <h1 className="text-[5.5vmin] font-black text-white tracking-tight leading-tight uppercase drop-shadow-2xl">
             {syncData.title}
           </h1>
           <div className="flex items-center gap-6 text-[1.8vmin] font-bold text-teal-400 uppercase tracking-widest flex-wrap justify-center mt-2">
             {syncData.date && <div className="flex items-center gap-2"><Calendar className="w-5 h-5 opacity-70" /><span>{syncData.date}</span></div>}
             {syncData.time && <div className="flex items-center gap-2"><Clock className="w-5 h-5 opacity-70" /><span>{syncData.time}</span></div>}
             {syncData.city && <div className="flex items-center gap-2"><MapPin className="w-5 h-5 opacity-70" /><span>{syncData.city}</span></div>}
           </div>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-500">
          Sélectionnez un paragraphe dans le lecteur pour le projeter
        </div>
      </div>
    );
  }

  const chars = syncData.text.length || 1;
  // Font-size floor of 5.6vmin guaranteed for crystal-clear readability
  const calculatedSize = Math.max(5.6, Math.min(13.5, (102 / Math.sqrt(Math.min(chars, 420))) * 1.5));
  const calculatedLineHeight = Math.max(1.25, Math.min(1.48, 1.62 - (calculatedSize / 20)));

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center select-none cursor-default overflow-hidden h-screen w-screen font-sans">
       {/* Main Text Presentation Area with Vertical Scroll */}
       <div className="h-[88%] w-full relative overflow-hidden flex flex-col">
          {/* Top Gradient Overflow Mask */}
          <div className={`absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black via-black/70 to-transparent z-20 pointer-events-none transition-opacity duration-300 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`} />

          {/* Scrollable Text Body */}
          <div 
            ref={scrollContainerRef}
            onScroll={updateScrollState}
            className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth px-8 md:px-14 lg:px-20 py-8 flex flex-col justify-start items-center"
          >
            <div 
              className="text-white font-bold transition-all duration-300 text-left my-auto w-full max-w-7xl"
              style={{ 
                fontSize: `${calculatedSize}vmin`,
                lineHeight: calculatedLineHeight,
                textShadow: '0 4px 30px rgba(0,0,0,0.6)',
                wordBreak: 'break-word',
              }}
            >
              {syncData.projectedWords && syncData.projectedWords.length > 0 ? (
                  syncData.projectedWords.map((word, idx) => {
                      const isSelected = syncData.selectionIndices.includes(word.globalIndex);
                      const styleClass = isSelected 
                        ? PROJECTION_HIGHLIGHT_STYLING.selection 
                        : (word.color ? PROJECTION_HIGHLIGHT_STYLING[word.color] || PROJECTION_HIGHLIGHT_STYLING.default : '');
                      
                      return (
                          <span 
                              key={idx} 
                              ref={(el) => {
                                if (el) activeWordRefs.current.set(word.globalIndex, el);
                                else activeWordRefs.current.delete(word.globalIndex);
                              }}
                              className={`transition-colors duration-300 py-1 ${styleClass}`}
                          >
                              {word.text}
                          </span>
                      );
                  })
              ) : syncData.text}
            </div>
          </div>

          {/* Bottom Gradient Overflow Mask */}
          <div className={`absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black via-black/80 to-transparent z-20 pointer-events-none transition-opacity duration-300 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`} />

          {/* Floating Discreet Scroll Controls & Indicator */}
          {isScrollable && (
            <div className="absolute right-6 bottom-4 z-30 flex items-center gap-2 bg-zinc-900/80 backdrop-blur-md border border-white/15 px-3.5 py-1.5 rounded-full shadow-2xl transition-all">
              <button 
                onClick={() => handleScrollUp(0.4)}
                className={`p-1 text-zinc-300 hover:text-teal-400 active:scale-90 transition-all ${!canScrollUp ? 'opacity-30 cursor-not-allowed' : ''}`}
                title="Défiler vers le haut (Flèche Haut / Molette)"
              >
                <ChevronUp className="w-5 h-5" />
              </button>
              <span className="text-[1.2vmin] font-mono font-bold text-teal-400 tracking-wider">
                {scrollProgress}%
              </span>
              <button 
                onClick={() => handleScrollDown(0.4)}
                className={`p-1 text-zinc-300 hover:text-teal-400 active:scale-90 transition-all ${!canScrollDown ? 'opacity-30 cursor-not-allowed' : ''}`}
                title="Défiler vers le bas (Flèche Bas / Molette / Espace)"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          )}
       </div>

       {/* Footer Bar with Metadata */}
       <div className="h-[12%] w-full bg-gradient-to-b from-zinc-950 to-black border-t border-white/10 backdrop-blur-2xl flex items-center justify-between px-8 md:px-12 shrink-0 z-30">
          <div className="flex items-center gap-5 min-w-0">
             <div className="w-[5.5vmin] h-[5.5vmin] rounded-full bg-teal-600/20 border border-teal-600/30 flex items-center justify-center shadow-lg overflow-hidden shrink-0">
                <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="Logo" className="w-[3.2vmin] h-[3.2vmin] object-contain" />
             </div>
             <h1 className="text-[2.4vmin] font-black text-teal-500 tracking-tighter drop-shadow-md uppercase truncate">
                {syncData.title}
             </h1>
          </div>
          <div className="flex items-center gap-6 text-[1.4vmin] font-bold text-zinc-400 uppercase tracking-[0.25em] shrink-0">
             <div className="flex items-center gap-2">
                <Calendar className="w-[1.8vmin] h-[1.8vmin] text-teal-500/60" />
                <span className="font-mono">{syncData.date}</span>
             </div>
             {syncData.time && (
               <div className="flex items-center gap-2">
                  <Clock className="w-[1.8vmin] h-[1.8vmin] text-teal-500/60" />
                  <span>{syncData.time}</span>
               </div>
             )}
             <div className="flex items-center gap-2">
                <MapPin className="w-[1.8vmin] h-[1.8vmin] text-teal-500/60" />
                <span>{syncData.city}</span>
             </div>
          </div>
       </div>

       {/* Definition Pop-up Modal on Grand Screen */}
       {syncData.activeDefinition && (
          <div className="fixed inset-0 z-[100000] bg-black/95 flex items-center justify-center p-12 md:p-20 animate-in fade-in duration-500">
            <div className="max-w-5xl w-full space-y-10 text-center">
                <div className="flex items-center justify-center gap-8">
                  <div className="w-20 h-20 flex items-center justify-center bg-teal-600/10 text-teal-500 rounded-[28px] border border-teal-600/20"><BookOpenCheck className="w-10 h-10" /></div>
                  <h3 className="text-6xl font-black text-white leading-none uppercase tracking-tight">{syncData.activeDefinition.word}</h3>
                </div>
                <div className="p-12 md:p-16 bg-teal-600/10 border border-teal-600/20 rounded-[48px]">
                  <p className="text-4xl md:text-5xl leading-tight text-zinc-100 font-medium italic">{syncData.activeDefinition.definition}</p>
                </div>
            </div>
          </div>
       )}
    </div>
  );
});

const MaskView = memo(() => {
    return <div className="fixed inset-0 bg-black z-[999999] cursor-none" />;
});

const App: React.FC = () => {
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const libraryMode = useAppStore(s => s.libraryMode);
  const aiOpen = useAppStore(s => s.aiOpen);
  const toggleAI = useAppStore(s => s.toggleAI);
  const notesOpen = useAppStore(s => s.notesOpen);
  const toggleNotes = useAppStore(s => s.toggleNotes);
  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const aiWidth = useAppStore(s => s.aiWidth);
  const notesWidth = useAppStore(s => s.notesWidth);
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth);
  const setAiWidth = useAppStore(s => s.setAiWidth);
  const setNotesWidth = useAppStore(s => s.setNotesWidth);
  const setSidebarOpen = useAppStore(s => s.setSidebarOpen);
  const setAiOpen = useAppStore(s => s.setAiOpen);
  const setNotesOpen = useAppStore(s => s.setNotesOpen);
  const isBibleModalOpen = useAppStore(s => s.isBibleModalOpen);
  const setBibleModalOpen = useAppStore(s => s.setBibleModalOpen);
  const toggleBibleModal = useAppStore(s => s.toggleBibleModal);
  const initializeDB = useAppStore(s => s.initializeDB);
  const isLoading = useAppStore(s => s.isLoading);
  const loadingMessage = useAppStore(s => s.loadingMessage);
  const loadingProgress = useAppStore(s => s.loadingProgress);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const theme = useAppStore(s => s.theme);
  const addNotification = useAppStore(s => s.addNotification);

  const [isResizing, setIsResizing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [globalTooltip, setGlobalTooltip] = useState<{ x: number, y: number, text: string, icon?: string } | null>(null);
  const activeHandle = useRef<string | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const isProjectionWindow = searchParams.get('projection') === 'true';
  const isMaskWindow = searchParams.get('mask') === 'true';

  useEffect(() => { initializeDB(); }, [initializeDB]);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable(() => {
        addNotification("Nouvelle mise à jour disponible. Téléchargement en cours...", "success");
      });
      window.electronAPI.onUpdateDownloaded(() => {
        addNotification("Mise à jour prête ! Cliquez ici pour redémarrer l'application.", "success");
      });
    }
  }, [addNotification]);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement;
      if (target) setGlobalTooltip({ x: e.clientX, y: e.clientY, text: target.getAttribute('data-tooltip') || '', icon: target.getAttribute('data-tooltip-icon') || 'info' });
      else setGlobalTooltip(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  const stopResizing = useCallback(() => { activeHandle.current = null; setIsResizing(false); document.body.style.cursor = 'default'; document.body.style.userSelect = 'auto'; }, []);
  const handleResizingMove = useCallback((e: MouseEvent) => {
    if (!activeHandle.current) return;
    if (activeHandle.current === 'sidebar') {
      const newWidth = Math.max(300, Math.min(800, e.clientX));
      if (newWidth < 60) { if (sidebarOpen) setSidebarOpen(false); }
      else { if (!sidebarOpen && newWidth > 80) setSidebarOpen(true); setSidebarWidth(newWidth); }
    } else if (activeHandle.current === 'notes') {
      const rightPadding = aiOpen ? aiWidth : 0;
      const w = Math.max(40, Math.min(800, window.innerWidth - e.clientX - rightPadding));
      if (w < 60) { if (notesOpen) setNotesOpen(false); }
      else { if (!notesOpen && w > 40) setNotesOpen(true); setNotesWidth(w); }
    } else if (activeHandle.current === 'ai') {
      const w = Math.max(40, Math.min(800, window.innerWidth - e.clientX));
      if (w < 60) { if (aiOpen) setAiOpen(false); }
      else { if (!aiOpen && w > 40) setAiWidth(w); }
    }
  }, [sidebarOpen, aiOpen, notesOpen, aiWidth, setSidebarWidth, setAiWidth, setNotesWidth, setSidebarOpen, setAiOpen, setNotesOpen]);

  useEffect(() => {
    if (isResizing) { window.addEventListener('mousemove', handleResizingMove); window.addEventListener('mouseup', stopResizing); }
    else { window.removeEventListener('mousemove', handleResizingMove); window.removeEventListener('mouseup', stopResizing); }
    return () => { window.removeEventListener('mousemove', handleResizingMove); window.removeEventListener('mouseup', stopResizing); };
  }, [isResizing, handleResizingMove, stopResizing]);

  const startResizing = (handle: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation(); activeHandle.current = handle; setIsResizing(true); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };

  if (isMaskWindow) return <MaskView />;
  if (isProjectionWindow) return <ProjectionView />;

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-teal-600/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="flex flex-col items-center gap-12 w-80 relative z-10">
           <div className="relative w-28 h-28 flex items-center justify-center">
             <div className="absolute inset-0 border-2 border-dashed border-teal-600/20 rounded-full animate-[spin_10s_linear_infinite]"></div>
             <div className="absolute inset-2 border border-teal-600/40 rounded-full animate-[spin_6s_linear_infinite_reverse]"></div>
             <div className="absolute inset-4 bg-zinc-900 rounded-full shadow-2xl border border-zinc-800 flex items-center justify-center overflow-hidden">
               <img src="https://branham.fr/source/favicon/favicon-32x32.png" onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }} alt="King's Sword" className="w-10 h-10 animate-pulse object-contain" />
             </div>
           </div>
           <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
             <div className="relative">
                <div className="flex justify-between items-end mb-2 px-1">
                   <span className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-100">{loadingMessage || "Chargement..."}</span>
                   <span className="text-[12px] font-black text-teal-500 font-mono tracking-tighter">{loadingProgress}%</span>
                </div>
                <div className="w-full h-2.5 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden shadow-inner">
                  <div className="h-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-700 ease-out" style={{ width: `${loadingProgress}%` }} />
                </div>
             </div>
           </div>
        </div>
      </div>
    );
  }

  const transitionClass = isResizing ? "transition-none" : "transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1)";
  const effectiveSidebarWidth = isFullscreen ? 0 : (sidebarOpen ? sidebarWidth : 0);
  const effectiveNotesWidth = isFullscreen ? 0 : (notesOpen ? notesWidth : 0);
  const effectiveAiWidth = isFullscreen ? 0 : (aiOpen ? aiWidth : 0);

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-zinc-950 overflow-hidden app-container flex-col">
      <div className="flex flex-1 h-full overflow-hidden relative">
        <div style={{ width: effectiveSidebarWidth }} className={`flex-shrink-0 overflow-hidden h-full flex relative z-30 ${transitionClass} no-print`}>
          <div className="w-full h-full"><Sidebar /></div>
          {sidebarOpen && !isFullscreen && <div onMouseDown={startResizing('sidebar')} className="absolute right-0 top-0 w-1.5 h-full hover:bg-teal-600/40 cursor-col-resize z-50 transition-colors" />}
        </div>
        <div className={`flex-1 flex flex-col min-w-[300px] relative z-10 border-x border-zinc-100 dark:border-zinc-900 shadow-sm ${transitionClass}`}>
          <MainContent activeNoteId={activeNoteId} />
          <div className="absolute top-16 right-4 z-[100] flex flex-col gap-3 no-print">
            {!isFullscreen && (
              <button 
                data-tooltip={sidebarOpen && libraryMode === 'bible' ? "Fermer la bibliothèque (Bible)" : "Ouvrir la Bible (Bibliothèque)"} 
                onClick={() => {
                  const s = useAppStore.getState();
                  if (s.sidebarOpen && s.libraryMode === 'bible') {
                    s.toggleSidebar();
                  } else {
                    s.setLibraryMode('bible');
                    if (!s.sidebarOpen) s.setSidebarOpen(true);
                  }
                }} 
                className={`w-9 h-9 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border border-zinc-200/50 dark:border-zinc-800/50 hover:text-teal-600 shadow-sm transition-all ${sidebarOpen && libraryMode === 'bible' ? 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 border-teal-500/30' : 'text-zinc-400'}`}
              >
                <BookOpen className="w-4.5 h-4.5" />
              </button>
            )}
            {!notesOpen && !isFullscreen && (<button data-tooltip="Journal" onClick={toggleNotes} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl text-zinc-400 border border-zinc-200/50 dark:border-zinc-800/50 hover:text-teal-600 shadow-sm"><NotebookPen className="w-4.5 h-4.5" /></button>)}
            {!aiOpen && !isFullscreen && (<button data-tooltip="Assistant IA" onClick={toggleAI} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl text-zinc-400 border border-zinc-200/50 dark:border-zinc-800/50 hover:text-teal-600 shadow-sm"><Sparkles className="w-4.5 h-4.5" /></button>)}
          </div>
        </div>
        <div style={{ width: effectiveNotesWidth }} className={`flex-shrink-0 overflow-hidden h-full flex relative z-30 ${transitionClass} no-print`}>
          {notesOpen && !isFullscreen && <div onMouseDown={startResizing('notes')} className="absolute left-0 top-0 w-1.5 h-full hover:bg-teal-600/40 cursor-col-resize z-50 transition-colors" />}
          <div className="w-full h-full"><NotesPanel /></div>
        </div>
        <div style={{ width: effectiveAiWidth }} className={`flex-shrink-0 overflow-hidden h-full flex relative z-30 ${transitionClass} no-print`}>
          {aiOpen && !isFullscreen && <div onMouseDown={startResizing('ai')} className="absolute left-0 top-0 w-1.5 h-full hover:bg-teal-600/40 cursor-col-resize z-50 transition-colors" />}
          <div className="w-full h-full"><AIAssistant /></div>
        </div>
      </div>
      <Notifications />
      <GlobalTooltip data={globalTooltip} />
    </div>
  );
};

export default App;
