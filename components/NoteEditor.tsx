import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import { 
  Printer, 
  FileText, 
  FileDown, 
  Link2, 
  ExternalLink, 
  NotebookPen, 
  Calendar, 
  MapPin, 
  Sparkles, 
  Hash, 
  Quote, 
  Image as ImageIcon, 
  ImagePlus, 
  Trash2, 
  X, 
  Search, 
  Plus, 
  Check, 
  Eye, 
  Folder,
  BookOpen
} from 'lucide-react';
import { Citation } from '../types';
import { exportNoteToDocx } from '../services/docxExportService';
import { processNoteData, cleanTextArtifacts } from '../utils/noteFormatter';

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
        mediaImages,
        mediaFolders,
        updateNote,
        setActiveNoteId,
        setSelectedSermonId,
        setJumpToText,
        setJumpToParagraph,
        setNavigatedFromNoteId,
        languageFilter,
        addNotification,
        addImageToNote,
        removeImageFromNote,
    } = useAppStore();

    const note = notes.find(n => n.id === activeNoteId);
    const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
    const t = translations[lang];

    const [editingTitle, setEditingTitle] = useState(false);
    const [editingContent, setEditingContent] = useState(false);
    const [isGalleryPickerOpen, setIsGalleryPickerOpen] = useState(false);
    const [gallerySearchQuery, setGallerySearchQuery] = useState('');
    const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL');
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
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

    const processedNote = processNoteData(note);

    const handleJumpToCitation = (sermonId: string, quotedText?: string, paragraphIndex?: number) => {
        if (sermonId.startsWith('ia-response') || sermonId.startsWith('definition-')) return; 
        
        setNavigatedFromNoteId(activeNoteId);
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
        const cleaned = cleanTextArtifacts(text);

        let processedText = cleaned.replace(
            /\[\[\[NOTE_EXTERNE\]\]\]/g, 
            "> **Note de l'Assistant :** L'information suivante est un complément basé sur des connaissances générales.\n\n>"
        );

        let formattedText = processedText.replace(/\[Réf:\s*([\w-]+)\s*\]/gi, (match, sermonId) => {
          const sermon = sermons.find(s => s.id === sermonId);
          if (sermon) {
            return `<a href="#" data-sermon-id="${sermonId}" class="sermon-ref text-teal-600 dark:text-teal-400 font-bold hover:underline decoration-teal-500/30 underline-offset-4 inline-flex items-center gap-1"><span>[${sermon.title}]</span></a>`;
          }
          return match;
        });

        if (sourceSermonId && !sourceSermonId.includes('ia-') && !sourceSermonId.includes('definition') && !formattedText.includes('sermon-ref')) {
            const sermon = sermons.find(s => s.id === sourceSermonId);
            if (sermon) {
                formattedText += ` <a href="#" data-sermon-id="${sourceSermonId}" class="sermon-ref text-teal-600 dark:text-teal-400 font-bold hover:underline decoration-teal-500/30 underline-offset-4">[Source: ${sermon.title}]</a>`;
            }
        }
        
        let html = marked(formattedText, { breaks: true }) as string;
        const replacement = '<blockquote class="border-l-4 border-teal-600/40 bg-teal-600/5 py-3 px-5 rounded-r-2xl my-6 text-sm italic serif-text relative"><div class="absolute -left-2 -top-2 w-6 h-6 bg-white dark:bg-zinc-900 rounded-full flex items-center justify-center border border-teal-600/20 text-teal-600/40"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 5-2.5 5s-2.5-1.25-2.5-2.5"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c1 0 1 0 1 1 0 2.5 0 5-2.5 5s-2.5-1.25-2.5-2.5"/></svg></div>';
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

    const cleanPdfText = (str: string): string => {
        if (!str) return '';
        return str
            .replace(/[«»]/g, '"')
            .replace(/[’‘`]/g, "'")
            .replace(/[—–]/g, '-')
            .replace(/…/g, '...')
            .replace(/\u00A0/g, ' ')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const handleExportPdf = async () => {
        if (!note) return;
        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.width;
            const margin = 15;
            const maxLineWidth = pageWidth - margin * 2;
            let y = margin;
            
            // Header
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(13, 148, 136);
            doc.text("KING'S SWORD  |  JOURNAL D'ÉTUDE & NOTES CHRONIQUES", margin, y);
            y += 8;

            doc.setDrawColor(13, 148, 136);
            doc.line(margin, y, pageWidth - margin, y);
            y += 12;

            // Title
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(15, 23, 42);
            const cleanTitle = cleanPdfText(processedNote.title);
            const titleLines = doc.splitTextToSize(cleanTitle, maxLineWidth);
            doc.text(titleLines, margin, y);
            y += titleLines.length * 9 + 6;

            // Metadata
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            const formattedDate = note.date 
              ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
              : new Date().toLocaleDateString('fr-FR');
            doc.text(`Date : ${formattedDate}   •   Sources référencées : ${processedNote.sources.length}`, margin, y);
            y += 14;

            // 1. Contenu principal
            if (processedNote.contentParagraphs.length > 0) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(13, 148, 136);
                doc.text("CONTENU PRINCIPAL", margin, y);
                y += 8;

                doc.setFont('times', 'normal');
                doc.setFontSize(11);
                doc.setTextColor(30, 41, 59);

                for (const pText of processedNote.contentParagraphs) {
                    const cleanP = cleanPdfText(pText);
                    if (!cleanP) continue;
                    if (y > doc.internal.pageSize.height - 25) { doc.addPage(); y = margin; }
                    const pLines = doc.splitTextToSize(cleanP, maxLineWidth);
                    doc.text(pLines, margin, y);
                    y += pLines.length * 5.5 + 6;
                }
                y += 6;
            }

            // 2. Citations bibliques
            if (processedNote.scriptureCitations.length > 0) {
                if (y > doc.internal.pageSize.height - 35) { doc.addPage(); y = margin; }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(13, 148, 136);
                doc.text("CITATIONS BIBLIQUES", margin, y);
                y += 8;

                for (const sc of processedNote.scriptureCitations) {
                    if (y > doc.internal.pageSize.height - 30) { doc.addPage(); y = margin; }

                    doc.setFont('times', 'italic');
                    doc.setFontSize(10.5);
                    doc.setTextColor(51, 65, 85);
                    const cleanQuote = cleanPdfText(sc.quote);
                    const qLines = doc.splitTextToSize(`"${cleanQuote}"`, maxLineWidth - 10);
                    doc.text(qLines, margin + 5, y);
                    y += qLines.length * 5 + 4;

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.setTextColor(13, 148, 136);
                    const refText = cleanPdfText(`${sc.reference}${sc.sourceIndex ? ` [${sc.sourceIndex}]` : ''}`);
                    doc.text(refText, pageWidth - margin, y, { align: 'right' });
                    y += 10;
                }
                y += 6;
            }

            // 3. Citations & enseignements
            if (processedNote.teachingCitations.length > 0) {
                if (y > doc.internal.pageSize.height - 35) { doc.addPage(); y = margin; }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(13, 148, 136);
                doc.text("CITATIONS & ENSEIGNEMENTS", margin, y);
                y += 8;

                for (const tc of processedNote.teachingCitations) {
                    if (y > doc.internal.pageSize.height - 30) { doc.addPage(); y = margin; }

                    doc.setFont('times', 'italic');
                    doc.setFontSize(10.5);
                    doc.setTextColor(51, 65, 85);
                    const cleanQuote = cleanPdfText(tc.quote);
                    const qLines = doc.splitTextToSize(`"${cleanQuote}"`, maxLineWidth - 10);
                    doc.text(qLines, margin + 5, y);
                    y += qLines.length * 5 + 4;

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.setTextColor(13, 148, 136);
                    const refText = cleanPdfText(`${tc.sourceTitle}${tc.sourceMeta ? ` - ${tc.sourceMeta}` : ''}${tc.sourceIndex ? ` [${tc.sourceIndex}]` : ''}`);
                    doc.text(refText, pageWidth - margin, y, { align: 'right' });
                    y += 10;
                }
                y += 6;
            }

            // 4. Sources & Références
            if (processedNote.sources.length > 0) {
                if (y > doc.internal.pageSize.height - 35) { doc.addPage(); y = margin; }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(13, 148, 136);
                doc.text("SOURCES & RÉFÉRENCES", margin, y);
                y += 8;

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9.5);
                doc.setTextColor(51, 65, 85);

                for (const src of processedNote.sources) {
                    if (y > doc.internal.pageSize.height - 25) { doc.addPage(); y = margin; }
                    const srcLine = cleanPdfText(`[${src.index}] ${src.formattedLine}`);
                    const sLines = doc.splitTextToSize(srcLine, maxLineWidth);
                    doc.text(sLines, margin, y);
                    y += sLines.length * 5 + 4;
                }
            }

            doc.save(`${processedNote.title.toLowerCase().replace(/\s+/g, '_')}.pdf`);
            addNotification('Note exportée en PDF avec succès !', 'success');
        } catch (error) {
            console.error("PDF export error:", error);
            addNotification("Erreur lors de l'exportation PDF.", 'error');
        }
    };

    const handleExportDocx = async () => {
        if (!note) return;
        addNotification("Génération du document Word (.docx)...", "info");
        const success = await exportNoteToDocx(note);
        if (success) {
            addNotification("Note exportée au format Word (.docx) avec succès !", "success");
        } else {
            addNotification("Erreur lors de l'exportation Word.", "error");
        }
    };

    const handlePrint = () => {
        try {
            if (window.electronAPI?.printPage) {
                window.electronAPI.printPage();
                return;
            }

            window.focus();
            window.print();
        } catch (err) {
            console.error("Print error:", err);
            const printEl = document.getElementById('printable-note-container');
            if (printEl) {
                const printWin = window.open('', '_blank');
                if (printWin) {
                    printWin.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>${processedNote.title}</title>
                            <style>
                                body { font-family: system-ui, -apple-system, sans-serif; padding: 30px; color: #000; background: #fff; line-height: 1.6; }
                                h1 { font-size: 20px; color: #0f766e; text-transform: uppercase; border-bottom: 2px solid #0f766e; padding-bottom: 8px; }
                                h2 { font-size: 22px; color: #0f172a; margin-top: 16px; text-transform: uppercase; }
                                h3 { font-size: 13px; color: #0f766e; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 24px; }
                                p { font-size: 13.5px; margin-bottom: 10px; color: #1e293b; }
                                .page-break-inside-avoid { page-break-inside: avoid; break-inside: avoid; }
                                img { max-width: 100%; max-height: 250px; object-fit: contain; }
                            </style>
                        </head>
                        <body>
                            ${printEl.innerHTML}
                            <script>
                                window.onload = function() {
                                    window.print();
                                    setTimeout(function() { window.close(); }, 500);
                                };
                            </script>
                        </body>
                        </html>
                    `);
                    printWin.document.close();
                } else {
                    addNotification("Veuillez autoriser les fenêtres surgissantes pour l'impression.", "info");
                }
            }
        }
    };

    const filteredGalleryImages = mediaImages.filter(img => {
        const matchesFolder = selectedFolderId === 'ALL' || img.folderId === selectedFolderId || (selectedFolderId === 'UNASSIGNED' && !img.folderId);
        const matchesQuery = !gallerySearchQuery.trim() || img.name.toLowerCase().includes(gallerySearchQuery.toLowerCase());
        return matchesFolder && matchesQuery;
    });

    return (
        <div className="flex-1 h-full flex flex-col bg-slate-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500 transition-colors">
            {/* Vue écran interactive */}
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
                        <ActionButton icon={FileDown} tooltip="Exporter au format Word (.docx)" onClick={handleExportDocx} />
                        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-2" />
                        <button onClick={() => setActiveNoteId(null)} data-tooltip="Fermer et retourner au lecteur" className="px-5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-95 text-zinc-600 dark:text-zinc-300 shadow-sm">
                            {t.reader_exit}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/20">
                    <div className="max-w-4xl mx-auto p-10 space-y-10 pb-40">
                        {/* Bloc Titre et Contenu Principal */}
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
                                        <h3 onClick={() => setEditingTitle(true)} data-tooltip="Cliquer pour modifier le titre" className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight cursor-text hover:text-teal-600 transition-colors">
                                            {processedNote.title}
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
                                    <div onClick={() => setEditingContent(true)} data-tooltip="Cliquer pour modifier les notes" className="min-h-[60px] cursor-text">
                                        {processedNote.contentParagraphs.length > 0 ? (
                                          <div className="space-y-4">
                                            {processedNote.contentParagraphs.map((p, idx) => (
                                              <p key={idx} className="font-medium leading-relaxed">{p}</p>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="italic opacity-40 font-normal">Saisissez vos commentaires sur ces enseignements...</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Section Images rattachées */}
                            <div className="mt-8 pt-6 border-t border-zinc-100 dark:border-zinc-800">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <ImageIcon className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                                        <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                                            Images & Illustrations jointes {note.images?.length ? `(${note.images.length})` : ''}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsGalleryPickerOpen(true)}
                                        className="px-3.5 py-1.5 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                    >
                                        <ImagePlus className="w-3.5 h-3.5" />
                                        <span>Ajouter de la galerie</span>
                                    </button>
                                </div>

                                {note.images && note.images.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                        {note.images.map((img) => (
                                            <div 
                                                key={img.id}
                                                className="group/img relative bg-zinc-50 dark:bg-zinc-800/80 rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col shadow-xs hover:shadow-md transition-all"
                                            >
                                                <div 
                                                    onClick={() => setPreviewImageUrl(img.url)}
                                                    className="relative aspect-video w-full bg-black/10 cursor-pointer overflow-hidden flex items-center justify-center"
                                                    title="Cliquer pour agrandir"
                                                >
                                                    <img 
                                                        src={img.url} 
                                                        alt={img.name || ''} 
                                                        className="max-h-full max-w-full object-contain group-hover/img:scale-105 transition-transform duration-200" 
                                                        referrerPolicy="no-referrer"
                                                    />
                                                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white">
                                                        <Eye className="w-5 h-5 drop-shadow" />
                                                    </div>
                                                </div>

                                                <div className="p-2.5 flex items-center justify-between gap-2 bg-white dark:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-700/60">
                                                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate flex-1" title={img.name || img.caption}>
                                                        {img.caption || img.name || 'Image'}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeImageFromNote(note.id, img.id)}
                                                        className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0"
                                                        title="Retirer cette image de la note"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div 
                                        onClick={() => setIsGalleryPickerOpen(true)}
                                        className="p-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-teal-500/50 hover:bg-teal-50/20 dark:hover:bg-teal-950/10 cursor-pointer transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-500"
                                    >
                                        <ImagePlus className="w-8 h-8 opacity-60 text-teal-600 dark:text-teal-400" />
                                        <span className="text-xs font-medium text-center">Aucune image rattachée à cette note. Cliquer pour parcourir la galerie média.</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Citations et Sources organisées */}
                        <div className="space-y-8">
                            <div className="flex items-center gap-5 px-6">
                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400 shrink-0">Encyclopédie & Références</span>
                                <div className="flex-1 h-0.5 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                            </div>

                            {/* Citations bibliques */}
                            {processedNote.scriptureCitations.length > 0 && (
                              <div className="space-y-4">
                                <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 px-2 flex items-center gap-2">
                                  <BookOpen className="w-4 h-4" />
                                  <span>Citations Bibliques</span>
                                </h4>
                                {processedNote.scriptureCitations.map((sc, idx) => (
                                  <div key={idx} className="bg-white dark:bg-zinc-900 border border-teal-600/20 dark:border-teal-900/30 rounded-2xl p-6 shadow-xs relative">
                                    <Quote className="absolute -left-1 -top-1 w-10 h-10 text-teal-600/10 rotate-12" />
                                    <blockquote className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-relaxed mb-3">
                                      « {sc.quote} »
                                    </blockquote>
                                    <div className="flex justify-end items-center gap-2">
                                      <span className="text-xs font-bold text-teal-700 dark:text-teal-300">
                                        {sc.reference}
                                      </span>
                                      {sc.sourceIndex && (
                                        <span className="text-[10px] font-black bg-teal-600/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full border border-teal-600/20">
                                          [{sc.sourceIndex}]
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Citations d'enseignements / Sermons */}
                            {processedNote.teachingCitations.length > 0 && (
                              <div className="space-y-4">
                                <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 px-2 flex items-center gap-2">
                                  <Quote className="w-4 h-4" />
                                  <span>Citations d'Enseignements</span>
                                </h4>
                                {processedNote.teachingCitations.map((tc, idx) => (
                                  <div key={idx} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs relative">
                                    <blockquote className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-relaxed mb-3">
                                      « {tc.quote} »
                                    </blockquote>
                                    <div className="flex justify-end items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-400">
                                      <span><strong className="text-teal-600 dark:text-teal-400">{tc.sourceTitle}</strong> {tc.sourceMeta ? `— ${tc.sourceMeta}` : ''}</span>
                                      {tc.sourceIndex && (
                                        <span className="text-[10px] font-black bg-teal-600/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full border border-teal-600/20">
                                          [{tc.sourceIndex}]
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Section Sources & Bibliographie */}
                            {processedNote.sources.length > 0 && (
                              <div className="mt-10 pt-8 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
                                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                                  <Link2 className="w-4 h-4 text-teal-600" />
                                  <span>Sources & Références</span>
                                </h4>
                                <div className="space-y-2 bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                                  {processedNote.sources.map((src) => (
                                    <div key={src.index} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                                      <span className="font-bold text-teal-600 dark:text-teal-400 shrink-0">[{src.index}]</span>
                                      <span>{src.formattedLine}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Zone dédiée à l'impression (Imprimante / window.print) */}
            <div id="printable-note-container" className="hidden print:block p-8 bg-white text-black font-sans leading-relaxed">
                <div className="border-b-2 border-teal-700 pb-3 mb-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-xl font-bold uppercase text-teal-800">King's Sword</h1>
                        <p className="text-xs text-slate-500 uppercase tracking-widest">Document d'Étude & Notes Chroniques</p>
                    </div>
                    <span className="text-xs text-slate-400">{new Date(note.date || note.creationDate).toLocaleDateString()}</span>
                </div>

                <h2 className="text-2xl font-bold mb-4 uppercase text-slate-900">{processedNote.title}</h2>

                {processedNote.contentParagraphs.length > 0 && (
                    <div className="mb-8 space-y-3">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Contenu Principal</h3>
                        {processedNote.contentParagraphs.map((p, i) => (
                            <p key={i} className="text-sm text-slate-800 leading-relaxed">{p}</p>
                        ))}
                    </div>
                )}

                {processedNote.scriptureCitations.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Citations Bibliques</h3>
                        {processedNote.scriptureCitations.map((sc, i) => (
                            <div key={i} className="pl-4 border-l-2 border-teal-600 italic text-sm text-slate-800 my-2 page-break-inside-avoid">
                                <p>« {sc.quote} »</p>
                                <p className="text-right text-xs font-bold text-teal-800 not-italic mt-1">
                                    {sc.reference} {sc.sourceIndex ? `[${sc.sourceIndex}]` : ''}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {processedNote.teachingCitations.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Citations & Enseignements</h3>
                        {processedNote.teachingCitations.map((tc, i) => (
                            <div key={i} className="pl-4 border-l-2 border-slate-400 italic text-sm text-slate-800 my-2 page-break-inside-avoid">
                                <p>« {tc.quote} »</p>
                                <p className="text-right text-xs font-bold text-slate-700 not-italic mt-1">
                                    {tc.sourceTitle} {tc.sourceMeta ? `— ${tc.sourceMeta}` : ''} {tc.sourceIndex ? `[${tc.sourceIndex}]` : ''}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {note.images && note.images.length > 0 && (
                    <div className="mb-8 space-y-4 page-break-inside-avoid">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Images & Illustrations</h3>
                        <div className="grid grid-cols-2 gap-4">
                            {note.images.map((img, i) => (
                                <div key={i} className="flex flex-col items-center border border-slate-200 p-2 rounded">
                                    <img src={img.url} alt={img.caption || img.name || ''} className="max-h-48 object-contain" />
                                    {(img.caption || img.name) && <p className="text-xs italic text-slate-600 mt-1">{img.caption || img.name}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {processedNote.sources.length > 0 && (
                    <div className="mt-8 pt-4 border-t border-slate-300 page-break-inside-avoid">
                        <h3 className="text-sm font-bold uppercase text-slate-900 mb-2">Sources & Références</h3>
                        <ul className="space-y-1 text-xs text-slate-700">
                            {processedNote.sources.map((src) => (
                                <li key={src.index}>
                                    <strong>[{src.index}]</strong> {src.formattedLine}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Modal Sélecteur d'Images de la Galerie */}
            {isGalleryPickerOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/50">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
                                    <ImagePlus className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black uppercase text-zinc-800 dark:text-white tracking-wider">
                                        Sélectionner des images de la galerie
                                    </h3>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Cliquez sur une image pour l'ajouter à votre note
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsGalleryPickerOpen(false)}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Barre de Recherche et Filtre par Dossier */}
                        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800/80 flex flex-col sm:flex-row gap-3 items-center justify-between bg-zinc-50/30 dark:bg-zinc-950/20">
                            <div className="relative flex-1 w-full">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                                <input
                                    type="text"
                                    value={gallerySearchQuery}
                                    onChange={e => setGallerySearchQuery(e.target.value)}
                                    placeholder="Rechercher une image..."
                                    className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                                />
                            </div>

                            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar w-full sm:w-auto shrink-0 pb-1 sm:pb-0">
                                <button
                                    type="button"
                                    onClick={() => setSelectedFolderId('ALL')}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                                        selectedFolderId === 'ALL'
                                            ? 'bg-teal-600 text-white'
                                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                    }`}
                                >
                                    Toutes ({mediaImages.length})
                                </button>
                                {mediaFolders.map(folder => (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => setSelectedFolderId(folder.id)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${
                                            selectedFolderId === folder.id
                                                ? 'bg-teal-600 text-white'
                                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                        }`}
                                    >
                                        <Folder className="w-3 h-3" />
                                        <span>{folder.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Grille des Images */}
                        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/20">
                            {filteredGalleryImages.length === 0 ? (
                                <div className="h-48 flex flex-col items-center justify-center text-zinc-400 gap-2">
                                    <ImageIcon className="w-8 h-8 opacity-40" />
                                    <p className="text-xs">Aucune image trouvée</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {filteredGalleryImages.map(img => {
                                        const isAlreadyAttached = note.images?.some(i => i.url === img.url);

                                        return (
                                            <div
                                                key={img.id}
                                                onClick={() => {
                                                    if (!isAlreadyAttached) {
                                                        addImageToNote(note.id, { url: img.url, name: img.name });
                                                    }
                                                }}
                                                className={`group relative bg-white dark:bg-zinc-800 rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col cursor-pointer ${
                                                    isAlreadyAttached 
                                                        ? 'border-teal-500 ring-2 ring-teal-500/30 opacity-75'
                                                        : 'border-zinc-200 dark:border-zinc-700 hover:border-teal-500/60 hover:shadow-lg'
                                                }`}
                                            >
                                                <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden flex items-center justify-center">
                                                    <img
                                                        src={img.url}
                                                        alt={img.name}
                                                        className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-200"
                                                        referrerPolicy="no-referrer"
                                                    />
                                                    {isAlreadyAttached && (
                                                        <div className="absolute inset-0 bg-teal-600/20 backdrop-blur-3xs flex items-center justify-center text-white font-bold text-xs gap-1">
                                                            <Check className="w-5 h-5 bg-teal-600 rounded-full p-1" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="p-2.5 bg-white dark:bg-zinc-800 flex items-center justify-between">
                                                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate" title={img.name}>
                                                        {img.name}
                                                    </span>
                                                    {!isAlreadyAttached && (
                                                        <Plus className="w-4 h-4 text-teal-600 dark:text-teal-400 group-hover:scale-110 transition-transform shrink-0" />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setIsGalleryPickerOpen(false)}
                                className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-md shadow-teal-600/20"
                            >
                                Terminer
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Aperçu Plein Écran de l'Image */}
            {previewImageUrl && (
                <div 
                    onClick={() => setPreviewImageUrl(null)}
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 cursor-zoom-out"
                >
                    <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center justify-center">
                        <button
                            type="button"
                            onClick={() => setPreviewImageUrl(null)}
                            className="absolute -top-12 right-0 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <img
                            src={previewImageUrl}
                            alt=""
                            className="max-h-[85vh] max-w-full object-contain rounded-2xl shadow-2xl"
                            referrerPolicy="no-referrer"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default NoteEditor;
