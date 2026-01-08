
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../store';
import { Sermon, Note } from '../types';
import { marked } from 'marked';
import { 
  X, 
  Check, 
  Plus, 
  Search, 
  Notebook, 
  Quote, 
  Hash, 
  ChevronRight, 
  Calendar,
  FileText,
  Clock,
  Sparkles
} from 'lucide-react';
import { normalizeText } from '../utils/textUtils';

interface NoteSelectorModalProps {
  selectionText: string;
  sermon: Sermon;
  paragraphIndex?: number;
  onClose: () => void;
}

const NoteSelectorModal: React.FC<NoteSelectorModalProps> = ({ selectionText, sermon, paragraphIndex, onClose }) => {
  const { notes, addNote, addCitationToNote, addNotification, sermons } = useAppStore();
  const [view, setView] = useState<'list' | 'new_note'>('list');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [modalSize, setModalSize] = useState<{ width: number; height: number | null }>({ width: 500, height: null });
  const isResizingRef = useRef(false);

  useEffect(() => {
    if (view === 'new_note' && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [view]);

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = normalizeText(searchQuery);
    return notes.filter(n => normalizeText(n.title).includes(q));
  }, [notes, searchQuery]);

  const handleShowNewNoteView = () => {
    setNewNoteTitle(`Étude : ${sermon.title}`);
    setView('new_note');
  };

  const handleConfirmNewNote = () => {
    if (!newNoteTitle.trim()) {
      addNotification('Le titre de la note ne peut pas être vide.', 'error');
      return;
    }
    const newCitation: any = {
      sermon_id: sermon.id,
      sermon_title_snapshot: sermon.title,
      sermon_date_snapshot: sermon.date,
      quoted_text: selectionText,
      paragraph_index: paragraphIndex
    };

    addNote({
      title: newNoteTitle.trim(),
      content: "",
      citations: [newCitation],
    });
    addNotification('Nouvelle note créée avec succès.', 'success');
    onClose();
  };

  const handleAddToExistingNote = (note: Note) => {
    addCitationToNote(note.id, {
      sermon_id: sermon.id,
      sermon_title_snapshot: sermon.title,
      sermon_date_snapshot: sermon.date,
      quoted_text: selectionText,
      paragraph_index: paragraphIndex
    });
    addNotification(`Citation ajoutée à "${note.title}".`, 'success');
    onClose();
  };

  const renderPreview = (text: string) => {
    let formattedText = text.replace(/\[Réf:\s*([\w-]+)\s*\]/gi, (match, sermonId) => {
        const s = sermons.find(x => x.id === sermonId);
        return `<span class="text-teal-600 font-black">[${s ? s.title : sermonId}]</span>`;
    });
    return marked(formattedText, { breaks: true });
  };

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    const modalElement = document.getElementById('note-selector-modal');
    if (modalElement && modalSize.height === null) {
        setModalSize({ width: modalSize.width, height: modalElement.offsetHeight });
    }
    isResizingRef.current = true;
    document.addEventListener('mousemove', handleResizing);
    document.addEventListener('mouseup', stopResizing);
  };

  const handleResizing = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const modalElement = document.getElementById('note-selector-modal');
    if (modalElement) {
        const rect = modalElement.getBoundingClientRect();
        const newWidth = Math.max(400, e.clientX - rect.left);
        const newHeight = Math.max(350, e.clientY - rect.top);
        setModalSize({ width: newWidth, height: newHeight });
    }
  };

  const stopResizing = () => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleResizing);
    document.removeEventListener('mouseup', stopResizing);
  };
  
  return (
    <div className="fixed inset-0 z-[100000] bg-zinc-950/40 dark:bg-black/60 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-500" onClick={onClose}>
      <div 
        id="note-selector-modal"
        style={{ width: modalSize.width, height: modalSize.height || 'auto', maxHeight: '90vh' }}
        className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 rounded-[40px] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] overflow-hidden animate-in zoom-in-95 duration-400 flex flex-col relative group/modal" 
        onClick={e => e.stopPropagation()}
      >
        
        {/* Header Section */}
        <div className="px-10 pt-10 pb-6 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-2xl border border-teal-600/20 shadow-sm animate-in slide-in-from-left-4 duration-500">
                    {view === 'list' ? <Notebook className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                </div>
                <div>
                    <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                        {view === 'list' ? "Classer l'Étude" : "Nouvelle Chronique"}
                    </h2>
                    <p className="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-widest mt-0.5 opacity-70">
                        {view === 'list' ? `${notes.length} notes disponibles` : "Définir le sujet de recherche"}
                    </p>
                </div>
            </div>
            <button 
              onClick={onClose} 
              className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-zinc-50 dark:bg-zinc-800 rounded-xl transition-all border border-zinc-100 dark:border-zinc-700 hover:border-red-500/20 active:scale-90"
            >
                <X className="w-5 h-5" />
            </button>
        </div>

        {/* Citation Preview Card */}
        <div className="px-10 mb-8 shrink-0 animate-in fade-in slide-in-from-top-2 duration-700 delay-100">
            <div className="p-6 bg-zinc-50/50 dark:bg-zinc-800/30 border border-zinc-100 dark:border-zinc-800 rounded-[32px] relative overflow-hidden group/preview">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-600/20 group-hover/preview:bg-teal-600 transition-colors duration-500" />
                <Quote className="absolute -right-4 -top-4 w-24 h-24 text-teal-600/5 -rotate-12 transition-transform duration-700 group-hover/preview:rotate-0" />
                
                <div className="flex items-center gap-2 mb-3">
                   <div className="w-5 h-5 flex items-center justify-center bg-teal-600 text-white rounded-lg">
                      <Sparkles className="w-3 h-3" />
                   </div>
                   <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Extrait sélectionné</span>
                </div>

                <div 
                  className="prose-styles text-[14px] leading-relaxed text-zinc-700 dark:text-zinc-200 line-clamp-4 serif-text italic relative z-10 selection:bg-teal-600/20" 
                  dangerouslySetInnerHTML={{ __html: renderPreview(selectionText) as string }} 
                />
                
                <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700/50 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400">
                        <Calendar className="w-3 h-3 text-teal-600/40" />
                        <span className="font-mono">{sermon.date}</span>
                    </div>
                    {paragraphIndex && (
                      <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[9px] font-black text-teal-600 uppercase tracking-widest">
                        <Hash className="w-2.5 h-2.5" />
                        <span>PARA. {paragraphIndex}</span>
                      </div>
                    )}
                </div>
            </div>
        </div>

        {/* Search & Actions Container */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-10 pb-10 space-y-6">
            {view === 'list' ? (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 group/search">
                        <input 
                            type="text" 
                            placeholder="RECHERCHER UNE NOTE..." 
                            className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-2xl text-[11px] font-bold text-zinc-900 dark:text-white focus:ring-4 focus:ring-teal-600/5 focus:border-teal-600/40 outline-none transition-all" 
                            value={searchQuery} 
                            onChange={e => setSearchQuery(e.target.value)} 
                        />
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 group-focus-within/search:text-teal-600 transition-colors" />
                    </div>
                    <button
                        onClick={handleShowNewNoteView}
                        className="w-12 h-12 flex items-center justify-center bg-teal-600 text-white rounded-2xl hover:bg-teal-700 shadow-xl shadow-teal-600/20 transition-all active:scale-90 group/add-btn"
                        title="Créer une nouvelle note"
                    >
                        <Plus className="w-6 h-6 transition-transform group-hover/add-btn:rotate-90" />
                    </button>
                </div>

                <div className="space-y-3">
                    {filteredNotes.length > 0 ? filteredNotes.map((note, idx) => (
                        <button 
                          key={note.id}
                          onClick={() => handleAddToExistingNote(note)}
                          className="w-full text-left p-5 bg-white dark:bg-zinc-800/20 hover:bg-teal-50 dark:hover:bg-teal-900/10 border border-zinc-100 dark:border-zinc-800/50 hover:border-teal-600/30 rounded-[24px] transition-all group flex items-center justify-between animate-in slide-in-from-bottom-2 duration-500"
                          style={{ animationDelay: `${idx * 50}ms` }}
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-xl text-zinc-400 group-hover:bg-teal-600/10 group-hover:text-teal-600 transition-all">
                                <FileText className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <span className="block font-black text-[13px] text-zinc-800 dark:text-zinc-100 group-hover:text-teal-600 truncate uppercase tracking-tight">
                                    {note.title}
                                </span>
                                <div className="flex items-center gap-3 mt-1 opacity-50">
                                    <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest">
                                        <Clock className="w-2.5 h-2.5" />
                                        <span>{new Date(note.creationDate || note.date).toLocaleDateString()}</span>
                                    </div>
                                    <div className="w-1 h-1 bg-zinc-300 rounded-full" />
                                    <span className="text-[8px] font-bold uppercase tracking-widest">{note.citations.length} Citations</span>
                                </div>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-zinc-300 group-hover:text-teal-600 transition-all transform group-hover:translate-x-1" />
                        </button>
                    )) : (
                        <div className="py-12 flex flex-col items-center justify-center text-center opacity-30 space-y-4">
                            <Search className="w-12 h-12 stroke-[1]" />
                            <p className="text-[10px] font-black uppercase tracking-[0.3em]">Aucun résultat trouvé</p>
                        </div>
                    )}
                </div>
              </div>
            ) : (
              <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sujet de la Note</label>
                      <span className="text-[8px] font-bold text-teal-600/50">Obligatoire</span>
                  </div>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={newNoteTitle}
                    onChange={(e) => setNewNoteTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmNewNote()}
                    className="w-full px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-[20px] text-base font-black text-zinc-950 dark:text-white focus:ring-4 focus:ring-teal-600/5 focus:border-teal-600 outline-none transition-all shadow-sm"
                    placeholder="EX: L'OUVERTURE DES SCEAUX..."
                  />
                  <p className="text-[9px] text-zinc-400 italic px-2">Un nouveau journal d'étude sera créé avec cette citation comme point de départ.</p>
                </div>
                <div className="flex gap-4 pt-4">
                    <button 
                        onClick={() => setView('list')} 
                        className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95 border border-transparent"
                    >
                        Annuler
                    </button>
                    <button 
                        onClick={handleConfirmNewNote} 
                        className="flex-[2] py-4 bg-teal-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-teal-700 shadow-xl shadow-teal-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <Check className="w-4 h-4" />
                        Confirmer la création
                    </button>
                </div>
              </div>
            )}
        </div>

        {/* Resize Handler */}
        <div 
          onMouseDown={startResizing}
          className="absolute bottom-0 right-0 w-10 h-10 cursor-nwse-resize flex items-end justify-end p-2 group/resize z-[100]"
        >
            <div className="grid grid-cols-2 gap-0.5 opacity-20 group-hover/resize:opacity-100 group-hover/modal:opacity-40 transition-opacity">
               <div className="w-1 h-1 bg-zinc-400 dark:bg-zinc-500 rounded-full" />
               <div className="w-1 h-1 bg-zinc-400 dark:bg-zinc-500 rounded-full" />
               <div className="w-1 h-1 bg-zinc-400 dark:bg-zinc-500 rounded-full" />
               <div className="w-1 h-1 bg-zinc-400 dark:bg-zinc-500 rounded-full" />
            </div>
        </div>
      </div>
    </div>
  );
};

export default NoteSelectorModal;
