import React, { useState, useMemo, memo, useRef } from 'react';
import { useAppStore, sortNotesByRecency } from '../store';
import { translations } from '../translations';
import { Note, Citation } from '../types';
import { normalizeText } from '../utils/textUtils';
import { stripMarkdown } from '../utils/noteFormatter';
import { 
  Plus, 
  X, 
  Search, 
  Trash2, 
  Clock,
  NotebookPen,
  FileText,
  GripVertical,
  Pencil,
  Hash,
  Download,
  Upload,
  CheckCircle2,
  Tag,
  Folder,
  Layers,
  List,
  ChevronDown,
  ChevronRight,
  Palette,
  Check
} from 'lucide-react';

export const PALETTE_COLORS: { name: string; key: string; bg: string; border: string; ring: string; badgeBg: string; text: string; }[] = [
  { name: 'Défaut', key: 'default', bg: 'bg-zinc-100 dark:bg-zinc-800/60', border: 'border-zinc-200 dark:border-zinc-700/60', ring: 'ring-zinc-400', badgeBg: 'bg-zinc-200/80 dark:bg-zinc-700/80', text: 'text-zinc-700 dark:text-zinc-300' },
  { name: 'Sarcelle Royale', key: 'sky', bg: 'bg-teal-600/5 dark:bg-teal-600/10', border: 'border-teal-600/20 dark:border-teal-600/30', ring: 'ring-teal-600', badgeBg: 'bg-teal-600/15 dark:bg-teal-600/25', text: 'text-teal-800 dark:text-teal-300' },
  { name: 'Menthe', key: 'teal', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800/30', ring: 'ring-emerald-400', badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300' },
  { name: 'Ambre', key: 'amber', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800/30', ring: 'ring-amber-400', badgeBg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300' },
  { name: 'Rose', key: 'rose', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800/30', ring: 'ring-rose-400', badgeBg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300' },
  { name: 'Violet', key: 'violet', bg: 'bg-violet-50 dark:bg-violet-900/20', border: 'border-violet-200 dark:border-violet-800/30', ring: 'ring-violet-400', badgeBg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-800 dark:text-violet-300' },
];

export const PRESET_THEMES = [
  'Général',
  'Doctrine & Théologie',
  'Exégèse & Sermons',
  'Prophétie & Fin des Temps',
  'Foi & Prière',
  'Études Personnelles'
];

interface NoteCardProps {
  n: Note;
  onSelect: () => void;
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateColor: (id: string, color: string | undefined) => void;
  onUpdateTheme: (id: string, theme: string | undefined) => void;
  isEditingTitle: boolean;
  setEditingNoteId: (id: string | null) => void;
  dragHandlers: any;
  allThemes: string[];
}

const NoteCard = memo(({ 
  n, 
  onSelect, 
  onDelete, 
  onUpdateTitle, 
  onUpdateColor,
  onUpdateTheme,
  isEditingTitle,
  setEditingNoteId,
  dragHandlers,
  allThemes
}: NoteCardProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const [customThemeInput, setCustomThemeInput] = useState('');
  const [isAddingCustomTheme, setIsAddingCustomTheme] = useState(false);

  const color = PALETTE_COLORS.find(c => c.key === n.color) || PALETTE_COLORS[0];
  const themeName = n.theme || 'Général';

  // Preview content snippet
  const snippet = useMemo(() => {
    if (n.content && n.content.trim()) {
      return stripMarkdown(n.content).trim();
    }
    if (n.citations && n.citations.length > 0) {
      return stripMarkdown(n.citations[0].quoted_text || '').trim();
    }
    return '';
  }, [n.content, n.citations]);

  const handleApplyTheme = (selectedTheme: string) => {
    onUpdateTheme(n.id, selectedTheme === 'Général' ? undefined : selectedTheme);
    setShowPicker(false);
    setIsAddingCustomTheme(false);
  };

  const handleCreateCustomTheme = (e: React.FormEvent) => {
    e.preventDefault();
    if (customThemeInput.trim()) {
      onUpdateTheme(n.id, customThemeInput.trim());
      setCustomThemeInput('');
      setIsAddingCustomTheme(false);
      setShowPicker(false);
    }
  };

  return (
    <div 
      {...dragHandlers}
      onClick={onSelect} 
      className={`group w-full p-2.5 px-3 rounded-xl ${color.bg} border ${color.border} transition-all duration-200 hover:shadow-md hover:border-teal-600/50 cursor-pointer relative mb-1.5 overflow-visible`}
    >
      {/* Header Row: Handle + Theme Badge + Title + Quick Actions */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
          
          {/* Theme & Color Badge button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowPicker(!showPicker);
            }}
            data-tooltip="Thème & Couleur"
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] font-bold rounded-md ${color.badgeBg} ${color.text} hover:opacity-90 transition-all shrink-0 border border-black/5 dark:border-white/10`}
          >
            <Tag className="w-2.5 h-2.5" />
            <span className="truncate max-w-[80px]">{themeName}</span>
          </button>

          {/* Title or Title Input */}
          {isEditingTitle ? (
            <input
              type="text"
              value={n.title}
              autoFocus
              onClick={e => e.stopPropagation()}
              onChange={e => onUpdateTitle(n.id, e.target.value)}
              onBlur={() => setEditingNoteId(null)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  setEditingNoteId(null);
                }
              }}
              className="w-full text-xs font-bold text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800 p-0.5 px-1.5 border border-teal-600 rounded focus:outline-none"
            />
          ) : (
            <div
              onClick={(e) => { e.stopPropagation(); setEditingNoteId(n.id); }}
              data-tooltip="Cliquer pour modifier"
              className="flex items-center gap-1 flex-1 min-w-0 cursor-text"
            >
              <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate tracking-tight group-hover:text-teal-600 transition-colors">
                {n.title || 'Sans titre'}
              </h3>
              <Pencil className="w-2.5 h-2.5 text-zinc-400 dark:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
          )}
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            data-tooltip="Organiser (Thème / Couleur)" 
            onClick={e => { e.stopPropagation(); setShowPicker(!showPicker); }} 
            className="p-1 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 rounded text-zinc-400 hover:text-teal-600 transition-all"
          >
            <Palette className="w-3 h-3" />
          </button>
          <button 
            data-tooltip="Supprimer" 
            data-tooltip-icon="trash" 
            onClick={e => { e.stopPropagation(); onDelete(n.id); }} 
            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded text-zinc-400 hover:text-red-500 transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Snippet Row: 1-line truncated content preview */}
      {snippet && (
        <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate mt-1 pl-5 font-normal leading-tight">
          {snippet}
        </p>
      )}

      {/* Footer Info Row */}
      <div className="flex items-center justify-between pl-5 mt-1.5 pt-1 border-t border-zinc-200/40 dark:border-zinc-800/40 text-[9px] text-zinc-400 font-medium">
        <div className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5 text-zinc-400" /> 
          <span>{new Date(n.creationDate || n.date).toLocaleDateString()}</span>
        </div>

        {n.citations && n.citations.length > 0 && (
          <div className="flex items-center gap-1 text-[8.5px] font-semibold text-teal-700 dark:text-teal-300 bg-teal-600/10 px-1.5 py-0.2 rounded-md border border-teal-600/20">
            <FileText className="w-2.5 h-2.5" />
            <span>{n.citations.length} {n.citations.length > 1 ? 'extraits' : 'extrait'}</span>
          </div>
        )}
      </div>

      {/* Popover Theme & Color Selector */}
      {showPicker && (
        <div 
          onClick={e => e.stopPropagation()}
          className="absolute left-2 right-2 top-full mt-1 z-50 p-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl text-xs space-y-2 animate-in fade-in zoom-in-95"
        >
          <div className="flex items-center justify-between pb-1 border-b border-zinc-100 dark:border-zinc-700">
            <span className="font-bold text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
              <Folder className="w-3 h-3 text-teal-600" /> Assigner un Thème
            </span>
            <button 
              onClick={() => setShowPicker(false)}
              className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Theme selection buttons */}
          <div className="max-h-36 overflow-y-auto space-y-0.5 custom-scrollbar pr-1">
            {allThemes.map((th) => (
              <button
                key={th}
                onClick={() => handleApplyTheme(th)}
                className={`w-full text-left px-2 py-1 rounded-lg text-[11px] font-medium flex items-center justify-between transition-colors ${
                  themeName === th
                    ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 font-bold'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="truncate">{th}</span>
                {themeName === th && <Check className="w-3 h-3 text-teal-600 shrink-0" />}
              </button>
            ))}
          </div>

          {/* Custom Theme Input */}
          {!isAddingCustomTheme ? (
            <button
              onClick={() => setIsAddingCustomTheme(true)}
              className="w-full text-center py-1 text-[10px] font-bold text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 rounded-lg border border-dashed border-teal-600/30 transition-all"
            >
              + Nouveau Thème Personnalisé
            </button>
          ) : (
            <form onSubmit={handleCreateCustomTheme} className="flex gap-1">
              <input
                type="text"
                placeholder="Nom du thème..."
                autoFocus
                value={customThemeInput}
                onChange={e => setCustomThemeInput(e.target.value)}
                className="flex-1 px-2 py-0.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded text-[10.5px] outline-none focus:border-teal-600"
              />
              <button 
                type="submit"
                className="px-2 py-0.5 bg-teal-600 text-white rounded text-[10px] font-bold"
              >
                OK
              </button>
            </form>
          )}

          {/* Color Palette Selector */}
          <div className="pt-1.5 border-t border-zinc-100 dark:border-zinc-700">
            <span className="font-bold text-[9.5px] uppercase tracking-wider text-zinc-400 block mb-1">
              Couleur d'accentuation
            </span>
            <div className="flex items-center gap-1.5">
              {PALETTE_COLORS.map(c => (
                <button 
                  key={c.key} 
                  type="button"
                  title={c.name}
                  onClick={() => onUpdateColor(n.id, c.key === 'default' ? undefined : c.key)} 
                  className={`w-4 h-4 rounded-full ${c.bg} border ${c.border} transition-all ${
                    (n.color || 'default') === c.key 
                      ? `ring-2 ring-offset-1 dark:ring-offset-zinc-800 ${c.ring}`
                      : 'hover:scale-110'
                  }`} 
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const NotesPanel: React.FC = () => {
  const { 
    notes, 
    addNote, 
    updateNote, 
    deleteNote, 
    reorderNotes, 
    languageFilter, 
    toggleNotes, 
    setActiveNoteId,
    setSelectedSermonId,
    setJumpToParagraph,
    setJumpToText,
    setNavigatedFromNoteId
  } = useAppStore();
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedThemeFilter, setSelectedThemeFilter] = useState<string>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');
  const [collapsedThemes, setCollapsedThemes] = useState<Record<string, boolean>>({});

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);

  // Derive all available themes dynamically (preset + user themes)
  const allThemes = useMemo(() => {
    const customSet = new Set<string>(PRESET_THEMES);
    notes.forEach(n => {
      if (n.theme && n.theme.trim()) {
        customSet.add(n.theme.trim());
      }
    });
    return Array.from(customSet);
  }, [notes]);

  // Compute theme note counts
  const themeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: notes.length };
    allThemes.forEach(th => { counts[th] = 0; });
    
    notes.forEach(n => {
      const th = n.theme || 'Général';
      counts[th] = (counts[th] || 0) + 1;
    });

    return counts;
  }, [notes, allThemes]);

  // Filter notes based on search query and theme filter
  const filteredNotes = useMemo(() => {
    const sorted = sortNotesByRecency(notes);
    
    return sorted.filter(n => {
      // Theme filter
      const noteTheme = n.theme || 'Général';
      if (selectedThemeFilter !== 'all' && noteTheme !== selectedThemeFilter) {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = normalizeText(searchQuery);
      const titleNorm = normalizeText(n.title || '');
      const contentNorm = normalizeText(n.content || '');
      const themeNorm = normalizeText(noteTheme);
      const citationsNorm = n.citations ? normalizeText(n.citations.map(c => c.quoted_text || '').join(' ')) : '';
      return titleNorm.includes(q) || contentNorm.includes(q) || citationsNorm.includes(q) || themeNorm.includes(q);
    });
  }, [notes, searchQuery, selectedThemeFilter]);

  // Grouped notes by theme for 'grouped' view
  const groupedNotes = useMemo(() => {
    const groups: Record<string, Note[]> = {};
    filteredNotes.forEach(n => {
      const th = n.theme || 'Général';
      if (!groups[th]) groups[th] = [];
      groups[th].push(n);
    });
    return groups;
  }, [filteredNotes]);

  const toggleCollapseTheme = (themeName: string) => {
    setCollapsedThemes(prev => ({ ...prev, [themeName]: !prev[themeName] }));
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedId !== id) {
      setDragOverId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, dropTargetId: string) => {
    e.preventDefault();
    const draggedNoteId = e.dataTransfer.getData('text/plain');
    if (draggedNoteId && draggedNoteId !== dropTargetId) {
      reorderNotes(draggedNoteId, dropTargetId);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleExportBackup = async () => {
    try {
      let backupPayload: any = null;
      if (window.electronAPI?.db?.exportBackup) {
        const res = await window.electronAPI.db.exportBackup();
        if (res.success && res.backup) {
          backupPayload = res.backup;
        }
      }

      if (!backupPayload) {
        backupPayload = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          appName: "L'Épée du Roi",
          data: {
            notes: notes,
            songs: [],
            kv: []
          }
        };
      }

      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `epee-du-roi-sauvegarde-${dateStr}.ksbackup`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupSuccess("Sauvegarde exportée avec succès !");
      setTimeout(() => setBackupSuccess(null), 3000);
    } catch (e: any) {
      console.error("Erreur export sauvegarde:", e);
    }
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (window.electronAPI?.db?.importBackup) {
        const res = await window.electronAPI.db.importBackup(parsed);
        if (res.success) {
          useAppStore.getState().initializeDB();
          setBackupSuccess(`${res.importedNotes || 0} notes restaurées avec succès !`);
          setTimeout(() => setBackupSuccess(null), 3000);
        }
      } else if (parsed?.data?.notes && Array.isArray(parsed.data.notes)) {
        for (const n of parsed.data.notes) {
          addNote(n);
        }
        setBackupSuccess("Notes importées avec succès !");
        setTimeout(() => setBackupSuccess(null), 3000);
      }
    } catch (err: any) {
      console.error("Erreur import sauvegarde:", err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateNewNote = () => {
    const initialTheme = selectedThemeFilter !== 'all' ? selectedThemeFilter : 'Général';
    addNote({ 
      title: "Nouvelle Note", 
      content: "", 
      citations: [],
      theme: initialTheme !== 'Général' ? initialTheme : undefined
    });
  };

  return (
    <div className="w-full border-l border-zinc-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 h-full flex flex-col overflow-hidden select-none">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImportFileSelected} 
        accept=".json,.ksbackup" 
        className="hidden" 
      />

      {/* Header bar */}
      <div className="px-3.5 h-13 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md z-40">
        <button 
          onClick={toggleNotes}
          className="flex items-center gap-2.5 group"
          data-tooltip={t.tooltip_close}
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-xs group-hover:bg-teal-600 group-hover:text-white transition-all">
            <NotebookPen className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-[11px] font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 group-hover:text-teal-600 transition-colors">
            {t.reader_notes}
          </h2>
        </button>

        <div className="flex items-center gap-1">
          <button 
            data-tooltip="Sauvegarder / Exporter les notes" 
            onClick={handleExportBackup} 
            className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-teal-600 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-all active:scale-90"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button 
            data-tooltip="Restaurer une sauvegarde" 
            onClick={() => fileInputRef.current?.click()} 
            className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-teal-600 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-all active:scale-90"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button 
            data-tooltip="Nouvelle note" 
            onClick={handleCreateNewNote} 
            className="w-7 h-7 flex items-center justify-center bg-teal-600 text-white rounded-lg shadow-xs hover:bg-teal-700 transition-all active:scale-90"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button 
            data-tooltip={t.tooltip_close} 
            onClick={toggleNotes} 
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {backupSuccess && (
        <div className="mx-3 mt-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium text-[11px]">{backupSuccess}</span>
        </div>
      )}

      {/* Search Bar & View Mode Toggle */}
      <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 space-y-2 z-20">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder={t.search_note_placeholder || "Rechercher dans les notes..."} 
              className="w-full pl-8 pr-7 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600 outline-none transition-all shadow-2xs" 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
            />
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-zinc-400" />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* View Mode Toggle Button */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 shrink-0">
            <button
              onClick={() => setViewMode('list')}
              data-tooltip="Vue Liste Compacte"
              className={`p-1 rounded-md text-xs transition-all ${
                viewMode === 'list' 
                  ? 'bg-white dark:bg-zinc-700 text-teal-600 dark:text-teal-400 shadow-2xs font-bold' 
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              data-tooltip="Groupé par Thème"
              className={`p-1 rounded-md text-xs transition-all ${
                viewMode === 'grouped' 
                  ? 'bg-white dark:bg-zinc-700 text-teal-600 dark:text-teal-400 shadow-2xs font-bold' 
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              <Folder className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Theme Pills / Filter Bar */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar text-[10.5px]">
          <button
            onClick={() => setSelectedThemeFilter('all')}
            className={`px-2 py-0.5 rounded-md font-bold whitespace-nowrap transition-all border shrink-0 ${
              selectedThemeFilter === 'all'
                ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-teal-500/40'
            }`}
          >
            Tous ({themeCounts.all})
          </button>

          {allThemes.map(th => {
            const count = themeCounts[th] || 0;
            if (count === 0 && selectedThemeFilter !== th) return null;

            return (
              <button
                key={th}
                onClick={() => setSelectedThemeFilter(th)}
                className={`px-2 py-0.5 rounded-md font-medium whitespace-nowrap transition-all border shrink-0 flex items-center gap-1 ${
                  selectedThemeFilter === th
                    ? 'bg-teal-600 text-white border-teal-600 font-bold shadow-2xs'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-teal-500/40'
                }`}
              >
                <span>{th}</span>
                <span className={`text-[9px] px-1 py-0.2 rounded-full ${
                  selectedThemeFilter === th ? 'bg-white/20 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area: List or Grouped View */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1 custom-scrollbar bg-slate-50/50 dark:bg-zinc-950/20">
        {filteredNotes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-40">
            <Folder className="w-12 h-12 stroke-1 text-zinc-400 dark:text-zinc-500" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {searchQuery || selectedThemeFilter !== 'all' ? 'Aucune note correspondante' : (t.no_notes_yet || 'Aucune note')}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          /* Compact Flat List View */
          filteredNotes.map(n => {
            const isTargeted = dragOverId === n.id;
            
            return (
              <React.Fragment key={n.id}>
                {isTargeted && (
                  <div className="h-1 w-full bg-teal-600 rounded-full shadow-[0_0_8px_rgba(13,148,136,0.8)] duration-200 my-1" />
                )}
                
                <NoteCard 
                  n={n}
                  onSelect={() => setActiveNoteId(n.id)}
                  onDelete={deleteNote}
                  onUpdateTitle={(id, title) => updateNote(id, { title })}
                  onUpdateColor={(id, color) => updateNote(id, { color })}
                  onUpdateTheme={(id, theme) => updateNote(id, { theme })}
                  isEditingTitle={editingNoteId === n.id}
                  setEditingNoteId={setEditingNoteId}
                  allThemes={allThemes}
                  dragHandlers={{
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => handleDragStart(e, n.id),
                    onDragOver: (e: React.DragEvent) => handleDragOver(e, n.id),
                    onDrop: (e: React.DragEvent) => handleDrop(e, n.id),
                    onDragEnd: handleDragEnd
                  }}
                />
              </React.Fragment>
            );
          })
        ) : (
          /* Grouped Accordion View by Theme */
          Object.keys(groupedNotes).map(themeName => {
            const groupNotesList = groupedNotes[themeName];
            const isCollapsed = collapsedThemes[themeName];

            return (
              <div key={themeName} className="mb-2">
                {/* Accordion Theme Header */}
                <button
                  onClick={() => toggleCollapseTheme(themeName)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 bg-zinc-200/60 dark:bg-zinc-800/60 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-xs font-bold text-zinc-800 dark:text-zinc-200 transition-all mb-1"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-teal-600" />}
                    <Folder className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    <span>{themeName}</span>
                  </div>
                  <span className="text-[9.5px] px-1.5 py-0.2 bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 rounded-full font-bold border border-black/5 dark:border-white/5">
                    {groupNotesList.length}
                  </span>
                </button>

                {/* Group Notes List */}
                {!isCollapsed && (
                  <div className="pl-1 space-y-1">
                    {groupNotesList.map(n => (
                      <NoteCard 
                        key={n.id}
                        n={n}
                        onSelect={() => setActiveNoteId(n.id)}
                        onDelete={deleteNote}
                        onUpdateTitle={(id, title) => updateNote(id, { title })}
                        onUpdateColor={(id, color) => updateNote(id, { color })}
                        onUpdateTheme={(id, theme) => updateNote(id, { theme })}
                        isEditingTitle={editingNoteId === n.id}
                        setEditingNoteId={setEditingNoteId}
                        allThemes={allThemes}
                        dragHandlers={{
                          draggable: true,
                          onDragStart: (e: React.DragEvent) => handleDragStart(e, n.id),
                          onDragOver: (e: React.DragEvent) => handleDragOver(e, n.id),
                          onDrop: (e: React.DragEvent) => handleDrop(e, n.id),
                          onDragEnd: handleDragEnd
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default NotesPanel;