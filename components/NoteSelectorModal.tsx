
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { Sermon, Note } from '../types';
import { marked } from 'marked';
import { X, Check } from 'lucide-react';

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
  const titleInputRef = useRef<HTMLInputElement>(null);

  // States for Resizable Modal - height initially null for auto-fit
  const [modalSize, setModalSize] = useState<{ width: number; height: number | null }>({ width: 448, height: null });
  const isResizingRef = useRef(false);

  useEffect(() => {
    if (view === 'new_note' && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [view]);

  const handleShowNewNoteView = () => {
    setNewNoteTitle(`Note sur "${sermon.title}"`);
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
        return `<span class="text-teal-600 font-bold">[${s ? s.title : sermonId}]</span>`;
    });
    return marked(formattedText, { breaks: true });
  };

  // Resizing logic
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    const modalElement = document.getElementById('note-selector-modal');
    // If starting a manual resize, capture current auto-height to prevent jumping
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
        const newWidth = Math.max(380, e.clientX - rect.left);
        const newHeight = Math.max(300, e.clientY - rect.top);
        setModalSize({ width: newWidth, height: newHeight });
    }
  };

  const stopResizing = () => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleResizing);
    document.removeEventListener('mouseup', stopResizing);
  };
  
  return (
    <div className="absolute inset-0 z-[2000] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={onClose}>
      <div 
        id="note-selector-modal"
        style={{ width: modalSize.width, height: modalSize.height || 'auto', maxHeight: '85vh' }}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col relative" 
        onClick={e => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="px-8 pt-6 pb-2 flex items-center justify-between shrink-0">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                {view === 'list' ? "Classer" : "Nouvelle Note"}
            </h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-zinc-100 dark:bg-zinc-800 rounded-lg transition-all">
                <X className="w-4 h-4" />
            </button>
        </div>

        {/* Aperçu de la citation */}
        <div className="px-8 mb-4 shrink-0">
            <div className="p-4 bg-teal-600/5 dark:bg-teal-600/10 border border-teal-600/10 rounded-2xl relative">
                <div className="text-[8px] font-black text-teal-600 uppercase tracking-widest mb-2">Aperçu</div>
                <div className="prose-styles text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300 line-clamp-3 serif-text italic" dangerouslySetInnerHTML={{ __html: renderPreview(selectionText) as string }} />
                <div className="mt-2 flex items-center justify-end text-[8px] font-bold text-zinc-400 uppercase tracking-tighter">
                   {sermon.title} {paragraphIndex ? `(Para. ${paragraphIndex})` : ''}
                </div>
            </div>
        </div>

        {/* Actions */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 pb-8">
            {view === 'list' ? (
              <div className="space-y-3">
                <button
                  onClick={handleShowNewNoteView}
                  className="w-full py-4 bg-teal-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-teal-700 shadow-xl shadow-teal-600/10 transition-all active:scale-95 mb-4"
                >
                  + Nouvelle note
                </button>
                
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 px-1">Ou existante</div>
                <div className="space-y-2">
                    {notes.length > 0 ? notes.map(note => (
                        <button 
                          key={note.id}
                          onClick={() => handleAddToExistingNote(note)}
                          className="w-full text-left p-4 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-teal-50 dark:hover:bg-teal-900/20 border border-zinc-100 dark:border-zinc-800 rounded-2xl transition-all group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-zinc-800 dark:text-zinc-100 group-hover:text-teal-600 truncate mr-2">{note.title}</span>
                            <Check className="w-4 h-4 text-teal-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                    )) : (
                        <div className="py-8 text-center text-xs text-zinc-400 italic">Aucune note.</div>
                    )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Titre</label>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={newNoteTitle}
                    onChange={(e) => setNewNoteTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmNewNote()}
                    className="w-full px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl text-sm font-bold text-zinc-950 dark:text-white focus:ring-4 focus:ring-teal-500/10 outline-none"
                    placeholder="Sujet..."
                  />
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setView('list')} className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-zinc-200 transition-all">Retour</button>
                    <button onClick={handleConfirmNewNote} className="flex-[2] py-4 bg-teal-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-teal-700 shadow-xl shadow-teal-600/10 transition-all">Confirmer</button>
                </div>
              </div>
            )}
        </div>

        {/* Resize Indicator Handle */}
        <div 
          onMouseDown={startResizing}
          className="absolute bottom-0 right-0 w-8 h-8 cursor-nwse-resize flex items-end justify-end p-1.5 group/resize"
          title="Redimensionner"
        >
            <div className="flex flex-col gap-[2px] items-end opacity-20 group-hover/resize:opacity-60 transition-opacity">
               <div className="w-4 h-[1.5px] bg-zinc-400 dark:bg-zinc-500 rounded-full" />
               <div className="w-2.5 h-[1.5px] bg-zinc-400 dark:bg-zinc-500 rounded-full" />
               <div className="w-1 h-[1.5px] bg-zinc-400 dark:bg-zinc-500 rounded-full" />
            </div>
        </div>
      </div>
    </div>
  );
};

export default NoteSelectorModal;
