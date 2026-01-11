import React, { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar';
import Reader from './components/Reader';
import SearchResults from './components/SearchResults';
import AIAssistant from './components/AIAssistant';
import NotesPanel from './components/NotesPanel';
import Notifications from './components/Notifications';
import NoteEditor from './components/NoteEditor';
import { Sparkles, NotebookPen, Info, Trash2, HelpCircle, Calendar, MapPin, Quote, BookOpenCheck, Feather, Milestone, Loader2, Clock } from 'lucide-react';
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

const PROJECTION_HIGHLIGHT_STYLING: Record<string, string> = {
    sky: 'bg-sky-500/40 border-b-[3px] border-sky-400/60',
    teal: 'bg-teal-500/40 border-b-[3px] border-teal-400/60',
    amber: 'bg-amber-500/50 border-b-[3px] border-amber-400/60 shadow-[0_4px_12px_rgba(245,158,11,0.2)]',
    rose: 'bg-rose-500/40 border-b-[3px] border-rose-400/60',
    violet: 'bg-violet-500/40 border-b-[3px] border-violet-400/60',
    lime: 'bg-lime-500/40 border-b-[3px] border-lime-400/60',
    orange: 'bg-orange-500/40 border-b-[3px] border-orange-400/60',
    selection: 'bg-white text-black font-bold',
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
  }>({
    title: '', date: '', city: '', time: '', text: '', fontSize: 24, blackout: false, theme: 'system',
    highlights: [], selectionIndices: [], searchResults: [], currentResultIndex: -1, activeDefinition: null
  });
  
  useEffect(() => {
    const channel = new BroadcastChannel('kings_sword_projection');
    channel.onmessage = (e) => {
      if (e.data.type === 'sync') {
        setSyncData({ 
            title: e.data.title || '', date: e.data.date || '', city: e.data.city || '', time: e.data.time || '', text: e.data.text || '', 
            projectedWords: e.data.projectedWords,
            fontSize: e.data.fontSize || 24, blackout: e.data.blackout ?? false, theme: e.data.theme || 'system',
            highlights: e.data.highlights || [], selectionIndices: e.data.selectionIndices || [],
            searchResults: e.data.searchResults || [], currentResultIndex: e.data.currentResultIndex ?? -1, activeDefinition: e.data.activeDefinition || null
        });
      }
    };
    channel.postMessage({ type: 'ready' });
    return () => channel.close();
  }, []);

  useEffect(() => {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (syncData.theme === 'dark' || (syncData.theme === 'system' && isSystemDark)) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [syncData.theme]);

  if (syncData.blackout) return <div className="fixed inset-0 bg-black z-[99999] cursor-none transition-opacity duration-300" />;

  if (!syncData.text) {
    return (
      <div className="fixed inset-0 bg-white dark:bg-zinc-950 flex flex-col items-center justify-center p-20 text-center animate-pulse">
         <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-32 h-32 opacity-10 mb-8 grayscale" />
         <p className="text-[14px] font-black uppercase tracking-[0.6em] text-zinc-400 pulse">King's Sword Projection</p>
         <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500 mt-2 opacity-50">En attente...</p>
      </div>
    );
  }

  const chars = syncData.text.length || 1;
  const calculatedSize = Math.max(3.2, Math.min(14.5, (98 / Math.sqrt(chars)) * 1.55));
  const calculatedLineHeight = Math.max(1.1, Math.min(1.4, 1.6 - (calculatedSize / 18)));

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center select-none cursor-none overflow-hidden h-screen w-screen font-sans">
       <div className="h-[90%] w-full flex items-center justify-start px-4 md:px-6">
          <div 
            className="text-white font-bold transition-all duration-300 text-left"
            style={{ 
              fontSize: `${calculatedSize}vmin`,
              lineHeight: calculatedLineHeight,
              textShadow: '0 4px 30px rgba(0,0,0,0.5)',
              wordBreak: 'break-word',
              width: '100%'
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
                            className={`transition-colors duration-300 py-1 ${styleClass}`}
                        >
                            {word.text}
                        </span>
                    );
                })
            ) : syncData.text}
          </div>
       </div>

       <div className="h-[10%] w-full bg-gradient-to-b from-zinc-950 to-black border-t border-white/10 backdrop-blur-2xl flex items-center justify-between px-12 shrink-0">
          <div className="flex items-center gap-6">
             <div className="w-[6vmin] h-[6vmin] rounded-full bg-teal-600/20 border border-teal-600/30 flex items-center justify-center shadow-lg overflow-hidden shrink-0">
                <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-[3.5vmin] h-[3.5vmin] grayscale brightness-200" />
             </div>
             <h1 className="text-[2.5vmin] font-black text-teal-500 tracking-tighter drop-shadow-md uppercase">
                {syncData.title}
             </h1>
          </div>
          <div className="flex items-center gap-8 text-[1.5vmin] font-bold text-zinc-500 uppercase tracking-[0.3em]">
             <div className="flex items-center gap-3">
                <Calendar className="w-[2vmin] h-[2vmin] text-teal-600/40" />
                <span className="font-mono">{syncData.date}</span>
             </div>
             {syncData.time && (
               <div className="flex items-center gap-3">
                  <Clock className="w-[2vmin] h-[2vmin] text-teal-600/40" />
                  <span>{syncData.time}</span>
               </div>
             )}
             <div className="flex items-center gap-3">
                <MapPin className="w-[2vmin] h-[2vmin] text-teal-600/40" />
                <span>{syncData.city}</span>
             </div>
          </div>
       </div>

       {syncData.activeDefinition && (
          <div className="fixed inset-0 z-[100000] bg-black/95 flex items-center justify-center p-20 animate-in fade-in duration-500">
            <div className="max-w-5xl w-full space-y-12 text-center">
                <div className="flex items-center justify-center gap-10">
                  <div className="w-24 h-24 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-[32px] border border-teal-600/20"><BookOpenCheck className="w-12 h-12" /></div>
                  <h3 className="text-7xl font-black text-white leading-none uppercase tracking-tight">{syncData.activeDefinition.word}</h3>
                </div>
                <div className="p-16 bg-teal-600/10 border border-teal-600/20 rounded-[60px]">
                  <p className="text-5xl leading-tight text-zinc-100 font-medium italic">{syncData.activeDefinition.definition}</p>
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
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
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
  const isFullTextSearch = useAppStore(s => s.isFullTextSearch);
  const searchQuery = useAppStore(s => s.searchQuery);
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
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-teal-900/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="flex flex-col items-center gap-12 w-80 relative z-10">
           <div className="relative w-28 h-28 flex items-center justify-center">
             <div className="absolute inset-0 border-2 border-dashed border-teal-600/20 rounded-full animate-[spin_10s_linear_infinite]"></div>
             <div className="absolute inset-2 border border-teal-600/40 rounded-full animate-[spin_6s_linear_infinite_reverse]"></div>
             <div className="absolute inset-4 bg-zinc-900 rounded-full shadow-2xl border border-zinc-800 flex items-center justify-center overflow-hidden">
               <img 
                 src="https://branham.fr/source/favicon/favicon-32x32.png" 
                 alt="King's Sword" 
                 className="w-10 h-10 opacity-80 grayscale brightness-150 animate-pulse" 
               />
             </div>
             <div className="absolute -top-1 -right-1 bg-teal-600 w-3 h-3 rounded-full blur-[4px] animate-ping" />
           </div>

           <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
             <div className="relative">
                <div className="w-full h-2.5 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className="h-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(20,184,166,0.4)] relative" 
                    style={{ width: `${loadingProgress}%` }} 
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-20 animate-[shimmer_2s_infinite] skew-x-[-20deg]" />
                  </div>
                </div>
                
                <div 
                  className="absolute -top-8 transition-all duration-700 ease-out flex flex-col items-center" 
                  style={{ left: `${Math.max(5, Math.min(95, loadingProgress))}%`, transform: 'translateX(-50%)' }}
                >
                  <div className="px-2 py-0.5 bg-teal-600 text-[10px] font-mono font-black text-white rounded-md shadow-lg shadow-teal-600/20 animate-bounce">
                    {loadingProgress}%
                  </div>
                </div>
             </div>

             <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-100 drop-shadow-sm min-h-[1em]">
                    {loadingMessage || "Chargement..."}
                  </span>
                  <div className="h-0.5 w-8 bg-teal-600/20 rounded-full" />
                </div>
                
                <div className="flex items-center gap-3 opacity-40">
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-teal-500 rounded-full animate-pulse" />
                    <div className="w-1 h-1 bg-teal-500 rounded-full animate-pulse delay-75" />
                    <div className="w-1 h-1 bg-teal-500 rounded-full animate-pulse delay-150" />
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-[0.4em] text-teal-500">
                    WILLIAM MARRION BRANHAM
                  </span>
                </div>
             </div>
           </div>
        </div>

        <div className="absolute bottom-10 text-[8px] font-black uppercase tracking-[0.5em] text-zinc-600 opacity-20 pointer-events-none">
          VISION DE L'AIGLE TABERNACLE • v1.0.3
        </div>

        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%) skewX(-20deg); }
            100% { transform: translateX(400%) skewX(-20deg); }
          }
        `}</style>
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
          <div className="absolute top-16 right-4 z-[100] flex flex-col gap-3 no-print">
            {!notesOpen && !isFullscreen && (<button data-tooltip="Journal" onClick={toggleNotes} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl text-zinc-400 border border-zinc-200/50 dark:border-zinc-800/50 hover:text-teal-600"><NotebookPen className="w-4.5 h-4.5" /></button>)}
            {!aiOpen && !isFullscreen && (<button data-tooltip="Assistant IA" onClick={toggleAI} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl text-zinc-400 border border-zinc-200/50 dark:border-zinc-800/50 hover:text-teal-600"><Sparkles className="w-4.5 h-4.5" /></button>)}
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