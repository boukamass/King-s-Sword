import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Image as ImageIcon, 
  Upload, 
  Trash2, 
  Eye, 
  EyeOff, 
  X, 
  MonitorPlay, 
  Radio, 
  Plus, 
  Wallpaper, 
  Camera, 
  Download,
  Folder,
  FolderPlus,
  FolderOpen,
  Pencil,
  Search,
  ChevronDown,
  Check,
  FolderOutput
} from 'lucide-react';
import { useAppStore } from '../store';
import { ProjectedImageMedia, MediaFolder } from '../types';
import { detectImageMeta, preloadImage } from '../services/imageMediaService';
import { 
  openProjectionWindow, 
  broadcastProjectionPayload,
  ProjectionSyncPayload,
  STORAGE_KEY
} from '../services/projectionService';
import { executeProjectionCapture } from '../services/projectionCaptureService';

export const ImageProjectionModal: React.FC = memo(() => {
  const isOpen = useAppStore(s => s.isImageModalOpen);
  const setIsOpen = useAppStore(s => s.setIsImageModalOpen);
  const mediaImages = useAppStore(s => s.mediaImages);
  const mediaFolders = useAppStore(s => s.mediaFolders);
  const projectedImage = useAppStore(s => s.projectedImage);
  const setProjectedImage = useAppStore(s => s.setProjectedImage);
  const projectionBgImage = useAppStore(s => s.projectionBgImage);
  const setProjectionBgImage = useAppStore(s => s.setProjectionBgImage);
  const loadMediaImages = useAppStore(s => s.loadMediaImages);
  const loadMediaFolders = useAppStore(s => s.loadMediaFolders);
  const addMediaImage = useAppStore(s => s.addMediaImage);
  const deleteMediaImage = useAppStore(s => s.deleteMediaImage);
  const createMediaFolder = useAppStore(s => s.createMediaFolder);
  const renameMediaFolder = useAppStore(s => s.renameMediaFolder);
  const deleteMediaFolder = useAppStore(s => s.deleteMediaFolder);
  const setImageFolder = useAppStore(s => s.setImageFolder);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
  const setProjectionBlackout = useAppStore(s => s.setProjectionBlackout);
  const addNotification = useAppStore(s => s.addNotification);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterOrientation, setFilterOrientation] = useState<'ALL' | 'landscape' | 'portrait'>('ALL');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Folder management states
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadMediaImages();
      loadMediaFolders();
    }
  }, [isOpen, loadMediaImages, loadMediaFolders]);

  // Close folder menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenFolderMenuId(null);
    if (openFolderMenuId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [openFolderMenuId]);

  // Process files (Drag & Drop or Input)
  const processFiles = useCallback(async (files: FileList | File[]) => {
    setIsProcessing(true);
    let count = 0;

    const targetFolderId = (selectedFolderId !== 'ALL' && selectedFolderId !== 'UNASSIGNED') 
      ? selectedFolderId 
      : 'folder-importes';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;

      try {
        const reader = new FileReader();
        const base64Url = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const meta = await detectImageMeta(base64Url);
        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

        await addMediaImage({
          name: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
          url: base64Url,
          orientation: meta.orientation,
          aspectRatio: meta.aspectRatio,
          width: meta.width,
          height: meta.height,
          caption: '',
          folderId: targetFolderId
        });

        count++;
      } catch (err) {
        console.error('Error importing image:', err);
      }
    }

    setIsProcessing(false);
    if (count > 0) {
      const folderObj = mediaFolders.find(f => f.id === targetFolderId);
      const folderMsg = folderObj ? ` dans le dossier "${folderObj.name}"` : '';
      addNotification(`${count} image(s) ajoutée(s)${folderMsg}`, 'success');
    }
  }, [addMediaImage, addNotification, selectedFolderId, mediaFolders]);

  // Paste handler for quick clipboard images (e.g. screenshots / web copies)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        processFiles(imageFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, processFiles]);

  if (!isOpen) return null;

  // Folder Action Handlers
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const folder = await createMediaFolder(newFolderName.trim());
    addNotification(`Dossier "${folder.name}" créé avec succès`, 'success');
    setSelectedFolderId(folder.id);
    setNewFolderName('');
    setIsCreateFolderOpen(false);
  };

  const handleRenameFolder = async () => {
    if (!editingFolderId || !editingFolderName.trim()) return;
    await renameMediaFolder(editingFolderId, editingFolderName.trim());
    addNotification(`Dossier renommé en "${editingFolderName.trim()}"`, 'success');
    setEditingFolderId(null);
    setEditingFolderName('');
  };

  const handleDeleteFolder = async () => {
    if (!deletingFolderId) return;
    const folder = mediaFolders.find(f => f.id === deletingFolderId);
    await deleteMediaFolder(deletingFolderId);
    addNotification(`Dossier "${folder?.name || ''}" supprimé (les images ont été conservées)`, 'info');
    if (selectedFolderId === deletingFolderId) {
      setSelectedFolderId('ALL');
    }
    setDeletingFolderId(null);
  };

  const handleSetImageFolder = async (imageId: string, folderId: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await setImageFolder(imageId, folderId);
    setOpenFolderMenuId(null);
    const folder = mediaFolders.find(f => f.id === folderId);
    if (folder) {
      addNotification(`Image déplacée vers le dossier "${folder.name}"`, 'success');
    } else {
      addNotification('Image retirée du dossier', 'info');
    }
  };

  const handleSetBgImage = (img: ProjectedImageMedia) => {
    let nextBg: ProjectedImageMedia | null = null;
    if (projectionBgImage?.id === img.id) {
      setProjectionBgImage(null);
      addNotification('Image de fond retirée (revenir au fond noir)', 'info');
    } else {
      nextBg = img;
      preloadImage(img.url);
      setProjectionBgImage(img);
      if (projectedImage) {
        setProjectedImage(null);
      }
      addNotification(`"${img.name}" définie comme image de fond du texte`, 'success');
    }

    let currentPayload: ProjectionSyncPayload | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        currentPayload = JSON.parse(saved);
      }
    } catch (e) {}

    const updatedPayload: ProjectionSyncPayload = {
      title: currentPayload?.title || '',
      date: currentPayload?.date || '',
      city: currentPayload?.city || '',
      time: currentPayload?.time || '',
      text: currentPayload?.text || '',
      projectedWords: currentPayload?.projectedWords || [],
      fontSize: currentPayload?.fontSize || 42,
      blackout: projectionBlackout,
      theme: currentPayload?.theme || 'light',
      highlights: currentPayload?.highlights || [],
      selectionIndices: currentPayload?.selectionIndices || [],
      searchResults: currentPayload?.searchResults || [],
      currentResultIndex: currentPayload?.currentResultIndex ?? -1,
      activeDefinition: currentPayload?.activeDefinition || null,
      isBible: currentPayload?.isBible ?? false,
      projectedImage: null,
      projectionBgImage: nextBg
    };

    broadcastProjectionPayload(updatedPayload);
    if (nextBg) {
      openProjectionWindow(updatedPayload);
    }
  };

  const handleRemoveBgImage = () => {
    setProjectionBgImage(null);
    addNotification('Image de fond retirée', 'info');

    let currentPayload: ProjectionSyncPayload | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        currentPayload = JSON.parse(saved);
      }
    } catch (e) {}

    const updatedPayload: ProjectionSyncPayload = {
      title: currentPayload?.title || '',
      date: currentPayload?.date || '',
      city: currentPayload?.city || '',
      time: currentPayload?.time || '',
      text: currentPayload?.text || '',
      projectedWords: currentPayload?.projectedWords || [],
      fontSize: currentPayload?.fontSize || 42,
      blackout: projectionBlackout,
      theme: currentPayload?.theme || 'light',
      highlights: currentPayload?.highlights || [],
      selectionIndices: currentPayload?.selectionIndices || [],
      searchResults: currentPayload?.searchResults || [],
      currentResultIndex: currentPayload?.currentResultIndex ?? -1,
      activeDefinition: currentPayload?.activeDefinition || null,
      isBible: currentPayload?.isBible ?? false,
      projectedImage: projectedImage,
      projectionBgImage: null
    };

    broadcastProjectionPayload(updatedPayload);
  };

  const handleToggleProject = (img: ProjectedImageMedia) => {
    if (projectedImage?.id === img.id) {
      setProjectedImage(null);
      addNotification('Projection de l\'image arrêtée', 'info');

      let currentPayload: ProjectionSyncPayload | null = null;
      try {
        const saved = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          currentPayload = JSON.parse(saved);
        }
      } catch (e) {}

      const updatedPayload: ProjectionSyncPayload = {
        title: currentPayload?.title || '',
        date: currentPayload?.date || '',
        city: currentPayload?.city || '',
        time: currentPayload?.time || '',
        text: currentPayload?.text || '',
        projectedWords: currentPayload?.projectedWords || [],
        fontSize: currentPayload?.fontSize || 42,
        blackout: projectionBlackout,
        theme: currentPayload?.theme || 'light',
        highlights: currentPayload?.highlights || [],
        selectionIndices: currentPayload?.selectionIndices || [],
        searchResults: currentPayload?.searchResults || [],
        currentResultIndex: currentPayload?.currentResultIndex ?? -1,
        activeDefinition: currentPayload?.activeDefinition || null,
        isBible: currentPayload?.isBible ?? false,
        projectedImage: null,
        projectionBgImage: useAppStore.getState().projectionBgImage
      };
      broadcastProjectionPayload(updatedPayload);
    } else {
      setProjectedImage(img);

      let currentPayload: ProjectionSyncPayload | null = null;
      try {
        const saved = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          currentPayload = JSON.parse(saved);
        }
      } catch (e) {}

      const payload: ProjectionSyncPayload = {
        title: img.name || '',
        date: currentPayload?.date || '',
        city: currentPayload?.city || '',
        time: currentPayload?.time || '',
        text: currentPayload?.text || '',
        projectedWords: currentPayload?.projectedWords || [],
        fontSize: currentPayload?.fontSize || 42,
        blackout: projectionBlackout,
        theme: currentPayload?.theme || 'light',
        highlights: currentPayload?.highlights || [],
        selectionIndices: currentPayload?.selectionIndices || [],
        searchResults: currentPayload?.searchResults || [],
        currentResultIndex: currentPayload?.currentResultIndex ?? -1,
        activeDefinition: currentPayload?.activeDefinition || null,
        isBible: currentPayload?.isBible ?? false,
        projectedImage: img,
        projectionBgImage: useAppStore.getState().projectionBgImage
      };
      openProjectionWindow(payload);
      addNotification(`Projection de "${img.name}" (${img.orientation === 'portrait' ? 'Mode Portrait' : 'Mode Paysage'})`, 'success');
    }
  };

  const handleStopProjection = () => {
    setProjectedImage(null);
    broadcastProjectionPayload({
      title: '',
      date: '',
      city: '',
      time: '',
      text: '',
      fontSize: 42,
      blackout: projectionBlackout,
      theme: 'light',
      highlights: [],
      selectionIndices: [],
      searchResults: [],
      currentResultIndex: -1,
      activeDefinition: null,
      isBible: false,
      projectedImage: null
    });
    addNotification('Projection de l\'image arrêtée', 'info');
  };

  const handleDeleteImage = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDeleteId(null);
    await deleteMediaImage(id);
    addNotification('Image supprimée avec succès', 'success');
  };

  const handleDownloadImage = (img: ProjectedImageMedia, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const link = document.createElement('a');
      link.href = img.url;
      const safeName = (img.name || 'image_projection').replace(/[^a-zA-Z0-9_\-]/g, '_');
      link.download = `${safeName}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addNotification(`Téléchargement de "${img.name}" démarré`, 'info');
    } catch (err) {
      console.error('Erreur téléchargement image:', err);
      addNotification('Impossible de télécharger cette image', 'error');
    }
  };

  // Helper counts
  const unassignedCount = mediaImages.filter(img => !img.folderId).length;
  const getFolderCount = (fId: string) => mediaImages.filter(img => img.folderId === fId).length;

  // Filtered images list
  const filteredImages = mediaImages.filter(img => {
    // Orientation filter
    if (filterOrientation !== 'ALL' && img.orientation !== filterOrientation) {
      return false;
    }
    // Folder filter
    if (selectedFolderId === 'UNASSIGNED') {
      if (img.folderId) return false;
    } else if (selectedFolderId !== 'ALL') {
      if (img.folderId !== selectedFolderId) return false;
    }
    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = img.name.toLowerCase().includes(q);
      const captionMatch = img.caption ? img.caption.toLowerCase().includes(q) : false;
      return nameMatch || captionMatch;
    }
    return true;
  });

  const activeFolder = mediaFolders.find(f => f.id === selectedFolderId);

  return createPortal(
    <div 
      className="fixed inset-0 z-[200000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200"
      onClick={() => setIsOpen(false)}
    >
      <div 
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-w-[96vw] lg:max-w-[1380px] xl:max-w-[1480px] w-full h-[90vh] max-h-[860px] animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-3.5 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600/10 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-600/20 shadow-xs shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-white">
                  Projection d'Images
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                  Écran 2
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Organisez vos images en dossiers thématiques et projetez-les sur l'écran secondaire
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-nowrap shrink-0">
            {projectionBgImage && !projectedImage && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-teal-50 dark:bg-teal-950/60 border border-teal-300 dark:border-teal-700/60 rounded-xl text-xs font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap shrink-0 select-none">
                <Wallpaper className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[220px] sm:max-w-[300px] whitespace-nowrap">Fond : {projectionBgImage.name}</span>
                <button
                  type="button"
                  onClick={handleRemoveBgImage}
                  className="ml-1 px-1.5 py-0.5 bg-teal-100 hover:bg-teal-200 dark:bg-teal-900 dark:hover:bg-teal-800 text-teal-800 dark:text-teal-200 rounded text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 select-none"
                >
                  Retirer
                </button>
              </div>
            )}

            {projectedImage && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/60 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0 select-none">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="truncate max-w-[220px] sm:max-w-[300px] whitespace-nowrap">Plein écran : {projectedImage.name}</span>
                <button
                  type="button"
                  onClick={handleStopProjection}
                  className="ml-1 px-1.5 py-0.5 bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900 text-red-700 dark:text-red-300 rounded text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 select-none"
                >
                  Arrêter
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                const nextVal = !projectionBlackout;
                setProjectionBlackout(nextVal);
                if (projectedImage) {
                  broadcastProjectionPayload({
                    title: projectedImage.name || '',
                    date: '',
                    city: '',
                    time: '',
                    text: '',
                    fontSize: 42,
                    blackout: nextVal,
                    theme: 'light',
                    highlights: [],
                    selectionIndices: [],
                    searchResults: [],
                    currentResultIndex: -1,
                    activeDefinition: null,
                    isBible: false,
                    projectedImage
                  });
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 select-none ${
                projectionBlackout 
                  ? 'bg-amber-500 text-black shadow-xs ring-2 ring-amber-400' 
                  : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 border border-slate-300/60 dark:border-zinc-700'
              }`}
              data-tooltip="Masquer temporairement la projection"
            >
              {projectionBlackout ? <EyeOff className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" />}
              <span className="whitespace-nowrap select-none">{projectionBlackout ? 'Noir actif' : 'Noir (B)'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer shrink-0 select-none"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Folder Toolbar Bar */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-100/60 dark:bg-zinc-950/40 flex items-center gap-2 overflow-x-auto custom-scrollbar shrink-0 select-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 shrink-0 flex items-center gap-1">
            <Folder className="w-3.5 h-3.5" /> Dossiers:
          </span>

          {/* All tab */}
          <button
            type="button"
            onClick={() => setSelectedFolderId('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              selectedFolderId === 'ALL'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'bg-white dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700'
            }`}
          >
            <span>Toutes les images</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              selectedFolderId === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400'
            }`}>
              {mediaImages.length}
            </span>
          </button>

          {/* Folder tabs */}
          {mediaFolders.map(folder => {
            const isSelected = selectedFolderId === folder.id;
            const count = getFolderCount(folder.id);

            return (
              <div key={folder.id} className="relative group shrink-0 flex items-center">
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? 'bg-teal-600 text-white shadow-xs'
                      : 'bg-white dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700'
                  }`}
                >
                  <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-teal-500 dark:text-teal-400'}`} />
                  <span>{folder.name}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400'
                  }`}>
                    {count}
                  </span>
                </button>
              </div>
            );
          })}

          {/* Unassigned Tab if any */}
          {unassignedCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedFolderId('UNASSIGNED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                selectedFolderId === 'UNASSIGNED'
                  ? 'bg-slate-700 text-white shadow-xs'
                  : 'bg-white dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700'
              }`}
            >
              <span>Sans dossier</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400">
                {unassignedCount}
              </span>
            </button>
          )}

          {/* Add Folder Button */}
          <button
            type="button"
            onClick={() => {
              setIsCreateFolderOpen(true);
              setNewFolderName('');
            }}
            className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900/80 text-teal-700 dark:text-teal-300 border border-teal-300/80 dark:border-teal-700/80 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            title="Créer un nouveau dossier par thème"
          >
            <FolderPlus className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>+ Nouveau dossier</span>
          </button>
        </div>

        {/* Active Folder Options Bar (If a specific folder is selected) */}
        {activeFolder && (
          <div className="px-5 py-2 bg-teal-50/60 dark:bg-teal-950/30 border-b border-teal-200/80 dark:border-teal-800/60 flex items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex items-center gap-2 text-teal-800 dark:text-teal-200 font-bold truncate">
              <FolderOpen className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <span>Dossier actif : "{activeFolder.name}" ({getFolderCount(activeFolder.id)} images)</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setEditingFolderId(activeFolder.id);
                  setEditingFolderName(activeFolder.name);
                }}
                className="px-2.5 py-1 bg-white dark:bg-zinc-800 hover:bg-teal-100 dark:hover:bg-teal-900 text-teal-700 dark:text-teal-300 rounded-lg border border-teal-200 dark:border-teal-700 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                title="Renommer ce dossier"
              >
                <Pencil className="w-3 h-3" />
                <span>Renommer</span>
              </button>

              <button
                type="button"
                onClick={() => setDeletingFolderId(activeFolder.id)}
                className="px-2.5 py-1 bg-white dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                title="Supprimer ce dossier"
              >
                <Trash2 className="w-3 h-3" />
                <span>Supprimer</span>
              </button>
            </div>
          </div>
        )}

        {/* Inline Create Folder Form */}
        {isCreateFolderOpen && (
          <div className="px-5 py-2.5 bg-teal-50 dark:bg-teal-950/60 border-b border-teal-200 dark:border-teal-800 flex items-center gap-2 shrink-0 animate-in fade-in duration-150">
            <FolderPlus className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <input
              type="text"
              placeholder="Nom du dossier (ex: Événements, Jeunesse, Pâques, Cantiques...)"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
              className="flex-1 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoFocus
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
              className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              Créer le dossier
            </button>
            <button
              type="button"
              onClick={() => { setIsCreateFolderOpen(false); setNewFolderName(''); }}
              className="px-3 py-1.5 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-200 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Inline Rename Folder Form */}
        {editingFolderId && (
          <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 flex items-center gap-2 shrink-0 animate-in fade-in duration-150">
            <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <input
              type="text"
              placeholder="Nouveau nom du dossier"
              value={editingFolderName}
              onChange={(e) => setEditingFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(); }}
              className="flex-1 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
            />
            <button
              type="button"
              onClick={handleRenameFolder}
              disabled={!editingFolderName.trim()}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => { setEditingFolderId(null); setEditingFolderName(''); }}
              className="px-3 py-1.5 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-200 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Delete Folder Banner */}
        {deletingFolderId && (
          <div className="px-5 py-2.5 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-800 flex items-center justify-between gap-3 shrink-0 animate-in fade-in duration-150">
            <span className="text-xs font-bold text-red-700 dark:text-red-300">
              Voulez-vous supprimer ce dossier ? Les images qu'il contient ne seront pas supprimées.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDeleteFolder}
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Confirmer la suppression
              </button>
              <button
                type="button"
                onClick={() => setDeletingFolderId(null)}
                className="px-3 py-1.5 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-200 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Action Bar (Upload, Capture, Search & Orientation) */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && processFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 select-none"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap select-none">Ajouter des images</span>
            </button>

            <button
              type="button"
              onClick={() => {
                executeProjectionCapture();
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer whitespace-nowrap shrink-0 select-none"
              data-tooltip="Capturer ce qui est actuellement projeté et l'enregistrer dans cette galerie"
            >
              <Camera className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap select-none">Capturer la projection</span>
            </button>

            {/* Search Input */}
            <div className="relative flex items-center min-w-[160px] sm:min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher une image..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1 bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Orientation Filter */}
          <div className="flex items-center bg-slate-100 dark:bg-zinc-800 p-0.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold shrink-0 whitespace-nowrap">
            <button
              type="button"
              onClick={() => setFilterOrientation('ALL')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 select-none ${
                filterOrientation === 'ALL' 
                  ? 'bg-white dark:bg-zinc-700 text-slate-800 dark:text-white shadow-xs font-bold' 
                  : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
              }`}
            >
              Toutes ({mediaImages.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterOrientation('landscape')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 select-none ${
                filterOrientation === 'landscape' 
                  ? 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 shadow-xs font-bold' 
                  : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
              }`}
            >
              Paysage
            </button>
            <button
              type="button"
              onClick={() => setFilterOrientation('portrait')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 select-none ${
                filterOrientation === 'portrait' 
                  ? 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 shadow-xs font-bold' 
                  : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
              }`}
            >
              Portrait
            </button>
          </div>
        </div>

        {/* Image Grid Content */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
          }}
          className={`flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar bg-slate-50/50 dark:bg-zinc-950/20 transition-all ${
            isDragging ? 'bg-teal-50/60 dark:bg-teal-950/20 ring-2 ring-teal-500/50 ring-inset' : ''
          }`}
        >
          {isDragging && (
            <div className="mb-4 p-6 border-2 border-dashed border-teal-500/60 rounded-2xl bg-teal-50/70 dark:bg-teal-950/30 flex flex-col items-center justify-center text-teal-700 dark:text-teal-300 animate-pulse">
              <Upload className="w-8 h-8 mb-1.5" />
              <p className="text-xs font-bold">Déposez vos images ici pour les ajouter</p>
            </div>
          )}

          {filteredImages.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 dark:text-zinc-500 gap-2">
              <ImageIcon className="w-10 h-10 stroke-1 opacity-50" />
              <p className="text-xs font-medium">Aucune image trouvée dans cette catégorie ou ce dossier</p>
              {selectedFolderId !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setSelectedFolderId('ALL')}
                  className="mt-2 text-xs text-teal-600 dark:text-teal-400 hover:underline font-bold"
                >
                  Voir toutes les images
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-6 gap-4">
              {filteredImages.map((img) => {
                const isLive = projectedImage?.id === img.id;
                const isBg = projectionBgImage?.id === img.id;
                const isPortrait = img.orientation === 'portrait';
                const isConfirmingDelete = confirmDeleteId === img.id;
                const isFolderMenuOpen = openFolderMenuId === img.id;
                const currentFolder = mediaFolders.find(f => f.id === img.folderId);

                return (
                  <div
                    key={img.id}
                    className={`group relative bg-white dark:bg-zinc-800/90 rounded-2xl border transition-all duration-200 flex flex-col shadow-xs hover:shadow-md ${
                      isLive 
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-emerald-500/10' 
                        : isBg
                        ? 'border-teal-500 ring-2 ring-teal-500/30 shadow-teal-500/10'
                        : 'border-slate-200 dark:border-zinc-700/80 hover:border-teal-500/60'
                    }`}
                  >
                    {/* Thumbnail View */}
                    <div 
                      onClick={() => handleSetBgImage(img)}
                      className="relative aspect-video w-full bg-slate-100 dark:bg-zinc-900/90 cursor-pointer rounded-t-2xl overflow-hidden flex items-center justify-center select-none"
                      title="Cliquer pour définir comme fond d'écran de projection"
                    >
                      {isPortrait ? (
                        <>
                          <img
                            src={img.url}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="absolute inset-0 w-full h-full object-cover blur-md opacity-30 scale-125"
                          />
                          <img
                            src={img.url}
                            alt={img.name}
                            referrerPolicy="no-referrer"
                            className="relative z-10 max-h-full max-w-full object-contain py-1 group-hover:scale-105 transition-transform duration-200"
                          />
                        </>
                      ) : (
                        <img
                          src={img.url}
                          alt={img.name}
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-200"
                        />
                      )}

                      {/* Orientation Tag */}
                      <span className={`absolute top-2 left-2 z-20 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shadow-xs ${
                        isPortrait 
                          ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800' 
                          : 'bg-teal-100 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                      }`}>
                        {isPortrait ? 'Portrait' : 'Paysage'}
                      </span>

                      {/* LIVE / FOND Badge */}
                      {isLive && (
                        <span className="absolute top-2 right-2 z-20 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500 text-white shadow-xs animate-pulse">
                          <Radio className="w-2.5 h-2.5" /> LIVE
                        </span>
                      )}
                      {!isLive && isBg && (
                        <span className="absolute top-2 right-2 z-20 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-teal-600 text-white shadow-xs">
                          <Wallpaper className="w-2.5 h-2.5" /> FOND
                        </span>
                      )}
                    </div>

                    {/* Card Footer info & actions */}
                    <div className="p-2.5 bg-white dark:bg-zinc-800 flex flex-col gap-2 rounded-b-2xl border-t border-slate-100 dark:border-zinc-700/60 relative">
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate flex-1" title={img.name}>
                          {img.name}
                        </p>

                        {!isConfirmingDelete && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => handleDownloadImage(img, e)}
                              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-md transition-colors cursor-pointer hover:bg-teal-50 dark:hover:bg-teal-950/40 shrink-0"
                              title="Télécharger l'image"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmDeleteId(img.id);
                              }}
                              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                              title="Supprimer cette image"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Folder selector pill on card */}
                      <div className="relative z-30">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenFolderMenuId(isFolderMenuOpen ? null : img.id);
                          }}
                          className="w-full px-2 py-1 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-900/80 dark:hover:bg-zinc-700/80 border border-slate-200 dark:border-zinc-700 rounded-lg text-[10px] text-slate-600 dark:text-zinc-300 flex items-center justify-between gap-1 transition-colors cursor-pointer truncate"
                          title="Ranger dans un dossier"
                        >
                          <span className="flex items-center gap-1 truncate">
                            <Folder className="w-3 h-3 text-teal-500 dark:text-teal-400 shrink-0" />
                            <span className="truncate">{currentFolder ? currentFolder.name : 'Sans dossier'}</span>
                          </span>
                          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                        </button>

                        {/* Folder Assign Dropdown Menu */}
                        {isFolderMenuOpen && (
                          <div 
                            className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-xl py-1 animate-in fade-in zoom-in-95 duration-150 max-h-48 overflow-y-auto custom-scrollbar"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-2 py-1 text-[9px] font-black uppercase text-slate-400 border-b border-slate-100 dark:border-zinc-700">
                              Placer dans un dossier :
                            </div>

                            {/* Unassigned Option */}
                            <button
                              type="button"
                              onClick={(e) => handleSetImageFolder(img.id, undefined, e)}
                              className={`w-full px-2.5 py-1.5 text-[11px] text-left flex items-center justify-between hover:bg-slate-100 dark:hover:bg-zinc-700 cursor-pointer ${
                                !img.folderId ? 'font-bold text-teal-600 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/30' : 'text-slate-700 dark:text-zinc-300'
                              }`}
                            >
                              <span className="truncate">Sans dossier</span>
                              {!img.folderId && <Check className="w-3 h-3 shrink-0 text-teal-600" />}
                            </button>

                            {/* Folders List */}
                            {mediaFolders.map(folder => {
                              const isCurrent = img.folderId === folder.id;
                              return (
                                <button
                                  key={folder.id}
                                  type="button"
                                  onClick={(e) => handleSetImageFolder(img.id, folder.id, e)}
                                  className={`w-full px-2.5 py-1.5 text-[11px] text-left flex items-center justify-between hover:bg-slate-100 dark:hover:bg-zinc-700 cursor-pointer ${
                                    isCurrent ? 'font-bold text-teal-600 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/30' : 'text-slate-700 dark:text-zinc-300'
                                  }`}
                                >
                                  <span className="truncate flex items-center gap-1">
                                    <Folder className="w-3 h-3 text-teal-500 shrink-0" />
                                    <span className="truncate">{folder.name}</span>
                                  </span>
                                  {isCurrent && <Check className="w-3 h-3 shrink-0 text-teal-600" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-1 bg-red-50 dark:bg-red-950/80 p-1 rounded-lg border border-red-200 dark:border-red-800 w-full justify-between">
                          <span className="text-[9px] font-bold text-red-600 dark:text-red-300">Supprimer ?</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => handleDeleteImage(img.id, e)}
                              className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-black transition-colors cursor-pointer"
                            >
                              Oui
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmDeleteId(null);
                              }}
                              className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-200 rounded text-[9px] font-bold transition-colors cursor-pointer"
                            >
                              Non
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5 w-full">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetBgImage(img);
                            }}
                            className={`w-full py-1.5 px-1.5 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap shrink-0 select-none ${
                              isBg
                                ? 'bg-teal-600 text-white shadow-xs'
                                : 'bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900/80 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/80'
                            }`}
                            title="Définir comme fond d'écran de projection"
                          >
                            <Wallpaper className="w-3.5 h-3.5 shrink-0" />
                            <span className="whitespace-nowrap select-none">{isBg ? 'Fond actif' : 'Fond'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleProject(img);
                            }}
                            className={`w-full py-1.5 px-1.5 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap shrink-0 select-none ${
                              isLive
                                ? 'bg-emerald-600 text-white shadow-xs animate-pulse'
                                : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-700 dark:hover:bg-zinc-650 text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-zinc-600'
                            }`}
                            title="Projeter l'image en plein écran"
                          >
                            <MonitorPlay className="w-3.5 h-3.5 shrink-0" />
                            <span className="whitespace-nowrap select-none">{isLive ? 'Plein écran' : 'Plein écran'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-950/50 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-slate-700 dark:text-zinc-300">{filteredImages.length} image(s) affichée(s) sur {mediaImages.length} au total</span>
            <span>•</span>
            <span>{mediaFolders.length} dossier(s) thématique(s)</span>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="px-4 py-1.5 bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-800 dark:text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
});
