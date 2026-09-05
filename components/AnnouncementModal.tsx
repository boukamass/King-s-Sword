import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Megaphone, 
  MonitorPlay, 
  MonitorOff, 
  Save, 
  Plus, 
  Trash2, 
  Copy, 
  Edit3, 
  AlignLeft, 
  AlignCenter, 
  Eye, 
  Clock, 
  MapPin, 
  Calendar, 
  X, 
  Check, 
  Search, 
  RotateCcw,
  Sparkles,
  Layers,
  Sliders,
  Type
} from 'lucide-react';
import { useAppStore } from '../store';
import { Announcement } from '../types';
import { 
  getStoredAnnouncements, 
  saveStoredAnnouncements, 
  projectAnnouncementPayload, 
  getLastProjectedAnnouncement,
  DEFAULT_ANNOUNCEMENT_PRESETS 
} from '../services/announcementService';
import { 
  isProjectionWindowOpen, 
  openProjectionWindow, 
  broadcastProjectionPayload 
} from '../services/projectionService';

export const AnnouncementModal: React.FC = memo(() => {
  const isOpen = useAppStore(s => s.isAnnouncementModalOpen);
  const setIsOpen = useAppStore(s => s.setIsAnnouncementModalOpen);
  const projectedAnnouncement = useAppStore(s => s.projectedAnnouncement);
  const setProjectedAnnouncement = useAppStore(s => s.setProjectedAnnouncement);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
  const setProjectionBlackout = useAppStore(s => s.setProjectionBlackout);
  const addNotification = useAppStore(s => s.addNotification);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Active editing form fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Annonce');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [content, setContent] = useState('');
  const [alignment, setAlignment] = useState<'center' | 'left'>('center');
  const [accentColor, setAccentColor] = useState<'teal' | 'amber' | 'blue' | 'purple' | 'emerald' | 'rose'>('teal');
  const [fontSize, setFontSize] = useState<number>(44);

  const [activeView, setActiveView] = useState<'editor' | 'library'>('editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const backdropMouseDownTargetRef = useRef<EventTarget | null>(null);

  // Load announcements on open
  useEffect(() => {
    if (isOpen) {
      const list = getStoredAnnouncements();
      setAnnouncements(list);

      const activeOrLast = projectedAnnouncement || getLastProjectedAnnouncement() || (list.length > 0 ? list[0] : null);
      if (activeOrLast) {
        setSelectedId(activeOrLast.id);
        setTitle(activeOrLast.title || '');
        setCategory(activeOrLast.category || 'Annonce');
        setDate(activeOrLast.date || '');
        setLocation(activeOrLast.location || '');
        setContent(activeOrLast.content || '');
        setAlignment(activeOrLast.alignment || 'center');
        setAccentColor(activeOrLast.accentColor || 'teal');
        setFontSize(activeOrLast.fontSize || 44);
      }
    }
  }, [isOpen, projectedAnnouncement]);

  // Load an announcement into editor
  const handleSelectAnnouncement = useCallback((item: Announcement) => {
    setSelectedId(item.id);
    setTitle(item.title);
    setCategory(item.category || 'Annonce');
    setDate(item.date || '');
    setLocation(item.location || '');
    setContent(item.content);
    setAlignment(item.alignment || 'center');
    setAccentColor(item.accentColor || 'teal');
    setFontSize(item.fontSize || 44);
    setActiveView('editor');
  }, []);

  // Create new blank announcement
  const handleNewAnnouncement = useCallback(() => {
    const newId = `ann-${Date.now()}`;
    setSelectedId(newId);
    setTitle('');
    setCategory('Annonce');
    setDate('');
    setLocation('');
    setContent('');
    setAlignment('center');
    setAccentColor('teal');
    setFontSize(44);
    setActiveView('editor');
  }, []);

  // Current working item
  const currentItem = useMemo((): Announcement => {
    return {
      id: selectedId || `ann-${Date.now()}`,
      title: title.trim(),
      category: category.trim() || 'Annonce',
      date: date.trim(),
      location: location.trim(),
      content: content.trim(),
      alignment,
      accentColor,
      fontSize,
      updatedAt: new Date().toISOString()
    };
  }, [selectedId, title, category, date, location, content, alignment, accentColor, fontSize]);

  // Check if currently displayed on projection
  const isCurrentlyProjected = useMemo(() => {
    if (!projectedAnnouncement) return false;
    return projectedAnnouncement.id === currentItem.id || (
      projectedAnnouncement.title === currentItem.title && 
      projectedAnnouncement.content === currentItem.content
    );
  }, [projectedAnnouncement, currentItem]);

  // Save current announcement
  const handleSaveAnnouncement = useCallback(() => {
    if (!title.trim() && !content.trim()) {
      addNotification("Veuillez saisir un titre ou un contenu d'annonce", "error");
      return;
    }

    const updatedList = [...announcements];
    const existingIndex = updatedList.findIndex(a => a.id === currentItem.id);

    if (existingIndex >= 0) {
      updatedList[existingIndex] = currentItem;
    } else {
      updatedList.unshift(currentItem);
    }

    setAnnouncements(updatedList);
    saveStoredAnnouncements(updatedList);
    addNotification("Annonce enregistrée avec succès", "success");
  }, [announcements, currentItem, title, content, addNotification]);

  // Delete an announcement
  const handleDeleteAnnouncement = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const updatedList = announcements.filter(a => a.id !== id);
    setAnnouncements(updatedList);
    saveStoredAnnouncements(updatedList);
    setConfirmDeleteId(null);
    
    if (projectedAnnouncement?.id === id) {
      setProjectedAnnouncement(null);
    }
    
    if (selectedId === id) {
      if (updatedList.length > 0) {
        handleSelectAnnouncement(updatedList[0]);
      } else {
        handleNewAnnouncement();
      }
    }
    addNotification("Annonce supprimée", "info");
  }, [announcements, projectedAnnouncement, selectedId, handleSelectAnnouncement, handleNewAnnouncement, setProjectedAnnouncement, addNotification]);

  // Duplicate an announcement
  const handleDuplicateAnnouncement = useCallback((item: Announcement, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const copy: Announcement = {
      ...item,
      id: `ann-${Date.now()}`,
      title: `${item.title} (Copie)`,
      updatedAt: new Date().toISOString()
    };
    const updatedList = [copy, ...announcements];
    setAnnouncements(updatedList);
    saveStoredAnnouncements(updatedList);
    handleSelectAnnouncement(copy);
    addNotification("Annonce dupliquée", "success");
  }, [announcements, handleSelectAnnouncement, addNotification]);

  // Project the active announcement to Screen 2
  const handleProjectAnnouncement = useCallback((forceOpenWindow: boolean = true) => {
    if (!currentItem.title.trim() && !currentItem.content.trim()) {
      addNotification("Rien à projeter : veuillez saisir un titre ou un texte", "error");
      return;
    }

    const payload: any = {
      type: 'sync',
      title: currentItem.title.trim() || "ANNONCE",
      date: currentItem.category?.trim() || 'Annonce',
      time: currentItem.date?.trim() || '',
      city: currentItem.location?.trim() || '',
      text: currentItem.content.trim(),
      fontSize: currentItem.fontSize || 42,
      blackout: projectionBlackout,
      theme: 'dark',
      highlights: [],
      selectionIndices: [],
      searchResults: [],
      currentResultIndex: -1,
      activeDefinition: null,
      isBible: false,
      isAnnouncement: true,
      announcementAlignment: currentItem.alignment || 'center'
    };

    setProjectedAnnouncement(currentItem);
    projectAnnouncementPayload(currentItem, projectionBlackout);

    if (forceOpenWindow) {
      openProjectionWindow(payload);
    }

    addNotification(`Annonce "${currentItem.title || 'Annonce'}" projetée sur l'Écran 2`, "success");
  }, [currentItem, projectionBlackout, setProjectedAnnouncement, addNotification]);

  // Stop projecting
  const handleStopProjection = useCallback(() => {
    setProjectedAnnouncement(null);
    broadcastProjectionPayload({
      type: 'sync',
      title: "KING'S SWORD",
      date: '',
      time: '',
      city: '',
      text: '',
      fontSize: 44,
      blackout: false,
      theme: 'dark',
      highlights: [],
      selectionIndices: [],
      searchResults: [],
      currentResultIndex: -1,
      activeDefinition: null,
      isBible: false
    });
    addNotification("Projection de l'annonce terminée", "info");
  }, [setProjectedAnnouncement, addNotification]);

  // Filtered library items
  const filteredAnnouncements = useMemo(() => {
    if (!searchQuery.trim()) return announcements;
    const q = searchQuery.toLowerCase();
    return announcements.filter(a => 
      a.title.toLowerCase().includes(q) || 
      a.content.toLowerCase().includes(q) ||
      (a.category && a.category.toLowerCase().includes(q))
    );
  }, [announcements, searchQuery]);

  // Backdrop click handling
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    backdropMouseDownTargetRef.current = e.target;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && backdropMouseDownTargetRef.current === e.currentTarget) {
      setIsOpen(false);
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      } else if (e.key === 'b' || e.key === 'B') {
        const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
        if (!isInput) {
          e.preventDefault();
          setProjectionBlackout(!projectionBlackout);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, projectionBlackout, setIsOpen, setProjectionBlackout]);

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[200000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-w-5xl w-full max-h-[92vh] animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600/10 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-600/20 shadow-xs shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-zinc-900 dark:text-white">
                  Annonces & Communications
                </h2>
                {isCurrentlyProjected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    En direct (Écran 2)
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest hidden sm:inline">
                    Vidéoprojecteur
                  </span>
                )}
              </div>
              <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                Édition, mise en page et diffusion plein écran
              </p>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2">
            {/* Navigation Tabs */}
            <div className="flex items-center bg-slate-200/70 dark:bg-zinc-800 p-0.5 rounded-xl border border-slate-300/40 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setActiveView('editor')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all ${
                  activeView === 'editor'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                Éditeur
              </button>
              <button
                type="button"
                onClick={() => setActiveView('library')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all ${
                  activeView === 'library'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Layers className="w-3 h-3" />
                Bibliothèque ({announcements.length})
              </button>
            </div>

            {/* Blackout Button */}
            <button
              onClick={() => setProjectionBlackout(!projectionBlackout)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                projectionBlackout 
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40' 
                  : 'bg-slate-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-700'
              }`}
              data-tooltip="Écran noir immédiat (Touche B)"
            >
              <MonitorOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{projectionBlackout ? 'Noir' : 'Noir (B)'}</span>
            </button>

            {/* Close Modal Button */}
            <button
              onClick={() => setIsOpen(false)}
              data-tooltip="Fermer"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        {activeView === 'editor' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-5">
            {/* Quick Template Chips */}
            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 shrink-0">
                Modèles :
              </span>
              {DEFAULT_ANNOUNCEMENT_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectAnnouncement(preset)}
                  className={`px-3 py-1.5 rounded-xl text-[10.5px] font-bold whitespace-nowrap transition-all border shrink-0 ${
                    selectedId === preset.id
                      ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-slate-200 dark:border-zinc-800 hover:border-teal-500/50'
                  }`}
                >
                  {preset.category || preset.title}
                </button>
              ))}
              <button
                onClick={handleNewAnnouncement}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10.5px] font-bold whitespace-nowrap text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-all shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Nouveau</span>
              </button>
            </div>

            {/* Main Form & Preview 2-Column Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              
              {/* Left Column: Form Fields (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                
                {/* Title and Category */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                      Titre de l'Annonce *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Ex: CULTE SPÉCIAL DE SAINTE-CÈNE"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                      Catégorie / Badge
                    </label>
                    <input
                      type="text"
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      placeholder="Ex: Sainte Cène"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    />
                  </div>
                </div>

                {/* Date/Hour & Location */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                      <Clock className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                      <span>Date & Horaire</span>
                    </label>
                    <input
                      type="text"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      placeholder="Ex: Ce Dimanche à 09h30"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                      <MapPin className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                      <span>Lieu / Salle</span>
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      placeholder="Ex: Sanctuaire Principal"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                    />
                  </div>
                </div>

                {/* Content / Message */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                      Texte de l'Annonce * (Sauts de lignes, listes à puces •)
                    </label>
                    <button
                      type="button"
                      onClick={() => setContent(prev => prev ? `${prev}\n• ` : '• ')}
                      className="text-[10px] font-bold text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
                    >
                      + Insérer une puce (•)
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Écrivez ici les détails de l'annonce..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all resize-y custom-scrollbar leading-relaxed"
                  />
                </div>

                {/* Typography & Layout Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-zinc-950/60 rounded-2xl border border-slate-200/80 dark:border-zinc-800/80">
                  {/* Alignment */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                      Alignement :
                    </span>
                    <div className="flex items-center bg-slate-200/70 dark:bg-zinc-800 p-0.5 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setAlignment('center')}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all ${
                          alignment === 'center'
                            ? 'bg-white dark:bg-zinc-900 text-teal-600 dark:text-teal-400 shadow-xs'
                            : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                      >
                        <AlignCenter className="w-3 h-3" />
                        Centré
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlignment('left')}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all ${
                          alignment === 'left'
                            ? 'bg-white dark:bg-zinc-900 text-teal-600 dark:text-teal-400 shadow-xs'
                            : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                      >
                        <AlignLeft className="w-3 h-3" />
                        À gauche
                      </button>
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                      Taille ({fontSize}px) :
                    </span>
                    <input
                      type="range"
                      min="28"
                      max="64"
                      step="2"
                      value={fontSize}
                      onChange={e => setFontSize(Number(e.target.value))}
                      className="w-24 accent-teal-600 cursor-pointer"
                    />
                  </div>
                </div>

              </div>

              {/* Right Column: Live 16:9 Screen Preview (5 cols) */}
              <div className="lg:col-span-5 flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                    <Eye className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                    Aperçu Grand Écran (16:9)
                  </span>
                  <span className="text-[9.5px] font-mono font-bold text-zinc-400">
                    Fidèle au Vidéoprojecteur
                  </span>
                </div>

                {/* 16:9 Video Aspect Box */}
                <div className="relative w-full aspect-video rounded-2xl bg-black border border-zinc-800 overflow-hidden shadow-xl flex flex-col p-4 select-none">
                  
                  {/* Top Bar inside preview */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/40">
                        {category || 'Annonce'}
                      </span>
                      <h4 className="text-[10px] font-black text-teal-400 uppercase tracking-tight truncate max-w-[140px]">
                        {title || "Titre de l'annonce"}
                      </h4>
                    </div>
                    {(date || location) && (
                      <div className="text-[7.5px] font-bold text-zinc-400 flex items-center gap-1.5 truncate">
                        {date && <span>{date}</span>}
                        {location && <span>• {location}</span>}
                      </div>
                    )}
                  </div>

                  {/* Main Message Preview */}
                  <div className={`flex-1 flex flex-col justify-center overflow-hidden ${
                    alignment === 'center' ? 'text-center items-center' : 'text-left items-start'
                  }`}>
                    <div className="text-white font-bold whitespace-pre-wrap leading-snug drop-shadow-md text-[11px] overflow-y-auto max-h-full custom-scrollbar pr-1">
                      {content || (
                        <span className="text-zinc-600 italic">
                          Le texte de votre annonce apparaîtra ici avec un rendu net et contrasté pour l'assemblée.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Preview Footer Badge */}
                  <div className="pt-2 mt-auto border-t border-white/5 flex items-center justify-between text-[7px] font-bold text-zinc-500">
                    <span>KING'S SWORD PROJECTION</span>
                    <span>1920 × 1080</span>
                  </div>
                </div>

                {/* Status message */}
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-2 text-center">
                  {isCurrentlyProjected 
                    ? "✓ Cette annonce est actuellement affichée sur le second écran." 
                    : "Cliquez sur « Projeter sur Grand Écran » pour l'envoyer au vidéoprojecteur."}
                </p>
              </div>

            </div>
          </div>
        ) : (
          /* Library View */
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-4">
            {/* Search and Filter */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher une annonce enregistrée..."
                  className="w-full pl-9 pr-3.5 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:border-teal-500 transition-all"
                />
              </div>
              <button
                onClick={handleNewAnnouncement}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Créer une annonce</span>
              </button>
            </div>

            {/* List of Saved Announcements */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredAnnouncements.map(item => {
                const isItemActive = projectedAnnouncement?.id === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectAnnouncement(item)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between group ${
                      isItemActive
                        ? 'bg-teal-50/60 dark:bg-teal-950/30 border-teal-500 ring-1 ring-teal-500'
                        : selectedId === item.id
                        ? 'bg-slate-50 dark:bg-zinc-950 border-teal-500/80 shadow-xs'
                        : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-slate-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {item.category || 'Annonce'}
                        </span>
                        {isItemActive && (
                          <span className="px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40">
                            En projection
                          </span>
                        )}
                      </div>
                      <h4 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-tight line-clamp-1 mb-1">
                        {item.title}
                      </h4>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-3">
                        {item.content}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[10px]">
                      <span className="text-zinc-400">
                        {item.date || 'Pas de date'}
                      </span>
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleDuplicateAnnouncement(item, e)}
                          data-tooltip="Dupliquer"
                          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-teal-600 transition-all"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteAnnouncement(item.id, e)}
                          data-tooltip="Supprimer"
                          className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/50 text-zinc-400 hover:text-red-600 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer Actions Bar */}
        <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-950/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAnnouncement}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all shadow-xs cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Enregistrer dans la bibliothèque</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isCurrentlyProjected && (
              <button
                onClick={handleStopProjection}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-red-500 transition-all cursor-pointer"
              >
                <MonitorOff className="w-3.5 h-3.5" />
                <span>Arrêter la projection</span>
              </button>
            )}

            <button
              onClick={() => handleProjectAnnouncement(true)}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-teal-600 hover:bg-teal-500 text-white shadow-md hover:shadow-teal-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <MonitorPlay className="w-4 h-4" />
              <span>{isCurrentlyProjected ? "Mettre à jour l'Écran 2" : "Projeter sur Grand Écran"}</span>
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
});
