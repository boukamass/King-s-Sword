import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Song } from '../types';
import { saveSong, getSongById } from '../services/songService';
import { useAppStore } from '../store';
import { 
  Music, 
  X, 
  Save, 
  Eye, 
  Edit3, 
  Sparkles, 
  Loader2, 
  Plus, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  Layers,
  FileText,
  HelpCircle
} from 'lucide-react';

interface SongModalProps {
  isOpen: boolean;
  song?: Song | null;
  songToEdit?: Song | null;
  songId?: string | number | null;
  onClose: () => void;
  onSaved?: (savedSong: Song) => void;
  onSongSaved?: (savedSong: Song) => void;
}

// Helper to parse existing raw song content into chorus + couplets array
function parseSongContentToFields(rawContent: string, songTitle?: string): { chorus: string; couplets: string[] } {
  if (!rawContent || typeof rawContent !== 'string' || !rawContent.trim()) {
    return { chorus: '', couplets: [''] };
  }

  let text = rawContent.replace(/\r\n/g, '\n').trim();
  const normalizedTitle = songTitle ? songTitle.trim().toLowerCase() : '';

  // 1. Unify chorus headers that have blank lines after them (e.g. "Chœur:\n\nParoles...")
  text = text.replace(/(?:^|\n)[ \t]*(?:(?:couplet|strophe|verse)\s*\d*[ \t]*\n)?[ \t]*(ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?[ \t]*\n+/gim, '\nChœur:\n');

  // 2. Strip standalone stanza headers at the start of blocks
  text = text.replace(/^[ \t]*(?:couplet|strophe|verse)\s*\d*[ \t]*\n/gim, '');

  const rawBlocks = text.split(/\n\s*\n+/);

  let detectedChorus = '';
  const detectedCouplets: string[] = [];

  const chorusHeaderRegex = /^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?/i;

  for (let blockIdx = 0; blockIdx < rawBlocks.length; blockIdx++) {
    const rawBlock = rawBlocks[blockIdx].trim();
    if (!rawBlock) continue;

    const rawLines = rawBlock.split('\n').map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) continue;

    // Filter out title headers or duplicate title lines in the very first block
    let startIdx = 0;
    if (detectedCouplets.length === 0 && !detectedChorus) {
      if (normalizedTitle && rawLines[0].toLowerCase() === normalizedTitle) {
        startIdx++;
      }
      if (startIdx < rawLines.length) {
        const line = rawLines[startIdx];
        if (line === line.toUpperCase() && line.length >= 3 && !/^\d/.test(line)) {
          if (normalizedTitle && (line.toLowerCase() === normalizedTitle || normalizedTitle.includes(line.toLowerCase()))) {
            startIdx++;
          }
        }
      }
    }

    const lines = rawLines.slice(startIdx);
    if (lines.length === 0) continue;

    // Check if chorus block
    let isChorus = false;
    const chorusBodyLines: string[] = [];

    if (chorusHeaderRegex.test(lines[0])) {
      isChorus = true;
      const cleanFirstLine = lines[0].replace(/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?\s*/i, '').trim();
      if (cleanFirstLine) chorusBodyLines.push(cleanFirstLine);
      for (let i = 1; i < lines.length; i++) {
        chorusBodyLines.push(lines[i]);
      }
    } else {
      const match = lines[0].match(/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:\s*(.*)$/i);
      if (match) {
        isChorus = true;
        if (match[1].trim()) chorusBodyLines.push(match[1].trim());
        for (let i = 1; i < lines.length; i++) {
          chorusBodyLines.push(lines[i]);
        }
      }
    }

    if (isChorus) {
      const chorusText = chorusBodyLines.join('\n').trim();
      if (chorusText && !detectedChorus) {
        detectedChorus = chorusText;
      }
      continue;
    }

    // Process couplet lines
    const coupletLines: string[] = [];
    for (const line of lines) {
      if (/^(?:couplet|strophe|verse)\s*\d*$/i.test(line)) continue;
      if (/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?$/i.test(line)) continue;
      const cleanLine = line.replace(/^\d+[\s\.\-\)]+\s*/, '').trim();
      if (cleanLine) coupletLines.push(cleanLine);
    }

    const coupletBody = coupletLines.join('\n').trim();
    if (coupletBody) {
      if (detectedChorus && coupletBody.toLowerCase() === detectedChorus.toLowerCase()) {
        continue;
      }
      detectedCouplets.push(coupletBody);
    }
  }

  // Second pass: filter out any couplet matching detectedChorus
  let finalCouplets = detectedChorus 
    ? detectedCouplets.filter(c => c.toLowerCase() !== detectedChorus.toLowerCase())
    : detectedCouplets;

  // Clean title banner from first couplet if still present
  if (finalCouplets.length > 0 && normalizedTitle) {
    const firstLines = finalCouplets[0].split('\n');
    if (firstLines.length > 1) {
      const firstLineTrim = firstLines[0].trim();
      const firstLineLower = firstLineTrim.toLowerCase();
      if (firstLineLower === normalizedTitle || (firstLineTrim === firstLineTrim.toUpperCase() && firstLineTrim.length >= 3 && (normalizedTitle.includes(firstLineLower) || firstLineLower.includes(normalizedTitle)))) {
        finalCouplets[0] = firstLines.slice(1).join('\n').trim();
      }
    }
  }

  return {
    chorus: detectedChorus,
    couplets: finalCouplets.length > 0 ? finalCouplets : ['']
  };
}

// Helper to rebuild structured content into canonical formatted string
function buildFullSongContent(couplets: string[], chorus: string): string {
  const safeCouplets = Array.isArray(couplets) ? couplets : [];
  const cleanCouplets = safeCouplets.map(c => (typeof c === 'string' ? c.trim() : '')).filter(Boolean);
  const cleanChorus = typeof chorus === 'string' ? chorus.trim() : '';

  if (cleanCouplets.length === 0 && !cleanChorus) {
    return '';
  }

  if (!cleanChorus) {
    return cleanCouplets.map((c, i) => `Couplet ${i + 1}\n${c}`).join('\n\n');
  }

  const blocks: string[] = [];
  cleanCouplets.forEach((c, i) => {
    blocks.push(`Couplet ${i + 1}\n${c}`);
    blocks.push(`Chœur :\n${cleanChorus}`);
  });

  if (cleanCouplets.length === 0 && cleanChorus) {
    blocks.push(`Chœur :\n${cleanChorus}`);
  }

  return blocks.join('\n\n');
}

export const SongModal: React.FC<SongModalProps> = ({
  isOpen,
  song,
  songToEdit,
  songId,
  onClose,
  onSaved,
  onSongSaved
}) => {
  const [songNumber, setSongNumber] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [language, setLanguage] = useState<string>('fr');
  const [chorus, setChorus] = useState<string>('');
  const [couplets, setCouplets] = useState<string[]>(['']);
  
  // Modes & UI state
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [editMode, setEditMode] = useState<'structured' | 'raw'>('structured');
  const [rawText, setRawText] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const coupletsContainerRef = useRef<HTMLDivElement>(null);
  const backdropMouseDownTargetRef = useRef<EventTarget | null>(null);
  const addNotification = useAppStore(s => s.addNotification);

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    backdropMouseDownTargetRef.current = e.target;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && backdropMouseDownTargetRef.current === e.currentTarget) {
      onClose();
    }
  };

  const targetSong = song || songToEdit || null;

  useEffect(() => {
    let isMounted = true;

    const populateSongData = async () => {
      if (!isOpen) return;

      let fullSong: Song | null = targetSong;

      if (targetSong) {
        if ((!fullSong.content || fullSong.content.trim() === '') && fullSong.id) {
          setIsLoading(true);
          try {
            const fetched = await getSongById(fullSong.id);
            if (fetched && isMounted) {
              fullSong = fetched;
            }
          } catch (err) {
            console.error('Error fetching song by id:', err);
          } finally {
            if (isMounted) setIsLoading(false);
          }
        }
      } else if (songId) {
        setIsLoading(true);
        try {
          const fetched = await getSongById(songId);
          if (fetched && isMounted) {
            fullSong = fetched;
          }
        } catch (err) {
          console.error('Error fetching song by id:', err);
        } finally {
          if (isMounted) setIsLoading(false);
        }
      }

      if (isMounted) {
        if (fullSong) {
          setSongNumber(String(fullSong.id ?? ''));
          const cleanTitle = (fullSong.title || '').replace(/^\d+[\.\-\)]\s*/, '').trim();
          setTitle(cleanTitle || fullSong.title || '');
          setLanguage(fullSong.language || 'fr');

          const parsed = parseSongContentToFields(fullSong.content || '', cleanTitle || fullSong.title);
          setChorus(parsed.chorus);
          setCouplets(parsed.couplets);
          setRawText(fullSong.content || '');
        } else {
          setSongNumber('');
          setTitle('');
          setLanguage('fr');
          setChorus('');
          setCouplets(['']);
          setRawText('');
        }
        setEditMode('structured');
        setActiveTab('edit');
      }
    };

    populateSongData();

    return () => {
      isMounted = false;
    };
  }, [song, songToEdit, songId, isOpen]);

  if (!isOpen) return null;

  // Couplets operations
  const handleAddCouplet = () => {
    setCouplets(prev => [...prev, '']);
    setTimeout(() => {
      if (coupletsContainerRef.current) {
        coupletsContainerRef.current.scrollTop = coupletsContainerRef.current.scrollHeight;
      }
    }, 50);
  };

  const handleUpdateCouplet = (index: number, text: string) => {
    setCouplets(prev => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleRemoveCouplet = (index: number) => {
    if (couplets.length <= 1) {
      // Clear instead of removing last couplet
      setCouplets(['']);
      return;
    }
    setCouplets(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveCouplet = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= couplets.length) return;

    setCouplets(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  // Toggle between Structured and Raw mode
  const handleToggleEditMode = (newMode: 'structured' | 'raw') => {
    if (newMode === editMode) return;

    if (newMode === 'raw') {
      // Build raw from structured
      const built = buildFullSongContent(couplets, chorus);
      setRawText(built);
      setEditMode('raw');
    } else {
      // Parse structured from raw
      const parsed = parseSongContentToFields(rawText, title);
      setChorus(parsed.chorus);
      setCouplets(parsed.couplets);
      setEditMode('structured');
    }
  };

  // Form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      addNotification('Veuillez renseigner le titre du cantique', 'error');
      return;
    }

    let finalContent = '';
    if (editMode === 'raw') {
      finalContent = rawText.trim();
    } else {
      finalContent = buildFullSongContent(couplets, chorus).trim();
    }

    if (!finalContent) {
      addNotification('Veuillez renseigner au moins un couplet ou un refrain pour ce cantique', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const activeId = songNumber.trim() ? songNumber.trim() : (targetSong ? targetSong.id : undefined);
      const saved = await saveSong({
        id: activeId,
        title: title.trim(),
        content: finalContent,
        language: language.trim().toLowerCase()
      });

      addNotification(
        targetSong || songId ? 'Cantique modifié avec succès' : 'Nouveau cantique enregistré avec succès',
        'success'
      );

      const callback = onSaved || onSongSaved;
      if (callback) {
        callback(saved);
      }
      onClose();
    } catch (err: any) {
      console.error('Error saving song:', err);
      addNotification(`Erreur lors de l'enregistrement: ${err.message || err}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate live preview strophes
  const previewStanzas: { type: 'couplet' | 'chorus'; label: string; text: string }[] = [];
  if (editMode === 'raw') {
    const rawBlocks = rawText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    rawBlocks.forEach((block, idx) => {
      const isCh = /^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:/i.test(block);
      previewStanzas.push({
        type: isCh ? 'chorus' : 'couplet',
        label: isCh ? 'Refrain / Chœur' : `Strophe #${idx + 1}`,
        text: block.replace(/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:\s*/i, '').replace(/^couplet\s*\d*\s*/i, '')
      });
    });
  } else {
    const validCouplets = couplets.map(c => c.trim()).filter(Boolean);
    const cleanChorus = chorus.trim();

    if (validCouplets.length > 0) {
      validCouplets.forEach((c, idx) => {
        previewStanzas.push({
          type: 'couplet',
          label: `Couplet ${idx + 1}`,
          text: c
        });
        if (cleanChorus) {
          previewStanzas.push({
            type: 'chorus',
            label: 'Refrain (Chœur)',
            text: cleanChorus
          });
        }
      });
    } else if (cleanChorus) {
      previewStanzas.push({
        type: 'chorus',
        label: 'Refrain (Chœur)',
        text: cleanChorus
      });
    }
  }

  return createPortal(
    <div 
      className="fixed inset-0 z-[200000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-w-3xl w-full max-h-[92vh] animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600/10 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-600/20 shadow-xs shrink-0">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-zinc-900 dark:text-white">
                  {targetSong || songId ? `Modifier le Cantique #${songNumber || targetSong?.id || songId}` : 'Nouveau Cantique'}
                </h2>
                {isLoading && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600 dark:text-teal-400" />
                )}
              </div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                {isLoading ? 'Chargement des données du cantique...' : 'Formulaire de saisie par couplets & refrain'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab buttons */}
            <div className="flex items-center bg-slate-200/70 dark:bg-zinc-800 p-0.5 rounded-xl border border-slate-300/40 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all ${
                  activeTab === 'edit'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                Éditer
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all ${
                  activeTab === 'preview'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" />
                Aperçu ({previewStanzas.length})
              </button>
            </div>

            <button
              onClick={onClose}
              data-tooltip="Fermer"
              className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-5">
          {activeTab === 'edit' ? (
            <>
              {/* Top metadata grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Numéro du chant
                  </label>
                  <input
                    type="number"
                    value={songNumber}
                    onChange={e => setSongNumber(e.target.value)}
                    placeholder="Ex: 42 (Optionnel)"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Titre du cantique *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Ex: À la Croix aux pieds du Maître"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                  />
                </div>
              </div>

              {/* Language selection & mode switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Langue
                  </label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { code: 'fr', label: 'Français' },
                      { code: 'en', label: 'English' },
                      { code: 'ln', label: 'Lingala' },
                      { code: 'other', label: 'Autre' }
                    ].map(l => (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => setLanguage(l.code)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border whitespace-nowrap shrink-0 ${
                          language === l.code
                            ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                            : 'bg-slate-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-800 hover:border-teal-500/50'
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Switcher Formulaire / Texte brut */}
                <div className="sm:self-end shrink-0">
                  <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-800 shrink-0 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleToggleEditMode('structured')}
                      className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                        editMode === 'structured'
                          ? 'bg-white dark:bg-zinc-800 text-teal-600 dark:text-teal-400 shadow-2xs'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      <Layers className="w-3 h-3 shrink-0" />
                      <span className="whitespace-nowrap">Champs Couplets / Refrain</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleEditMode('raw')}
                      className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                        editMode === 'raw'
                          ? 'bg-white dark:bg-zinc-800 text-teal-600 dark:text-teal-400 shadow-2xs'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      <FileText className="w-3 h-3 shrink-0" />
                      <span className="whitespace-nowrap">Texte brut</span>
                    </button>
                  </div>
                </div>
              </div>

              {editMode === 'structured' ? (
                <div className="space-y-4">
                  {/* --- CHORUS / REFRAIN FIELD --- */}
                  <div className="p-4 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 dark:border-amber-500/25 space-y-2.5 transition-all">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-amber-500 text-white shadow-2xs flex items-center gap-1">
                          <Music className="w-2.5 h-2.5" />
                          Refrain (Chœur)
                        </span>
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300/80">
                          Optionnel
                        </span>
                      </div>
                      {chorus.trim() && (
                        <button
                          type="button"
                          onClick={() => setChorus('')}
                          data-tooltip="Effacer le refrain"
                          className="text-[9.5px] font-bold text-zinc-400 hover:text-red-500 transition-colors"
                        >
                          Effacer
                        </button>
                      )}
                    </div>
                    <p className="text-[10.5px] text-zinc-600 dark:text-zinc-400 font-medium">
                      Ce refrain sera automatiquement chanté et projeté après chaque couplet.
                    </p>
                    <textarea
                      rows={3}
                      value={chorus}
                      onChange={e => setChorus(e.target.value)}
                      placeholder={`Exemple :\nC’est mon histoire, c’est ma chanson\nLouant mon Sauveur le long du jour...`}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-950 border border-amber-500/30 dark:border-amber-500/30 rounded-xl font-serif text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all custom-scrollbar leading-relaxed"
                    />
                  </div>

                  {/* --- COUPLETS SECTION --- */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <label className="text-[10.5px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
                          Couplets / Strophes
                        </label>
                        <span className="px-2 py-0.5 rounded-full text-[9.5px] font-black bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                          {couplets.length} {couplets.length > 1 ? 'couplets' : 'couplet'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddCouplet}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-xs active:scale-95 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Ajouter un couplet
                      </button>
                    </div>

                    {/* Couplets list */}
                    <div ref={coupletsContainerRef} className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                      {couplets.map((couplet, index) => (
                        <div
                          key={index}
                          className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-950/80 border border-slate-200 dark:border-zinc-800 space-y-2.5 transition-all group hover:border-teal-500/40"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-teal-600 text-white shadow-2xs">
                                Couplet {index + 1}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Reordering */}
                              {couplets.length > 1 && (
                                <>
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => handleMoveCouplet(index, 'up')}
                                    data-tooltip="Déplacer vers le haut"
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                                  >
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === couplets.length - 1}
                                    onClick={() => handleMoveCouplet(index, 'down')}
                                    data-tooltip="Déplacer vers le bas"
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                                  >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}

                              {/* Delete couplet */}
                              <button
                                type="button"
                                onClick={() => handleRemoveCouplet(index)}
                                data-tooltip="Supprimer ce couplet"
                                data-tooltip-icon="trash"
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <textarea
                            rows={4}
                            value={couplet}
                            onChange={e => handleUpdateCouplet(index, e.target.value)}
                            placeholder={`Paroles du couplet ${index + 1}...\nEx:\nA la croix aux pieds du Maître\nA genoux, j’ai fait mon choix...`}
                            className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl font-serif text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all custom-scrollbar leading-relaxed"
                          />
                        </div>
                      ))}

                      {/* Prominent bottom Add Couplet button */}
                      <button
                        type="button"
                        onClick={handleAddCouplet}
                        className="w-full py-3.5 rounded-2xl border-2 border-dashed border-teal-500/30 dark:border-teal-500/20 hover:border-teal-500 bg-teal-50/40 hover:bg-teal-50/80 dark:bg-teal-950/20 dark:hover:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer group"
                      >
                        <div className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Plus className="w-3.5 h-3.5" />
                        </div>
                        <span>Ajouter le couplet {couplets.length + 1}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* --- RAW TEXT FALLBACK --- */
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                      Paroles Complètes (Mode Texte Brut)
                    </label>
                    <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400">
                      Séparez chaque couplet ou refrain par une ligne vide
                    </span>
                  </div>
                  <textarea
                    rows={12}
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                    placeholder={`Couplet 1\nA la croix aux pieds du Maître\nA genoux, j’ai fait mon choix...\n\nChœur:\nC’est mon histoire, c’est ma chanson\nLouant mon Sauveur le long du jour...\n\nCouplet 2\n...`}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl font-serif text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all custom-scrollbar leading-relaxed"
                  />
                </div>
              )}
            </>
          ) : (
            /* --- PREVIEW TAB --- */
            <div className="space-y-3">
              <div className="p-3 bg-teal-50/50 dark:bg-teal-950/20 border border-teal-200/50 dark:border-teal-800/40 rounded-2xl flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                <p className="text-[11px] font-bold text-teal-800 dark:text-teal-300">
                  Voici comment chaque strophe et refrain apparaîtra dans le lecteur et lors de la projection sur grand écran :
                </p>
              </div>

              {previewStanzas.length === 0 ? (
                <div className="text-center py-12 text-zinc-400 text-xs font-bold">
                  Aucun couplet ou refrain saisi pour le moment.
                </div>
              ) : (
                <div className="space-y-3 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                  {previewStanzas.map((stanza, idx) => (
                    <div 
                      key={idx}
                      className={`p-4 rounded-2xl border transition-all ${
                        stanza.type === 'chorus'
                          ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300/60 dark:border-amber-700/50'
                          : 'bg-slate-50 dark:bg-zinc-950 border-slate-200 dark:border-zinc-800/80'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span 
                          className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-md border ${
                            stanza.type === 'chorus'
                              ? 'text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-900/50 border-amber-300 dark:border-amber-700'
                              : 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/50 border-teal-200/60 dark:border-teal-800/40'
                          }`}
                        >
                          {stanza.label}
                        </span>
                        <span className="text-[9px] font-bold text-zinc-400">
                          Écran #{idx + 1}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap font-serif text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
                        {stanza.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-zinc-800/80 flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold text-zinc-400 hidden sm:block">
              {couplets.filter(c => c.trim()).length} couplet(s) {chorus.trim() ? '+ 1 refrain' : ''}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-teal-600/30 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Enregistrement...' : 'Enregistrer le cantique'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default SongModal;

