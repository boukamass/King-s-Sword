
import React, { useState, useMemo, memo } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { Note, Citation } from '../types';
import { normalizeText } from '../utils/textUtils';
import { 
  Plus, 
  X, 
  Search, 
  Trash2, 
  Clock,
  NotebookPen,
  FileText,
  GripVertical,
  Link2,
  Pencil,
  Hash,
  ExternalLink,
  Quote
} from 'lucide-react';

const PALETTE_COLORS: { name: string; key: string; bg: string; border: string; ring: string; }[] = [
    { name: 'Défaut', key: 'default', bg: 'bg-zinc-100 dark:bg-zinc-800/50', border: 'border-zinc-200 dark:border-zinc-700/50', ring: 'ring-zinc-400' },
    { name: 'Sarcelle Royale', key: 'sky', bg: 'bg-teal-600/5 dark:bg-teal-600/10', border: 'border-teal-600/20 dark:border-teal-600/30', ring: 'ring-teal-600' },
    { name: 'Menthe', key: 'teal', bg: 'bg-teal-50 dark:bg-teal-900/20', border: 'border-teal-200 dark:border-teal-800/30', ring: 'ring-teal-400' },
    { name: 'Ambre', key: 'amber', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800/30', ring: 'ring-amber-400' },
    { name: 'Rose', key: 'rose', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800/30', ring: 'ring-rose-400' },
    { name: 'Violet', key: 'violet', bg: 'bg-violet-50 dark:bg-violet-900/20', border: 'border-violet-200 dark:border-violet-800/30', ring: 'ring-violet-400' },
];

const NoteCard = memo(({ 
  n, 
  onSelect, 
  onDelete, 
  onUpdateTitle, 
  onUpdateColor,
  onJumpToReader,
  isEditingTitle,
  setEditingNoteId,
  dragHandlers
}: { 
  n: Note; 
  onSelect: () => void; 
  onDelete: (id: string) => void; 
  onUpdateTitle: (id: string, title: string) => void; 
  onUpdateColor: (id: string, color: string | undefined) => void; 
  onJumpToReader: (citation: Citation) => void;
  isEditingTitle: boolean; 
  setEditingNoteId: (id: string | null) => void; 
  dragHandlers: any;
}) => {
  const color = PALETTE_COLORS.find(c => c.key === n.color) || PALETTE_COLORS[0];
  const firstCitation = n.citations.length > 0 ? n.citations[0] : null;

  return (
    <div 
      {...dragHandlers}
      onClick={onSelect} 
      className={`group w-full p-4 rounded-2xl ${color.bg} border ${color.border} transition-all duration-300 hover:shadow-2xl hover:border-teal-600/50 cursor-pointer relative mb-3 overflow-hidden`}
    >
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
           <GripVertical className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
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
               className="w-full text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-tight bg-white/80 dark:bg-zinc-700/50 p-1 border border-teal-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
             />
           ) : (
             <div
               onClick={(e) => { e.stopPropagation(); setEditingNoteId(n.id); }}
               title="Cliquer pour modifier"
               className="flex items-center gap-1.5 flex-1 min-w-0 cursor-text"
             >
               <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate tracking-tight group-hover:text-teal-600 transition-colors">
                 {n.title}
               </h3>
               <Pencil className="w-3 h-3 text-zinc-400 dark:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
             </div>
           )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button data-tooltip="Supprimer" onClick={e => { e.stopPropagation(); onDelete(n.id); }} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-zinc-400 hover:text-red-500 active:scale-95 transition-all tooltip-left"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      
      <div className="flex items-center gap-1 pl-5 mb-3 text-[8px] font-black uppercase tracking-wider text-zinc-400">
        <Clock className="w-2.5 h-2.5" /> 
        <span>{new Date(n.creationDate || n.date).toLocaleDateString()}</span>
      </div>

      <div className="pl-5 mb-3">
        {firstCitation && (
          <div className="flex items-center gap-2 mb-2 p-1.5 bg-white/50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50 shadow-sm">
            <div className="w-5 h-5 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-md border border-teal-600/20">
              <Link2 className="w-2.5 h-2.5" />
            </div>
            <div className="flex-1 min-w-0">
               <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[9px] font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-tight truncate">{firstCitation.sermon_title_snapshot}</span>
                  <span className="text-[7px] font-bold text-zinc-400 shrink-0 font-mono">({firstCitation.sermon_date_snapshot})</span>
                  <span className="text-[8px] font-black text-teal-600 shrink-0 bg-teal-600/5 px-1 rounded">#{firstCitation.paragraph_index ?? '—'}</span>
               </div>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); onJumpToReader(firstCitation); }}
              className="w-5 h-5 flex items-center justify-center bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-all active:scale-90"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          </div>
        )}

        <div className="relative group/preview">
           {n.content ? (
             <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed font-medium italic opacity-90 pl-1">
               {n.content}
             </p>
           ) : firstCitation ? (
             <div className="flex gap-2 pl-1 border-l-2 border-teal-600/30 bg-teal-600/5 dark:bg-teal-600/10 p-2 rounded-r-lg">
               <Quote className="w-3 h-3 text-teal-600/40 shrink-0" />
               <p className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed font-medium italic">
                 {firstCitation.quoted_text}
               </p>
             </div>
           ) : null}
        </div>
      </div>

      <div className="pl-5 mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {PALETTE_COLORS.map(c => (
              <button 
                key={c.key} 
                onClick={(e) => { e.stopPropagation(); onUpdateColor(n.id, c.key === 'default' ? undefined : c.key); }} 
                className={`w-3.5 h-3.5 rounded-full ${c.bg} border ${c.border} transition-all ${
                  (n.color || 'default') === c.key 
                    ? `ring-2 ring-offset-2 dark:ring-offset-zinc-900 ${c.ring}`
                    : 'hover:scale-110'
                }`} 
              />
            ))}
          </div>
          <div className="flex items-center gap-1 text-[8px] font-black text-zinc-400 uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
            <FileText className="w-2.5 h-2.5" />
            <span>{n.citations.length}</span>
          </div>
      </div>
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
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = normalizeText(searchQuery);
    return notes.filter(n => normalizeText(n.title).includes(q));
  }, [notes, searchQuery]);

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

  const handleJumpToReader = (citation: Citation, noteId: string) => {
    if (citation.sermon_id.startsWith('ia-') || citation.sermon_id.startsWith('definition')) return;
    
    // Mémoriser la note d'origine pour permettre le retour
    setNavigatedFromNoteId(noteId);
    
    setSelectedSermonId(citation.sermon_id);
    if (citation.paragraph_index) {
        setJumpToParagraph(citation.paragraph_index);
    } else {
        setJumpToText(citation.quoted_text);
    }
    
    // Fermer l'éditeur de notes éventuel pour voir le lecteur
    setActiveNoteId(null);
    toggleNotes(); 
  };

  return (
    <div className="w-full border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 h-full flex flex-col overflow-hidden">
      <div className="px-4 h-14 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl z-50">
        <button 
          onClick={toggleNotes}
          className="flex items-center gap-3 group tooltip-bottom"
          data-tooltip={t.tooltip_close}
        >
          <div className="w-8 h-8 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm group-hover:border-teal-600/30 transition-all">
            <NotebookPen className="w-4 h-4" />
          </div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-950 dark:text-zinc-50 group-hover:text-teal-600 transition-colors">
            {t.reader_notes}
          </h2>
        </button>
        <div className="flex items-center gap-1">
          <button 
            data-tooltip="Nouvelle note" 
            onClick={() => addNote({ title: "Nouvelle Note", content: "", citations: [] })} 
            className="w-8 h-8 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-lg border border-teal-600/10 shadow-sm hover:bg-teal-600 hover:text-white hover:border-teal-600 transition-all active:scale-90 tooltip-bottom"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button 
            data-tooltip={t.tooltip_close} 
            onClick={toggleNotes} 
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 tooltip-left"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/40 z-10">
        <div className="relative group/notes-filter">
          <input 
            type="text" 
            placeholder={t.search_note_placeholder} 
            className="w-full pl-9 pr-8 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-[11px] font-medium focus:ring-4 focus:ring-teal-600/5 focus:border-teal-600 outline-none transition-all shadow-sm" 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
          />
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400" />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all active:scale-90 animate-in zoom-in-95"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar bg-zinc-50/20 dark:bg-zinc-950/20">
        {filteredNotes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
            <FileText className="w-16 h-16 stroke-1 text-zinc-300 dark:text-zinc-600" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{t.no_notes_yet}</p>
          </div>
        ) : (
          filteredNotes.map(n => {
            const isTargeted = dragOverId === n.id;
            
            return (
              <React.Fragment key={n.id}>
                {isTargeted && (
                  <div className="h-1 w-full bg-teal-600 rounded-full shadow-[0_0_12px_rgba(13,148,136,0.8)] animate-in fade-in zoom-in-95 duration-200 my-2" />
                )}
                
                <NoteCard 
                  n={n}
                  onSelect={() => setActiveNoteId(n.id)}
                  onDelete={deleteNote}
                  onUpdateTitle={(id, title) => updateNote(id, { title })}
                  onUpdateColor={(id, color) => updateNote(id, { color })}
                  onJumpToReader={(citation) => handleJumpToReader(citation, n.id)}
                  isEditingTitle={editingNoteId === n.id}
                  setEditingNoteId={setEditingNoteId}
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
        )}
      </div>
    </div>
  );
};

export default NotesPanel;
