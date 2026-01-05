
import React, { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar';
import Reader from './components/Reader';
import SearchResults from './components/SearchResults';
import AIAssistant from './components/AIAssistant';
import NotesPanel from './components/NotesPanel';
import Notifications from './components/Notifications';
import NoteEditor from './components/NoteEditor';
import { Sparkles, NotebookPen, Info, Trash2, HelpCircle, Calendar, MapPin, Quote, BookOpenCheck, Feather, Milestone } from 'lucide-react';
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
    projectedText?: string;
  }>({
    title: '', date: '', city: '', text: '', fontSize: 24, blackout: false, theme: 'system',
    highlights: [], selectionIndices: [], searchResults: [], currentResultIndex: -1, activeDefinition: null
  });

  useEffect(() => {
    const channel = new BroadcastChannel('kings_sword_projection');
    channel.onmessage = (e) => {
      if (e.data.type === 'sync') {
        setSyncData(prev => ({ 
            ...prev,
            ...e.data,
            blackout: e.data.blackout ?? prev.blackout
        }));
      } else if (e.data.type === 'project_text') {
        setSyncData(prev => ({ ...prev, projectedText: e.data.projectedText }));
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

  // Calcul dynamique de la taille de police pour la projection (Mode Slide)
  const dynamicFontSize = useMemo(() => {
    const text = syncData.projectedText || syncData.title;
    if (!text) return '5vmin';
    const charCount = text.length;
    // Formule : (95 / sqrt(nb_caractères)) * 1.45
    let size = (95 / Math.sqrt(charCount)) * 1.45;
    // Limites de sécurité : min 2.8vmin, max 13.5vmin
    size = Math.max(2.8, Math.min(13.5, size));
    return `${size}vmin`;
  }, [syncData.projectedText, syncData.title]);

  if (syncData.blackout) return <div className="fixed inset-0 bg-black z-[99999] cursor-none" />;

  return (
    <div className="fixed inset-0 bg-black flex flex-col overflow-hidden select-none cursor-none transition-colors duration-500">
       {/* Zone de Texte Sacré (90%) */}
       <div className="h-[90%] flex items-center justify-center p-12 lg:p-20">
          {syncData.projectedText ? (
             <div 
               className="w-full text-center text-white font-bold serif-text leading-[1.4] whitespace-pre-wrap animate-in fade-in zoom-in-95 duration-500"
               style={{ fontSize: dynamicFontSize, textAlignLast: 'center', textJustify: 'inter-word' }}
             >
               {syncData.projectedText}
             </div>
          ) : (
            <div className="flex flex-col items-center gap-10 opacity-20 scale-110">
               <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-48 h-48 grayscale invert" />
               <p className="text-4xl font-black uppercase tracking-[1em] text-white">KING'S SWORD</p>
            </div>
          )}
       </div>

       {/* Zone d'Information (10%) - Bandeau inférieur Premium */}
       <div className="h-[10%] bg-zinc-950/80 backdrop-blur-2xl border-t border-white/10 flex items-center justify-between px-12 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-teal-900/10 via-transparent to-teal-900/10 pointer-events-none" />
          
          <div className="flex items-center gap-6 relative z-10">
             <div className="w-12 h-12 flex items-center justify-center bg-teal-600/20 text-teal-500 rounded-xl border border-teal-500/20 shadow-[0_0_20px_rgba(20,184,166,0.2)]">
                <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-6 h-6" />
             </div>
             <div className="flex flex-col">
                <h2 className="text-teal-500 text-2xl font-black uppercase tracking-tight drop-shadow-md">
                   {syncData.title || "King's Sword"}
                </h2>
                <div className="flex items-center gap-3 text-zinc-400 text-xs font-bold uppercase tracking-widest mt-1 opacity-70">
                   <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> <span className="font-mono">{syncData.date}</span></div>
                   <div className="w-1 h-1 bg-zinc-600 rounded-full" />
                   <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> <span>{syncData.city}</span></div>
                </div>
             </div>
          </div>

          <div className="flex flex-col items-end gap-1 opacity-40 relative z-10">
             <p className="text-[10px] font-black text-white uppercase tracking-[0.4em]">VISION DE L'AIGLE TABERNACLE</p>
             <p className="text-[8px] font-bold text-teal-600 uppercase tracking-widest">KOUFOLI - PNR - CONGO</p>
          </div>
       </div>

       {/* Overlay Dictionnaire (si actif) */}
       {syncData.activeDefinition && (
          <div className="fixed inset-0 z-[100000] bg-black/40 backdrop-blur-md flex items-center justify-center p-20 animate-in fade-in duration-500">
            <div className="bg-zinc-900 border border-white/10 rounded-[60px] shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-500 max-w-5xl w-full">
                <div className="px-16 pt-10 pb-6 flex items-center gap-10 border-b border-white/5 bg-zinc-950/50">
                  <div className="w-24 h-24 flex items-center justify-center bg-teal-600/10 text-teal-500 rounded-[32px] border border-teal-500/20 shadow-xl"><BookOpenCheck className="w-12 h-12" /></div>
                  <div><h3 className="text-xl font-black text-zinc-500 uppercase tracking-[0.4em]">Dictionnaire</h3><p className="text-7xl font-black text-white leading-none mt-2">{syncData.activeDefinition.word}</p></div>
                </div>
                <div className="px-16 py-14 space-y-12">
                    <div className="p-12 bg-white/5 border border-white/10 rounded-[40px] shadow-inner">
                      <p className="text-5xl leading-tight text-white font-medium serif-text italic text-center">{syncData.activeDefinition.definition}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-16 px-4">
                        {syncData.activeDefinition.etymology && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-4 text-teal-500"><Feather className="w-8 h-8" /><h4 className="text-2xl font-black uppercase tracking-[0.3em]">Étymologie</h4></div>
                            <p className="text-3xl leading-relaxed text-zinc-400 serif-text italic">{syncData.activeDefinition.etymology}</p>
                          </div>
                        )}
                        {syncData.activeDefinition.synonyms && syncData.activeDefinition.synonyms.length > 0 && (
                          <div className="space-y-6">
                            <div className="flex items-center gap-4 text-amber-500"><Milestone className="w-8 h-8" /><h4 className="text-2xl font-black uppercase tracking-[0.3em]">Synonymes</h4></div>
                            <div className="flex flex-wrap gap-5">{syncData.activeDefinition.synonyms.map((s, i) => (<span key={i} className="px-8 py-3 bg-amber-500/10 text-amber-400 rounded-2xl text-2xl font-bold border border-amber-500/20">{s}</span>))}</div>
                          </div>
                        )}
                    </div>
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
