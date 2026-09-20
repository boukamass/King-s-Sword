import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore, sortNotesByRecency } from '../store';
import { Sermon, Note } from '../types';
import { marked } from 'marked';
import { 
  X, 
  Check, 
  Plus, 
  Search, 
  NotebookPen, 
  Quote, 
  FileText,
  Clock,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import { normalizeText } from '../utils/textUtils';

interface NoteSelectorModalProps {
  selectionText: string;
  sermon: Sermon;
  paragraphIndex?: number;
  onClose: () => void;
}

const NoteSelectorModal: React.FC<NoteSelectorModalProps> = ({ 
  selectionText, 
  sermon, 
  paragraphIndex, 
  onClose 
}) => {
  const { notes, addNote, addCitationToNote, addNotification, sermons, setSidebarOpen, setNotesOpen, setAiOpen } = useAppStore();
  const [view, setView] = useState<'list' | 'new_note'>('list');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSidebarOpen(false);
    setNotesOpen(false);
    setAiOpen(false);
  }, [setSidebarOpen, setNotesOpen, setAiOpen]);

  useEffect(() => {
    if (view === 'new_note' && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [view]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const filteredNotes = useMemo(() => {
    const sorted = sortNotesByRecency(notes);
    if (!searchQuery.trim()) return sorted;
    const q = normalizeText(searchQuery);
    return sorted.filter(n => normalizeText(n.title).includes(q));
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
      sermon_version_snapshot: sermon.version,
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
    const isAlreadyPresent = note.citations && note.citations.some(c => 
      (c.sermon_id === sermon.id && c.paragraph_index !== undefined && c.paragraph_index === paragraphIndex) ||
      (c.quoted_text && selectionText && c.quoted_text.trim().toLowerCase() === selectionText.trim().toLowerCase())
    );

    if (isAlreadyPresent) {
      addNotification(`Cette référence est déjà présente dans "${note.title}".`, 'info');
      onClose();
      return;
    }

    addCitationToNote(note.id, {
      sermon_id: sermon.id,
      sermon_title_snapshot: sermon.title,
      sermon_date_snapshot: sermon.date,
      sermon_version_snapshot: sermon.version,
      quoted_text: selectionText,
      paragraph_index: paragraphIndex
    });
    addNotification(`Extrait ajouté à "${note.title}".`, 'success');
    onClose();
  };

  const renderPreview = (text: string) => {
    let formattedText = text.replace(/\[Réf:\s*([\w-]+)\s*\]/gi, (match, sermonId) => {
        const s = sermons.find(x => x.id === sermonId);
        return `<span class="text-teal-600 font-black">[${s ? s.title : sermonId}]</span>`;
    });
    return marked(formattedText, { breaks: true });
  };
  
  return (
    <div 
      className="fixed inset-0 z-[100050] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600/10 dark:bg-teal-500/10 border border-teal-600/20 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-xs shrink-0">
              <NotebookPen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>{view === 'list' ? "Classer l'Étude dans un Journal" : "Créer un Nouveau Journal"}</span>
                <span className="text-[10px] font-mono font-bold bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">
                  {notes.length} note{notes.length > 1 ? 's' : ''}
                </span>
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {view === 'list'
                  ? "Sélectionnez un journal existant ou créez-en un nouveau pour insérer cet extrait"
                  : "Définissez le sujet du nouveau journal d'étude"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            data-tooltip="Fermer la fenêtre"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selected Excerpt Preview Card */}
        <div className="px-5 py-3 border-b border-slate-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 shrink-0">
          <div className="p-4 sm:p-5 bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 rounded-2xl relative overflow-hidden group shadow-2xs">
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Quote className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400">
                  Extrait sélectionné
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400 flex-wrap">
                <span className="font-extrabold text-zinc-800 dark:text-zinc-200 truncate max-w-[220px]">
                  {sermon.title}
                </span>
                {sermon.date && <span className="font-mono text-zinc-400">({sermon.date})</span>}
                {paragraphIndex !== undefined && (
                  <span className="font-mono font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.2 rounded border border-teal-500/20">
                    § {paragraphIndex}
                  </span>
                )}
              </div>
            </div>

            <div 
              className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-3 italic leading-relaxed pl-2.5 border-l-2 border-teal-500/40"
              dangerouslySetInnerHTML={{ __html: renderPreview(selectionText) as string }} 
            />
          </div>
        </div>

        {/* Search & Action Toolbar or Form View */}
        {view === 'list' ? (
          <div className="px-5 py-2.5 border-b border-slate-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-zinc-950/30 shrink-0">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher dans vos notes existantes..."
                className="w-full pl-8.5 pr-8 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-teal-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')} 
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <button
              onClick={handleShowNewNoteView}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all active:scale-95 shadow-xs cursor-pointer shrink-0"
              data-tooltip="Créer un nouveau journal"
            >
              <Plus className="w-4 h-4" />
              <span>Créer une note</span>
            </button>
          </div>
        ) : null}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 custom-scrollbar min-h-[240px]">
          {view === 'list' ? (
            filteredNotes.length === 0 ? (
              <div className="h-56 flex flex-col items-center justify-center text-center p-6 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 flex items-center justify-center text-zinc-400">
                  <NotebookPen className="w-6 h-6 text-teal-500/40" />
                </div>
                <div>
                  <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
                    {searchQuery.trim() ? "Aucune note trouvée pour votre recherche" : "Aucun journal de notes disponible"}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm">
                    {searchQuery.trim()
                      ? "Essayez d'autres mots-clés ou cliquez sur 'Créer une note' pour créer un nouveau journal."
                      : "Créez votre première note d'étude en cliquant sur le bouton ci-dessus pour y classer cet extrait."}
                  </p>
                </div>
              </div>
            ) : (
              filteredNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => handleAddToExistingNote(note)}
                  className="group flex items-center justify-between gap-3 p-3.5 rounded-xl bg-white dark:bg-zinc-850/60 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 border border-slate-200/80 dark:border-zinc-800 hover:border-teal-500/40 transition-all cursor-pointer shadow-xs hover:shadow-md"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 shrink-0 group-hover:bg-teal-600/10 group-hover:text-teal-600 transition-colors">
                      <FileText className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors leading-snug line-clamp-1">
                        {note.title}
                      </h3>

                      <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
                        <Clock className="w-3 h-3 text-zinc-400" />
                        <span>{new Date(note.creationDate || note.date).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>{note.citations.length} citation{note.citations.length > 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <div className="p-2 rounded-lg text-teal-600 bg-teal-50 dark:bg-teal-950/40 group-hover:bg-teal-600 group-hover:text-white transition-all shadow-2xs">
                      <Plus className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              ))
            )
          ) : (
            <div className="space-y-4 p-2 animate-in fade-in duration-200">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                    Sujet ou titre du nouveau journal
                  </label>
                  <span className="text-[10px] font-bold text-teal-600">Requis</span>
                </div>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmNewNote()}
                  className="w-full px-3.5 py-2.5 text-xs bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-teal-500 font-extrabold text-zinc-900 dark:text-zinc-100 shadow-xs"
                  placeholder="Ex: Étude sur l'Ouverture des Sceaux..."
                />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 italic">
                  Un nouveau journal d'étude sera créé avec cet extrait comme première citation.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Retour à la liste</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirmNewNote}
                  className="flex-1 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Confirmer la création</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-950/40 flex items-center justify-between text-[11px] text-zinc-500 shrink-0">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-teal-600" />
            Cliquez sur un journal pour y ajouter instantanément l'extrait
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoteSelectorModal;
