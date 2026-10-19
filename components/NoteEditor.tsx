import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store';
import { useModalActive } from '../utils/modalUtils';
import { translations } from '../translations';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  Printer, 
  FileText, 
  FileDown, 
  Link2, 
  ExternalLink, 
  NotebookPen, 
  Calendar, 
  MapPin, 
  Lightbulb, 
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
  Tag,
  BookOpen,
  ScrollText,
  GripVertical,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Type,
  ZoomIn,
  ZoomOut,
  Highlighter,
  Copy,
  BookOpenCheck,
  Info,
  History,
  Languages,
  Milestone,
  BookMarked,
  Flame
} from 'lucide-react';
import { getDefinition, WordDefinition } from '../services/dictionaryService';
import NoteSelectorModal from './NoteSelectorModal';
import { StrongOccurrencesModal } from './StrongOccurrencesModal';
import { Citation, NoteSeparator } from '../types';
import { exportNoteToDocx } from '../services/docxExportService';
import { processNoteData, cleanTextArtifacts, stripMarkdown, NoteSectionItem, ProcessedStrongItem } from '../utils/noteFormatter';
import { detectImageMeta } from '../services/imageMediaService';
import { HighlightedQuote } from './HighlightedQuote';
import { splitQuoteIntoHighlightedSegments, HIGHLIGHT_HEX_MAP } from '../utils/highlightUtils';
import { getAllNoteThemes, addCustomTheme } from '../utils/themeUtils';

const ActionButton = ({ onClick, icon: Icon, tooltip }: { onClick: () => void; icon: React.ElementType; tooltip: string }) => (
  <button 
    onClick={onClick} 
    data-tooltip={tooltip}
    className="w-9 h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-zinc-500 hover:text-teal-600 dark:text-zinc-400"
  >
    {Icon && <Icon className="w-4 h-4" />}
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
        addCitationToNote,
        addImageToNote,
        removeImageFromNote,
        removeCitationFromNote,
        updateNoteCitations,
        triggerStudyRequest,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar,
        notesOpen,
        toggleNotes,
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

    // États du sélecteur interactif de thème pour le journal d'étude
    const [showThemePicker, setShowThemePicker] = useState(false);
    const [newThemeInput, setNewThemeInput] = useState('');
    const [isCreatingTheme, setIsCreatingTheme] = useState(false);
    const allThemes = React.useMemo(() => getAllNoteThemes(notes), [notes]);
    const themePickerRef = useRef<HTMLDivElement>(null);

    // Auto-fermeture de la liste déroulante du thème de la note lors d'un clic à l'extérieur
    useEffect(() => {
        if (!showThemePicker) return;
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
                setShowThemePicker(false);
                setIsCreatingTheme(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowThemePicker(false);
                setIsCreatingTheme(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [showThemePicker]);

    // États et références pour la recherche dynamique dans la note consultée
    const [isInNoteSearchOpen, setIsInNoteSearchOpen] = useState(false);
    const [inNoteSearchQuery, setInNoteSearchQuery] = useState('');
    const [activeMatchIndex, setActiveMatchIndex] = useState(0);
    const [totalMatchesCount, setTotalMatchesCount] = useState(0);
    const inNoteSearchInputRef = useRef<HTMLInputElement>(null);

    // Écouteur de raccourci clavier Ctrl+F / Cmd+F
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                setIsInNoteSearchOpen(true);
                setTimeout(() => {
                    if (inNoteSearchInputRef.current) {
                        inNoteSearchInputRef.current.focus();
                        inNoteSearchInputRef.current.select();
                    }
                }, 100);
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    // Focus automatique de l'input quand la recherche s'ouvre
    useEffect(() => {
        if (isInNoteSearchOpen && inNoteSearchInputRef.current) {
            inNoteSearchInputRef.current.focus();
            inNoteSearchInputRef.current.select();
        }
    }, [isInNoteSearchOpen]);

    // Formatage texte avec surlignage des termes recherchés dans la note
    const highlightInNoteMatches = useCallback((text: string) => {
        if (!text) return '';
        if (!inNoteSearchQuery || !inNoteSearchQuery.trim()) return text;
        const escapedQuery = inNoteSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        return text.replace(regex, '<mark class="in-note-search-match bg-amber-300 dark:bg-amber-500/70 text-zinc-900 font-bold px-0.5 rounded shadow-2xs">$1</mark>');
    }, [inNoteSearchQuery]);

    // Navigation entre les occurrences trouvées dans la note
    const updateSearchMatchesAndScroll = useCallback(() => {
        if (!noteScrollContainerRef.current) return;
        const matches = Array.from(noteScrollContainerRef.current.querySelectorAll('.in-note-search-match'));
        setTotalMatchesCount(matches.length);

        if (matches.length === 0) {
            setActiveMatchIndex(0);
            return;
        }

        const validIndex = activeMatchIndex % matches.length;
        matches.forEach((el, idx) => {
            if (idx === validIndex) {
                el.classList.add('active-search-match', 'bg-teal-500', 'text-white', 'ring-2', 'ring-teal-400', 'font-black', 'px-1', 'rounded', 'shadow-sm');
                el.classList.remove('bg-amber-300', 'dark:bg-amber-500/70', 'text-zinc-900');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                el.classList.remove('active-search-match', 'bg-teal-500', 'text-white', 'ring-2', 'ring-teal-400', 'font-black');
                el.classList.add('bg-amber-300', 'dark:bg-amber-500/70', 'text-zinc-900', 'font-bold', 'px-0.5', 'rounded');
            }
        });
    }, [activeMatchIndex]);

    useEffect(() => {
        if (inNoteSearchQuery.trim()) {
            const timer = setTimeout(() => {
                updateSearchMatchesAndScroll();
            }, 100);
            return () => clearTimeout(timer);
        } else {
            setTotalMatchesCount(0);
            setActiveMatchIndex(0);
        }
    }, [inNoteSearchQuery, activeMatchIndex, updateSearchMatchesAndScroll]);

    const handleNextMatch = () => {
        if (totalMatchesCount > 0) {
            setActiveMatchIndex(prev => (prev + 1) % totalMatchesCount);
        }
    };

    const handlePrevMatch = () => {
        if (totalMatchesCount > 0) {
            setActiveMatchIndex(prev => (prev - 1 + totalMatchesCount) % totalMatchesCount);
        }
    };

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

    // Référence du conteneur de défilement de la note pour le positionnement du menu contextuel
    const noteScrollContainerRef = useRef<HTMLDivElement>(null);

    // Menu contextuel de sélection identique au lecteur (Surligner, Copier, Définir, Étudier, Note)
    const [selection, setSelection] = useState<{ text: string; x: number; y: number; citationId?: string } | null>(null);
    const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
    const [isDefining, setIsDefining] = useState(false);
    const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: any; paragraphIndex?: number; highlights?: any[] } | null>(null);
    const [consultingStrongItem, setConsultingStrongItem] = useState<ProcessedStrongItem | null>(null);

    useModalActive(isGalleryPickerOpen);
    useModalActive(!!activeDefinition);
    useModalActive(!!previewImageUrl);
    useModalActive(!!noteSelectorPayload);
    useModalActive(!!consultingStrongItem);

    const handleTextSelection = useCallback((e?: any) => {
        if (e && (e.target as HTMLElement)?.closest && (e.target as HTMLElement).closest('.selection-menu-container')) {
            return;
        }

        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0 && noteScrollContainerRef.current) {
            if (sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);

            if (!noteScrollContainerRef.current.contains(range.commonAncestorContainer)) {
                return;
            }

            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const scrollContainer = noteScrollContainerRef.current;
            const scrollRect = scrollContainer.getBoundingClientRect();

            const menuHeight = 60;
            const spaceAbove = rect.top - scrollRect.top;

            let x = (rect.left + rect.width / 2) - scrollRect.left;
            let y: number;

            if (spaceAbove > menuHeight + 16) {
                y = (rect.top - scrollRect.top) + scrollContainer.scrollTop - menuHeight - 12;
            } else {
                y = (rect.bottom - scrollRect.top) + scrollContainer.scrollTop + 14;
            }

            x = Math.max(180, Math.min(scrollContainer.clientWidth - 180, x));

            const commonNode = range.commonAncestorContainer;
            const cardEl = (commonNode.nodeType === 1 ? (commonNode as HTMLElement) : commonNode.parentElement)?.closest('[data-citation-id]');
            const citationId = cardEl ? cardEl.getAttribute('data-citation-id') || undefined : undefined;

            setSelection({
                text: sel.toString().trim(),
                x,
                y,
                citationId
            });
        } else {
            if (!e || !(e.target as HTMLElement)?.closest?.('.selection-menu-container')) {
                setSelection(null);
            }
        }
    }, []);

    useEffect(() => {
        const handleDocumentSelectionTrigger = () => {
            setTimeout(() => {
                handleTextSelection();
            }, 10);
        };

        const handleSelectionChange = () => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
                setSelection(prev => (prev !== null ? null : prev));
            }
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('mouseup', handleDocumentSelectionTrigger);
        document.addEventListener('touchend', handleDocumentSelectionTrigger);

        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange);
            document.removeEventListener('mouseup', handleDocumentSelectionTrigger);
            document.removeEventListener('touchend', handleDocumentSelectionTrigger);
        };
    }, [handleTextSelection]);

    const handleHighlight = (color: string = 'amber') => {
        if (!selection) return;

        if (selection.citationId && note) {
            const updatedCitations = (note.citations || []).map(c => {
                if (c.id === selection.citationId) {
                    const existingHighlights = [...(c.highlights || [])];
                    const quoteText = c.quoted_text;
                    const selText = selection.text;
                    const matchIdx = quoteText.indexOf(selText);
                    const start = matchIdx !== -1 ? matchIdx : 0;
                    const end = matchIdx !== -1 ? matchIdx + selText.length : selText.length;

                    existingHighlights.push({
                        start,
                        end,
                        color,
                        text: selText
                    });

                    return {
                        ...c,
                        highlights: existingHighlights
                    };
                }
                return c;
            });

            updateNoteCitations(note.id, updatedCitations);
            addNotification(`Citation surlignée en ${color === 'amber' ? 'jaune' : color === 'teal' ? 'turquoise' : color === 'sky' ? 'bleu ciel' : color === 'rose' ? 'rose' : 'violet'}.`, "success");
        } else {
            addNotification(`Surlignage (${color}) appliqué à la sélection.`, "info");
        }

        setSelection(null);
        window.getSelection()?.removeAllRanges();
    };

    const handleCopy = () => {
        if (selection) {
            navigator.clipboard.writeText(selection.text);
            addNotification(t.copy_success, "success");
        }
    };

    const handleAddDefinitionToNote = async () => {
        if (!activeDefinition || !note) return;

        const cleanEtymology = activeDefinition.etymology && activeDefinition.etymology.trim() && activeDefinition.etymology !== 'Non spécifiée' && !activeDefinition.etymology.includes('non répertoriés')
          ? activeDefinition.etymology.trim()
          : null;
        const cleanSynonyms = activeDefinition.synonyms && activeDefinition.synonyms.length > 0
          ? activeDefinition.synonyms.join(', ')
          : null;

        let defText = `${activeDefinition.word}${activeDefinition.grammarNote ? ` (${activeDefinition.grammarNote})` : ''}\n\nDéfinition : ${activeDefinition.definition}`;
        if (cleanEtymology) {
          defText += `\n\nÉtymologie : ${cleanEtymology}`;
        }
        if (cleanSynonyms) {
          defText += `\n\nSynonymes : ${cleanSynonyms}`;
        }

        addCitationToNote(note.id, {
          sermon_id: `definition-${activeDefinition.word.toLowerCase()}`,
          sermon_title_snapshot: `Dictionnaire : ${activeDefinition.word}`,
          sermon_date_snapshot: 'Lexique',
          sermon_version_snapshot: activeDefinition.source || 'Dictionnaire Webster & Français',
          quoted_text: defText
        });

        setActiveDefinition(null);
        addNotification(`Définition de "${activeDefinition.word}" ajoutée à vos notes.`, "success");
    };

    const handleDefine = async () => {
        if (!selection) return;
        const rawText = selection.text.trim();
        const word = rawText.split(/\s+/).length <= 4 && rawText.length <= 45 ? rawText : rawText.split(/\s+/)[0];
        setIsDefining(true);
        setSelection(null);
        try {
            const def = await getDefinition(word);
            setActiveDefinition(def);
        } catch (err: any) {
            addNotification(err.message || "Erreur lors de la recherche de définition", "error");
        } finally {
            setIsDefining(false);
        }
    };

    // Zoom fluide du texte du journal (75% à 200%)
    const [zoomLevel, setZoomLevel] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('kings_sword_journal_zoom');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (!isNaN(parsed) && parsed >= 75 && parsed <= 200) {
                    return parsed;
                }
            }
        } catch {
            // ignore
        }
        return 100;
    });

    const handleZoomIn = () => {
        setZoomLevel(prev => {
            const next = Math.min(200, prev + 10);
            try { localStorage.setItem('kings_sword_journal_zoom', next.toString()); } catch {}
            return next;
        });
    };

    const handleZoomOut = () => {
        setZoomLevel(prev => {
            const next = Math.max(75, prev - 10);
            try { localStorage.setItem('kings_sword_journal_zoom', next.toString()); } catch {}
            return next;
        });
    };

    const handleResetZoom = () => {
        setZoomLevel(100);
        try { localStorage.setItem('kings_sword_journal_zoom', '100'); } catch {}
    };

    // Raccourcis clavier pour le zoom (Ctrl/Cmd +/-, Ctrl/Cmd 0)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
                e.preventDefault();
                handleZoomIn();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
                e.preventDefault();
                handleZoomOut();
            } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                handleResetZoom();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const titleInputRef = useRef<HTMLInputElement>(null);
    const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
    const directFileInputRef = useRef<HTMLInputElement>(null);

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

    // Fermeture automatique du panneau / tiroir de la bibliothèque dès la consultation d'une note
    useEffect(() => {
        if (sidebarOpen) {
            useAppStore.setState({ sidebarOpen: false });
        }
    }, [sidebarOpen]);
    
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

    const processedNote = processNoteData(note, sermons);

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
        if (!sermonId || sermonId.startsWith('ia-response') || sermonId.startsWith('definition-')) return; 
        
        setNavigatedFromNoteId(activeNoteId);
        setSelectedSermonId(sermonId);
        if (typeof paragraphIndex === 'number' && paragraphIndex > 0) {
            setJumpToParagraph(paragraphIndex);
        }
        if (quotedText && quotedText.trim().length > 0) {
            setJumpToText(quotedText.trim());
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

        if (inNoteSearchQuery && inNoteSearchQuery.trim().length >= 1) {
            const escapedQuery = inNoteSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, 'gi');
            html = html.replace(regex, (m) => `<mark class="in-note-search-match bg-amber-300 dark:bg-amber-500/70 text-zinc-900 font-bold px-0.5 rounded shadow-2xs">${m}</mark>`);
        }
        
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
        const stripped = stripMarkdown(str);
        return stripped
            .replace(/[«»]/g, '"')
            .replace(/[’‘`]/g, "'")
            .replace(/[—–─━─]/g, '-')
            .replace(/…/g, '...')
            .replace(/\u00A0/g, ' ')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/[ \t]+/g, ' ')
            .trim();
    };

    const handleExportPdf = async () => {
        if (!note) return;
        addNotification("Capture HTML & Génération du document PDF...", "info");
        try {
            const printEl = document.getElementById("printable-note-container");
            if (!printEl) {
                addNotification("Erreur : Conteneur d'impression introuvable.", "error");
                return;
            }

            // Conteneur hors-champ pour la capture HTML
            const offscreen = document.createElement("div");
            offscreen.style.position = "fixed";
            offscreen.style.left = "-9999px";
            offscreen.style.top = "0";
            offscreen.style.width = "794px"; // 794px = A4 à 96 DPI
            offscreen.style.backgroundColor = "#ffffff";
            offscreen.style.zIndex = "-1000";
            offscreen.style.color = "#0f172a";

            const clone = printEl.cloneNode(true) as HTMLElement;
            clone.style.display = "block";
            clone.classList.remove("hidden");
            clone.classList.remove("print:block");
            clone.style.padding = "32px";
            clone.style.backgroundColor = "#ffffff";
            clone.style.color = "#0f172a";
            clone.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

            offscreen.appendChild(clone);
            document.body.appendChild(offscreen);

            try {
                const canvas = await html2canvas(clone, {
                    scale: 2, // Résolution 192 DPI pour une capture HTML nette
                    useCORS: true,
                    logging: false,
                    backgroundColor: "#ffffff",
                    onclone: (clonedDoc) => {
                        // Supprimer les feuilles de style externes contenant des variables OKLCH incompatibles
                        const styles = Array.from(clonedDoc.querySelectorAll("style, link[rel='stylesheet']"));
                        styles.forEach(s => {
                            if (s.textContent?.includes("oklch") || s.outerHTML.includes("tailwindcss")) {
                                s.remove();
                            }
                        });

                        // Injecter une feuille de style CSS propre et autonome avec des couleurs HEX/RGB standard
                        const cleanStyle = clonedDoc.createElement("style");
                        cleanStyle.textContent = `
                            #printable-note-container {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
                                background-color: #ffffff !important;
                                color: #0f172a !important;
                                padding: 32px !important;
                                display: block !important;
                                box-sizing: border-box !important;
                            }
                            #printable-note-container * {
                                box-sizing: border-box !important;
                            }
                            .border-b-2 { border-bottom: 2px solid #0f766e !important; }
                            .border-teal-700 { border-color: #0f766e !important; }
                            .pb-4 { padding-bottom: 16px !important; }
                            .mb-7 { margin-bottom: 28px !important; }
                            .mb-8 { margin-bottom: 32px !important; }
                            .mb-3 { margin-bottom: 12px !important; }
                            .mb-1 { margin-bottom: 4px !important; }
                            .mt-2 { margin-top: 8px !important; }
                            .my-3 { margin-top: 12px !important; margin-bottom: 12px !important; }
                            .my-4 { margin-top: 16px !important; margin-bottom: 16px !important; }
                            .pl-3 { padding-left: 12px !important; }
                            .p-3\\.5 { padding: 14px !important; }
                            .p-8 { padding: 32px !important; }
                            .flex { display: flex !important; }
                            .items-end { align-items: flex-end !important; }
                            .items-center { align-items: center !important; }
                            .justify-between { justify-content: space-between !important; }
                            .gap-2 { gap: 8px !important; }
                            .gap-3 { gap: 12px !important; }
                            .gap-4 { gap: 16px !important; }
                            .text-right { text-align: right !important; }
                            .text-[11px] { font-size: 11px !important; }
                            .text-[10px] { font-size: 10px !important; }
                            .text-[13px] { font-size: 13px !important; line-height: 1.6 !important; }
                            .text-2xl { font-size: 24px !important; }
                            .text-xs { font-size: 12px !important; }
                            .font-black { font-weight: 900 !important; }
                            .font-bold { font-weight: 700 !important; }
                            .font-sans { font-family: sans-serif !important; }
                            .uppercase { text-transform: uppercase !important; }
                            .tracking-\\[0\\.25em\\] { letter-spacing: 0.25em !important; }
                            .tracking-wider { letter-spacing: 0.05em !important; }
                            .tracking-tight { letter-spacing: -0.025em !important; }
                            .text-teal-800 { color: #115e59 !important; }
                            .text-teal-900 { color: #134e4a !important; }
                            .text-teal-700 { color: #0f766e !important; }
                            .text-teal-600 { color: #0d9488 !important; }
                            .text-slate-900 { color: #0f172a !important; }
                            .text-slate-800 { color: #1e293b !important; }
                            .bg-teal-50 { background-color: #f0fdfa !important; }
                            .bg-slate-50\\/70 { background-color: #f8fafc !important; }
                            .bg-white { background-color: #ffffff !important; }
                            .bg-teal-700 { background-color: #0f766e !important; }
                            .border-teal-200 { border-color: #99f6e4 !important; }
                            .border-teal-600 { border-color: #0d9488 !important; }
                            .border-teal-600\\/30 { border-color: rgba(13, 148, 136, 0.3) !important; }
                            .border-slate-200 { border-color: #e2e8f0 !important; }
                            .border-l-4 { border-left-width: 4px !important; border-left-style: solid !important; }
                            .border-l-2 { border-left-width: 2px !important; border-left-style: solid !important; }
                            .border-b { border-bottom-width: 1px !important; border-bottom-style: solid !important; }
                            .border { border-width: 1px !important; border-style: solid !important; }
                            .rounded { border-radius: 4px !important; }
                            .rounded-full { border-radius: 9999px !important; }
                            .rounded-r-lg { border-top-right-radius: 8px !important; border-bottom-right-radius: 8px !important; }
                            .italic { font-style: italic !important; }
                            .shrink-0 { flex-shrink: 0 !important; }
                            .inline-block { display: inline-block !important; }
                            .w-2 { width: 8px !important; }
                            .h-2 { height: 8px !important; }
                            .w-4 { width: 16px !important; }
                            .h-4 { height: 16px !important; }
                            .m-0 { margin: 0 !important; }
                        `;
                        clonedDoc.head.appendChild(cleanStyle);

                        const target = clonedDoc.getElementById("printable-note-container");
                        if (target) {
                            target.style.display = "block";
                            target.style.visibility = "visible";
                        }
                    }
                });

                const pdf = new jsPDF({
                    orientation: "portrait",
                    unit: "mm",
                    format: "a4"
                });

                const pdfWidth = 210;
                const pdfHeight = 297;
                const pageCanvasHeight = Math.floor(canvas.width * (pdfHeight / pdfWidth));

                let currentY = 0;
                let pageIndex = 0;

                while (currentY < canvas.height) {
                    const sliceHeight = Math.min(pageCanvasHeight, canvas.height - currentY);
                    const pageCanvas = document.createElement("canvas");
                    pageCanvas.width = canvas.width;
                    pageCanvas.height = pageCanvasHeight;
                    const pctx = pageCanvas.getContext("2d");
                    if (pctx) {
                        pctx.fillStyle = "#ffffff";
                        pctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
                        pctx.drawImage(
                            canvas,
                            0, currentY, canvas.width, sliceHeight,
                            0, 0, canvas.width, sliceHeight
                        );
                    }

                    if (pageIndex > 0) {
                        pdf.addPage("a4", "portrait");
                    }
                    const imgData = pageCanvas.toDataURL("image/jpeg", 0.98);
                    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);

                    currentY += sliceHeight;
                    pageIndex++;
                }

                const safeFileName = (note.title || "Note").replace(/[/\\?%*:|"<>]/g, "_").trim();
                pdf.save(`${safeFileName}.pdf`);
                addNotification("Note exportée en PDF avec succès !", "success");
            } finally {
                if (document.body.contains(offscreen)) {
                    document.body.removeChild(offscreen);
                }
            }
        } catch (error) {
            console.error("PDF export error (html2canvas):", error);
            addNotification("Erreur lors de l'exportation PDF par html2canvas.", "error");
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
                            <title>${stripMarkdown(processedNote.title)}</title>
                            <style>
                                @page { size: A4 portrait; margin: 18mm 16mm; }
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 0; margin: 0; color: #0f172a; background: #fff; line-height: 1.6; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                h1 { font-size: 18pt; color: #0f172a; text-transform: uppercase; margin: 0 0 4px; font-weight: 800; letter-spacing: -0.01em; }
                                h2 { font-size: 10pt; color: #0f766e; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; margin: 0; }
                                h3 { font-size: 11pt; color: #0f766e; text-transform: uppercase; border-bottom: 1.5px solid #0f766e; padding-bottom: 4px; margin-top: 20px; margin-bottom: 10px; font-weight: 700; }
                                p { font-size: 10pt; margin-bottom: 8px; line-height: 1.6; color: #1e293b; }
                                .subtitle-separator { text-align: center; margin: 14px 0 10px; padding: 6px 0; border-top: 1px dashed #99f6e4; border-bottom: 1px dashed #99f6e4; background: #f0fdfa; border-radius: 4px; }
                                .subtitle-separator h4 { margin: 0; font-size: 9.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #0f766e; }
                                .subtitle-separator.amber { border-color: #fde68a; background: #fffbeb; }
                                .subtitle-separator.amber h4 { color: #b45309; }
                                .subtitle-separator.slate { border-color: #e2e8f0; background: #f8fafc; }
                                .subtitle-separator.slate h4 { color: #334155; }
                                .comment-box { margin: 10px 0; padding: 8px 12px; background: #f8fafc; border-left: 3.5px solid #0f766e; border-radius: 0 6px 6px 0; }
                                .comment-box.amber { border-left-color: #d97706; background: #fffbeb; }
                                .comment-box.slate { border-left-color: #94a3b8; }
                                .comment-box .comment-title { font-size: 9pt; font-weight: bold; color: #0f766e; margin-bottom: 3px; }
                                .comment-box.amber .comment-title { color: #b45309; }
                                .comment-box .comment-text { font-size: 9.5pt; font-style: italic; color: #334155; margin: 0; }
                                .citation-box { padding: 10px 14px; border-left: 3.5px solid #0d9488; background: #f8fafc; font-style: italic; font-size: 10pt; color: #1e293b; margin: 10px 0; border-radius: 0 6px 6px 0; }
                                .citation-ref { text-align: right; font-size: 8.5pt; font-weight: bold; color: #0f766e; font-style: normal; margin-top: 6px; }
                                .ai-item-box { padding: 12px 16px; border-left: 4px solid #0f766e; background: #f0fdfa; font-size: 10pt; color: #1e293b; margin: 12px 0; border-radius: 0 6px 6px 0; }
                                .print-rich-content h1, .print-rich-content h2, .print-rich-content h3 { color: #0f766e; margin-top: 8px; margin-bottom: 4px; font-weight: 700; }
                                .print-rich-content ul { padding-left: 18px; margin: 6px 0; list-style-type: disc; }
                                .print-rich-content ol { padding-left: 18px; margin: 6px 0; list-style-type: decimal; }
                                .print-rich-content li { margin-bottom: 3px; }
                                .print-rich-content strong { color: #0f172a; font-weight: 700; }
                                .print-rich-content p { margin-bottom: 6px; }
                                mark, .print-highlight { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; padding: 1px 3px; border-radius: 2px; }
                                .page-break-inside-avoid { page-break-inside: avoid; break-inside: avoid; }
                                img { max-width: 100%; max-height: 220px; object-fit: contain; }
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
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
                            <NotebookPen className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-zinc-800 dark:text-zinc-100 leading-none">Journal d'Étude</h2>
                            <div className="flex items-center gap-2 mt-1 opacity-60">
                                <BookMarked className="w-2.5 h-2.5 text-teal-600" />
                                <span className="text-[7px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Chroniques Personnelles</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Contrôles de Zoom In / Zoom Out fluide */}
                        <div className="flex items-center bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl p-0.5 gap-0.5 shadow-2xs">
                            <button
                                type="button"
                                onClick={handleZoomOut}
                                disabled={zoomLevel <= 75}
                                data-tooltip="Réduire le texte (Ctrl -)"
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-white dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                            >
                                <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={handleResetZoom}
                                data-tooltip="Réinitialiser la taille (100% - Ctrl 0)"
                                className="px-2 h-8 flex items-center justify-center rounded-lg text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-white dark:hover:bg-zinc-700 transition-all cursor-pointer select-none"
                            >
                                {zoomLevel}%
                            </button>
                            <button
                                type="button"
                                onClick={handleZoomIn}
                                disabled={zoomLevel >= 200}
                                data-tooltip="Agrandir le texte (Ctrl +)"
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-white dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                            >
                                <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />

                        {/* Champ de recherche intégré directement sur la même barre d'actions */}
                        {isInNoteSearchOpen ? (
                          <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/90 px-2.5 py-1 rounded-xl border border-teal-500/60 ring-2 ring-teal-500/20 shadow-2xs animate-in fade-in zoom-in-95">
                            <Search className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                            <input
                              ref={inNoteSearchInputRef}
                              type="text"
                              value={inNoteSearchQuery}
                              onChange={(e) => {
                                setInNoteSearchQuery(e.target.value);
                                setActiveMatchIndex(0);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (e.shiftKey) {
                                    handlePrevMatch();
                                  } else {
                                    handleNextMatch();
                                  }
                                } else if (e.key === 'Escape') {
                                  setIsInNoteSearchOpen(false);
                                  setInNoteSearchQuery('');
                                }
                              }}
                              placeholder="Rechercher..."
                              className="w-28 sm:w-36 md:w-48 bg-transparent text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none placeholder-zinc-400"
                            />

                            {inNoteSearchQuery.trim() && (
                              <span className="text-[10px] font-extrabold text-teal-700 dark:text-teal-300 bg-teal-600/10 px-1.5 py-0.2 rounded font-mono shrink-0 border border-teal-600/20">
                                {totalMatchesCount > 0 ? `${activeMatchIndex + 1}/${totalMatchesCount}` : '0'}
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={handlePrevMatch}
                              disabled={totalMatchesCount <= 0}
                              data-tooltip="Précédent (Shift + Entrée)"
                              className="p-0.5 rounded text-zinc-500 hover:text-teal-600 hover:bg-white dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={handleNextMatch}
                              disabled={totalMatchesCount <= 0}
                              data-tooltip="Suivant (Entrée)"
                              className="p-0.5 rounded text-zinc-500 hover:text-teal-600 hover:bg-white dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setIsInNoteSearchOpen(false);
                                setInNoteSearchQuery('');
                              }}
                              data-tooltip="Fermer la recherche"
                              className="p-0.5 text-zinc-400 hover:text-red-500 hover:bg-white dark:hover:bg-zinc-700 rounded transition-colors cursor-pointer ml-0.5"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <ActionButton icon={Search} tooltip="Rechercher dans cette note (Ctrl + F)" onClick={() => setIsInNoteSearchOpen(true)} />
                        )}

                        <ActionButton icon={Folder} tooltip="Organiser / Changer de thème" onClick={(e) => { e.stopPropagation(); setShowThemePicker(!showThemePicker); }} />
                        <ActionButton icon={Printer} tooltip={t.print} onClick={handlePrint} />
                        <ActionButton icon={FileText} tooltip={t.export_pdf} onClick={handleExportPdf} />
                        <ActionButton icon={FileDown} tooltip="Exporter au format Word (.docx)" onClick={handleExportDocx} />
                        <ActionButton icon={NotebookPen} tooltip={notesOpen ? "Masquer le panneau de notes" : "Afficher / Ouvrir le panneau de notes"} onClick={toggleNotes} />
                        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-2" />
                        <button onClick={() => { setActiveNoteId(null); setSidebarOpen(true); }} data-tooltip="Fermer et retourner au lecteur" className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-95 text-zinc-600 dark:text-zinc-300 shadow-sm flex items-center gap-1.5 cursor-pointer">
                            <ChevronLeft className="w-3.5 h-3.5" />
                            <span>{t.reader_exit}</span>
                        </button>
                    </div>
                </div>

                <div ref={noteScrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/20 relative">
                    <div 
                        className="max-w-4xl mx-auto p-10 space-y-10 pb-40 transition-all duration-200 origin-top"
                        style={{
                            zoom: zoomLevel !== 100 ? `${zoomLevel}%` : undefined
                        }}
                    >
                        {/* Bloc Titre et Contenu Principal */}
                        <div className="group bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-[40px] p-10 shadow-sm hover:shadow-xl transition-all duration-500">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-10 h-10 flex items-center justify-center bg-teal-600 text-white rounded-2xl text-sm shadow-xl shadow-teal-600/20">
                                    <NotebookPen className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                                    
                                    {/* Badge et Sélecteur Interactif de Thème */}
                                    <div ref={themePickerRef} className="relative inline-block shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setShowThemePicker(!showThemePicker)}
                                            data-tooltip="Cliquer pour changer ou gérer le thème"
                                            className="inline-flex items-center gap-1.5 px-3.5 py-1 bg-teal-600/10 hover:bg-teal-600/20 text-teal-700 dark:text-teal-300 border border-teal-600/20 hover:border-teal-600/40 rounded-full text-xs font-bold transition-all cursor-pointer shadow-2xs"
                                        >
                                            <Tag className="w-3.5 h-3.5 text-teal-600" />
                                            <span>{note.theme || 'Général'}</span>
                                            <ChevronDown className="w-3 h-3 text-teal-600/70" />
                                        </button>

                                        {showThemePicker && (
                                            <div 
                                                onClick={e => e.stopPropagation()}
                                                className="absolute right-0 top-full mt-2 z-50 w-64 p-3 bg-white dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl text-xs space-y-2 animate-in fade-in zoom-in-95"
                                            >
                                                <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-700">
                                                    <span className="font-extrabold text-xs text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                                                        <Folder className="w-4 h-4 text-teal-600" /> Thème de ce journal
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowThemePicker(false)}
                                                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>

                                                <div className="max-h-48 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                                                    {allThemes.map((th) => {
                                                        const isSelected = (note.theme || 'Général') === th;
                                                        return (
                                                            <button
                                                                key={th}
                                                                type="button"
                                                                onClick={() => {
                                                                    updateNote(note.id, { theme: th === 'Général' ? undefined : th });
                                                                    setShowThemePicker(false);
                                                                    addNotification(`Journal classé dans "${th}"`, 'success');
                                                                }}
                                                                className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                                                                    isSelected
                                                                        ? 'bg-teal-600 text-white shadow-2xs'
                                                                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                                                                }`}
                                                            >
                                                                <span className="truncate">{th}</span>
                                                                {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                {!isCreatingTheme ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsCreatingTheme(true)}
                                                        className="w-full text-center py-1.5 text-xs font-bold text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 rounded-xl border border-dashed border-teal-600/30 transition-all flex items-center justify-center gap-1"
                                                    >
                                                        <Plus className="w-3.5 h-3.5" /> Nouveau Thème
                                                    </button>
                                                ) : (
                                                    <form
                                                        onSubmit={(e) => {
                                                            e.preventDefault();
                                                            if (newThemeInput.trim()) {
                                                                const th = newThemeInput.trim();
                                                                addCustomTheme(th);
                                                                updateNote(note.id, { theme: th === 'Général' ? undefined : th });
                                                                setNewThemeInput('');
                                                                setIsCreatingTheme(false);
                                                                setShowThemePicker(false);
                                                                addNotification(`Thème "${th}" créé et assigné !`, 'success');
                                                            }
                                                        }}
                                                        className="flex gap-1"
                                                    >
                                                        <input
                                                            type="text"
                                                            placeholder="Nom du thème..."
                                                            autoFocus
                                                            value={newThemeInput}
                                                            onChange={(e) => setNewThemeInput(e.target.value)}
                                                            className="flex-1 px-2.5 py-1 bg-zinc-50 dark:bg-zinc-900 border border-teal-600 rounded-lg text-xs outline-none"
                                                        />
                                                        <button
                                                            type="submit"
                                                            className="px-2.5 py-1 bg-teal-600 text-white rounded-lg text-xs font-bold"
                                                        >
                                                            OK
                                                        </button>
                                                    </form>
                                                )}
                                            </div>
                                        )}
                                    </div>
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
                                              <div 
                                                key={idx} 
                                                className="font-medium leading-[1.8] select-text [&_p]:my-3.5 [&_p]:leading-[1.8] [&_strong]:font-black [&_strong]:text-zinc-900 dark:[&_strong]:text-white [&_em]:italic [&_em]:text-zinc-600 dark:[&_em]:text-zinc-300 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-zinc-900 dark:[&_h1]:text-white [&_h2]:mt-5 [&_h2]:mb-2.5 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-teal-700 dark:[&_h2]:text-teal-300 [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-teal-600 dark:[&_h3]:text-teal-400 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3.5 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3.5 [&_ol]:space-y-2 [&_li]:my-1.5 [&_li]:leading-relaxed"
                                                dangerouslySetInnerHTML={{ __html: renderRichContent(p) }} 
                                              />
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
                                                  {stripMarkdown(item.text)}
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
                                          data-citation-id={item.citationId}
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
                                          className={`bg-white dark:bg-zinc-900 border rounded-2xl p-5 shadow-xs relative group transition-all ${
                                            isDragging 
                                              ? 'opacity-30 border-dashed border-teal-500' 
                                              : isDragOver
                                                ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-500/20'
                                                : 'border-teal-600/20 dark:border-teal-900/30 hover:border-teal-500/50'
                                          }`}
                                        >
                                          {/* Barre d'en-tête séparée au-dessus du texte */}
                                          <div className="flex items-center justify-between gap-3 mb-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-2.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <Quote className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                                              <span className="text-xs font-bold text-teal-700 dark:text-teal-300 truncate">
                                                {item.reference || 'Bible'}
                                              </span>
                                              {item.sourceIndex && (
                                                <span className="text-[10px] font-black bg-teal-600/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full border border-teal-600/20 shrink-0">
                                                  [{item.sourceIndex}]
                                                </span>
                                              )}
                                            </div>

                                            {item.citationId && (
                                              <div className="flex items-center gap-1 shrink-0">
                                                {item.sermonId && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleJumpToCitation(item.sermonId!, item.quote, item.paragraphIndex)}
                                                    title="Ouvrir dans la prédication à l'endroit exact"
                                                    className="p-1 px-2 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 hover:text-teal-700 dark:hover:text-teal-300 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                                                  >
                                                    <BookOpen className="w-3.5 h-3.5" />
                                                    <span className="hidden sm:inline text-[11px]">Ouvrir</span>
                                                  </button>
                                                )}
                                                <div 
                                                  draggable={Boolean(item.citationId)}
                                                  onDragStart={(e) => {
                                                    if (!item.citationId) return;
                                                    setDraggedCitationId(item.citationId);
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    e.dataTransfer.setData('text/plain', item.citationId);
                                                  }}
                                                  className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 rounded-lg cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
                                          </div>

                                          {/* Texte de la citation avec 100% de largeur sans interférence */}
                                          <blockquote 
                                            className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-[1.8] select-text"
                                          >
                                            <HighlightedQuote quote={item.quote} highlights={item.highlights} withGuillemets />
                                          </blockquote>
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
                                          data-citation-id={item.citationId}
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
                                          className={`bg-white dark:bg-zinc-900 border rounded-2xl p-5 shadow-xs relative group transition-all ${
                                            isDragging 
                                              ? 'opacity-30 border-dashed border-amber-500' 
                                              : isDragOver
                                                ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
                                                : 'border-amber-600/20 dark:border-amber-900/30 hover:border-amber-500/50'
                                          }`}
                                        >
                                          {/* Barre d'en-tête séparée au-dessus du texte */}
                                          <div className="flex items-center justify-between gap-3 mb-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-2.5">
                                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                              <span className="text-xs font-bold text-amber-700 dark:text-amber-300 truncate">
                                                {item.sourceTitle || "Exposé des Sept Âges"}
                                              </span>
                                              {item.sourceMeta && (
                                                <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                  — {item.sourceMeta}
                                                </span>
                                              )}
                                              {item.sourceIndex && (
                                                <span className="text-[10px] font-black bg-amber-600/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-600/20 shrink-0">
                                                  [{item.sourceIndex}]
                                                </span>
                                              )}
                                            </div>

                                            {item.citationId && (
                                              <div className="flex items-center gap-1 shrink-0">
                                                {item.sermonId && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleJumpToCitation(item.sermonId!, item.quote, item.paragraphIndex)}
                                                    title="Ouvrir dans la prédication à l'endroit exact"
                                                    className="p-1 px-2 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-800 dark:hover:text-amber-200 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                                                  >
                                                    <BookOpen className="w-3.5 h-3.5" />
                                                    <span className="hidden sm:inline text-[11px]">Ouvrir</span>
                                                  </button>
                                                )}
                                                <div 
                                                  draggable={Boolean(item.citationId)}
                                                  onDragStart={(e) => {
                                                    if (!item.citationId) return;
                                                    setDraggedCitationId(item.citationId);
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    e.dataTransfer.setData('text/plain', item.citationId);
                                                  }}
                                                  className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 rounded-lg cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
                                          </div>

                                          {/* Texte de la citation avec 100% de largeur sans interférence */}
                                          <blockquote 
                                            className="text-zinc-800 dark:text-zinc-200 italic serif-text text-base leading-[1.8] select-text"
                                          >
                                            <HighlightedQuote quote={item.quote} highlights={item.highlights} withGuillemets />
                                          </blockquote>
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
                                                  {stripMarkdown(item.text)}
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
                                          data-citation-id={item.citationId}
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
                                          className={`bg-white dark:bg-zinc-900 border rounded-2xl p-5 shadow-xs relative group transition-all ${
                                            isDragging 
                                              ? 'opacity-30 border-dashed border-teal-500' 
                                              : isDragOver
                                                ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-500/20'
                                                : 'border-zinc-200 dark:border-zinc-800 hover:border-teal-500/50'
                                          }`}
                                        >
                                          {/* Barre d'en-tête séparée au-dessus du texte */}
                                          <div className="flex items-center justify-between gap-3 mb-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-2.5">
                                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                              <span className="text-xs font-bold text-teal-700 dark:text-teal-300 truncate">
                                                {item.sourceTitle || 'Sermon'}
                                              </span>
                                              {item.sourceMeta && (
                                                <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                  — {item.sourceMeta}
                                                </span>
                                              )}
                                              {item.sourceIndex && (
                                                <span className="text-[10px] font-black bg-teal-600/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full border border-teal-600/20 shrink-0">
                                                  [{item.sourceIndex}]
                                                </span>
                                              )}
                                            </div>

                                            {item.citationId && (
                                              <div className="flex items-center gap-1 shrink-0">
                                                {item.sermonId && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleJumpToCitation(item.sermonId!, item.quote, item.paragraphIndex)}
                                                    title="Ouvrir dans la prédication à l'endroit exact"
                                                    className="p-1 px-2 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 hover:text-teal-700 dark:hover:text-teal-300 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                                                  >
                                                    <BookOpen className="w-3.5 h-3.5" />
                                                    <span className="hidden sm:inline text-[11px]">Ouvrir</span>
                                                  </button>
                                                )}
                                                <div 
                                                  draggable={Boolean(item.citationId)}
                                                  onDragStart={(e) => {
                                                    if (!item.citationId) return;
                                                    setDraggedCitationId(item.citationId);
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    e.dataTransfer.setData('text/plain', item.citationId);
                                                  }}
                                                  className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 rounded-lg cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
                                          </div>

                                          {/* Texte de la citation avec 100% de largeur sans interférence */}
                                          <blockquote 
                                            className="text-zinc-800 dark:text-zinc-200 serif-text text-base leading-[1.8] select-text"
                                          >
                                            <HighlightedQuote quote={item.quote} highlights={item.highlights} />
                                          </blockquote>
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

                            {/* Section Études & Réponses du Dock IA */}
                            {processedNote.aiItems && processedNote.aiItems.length > 0 && (
                              <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-2">
                                    <Lightbulb className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                                    <span>Études & Réponses du Dock IA ({processedNote.aiItems.length})</span>
                                  </h4>
                                </div>

                                {processedNote.aiItems.map((item, idx) => {
                                  const isDragging = draggedCitationId === item.citationId;
                                  const isDragOver = dragOverCitationId === item.citationId;

                                  return (
                                    <div
                                      key={item.citationId || idx}
                                      data-citation-id={item.citationId}
                                      onDragOver={(e) => {
                                        e.preventDefault();
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
                                        setDragOverCitationId(null);
                                        if (draggedCitationId && item.citationId && draggedCitationId !== item.citationId) {
                                          handleReorderCitations(draggedCitationId, item.citationId);
                                        }
                                      }}
                                      className={`p-5 rounded-2xl border transition-all duration-300 relative group/card ${
                                        isDragOver
                                          ? 'border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30'
                                          : isDragging
                                            ? 'opacity-40 border-dashed border-teal-500'
                                            : 'border-teal-200/70 dark:border-teal-900/40 bg-teal-50/20 dark:bg-teal-950/20 hover:border-teal-500/50 shadow-xs'
                                      }`}
                                    >
                                      {/* Header */}
                                      <div className="flex items-start justify-between gap-4 mb-3 border-b border-teal-100 dark:border-teal-900/50 pb-2.5">
                                        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                                          <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
                                            <Lightbulb className="w-4 h-4" />
                                          </div>
                                          <div>
                                            <div className="text-[10px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400">
                                              Assistant IA
                                              {item.date && <span className="font-mono text-zinc-400 ml-1.5 font-normal">({item.date})</span>}
                                              {item.sourceIndex && (
                                                <span className="text-zinc-500 font-bold ml-1.5">[{item.sourceIndex}]</span>
                                              )}
                                            </div>
                                            <h5 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-white truncate">
                                              {item.title}
                                            </h5>
                                          </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 shrink-0">
                                          <div
                                            draggable={Boolean(item.citationId)}
                                            onDragStart={(e) => {
                                              setDraggedCitationId(item.citationId);
                                              e.dataTransfer.setData('text/plain', item.citationId);
                                            }}
                                            onDragEnd={() => {
                                              setDraggedCitationId(null);
                                              setDragOverCitationId(null);
                                            }}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-grab active:cursor-grabbing transition-colors"
                                            title="Glisser pour déplacer cette étude"
                                          >
                                            <GripVertical className="w-4 h-4" />
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() => handleMoveCitation(item.citationId, 'up', processedNote.aiItems.map(a => ({ citationId: a.citationId })))}
                                            disabled={idx === 0}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-20 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            title="Monter"
                                          >
                                            <ChevronUp className="w-4 h-4" />
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => handleMoveCitation(item.citationId, 'down', processedNote.aiItems.map(a => ({ citationId: a.citationId })))}
                                            disabled={idx === processedNote.aiItems.length - 1}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-20 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            title="Descendre"
                                          >
                                            <ChevronDown className="w-4 h-4" />
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => {
                                              navigator.clipboard.writeText(item.content);
                                              addNotification("Étude de l'Assistant copiée dans le presse-papiers.", "success");
                                            }}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors"
                                            title="Copier le texte"
                                          >
                                            <Copy className="w-4 h-4" />
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => removeCitationFromNote(note.id, item.citationId)}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                            title="Supprimer cette étude de la note"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Rich Content Display */}
                                      <div
                                        className="text-zinc-800 dark:text-zinc-200 text-sm leading-relaxed select-text space-y-2.5"
                                        dangerouslySetInnerHTML={{ __html: renderRichContent(item.content) }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Section Concordance & Exégèse Strong */}
                            {processedNote.strongItems && processedNote.strongItems.length > 0 && (
                              <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-2">
                                    <Languages className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                                    <span>Concordance & Exégèse Strong ({processedNote.strongItems.length})</span>
                                  </h4>
                                </div>

                                {processedNote.strongItems.map((item, idx) => {
                                  const isDragging = draggedCitationId === item.citationId;
                                  const isDragOver = dragOverCitationId === item.citationId;
                                  const hasMultipleOccs = item.allOccurrences && item.allOccurrences.length > 1;

                                  return (
                                    <div 
                                      key={item.citationId || idx}
                                      data-citation-id={item.citationId}
                                      onDragOver={(e) => {
                                        e.preventDefault();
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
                                        setDragOverCitationId(null);
                                        if (draggedCitationId && item.citationId && draggedCitationId !== item.citationId) {
                                          handleReorderCitations(draggedCitationId, item.citationId);
                                        }
                                      }}
                                      className={`p-5 rounded-2xl border transition-all duration-300 relative group/card ${
                                        isDragOver 
                                          ? 'border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30' 
                                          : isDragging 
                                            ? 'opacity-40 border-dashed border-teal-500' 
                                            : 'border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 hover:border-teal-500/40 shadow-xs hover:shadow-md'
                                      }`}
                                    >
                                      {/* Header of Strong Card */}
                                      <div className="flex items-start justify-between gap-4 mb-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <div className="w-10 h-10 rounded-2xl bg-teal-700 text-white dark:bg-teal-600 dark:text-white flex items-center justify-center border border-teal-600/40 shadow-xs shrink-0 font-mono text-xs font-black">
                                            {item.strongNumber}
                                          </div>
                                          <div className="min-w-0">
                                            <div className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-1.5 mb-0.5">
                                              <span>Exégèse Strong</span>
                                              <span className="text-zinc-400">•</span>
                                              <span className="font-mono text-zinc-500 dark:text-zinc-400">{item.type === 'hebrew' ? 'Hébreu' : 'Grec'}</span>
                                              {item.sourceIndex && (
                                                <span className="text-zinc-500 font-bold ml-1">[{item.sourceIndex}]</span>
                                              )}
                                            </div>
                                            <h5 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white tracking-tight truncate flex items-center gap-2">
                                              <span>{stripMarkdown(item.word)}</span>
                                              {item.original && (
                                                <span className="font-mono text-sm text-teal-700 dark:text-teal-300 font-medium">({stripMarkdown(item.original)})</span>
                                              )}
                                            </h5>
                                            {item.pronunciation && (
                                              <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 font-mono">
                                                [{stripMarkdown(item.pronunciation)}]
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 shrink-0">
                                          {/* Drag Handle */}
                                          <div 
                                            draggable={Boolean(item.citationId)}
                                            onDragStart={(e) => {
                                              setDraggedCitationId(item.citationId);
                                              e.dataTransfer.setData('text/plain', item.citationId);
                                            }}
                                            onDragEnd={() => {
                                              setDraggedCitationId(null);
                                              setDragOverCitationId(null);
                                            }}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-grab active:cursor-grabbing transition-colors"
                                            title="Glisser pour déplacer cette exégèse"
                                          >
                                            <GripVertical className="w-4 h-4" />
                                          </div>

                                          {/* Move Up */}
                                          <button
                                            type="button"
                                            onClick={() => handleMoveCitation(item.citationId, 'up', processedNote.strongItems)}
                                            disabled={idx === 0}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-20 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            title="Monter"
                                          >
                                            <ChevronUp className="w-4 h-4" />
                                          </button>

                                          {/* Move Down */}
                                          <button
                                            type="button"
                                            onClick={() => handleMoveCitation(item.citationId, 'down', processedNote.strongItems)}
                                            disabled={idx === processedNote.strongItems.length - 1}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-20 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            title="Descendre"
                                          >
                                            <ChevronDown className="w-4 h-4" />
                                          </button>

                                          {/* Copy */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const copyText = `Strong ${item.strongNumber} — ${item.word} (${item.original}) [${item.pronunciation}]\n\nDéfinition : ${item.definition}${item.messageContext ? `\n\nÉclairage dans le Message : ${item.messageContext}` : ''}${item.originVerseRef ? `\n\nVerset d'origine (${item.originVerseRef}) : « ${item.originVerseText} »` : ''}`;
                                              navigator.clipboard.writeText(copyText);
                                              addNotification("Exégèse Strong copiée dans le presse-papiers.", "success");
                                            }}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors"
                                            title="Copier l'exégèse"
                                          >
                                            <Copy className="w-4 h-4" />
                                          </button>

                                          {/* Delete */}
                                          <button
                                            type="button"
                                            onClick={() => removeCitationFromNote(note.id, item.citationId)}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                            title="Supprimer cette exégèse de la note"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Metadata Details Section */}
                                      {(item.partOfSpeech || item.etymology || item.translationsLSG || item.occurrencesCountStr) && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-50/90 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800 rounded-xl p-3 mb-3">
                                          {item.partOfSpeech && (
                                            <div>
                                              <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 block">Nature</span>
                                              <span className="text-zinc-800 dark:text-zinc-200 font-medium">{stripMarkdown(item.partOfSpeech)}</span>
                                            </div>
                                          )}
                                          {item.etymology && (
                                            <div>
                                              <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 block">Racine / Origine</span>
                                              <span className="text-zinc-800 dark:text-zinc-200 font-medium">{stripMarkdown(item.etymology)}</span>
                                            </div>
                                          )}
                                          {item.translationsLSG && (
                                            <div className="sm:col-span-2 border-t border-slate-200/60 dark:border-zinc-800/60 pt-1.5 mt-0.5">
                                              <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 block">Traductions (LSG)</span>
                                              <span className="text-zinc-800 dark:text-zinc-200 font-medium">{stripMarkdown(item.translationsLSG)}</span>
                                            </div>
                                          )}
                                          {item.occurrencesCountStr && (
                                            <div className="sm:col-span-2 border-t border-slate-200/60 dark:border-zinc-800/60 pt-1.5 mt-0.5">
                                              <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 block">Fréquence</span>
                                              <span className="text-zinc-800 dark:text-zinc-200 font-medium">{stripMarkdown(item.occurrencesCountStr)}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Definition Section */}
                                      <div className="space-y-2 mb-3">
                                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                          <Info className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                                          <span>Définition Littérale</span>
                                        </div>
                                        <div className="p-4 bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 rounded-xl relative overflow-hidden group">
                                          <div className="absolute top-0 left-0 w-1 h-full bg-teal-600 dark:bg-teal-500" />
                                          <p className="text-zinc-800 dark:text-zinc-200 serif-text text-base leading-[1.8] select-text pl-1">
                                            {stripMarkdown(item.definition)}
                                          </p>
                                        </div>
                                      </div>

                                      {/* Message Context Section */}
                                      {item.messageContext && (
                                        <div className="space-y-2 mb-3">
                                          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400">
                                            <Flame className="w-3.5 h-3.5" />
                                            <span>Éclairage dans le Message du Temps de la Fin</span>
                                          </div>
                                          <div className="p-4 bg-teal-500/5 dark:bg-teal-950/20 border border-teal-500/20 dark:border-teal-800/40 rounded-xl relative overflow-hidden">
                                            <p className="text-zinc-800 dark:text-zinc-200 serif-text text-base leading-[1.8] italic select-text">
                                              {stripMarkdown(item.messageContext)}
                                            </p>
                                          </div>
                                        </div>
                                      )}

                                      {/* Verset d'origine (Affichage unique et épuré) */}
                                      {item.originVerseRef && item.originVerseText && (
                                        <div className="space-y-2 mb-3">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                              <BookOpen className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                                              <span>Verset d'Origine — <strong className="text-teal-700 dark:text-teal-300">{item.originVerseRef}</strong></span>
                                            </div>
                                          </div>
                                          <div className="p-4 bg-slate-50/70 dark:bg-zinc-950/40 border border-slate-200/80 dark:border-zinc-800 rounded-xl">
                                            <p className="text-zinc-800 dark:text-zinc-200 serif-text text-base leading-[1.8] italic select-text">
                                              « {stripMarkdown(item.originVerseText)} »
                                            </p>
                                          </div>
                                        </div>
                                      )}

                                      {/* Consultation des autres versets (Lien / Fenêtre popup consultable) */}
                                      {hasMultipleOccs && (
                                        <div className="pt-2 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/80 mt-3 flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => setConsultingStrongItem(item)}
                                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-teal-700 dark:text-teal-300 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/80 transition-all cursor-pointer shadow-2xs group"
                                          >
                                            <BookOpen className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 group-hover:scale-110 transition-transform" />
                                            <span>Consulter les {item.allOccurrences!.length - 1} autre{item.allOccurrences!.length - 1 > 1 ? 's' : ''} verset{item.allOccurrences!.length - 1 > 1 ? 's' : ''} dans les Écritures</span>
                                            <ExternalLink className="w-3 h-3 opacity-60 ml-0.5" />
                                          </button>
                                          <span className="text-[10px] font-mono font-medium text-zinc-400">
                                            {item.allOccurrences!.length} versets totaux
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Section Dictionnaire & Lexique Biblique */}
                            {processedNote.definitionItems && processedNote.definitionItems.length > 0 && (
                              <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-2">
                                    <BookOpenCheck className="w-4 h-4" />
                                    <span>Dictionnaire & Lexique Biblique ({processedNote.definitionItems.length})</span>
                                  </h4>
                                </div>

                                {processedNote.definitionItems.map((item, idx) => {
                                  const isDragging = draggedCitationId === item.citationId;
                                  const isDragOver = dragOverCitationId === item.citationId;

                                  return (
                                    <div 
                                      key={item.citationId || idx}
                                      data-citation-id={item.citationId}
                                      onDragOver={(e) => {
                                        e.preventDefault();
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
                                        setDragOverCitationId(null);
                                        if (draggedCitationId && item.citationId && draggedCitationId !== item.citationId) {
                                          handleReorderCitations(draggedCitationId, item.citationId);
                                        }
                                      }}
                                      className={`p-5 rounded-2xl border transition-all duration-300 relative group/card ${
                                        isDragOver 
                                          ? 'border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30' 
                                          : isDragging 
                                            ? 'opacity-40 border-dashed border-teal-500' 
                                            : 'border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 hover:border-teal-500/40 shadow-xs hover:shadow-md'
                                      }`}
                                    >
                                      {/* Header of Definition Card */}
                                      <div className="flex items-start justify-between gap-4 mb-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <div className="w-9 h-9 rounded-xl bg-teal-600/10 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-600/20 shrink-0">
                                            <BookOpenCheck className="w-4 h-4" />
                                          </div>
                                          <div className="min-w-0">
                                            <span className="text-[9px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 block mb-0.5">
                                              Dictionnaire Biblique & Théologique
                                            </span>
                                            <h5 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">
                                              {item.word}
                                            </h5>
                                          </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 shrink-0">
                                          {/* Drag Handle */}
                                          <div 
                                            draggable={Boolean(item.citationId)}
                                            onDragStart={(e) => {
                                              setDraggedCitationId(item.citationId);
                                              e.dataTransfer.setData('text/plain', item.citationId);
                                            }}
                                            onDragEnd={() => {
                                              setDraggedCitationId(null);
                                              setDragOverCitationId(null);
                                            }}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-grab active:cursor-grabbing transition-colors"
                                            title="Glisser pour déplacer cette définition"
                                          >
                                            <GripVertical className="w-4 h-4" />
                                          </div>

                                          {/* Move Up */}
                                          <button
                                            type="button"
                                            onClick={() => handleMoveCitation(item.citationId, 'up', processedNote.definitionItems)}
                                            disabled={idx === 0}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-20 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            title="Monter"
                                          >
                                            <ChevronUp className="w-4 h-4" />
                                          </button>

                                          {/* Move Down */}
                                          <button
                                            type="button"
                                            onClick={() => handleMoveCitation(item.citationId, 'down', processedNote.definitionItems)}
                                            disabled={idx === processedNote.definitionItems.length - 1}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-20 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                            title="Descendre"
                                          >
                                            <ChevronDown className="w-4 h-4" />
                                          </button>

                                          {/* Copy */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const copyText = `${item.word} : ${item.definition}${item.etymology ? `\nÉtymologie : ${item.etymology}` : ''}${item.synonyms?.length ? `\nSynonymes : ${item.synonyms.join(', ')}` : ''}`;
                                              navigator.clipboard.writeText(copyText);
                                              addNotification("Définition copiée dans le presse-papiers.", "success");
                                            }}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors"
                                            title="Copier la définition"
                                          >
                                            <Copy className="w-4 h-4" />
                                          </button>

                                          {/* Delete */}
                                          <button
                                            type="button"
                                            onClick={() => removeCitationFromNote(note.id, item.citationId)}
                                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                            title="Supprimer cette définition de la note"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Definition Body */}
                                      <div className="serif-text text-base leading-[1.8] text-zinc-800 dark:text-zinc-200 select-text pl-1 py-1">
                                        {stripMarkdown(item.definition)}
                                      </div>

                                      {/* Etymology */}
                                      {item.etymology && (
                                        <div className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 mt-3 select-text">
                                          <History className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                                          <div className="leading-relaxed">
                                            <span className="font-bold text-zinc-700 dark:text-zinc-300">Étymologie :</span> {stripMarkdown(item.etymology)}
                                          </div>
                                        </div>
                                      )}

                                      {/* Synonyms */}
                                      {item.synonyms && item.synonyms.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80">
                                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mr-1">Synonymes :</span>
                                          {item.synonyms.map((syn, synIdx) => (
                                            <span 
                                              key={synIdx} 
                                              className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-teal-600/10 text-teal-700 dark:text-teal-300 border border-teal-600/20"
                                            >
                                              {syn}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
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
                                            draggable
                                            onDragStart={(e) => {
                                              setDraggedSourceIdx(srcIdx);
                                              e.dataTransfer.effectAllowed = 'move';
                                              e.dataTransfer.setData('text/plain', String(srcIdx));
                                            }}
                                            className="cursor-grab active:cursor-grabbing text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors shrink-0"
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
                                          {src.sermonId && (
                                            <button
                                              type="button"
                                              onClick={() => handleJumpToCitation(src.sermonId!, src.quotedText, src.paragraphIndex)}
                                              title="Ouvrir cette source dans le lecteur à l'endroit exact"
                                              className="p-1 px-2 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 hover:text-teal-700 dark:hover:text-teal-300 transition-all cursor-pointer flex items-center gap-1 text-[11px] font-semibold shrink-0"
                                            >
                                              <BookOpen className="w-3.5 h-3.5" />
                                              <span className="hidden sm:inline">Consulter</span>
                                            </button>
                                          )}
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

                    {/* Menu contextuel flottant de sélection de texte identique au lecteur */}
                    {selection && (
                      <div 
                        className="absolute z-[200000] no-print selection-menu-container animate-in fade-in zoom-in-95 duration-200 ease-out antialiased" 
                        style={{ 
                          left: Math.round(selection.x), 
                          top: Math.round(selection.y), 
                          transform: 'translateX(-50%) translateZ(0)' 
                        }}
                      >
                        <div className="flex items-center bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl p-1.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.1)] pointer-events-auto border border-white/40 dark:border-zinc-800 overflow-hidden transform-gpu">
                          <div className="flex items-center">
                            <button 
                              onClick={() => handleHighlight('amber')} 
                              className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-amber-500/15 text-zinc-800 dark:text-zinc-200 hover:text-amber-700 dark:hover:text-amber-400 rounded-xl active:scale-95 group transition-colors cursor-pointer"
                              data-tooltip="Surligner en jaune"
                            >
                              <Highlighter className="w-4 h-4 text-amber-500" />
                              <span className="text-[8px] font-bold uppercase tracking-tight">Surligner</span>
                            </button>
                            <div className="flex items-center gap-1.5 px-2 py-1">
                              {[
                                { key: 'amber', bg: 'bg-amber-400 dark:bg-amber-500', label: 'Jaune' },
                                { key: 'teal', bg: 'bg-teal-400 dark:bg-teal-500', label: 'Turquoise' },
                                { key: 'sky', bg: 'bg-sky-400 dark:bg-sky-500', label: 'Bleu ciel' },
                                { key: 'rose', bg: 'bg-rose-400 dark:bg-rose-500', label: 'Rose' },
                                { key: 'violet', bg: 'bg-violet-400 dark:bg-violet-500', label: 'Violet' }
                              ].map(c => (
                                <button
                                  key={c.key}
                                  onClick={(e) => { e.stopPropagation(); handleHighlight(c.key); }}
                                  className={`w-4 h-4 rounded-full ${c.bg} hover:scale-130 active:scale-90 transition-transform shadow-xs border border-black/15 dark:border-white/20 cursor-pointer`}
                                  data-tooltip={`Surligner en ${c.label}`}
                                />
                              ))}
                            </div>
                          </div>

                          <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-700/80 my-auto mx-1" />
                          <button onClick={() => { handleCopy(); setSelection(null); }} data-tooltip="Copier le texte sélectionné" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-zinc-500/10 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><Copy className="w-4 h-4 text-zinc-500" /><span className="text-[8px] font-bold uppercase tracking-tight">Copier</span></button>
                          <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-700/80 my-auto mx-1" />
                          <button onClick={() => { handleDefine(); setSelection(null); }} data-tooltip="Définir ce mot dans le dictionnaire" data-tooltip-icon="book" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-sky-500/15 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><BookOpen className="w-4 h-4 text-sky-500" /><span className="text-[8px] font-bold uppercase tracking-tight">Définir</span></button>
                          <button onClick={() => { triggerStudyRequest(selection.text); setSelection(null); }} data-tooltip="Étudier avec l'assistant IA" data-tooltip-icon="lightbulb" className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-teal-600/15 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"><Lightbulb className="w-4 h-4 text-teal-600 animate-pulse" /><span className="text-[8px] font-bold uppercase tracking-tight">Étudier</span></button>
                          <div className="w-px h-6 bg-zinc-200/80 dark:bg-zinc-700/80 my-auto mx-1" />
                          <button 
                            onClick={() => { 
                              setNoteSelectorPayload({ 
                                text: selection.text, 
                                sermon: {
                                  id: 'journal-selection',
                                  title: note?.title || "Extrait du Journal d'étude",
                                  date: note?.date || new Date().toISOString(),
                                  paragraphs: [selection.text]
                                }, 
                                paragraphIndex: undefined,
                                highlights: undefined 
                              }); 
                              setSelection(null); 
                            }} 
                            data-tooltip="Ajouter cet extrait au journal de notes" 
                            data-tooltip-icon="notes" 
                            className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-emerald-500/15 text-zinc-800 dark:text-zinc-200 rounded-xl active:scale-95 transition-colors cursor-pointer"
                          >
                            <NotebookPen className="w-4 h-4 text-emerald-500" />
                            <span className="text-[8px] font-bold uppercase tracking-tight">Note</span>
                          </button>
                        </div>
                      </div>
                    )}
                </div>
            </div>

            {/* Zone dédiée à l'impression (Imprimante / window.print) */}
            <div id="printable-note-container" className="hidden print:block p-8 bg-white text-slate-900 font-sans leading-relaxed">
                {/* En-tête officiel du document */}
                <div className="border-b-2 border-teal-700 pb-4 mb-7 flex items-end justify-between">
                    <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.25em] text-teal-800 mb-1">
                            KING'S SWORD &bull; ÉTUDE BIBLIQUE &amp; SERMONS
                        </div>
                        <h1 className="text-2xl font-bold uppercase tracking-tight text-slate-900 leading-tight">
                            {stripMarkdown(processedNote.title)}
                        </h1>
                    </div>
                    <div className="text-right shrink-0">
                        <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-teal-900 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded">
                            {note.date ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('fr-FR')}
                        </span>
                    </div>
                </div>

                {/* Contenu Principal */}
                {processedNote.contentParagraphs.length > 0 && (
                    <div className="mb-8 space-y-3 page-break-inside-avoid">
                        <div className="flex items-center gap-2 border-b border-teal-600/30 pb-1.5 mb-3">
                            <span className="w-2 h-2 rounded-full bg-teal-700"></span>
                            <h2 className="text-xs font-black uppercase tracking-wider text-teal-900 m-0">Contenu Principal</h2>
                        </div>
                        <div className="space-y-3 pl-3 border-l-2 border-slate-200">
                            {processedNote.contentParagraphs.map((p, i) => (
                                <p key={i} className="text-[13px] text-slate-800 leading-relaxed font-normal m-0 text-justify">
                                    {stripMarkdown(p)}
                                </p>
                            ))}
                        </div>
                    </div>
                )}

                {/* 1. Citations Bibliques */}
                {processedNote.scriptureItems && processedNote.scriptureItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-2 border-b border-teal-600/30 pb-1.5 mb-3">
                            <BookOpen className="w-4 h-4 text-teal-700 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-teal-900 m-0">Citations Bibliques</h2>
                        </div>
                        {processedNote.scriptureItems.map((item, i) => {
                            if (item.kind === 'separator') {
                                if (item.separatorType === 'subtitle') {
                                    return (
                                        <div key={item.id || i} className="subtitle-separator page-break-inside-avoid my-4">
                                            <h4>{stripMarkdown(item.text)}</h4>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id || i} className="comment-box page-break-inside-avoid my-3">
                                        <div className="comment-title">Remarque / Commentaire :</div>
                                        <div className="comment-text">{stripMarkdown(item.text)}</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={item.id || i} className="citation-box page-break-inside-avoid bg-slate-50/70 p-3.5 rounded-r-lg border-l-4 border-teal-600 my-3">
                                    <p className="text-[13px] text-slate-800 leading-relaxed italic m-0">
                                        <HighlightedQuote quote={stripMarkdown(item.quote)} highlights={item.highlights} isPrint withGuillemets />
                                    </p>
                                    <div className="citation-ref text-right mt-2 text-[11px] font-bold text-teal-800">
                                        {stripMarkdown(item.reference || 'Bible')} {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 2. Citations de l'Exposé des Sept Âges */}
                {processedNote.churchAgeItems && processedNote.churchAgeItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-2 border-b border-amber-600/30 pb-1.5 mb-3">
                            <ScrollText className="w-4 h-4 text-amber-600 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-amber-900 m-0">Citations de l'Exposé des Sept Âges</h2>
                        </div>
                        {processedNote.churchAgeItems.map((item, i) => {
                            if (item.kind === 'separator') {
                                if (item.separatorType === 'subtitle') {
                                    return (
                                        <div key={item.id || i} className="subtitle-separator amber page-break-inside-avoid my-4">
                                            <h4>{stripMarkdown(item.text)}</h4>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id || i} className="comment-box amber page-break-inside-avoid my-3">
                                        <div className="comment-title">Remarque / Commentaire :</div>
                                        <div className="comment-text">{stripMarkdown(item.text)}</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={item.id || i} className="citation-box page-break-inside-avoid bg-amber-50/50 p-3.5 rounded-r-lg border-l-4 border-amber-600 my-3">
                                    <p className="text-[13px] text-slate-800 leading-relaxed italic m-0">
                                        <HighlightedQuote quote={stripMarkdown(item.quote)} highlights={item.highlights} isPrint withGuillemets />
                                    </p>
                                    <div className="citation-ref text-right mt-2 text-[11px] font-bold text-amber-900">
                                        {stripMarkdown(item.sourceTitle || "Exposé des Sept Âges")} {item.sourceMeta ? `— ${stripMarkdown(item.sourceMeta)}` : ''} {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 3. Citations & Enseignements */}
                {processedNote.teachingItems && processedNote.teachingItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-400/40 pb-1.5 mb-3">
                            <Quote className="w-4 h-4 text-slate-700 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 m-0">Citations & Enseignements</h2>
                        </div>
                        {processedNote.teachingItems.map((item, i) => {
                            if (item.kind === 'separator') {
                                if (item.separatorType === 'subtitle') {
                                    return (
                                        <div key={item.id || i} className="subtitle-separator slate page-break-inside-avoid my-4">
                                            <h4>{stripMarkdown(item.text)}</h4>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={item.id || i} className="comment-box slate page-break-inside-avoid my-3">
                                        <div className="comment-title">Remarque / Commentaire :</div>
                                        <div className="comment-text">{stripMarkdown(item.text)}</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={item.id || i} className="citation-box page-break-inside-avoid bg-slate-50/70 p-3.5 rounded-r-lg border-l-4 border-slate-600 my-3">
                                    <p className="text-[13px] text-slate-800 leading-relaxed italic m-0">
                                        <HighlightedQuote quote={stripMarkdown(item.quote)} highlights={item.highlights} isPrint withGuillemets />
                                    </p>
                                    <div className="citation-ref text-right mt-2 text-[11px] font-bold text-slate-700">
                                        {stripMarkdown(item.sourceTitle || 'Enseignement')} {item.sourceMeta ? `— ${stripMarkdown(item.sourceMeta)}` : ''} {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 3.5. Études & Réponses du Dock IA */}
                {processedNote.aiItems && processedNote.aiItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-2 border-b border-teal-600/30 pb-1.5 mb-3">
                            <Lightbulb className="w-4 h-4 text-teal-700 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-teal-900 m-0">
                                Études & Réponses du Dock IA ({processedNote.aiItems.length})
                            </h2>
                        </div>
                        {processedNote.aiItems.map((item, i) => (
                            <div key={item.citationId || i} className="ai-item-box page-break-inside-avoid bg-teal-50/50 p-5 rounded-2xl border border-teal-200/80 my-4 text-slate-800 shadow-xs">
                                <div className="flex items-center gap-2.5 mb-3 pb-2 border-b border-teal-600/20">
                                    <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                                        <Lightbulb className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-wider text-teal-700 flex items-center gap-1.5 flex-wrap">
                                            <span>Assistant IA</span>
                                            {item.date && <span className="font-mono text-slate-400 font-normal">({item.date})</span>}
                                            {item.sourceIndex && <span className="text-teal-800 font-bold">[{item.sourceIndex}]</span>}
                                        </div>
                                        <div className="font-extrabold text-slate-900 text-sm truncate">
                                            {stripMarkdown(item.title)}
                                        </div>
                                    </div>
                                </div>
                                <div 
                                    className="text-[12.5px] leading-relaxed text-slate-800 print-rich-content space-y-2.5"
                                    dangerouslySetInnerHTML={{ __html: renderRichContent(item.content) }}
                                />
                                <div className="citation-ref text-right mt-3 pt-1 border-t border-teal-600/10 text-[10.5px] font-bold text-teal-800">
                                    Assistant IA King's Sword {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 4. Concordance & Exégèse Strong */}
                {processedNote.strongItems && processedNote.strongItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-2 border-b border-teal-600/30 pb-1.5 mb-3">
                            <Languages className="w-4 h-4 text-teal-700 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-teal-900 m-0">Concordance & Exégèse Strong ({processedNote.strongItems.length})</h2>
                        </div>
                        {processedNote.strongItems.map((item, i) => (
                            <div key={item.citationId || i} className="citation-box page-break-inside-avoid bg-slate-50/70 p-3.5 rounded-r-lg border-l-4 border-teal-700 my-3">
                                <p className="font-bold text-slate-900 not-italic text-[13px] m-0">
                                    Strong {item.strongNumber} : {stripMarkdown(item.word)} {item.original ? `(${stripMarkdown(item.original)})` : ''} — [{stripMarkdown(item.pronunciation)}] ({item.type === 'hebrew' ? 'Hébreu' : 'Grec'})
                                </p>
                                <div className="mt-1.5 text-slate-800 text-[12px] leading-relaxed whitespace-pre-line">
                                    <strong className="text-teal-900">Définition :</strong> {stripMarkdown(item.definition)}
                                </div>
                                {item.messageContext && (
                                    <div className="mt-1.5 text-slate-800 italic text-[12px] leading-relaxed whitespace-pre-line">
                                        <strong className="text-teal-800 not-italic">Éclairage dans le Message :</strong> {stripMarkdown(item.messageContext)}
                                    </div>
                                )}
                                {item.originVerseRef && item.originVerseText && (
                                    <div className="mt-2 pl-3 border-l-2 border-teal-600 py-1 bg-white rounded text-[11.5px]">
                                        <p className="font-semibold text-slate-700 m-0">Verset d'origine ({item.originVerseRef}) :</p>
                                        <p className="italic text-slate-800 mt-0.5 m-0">« {stripMarkdown(item.originVerseText)} »</p>
                                    </div>
                                )}
                                {item.allOccurrences && item.allOccurrences.length > 1 && (
                                    <p className="text-[11px] text-slate-500 italic mt-1.5 m-0">
                                        (+ {item.allOccurrences.length - 1} autre{item.allOccurrences.length - 1 > 1 ? 's' : ''} occurrence{item.allOccurrences.length - 1 > 1 ? 's' : ''} répertoriée{item.allOccurrences.length - 1 > 1 ? 's' : ''} dans les Écritures)
                                    </p>
                                )}
                                <div className="citation-ref text-right mt-2 text-[10.5px] font-bold text-teal-800">
                                    Concordance Strong {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 5. Dictionnaire & Lexique Biblique */}
                {processedNote.definitionItems && processedNote.definitionItems.length > 0 && (
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-2 border-b border-teal-600/30 pb-1.5 mb-3">
                            <BookMarked className="w-4 h-4 text-teal-700 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-teal-900 m-0">Dictionnaire & Lexique Biblique ({processedNote.definitionItems.length})</h2>
                        </div>
                        {processedNote.definitionItems.map((item, i) => (
                            <div key={item.citationId || i} className="citation-box page-break-inside-avoid bg-slate-50/70 p-3.5 rounded-r-lg border-l-4 border-teal-700 my-3">
                                <p className="font-bold text-slate-900 not-italic text-[13px] m-0">{stripMarkdown(item.word)}</p>
                                <p className="mt-1 text-slate-800 text-[12px] leading-relaxed m-0 whitespace-pre-line">{stripMarkdown(item.definition)}</p>
                                {item.etymology && (
                                    <p className="text-[11.5px] italic text-slate-600 mt-1 m-0">Étymologie : {stripMarkdown(item.etymology)}</p>
                                )}
                                {item.synonyms && item.synonyms.length > 0 && (
                                    <p className="text-[11.5px] text-teal-800 mt-1 font-semibold m-0">Synonymes : {item.synonyms.join(', ')}</p>
                                )}
                                <div className="citation-ref text-right mt-2 text-[10.5px] font-bold text-teal-800">
                                    Dictionnaire Biblique {item.sourceIndex ? `[${item.sourceIndex}]` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Images & Illustrations */}
                {note.images && note.images.length > 0 && (
                    <div className="mb-8 space-y-4 page-break-inside-avoid">
                        <div className="flex items-center gap-2 border-b border-teal-600/30 pb-1.5 mb-3">
                            <ImageIcon className="w-4 h-4 text-teal-700 shrink-0" />
                            <h2 className="text-xs font-black uppercase tracking-wider text-teal-900 m-0">Images & Illustrations</h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {note.images.map((img, i) => (
                                <div key={i} className="flex flex-col items-center border border-slate-200 p-2.5 rounded-lg bg-slate-50/50">
                                    <img src={img.url} alt={img.caption || img.name || ''} className="max-h-48 object-contain rounded" />
                                    {(img.caption || img.name) && (
                                        <p className="text-[11px] italic text-slate-600 mt-1.5 text-center m-0">{img.caption || img.name}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sources & Références */}
                {processedNote.sources.length > 0 && (
                    <div className="mt-8 pt-4 border-t-2 border-slate-300 page-break-inside-avoid">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <BookOpenCheck className="w-4 h-4 text-teal-800 shrink-0" />
                                <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 m-0">Sources & Références ({processedNote.sources.length})</h2>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">King's Sword Index</span>
                        </div>
                        <ul className="space-y-1.5 text-[11px] text-slate-700 list-none p-0 m-0">
                            {processedNote.sources.map((src) => (
                                <li key={src.index} className="flex items-baseline gap-2">
                                    <span className="font-bold text-teal-800 font-mono shrink-0">[{src.index}]</span>
                                    <span>{stripMarkdown(src.formattedLine)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Modal Sélecteur d'Images de la Galerie */}
            {isGalleryPickerOpen && createPortal(
                <div className="fixed inset-0 z-[250000] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
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
                </div>,
                document.body
            )}

            {/* Modal Dictionnaire IA pour les définitions */}
            {activeDefinition && createPortal(
              <div className="fixed inset-0 z-[250000] bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200" onClick={() => setActiveDefinition(null)}>
                <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-w-xl w-full max-h-[85vh] animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                  <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-teal-600/10 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-600/20 shadow-xs shrink-0">
                        <BookOpenCheck className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest">{activeDefinition?.source || "Dictionnaire Webster & Français"}</div>
                        <h3 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white leading-tight truncate">{activeDefinition?.word}</h3>
                        {activeDefinition?.grammarNote && (
                          <div className="text-[11px] font-semibold text-teal-700 dark:text-teal-300 mt-0.5">{activeDefinition.grammarNote}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button 
                        onClick={handleAddDefinitionToNote}
                        data-tooltip="Ajouter la définition à vos notes"
                        className="px-3 py-1.5 rounded-xl text-xs font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/80 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                      >
                        <NotebookPen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                        <span className="hidden sm:inline">Ajouter aux notes</span>
                      </button>
                      <button 
                        onClick={() => setActiveDefinition(null)} 
                        data-tooltip="Fermer la fenêtre"
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex-1 px-5 sm:px-6 py-5 overflow-y-auto custom-scrollbar space-y-4 bg-white dark:bg-zinc-900">
                    <section className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                        <Info className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                        <span>Définition & Sens</span>
                      </div>
                      <div className="p-4 sm:p-5 bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 rounded-2xl relative overflow-hidden group shadow-2xs">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-600 dark:bg-teal-500 group-hover:bg-teal-500 transition-colors" />
                        <p className="text-base sm:text-lg leading-relaxed text-zinc-900 dark:text-zinc-100 font-medium serif-text italic pl-2">
                          {activeDefinition.definition}
                        </p>
                      </div>
                    </section>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <section className="p-4 bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 rounded-2xl space-y-2 flex flex-col">
                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                          <History className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                          <span>Étymologie</span>
                        </div>
                        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 font-medium italic flex-1">
                          {activeDefinition.etymology || "Détails historiques non répertoriés."}
                        </p>
                      </section>

                      <section className="p-4 bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 rounded-2xl space-y-2 flex flex-col">
                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                          <Languages className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                          <span>Synonymes</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 flex-1 items-start">
                          {activeDefinition.synonyms.length > 0 ? (
                            activeDefinition.synonyms.map((syn, idx) => (
                              <span 
                                key={idx} 
                                className="px-2.5 py-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-teal-700 dark:text-teal-300 shadow-2xs hover:border-teal-500/50 transition-all cursor-default"
                              >
                                {syn}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs font-medium text-zinc-400 italic">Aucun synonyme répertorié.</span>
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                  
                  <div className="px-5 sm:px-6 py-3 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-950/50 flex items-center justify-between shrink-0">
                    <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                      <Milestone className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                      <span>{activeDefinition?.source || "Dictionnaire Webster & Français"}</span>
                    </p>
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Dictionnaire hors-ligne actif
                    </span>
                  </div>
                </div>
              </div>,
              document.body
            )}

            {/* Modal de sélection de note si demandé depuis le journal */}
            {noteSelectorPayload && (
              <NoteSelectorModal
                selectionText={noteSelectorPayload.text}
                sermon={noteSelectorPayload.sermon}
                paragraphIndex={noteSelectorPayload.paragraphIndex}
                highlights={noteSelectorPayload.highlights}
                onClose={() => setNoteSelectorPayload(null)}
              />
            )}

            {/* Modal Aperçu Plein Écran de l'Image */}
            {previewImageUrl && createPortal(
                <div 
                    onClick={() => setPreviewImageUrl(null)}
                    className="fixed inset-0 z-[250000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 cursor-zoom-out"
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
                </div>,
                document.body
            )}

            {/* Modal de Consultation des Occurrences Bibliques Complètes Strong */}
            {consultingStrongItem && (
                <StrongOccurrencesModal
                    isOpen={Boolean(consultingStrongItem)}
                    onClose={() => setConsultingStrongItem(null)}
                    strongNumber={consultingStrongItem.strongNumber}
                    word={consultingStrongItem.word}
                    original={consultingStrongItem.original}
                    occurrences={consultingStrongItem.allOccurrences || []}
                />
            )}
        </div>
    );
};

export default NoteEditor;
