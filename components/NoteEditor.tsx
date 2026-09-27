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
  Upload,
  Trash2, 
  X, 
  Search, 
  Plus, 
  Check, 
  Eye, 
  Folder,
  BookOpen,
  ScrollText,
  GripVertical,
  ChevronUp,
  ChevronDown,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Type
} from 'lucide-react';
import { Citation, NoteSeparator } from '../types';
import { exportNoteToDocx } from '../services/docxExportService';
import { processNoteData, cleanTextArtifacts, NoteSectionItem } from '../utils/noteFormatter';
import { detectImageMeta } from '../services/imageMediaService';

const ActionButton = ({ onClick, icon: Icon, tooltip }: { onClick: () => void; icon: React.ElementType; tooltip: string }) => (
  <button 
    onClick={onClick} 
    data-tooltip={tooltip}
    className="w-9 h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-zinc-500 hover:text-teal-600 dark:text-zinc-400"
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
        loadMediaImages,
        loadMediaFolders,
        addMediaImage,
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
        removeCitationFromNote,
        updateNoteCitations,
        setSidebarOpen,
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
    const [isImportingDirect, setIsImportingDirect] = useState(false);

    // États de Drag and Drop pour la réorganisation des sources et références
    const [draggedSourceIdx, setDraggedSourceIdx] = useState<number | null>(null);
    const [dragOverSourceIdx, setDragOverSourceIdx] = useState<number | null>(null);
    const [draggedCitationId, setDraggedCitationId] = useState<string | null>(null);
    const [dragOverCitationId, setDragOverCitationId] = useState<string | null>(null);

    // États pour les séparateurs / sous-titres et commentaires indépendants
    const [insertingSeparatorCategory, setInsertingSeparatorCategory] = useState<'scripture' | 'church_age' | 'teaching' | null>(null);
    const [insertingSeparatorOrderIndex, setInsertingSeparatorOrderIndex] = useState<number>(0);
    const [insertingSeparatorType, setInsertingSeparatorType] = useState<'subtitle' | 'comment'>('subtitle');
    const [insertingSeparatorText, setInsertingSeparatorText] = useState<string>('');

    const [editingSeparatorId, setEditingSeparatorId] = useState<string | null>(null);
    const [editingSeparatorText, setEditingSeparatorText] = useState<string>('');

    const titleInputRef = useRef<HTMLInputElement>(null);
    const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
    const directFileInputRef = useRef<HTMLInputElement>(null);

    // Ferme automatiquement le panneau de la bibliothèque lors de la consultation du journal
    useEffect(() => {
        setSidebarOpen(false);
    }, [setSidebarOpen]);

    // Charge les images et dossiers média au montage ou à l'ouverture de la galerie
    useEffect(() => {
        loadMediaImages();
        loadMediaFolders();
    }, [loadMediaImages, loadMediaFolders]);

    useEffect(() => {
        if (isGalleryPickerOpen) {
            loadMediaImages();
            loadMediaFolders();
        }
    }, [isGalleryPickerOpen, loadMediaImages, loadMediaFolders]);

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

    /**
     * Réorganisation par Drag and Drop de l'ordre des sources & références
     */
    const handleReorderSources = async (fromIdx: number, toIdx: number) => {
        if (!note || fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
        const currentSources = [...processedNote.sources];
        if (fromIdx >= currentSources.length || toIdx >= currentSources.length) return;

        const [movedSource] = currentSources.splice(fromIdx, 1);
        currentSources.splice(toIdx, 0, movedSource);

        const newSourceOrder = currentSources.map(s => s.id);

        const existingCitations = note.citations || [];
        const reorderedCitations: Citation[] = [];
        const addedIds = new Set<string>();

        for (const src of currentSources) {
            if (src.citationIds && src.citationIds.length > 0) {
                for (const cId of src.citationIds) {
                    const found = existingCitations.find(c => c.id === cId);
                    if (found && !addedIds.has(found.id)) {
                        reorderedCitations.push(found);
                        addedIds.add(found.id);
                    }
                }
            }
        }

        // Ajouter les éventuelles citations restantes
        for (const c of existingCitations) {
            if (!addedIds.has(c.id)) {
                reorderedCitations.push(c);
            }
        }

        await updateNote(note.id, {
            sourceOrder: newSourceOrder,
            citations: reorderedCitations
        });
        addNotification("Ordre des sources et références mis à jour.", "info");
    };

    /**
     * Réorganisation par Drag and Drop directe d'une citation
     */
    const handleReorderCitations = async (draggedId: string, targetId: string) => {
        if (!note || draggedId === targetId) return;
        const currentCitations = [...(note.citations || [])];
        const fromIdx = currentCitations.findIndex(c => c.id === draggedId);
        const toIdx = currentCitations.findIndex(c => c.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = currentCitations.splice(fromIdx, 1);
        currentCitations.splice(toIdx, 0, moved);

        await updateNote(note.id, {
            citations: currentCitations
        });
        addNotification("Position de la citation mise à jour.", "info");
    };

    /**
     * Déplacement d'un cran (haut/bas) d'une citation via bouton flèche
     */
    const handleMoveCitation = async (
        citationId: string, 
        direction: 'up' | 'down',
        list?: { citationId: string }[]
    ) => {
        if (!note || !citationId) return;
        const currentCitations = [...(note.citations || [])];

        if (list && list.length > 1) {
            const listIdx = list.findIndex(item => item.citationId === citationId);
            if (listIdx === -1) return;
            const targetListIdx = direction === 'up' ? listIdx - 1 : listIdx + 1;
            if (targetListIdx < 0 || targetListIdx >= list.length) return;

            const targetCitationId = list[targetListIdx].citationId;
            const fromIdx = currentCitations.findIndex(c => c.id === citationId);
            const toIdx = currentCitations.findIndex(c => c.id === targetCitationId);
            if (fromIdx === -1 || toIdx === -1) return;

            const [moved] = currentCitations.splice(fromIdx, 1);
            currentCitations.splice(toIdx, 0, moved);
        } else {
            const fromIdx = currentCitations.findIndex(c => c.id === citationId);
            if (fromIdx === -1) return;
            const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1;
            if (toIdx < 0 || toIdx >= currentCitations.length) return;

            const [moved] = currentCitations.splice(fromIdx, 1);
            currentCitations.splice(toIdx, 0, moved);
        }

        await updateNote(note.id, {
            citations: currentCitations
        });
        addNotification("Position de la citation mise à jour.", "info");
    };

    /**
     * Déplacement unifié pour les items (citations ou séparateurs indépendants)
     */
    const handleMoveSectionItem = async (
        itemId: string,
        direction: 'up' | 'down',
        items: NoteSectionItem[],
        category: 'scripture' | 'church_age' | 'teaching'
    ) => {
        if (!note || !itemId || items.length <= 1) return;
        const itemIndex = items.findIndex(it => it.id === itemId);
        if (itemIndex === -1) return;
        const targetIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
        if (targetIndex < 0 || targetIndex >= items.length) return;

        // Créer une copie réordonnée des items de cette section
        const newItems = [...items];
        const [movedItem] = newItems.splice(itemIndex, 1);
        newItems.splice(targetIndex, 0, movedItem);

        // Mettre à jour les orderIndex des séparateurs de cette catégorie
        const existingSeparators = [...(note.separators || [])];
        const otherCatSeparators = existingSeparators.filter(s => s.category !== category);
        
        const updatedCatSeparators: NoteSeparator[] = [];
        const reorderedCitationIds: string[] = [];

        newItems.forEach((it, idx) => {
            const calculatedOrder = idx * 10;
            if (it.kind === 'separator') {
                const origSep = existingSeparators.find(s => s.id === it.id);
                if (origSep) {
                    updatedCatSeparators.push({
                        ...origSep,
                        orderIndex: calculatedOrder
                    });
                }
            } else {
                reorderedCitationIds.push(it.citationId);
            }
        });

        // Mettre à jour l'ordre des citations dans note.citations
        const currentCitations = [...(note.citations || [])];
        if (reorderedCitationIds.length > 0) {
            const catCitationsMap = new Map(currentCitations.map(c => [c.id, c]));
            let citIdx = 0;
            for (let i = 0; i < currentCitations.length; i++) {
                if (reorderedCitationIds.includes(currentCitations[i].id)) {
                    const targetId = reorderedCitationIds[citIdx];
                    if (targetId && catCitationsMap.has(targetId)) {
                        currentCitations[i] = catCitationsMap.get(targetId)!;
                        citIdx++;
                    }
                }
            }
        }

        await updateNote(note.id, {
            citations: currentCitations,
            separators: [...otherCatSeparators, ...updatedCatSeparators]
        });
        addNotification("Position mise à jour.", "info");
    };

    /**
     * Gestion des séparateurs / sous-titres et commentaires indépendants
     */
    const handleOpenInsertSeparator = (
        category: 'scripture' | 'church_age' | 'teaching',
        orderIndex: number,
        initialType: 'subtitle' | 'comment' = 'subtitle'
    ) => {
        setInsertingSeparatorCategory(category);
        setInsertingSeparatorOrderIndex(orderIndex);
        setInsertingSeparatorType(initialType);
        setInsertingSeparatorText('');
    };

    const handleSaveNewSeparator = async () => {
        if (!note || !insertingSeparatorCategory || !insertingSeparatorText.trim()) {
            setInsertingSeparatorCategory(null);
            return;
        }

        const newSep: NoteSeparator = {
            id: `sep_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: insertingSeparatorType,
            text: insertingSeparatorText.trim(),
            category: insertingSeparatorCategory,
            orderIndex: insertingSeparatorOrderIndex,
            createdAt: new Date().toISOString()
        };

        const currentSeparators = [...(note.separators || [])];
        currentSeparators.push(newSep);

        await updateNote(note.id, {
            separators: currentSeparators
        });

        setInsertingSeparatorCategory(null);
        setInsertingSeparatorText('');
        addNotification(
            insertingSeparatorType === 'subtitle' ? "Sous-titre séparateur ajouté." : "Commentaire autonome ajouté.",
            "success"
        );
    };

    const handleStartEditSeparator = (separatorId: string, currentText: string) => {
        setEditingSeparatorId(separatorId);
        setEditingSeparatorText(currentText);
    };

    const handleSaveEditSeparator = async (separatorId: string) => {
        if (!note || !separatorId) return;
        const currentSeparators = (note.separators || []).map(s => {
            if (s.id === separatorId) {
                return { ...s, text: editingSeparatorText.trim() || s.text };
            }
            return s;
        });

        await updateNote(note.id, {
            separators: currentSeparators
        });
        setEditingSeparatorId(null);
        setEditingSeparatorText('');
        addNotification("Séparateur mis à jour.", "info");
    };

    const handleDeleteSeparator = async (separatorId: string) => {
        if (!note || !separatorId) return;
        const currentSeparators = (note.separators || []).filter(s => s.id !== separatorId);

        await updateNote(note.id, {
            separators: currentSeparators
        });
        if (editingSeparatorId === separatorId) {
            setEditingSeparatorId(null);
        }
        addNotification("Séparateur supprimé.", "info");
    };

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
            .replace(/[—–─━─]/g, '-')
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
            const pageHeight = doc.internal.pageSize.height;
            const margin = 15;
            const maxLineWidth = pageWidth - margin * 2;
            let y = margin;
            
            const checkPageBreak = (neededHeight: number) => {
                if (y + neededHeight > pageHeight - 20) {
                    doc.addPage();
                    y = margin;
                }
            };

            // Header
            const cleanTitle = cleanPdfText(processedNote.title);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(13, 148, 136);
            doc.text(`KING'S SWORD  |  ${cleanTitle}`, margin, y);
            y += 8;

            doc.setDrawColor(13, 148, 136);
            doc.setLineWidth(0.5);
            doc.line(margin, y, pageWidth - margin, y);
            y += 12;

            // Metadata (Date uniquement)
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            const formattedDate = note.date 
              ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
              : new Date().toLocaleDateString('fr-FR');
            doc.text(`Date : ${formattedDate}`, margin, y);
            y += 14;

            // 1. Contenu principal
            if (processedNote.contentParagraphs.length > 0) {
                checkPageBreak(25);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(13, 148, 136);
                doc.text("CONTENU PRINCIPAL", margin, y);
                y += 7;

                doc.setFont('times', 'normal');
                doc.setFontSize(10.5);
                doc.setTextColor(30, 41, 59);

                for (const pText of processedNote.contentParagraphs) {
                    const cleanP = cleanPdfText(pText);
                    if (!cleanP) continue;
                    const pLines = doc.splitTextToSize(cleanP, maxLineWidth);
                    checkPageBreak(pLines.length * 5 + 6);
                    doc.text(pLines, margin, y);
                    y += pLines.length * 5 + 4;
                }
                y += 6;
            }

            // Helper to render section items (Citations + Separators)
            const renderPdfSection = (
                sectionTitle: string, 
                items: NoteSectionItem[], 
                titleColor: [number, number, number] = [13, 148, 136],
                subColor: [number, number, number] = [13, 148, 136]
            ) => {
                if (!items || items.length === 0) return;

                checkPageBreak(30);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
                doc.text(sectionTitle, margin, y);
                y += 8;

                for (const item of items) {
                    if (item.kind === 'separator') {
                        if (item.separatorType === 'subtitle') {
                            const cleanSub = cleanPdfText(item.text);
                            checkPageBreak(18);
                            y += 4;
                            doc.setFont('helvetica', 'bold');
                            doc.setFontSize(10);
                            doc.setTextColor(subColor[0], subColor[1], subColor[2]);
                            
                            const textW = doc.getTextWidth(cleanSub);
                            const startX = Math.max(margin, (pageWidth - textW) / 2);
                            doc.text(cleanSub, startX, y);
                            y += 8;
                        } else {
                            // Commentaire autonome
                            const cleanComment = cleanPdfText(item.text);
                            const commentLines = doc.splitTextToSize(cleanComment, maxLineWidth - 12);
                            const neededH = commentLines.length * 4.8 + 12;
                            checkPageBreak(neededH);

                            const startY = y;
                            doc.setFont('helvetica', 'bold');
                            doc.setFontSize(9);
                            doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
                            doc.text("Remarque / Commentaire :", margin + 4, y);
                            y += 5;

                            doc.setFont('times', 'italic');
                            doc.setFontSize(10);
                            doc.setTextColor(71, 85, 105);
                            doc.text(commentLines, margin + 4, y);
                            y += commentLines.length * 4.8 + 3;

                            // Left vertical bar for comment
                            doc.setDrawColor(titleColor[0], titleColor[1], titleColor[2]);
                            doc.setLineWidth(0.8);
                            doc.line(margin, startY - 2, margin, y - 2);

                            y += 5;
                        }
                    } else {
                        // Citation
                        const cleanQuote = cleanPdfText(item.quote);
                        const qLines = doc.splitTextToSize(`« ${cleanQuote} »`, maxLineWidth - 12);
                        const neededH = qLines.length * 4.8 + 14;
                        checkPageBreak(neededH);

                        const startQY = y;
                        doc.setFont('times', 'italic');
                        doc.setFontSize(10.5);
                        doc.setTextColor(51, 65, 85);
                        doc.text(qLines, margin + 4, y);
                        y += qLines.length * 4.8 + 3;

                        doc.setFont('helvetica', 'bold');
                        doc.setFontSize(8.5);
                        doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);

                        let refLabel = item.reference || '';
                        if (!refLabel) {
                            const meta = item.sourceMeta ? ` - ${item.sourceMeta}` : '';
                            refLabel = `${item.sourceTitle || 'Source'}${meta}`;
                        }
                        const fullRef = cleanPdfText(`${refLabel}${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`);
                        doc.text(fullRef, pageWidth - margin, y, { align: 'right' });
                        y += 4;

                        // Left vertical accent line for quote
                        doc.setDrawColor(203, 213, 225);
                        doc.setLineWidth(0.6);
                        doc.line(margin, startQY - 2, margin, y);

                        y += 6;
                    }
                }
                y += 4;
            };

            // 2. Citations bibliques
            renderPdfSection(
                "CITATIONS BIBLIQUES", 
                processedNote.scriptureItems, 
                [13, 148, 136], // Deep Teal
                [13, 148, 136]
            );

            // 3. Citations de l'Exposé des Sept Âges
            renderPdfSection(
                "CITATIONS DE L'EXPOSÉ DES SEPT ÂGES", 
                processedNote.churchAgeItems, 
                [13, 148, 136], 
                [180, 83, 9] // Warm Amber
            );

            // 4. Citations & Enseignements
            renderPdfSection(
                "CITATIONS & ENSEIGNEMENTS", 
                processedNote.teachingItems, 
                [13, 148, 136], 
                [51, 65, 85] // Slate
            );

            // 5. Sources & Références (Bibliographie)
            if (processedNote.sources.length > 0) {
                checkPageBreak(30);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(13, 148, 136);
                doc.text(`SOURCES & RÉFÉRENCES (${processedNote.sources.length})`, margin, y);
                y += 8;

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(51, 65, 85);

                for (const src of processedNote.sources) {
                    const srcLine = cleanPdfText(`[${src.index}] ${src.formattedLine}`);
                    const sLines = doc.splitTextToSize(srcLine, maxLineWidth);
                    checkPageBreak(sLines.length * 4.5 + 4);
                    doc.text(sLines, margin, y);
                    y += sLines.length * 4.5 + 3;
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
                                body { font-family: system-ui, -apple-system, sans-serif; padding: 30px; color: #1e293b; background: #fff; line-height: 1.6; }
                                h1 { font-size: 20px; color: #0f766e; text-transform: uppercase; border-bottom: 2px solid #0f766e; padding-bottom: 8px; margin-bottom: 8px; }
                                h2 { font-size: 16px; color: #0f172a; margin-top: 16px; text-transform: uppercase; }
                                h3 { font-size: 13px; color: #0f766e; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 24px; margin-bottom: 12px; }
                                p { font-size: 13.5px; margin-bottom: 8px; }
                                .subtitle-separator { text-align: center; margin: 16px 0 12px; padding: 6px 0; border-top: 1px dashed #99f6e4; border-bottom: 1px dashed #99f6e4; background: #f0fdfa; }
                                .subtitle-separator h4 { margin: 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #0f766e; }
                                .subtitle-separator.amber { border-color: #fde68a; background: #fffbeb; }
                                .subtitle-separator.amber h4 { color: #b45309; }
                                .subtitle-separator.slate { border-color: #e2e8f0; background: #f8fafc; }
                                .subtitle-separator.slate h4 { color: #334155; }
                                .comment-box { margin: 12px 0; padding: 10px 14px; background: #f8fafc; border-left: 4px solid #0f766e; border-radius: 0 8px 8px 0; }
                                .comment-box.amber { border-left-color: #d97706; background: #fffbeb; }
                                .comment-box.slate { border-left-color: #94a3b8; }
                                .comment-box .comment-title { font-size: 11px; font-weight: bold; color: #0f766e; margin-bottom: 4px; }
                                .comment-box.amber .comment-title { color: #b45309; }
                                .comment-box .comment-text { font-size: 12.5px; font-style: italic; color: #334155; margin: 0; }
                                .citation-box { padding-left: 14px; border-left: 3px solid #cbd5e1; font-style: italic; font-size: 13px; color: #334155; margin: 12px 0; }
                                .citation-ref { text-align: right; font-size: 11px; font-weight: bold; color: #0f766e; font-style: normal; margin-top: 4px; }
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

    const handleDirectImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsImportingDirect(true);
        let importedCount = 0;

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
                const formattedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

                const newSavedImage = await addMediaImage({
                    name: formattedName,
                    url: base64Url,
                    orientation: meta.orientation,
                    aspectRatio: meta.aspectRatio,
                    width: meta.width,
                    height: meta.height,
                    caption: '',
                    folderId: 'folder-importes'
                });

                if (note) {
                    await addImageToNote(note.id, { url: newSavedImage.url, name: newSavedImage.name });
                }
                importedCount++;
            } catch (err) {
                console.error('Error importing image directly in NoteEditor:', err);
            }
        }

        setIsImportingDirect(false);
        if (e.target) {
            e.target.value = '';
        }
        if (importedCount > 0) {
            addNotification(`${importedCount} image(s) importée(s) et ajoutée(s) à la note`, 'success');
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
                                <input
                                    type="file"
                                    ref={directFileInputRef}
                                    onChange={handleDirectImageUpload}
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                />
                                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                                    <div className="flex items-center gap-2">
                                        <ImageIcon className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                                        <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                                            Images & Illustrations jointes {note.images?.length ? `(${note.images.length})` : ''}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => directFileInputRef.current?.click()}
                                            disabled={isImportingDirect}
                                            className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                                        >
                                            <Upload className="w-3.5 h-3.5" />
                                            <span>{isImportingDirect ? 'Importation...' : 'Importer'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsGalleryPickerOpen(true)}
                                            className="px-3.5 py-1.5 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                        >
                                            <ImagePlus className="w-3.5 h-3.5" />
                                            <span>Ajouter de la galerie</span>
                                        </button>
                                    </div>
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
                                                    data-tooltip="Cliquer pour agrandir"
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
                                                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate flex-1" data-tooltip={img.caption || img.name || 'Image'}>
                                                        {img.caption || img.name || 'Image'}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeImageFromNote(note.id, img.id)}
                                                        className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0"
                                                        data-tooltip="Retirer cette image de la note"
                                                        data-tooltip-icon="trash"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div 
                                            onClick={() => directFileInputRef.current?.click()}
                                            className="p-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-teal-500/50 hover:bg-teal-50/20 dark:hover:bg-teal-950/10 cursor-pointer transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-500"
                                        >
                                            <Upload className="w-8 h-8 opacity-60 text-teal-600 dark:text-teal-400" />
                                            <span className="text-xs font-medium text-center">Importer depuis l'ordinateur</span>
                                            <span className="text-[10px] text-zinc-400">PNG, JPG, WEBP</span>
                                        </div>
                                        <div 
                                            onClick={() => setIsGalleryPickerOpen(true)}
                                            className="p-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-teal-500/50 hover:bg-teal-50/20 dark:hover:bg-teal-950/10 cursor-pointer transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-500"
                                        >
                                            <ImagePlus className="w-8 h-8 opacity-60 text-teal-600 dark:text-teal-400" />
                                            <span className="text-xs font-medium text-center">Parcourir la galerie média ({mediaImages.length})</span>
                                            <span className="text-[10px] text-zinc-400">Sélectionner parmi les images enregistrées</span>
                                        </div>
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

                            {/* Citations bibliques et Séparateurs indépendants */}
                            {processedNote.scriptureItems && processedNote.scriptureItems.length > 0 && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between px-2">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-2">
                                    <BookOpen className="w-4 h-4" />
                                    <span>Citations Bibliques</span>
                                  </h4>
                                </div>

                                {processedNote.scriptureItems.map((item, idx) => {
                                  const isDragging = item.kind === 'citation' && draggedCitationId === item.id;
                                  const isDragOver = item.kind === 'citation' && dragOverCitationId === item.id;

                                  return (
                                    <React.Fragment key={item.id || idx}>
                                      {/* Bouton d'insertion non intrusif avant l'item */}
                                      <div className="group/divider relative py-1 flex items-center justify-center">
                                        <div className="absolute inset-0 flex items-center">
                                          <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500/40 transition-colors" />
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenInsertSeparator('scripture', item.orderIndex - 5)}
                                          data-tooltip="Insérer un sous-titre ou un commentaire séparateur"
                                          data-tooltip-icon="plus"
                                          className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500 group-hover/divider:bg-teal-50 dark:group-hover/divider:bg-teal-950/40 text-zinc-400 group-hover/divider:text-teal-600 dark:group-hover/divider:text-teal-400 shadow-xs flex items-center justify-center transition-all scale-90 group-hover/divider:scale-110 cursor-pointer"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                      </div>

                                      {/* Formulaire inline de création de séparateur si déclenché à cet endroit */}
                                      {insertingSeparatorCategory === 'scripture' && insertingSeparatorOrderIndex === item.orderIndex - 5 && (
                                        <div className="bg-white dark:bg-zinc-900 border-2 border-teal-500/70 rounded-2xl p-4 shadow-lg animate-in fade-in zoom-in-95 duration-150 my-2">
                                          <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                                            <div className="flex items-center gap-1.5 p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                              <button
                                                type="button"
                                                onClick={() => setInsertingSeparatorType('subtitle')}
                                                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                                  insertingSeparatorType === 'subtitle'
                                                    ? 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 shadow-xs'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                                }`}
                                              >
                                                <Type className="w-3.5 h-3.5" />
                                                <span>Sous-titre Séparateur</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setInsertingSeparatorType('comment')}
                                                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                                  insertingSeparatorType === 'comment'
                                                    ? 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 shadow-xs'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                                }`}
                                              >
                                                <MessageSquare className="w-3.5 h-3.5" />
                                                <span>Commentaire Autonome</span>
                                              </button>
                                            </div>

                                            <button
                                              type="button"
                                              onClick={() => setInsertingSeparatorCategory(null)}
                                              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>

                                          {insertingSeparatorType === 'subtitle' ? (
                                            <input
                                              type="text"
                                              value={insertingSeparatorText}
                                              onChange={(e) => setInsertingSeparatorText(e.target.value)}
                                              placeholder="Ex: I. Le Fondement Apostolique..."
                                              autoFocus
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveNewSeparator();
                                                if (e.key === 'Escape') setInsertingSeparatorCategory(null);
                                              }}
                                              className="w-full text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                                            />
                                          ) : (
                                            <textarea
                                              value={insertingSeparatorText}
                                              onChange={(e) => setInsertingSeparatorText(e.target.value)}
                                              placeholder="Écrivez votre commentaire ou réflexion indépendante ici..."
                                              autoFocus
                                              rows={2}
                                              className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 resize-none"
                                            />
                                          )}

                                          <div className="flex items-center justify-end gap-2 mt-3">
                                            <button
                                              type="button"
                                              onClick={() => setInsertingSeparatorCategory(null)}
                                              className="px-3 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            >
                                              Annuler
                                            </button>
                                            <button
                                              type="button"
                                              onClick={handleSaveNewSeparator}
                                              className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 active:scale-95 rounded-lg shadow-xs transition-all cursor-pointer"
                                            >
                                              <Check className="w-3.5 h-3.5" />
                                              <span>Insérer</span>
                                            </button>
                                          </div>
                                        </div>
                                      )}

                                      {/* Rendu soit d'un séparateur indépendant, soit d'une citation */}
                                      {item.kind === 'separator' ? (
                                        item.separatorType === 'subtitle' ? (
                                          /* ── SOUS-TITRE SÉPARATEUR INDÉPENDANT ── */
                                          <div className="group/sep relative flex items-center gap-3 py-2 my-1">
                                            <div className="flex-1 h-px bg-teal-500/20 dark:bg-teal-500/30" />
                                            {editingSeparatorId === item.id ? (
                                              <div className="flex items-center gap-2 flex-1 max-w-md bg-white dark:bg-zinc-900 p-2 rounded-xl border border-teal-500 shadow-sm">
                                                <input
                                                  type="text"
                                                  value={editingSeparatorText}
                                                  onChange={(e) => setEditingSeparatorText(e.target.value)}
                                                  autoFocus
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEditSeparator(item.id);
                                                    if (e.key === 'Escape') setEditingSeparatorId(null);
                                                  }}
                                                  className="flex-1 text-xs font-bold px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border-none focus:outline-none text-teal-800 dark:text-teal-200"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => handleSaveEditSeparator(item.id)}
                                                  className="p-1 text-teal-600 hover:bg-teal-50 rounded"
                                                >
                                                  <Check className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setEditingSeparatorId(null)}
                                                  className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                                                >
                                                  <X className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-2 bg-teal-50/80 dark:bg-teal-950/40 border border-teal-600/30 dark:border-teal-500/30 px-4 py-1.5 rounded-full shadow-xs">
                                                <Type className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                                                <span className="text-xs font-black uppercase tracking-wider text-teal-900 dark:text-teal-200">
                                                  {item.text}
                                                </span>
                                                <div className="flex items-center gap-1 opacity-0 group-hover/sep:opacity-100 transition-opacity ml-2 border-l border-teal-500/20 pl-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.scriptureItems, 'scripture')}
                                                    disabled={idx === 0}
                                                    title="Monter"
                                                    className="p-1 text-zinc-400 hover:text-teal-700 disabled:opacity-20"
                                                  >
                                                    <ChevronUp className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.scriptureItems, 'scripture')}
                                                    disabled={idx === processedNote.scriptureItems.length - 1}
                                                    title="Descendre"
                                                    className="p-1 text-zinc-400 hover:text-teal-700 disabled:opacity-20"
                                                  >
                                                    <ChevronDown className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartEditSeparator(item.id, item.text)}
                                                    title="Modifier"
                                                    className="p-1 text-zinc-400 hover:text-teal-700"
                                                  >
                                                    <Pencil className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteSeparator(item.id)}
                                                    title="Supprimer"
                                                    className="p-1 text-zinc-400 hover:text-red-500"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                            <div className="flex-1 h-px bg-teal-500/20 dark:bg-teal-500/30" />
                                          </div>
                                        ) : (
                                          /* ── COMMENTAIRE / MÉDITATION SÉPARATEUR INDÉPENDANT ── */
                                          <div className="group/sep bg-teal-50/40 dark:bg-teal-950/20 border border-teal-600/20 dark:border-teal-900/30 rounded-2xl p-4 my-1 relative transition-all">
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                                <div className="w-6 h-6 rounded-lg bg-teal-600/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                                                  <MessageSquare className="w-3.5 h-3.5" />
                                                </div>
                                                {editingSeparatorId === item.id ? (
                                                  <div className="flex-1 space-y-2">
                                                    <textarea
                                                      value={editingSeparatorText}
                                                      onChange={(e) => setEditingSeparatorText(e.target.value)}
                                                      autoFocus
                                                      rows={2}
                                                      className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-800 border border-teal-500 rounded-xl focus:outline-none"
                                                    />
                                                    <div className="flex justify-end gap-2">
                                                      <button
                                                        type="button"
                                                        onClick={() => setEditingSeparatorId(null)}
                                                        className="px-2.5 py-1 text-xs text-zinc-500"
                                                      >
                                                        Annuler
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleSaveEditSeparator(item.id)}
                                                        className="px-2.5 py-1 text-xs font-bold text-white bg-teal-600 rounded-lg"
                                                      >
                                                        Enregistrer
                                                      </button>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <p className="text-xs text-zinc-700 dark:text-zinc-300 italic leading-relaxed">
                                                    {item.text}
                                                  </p>
                                                )}
                                              </div>

                                              {editingSeparatorId !== item.id && (
                                                <div className="flex items-center gap-1 opacity-0 group-hover/sep:opacity-100 transition-opacity shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.scriptureItems, 'scripture')}
                                                    disabled={idx === 0}
                                                    title="Monter"
                                                    className="p-1 rounded text-zinc-400 hover:text-teal-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20"
                                                  >
                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.scriptureItems, 'scripture')}
                                                    disabled={idx === processedNote.scriptureItems.length - 1}
                                                    title="Descendre"
                                                    className="p-1 rounded text-zinc-400 hover:text-teal-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20"
                                                  >
                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartEditSeparator(item.id, item.text)}
                                                    title="Modifier"
                                                    className="p-1 rounded text-zinc-400 hover:text-teal-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                  >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteSeparator(item.id)}
                                                    title="Supprimer"
                                                    className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      ) : (
                                        /* ── CARTE DE CITATION BIBLIQUE ── */
                                        <div 
                                          draggable={Boolean(item.citationId)}
                                          onDragStart={(e) => {
                                            if (!item.citationId) return;
                                            setDraggedCitationId(item.citationId);
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', item.citationId);
                                          }}
                                          onDragOver={(e) => {
                                            if (!item.citationId) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (dragOverCitationId !== item.citationId) {
                                              setDragOverCitationId(item.citationId);
                                            }
                                          }}
                                          onDragLeave={() => {
                                            if (dragOverCitationId === item.citationId) {
                                              setDragOverCitationId(null);
                                            }
                                          }}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            if (draggedCitationId && item.citationId && draggedCitationId !== item.citationId) {
                                              handleReorderCitations(draggedCitationId, item.citationId);
                                            }
                                            setDraggedCitationId(null);
                                            setDragOverCitationId(null);
                                          }}
                                          onDragEnd={() => {
                                            setDraggedCitationId(null);
                                            setDragOverCitationId(null);
                                          }}
                                          className={`bg-white dark:bg-zinc-900 border rounded-2xl p-6 shadow-xs relative group transition-all ${
                                            isDragging 
                                              ? 'opacity-30 border-dashed border-teal-500' 
                                              : isDragOver
                                                ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-500/20'
                                                : 'border-teal-600/20 dark:border-teal-900/30 hover:border-teal-500/50'
                                          }`}
                                        >
                                          <Quote className="absolute -left-1 -top-1 w-10 h-10 text-teal-600/10 rotate-12 pointer-events-none" />

                                          {item.citationId && (
                                            <div className="absolute top-4 right-4 flex items-center gap-1 z-10">
                                              <div 
                                                className="p-1.5 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                title="Glisser pour déplacer cette citation"
                                              >
                                                <GripVertical className="w-4 h-4" />
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.scriptureItems, 'scripture')}
                                                disabled={idx === 0}
                                                title="Monter d'une position"
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <ChevronUp className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.scriptureItems, 'scripture')}
                                                disabled={idx === processedNote.scriptureItems.length - 1}
                                                title="Descendre d'une position"
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <ChevronDown className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={() => removeCitationFromNote(note.id, item.citationId)}
                                                data-tooltip="Supprimer cette référence"
                                                data-tooltip-icon="trash"
                                                className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all cursor-pointer opacity-80 hover:opacity-100"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          )}

                                          <blockquote className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-relaxed mb-3 pr-20">
                                            « {item.quote} »
                                          </blockquote>
                                          <div className="flex justify-end items-center gap-2">
                                            <span className="text-xs font-bold text-teal-700 dark:text-teal-300">
                                              {item.reference || 'Bible'}
                                            </span>
                                            {item.sourceIndex && (
                                              <span className="text-[10px] font-black bg-teal-600/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full border border-teal-600/20">
                                                [{item.sourceIndex}]
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </React.Fragment>
                                  );
                                })}

                                {/* Bouton d'insertion final tout en bas de la section */}
                                <div className="group/divider relative py-1 flex items-center justify-center">
                                  <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500/40 transition-colors" />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInsertSeparator('scripture', 99999)}
                                    data-tooltip="Ajouter un sous-titre ou un commentaire en fin de section"
                                    data-tooltip-icon="plus"
                                    className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500 group-hover/divider:bg-teal-50 dark:group-hover/divider:bg-teal-950/40 text-zinc-400 group-hover/divider:text-teal-600 dark:group-hover/divider:text-teal-400 shadow-xs flex items-center justify-center transition-all scale-90 group-hover/divider:scale-110 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Citations de l'Exposé des Sept Âges et Séparateurs indépendants */}
                            {processedNote.churchAgeItems && processedNote.churchAgeItems.length > 0 && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between px-2">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-2">
                                    <ScrollText className="w-4 h-4" />
                                    <span>Citations de l'Exposé des Sept Âges</span>
                                  </h4>
                                </div>
                                {processedNote.churchAgeItems.map((item, idx) => {
                                  const isDragging = item.kind === 'citation' && draggedCitationId === item.id;
                                  const isDragOver = item.kind === 'citation' && dragOverCitationId === item.id;

                                  return (
                                    <React.Fragment key={item.id || idx}>
                                      {/* Bouton d'insertion non intrusif avant l'item */}
                                      <div className="group/divider relative py-1 flex items-center justify-center">
                                        <div className="absolute inset-0 flex items-center">
                                          <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-800 group-hover/divider:border-amber-500/40 transition-colors" />
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenInsertSeparator('church_age', item.orderIndex - 5)}
                                          data-tooltip="Insérer un sous-titre ou un commentaire séparateur"
                                          data-tooltip-icon="plus"
                                          className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover/divider:border-amber-500 group-hover/divider:bg-amber-50 dark:group-hover/divider:bg-amber-950/40 text-zinc-400 group-hover/divider:text-amber-600 dark:group-hover/divider:text-amber-400 shadow-xs flex items-center justify-center transition-all scale-90 group-hover/divider:scale-110 cursor-pointer"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                      </div>

                                      {/* Formulaire inline de création de séparateur si déclenché à cet endroit */}
                                      {insertingSeparatorCategory === 'church_age' && insertingSeparatorOrderIndex === item.orderIndex - 5 && (
                                        <div className="bg-white dark:bg-zinc-900 border-2 border-amber-500/70 rounded-2xl p-4 shadow-lg animate-in fade-in zoom-in-95 duration-150 my-2">
                                          <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                                            <div className="flex items-center gap-1.5 p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                              <button
                                                type="button"
                                                onClick={() => setInsertingSeparatorType('subtitle')}
                                                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                                  insertingSeparatorType === 'subtitle'
                                                    ? 'bg-white dark:bg-zinc-700 text-amber-700 dark:text-amber-300 shadow-xs'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                                }`}
                                              >
                                                <Type className="w-3.5 h-3.5" />
                                                <span>Sous-titre Séparateur</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setInsertingSeparatorType('comment')}
                                                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                                  insertingSeparatorType === 'comment'
                                                    ? 'bg-white dark:bg-zinc-700 text-amber-700 dark:text-amber-300 shadow-xs'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                                }`}
                                              >
                                                <MessageSquare className="w-3.5 h-3.5" />
                                                <span>Commentaire Autonome</span>
                                              </button>
                                            </div>

                                            <button
                                              type="button"
                                              onClick={() => setInsertingSeparatorCategory(null)}
                                              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>

                                          {insertingSeparatorType === 'subtitle' ? (
                                            <input
                                              type="text"
                                              value={insertingSeparatorText}
                                              onChange={(e) => setInsertingSeparatorText(e.target.value)}
                                              placeholder="Ex: II. L'Âge d'Éphèse..."
                                              autoFocus
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveNewSeparator();
                                                if (e.key === 'Escape') setInsertingSeparatorCategory(null);
                                              }}
                                              className="w-full text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                                            />
                                          ) : (
                                            <textarea
                                              value={insertingSeparatorText}
                                              onChange={(e) => setInsertingSeparatorText(e.target.value)}
                                              placeholder="Écrivez votre commentaire ou réflexion sur l'Exposé ici..."
                                              autoFocus
                                              rows={2}
                                              className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 resize-none"
                                            />
                                          )}

                                          <div className="flex items-center justify-end gap-2 mt-3">
                                            <button
                                              type="button"
                                              onClick={() => setInsertingSeparatorCategory(null)}
                                              className="px-3 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            >
                                              Annuler
                                            </button>
                                            <button
                                              type="button"
                                              onClick={handleSaveNewSeparator}
                                              className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:scale-95 rounded-lg shadow-xs transition-all cursor-pointer"
                                            >
                                              <Check className="w-3.5 h-3.5" />
                                              <span>Insérer</span>
                                            </button>
                                          </div>
                                        </div>
                                      )}

                                      {/* Rendu soit d'un séparateur indépendant, soit d'une citation de l'Exposé */}
                                      {item.kind === 'separator' ? (
                                        item.separatorType === 'subtitle' ? (
                                          /* ── SOUS-TITRE SÉPARATEUR INDÉPENDANT ── */
                                          <div className="group/sep relative flex items-center gap-3 py-2 my-1">
                                            <div className="flex-1 h-px bg-amber-500/20 dark:bg-amber-500/30" />
                                            {editingSeparatorId === item.id ? (
                                              <div className="flex items-center gap-2 flex-1 max-w-md bg-white dark:bg-zinc-900 p-2 rounded-xl border border-amber-500 shadow-sm">
                                                <input
                                                  type="text"
                                                  value={editingSeparatorText}
                                                  onChange={(e) => setEditingSeparatorText(e.target.value)}
                                                  autoFocus
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEditSeparator(item.id);
                                                    if (e.key === 'Escape') setEditingSeparatorId(null);
                                                  }}
                                                  className="flex-1 text-xs font-bold px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border-none focus:outline-none text-amber-800 dark:text-amber-200"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => handleSaveEditSeparator(item.id)}
                                                  className="p-1 text-amber-600 hover:bg-amber-50 rounded"
                                                >
                                                  <Check className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setEditingSeparatorId(null)}
                                                  className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                                                >
                                                  <X className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-2 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-600/30 dark:border-amber-500/30 px-4 py-1.5 rounded-full shadow-xs">
                                                <Type className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                                <span className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-200">
                                                  {item.text}
                                                </span>
                                                <div className="flex items-center gap-1 opacity-0 group-hover/sep:opacity-100 transition-opacity ml-2 border-l border-amber-500/20 pl-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.churchAgeItems, 'church_age')}
                                                    disabled={idx === 0}
                                                    title="Monter"
                                                    className="p-1 text-zinc-400 hover:text-amber-700 disabled:opacity-20"
                                                  >
                                                    <ChevronUp className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.churchAgeItems, 'church_age')}
                                                    disabled={idx === processedNote.churchAgeItems.length - 1}
                                                    title="Descendre"
                                                    className="p-1 text-zinc-400 hover:text-amber-700 disabled:opacity-20"
                                                  >
                                                    <ChevronDown className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartEditSeparator(item.id, item.text)}
                                                    title="Modifier"
                                                    className="p-1 text-zinc-400 hover:text-amber-700"
                                                  >
                                                    <Pencil className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteSeparator(item.id)}
                                                    title="Supprimer"
                                                    className="p-1 text-zinc-400 hover:text-red-500"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                            <div className="flex-1 h-px bg-amber-500/20 dark:bg-amber-500/30" />
                                          </div>
                                        ) : (
                                          /* ── COMMENTAIRE / RÉFLEXION SÉPARATEUR INDÉPENDANT ── */
                                          <div className="group/sep bg-amber-50/40 dark:bg-amber-950/20 border border-amber-600/20 dark:border-amber-900/30 rounded-2xl p-4 my-1 relative transition-all">
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                                <div className="w-6 h-6 rounded-lg bg-amber-600/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                                                  <MessageSquare className="w-3.5 h-3.5" />
                                                </div>
                                                {editingSeparatorId === item.id ? (
                                                  <div className="flex-1 space-y-2">
                                                    <textarea
                                                      value={editingSeparatorText}
                                                      onChange={(e) => setEditingSeparatorText(e.target.value)}
                                                      autoFocus
                                                      rows={2}
                                                      className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-800 border border-amber-500 rounded-xl focus:outline-none"
                                                    />
                                                    <div className="flex justify-end gap-2">
                                                      <button
                                                        type="button"
                                                        onClick={() => setEditingSeparatorId(null)}
                                                        className="px-2.5 py-1 text-xs text-zinc-500"
                                                      >
                                                        Annuler
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleSaveEditSeparator(item.id)}
                                                        className="px-2.5 py-1 text-xs font-bold text-white bg-amber-600 rounded-lg"
                                                      >
                                                        Enregistrer
                                                      </button>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <p className="text-xs text-zinc-700 dark:text-zinc-300 italic leading-relaxed">
                                                    {item.text}
                                                  </p>
                                                )}
                                              </div>

                                              {editingSeparatorId !== item.id && (
                                                <div className="flex items-center gap-1 opacity-0 group-hover/sep:opacity-100 transition-opacity shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.churchAgeItems, 'church_age')}
                                                    disabled={idx === 0}
                                                    title="Monter"
                                                    className="p-1 rounded text-zinc-400 hover:text-amber-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20"
                                                  >
                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.churchAgeItems, 'church_age')}
                                                    disabled={idx === processedNote.churchAgeItems.length - 1}
                                                    title="Descendre"
                                                    className="p-1 rounded text-zinc-400 hover:text-amber-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20"
                                                  >
                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartEditSeparator(item.id, item.text)}
                                                    title="Modifier"
                                                    className="p-1 rounded text-zinc-400 hover:text-amber-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                  >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteSeparator(item.id)}
                                                    title="Supprimer"
                                                    className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      ) : (
                                        /* ── CARTE DE CITATION DE L'EXPOSÉ ── */
                                        <div 
                                          draggable={Boolean(item.citationId)}
                                          onDragStart={(e) => {
                                            if (!item.citationId) return;
                                            setDraggedCitationId(item.citationId);
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', item.citationId);
                                          }}
                                          onDragOver={(e) => {
                                            if (!item.citationId) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (dragOverCitationId !== item.citationId) {
                                              setDragOverCitationId(item.citationId);
                                            }
                                          }}
                                          onDragLeave={() => {
                                            if (dragOverCitationId === item.citationId) {
                                              setDragOverCitationId(null);
                                            }
                                          }}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            if (draggedCitationId && item.citationId && draggedCitationId !== item.citationId) {
                                              handleReorderCitations(draggedCitationId, item.citationId);
                                            }
                                            setDraggedCitationId(null);
                                            setDragOverCitationId(null);
                                          }}
                                          onDragEnd={() => {
                                            setDraggedCitationId(null);
                                            setDragOverCitationId(null);
                                          }}
                                          className={`bg-white dark:bg-zinc-900 border rounded-2xl p-6 shadow-xs relative group transition-all ${
                                            isDragging 
                                              ? 'opacity-30 border-dashed border-amber-500' 
                                              : isDragOver
                                                ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
                                                : 'border-amber-600/20 dark:border-amber-900/30 hover:border-amber-500/50'
                                          }`}
                                        >
                                          {item.citationId && (
                                            <div className="absolute top-4 right-4 flex items-center gap-1 z-10">
                                              <div 
                                                className="p-1.5 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                title="Glisser pour déplacer cette citation"
                                              >
                                                <GripVertical className="w-4 h-4" />
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.churchAgeItems, 'church_age')}
                                                disabled={idx === 0}
                                                title="Monter d'une position"
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <ChevronUp className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.churchAgeItems, 'church_age')}
                                                disabled={idx === processedNote.churchAgeItems.length - 1}
                                                title="Descendre d'une position"
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <ChevronDown className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={() => removeCitationFromNote(note.id, item.citationId)}
                                                data-tooltip="Supprimer cette référence"
                                                data-tooltip-icon="trash"
                                                className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all cursor-pointer opacity-80 hover:opacity-100"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          )}

                                          <blockquote className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-relaxed mb-3 pr-20">
                                            « {item.quote} »
                                          </blockquote>
                                          <div className="flex justify-end items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-400">
                                            <span><strong className="text-amber-600 dark:text-amber-400">{item.sourceTitle || 'Exposé des Sept Âges'}</strong> {item.sourceMeta ? `— ${item.sourceMeta}` : ''}</span>
                                            {item.sourceIndex && (
                                              <span className="text-[10px] font-black bg-amber-600/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-600/20">
                                                [{item.sourceIndex}]
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </React.Fragment>
                                  );
                                })}

                                {/* Bouton d'insertion final tout en bas de la section Exposé */}
                                <div className="group/divider relative py-1 flex items-center justify-center">
                                  <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-800 group-hover/divider:border-amber-500/40 transition-colors" />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInsertSeparator('church_age', 99999)}
                                    data-tooltip="Ajouter un sous-titre ou un commentaire en fin de section"
                                    data-tooltip-icon="plus"
                                    className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover/divider:border-amber-500 group-hover/divider:bg-amber-50 dark:group-hover/divider:bg-amber-950/40 text-zinc-400 group-hover/divider:text-amber-600 dark:group-hover/divider:text-amber-400 shadow-xs flex items-center justify-center transition-all scale-90 group-hover/divider:scale-110 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Citations d'enseignements / Sermons et Séparateurs indépendants */}
                            {processedNote.teachingItems && processedNote.teachingItems.length > 0 && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between px-2">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-2">
                                    <Quote className="w-4 h-4" />
                                    <span>Citations d'Enseignements</span>
                                  </h4>
                                </div>
                                {processedNote.teachingItems.map((item, idx) => {
                                  const isDragging = item.kind === 'citation' && draggedCitationId === item.id;
                                  const isDragOver = item.kind === 'citation' && dragOverCitationId === item.id;

                                  return (
                                    <React.Fragment key={item.id || idx}>
                                      {/* Bouton d'insertion non intrusif avant la citation */}
                                      <div className="group/divider relative py-1 flex items-center justify-center">
                                        <div className="absolute inset-0 flex items-center">
                                          <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500/40 transition-colors" />
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenInsertSeparator('teaching', item.orderIndex - 5)}
                                          data-tooltip="Insérer un sous-titre ou un commentaire séparateur"
                                          data-tooltip-icon="plus"
                                          className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500 group-hover/divider:bg-teal-50 dark:group-hover/divider:bg-teal-950/40 text-zinc-400 group-hover/divider:text-teal-600 dark:group-hover/divider:text-teal-400 shadow-xs flex items-center justify-center transition-all scale-90 group-hover/divider:scale-110 cursor-pointer"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                      </div>

                                      {/* Formulaire inline de création de séparateur si déclenché à cet endroit */}
                                      {insertingSeparatorCategory === 'teaching' && insertingSeparatorOrderIndex === item.orderIndex - 5 && (
                                        <div className="bg-white dark:bg-zinc-900 border-2 border-teal-500/70 rounded-2xl p-4 shadow-lg animate-in fade-in zoom-in-95 duration-150 my-2">
                                          <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                                            <div className="flex items-center gap-1.5 p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                              <button
                                                type="button"
                                                onClick={() => setInsertingSeparatorType('subtitle')}
                                                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                                  insertingSeparatorType === 'subtitle'
                                                    ? 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 shadow-xs'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                                }`}
                                              >
                                                <Type className="w-3.5 h-3.5" />
                                                <span>Sous-titre Séparateur</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setInsertingSeparatorType('comment')}
                                                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                                  insertingSeparatorType === 'comment'
                                                    ? 'bg-white dark:bg-zinc-700 text-teal-700 dark:text-teal-300 shadow-xs'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                                }`}
                                              >
                                                <MessageSquare className="w-3.5 h-3.5" />
                                                <span>Commentaire Autonome</span>
                                              </button>
                                            </div>

                                            <button
                                              type="button"
                                              onClick={() => setInsertingSeparatorCategory(null)}
                                              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>

                                          {insertingSeparatorType === 'subtitle' ? (
                                            <input
                                              type="text"
                                              value={insertingSeparatorText}
                                              onChange={(e) => setInsertingSeparatorText(e.target.value)}
                                              placeholder="Ex: III. Application Pratique..."
                                              autoFocus
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveNewSeparator();
                                                if (e.key === 'Escape') setInsertingSeparatorCategory(null);
                                              }}
                                              className="w-full text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                                            />
                                          ) : (
                                            <textarea
                                              value={insertingSeparatorText}
                                              onChange={(e) => setInsertingSeparatorText(e.target.value)}
                                              placeholder="Écrivez votre commentaire ou enseignement ici..."
                                              autoFocus
                                              rows={2}
                                              className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 resize-none"
                                            />
                                          )}

                                          <div className="flex items-center justify-end gap-2 mt-3">
                                            <button
                                              type="button"
                                              onClick={() => setInsertingSeparatorCategory(null)}
                                              className="px-3 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            >
                                              Annuler
                                            </button>
                                            <button
                                              type="button"
                                              onClick={handleSaveNewSeparator}
                                              className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 active:scale-95 rounded-lg shadow-xs transition-all cursor-pointer"
                                            >
                                              <Check className="w-3.5 h-3.5" />
                                              <span>Insérer</span>
                                            </button>
                                          </div>
                                        </div>
                                      )}

                                      {/* Rendu soit d'un séparateur indépendant, soit d'une citation d'enseignement */}
                                      {item.kind === 'separator' ? (
                                        item.separatorType === 'subtitle' ? (
                                          /* ── SOUS-TITRE SÉPARATEUR INDÉPENDANT ── */
                                          <div className="group/sep relative flex items-center gap-3 py-2 my-1">
                                            <div className="flex-1 h-px bg-teal-500/20 dark:bg-teal-500/30" />
                                            {editingSeparatorId === item.id ? (
                                              <div className="flex items-center gap-2 flex-1 max-w-md bg-white dark:bg-zinc-900 p-2 rounded-xl border border-teal-500 shadow-sm">
                                                <input
                                                  type="text"
                                                  value={editingSeparatorText}
                                                  onChange={(e) => setEditingSeparatorText(e.target.value)}
                                                  autoFocus
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEditSeparator(item.id);
                                                    if (e.key === 'Escape') setEditingSeparatorId(null);
                                                  }}
                                                  className="flex-1 text-xs font-bold px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border-none focus:outline-none text-teal-800 dark:text-teal-200"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => handleSaveEditSeparator(item.id)}
                                                  className="p-1 text-teal-600 hover:bg-teal-50 rounded"
                                                >
                                                  <Check className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setEditingSeparatorId(null)}
                                                  className="p-1 text-zinc-400 hover:bg-zinc-100 rounded"
                                                >
                                                  <X className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 px-4 py-1.5 rounded-full shadow-xs">
                                                <Type className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                                                <span className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
                                                  {item.text}
                                                </span>
                                                <div className="flex items-center gap-1 opacity-0 group-hover/sep:opacity-100 transition-opacity ml-2 border-l border-zinc-200 dark:border-zinc-700 pl-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.teachingItems, 'teaching')}
                                                    disabled={idx === 0}
                                                    title="Monter"
                                                    className="p-1 text-zinc-400 hover:text-teal-700 disabled:opacity-20"
                                                  >
                                                    <ChevronUp className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.teachingItems, 'teaching')}
                                                    disabled={idx === processedNote.teachingItems.length - 1}
                                                    title="Descendre"
                                                    className="p-1 text-zinc-400 hover:text-teal-700 disabled:opacity-20"
                                                  >
                                                    <ChevronDown className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartEditSeparator(item.id, item.text)}
                                                    title="Modifier"
                                                    className="p-1 text-zinc-400 hover:text-teal-700"
                                                  >
                                                    <Pencil className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteSeparator(item.id)}
                                                    title="Supprimer"
                                                    className="p-1 text-zinc-400 hover:text-red-500"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                            <div className="flex-1 h-px bg-teal-500/20 dark:bg-teal-500/30" />
                                          </div>
                                        ) : (
                                          /* ── COMMENTAIRE / RÉFLEXION SÉPARATEUR INDÉPENDANT ── */
                                          <div className="group/sep bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60 rounded-2xl p-4 my-1 relative transition-all">
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                                <div className="w-6 h-6 rounded-lg bg-teal-600/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
                                                  <MessageSquare className="w-3.5 h-3.5" />
                                                </div>
                                                {editingSeparatorId === item.id ? (
                                                  <div className="flex-1 space-y-2">
                                                    <textarea
                                                      value={editingSeparatorText}
                                                      onChange={(e) => setEditingSeparatorText(e.target.value)}
                                                      autoFocus
                                                      rows={2}
                                                      className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-800 border border-teal-500 rounded-xl focus:outline-none"
                                                    />
                                                    <div className="flex justify-end gap-2">
                                                      <button
                                                        type="button"
                                                        onClick={() => setEditingSeparatorId(null)}
                                                        className="px-2.5 py-1 text-xs text-zinc-500"
                                                      >
                                                        Annuler
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleSaveEditSeparator(item.id)}
                                                        className="px-2.5 py-1 text-xs font-bold text-white bg-teal-600 rounded-lg"
                                                      >
                                                        Enregistrer
                                                      </button>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <p className="text-xs text-zinc-700 dark:text-zinc-300 italic leading-relaxed">
                                                    {item.text}
                                                  </p>
                                                )}
                                              </div>

                                              {editingSeparatorId !== item.id && (
                                                <div className="flex items-center gap-1 opacity-0 group-hover/sep:opacity-100 transition-opacity shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.teachingItems, 'teaching')}
                                                    disabled={idx === 0}
                                                    title="Monter"
                                                    className="p-1 rounded text-zinc-400 hover:text-teal-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20"
                                                  >
                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.teachingItems, 'teaching')}
                                                    disabled={idx === processedNote.teachingItems.length - 1}
                                                    title="Descendre"
                                                    className="p-1 rounded text-zinc-400 hover:text-teal-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20"
                                                  >
                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartEditSeparator(item.id, item.text)}
                                                    title="Modifier"
                                                    className="p-1 rounded text-zinc-400 hover:text-teal-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                  >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteSeparator(item.id)}
                                                    title="Supprimer"
                                                    className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      ) : (
                                        /* ── CARTE DE CITATION D'ENSEIGNEMENT ── */
                                        <div 
                                          draggable={Boolean(item.citationId)}
                                          onDragStart={(e) => {
                                            if (!item.citationId) return;
                                            setDraggedCitationId(item.citationId);
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', item.citationId);
                                          }}
                                          onDragOver={(e) => {
                                            if (!item.citationId) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (dragOverCitationId !== item.citationId) {
                                              setDragOverCitationId(item.citationId);
                                            }
                                          }}
                                          onDragLeave={() => {
                                            if (dragOverCitationId === item.citationId) {
                                              setDragOverCitationId(null);
                                            }
                                          }}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            if (draggedCitationId && item.citationId && draggedCitationId !== item.citationId) {
                                              handleReorderCitations(draggedCitationId, item.citationId);
                                            }
                                            setDraggedCitationId(null);
                                            setDragOverCitationId(null);
                                          }}
                                          onDragEnd={() => {
                                            setDraggedCitationId(null);
                                            setDragOverCitationId(null);
                                          }}
                                          className={`bg-white dark:bg-zinc-900 border rounded-2xl p-6 shadow-xs relative group transition-all ${
                                            isDragging 
                                              ? 'opacity-30 border-dashed border-teal-500' 
                                              : isDragOver
                                                ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-500/20'
                                                : 'border-zinc-200 dark:border-zinc-800 hover:border-teal-500/50'
                                          }`}
                                        >
                                          {item.citationId && (
                                            <div className="absolute top-4 right-4 flex items-center gap-1 z-10">
                                              <div 
                                                className="p-1.5 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 rounded-lg cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                title="Glisser pour déplacer cette citation"
                                              >
                                                <GripVertical className="w-4 h-4" />
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveSectionItem(item.id, 'up', processedNote.teachingItems, 'teaching')}
                                                disabled={idx === 0}
                                                title="Monter d'une position"
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <ChevronUp className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveSectionItem(item.id, 'down', processedNote.teachingItems, 'teaching')}
                                                disabled={idx === processedNote.teachingItems.length - 1}
                                                title="Descendre d'une position"
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <ChevronDown className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={() => removeCitationFromNote(note.id, item.citationId)}
                                                data-tooltip="Supprimer cette référence"
                                                data-tooltip-icon="trash"
                                                className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all cursor-pointer opacity-80 hover:opacity-100"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          )}

                                          <blockquote className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-relaxed mb-3 pr-20">
                                            « {item.quote} »
                                          </blockquote>
                                          <div className="flex justify-end items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-400">
                                            <span><strong className="text-teal-600 dark:text-teal-400">{item.sourceTitle || 'Sermon'}</strong> {item.sourceMeta ? `— ${item.sourceMeta}` : ''}</span>
                                            {item.sourceIndex && (
                                              <span className="text-[10px] font-black bg-teal-600/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full border border-teal-600/20">
                                                [{item.sourceIndex}]
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </React.Fragment>
                                  );
                                })}

                                {/* Bouton d'insertion final tout en bas de la section Enseignements */}
                                <div className="group/divider relative py-1 flex items-center justify-center">
                                  <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-dashed border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500/40 transition-colors" />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInsertSeparator('teaching', 99999)}
                                    data-tooltip="Ajouter un sous-titre ou un commentaire en fin de section"
                                    data-tooltip-icon="plus"
                                    className="relative z-10 w-6 h-6 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover/divider:border-teal-500 group-hover/divider:bg-teal-50 dark:group-hover/divider:bg-teal-950/40 text-zinc-400 group-hover/divider:text-teal-600 dark:group-hover/divider:text-teal-400 shadow-xs flex items-center justify-center transition-all scale-90 group-hover/divider:scale-110 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Section Sources & Bibliographie avec Drag & Drop pour réorganiser l'ordre */}
                            {processedNote.sources.length > 0 && (
                              <div className="mt-10 pt-8 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                                    <Link2 className="w-4 h-4 text-teal-600" />
                                    <span>Sources & Références</span>
                                  </h4>
                                  <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                                    <GripVertical className="w-3.5 h-3.5" />
                                    Glissez-déposez pour réorganiser l'ordre
                                  </span>
                                </div>

                                <div className="space-y-2 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                                  {processedNote.sources.map((src, srcIdx) => {
                                    const isDragging = draggedSourceIdx === srcIdx;
                                    const isDragOver = dragOverSourceIdx === srcIdx;

                                    return (
                                      <div 
                                        key={src.id || src.index}
                                        draggable
                                        onDragStart={(e) => {
                                          setDraggedSourceIdx(srcIdx);
                                          e.dataTransfer.effectAllowed = 'move';
                                          e.dataTransfer.setData('text/plain', String(srcIdx));
                                        }}
                                        onDragOver={(e) => {
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = 'move';
                                          if (dragOverSourceIdx !== srcIdx) {
                                            setDragOverSourceIdx(srcIdx);
                                          }
                                        }}
                                        onDragLeave={() => {
                                          if (dragOverSourceIdx === srcIdx) {
                                            setDragOverSourceIdx(null);
                                          }
                                        }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          if (draggedSourceIdx !== null && draggedSourceIdx !== srcIdx) {
                                            handleReorderSources(draggedSourceIdx, srcIdx);
                                          }
                                          setDraggedSourceIdx(null);
                                          setDragOverSourceIdx(null);
                                        }}
                                        onDragEnd={() => {
                                          setDraggedSourceIdx(null);
                                          setDragOverSourceIdx(null);
                                        }}
                                        className={`group/src flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-all select-none ${
                                          isDragging 
                                            ? 'opacity-30 border-dashed border-teal-500 bg-teal-50/20 dark:bg-teal-950/20' 
                                            : isDragOver
                                              ? 'border-teal-500 bg-teal-50/60 dark:bg-teal-950/40 shadow-sm scale-[1.01]'
                                              : 'border-zinc-100 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/30'
                                        }`}
                                      >
                                        {/* Poignée et Numéro d'index */}
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          <div 
                                            className="cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors shrink-0"
                                            title="Glisser pour changer la position"
                                          >
                                            <GripVertical className="w-4 h-4" />
                                          </div>
                                          <span className="font-black text-xs text-teal-600 dark:text-teal-400 bg-teal-600/10 dark:bg-teal-400/10 px-2 py-0.5 rounded-md border border-teal-600/20 shrink-0">
                                            [{src.index}]
                                          </span>
                                          <span className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed truncate">
                                            {src.formattedLine}
                                          </span>
                                        </div>

                                        {/* Boutons d'action : Monter / Descendre d'un rang */}
                                        <div className="flex items-center gap-1 opacity-0 group-hover/src:opacity-100 transition-opacity shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => handleReorderSources(srcIdx, srcIdx - 1)}
                                            disabled={srcIdx === 0}
                                            title="Monter d'une position"
                                            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                          >
                                            <ChevronUp className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleReorderSources(srcIdx, srcIdx + 1)}
                                            disabled={srcIdx === processedNote.sources.length - 1}
                                            title="Descendre d'une position"
                                            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
                                          >
                                            <ChevronDown className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Zone dédiée à l'impression (Imprimante / window.print) */}
            <div id="printable-note-container" className="hidden print:block p-8 bg-white text-black font-sans leading-relaxed">
                <div className="border-b-2 border-teal-700 pb-3 mb-6">
                    <h1 className="text-xl font-bold uppercase text-teal-800">
                        KING'S SWORD <span className="font-normal text-slate-400 mx-1.5">|</span> {processedNote.title}
                    </h1>
                    <p className="text-xs text-slate-500 italic mt-1">
                        Date : {note.date ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('fr-FR')}
                    </p>
                </div>

                {processedNote.contentParagraphs.length > 0 && (
                    <div className="mb-8 space-y-3">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Contenu Principal</h3>
                        {processedNote.contentParagraphs.map((p, i) => (
                            <p key={i} className="text-sm text-slate-800 leading-relaxed">{p}</p>
                        ))}
                    </div>
                )}

                {/* 1. Citations Bibliques */}
                {processedNote.scriptureItems && processedNote.scriptureItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Citations Bibliques</h3>
                        {processedNote.scriptureItems.map((item, i) => {
                            if (item.kind === 'separator') {
                                if (item.separatorType === 'subtitle') {
                                    return (
                                        <div key={item.id || i} className="subtitle-separator page-break-inside-avoid">
                                            <h4>{item.text}</h4>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id || i} className="comment-box page-break-inside-avoid">
                                        <div className="comment-title">Remarque / Commentaire :</div>
                                        <div className="comment-text">{item.text}</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={item.id || i} className="citation-box page-break-inside-avoid">
                                    <p>« {item.quote} »</p>
                                    <p className="citation-ref">
                                        {item.reference || 'Bible'} {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 2. Citations de l'Exposé des Sept Âges */}
                {processedNote.churchAgeItems && processedNote.churchAgeItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Citations de l'Exposé des Sept Âges</h3>
                        {processedNote.churchAgeItems.map((item, i) => {
                            if (item.kind === 'separator') {
                                if (item.separatorType === 'subtitle') {
                                    return (
                                        <div key={item.id || i} className="subtitle-separator amber page-break-inside-avoid">
                                            <h4>{item.text}</h4>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id || i} className="comment-box amber page-break-inside-avoid">
                                        <div className="comment-title">Remarque / Commentaire :</div>
                                        <div className="comment-text">{item.text}</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={item.id || i} className="citation-box page-break-inside-avoid">
                                    <p>« {item.quote} »</p>
                                    <p className="citation-ref">
                                        {item.sourceTitle || "Exposé des Sept Âges"} {item.sourceMeta ? `— ${item.sourceMeta}` : ''} {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 3. Citations & Enseignements */}
                {processedNote.teachingItems && processedNote.teachingItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <h3 className="text-sm font-bold uppercase text-teal-800 border-b border-teal-200 pb-1 mb-2">Citations & Enseignements</h3>
                        {processedNote.teachingItems.map((item, i) => {
                            if (item.kind === 'separator') {
                                if (item.separatorType === 'subtitle') {
                                    return (
                                        <div key={item.id || i} className="subtitle-separator slate page-break-inside-avoid">
                                            <h4>{item.text}</h4>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id || i} className="comment-box slate page-break-inside-avoid">
                                        <div className="comment-title">Remarque / Commentaire :</div>
                                        <div className="comment-text">{item.text}</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={item.id || i} className="citation-box page-break-inside-avoid">
                                    <p>« {item.quote} »</p>
                                    <p className="citation-ref">
                                        {item.sourceTitle || 'Enseignement'} {item.sourceMeta ? `— ${item.sourceMeta}` : ''} {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                    </p>
                                </div>
                            );
                        })}
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
                        <h3 className="text-sm font-bold uppercase text-slate-900 mb-2">Sources & Références ({processedNote.sources.length})</h3>
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
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => directFileInputRef.current?.click()}
                                    disabled={isImportingDirect}
                                    className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm shadow-teal-600/20 disabled:opacity-50"
                                >
                                    <Upload className="w-3.5 h-3.5" />
                                    <span>{isImportingDirect ? 'Importation...' : 'Importer une image'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsGalleryPickerOpen(false)}
                                    className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
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
                                <div className="h-48 flex flex-col items-center justify-center text-zinc-400 gap-3">
                                    <ImageIcon className="w-8 h-8 opacity-40" />
                                    <p className="text-xs">Aucune image trouvée dans ce dossier</p>
                                    <button
                                        type="button"
                                        onClick={() => directFileInputRef.current?.click()}
                                        className="px-4 py-2 bg-teal-600/10 hover:bg-teal-600/20 text-teal-600 dark:text-teal-400 border border-teal-600/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <Upload className="w-3.5 h-3.5" />
                                        <span>Importer une image maintenant</span>
                                    </button>
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
                                                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate" data-tooltip={img.name}>
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
