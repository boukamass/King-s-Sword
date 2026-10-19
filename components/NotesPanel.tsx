import React, { useState, useMemo, memo, useRef, useEffect } from 'react';
import { useAppStore, sortNotesByRecency } from '../store';
import { translations } from '../translations';
import { Note } from '../types';
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
  List,
  ChevronDown,
  ChevronRight,
  Palette,
  Check,
  FolderPlus,
  FolderKanban,
  Edit3,
  Undo2
} from 'lucide-react';
import { PRESET_THEMES, getAllNoteThemes, addCustomTheme, getUserCustomThemes, saveUserCustomThemes } from '../utils/themeUtils';

export const PALETTE_COLORS: { name: string; key: string; bg: string; border: string; ring: string; badgeBg: string; text: string; }[] = [
  { name: 'Défaut', key: 'default', bg: 'bg-zinc-100 dark:bg-zinc-800/60', border: 'border-zinc-200 dark:border-zinc-700/60', ring: 'ring-zinc-400', badgeBg: 'bg-zinc-200/80 dark:bg-zinc-700/80', text: 'text-zinc-700 dark:text-zinc-300' },
  { name: 'Sarcelle Royale', key: 'sky', bg: 'bg-teal-600/5 dark:bg-teal-600/10', border: 'border-teal-600/20 dark:border-teal-600/30', ring: 'ring-teal-600', badgeBg: 'bg-teal-600/15 dark:bg-teal-600/25', text: 'text-teal-800 dark:text-teal-300' },
  { name: 'Menthe', key: 'teal', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800/30', ring: 'ring-emerald-400', badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300' },
  { name: 'Ambre', key: 'amber', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800/30', ring: 'ring-amber-400', badgeBg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300' },
  { name: 'Rose', key: 'rose', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800/30', ring: 'ring-rose-400', badgeBg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300' },
  { name: 'Violet', key: 'violet', bg: 'bg-violet-50 dark:bg-violet-900/20', border: 'border-violet-200 dark:border-violet-800/30', ring: 'ring-violet-400', badgeBg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-800 dark:text-violet-300' },
];

export { PRESET_THEMES };


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
  onAddNewCustomTheme?: (name: string) => void;
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
  allThemes,
  onAddNewCustomTheme
}: NoteCardProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const [customThemeInput, setCustomThemeInput] = useState('');
  const [isAddingCustomTheme, setIsAddingCustomTheme] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setIsAddingCustomTheme(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showPicker]);

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
      const newTh = customThemeInput.trim();
      if (onAddNewCustomTheme) onAddNewCustomTheme(newTh);
      onUpdateTheme(n.id, newTh);
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
            <span className="truncate max-w-[90px]">{themeName}</span>
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
          ref={pickerRef}
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
    addNotification
  } = useAppStore();
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedThemeFilter, setSelectedThemeFilter] = useState<string>(() => {
    try {
      return localStorage.getItem('kings_sword_selected_theme_filter') || 'all';
    } catch {
      return 'all';
    }
  });
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>(() => {
    try {
      return (localStorage.getItem('kings_sword_notes_view_mode') as 'list' | 'grouped') || 'list';
    } catch {
      return 'list';
    }
  });
  const [collapsedThemes, setCollapsedThemes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      localStorage.setItem('kings_sword_selected_theme_filter', selectedThemeFilter);
    } catch {}
  }, [selectedThemeFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('kings_sword_notes_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverTheme, setDragOverTheme] = useState<string | null>(null);

  const [showThemeManager, setShowThemeManager] = useState(false);
  const [showNewThemeInput, setShowNewThemeInput] = useState(false);
  const [newThemeName, setNewThemeName] = useState('');
  const [editingThemeOldName, setEditingThemeOldName] = useState<string | null>(null);
  const [editingThemeNewName, setEditingThemeNewName] = useState('');

  const [userCustomThemes, setUserCustomThemes] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('kings_sword_user_themes');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const [searchThemeQuery, setSearchThemeQuery] = useState('');
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);

  // Fermeture automatique du sélecteur déroulant des thèmes au clic extérieur ou touche Échap
  useEffect(() => {
    if (!isThemeDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setIsThemeDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsThemeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isThemeDropdownOpen]);

  const saveCustomThemesToStorage = (updated: string[]) => {
    setUserCustomThemes(updated);
    try {
      localStorage.setItem('kings_sword_user_themes', JSON.stringify(updated));
    } catch (e) {
      console.error("Could not save themes to localStorage:", e);
    }
  };

  // Combine PRESET_THEMES + userCustomThemes + note themes
  const allThemes = useMemo(() => {
    const customSet = new Set<string>(PRESET_THEMES);
    userCustomThemes.forEach(th => th && th.trim() && customSet.add(th.trim()));
    notes.forEach(n => {
      if (n.theme && n.theme.trim()) {
        customSet.add(n.theme.trim());
      }
    });
    return Array.from(customSet);
  }, [notes, userCustomThemes]);

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

  const handleAddCustomTheme = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!allThemes.includes(trimmed)) {
      const updated = [...userCustomThemes, trimmed];
      saveCustomThemesToStorage(updated);
    }
    setSelectedThemeFilter(trimmed);
    addNotification(`Thème "${trimmed}" créé avec succès !`, 'success');
  };

  const handleRenameTheme = (oldName: string, newName: string) => {
    const trimmedNew = newName.trim();
    if (!trimmedNew || trimmedNew === oldName) {
      setEditingThemeOldName(null);
      return;
    }

    // 1. Update user custom themes list
    const updatedCustom = userCustomThemes.map(t => t === oldName ? trimmedNew : t);
    if (!updatedCustom.includes(trimmedNew) && !PRESET_THEMES.includes(trimmedNew)) {
      updatedCustom.push(trimmedNew);
    }
    saveCustomThemesToStorage(updatedCustom);

    // 2. Update note theme for all affected notes
    let updatedCount = 0;
    notes.forEach(n => {
      const currentTheme = n.theme || 'Général';
      if (currentTheme === oldName) {
        updateNote(n.id, { theme: trimmedNew === 'Général' ? undefined : trimmedNew });
        updatedCount++;
      }
    });

    // 3. Update filter selection if needed
    if (selectedThemeFilter === oldName) {
      setSelectedThemeFilter(trimmedNew);
    }

    setEditingThemeOldName(null);
    setEditingThemeNewName('');
    addNotification(`Thème renommé en "${trimmedNew}" (${updatedCount} note${updatedCount > 1 ? 's' : ''} mise${updatedCount > 1 ? 's' : ''} à jour).`, 'success');
  };

  const handleDeleteTheme = (themeName: string) => {
    if (themeName === 'Général') {
      addNotification('Le thème par défaut "Général" ne peut pas être supprimé.', 'info');
      return;
    }

    const count = themeCounts[themeName] || 0;
    if (!confirm(`Supprimer le thème "${themeName}" ?\n${count > 0 ? `Les ${count} note(s) appartenant à ce thème seront reclassées dans "Général".` : ''}`)) {
      return;
    }

    // 1. Remove from user custom themes
    const updatedCustom = userCustomThemes.filter(t => t !== themeName);
    saveCustomThemesToStorage(updatedCustom);

    // 2. Reassign notes to Général (undefined)
    let reassignedCount = 0;
    notes.forEach(n => {
      if ((n.theme || 'Général') === themeName) {
        updateNote(n.id, { theme: undefined });
        reassignedCount++;
      }
    });

    // 3. Reset filter if it was active
    if (selectedThemeFilter === themeName) {
      setSelectedThemeFilter('all');
    }

    addNotification(`Thème "${themeName}" supprimé.${reassignedCount > 0 ? ` ${reassignedCount} note(s) réaffectée(s) à Général.` : ''}`, 'success');
  };

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
    const draggedNoteId = e.dataTransfer.getData('text/plain') || draggedId;
    if (draggedNoteId && draggedNoteId !== dropTargetId) {
      reorderNotes(draggedNoteId, dropTargetId);
    }
    setDraggedId(null);
    setDragOverId(null);
    setDragOverTheme(null);
  };

  const handleDropOnTheme = (e: React.DragEvent, targetTheme: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTheme(null);
    setDragOverId(null);
    const noteId = e.dataTransfer.getData('text/plain') || draggedId;
    if (noteId) {
      const targetVal = targetTheme === 'Général' ? undefined : targetTheme;
      updateNote(noteId, { theme: targetVal });
      addNotification(`Note déplacée vers le thème "${targetTheme}"`, 'success');
    }
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
    setDragOverTheme(null);
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

  const handleCreateNewNote = (assignedTheme?: string) => {
    const initialTheme = assignedTheme || (selectedThemeFilter !== 'all' ? selectedThemeFilter : 'Général');
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

      {/* Header bar identique en tout point à l'assistant IA */}
      <div className="px-5 h-14 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-3xl z-30">
        <div 
          onClick={toggleNotes}
          className="flex items-center gap-3 cursor-pointer group/notes-title hover:opacity-80 transition-all active:scale-95"
          data-tooltip="Masquer / Fermer le journal de notes"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-lg group-hover/notes-title:border-teal-600/40 transition-all">
            <NotebookPen className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-zinc-50 leading-none group-hover/notes-title:text-teal-600 transition-colors">
              {t.reader_notes || "JOURNAL DE NOTES"}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
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
            onClick={() => handleCreateNewNote()} 
            className="w-7 h-7 flex items-center justify-center bg-teal-600 text-white rounded-lg shadow-xs hover:bg-teal-700 transition-all active:scale-90"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={toggleNotes} 
            data-tooltip="Fermer le journal de notes" 
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {backupSuccess && (
        <div className="mx-3 mt-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium text-[11px]">{backupSuccess}</span>
        </div>
      )}

      {/* Modal / Panel de Gestion des Thèmes */}
      {showThemeManager && (
        <div className="p-3 bg-white dark:bg-zinc-850 border-b border-zinc-200 dark:border-zinc-700 shadow-md animate-in fade-in slide-in-from-top-2 space-y-2.5 z-30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-teal-700 dark:text-teal-400">
              <FolderKanban className="w-4 h-4" />
              <span>Gestionnaire des Thèmes</span>
            </div>
            <button 
              onClick={() => setShowThemeManager(false)}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Formulaire d'ajout rapide de thème */}
          <div className="flex gap-1.5">
            <input 
              type="text"
              placeholder="Nom du nouveau thème..."
              value={newThemeName}
              onChange={e => setNewThemeName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newThemeName.trim()) {
                  handleAddCustomTheme(newThemeName);
                  setNewThemeName('');
                }
              }}
              className="flex-1 px-2.5 py-1 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:border-teal-600 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (newThemeName.trim()) {
                  handleAddCustomTheme(newThemeName);
                  setNewThemeName('');
                }
              }}
              className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ajouter</span>
            </button>
          </div>

          {/* Liste des thèmes modifiables */}
          <div className="max-h-48 overflow-y-auto space-y-1 custom-scrollbar pr-1">
            {allThemes.map(th => {
              const count = themeCounts[th] || 0;
              const isEditing = editingThemeOldName === th;

              return (
                <div 
                  key={th}
                  className="flex items-center justify-between p-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/80 text-xs"
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input 
                        type="text"
                        value={editingThemeNewName}
                        autoFocus
                        onChange={e => setEditingThemeNewName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameTheme(th, editingThemeNewName);
                          if (e.key === 'Escape') setEditingThemeOldName(null);
                        }}
                        className="flex-1 px-1.5 py-0.5 text-xs font-bold bg-white dark:bg-zinc-900 border border-teal-600 rounded outline-none"
                      />
                      <button 
                        onClick={() => handleRenameTheme(th, editingThemeNewName)}
                        className="px-2 py-0.5 bg-teal-600 text-white text-[10px] font-bold rounded"
                      >
                        OK
                      </button>
                      <button 
                        onClick={() => setEditingThemeOldName(null)}
                        className="p-0.5 text-zinc-400 hover:text-zinc-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 truncate">
                        <Folder className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{th}</span>
                        <span className="text-[9.5px] px-1.5 py-0.2 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-full font-bold">
                          {count}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setEditingThemeOldName(th);
                            setEditingThemeNewName(th);
                          }}
                          className="p-1 text-zinc-400 hover:text-teal-600 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                          title="Renommer ce thème"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {th !== 'Général' && (
                          <button
                            onClick={() => handleDeleteTheme(th)}
                            className="p-1 text-zinc-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Supprimer ce thème"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
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

        {/* Sélecteur déroulant élégant des thèmes style IA avec fermeture au clic extérieur */}
        <div ref={themeDropdownRef} className="relative z-30 pt-1">
          {/* Barre principale de déclenchement du déroulant */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0 bg-zinc-100/90 dark:bg-zinc-800/90 rounded-xl p-0.5 border border-zinc-200 dark:border-zinc-700/80 shadow-2xs flex items-center">
              <button
                type="button"
                onClick={() => setIsThemeDropdownOpen(prev => !prev)}
                className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 rounded-lg transition-all text-left cursor-pointer group"
                data-tooltip="Afficher et gérer la liste des thèmes"
              >
                <Folder className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span className="text-xs font-black text-zinc-800 dark:text-zinc-100 truncate flex-1">
                  {selectedThemeFilter === 'all' ? 'Tous les thèmes' : selectedThemeFilter}
                </span>
                <span className="text-[9.5px] font-bold text-teal-700 dark:text-teal-300 bg-teal-600/10 px-1.5 py-0.2 rounded-full shrink-0 border border-teal-600/20">
                  {themeCounts[selectedThemeFilter] || (selectedThemeFilter === 'all' ? themeCounts.all : 0)} notes
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${isThemeDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Actions rapides sur le thème sélectionné */}
              {selectedThemeFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingThemeOldName(selectedThemeFilter);
                    setEditingThemeNewName(selectedThemeFilter);
                    setIsThemeDropdownOpen(true);
                  }}
                  data-tooltip={`Renommer le thème "${selectedThemeFilter}"`}
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-teal-600 hover:bg-white dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              {selectedThemeFilter !== 'all' && selectedThemeFilter !== 'Général' && (
                <button
                  type="button"
                  onClick={() => handleDeleteTheme(selectedThemeFilter)}
                  data-tooltip={`Supprimer le thème "${selectedThemeFilter}"`}
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-white dark:hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Bouton + pour créer un nouveau thème */}
            <button
              type="button"
              onClick={() => {
                setIsThemeDropdownOpen(true);
                setShowNewThemeInput(true);
                setEditingThemeOldName(null);
              }}
              data-tooltip="Créer un nouveau thème"
              className="w-8 h-8 flex items-center justify-center bg-teal-600 hover:bg-teal-500 text-white rounded-xl transition-all cursor-pointer shrink-0 shadow-xs active:scale-95"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {/* Tiroir / Popover Déroulant des Thèmes */}
          {isThemeDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 p-3 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl space-y-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[70vh] flex flex-col">
              <div className="flex items-center justify-between pb-1 border-b border-zinc-100 dark:border-zinc-800">
                <span className="text-[10px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5" /> Thèmes de Notes ({allThemes.length})
                </span>
                <button
                  type="button"
                  onClick={() => setIsThemeDropdownOpen(false)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Filtre de recherche dans les thèmes si > 4 thèmes */}
              {allThemes.length > 4 && (
                <div className="relative">
                  <Search className="w-3 h-3 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Rechercher un thème..."
                    value={searchThemeQuery}
                    onChange={(e) => setSearchThemeQuery(e.target.value)}
                    className="w-full pl-7 pr-2.5 py-1 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl font-medium outline-none focus:border-teal-500 text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              )}

              {/* Formulaire d'ajout rapide d'un nouveau thème */}
              {showNewThemeInput && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newThemeName.trim()) {
                      handleAddCustomTheme(newThemeName);
                      setNewThemeName('');
                      setShowNewThemeInput(false);
                    }
                  }}
                  className="flex items-center gap-1.5 p-2 bg-teal-50/80 dark:bg-teal-950/40 border border-teal-500/40 rounded-xl"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                  <input
                    type="text"
                    placeholder="Nom du nouveau thème..."
                    autoFocus
                    value={newThemeName}
                    onChange={(e) => setNewThemeName(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1 text-xs font-bold bg-white dark:bg-zinc-950 border border-teal-500 rounded-lg outline-none text-zinc-900 dark:text-zinc-100"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg shrink-0 shadow-2xs cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewThemeInput(false)}
                    className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}

              {/* Liste déroulante des thèmes avec option "Tous" + thèmes individuels */}
              <div className="max-h-56 overflow-y-auto space-y-1 custom-scrollbar pr-0.5">
                {/* Option "Tous les thèmes" */}
                <div
                  onClick={() => {
                    setSelectedThemeFilter('all');
                    setIsThemeDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer ${
                    selectedThemeFilter === 'all'
                      ? 'bg-teal-600 text-white font-black shadow-2xs'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <List className="w-3.5 h-3.5 shrink-0" />
                    <span>Tous les thèmes</span>
                  </div>
                  <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-extrabold ${
                    selectedThemeFilter === 'all' ? 'bg-white/20 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                  }`}>
                    {themeCounts.all}
                  </span>
                </div>

                {/* Thèmes filtrés avec icônes de modification et de suppression sur chaque ligne */}
                {allThemes
                  .filter(th => !searchThemeQuery.trim() || th.toLowerCase().includes(searchThemeQuery.toLowerCase()))
                  .map(th => {
                    const isSelected = selectedThemeFilter === th;
                    const count = themeCounts[th] || 0;
                    const isEditingThis = editingThemeOldName === th;

                    if (isEditingThis) {
                      return (
                        <form
                          key={th}
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleRenameTheme(th, editingThemeNewName);
                          }}
                          className="flex items-center gap-1.5 p-1.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-500/40"
                        >
                          <Pencil className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <input
                            type="text"
                            value={editingThemeNewName}
                            onChange={(e) => setEditingThemeNewName(e.target.value)}
                            placeholder="Nom du thème..."
                            autoFocus
                            className="flex-1 min-w-0 px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-zinc-950 border border-amber-500 outline-none text-zinc-900 dark:text-zinc-100"
                          />
                          <button
                            type="submit"
                            data-tooltip="Enregistrer"
                            className="w-6 h-6 flex items-center justify-center bg-amber-600 hover:bg-amber-500 text-white rounded-md cursor-pointer shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingThemeOldName(null)}
                            data-tooltip="Annuler"
                            className="w-6 h-6 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-md cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      );
                    }

                    return (
                      <div
                        key={th}
                        onClick={() => {
                          setSelectedThemeFilter(th);
                          setIsThemeDropdownOpen(false);
                        }}
                        className={`flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer group ${
                          isSelected
                            ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-200 border border-teal-200 dark:border-teal-800 font-extrabold'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 font-medium'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-teal-600' : 'text-zinc-400 group-hover:text-teal-600'}`} />
                          <span className="truncate flex-1 text-[11.5px]">{th}</span>
                          <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold ${
                            isSelected ? 'bg-teal-600/20 text-teal-700 dark:text-teal-300' : 'bg-zinc-200/80 dark:bg-zinc-700/80 text-zinc-500 dark:text-zinc-400'
                          }`}>
                            {count}
                          </span>
                        </div>

                        {/* Icônes d'action : Modification et Suppression directement sur chaque ligne */}
                        <div className="flex items-center gap-0.5 ml-2 opacity-80 group-hover:opacity-100 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingThemeOldName(th);
                              setEditingThemeNewName(th);
                            }}
                            data-tooltip={`Renommer "${th}"`}
                            className="p-1 rounded-lg text-zinc-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>

                          {th !== 'Général' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTheme(th);
                              }}
                              data-tooltip={`Supprimer "${th}"`}
                              className="p-1 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Pied du tiroir : Création directe de thème */}
              {!showNewThemeInput && (
                <button
                  type="button"
                  onClick={() => setShowNewThemeInput(true)}
                  className="w-full py-1.5 bg-teal-600/10 hover:bg-teal-600/20 text-teal-700 dark:text-teal-300 border border-dashed border-teal-600/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-teal-600" />
                  <span>Nouveau Thème</span>
                </button>
              )}
            </div>
          )}
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
                  onAddNewCustomTheme={handleAddCustomTheme}
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
          /* Grouped Accordion View by Theme with Drop Zone on Accordion Header */
          Object.keys(groupedNotes).map(themeName => {
            const groupNotesList = groupedNotes[themeName];
            const isCollapsed = collapsedThemes[themeName];
            const isHoveredGroup = dragOverTheme === themeName;

            return (
              <div 
                key={themeName} 
                className={`mb-2 rounded-xl transition-all ${isHoveredGroup ? 'ring-2 ring-teal-500 bg-teal-50/20 dark:bg-teal-950/20' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverTheme !== themeName) setDragOverTheme(themeName);
                }}
                onDragLeave={() => {
                  if (dragOverTheme === themeName) setDragOverTheme(null);
                }}
                onDrop={(e) => handleDropOnTheme(e, themeName)}
              >
                {/* Accordion Theme Header */}
                <div
                  onClick={() => toggleCollapseTheme(themeName)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all mb-1 cursor-pointer ${
                    isHoveredGroup
                      ? 'bg-teal-600 text-white shadow-md'
                      : 'bg-zinc-200/60 dark:bg-zinc-800/60 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-teal-600" />}
                    <Folder className={`w-3.5 h-3.5 ${isHoveredGroup ? 'text-white' : 'text-teal-600 dark:text-teal-400'}`} />
                    <span className="truncate">{themeName}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold border ${
                      isHoveredGroup
                        ? 'bg-white/20 text-white border-white/20'
                        : 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 border-black/5 dark:border-white/5'
                    }`}>
                      {groupNotesList.length}
                    </span>

                    {/* Action button: + Note dans ce thème */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateNewNote(themeName);
                      }}
                      className="p-1 hover:bg-white/30 dark:hover:bg-zinc-700/50 rounded text-zinc-500 hover:text-teal-600 transition-all"
                      title={`Ajouter une note directement dans "${themeName}"`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

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
                        onAddNewCustomTheme={handleAddCustomTheme}
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