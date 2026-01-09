
import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } from 'docx';
import saveAs from 'file-saver';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import { Printer, FileText, FileDown, Link2, ExternalLink, NotebookPen, Calendar, MapPin, Sparkles, Hash, Quote } from 'lucide-react';
import { Citation } from '../types';

const ActionButton = ({ onClick, icon: Icon, tooltip }: { onClick: () => void; icon: React.ElementType; tooltip: string }) => (
  <button 
    onClick={onClick} 
    data-tooltip={tooltip}
    className="w-9 h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-zinc-500 hover:text-teal-600 dark:text-zinc-400 tooltip-bottom"
  >
    <Icon className="w-4 h-4" />
  </button>
);

const NoteEditor: React.FC = () => {
    const {
        activeNoteId,
        notes,
        sermons,
        updateNote,
        setActiveNoteId,
        setSelectedSermonId,
        setJumpToText,
        setJumpToParagraph,
        languageFilter,
        addNotification,
    } = useAppStore();

    const note = notes.find(n => n.id === activeNoteId);
    const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
    const t = translations[lang];

    const [editingTitle, setEditingTitle] = useState(false);
    const [editingContent, setEditingContent] = useState(false);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!note && activeNoteId) {
            setActiveNoteId(null);
        }
    }, [note, activeNoteId, setActiveNoteId]);
    
    useEffect(() => {
        if (editingTitle && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [editingTitle]);

    useEffect(() => {
        if (editingContent && contentTextareaRef.current) {
            contentTextareaRef.current.focus();
            contentTextareaRef.current.style.height = 'auto';
            contentTextareaRef.current.style.height = `${contentTextareaRef.current.scrollHeight}px`;
        }
    }, [editingContent, note?.content]);

    if (!note) return null;

    const handleJumpToCitation = (sermonId: string, quotedText?: string, paragraphIndex?: number) => {
        if(sermonId.startsWith('ia-response') || sermonId.startsWith('definition-')) return; 
        setSelectedSermonId(sermonId);
        if (paragraphIndex) {
            setJumpToParagraph(paragraphIndex);
        } else if (quotedText) {
            setJumpToText(quotedText);
        }
        setActiveNoteId(null);
    };

    const handleTitleBlur = () => setEditingTitle(false);
    const handleContentBlur = () => setEditingContent(false);
    
    const renderRichContent = (text: string, sourceSermonId?: string) => {
        let processedText = text.replace(
            /\[\[\[NOTE_EXTERNE\]\]\]/g, 
            "> **Note de l'Assistant :** L'information suivante est un complément basé on des connaissances générales et ne provient pas des sermons fournis.\n\n>"
        );

        let formattedText = processedText.replace(/\[Réf:\s*([\w-]+)\s*\]/gi, (match, sermonId) => {
          const sermon = sermons.find(s => s.id === sermonId);
          if (sermon) {
            return `<a href="#" data-sermon-id="${sermonId}" class="sermon-ref text-teal-600 dark:text-blue-400 font-black hover:underline decoration-teal-500/30 underline-offset-4 inline-flex items-center gap-1" title="Voir la source"><span>[${sermon.title}]</span></a>`;
          }
          return match;
        });

        if (sourceSermonId && !sourceSermonId.includes('ia-') && !sourceSermonId.includes('definition') && !formattedText.includes('sermon-ref')) {
            const sermon = sermons.find(s => s.id === sourceSermonId);
            if (sermon) {
                formattedText += ` <a href="#" data-sermon-id="${sourceSermonId}" class="sermon-ref text-teal-600 dark:text-blue-400 font-black hover:underline decoration-teal-500/30 underline-offset-4" title="Ouvrir le sermon source">[Source: ${sermon.title}]</a>`;
            }
        }
        
        let html = marked(formattedText, { breaks: true }) as string;
        const replacement = '<blockquote class="border-l-4 border-teal-600/30 bg-teal-600/5 py-3 px-5 rounded-r-2xl my-6 text-sm italic serif-text relative"><div class="absolute -left-2 -top-2 w-6 h-6 bg-white dark:bg-zinc-900 rounded-full flex items-center justify-center border border-teal-600/20 text-teal-600/40"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 5-2.5 5s-2.5-1.25-2.5-2.5"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c1 0 1 0 1 1 0 2.5 0 5-2.5 5s-2.5-1.25-2.5-2.5"/></svg></div>';
        html = html.replace(/<blockquote>\s*<p><strong>Note de l’Assistant :<\/strong>/g, `${replacement}<p><strong>Note de l’Assistant :</strong>`);
        html = html.replace(/<blockquote>\s*<p><strong>Note de l'Assistant :<\/strong>/g, `${replacement}<p><strong>Note de l'Assistant :</strong>`);
        
        return html;
    };

    const handleCitationClick = (e: React.MouseEvent, citation: Citation) => {
        const target = e.target as HTMLElement;
        const link = target.closest('a.sermon-ref');
        
        if (link instanceof HTMLAnchorElement && link.dataset.sermonId) {
            e.preventDefault();
            const sermonId = link.dataset.sermonId;
            const parentElement = link.closest('p, li, blockquote');
            let searchText = '';

            if (parentElement) {
                const parentClone = parentElement.cloneNode(true) as HTMLElement;
                parentClone.querySelectorAll('a.sermon-ref').forEach(a => a.remove());
                searchText = parentClone.textContent?.trim() || '';
            }
            
            if (searchText.length > 150) {
                 const sentences = searchText.match(/[^.!?]+[.!?]+/g) || [searchText];
                 searchText = sentences.pop()?.trim() || searchText;
            }
            handleJumpToCitation(sermonId, searchText || undefined);
            return;
        }

        const isVirtual = citation.sermon_id.startsWith('ia-') || citation.sermon_id.startsWith('definition') || citation.sermon_id.startsWith('search');
        if (!isVirtual) {
            handleJumpToCitation(citation.sermon_id, citation.quoted_text, citation.paragraph_index);
        }
    };

    const handleExportPdf = async () => {
        if (!note) return;
        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.width;
            const margin = 15;
            const maxLineWidth = pageWidth - margin * 2;
            let y = margin;
            
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            const titleLines = doc.splitTextToSize(note.title, maxLineWidth);
            doc.text(titleLines, margin, y);
            y += titleLines.length * 10 + 6;
    
            if (note.content) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(12);
                const contentLines = doc.splitTextToSize(note.content, maxLineWidth);
                doc.text(contentLines, margin, y);
                y += contentLines.length * 6 + 10;
            }
    
            if (note.citations.length > 0) {
                doc.setDrawColor(13, 148, 136);
                doc.line(margin, y, pageWidth - margin, y);
                y += 12;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                doc.text("Citations et Sources", margin, y);
                y += 10;
    
                for (const citation of note.citations) {
                    if (y > doc.internal.pageSize.height - 30) { doc.addPage(); y = margin; }
                    
                    const div = document.createElement('div');
                    div.innerHTML = renderRichContent(citation.quoted_text, citation.sermon_id);
                    const cleanText = div.textContent || "";
                    
                    doc.setFont('times', 'italic');
                    doc.setFontSize(11);
                    doc.setTextColor(60);
                    const quoteLines = doc.splitTextToSize(cleanText, maxLineWidth - 10);
                    doc.text(quoteLines, margin + 5, y);
                    y += quoteLines.length * 5 + 4;

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.setTextColor(13, 148, 136);
                    const refText = `${citation.sermon_title_snapshot} (${citation.sermon_date_snapshot})${citation.paragraph_index ? ` — Para. ${citation.paragraph_index}` : ''}`;
                    doc.text(`— ${refText}`, pageWidth - margin, y, { align: 'right' });
                    y += 12;
                }
            }
            doc.save(`${note.title.toLowerCase().replace(/\s+/g, '_')}.pdf`);
            addNotification('Note exportée avec succès !', 'success');
        } catch (error) {
            addNotification("Erreur lors de l'exportation PDF.", 'error');
        }
    };

    const handlePrint = () => {
        if (window.electronAPI) window.electronAPI.printPage();
        else window.print();
    };

    return (
        <div className="flex-1 h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500 transition-colors duration-500">
            <div className="no-print flex flex-col h-full">
                <div className="px-6 h-14 border-b border-zinc-200/50 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-2xl z-20">
                    <div className="flex items-center gap-4">
                        <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
                            <NotebookPen className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-zinc-800 dark:text-zinc-100 leading-none">Journal d'Étude</h2>
                            <div className="flex items-center gap-2 mt-1 opacity-60">
                                <Sparkles className="w-2.5 h-2.5 text-teal-600" />
                                <span className="text-[7px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Chroniques Personnelles</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <ActionButton icon={Printer} tooltip={t.print} onClick={handlePrint} />
                        <ActionButton icon={FileText} tooltip={t.export_pdf} onClick={handleExportPdf} />
                        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-2" />
                        <button onClick={() => setActiveNoteId(null)} className="px-5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-95 text-zinc-600 dark:text-zinc-300 shadow-sm">
                            {t.reader_exit}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/20">
                    <div className="max-w-4xl mx-auto p-10 space-y-10 pb-40">
                        <div className="group bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-[40px] p-10 shadow-sm hover:shadow-xl transition-all duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-10 h-10 flex items-center justify-center bg-teal-600 text-white rounded-2xl text-sm shadow-xl shadow-teal-600/20">📝</div>
                                <div className="flex-1">
                                    {editingTitle ? (
                                        <input
                                            ref={titleInputRef}
                                            type="text"
                                            value={note.title}
                                            onChange={e => updateNote(note.id, { title: e.target.value })}
                                            onBlur={handleTitleBlur}
                                            onKeyDown={e => e.key === 'Enter' && handleTitleBlur()}
                                            className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight bg-transparent border-none focus:ring-0 p-0 w-full"
                                        />
                                    ) : (
                                        <h3 onClick={() => setEditingTitle(true)} className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight cursor-text hover:text-teal-600 transition-colors">
                                            {note.title}
                                        </h3>
                                    )}
                                </div>
                            </div>
                            <div className="serif-text text-xl leading-relaxed text-zinc-700 dark:text-zinc-300 pl-8 border-l-2 border-teal-600/20 selection:bg-teal-600/10">
                                {editingContent ? (
                                    <textarea
                                        ref={contentTextareaRef}
                                        value={note.content}
                                        onChange={e => {
                                            updateNote(note.id, { content: e.target.value });
                                            e.target.style.height = 'auto';
                                            e.target.style.height = `${e.target.scrollHeight}px`;
                                        }}
                                        onBlur={handleContentBlur}
                                        className="w-full bg-transparent border-none focus:ring-0 p-0 resize-none outline-none overflow-hidden font-medium"
                                        placeholder="Notez vos réflexions ici..."
                                    />
                                ) : (
                                    <div onClick={() => setEditingContent(true)} className="min-h-[60px] cursor-text">
                                        {note.content ? (
                                          <p className="font-medium">{note.content}</p>
                                        ) : (
                                          <span className="italic opacity-40 font-normal">Saisissez vos commentaires sur ces enseignements...</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-8">
                            <div className="flex items-center gap-5 px-6">
                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400 shrink-0">Encyclopédie Personnelle</span>
                                <div className="flex-1 h-0.5 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                            </div>

                            {note.citations.map((citation, idx) => {
                                const isVirtual = citation.sermon_id.startsWith('ia-') || citation.sermon_id.startsWith('definition') || citation.sermon_id.startsWith('search');
                                
                                return (
                                    <div 
                                        key={citation.id} 
                                        onClick={(e) => handleCitationClick(e, citation)}
                                        className={`group relative bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-[32px] p-8 shadow-sm transition-all duration-300 hover:shadow-2xl hover:border-teal-500/30 transform hover:-translate-y-1 ${!isVirtual ? 'cursor-pointer' : 'cursor-default'}`}
                                    >
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 flex items-center justify-center bg-teal-600 text-white rounded-xl text-[10px] font-black shadow-lg shadow-teal-600/20">{idx + 1}</div>
                                                <div className="flex flex-col">
                                                   <h4 className="text-[11px] font-black text-zinc-800 dark:text-zinc-100 uppercase tracking-widest group-hover:text-teal-600 transition-colors">
                                                       {citation.sermon_title_snapshot}
                                                   </h4>
                                                   <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter">{citation.sermon_date_snapshot}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 text-teal-600 dark:text-teal-400 px-3 py-1 rounded-xl border border-teal-600/10 font-bold text-[9px] uppercase tracking-widest">
                                                  <Hash className="w-3 h-3" />
                                                  <span>Para. {citation.paragraph_index ?? '—'}</span>
                                                </div>
                                                {!isVirtual && (
                                                   <div className="w-8 h-8 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-lg border border-teal-600/10 group-hover:bg-teal-600 group-hover:text-white transition-all">
                                                      <ExternalLink className="w-3.5 h-3.5" />
                                                   </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="relative overflow-hidden rounded-2xl bg-zinc-50/50 dark:bg-zinc-800/30 p-6 border border-zinc-100 dark:border-zinc-800/50">
                                            <Quote className="absolute -left-1 -top-1 w-12 h-12 text-teal-600/5 rotate-12" />
                                            <div className="prose-styles relative z-10">
                                                <div 
                                                  className="text-zinc-700 dark:text-zinc-300 text-base leading-loose italic serif-text selection:bg-teal-500/10"
                                                  dangerouslySetInnerHTML={{ __html: renderRichContent(citation.quoted_text, citation.sermon_id) }} 
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NoteEditor;
