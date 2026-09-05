
import React, { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar';
import Reader from './components/Reader';
import AIAssistant from './components/AIAssistant';
import NotesPanel from './components/NotesPanel';
import Notifications from './components/Notifications';
import NoteEditor from './components/NoteEditor';
import { Sparkles, NotebookPen, Info, Trash2, HelpCircle, BookOpen } from 'lucide-react';
import { ProjectionView, MaskView } from './components/ProjectionView';
import { ImageProjectionModal } from './components/ImageProjectionModal';
import { AnnouncementModal } from './components/AnnouncementModal';

const GlobalTooltip = memo(() => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ text: string; icon?: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let rafId: number | null = null;
    let currentTarget: HTMLElement | null = null;

    const calcPos = (clientX: number, clientY: number) => {
      const tooltipWidth = tooltipRef.current?.offsetWidth || 160;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 32;
      let targetX = clientX + 14;
      let targetY = clientY + 16;
      if (targetX + tooltipWidth > window.innerWidth - 12) targetX = clientX - tooltipWidth - 12;
      if (targetY + tooltipHeight > window.innerHeight - 12) targetY = clientY - tooltipHeight - 12;
      if (targetX < 8) targetX = 8;
      if (targetY < 8) targetY = 8;
      return { x: targetX, y: targetY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const target = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement;
        if (target) {
          const text = target.getAttribute('data-tooltip') || '';
          const icon = target.getAttribute('data-tooltip-icon') || undefined;
          
          if (!text.trim()) {
            if (currentTarget) {
              currentTarget = null;
              setData(null);
            }
            return;
          }

          const { x, y } = calcPos(e.clientX, e.clientY);

          if (target !== currentTarget) {
            currentTarget = target;
            setData({ text, icon, x, y });
          }

          if (tooltipRef.current) {
            tooltipRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          }
        } else if (currentTarget) {
          currentTarget = null;
          setData(null);
        }
      });
    };

    const handleReset = () => {
      currentTarget = null;
      setData(null);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('scroll', handleReset, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleReset);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  if (!data) return null;

  const renderIcon = () => {
    if (!data.icon || data.icon === 'none') return null;
    switch (data.icon) {
      case 'trash': return <Trash2 className="w-3 h-3 text-red-400 shrink-0" />;
      case 'sparkles': return <Sparkles className="w-3 h-3 text-teal-400 shrink-0" />;
      case 'info': return <Info className="w-3 h-3 text-teal-400 shrink-0" />;
      case 'notes': return <NotebookPen className="w-3 h-3 text-teal-400 shrink-0" />;
      case 'book': return <BookOpen className="w-3 h-3 text-teal-400 shrink-0" />;
      default: return null;
    }
  };

  return (
    <div 
      ref={tooltipRef} 
      style={{ transform: `translate3d(${data.x}px, ${data.y}px, 0)` }}
      className="fixed top-0 left-0 pointer-events-none z-[999999] bg-zinc-950/95 dark:bg-black/95 text-zinc-100 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-wide shadow-2xl border border-white/15 dark:border-zinc-800 flex items-center gap-2 whitespace-nowrap backdrop-blur-md animate-in fade-in duration-100 will-change-transform"
    >
      {renderIcon()}
      <span>{data.text}</span>
    </div>
  );
});

const MainContent = memo(({ activeNoteId }: { activeNoteId: string | null }) => {
  if (activeNoteId) return <NoteEditor />;
  return <Reader />;
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
  const activeHandle = useRef<string | null>(null);
  const resizeRafId = useRef<number | null>(null);

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
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  const stopResizing = useCallback(() => { 
    if (resizeRafId.current) cancelAnimationFrame(resizeRafId.current);
    activeHandle.current = null; 
    setIsResizing(false); 
    document.body.style.cursor = 'default'; 
    document.body.style.userSelect = 'auto'; 
  }, []);

  const handleResizingMove = useCallback((e: MouseEvent) => {
    if (!activeHandle.current) return;
    const clientX = e.clientX;
    
    if (resizeRafId.current) cancelAnimationFrame(resizeRafId.current);
    resizeRafId.current = requestAnimationFrame(() => {
      if (activeHandle.current === 'sidebar') {
        const newWidth = Math.max(300, Math.min(800, clientX));
        if (newWidth < 60) { if (sidebarOpen) setSidebarOpen(false); }
        else { if (!sidebarOpen && newWidth > 80) setSidebarOpen(true); setSidebarWidth(newWidth); }
      } else if (activeHandle.current === 'notes') {
        const rightPadding = aiOpen ? aiWidth : 0;
        const w = Math.max(40, Math.min(800, window.innerWidth - clientX - rightPadding));
        if (w < 60) { if (notesOpen) setNotesOpen(false); }
        else { if (!notesOpen && w > 40) setNotesOpen(true); setNotesWidth(w); }
      } else if (activeHandle.current === 'ai') {
        const w = Math.max(40, Math.min(800, window.innerWidth - clientX));
        if (w < 60) { if (aiOpen) setAiOpen(false); }
        else { if (!aiOpen && w > 40) setAiWidth(w); }
      }
    });
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
                <img src={`${import.meta.env.BASE_URL}apple-touch-icon.png`} onError={(e) => { (e.target as HTMLImageElement).src = `${import.meta.env.BASE_URL}logo.png`; }} alt="King's Sword" className="w-12 h-12 animate-pulse object-cover rounded-full" />
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

          {/* Floating Side Buttons for Notes & AI */}
          {!isFullscreen && (!notesOpen || !aiOpen) && (
            <div className="absolute right-3 top-14 z-40 flex flex-col gap-2 pointer-events-auto no-print">
              {!notesOpen && (
                <button
                  onClick={toggleNotes}
                  data-tooltip="Ouvrir le journal de notes"
                  data-tooltip-icon="notes"
                  className="flex items-center justify-center w-9 h-9 bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md text-zinc-600 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 rounded-xl shadow-md hover:bg-teal-600/10 hover:text-teal-600 hover:border-teal-600/30 transition-all duration-200 active:scale-95 cursor-pointer"
                >
                  <NotebookPen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </button>
              )}
              {!aiOpen && (
                <button
                  onClick={toggleAI}
                  data-tooltip="Ouvrir l'Assistant IA"
                  data-tooltip-icon="sparkles"
                  className="flex items-center justify-center w-9 h-9 bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md text-zinc-600 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 rounded-xl shadow-md hover:bg-teal-600/10 hover:text-teal-600 hover:border-teal-600/30 transition-all duration-200 active:scale-95 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </button>
              )}
            </div>
          )}
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
      <GlobalTooltip />
      <ImageProjectionModal />
      <AnnouncementModal />
    </div>
  );
};

export default App;
