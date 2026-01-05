import React, { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar';
import Reader from './components/Reader';
import SearchResults from './components/SearchResults';
import AIAssistant from './components/AIAssistant';
import NotesPanel from './components/NotesPanel';
import Notifications from './components/Notifications';
import NoteEditor from './components/NoteEditor';
import { Sparkles, NotebookPen, Info, Trash2, HelpCircle, Calendar, MapPin, Quote, BookOpenCheck, Feather, Milestone, Presentation } from 'lucide-react';
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

const MainContent = memo(({ showSearchResults, activeNoteId }: { showSearchResults: boolean; activeNoteId: string | null }) => {
  if (showSearchResults) return <SearchResults />;
  if (activeNoteId) return <NoteEditor />;
  return <Reader />;
});

const ProjectionView = memo(() => {
  const [syncData, setSyncData] = useState<{ 
    title: string; 
    date: string; 
    city: string; 
    text: string; 
    fontSize: number; 
    blackout: boolean; 
    theme: string;
    highlights: Highlight[];
    selectionIndices: number[];
    searchResults: number[];
    currentResultIndex: number;
    activeDefinition: WordDefinition | null;
    projectedMode?: boolean;
  }>({
    title: '', date: '', city: '', text: '', fontSize: 24, blackout: false, theme: 'system',
    highlights: [], selectionIndices: [], searchResults: [], currentResultIndex: -1, activeDefinition: null
  });
  const [scrollPercent, setScrollPercent] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const channel = new BroadcastChannel('kings_sword_projection');
    channel.onmessage = (e) => {
      if (e.data.type === 'sync') {
        setSyncData({ 
            title: e.data.title || '', date: e.data.date || '', city: e.data.city || '', text: e.data.text || '', 
            fontSize: e.data.fontSize || 24, blackout: e.data.blackout ?? false, theme: e.data.theme || 'system',
            highlights: e.data.highlights || [], selectionIndices: e.data.selectionIndices || [],
            searchResults: e.data.searchResults || [], currentResultIndex: e.data.currentResultIndex ?? -1, 
            activeDefinition: e.data.activeDefinition || null,
            projectedMode: e.data.projectedMode || false
        });
      } else if (e.data.type === 'scroll') setScrollPercent(e.data.scrollPercent);
    };
    channel.postMessage({ type: 'ready' });
    return () => channel.close();
  }, []);

  useEffect(() => {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (syncData.theme === 'dark' || (syncData.theme === 'system' && isSystemDark)) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [syncData.theme]);

  useEffect(() => {
    if (scrollRef.current && !syncData.projectedMode) {
      const target = scrollRef.current;
      target.scrollTop = scrollPercent * (target.scrollHeight - target.clientHeight);
    }
  }, [scrollPercent, syncData.projectedMode]);

  const words = useMemo(() => {
    if (!syncData.text) return [];
    const allWords: { text: string; globalIndex: number }[] = [];
    let globalIndex = 0;
    syncData.text.split(/(\n\s*\n)/).forEach(seg => {
        seg.split(/(\s+)/).forEach(token => { if (token !== "") allWords.push({ text: token, globalIndex: globalIndex++ }); });
    });
    return allWords;
  }, [syncData.text]);

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    syncData.highlights.forEach(h => { for (let i = h.start; i <= h.end; i++) map.set(i, h); });
    return map;
  }, [syncData.highlights]);

  if (syncData.blackout) return <div className="fixed inset-0 bg-black z-[99999] cursor-none" />;

  if (!syncData.text) {
    return (
      <div className="fixed inset-0 bg-[#050505] flex flex-col items-center justify-center p-20 text-center select-none cursor-none">
         <div className="relative mb-12">
           <div className="absolute inset-0 bg-teal-600/10 blur-[100px] scale-[3]" />
           <Presentation className="w-24 h-24 text-zinc-800 animate-pulse relative z-10" />
         </div>
         <p className="text-[14px] font-black uppercase tracking-[0.8em] text-zinc-600 animate-pulse">King's Sword Projection</p>
         <div className="mt-8 flex gap-2">
            <div className="w-1.5 h-1.5 bg-teal-600/30 rounded-full" />
            <div className="w-1.5 h-1.5 bg-teal-600/30 rounded-full" />
            <div className="w-1.5 h-1.5 bg-teal-600/30 rounded-full" />
         </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={`fixed inset-0 bg-white dark:bg-black overflow-y-auto serif-text leading-relaxed py-10 px-10 sm:px-20 scroll-smooth no-scrollbar select-none cursor-none transition-colors duration-1000 ${syncData.projectedMode ? 'flex items-center justify-center' : ''}`}>
       <div className={`w-full mx-auto whitespace-pre-wrap transition-all duration-700 ease-out ${syncData.projectedMode ? 'max-w-[90vw] animate-in zoom-in-95 fade-in pb-0 text-center' : 'max-w-[96%] pb-[60vh] text-justify'}`}>
          {!syncData.projectedMode && (
            <div className="flex items-center gap-8 mb-16 border-b border-zinc-100 dark:border-zinc-900 pb-12">
              <div className="w-24 h-24 flex items-center justify-center bg-teal-600/10 rounded-[32px] border border-teal-600/20 shadow-2xl shrink-0"><img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-12 h-12" /></div>
              <div className="flex-1 min-w-0">
                <h1 className="text-6xl font-black text-zinc-900 dark:text-zinc-50 tracking-tighter mb-3 leading-tight uppercase">{syncData.title}</h1>
                <div className="flex items-center gap-10 text-2xl font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.2em]">
                  {syncData.date && <div className="flex items-center gap-3"><Calendar className="w-6 h-6 text-teal-600" /><span className="font-mono">{syncData.date}</span></div>}
                  {syncData.city && <div className="flex items-center gap-3 truncate"><MapPin className="w-6 h-6 text-teal-600" /><span className="truncate">{syncData.city}</span></div>}
                </div>
              </div>
            </div>
          )}
          
          <div 
            key={syncData.text} // Re-render unique pour déclencher l'animation au changement de texte
            className={`text-zinc-900 dark:text-zinc-100 font-bold transition-all duration-700 animate-in fade-in slide-in-from-bottom-4 ${syncData.projectedMode ? 'leading-[1.3] text-center drop-shadow-2xl' : 'leading-[1.6]'}`} 
            style={{ 
              fontSize: syncData.projectedMode 
                ? `clamp(3rem, 6.5vw, 12rem)` 
                : `${syncData.fontSize * 1.5}px` 
            }}
          >
            {words.map(word => {
              const isHighlighted = highlightMap.has(word.globalIndex);
              const isSelected = syncData.selectionIndices.includes(word.globalIndex);
              
              // On ignore l'affichage du chiffre au début si on est en mode projeté
              if (syncData.projectedMode && word.globalIndex === 0 && /^\d+/.test(word.text)) return null;

              return (
                <span 
                  key={word.globalIndex} 
                  className={`rounded-sm transition-all duration-500 ${isHighlighted ? 'bg-yellow-400/30 dark:bg-yellow-400/20' : ''} ${isSelected && !syncData.projectedMode ? 'bg-teal-500/20 ring-1 ring-teal-500/30' : ''}`}
                >
                  {word.text}
                </span>
              );
            })}
          </div>
       </div>
    </div>
  );
});

const MaskView = memo(() => {
    return <div className="fixed inset-0 bg-black z-[999999] cursor-none" />;
});

const App: React.FC = () => {
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const aiOpen = useAppStore(s => s.aiOpen);
  const notesOpen = useAppStore(s => s.notesOpen);
  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const aiWidth = useAppStore(s => s.aiWidth);
  const notesWidth = useAppStore(s => s.notesWidth);
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth);
  const setAiWidth = useAppStore(s => s.setAiWidth);
  const setNotesWidth = useAppStore(s => s.setNotesWidth);
  const setSidebarOpen = useAppStore(s => s.setSidebarOpen);
  const setAiOpen = useAppStore(s => s.setAiOpen);
  const setNotesOpen = useAppStore(s => s.setNotesOpen);
  const isFullTextSearch = useAppStore(s => s.isFullTextSearch);
  const searchQuery = useAppStore(s => s.searchQuery);
  const initializeDB = useAppStore(s => s.initializeDB);
  const isLoading = useAppStore(s => s.isLoading);
  const loadingMessage = useAppStore(s => s.loadingMessage);
  const loadingProgress = useAppStore(s => s.loadingProgress);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const theme = useAppStore(s => s.theme);

  const [isResizing, setIsResizing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [globalTooltip, setGlobalTooltip] = useState<{ x: number, y: number, text: string, icon?: string } | null>(null);
  const activeHandle = useRef<string | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const isProjectionWindow = searchParams.get('projection') === 'true';
  const isMaskWindow = searchParams.get('mask') === 'true';

  useEffect(() => { initializeDB(); }, [initializeDB]);
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
    const applyTheme = (currentTheme: 'light' | 'dark' | 'system') => {
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (currentTheme === 'dark' || (currentTheme === 'system' && isSystemDark)) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    };
    applyTheme(theme);
  }, [theme]);

  const stopResizing = useCallback(() => { activeHandle.current = null; setIsResizing(false); document.body.style.cursor = 'default'; document.body.style.userSelect = 'auto'; }, []);
  const handleResizingMove = useCallback((e: MouseEvent) => {
    if (!activeHandle.current) return;
    if (activeHandle.current === 'sidebar') {
      const newWidth = Math.max(40, Math.min(600, e.clientX));
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
      else { if (!aiOpen && w > 40) setAiOpen(true); setAiWidth(w); }
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
      <div className="flex h-screen w-full items-center justify-center bg-white dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-8 w-72">
           <div className="relative w-20 h-20">
             <div className="absolute inset-0 bg-teal-600/5 rounded-full"></div>
             <div className="absolute inset-0 border-4 border-t-teal-600 rounded-full animate-spin"></div>
             <div className="absolute inset-0 flex items-center justify-center"><img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-8 h-8 opacity-40 grayscale" /></div>
           </div>
           <div className="w-full space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
             <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800/50 rounded-full overflow-hidden shadow-inner"><div className="h-full bg-teal-600 transition-all duration-700 ease-out shadow-lg" style={{ width: `${loadingProgress}%` }} /></div>
             <div className="flex items-center justify-between px-1">
                <div className="flex flex-col"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 leading-none">{loadingMessage || "Chargement..."}</span><span className="text-[8px] font-black uppercase tracking-widest text-zinc-300 dark:text-zinc-600 mt-1.5">Bibliothèque prophétique</span></div>
                <div className="flex flex-col items-end"><span className="text-[13px] font-mono font-black text-teal-600 leading-none">{loadingProgress}%</span><span className="text-[7px] font-bold text-zinc-300 dark:text-zinc-700 mt-1 uppercase">Prêt pour l'étude</span></div>
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
    <div className="flex h-screen w-full bg-white dark:bg-zinc-950 overflow-hidden app-container flex-col">
      <div className="flex flex-1 h-full overflow-hidden relative">
        <div style={{ width: effectiveSidebarWidth }} className={`flex-shrink-0 overflow-hidden h-full flex relative z-30 ${transitionClass} no-print`}>
          <div className="w-full h-full"><Sidebar /></div>
          {sidebarOpen && !isFullscreen && <div onMouseDown={startResizing('sidebar')} className="absolute right-0 top-0 w-1.5 h-full hover:bg-teal-600/40 cursor-col-resize z-50 transition-colors" />}
        </div>
        <div className={`flex-1 flex flex-col min-w-[300px] relative z-10 border-x border-zinc-100 dark:border-zinc-900 shadow-sm ${transitionClass}`}>
          <MainContent showSearchResults={isFullTextSearch && searchQuery.length >= 2} activeNoteId={activeNoteId} />
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