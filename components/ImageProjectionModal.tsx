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
  Check,
  AlertCircle
} from 'lucide-react';
import { useAppStore } from '../store';
import { ProjectedImageMedia } from '../types';
import { detectImageMeta } from '../services/imageMediaService';
import { 
  openProjectionWindow, 
  broadcastProjectionPayload,
  ProjectionSyncPayload 
} from '../services/projectionService';

export const ImageProjectionModal: React.FC = memo(() => {
  const isOpen = useAppStore(s => s.isImageModalOpen);
  const setIsOpen = useAppStore(s => s.setIsImageModalOpen);
  const mediaImages = useAppStore(s => s.mediaImages);
  const projectedImage = useAppStore(s => s.projectedImage);
  const setProjectedImage = useAppStore(s => s.setProjectedImage);
  const loadMediaImages = useAppStore(s => s.loadMediaImages);
  const addMediaImage = useAppStore(s => s.addMediaImage);
  const deleteMediaImage = useAppStore(s => s.deleteMediaImage);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
  const setProjectionBlackout = useAppStore(s => s.setProjectionBlackout);
  const addNotification = useAppStore(s => s.addNotification);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterOrientation, setFilterOrientation] = useState<'ALL' | 'landscape' | 'portrait'>('ALL');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadMediaImages();
    }
  }, [isOpen, loadMediaImages]);

  // Process files (Drag & Drop or Input)
  const processFiles = useCallback(async (files: FileList | File[]) => {
    setIsProcessing(true);
    let count = 0;

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
          caption: ''
        });

        count++;
      } catch (err) {
        console.error('Error importing image:', err);
      }
    }

    setIsProcessing(false);
    if (count > 0) {
      addNotification(`${count} image(s) ajoutée(s) avec détection automatique`, 'success');
    }
  }, [addMediaImage, addNotification]);

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

  const handleToggleProject = (img: ProjectedImageMedia) => {
    if (projectedImage?.id === img.id) {
      setProjectedImage(null);
      addNotification('Projection de l\'image arrêtée', 'info');
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
    } else {
      setProjectedImage(img);
      const payload: ProjectionSyncPayload = {
        title: img.name || '',
        date: '',
        city: '',
        time: '',
        text: '',
        projectedWords: [],
        fontSize: 42,
        blackout: projectionBlackout,
        theme: 'light',
        highlights: [],
        selectionIndices: [],
        searchResults: [],
        currentResultIndex: -1,
        activeDefinition: null,
        isBible: false,
        projectedImage: img
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

  const filteredImages = mediaImages.filter(img => {
    if (filterOrientation === 'ALL') return true;
    return img.orientation === filterOrientation;
  });

  return createPortal(
    <div 
      className="fixed inset-0 z-[200000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200"
      onClick={() => setIsOpen(false)}
    >
      <div 
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-w-4xl w-full h-[85vh] max-h-[750px] animate-in zoom-in-95 duration-200"
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
                Sélectionnez une image pour la projeter instantanément sur l'écran secondaire
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {projectedImage && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/60 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="truncate max-w-[150px]">En direct : {projectedImage.name}</span>
                <button
                  type="button"
                  onClick={handleStopProjection}
                  className="ml-1 px-1.5 py-0.5 bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900 text-red-700 dark:text-red-300 rounded text-[10px] font-bold transition-colors cursor-pointer"
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                projectionBlackout 
                  ? 'bg-amber-500 text-black shadow-xs ring-2 ring-amber-400' 
                  : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 border border-slate-300/60 dark:border-zinc-700'
              }`}
              data-tooltip="Masquer temporairement la projection"
            >
              {projectionBlackout ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{projectionBlackout ? 'Noir actif' : 'Noir (B)'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Bar */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2">
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
              className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ajouter des images</span>
            </button>

            <span className="text-[11px] text-slate-400 dark:text-zinc-500 hidden md:inline">
              Glissez-déposez vos images ou collez avec Ctrl+V
            </span>
          </div>

          {/* Orientation Filter */}
          <div className="flex items-center bg-slate-100 dark:bg-zinc-800 p-0.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold">
            <button
              type="button"
              onClick={() => setFilterOrientation('ALL')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
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
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
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
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
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
              <p className="text-xs font-medium">Aucune image dans cette catégorie</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredImages.map((img) => {
                const isLive = projectedImage?.id === img.id;
                const isPortrait = img.orientation === 'portrait';
                const isConfirmingDelete = confirmDeleteId === img.id;

                return (
                  <div
                    key={img.id}
                    className={`group relative bg-white dark:bg-zinc-800/90 rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col shadow-xs hover:shadow-md ${
                      isLive 
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-emerald-500/10' 
                        : 'border-slate-200 dark:border-zinc-700/80 hover:border-teal-500/60'
                    }`}
                  >
                    {/* Thumbnail View */}
                    <div 
                      onClick={() => handleToggleProject(img)}
                      className="relative aspect-video w-full bg-slate-100 dark:bg-zinc-900/90 cursor-pointer overflow-hidden flex items-center justify-center select-none"
                    >
                      {isPortrait ? (
                        <>
                          <img
                            src={img.url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover blur-md opacity-30 scale-125"
                          />
                          <img
                            src={img.url}
                            alt={img.name}
                            className="relative z-10 max-h-full max-w-full object-contain py-1 group-hover:scale-105 transition-transform duration-200"
                          />
                        </>
                      ) : (
                        <img
                          src={img.url}
                          alt={img.name}
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

                      {/* LIVE Badge */}
                      {isLive && (
                        <span className="absolute top-2 right-2 z-20 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500 text-white shadow-xs animate-pulse">
                          <Radio className="w-2.5 h-2.5" /> LIVE
                        </span>
                      )}
                    </div>

                    {/* Card Footer info & actions */}
                    <div className="p-2.5 bg-white dark:bg-zinc-800 flex items-center justify-between gap-1.5 border-t border-slate-100 dark:border-zinc-700/60">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate" title={img.name}>
                          {img.name}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1 bg-red-50 dark:bg-red-950/80 p-1 rounded-lg border border-red-200 dark:border-red-800">
                            <span className="text-[9px] font-bold text-red-600 dark:text-red-300">Supprimer ?</span>
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
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleProject(img);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                isLive
                                  ? 'bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                                  : 'bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                              }`}
                            >
                              <MonitorPlay className="w-3 h-3" />
                              <span>{isLive ? 'Arrêter' : 'Projeter'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setConfirmDeleteId(img.id);
                              }}
                              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/40"
                              title="Supprimer cette image"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
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
            <span className="font-semibold text-slate-700 dark:text-zinc-300">{mediaImages.length} image(s) au total</span>
            <span>•</span>
            <span>Cliquez sur une image pour la projeter directement</span>
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

