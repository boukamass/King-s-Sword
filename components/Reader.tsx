import React, { useState, useEffect, useRef, useMemo, useCallback, memo, useTransition } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { getDefinition, WordDefinition } from '../services/dictionaryService';
import { getAccentInsensitiveRegex } from '../utils/textUtils';
import { Sermon, Highlight, SearchMode } from '../types';
import { PALETTE_HIGHLIGHT_COLORS } from '../constants';
import NoteSelectorModal from './NoteSelectorModal';
import { 
  Printer, 
  Search, 
  Maximize, 
  Minimize, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronUp,
  ChevronDown,
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Highlighter, 
  Sparkles, 
  NotebookPen, 
  X, 
  Headphones, 
  Copy, 
  Sun, 
  Moon, 
  Monitor, 
  Eye, 
  EyeOff, 
  Volume2, 
  VolumeX, 
  Download, 
  BookOpen, 
  Loader2, 
  BookOpenCheck, 
  Quote, 
  MapPin, 
  Calendar, 
  Feather, 
  Milestone, 
  MonitorPlay,
  Layers
} from 'lucide-react';

interface SimpleWord {
  text: string;
  segmentIndex: number;
  globalIndex: number;
}

const ActionButton = memo(({ onClick, icon: Icon, tooltip, special = false, active = false }: any) => (
  <div className="relative group/btn">
    <button 
      onClick={onClick} 
      data-tooltip={tooltip} 
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all border active:scale-95 shadow-sm ${
        special 
          ? "bg-teal-600/10 text-teal-600 border-teal-600/20" 
          : active 
            ? "bg-teal-600 text-white border-teal-600" 
            : "bg-white/50 dark:bg-zinc-800/50 border-zinc-200/50 dark:border-zinc-800/50 hover:bg-teal-600/5 hover:text-teal-600 hover:border-teal-600/20 text-zinc-400 dark:text-zinc-500"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  </div>
));

const WordComponent = memo(({ 
  word, 
  isSearchResult, 
  isCurrentResult, 
  isSearchOriginMatch, 
  isJumpHighlight, 
  citationColor, 
  highlight, 
  onRemoveHighlight, 
  onRemoveJumpHighlight,
  wordRef, 
  onMouseUp 
}: any) => {
  // Détermination de la couleur de fond
  const highlightColorClass = highlight 
    ? PALETTE_HIGHLIGHT_COLORS[highlight.color || 'amber']
    : (isJumpHighlight || isSearchOriginMatch || isSearchResult) 
      ? PALETTE_HIGHLIGHT_COLORS['amber'] 
      : '';

  const content = (
    <span 
      ref={wordRef}
      data-global-index={word.globalIndex}
      onMouseUp={onMouseUp}
      className={`transition-all duration-300 ${citationColor || ''} ${
        isCurrentResult 
          ? 'bg-amber-600 shadow-[0_0_12px_rgba(245,158,11,0.5)] text-white px-0.5 rounded-sm font-bold' 
          : (isSearchResult || isSearchOriginMatch || isJumpHighlight)
            ? 'px-0.5 rounded-sm font-bold'
            : ''
      } ${isSearchOriginMatch || isSearchResult ? 'underline decoration-amber-600/40 underline-offset-2' : ''}`}
    >
      {word.text}
    </span>
  );

  if (highlight || isJumpHighlight || isSearchOriginMatch || isSearchResult) {
    const handleRemove = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (highlight) {
        onRemoveHighlight(highlight.id);
      } else {
        onRemoveJumpHighlight();
      }
    };

    return (
      <span 
        onClick={handleRemove}
        data-tooltip={highlight ? "Cliquer pour supprimer" : "Masquer le surlignage intelligent"}
        data-tooltip-icon={highlight ? "trash" : "sparkles"}
        className={`${highlightColorClass} cursor-pointer hover:brightness-105 transition-all py-0.5`}
      >
        {content}
      </span>
    );
  }

  return content;
});

let externalMaskWindow: Window | null = null;
let projectionWindow: Window | null = null;

const Reader: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  
  const activeSermon = useAppStore(s => s.activeSermon);
  const selectedSermonId = useAppStore(s => s.selectedSermonId);
  
  const notes = useAppStore(s => s.notes);
  const activeNoteId = useAppStore(s => s.activeNoteId);
  const setActiveNoteId = useAppStore(s => s.setActiveNoteId);
  const isExternalMaskOpen = useAppStore(s => s.isExternalMaskOpen);
  const setExternalMaskOpen = useAppStore(s => s.setExternalMaskOpen);
  const projectionBlackout = useAppStore(s => s.projectionBlackout);
  const fontSize = useAppStore(s => s.fontSize);
  const setFontSize = useAppStore(s => s.setFontSize);
  
  const languageFilter = useAppStore(s => s.languageFilter);
  const triggerStudyRequest = useAppStore(s => s.triggerStudyRequest);
  const updateSermonHighlights = useAppStore(s => s.updateSermonHighlights);
  const navigatedFromSearch = useAppStore(s => s.navigatedFromSearch);
  const setNavigatedFromSearch = useAppStore(s => s.setNavigatedFromSearch);
  const navigatedFromNoteId = useAppStore(s => s.navigatedFromNoteId);
  const setNavigatedFromNoteId = useAppStore(s => s.setNavigatedFromNoteId);
  const lastSearchQuery = useAppStore(s => s.lastSearchQuery);
  const lastSearchMode = useAppStore(s => s.lastSearchMode);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setIsFullTextSearch = useAppStore(s => s.setIsFullTextSearch);
  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
  const addNotification = useAppStore(s => s.addNotification);
  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);
  const jumpToText = useAppStore(s => s.jumpToText);
  const setJumpToText = useAppStore(s => s.setJumpToText);
  const jumpToParagraph = useAppStore(s => s.jumpToParagraph);
  const setJumpToParagraph = useAppStore(s => s.setJumpToParagraph);
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const sermon = activeSermon;
  
  const [selection, setSelection] = useState<{ text: string; x: number; y: number; isTop: boolean } | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [searchOriginMatchIndices, setSearchOriginMatchIndices] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);
  const [isOSFullscreen, setIsOSFullscreen] = useState(false);
  const [projectedSegmentIndex, setProjectedSegmentIndex] = useState<number | null>(null);
  const [isProjectionOpen, setIsProjectionOpen] = useState(false);
  
  const [activeDefinition, setActiveDefinition] = useState<WordDefinition | null>(null);
  const [isDefining, setIsDefining] = useState(false);
  const [jumpHighlightIndices, setJumpHighlightIndices] = useState<number[]>([]);
  const [syncToggle, setSyncToggle] = useState(0);

  const [localFontSize, setLocalFontSize] = useState<string | number>(fontSize);
  useEffect(() => {
    setLocalFontSize(fontSize);
  }, [fontSize]);

  const readerAreaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('kings_sword_projection');
    broadcastChannel.current.onmessage = (e) => {
      if (e.data && e.data.type === 'ready') {
        setSyncToggle(prev => prev + 1);
      }
    };

    const checkWindowStatus = setInterval(() => {
      if (externalMaskWindow && externalMaskWindow.closed) {
        setExternalMaskOpen(false);
        externalMaskWindow = null;
      }
      if (projectionWindow && projectionWindow.closed) {
        projectionWindow = null;
        setIsProjectionOpen(false);
      }
    }, 1000);
    const handleFullscreenChange = () => setIsOSFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      broadcastChannel.current?.close();
      clearInterval(checkWindowStatus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [setExternalMaskOpen]);

  const highlightMap = useMemo(() => {
    const map = new Map<number, Highlight>();
    if (!sermon?.highlights) return map;
    for (const h of sermon.highlights) {
        for (let i = h.start; i <= h.end; i++) map.set(i, h);
    }
    return map;
  }, [sermon?.highlights]);

  const segments = useMemo(() => {
    if (!sermon || !sermon.text) return [];
    return sermon.text.split(/\n\s*\n/); 
  }, [sermon?.id]);

  const structuredSegments = useMemo(() => {
    const result: { words: SimpleWord[]; isNumbered: boolean; text: string }[] = [];
    let globalIdx = 0;
    segments.forEach((seg, segIdx) => {
        const segWords: SimpleWord[] = [];
        const content = seg.trim();
        if (content === "") return;

        const tokens = seg.split(/(\s+)/);
        tokens.forEach(token => {
            if (token !== "") segWords.push({ text: token, segmentIndex: segIdx, globalIndex: globalIdx++ });
        });
        const isNumbered = /^\d+/.test(content);
        result.push({ words: segWords, isNumbered, text: seg });
    });
    return result;
  }, [segments]);

  const words = useMemo(() => structuredSegments.flatMap(s => s.words), [structuredSegments]);

  useEffect(() => {
    if (broadcastChannel.current && sermon) {
      const activeText = projectedSegmentIndex !== null 
        ? segments[projectedSegmentIndex].trim()
        : sermon.text;

      // Détection des mots sélectionnés pour synchronisation avec la projection
      const sel = window.getSelection();
      const selectionIndices: number[] = [];
      if (sel && !sel.isCollapsed && readerAreaRef.current) {
        const wordElements = readerAreaRef.current.querySelectorAll('[data-global-index]');
        wordElements.forEach(el => {
          if (sel.containsNode(el, true)) {
            selectionIndices.push(parseInt(el.getAttribute('data-global-index') || '-1'));
          }
        });
      }

      // Calcul des mots projetés avec leurs informations de surlignage et d'index
      let projectedWordsData: { text: string; globalIndex: number; color?: string }[] = [];
      if (projectedSegmentIndex !== null) {
          const seg = structuredSegments[projectedSegmentIndex];
          if (seg) {
              projectedWordsData = seg.words.map(w => {
                  const h = highlightMap.get(w.globalIndex);
                  const isJump = jumpHighlightIndices.includes(w.globalIndex);
                  const isSearch = searchResults.includes(w.globalIndex) || searchOriginMatchIndices.includes(w.globalIndex);
                  
                  return {
                      text: w.text,
                      globalIndex: w.globalIndex,
                      color: h ? (h.color || 'amber') : (isJump || isSearch ? 'amber' : undefined)
                  };
              });
          }
      }

      broadcastChannel.current.postMessage({
        type: 'sync',
        title: sermon.title,
        date: sermon.date,
        city: sermon.city,
        text: activeText,
        projectedWords: projectedWordsData,
        fontSize,
        theme,
        blackout: projectionBlackout,
        highlights: sermon.highlights || [],
        selectionIndices: selectionIndices,
        searchResults,
        currentResultIndex,
        activeDefinition
      });
    }
  }, [sermon, projectedSegmentIndex, fontSize, theme, projectionBlackout, searchResults, currentResultIndex, activeDefinition, highlightMap, jumpHighlightIndices, searchOriginMatchIndices, structuredSegments, segments, selection, syncToggle]);

  const toggleProjection = () => {
    if (projectionWindow && !projectionWindow.closed) {
      projectionWindow.close();
      projectionWindow = null;
      setIsProjectionOpen(false);
      addNotification("Projection terminée", "success");
    } else {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('projection', 'true');
        url.hash = '';
        projectionWindow = window.open(url.toString(), 'KingsSwordProjection');
        if (projectionWindow) {
          setIsProjectionOpen(true);
          addNotification("Fenêtre de projection ouverte", "success");
        } else {
          projectionWindow = null;
          setIsProjectionOpen(false);
          addNotification("Action bloquée par le navigateur", "error");
        }
      } catch (err) {
        addNotification("Erreur de projection", "error");
      }
    }
  };

  const handleProjectSegment = (idx: number) => {
    // Déclencher la projection si elle n'est pas encore active
    if (!projectionWindow || projectionWindow.closed) {
      toggleProjection();
    }

    if (projectedSegmentIndex === idx) {
      setProjectedSegmentIndex(null);
    } else {
      setProjectedSegmentIndex(idx);
      addNotification("Paragraphe projeté", "success");
    }
  };

  const toggleExternalMask = () => {
    if (isExternalMaskOpen && externalMaskWindow && !externalMaskWindow.closed) {
      externalMaskWindow.close();
      externalMaskWindow = null;
      setExternalMaskOpen(false);
      addNotification("Écran secondaire démasqué.", "success");
    } else {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('mask', 'true');
        url.hash = '';
        externalMaskWindow = window.open(url.toString(), 'KingsSwordMask');
        if (externalMaskWindow) {
          setExternalMaskOpen(true);
          addNotification("Écran secondaire masqué.", "success");
        } else addNotification("Action refusée", "error");
      } catch (err) { addNotification("Erreur lors du masquage.", "error"); }
    }
  };

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  useEffect(() => {
    if (sermon && words.length > 0 && lastSearchQuery) {
        const regex = getAccentInsensitiveRegex(lastSearchQuery, lastSearchMode === SearchMode.EXACT_WORDS);
        const fullSermonText = words.map(w => w.text).join('');
        const matchIndices: number[] = [];
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > startChar && currentChar < endChar) matchIndices.push(words[i].globalIndex);
                currentChar += wordLen;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        setSearchOriginMatchIndices(matchIndices);
    } else setSearchOriginMatchIndices([]);
  }, [sermon?.id, words, lastSearchQuery, lastSearchMode]);

  useEffect(() => {
    if (sermon?.id && !jumpToText && !jumpToParagraph && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
        setProjectedSegmentIndex(null);
        setJumpHighlightIndices([]);
    }
  }, [sermon?.id]);

  useEffect(() => {
    if (jumpToParagraph !== null && sermon && structuredSegments.length > 0) {
        const segmentIdx = jumpToParagraph - 1;
        const segment = structuredSegments[segmentIdx];
        
        if (segment) {
            setTimeout(() => {
                const segEl = segmentRefs.current.get(segmentIdx);
                if (segEl) {
                    let targetGlobalIndex = segment.words[0].globalIndex;
                    let targetHighlightIndices: number[] = [];

                    if (lastSearchQuery) {
                        const regex = getAccentInsensitiveRegex(lastSearchQuery, lastSearchMode === SearchMode.EXACT_WORDS);
                        const paraText = segment.words.map(w => w.text).join('');
                        const match = regex.exec(paraText);
                        
                        if (match) {
                            const startChar = match.index;
                            const endChar = match.index + match[0].length;
                            let currentChar = 0;
                            let foundFirst = false;

                            for (const w of segment.words) {
                                const wLen = w.text.length;
                                if (currentChar + wLen > startChar && currentChar < endChar) {
                                    targetHighlightIndices.push(w.globalIndex);
                                    if (!foundFirst) {
                                        targetGlobalIndex = w.globalIndex;
                                        foundFirst = true;
                                    }
                                }
                                currentChar += wLen;
                            }
                        }
                    }

                    if (targetHighlightIndices.length > 0) {
                        setJumpHighlightIndices(targetHighlightIndices);
                    } else {
                        setJumpHighlightIndices(segment.words.map(w => w.globalIndex));
                    }

                    const targetEl = wordRefs.current.get(targetGlobalIndex);
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (segEl) {
                        segEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }, 150);
        }
        setJumpToParagraph(null);
    }
  }, [jumpToParagraph, sermon, structuredSegments, setJumpToParagraph, lastSearchQuery, lastSearchMode]);

  useEffect(() => {
    if (jumpToText && sermon && words.length > 0) {
        const regex = getAccentInsensitiveRegex(jumpToText, false);
        const fullSermonText = words.map(w => w.text).join('');
        const matchIndices: number[] = [];
        const match = regex.exec(fullSermonText);
        if (match) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;
            let firstWordIndex = -1;
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > startChar && currentChar < endChar) {
                    matchIndices.push(words[i].globalIndex);
                    if (firstWordIndex === -1) firstWordIndex = words[i].globalIndex;
                }
                currentChar += wordLen;
            }
            if (firstWordIndex !== -1) {
                setJumpHighlightIndices(matchIndices);
                setTimeout(() => {
                    wordRefs.current.get(firstWordIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    window.getSelection()?.removeAllRanges();
                }, 100);
            }
        }
        setJumpToText(null);
    }
  }, [jumpToText, sermon, words, setJumpToText]);
  
  const citationHighlightMap = useMemo(() => {
    const map = new Map<number, { colorClass: string }>();
    if (!activeNoteId || !sermon) return map;
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote) return map;
    const relevantCitations = activeNote.citations.filter(c => c.sermon_id === sermon.id);
    if (relevantCitations.length === 0) return map;
    const fullSermonText = words.map(w => w.text).join('');
    for (const citation of relevantCitations) {
        const regex = getAccentInsensitiveRegex(citation.quoted_text, false);
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            const startChar = match.index;
            const endChar = match.index + match[0].length;
            const colorClass = PALETTE_HIGHLIGHT_COLORS[activeNote.color || 'default'];
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                const wordLen = words[i].text.length;
                if (currentChar + wordLen > startChar && currentChar < endChar) map.set(words[i].globalIndex, { colorClass });
                currentChar += wordLen;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
    }
    return map;
  }, [activeNoteId, notes, sermon?.id, words]);

  useEffect(() => {
    if (readerSearchQuery.length > 2) {
      startTransition(() => {
        const regex = getAccentInsensitiveRegex(readerSearchQuery, false);
        const fullSermonText = words.map(w => w.text).join('');
        const results = [];
        let match;
        while ((match = regex.exec(fullSermonText)) !== null) {
            let currentChar = 0;
            for (let i = 0; i < words.length; i++) {
                if (currentChar >= match.index) { results.push(words[i].globalIndex); break; }
                currentChar += words[i].text.length;
            }
            if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        setSearchResults(results);
        setCurrentResultIndex(results.length > 0 ? 0 : -1);
      });
    } else { setSearchResults([]); setCurrentResultIndex(-1); }
  }, [readerSearchQuery, words]);

  useEffect(() => {
      if (currentResultIndex !== -1 && searchResults.length > 0) {
          wordRefs.current.get(searchResults[currentResultIndex])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
  }, [currentResultIndex, searchResults]);

  const togglePlay = useCallback(async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!audioRef.current) return;
    try {
      if (audioRef.current.paused) {
        if (playPromiseRef.current) await playPromiseRef.current;
        playPromiseRef.current = audioRef.current.play();
        await playPromiseRef.current;
      } else audioRef.current.pause();
    } catch (err) { console.error(err); }
    finally { playPromiseRef.current = null; }
  }, []);

  const seek = (seconds: number) => {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
  };

  const toggleMute = () => {
    if (audioRef.current) {
        const newState = !isMuted;
        audioRef.current.muted = newState;
        setIsMuted(newState);
    }
  };

  const handleDownload = () => {
    if (sermon?.audio_url) {
        const link = document.createElement('a');
        link.href = sermon.audio_url; link.target = "_blank"; link.download = `${sermon.title}.mp3`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }
  };

  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 1 && readerAreaRef.current) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const readerRect = readerAreaRef.current.getBoundingClientRect();
      setSelection({ 
        text: sel.toString().trim(), 
        x: (rect.left + rect.width / 2) - readerRect.left, 
        y: rect.top - readerRect.top,
        isTop: rect.top < 150 
      });
    } else setSelection(null);
  }, []);

  const handleHighlight = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sermon || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    const getIndexFromNode = (node: Node, offset: number): number | null => {
      // 1. Tenter de trouver un mot interactif existant
      const wordEl = node.parentElement?.closest('[data-global-index]');
      if (wordEl) return parseInt(wordEl.getAttribute('data-global-index') || '0');

      // 2. Sinon, calculer l'index à partir de la position dans le bloc de texte brut du paragraphe
      const segEl = node.parentElement?.closest('[data-seg-idx]');
      if (!segEl) return null;
      
      const segIdx = parseInt(segEl.getAttribute('data-seg-idx') || '0');
      const segment = structuredSegments[segIdx];
      if (!segment) return null;

      // Calculer l'offset de caractères global dans le segment
      let charOffsetInSegment = 0;
      const children = segEl.childNodes;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child === node) {
          charOffsetInSegment += offset;
          break;
        }
        charOffsetInSegment += child.textContent?.length || 0;
      }

      // Faire correspondre l'offset au bon index de mot global
      let currentPos = 0;
      for (const w of segment.words) {
        if (currentPos + w.text.length > charOffsetInSegment) {
          return w.globalIndex;
        }
        currentPos += w.text.length;
      }
      return segment.words[segment.words.length - 1].globalIndex;
    };

    const start = getIndexFromNode(range.startContainer, range.startOffset);
    const end = getIndexFromNode(range.endContainer, range.endOffset);

    if (start !== null && end !== null) {
      const newHighlight: Highlight = { id: crypto.randomUUID(), start: Math.min(start, end), end: Math.max(start, end), color: 'amber' };
      updateSermonHighlights(sermon.id, [...(sermon.highlights || []), newHighlight]);
      addNotification("Surlignage ajouté", "success");
      setSelection(null); sel.removeAllRanges();
    }
  }, [sermon, structuredSegments, updateSermonHighlights, addNotification]);

  const handleRemoveHighlight = useCallback((id: string) => {
    if (!sermon) return;
    updateSermonHighlights(sermon.id, (sermon.highlights || []).filter(h => h.id !== id));
    addNotification("Surlignage supprimé", "success");
  }, [sermon, updateSermonHighlights, addNotification]);

  const handleRemoveJumpHighlight = useCallback(() => {
    setJumpHighlightIndices([]);
    addNotification("Surlignage intelligent masqué", "success");
  }, [addNotification]);

  const handleCopy = useCallback(() => {
    if (selection) {
      navigator.clipboard.writeText(selection.text);
      addNotification(t.copy_success, "success");
    }
  }, [selection, addNotification, t.copy_success]);

  const handleDefine = async () => {
    if (!selection) return;
    const word = selection.text.split(' ')[0].replace(/[.,;?!]/g, "");
    setIsDefining(true); setSelection(null);
    try {
      const def = await getDefinition(word);
      setActiveDefinition(def);
    } catch (err: any) { addNotification(err.message || "Erreur", "error"); }
    finally { setIsDefining(false); }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    return `${Math.floor(time/60)}:${Math.floor(time%60).toString().padStart(2,'0')}`;
  };

  // --- ARCHITECTURE ZÉRO-LAG : Virtualisation par Buffering de Texte Brut ---
  const interactiveIndices = useMemo(() => {
    const set = new Set<number>();
    highlightMap.forEach((_, k) => set.add(k));
    citationHighlightMap.forEach((_, k) => set.add(k));
    searchResults.forEach(idx => set.add(idx));
    searchOriginMatchIndices.forEach(idx => set.add(idx));
    jumpHighlightIndices.forEach(idx => set.add(idx));
    return set;
  }, [highlightMap, citationHighlightMap, searchResults, searchOriginMatchIndices, jumpHighlightIndices]);

  const renderSegmentContent = useCallback((segWords: SimpleWord[]) => {
    const elements: React.ReactNode[] = [];
    let textBuffer = "";

    segWords.forEach((word) => {
      const isInteractive = interactiveIndices.has(word.globalIndex);

      if (isInteractive) {
        // Vider le buffer de texte brut avant d'insérer le composant interactif
        if (textBuffer) {
          elements.push(textBuffer);
          textBuffer = "";
        }
        elements.push(
          <WordComponent 
            key={word.globalIndex} 
            word={word} 
            wordRef={(el: any) => { if(el) wordRefs.current.set(word.globalIndex, el); }} 
            isSearchResult={searchResults.includes(word.globalIndex)} 
            isCurrentResult={searchResults[currentResultIndex] === word.globalIndex} 
            isSearchOriginMatch={searchOriginMatchIndices.includes(word.globalIndex)} 
            isJumpHighlight={jumpHighlightIndices.includes(word.globalIndex)} 
            citationColor={citationHighlightMap.get(word.globalIndex)?.colorClass} 
            highlight={highlightMap.get(word.globalIndex)} 
            onRemoveHighlight={handleRemoveHighlight} 
            onRemoveJumpHighlight={handleRemoveJumpHighlight} 
            onMouseUp={handleTextSelection} 
          />
        );
      } else {
        // Accumuler le texte brut
        textBuffer += word.text;
      }
    });

    // Ajouter le reste du texte brut à la fin du segment
    if (textBuffer) elements.push(textBuffer);
    
    return elements;
  }, [interactiveIndices, searchResults, currentResultIndex, searchOriginMatchIndices, jumpHighlightIndices, citationHighlightMap, highlightMap, handleRemoveHighlight, handleRemoveJumpHighlight, handleTextSelection]);

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  if (!selectedSermonId) {
    return (
      <div className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 relative">
        <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print">
          {!sidebarOpen && (
             <button onClick={toggleSidebar} data-tooltip="Bibliothèque" className="flex items-center gap-3 hover:opacity-80 active:scale-95 group shrink-0 mr-1">
               <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
                 <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-4 h-4 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
               </div>
               <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-900 dark:text-zinc-100 group-hover:text-teal-600 transition-colors animate-in fade-in slide-in-from-left-2 duration-500">
                 {t.sidebar_subtitle}
               </span>
             </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-700">
          <div className="relative mb-10 group">
            <div className="absolute inset-0 bg-teal-600/10 dark:bg-teal-600/5 blur-[80px] rounded-full scale-[2.5] animate-pulse"></div>
            <div className="relative w-24 h-24 flex items-center justify-center bg-white dark:bg-zinc-900 rounded-[32px] shadow-2xl border border-zinc-100 dark:border-zinc-800 transform group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-500">
              <BookOpenCheck className="w-10 h-10 text-zinc-300 dark:text-zinc-700 group-hover:text-teal-600 transition-all duration-500" />
            </div>
          </div>
          <p className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-400 dark:text-zinc-600 animate-in slide-in-from-bottom-2 duration-700 delay-100">{t.reader_select_prompt}</p>
        </div>
      </div>
    );
  }

  if (!sermon) return <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-zinc-950"><Loader2 className="w-10 h-10 animate-spin text-teal-600" /></div>;

  return (
    <div ref={readerAreaRef} className={`flex-1 flex flex-col h-full relative bg-white dark:bg-zinc-950 transition-colors duration-200 overflow-visible-important`}>
      {noteSelectorPayload && <NoteSelectorModal selectionText={noteSelectorPayload.text} sermon={noteSelectorPayload.sermon} paragraphIndex={noteSelectorPayload.paragraphIndex} onClose={() => setNoteSelectorPayload(null)} />}
      
      {(activeDefinition || isDefining) && (
        <div className="fixed inset-0 z-[100000] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setActiveDefinition(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 relative max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="px-8 pt-8 pb-4 flex items-center justify-between shrink-0 relative">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-[22px] border border-teal-600/20 shadow-sm transition-transform duration-500 hover:rotate-6">
                  <BookOpenCheck className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.3em] mb-1">Dictionnaire</h3>
                  <p className="text-2xl font-black text-zinc-900 dark:text-white leading-none tracking-tight">
                    {isDefining ? "..." : activeDefinition?.word}
                  </p>
                </div>
              </div>
              <button onClick={() => setActiveDefinition(null)} className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-red-500 bg-zinc-50 dark:bg-zinc-800 rounded-[15px] transition-all border border-zinc-200 dark:border-zinc-700 hover:border-red-500/30 active:scale-90">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 px-8 py-6 overflow-y-auto custom-scrollbar">
              {isDefining ? (
                <div className="py-20 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-12 h-12 animate-spin text-teal-600" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 animate-pulse">Recherche en cours...</p>
                </div>
              ) : activeDefinition && (
                <div className="space-y-8 pb-4">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                       <div className="w-6 h-6 flex items-center justify-center bg-teal-600 text-white rounded-lg shadow-lg shadow-teal-600/10">
                          <Feather className="w-3.5 h-3.5" />
                       </div>
                       <h4 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Signification</h4>
                    </div>
                    <div className="p-6 bg-teal-600/5 dark:bg-teal-600/10 border border-teal-600/10 rounded-[28px] relative overflow-hidden group">
                      <div className="absolute top-0 left-0 w-1 h-full bg-teal-600/20" />
                      <p className="text-[16px] leading-relaxed text-zinc-800 dark:text-zinc-100 font-medium serif-text italic">
                        {activeDefinition.definition}
                      </p>
                      <Quote className="absolute -right-2 -bottom-2 w-16 h-16 text-teal-600/5 -rotate-12" />
                    </div>
                  </div>

                  {activeDefinition.etymology && (
                    <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-500 delay-75">
                      <div className="flex items-center gap-3">
                         <div className="w-6 h-6 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-lg">
                            <Milestone className="w-3.5 h-3.5" />
                         </div>
                         <h4 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Origine</h4>
                      </div>
                      <div className="pl-9">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-medium">
                          {activeDefinition.etymology}
                        </p>
                      </div>
                    </div>
                  )}

                  {activeDefinition.synonyms && activeDefinition.synonyms.length > 0 && (
                    <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-500 delay-150">
                      <div className="flex items-center gap-3">
                         <div className="w-6 h-6 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-lg">
                            <Layers className="w-3.5 h-3.5" />
                         </div>
                         <h4 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Synonymes</h4>
                      </div>
                      <div className="flex flex-wrap gap-2 pl-9">
                        {activeDefinition.synonyms.map((syn, idx) => (
                          <span key={idx} className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-full text-[10px] font-bold text-zinc-600 dark:text-zinc-400 hover:border-teal-600/30 hover:text-teal-600 transition-all cursor-default">
                            {syn}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      <div className={`px-4 md:px-8 h-14 border-b border-zinc-100 dark:border-zinc-900/50 flex items-center justify-between shrink-0 bg-white/60 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print transition-all duration-300 overflow-visible-important`}>
        <div className="flex items-center gap-4 min-w-0 flex-1 overflow-visible-important">
          {(!sidebarOpen || isOSFullscreen) && (
             <button onClick={toggleSidebar} data-tooltip="Bibliothèque" className="flex items-center gap-3 hover:opacity-80 active:scale-95 group shrink-0 mr-1">
               <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
                 <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-4 h-4 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
               </div>
               {!selectedSermonId && (
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-900 dark:text-zinc-100 group-hover:text-teal-600 transition-colors animate-in fade-in slide-in-from-left-2 duration-500">
                   {t.sidebar_subtitle}
                 </span>
               )}
             </button>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <h1 className="text-[16px] font-extrabold text-zinc-900 dark:text-zinc-50 truncate tracking-tight transition-all leading-tight">{sermon.title}</h1>
            <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-400 uppercase tracking-wider leading-none mt-1">
              <Calendar className="w-2.5 h-2.5 text-teal-600 dark:text-blue-400" /><span className="font-mono">{sermon.date}</span>
              <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-1" /><MapPin className="w-2.5 h-2.5 text-teal-600 dark:text-blue-400" /><span className="truncate">{sermon.city}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4 overflow-visible-important">
            {navigatedFromSearch && (
              <button onClick={() => { setSearchQuery(lastSearchQuery); setIsFullTextSearch(true); setSelectedSermonId(null); setNavigatedFromSearch(false); setSearchOriginMatchIndices([]); }} className="px-3 py-1.5 bg-amber-600/10 text-amber-700 dark:text-amber-400 text-[9px] font-bold uppercase tracking-wider rounded-xl hover:bg-amber-600/20 transition-colors mr-2"><ChevronLeft className="w-3 h-3 inline mr-1" /> {t.reader_exit_search}</button>
            )}
            {navigatedFromNoteId && (
              <button onClick={() => { setActiveNoteId(navigatedFromNoteId); setNavigatedFromNoteId(null); setSelectedSermonId(null); }} className="px-3 py-1.5 bg-teal-600/10 text-teal-700 dark:text-teal-400 text-[9px] font-bold uppercase tracking-wider rounded-xl hover:bg-teal-600/20 transition-colors mr-2"><ChevronLeft className="w-3 h-3 inline mr-1" /> {t.reader_exit_note}</button>
            )}
            <ActionButton 
              onClick={togglePlay} 
              icon={isPlaying ? Pause : Play} 
              tooltip={isPlaying ? t.tooltip_pause : t.tooltip_play} 
              active={isPlaying}
            />
            <ActionButton 
              onClick={toggleProjection} 
              icon={MonitorPlay} 
              tooltip={isProjectionOpen ? "Arrêter la projection" : "Lancer la projection"}
              active={isProjectionOpen}
              special={isProjectionOpen}
            />
            <ActionButton onClick={toggleExternalMask} icon={isExternalMaskOpen ? Eye : EyeOff} tooltip="Masquer" active={isExternalMaskOpen} special={isExternalMaskOpen} />
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => window.print()} icon={Printer} tooltip={t.print} />
            <ActionButton onClick={() => { setIsSearchVisible(!isSearchVisible); if(isSearchVisible) { setSearchResults([]); setReaderSearchQuery(''); } }} icon={Search} tooltip={t.reader_search_tooltip} active={isSearchVisible} />
            <ActionButton onClick={handleFullscreenToggle} icon={isOSFullscreen ? Minimize : Maximize} tooltip="Plein écran" special={isOSFullscreen} />
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <ActionButton onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')} icon={ThemeIcon} tooltip="Thème" active={theme !== 'system'} />
            <div className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-800/50 mx-1" />
            <div className="flex items-center bg-white/50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm overflow-hidden no-print">
              <button onClick={() => setFontSize(size => size - 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors border-r border-zinc-200/50 dark:border-zinc-800/50 active:scale-95"><ZoomOut className="w-4 h-4" /></button>
              <input 
                type="text" 
                value={localFontSize} 
                onChange={e => /^\d*$/.test(e.target.value) && setLocalFontSize(e.target.value)} 
                onBlur={() => { const val = parseInt(String(localFontSize), 10); setFontSize(isNaN(val) ? fontSize : val); }} 
                onDoubleClick={() => { 
                    setFontSize(20); 
                    setLocalFontSize(20); 
                    addNotification("Taille réinitialisée à 20", "success");
                }}
                className="w-12 h-9 bg-transparent text-center text-[11px] font-black text-zinc-600 dark:text-zinc-300 outline-none cursor-pointer" 
              />
              <button onClick={() => setFontSize(size => size + 2)} className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors border-l border-zinc-200/50 dark:border-zinc-800/50 active:scale-95"><ZoomIn className="w-4 h-4" /></button>
            </div>
        </div>
      </div>

      {isSearchVisible && (
        <div className="h-12 border-b border-zinc-100 dark:border-zinc-800/50 bg-white/40 dark:bg-zinc-950/40 backdrop-blur-xl grid grid-cols-[1fr_2fr_1fr] items-center px-6 shrink-0 animate-in slide-in-from-top-1 fade-in duration-300 no-print">
          <div className="flex items-center">
            <Search className="w-3.5 h-3.5 text-teal-600/50" />
          </div>
          
          <div className="flex justify-center">
            <div className="relative w-full max-w-md group/search-field">
              <input 
                autoFocus
                type="text" 
                placeholder={t.reader_search_placeholder}
                className="bg-zinc-100/50 dark:bg-zinc-800/50 px-4 py-1.5 rounded-xl border border-zinc-200/50 dark:border-zinc-700/50 text-xs font-bold outline-none text-zinc-900 dark:text-white w-full pr-8 placeholder:text-zinc-400 placeholder:font-normal focus:border-teal-500/50 transition-all"
                value={readerSearchQuery}
                onChange={(e) => setReaderSearchQuery(e.target.value)}
              />
              {readerSearchQuery && (
                <button 
                  onClick={() => { setReaderSearchQuery(''); setSearchResults([]); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-colors active:scale-90"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex items-center justify-end gap-4">
            {searchResults.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black text-zinc-500 tabular-nums uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md">
                  {currentResultIndex + 1} / {searchResults.length}
                </span>
                <div className="flex items-center gap-1 bg-white/50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 p-0.5 shadow-sm">
                  <button 
                    onClick={() => setCurrentResultIndex(prev => (prev > 0 ? prev - 1 : searchResults.length - 1))}
                    className="w-7 h-7 flex items-center justify-center hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 rounded-md transition-colors active:scale-90"
                    title="Précédent"
                  >
                    <ChevronUp className="w-4 h-4 text-zinc-500" />
                  </button>
                  <button 
                    onClick={() => setCurrentResultIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : 0))}
                    className="w-7 h-7 flex items-center justify-center hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 rounded-md transition-colors active:scale-90"
                    title="Suivant"
                  >
                    <ChevronDown className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
              </div>
            )}
            <button 
              onClick={() => { setIsSearchVisible(false); setSearchResults([]); setReaderSearchQuery(''); }}
              className="w-8 h-8 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-400 hover:text-red-500 rounded-xl transition-all active:scale-90"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className={`flex-1 relative overflow-hidden flex justify-center`}>
        <div ref={scrollContainerRef} onMouseUp={handleTextSelection} className={`absolute inset-0 overflow-y-auto custom-scrollbar serif-text leading-relaxed text-zinc-800 dark:text-zinc-300 transition-all duration-300 ${isOSFullscreen ? 'py-6 px-4 md:px-12' : 'py-12 px-4 md:px-12 lg:px-20'}`}>
          <div className={`w-full mx-auto printable-content whitespace-pre-wrap text-justify pb-20 ${isPending ? 'opacity-50' : ''} max-w-full`} style={{ fontSize: `${fontSize}px` }}>
            {structuredSegments.map((seg, segIdx) => {
              const isActiveProjection = projectedSegmentIndex === segIdx;
              const content = renderSegmentContent(seg.words);

              if (seg.isNumbered) {
                return (
                  <div key={segIdx} ref={(el: any) => { if (el) segmentRefs.current.set(segIdx, el); }} data-seg-idx={segIdx} className={`group/seg relative mb-1.5 py-2.5 px-6 rounded-[20px] border-l-[5px] transition-all duration-300 cursor-pointer shadow-sm hover:shadow-xl hover:scale-[1.005] active:scale-[0.995] ${isActiveProjection ? 'bg-teal-600/10 border-teal-600 ring-2 ring-teal-600/20' : 'bg-white dark:bg-zinc-900/50 border-teal-600/20 hover:border-teal-600 dark:border-zinc-800'}`}>
                    <div className="absolute -left-[54px] top-1/2 -translate-y-1/2 opacity-0 group-hover/seg:opacity-100 transition-all translate-x-4 group-hover/seg:translate-x-0 no-print flex flex-col gap-2">
                        <div onClick={(e) => { e.stopPropagation(); handleProjectSegment(segIdx); }} data-tooltip="Projeter" className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-xl shadow-lg hover:scale-110 transition-transform"><MonitorPlay className="w-4 h-4" /></div>
                        <div onClick={(e) => { e.stopPropagation(); setNoteSelectorPayload({ text: seg.text.trim(), sermon, paragraphIndex: segIdx + 1 }); }} data-tooltip="Annoter" className="w-9 h-9 flex items-center justify-center bg-emerald-600 text-white rounded-xl shadow-lg hover:scale-110 transition-transform"><NotebookPen className="w-4 h-4" /></div>
                    </div>
                    {content}
                  </div>
                );
              }
              if (seg.text.trim() === '') return null;
              return (
                <div key={segIdx} ref={(el: any) => { if (el) segmentRefs.current.set(segIdx, el); }} data-seg-idx={segIdx} className="mb-4 px-6">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
        {sermon.audio_url && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center no-print z-50 overflow-visible-important">
              <audio ref={audioRef} src={sermon.audio_url} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)} onEnded={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
              <div onMouseEnter={() => setIsPlayerExpanded(true)} onMouseLeave={() => setIsPlayerExpanded(false)} className={`transition-all duration-500 flex items-center bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-2xl rounded-full overflow-visible-important ${isPlayerExpanded ? 'w-[320px] sm:w-[620px] h-12 px-4' : 'w-10 h-10'} ${isOSFullscreen ? 'opacity-40 hover:opacity-100' : ''}`}>
                {!isPlayerExpanded ? <div className="w-full h-full flex items-center justify-center text-zinc-400"><Headphones className="w-4 h-4 animate-pulse text-teal-600/40" /></div> : (
                  <div className="flex items-center gap-4 w-full h-full animate-in fade-in zoom-in-95 overflow-visible-important">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => seek(-10)} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600"><RotateCcw className="w-3.5 h-3.5" /></button>
                      <button onClick={togglePlay} className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-xl active:scale-90">{isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-0.5" />}</button>
                      <button onClick={() => seek(10)} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600"><RotateCw className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
                      <div className="relative h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden"><div className="absolute top-0 left-0 h-full bg-teal-600" style={{ width: `${(currentTime/duration)*100}%` }} /><input type="range" min="0" max={duration} step="0.1" value={currentTime} onChange={e => audioRef.current && (audioRef.current.currentTime = parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" /></div>
                      <div className="flex justify-between text-[8px] font-black text-zinc-500 tracking-tighter"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={toggleMute} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-colors">
                        {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800 mx-1" />
                      <button onClick={handleDownload} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-teal-600 transition-all active:scale-90" title="Télécharger l'audio">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
          </div>
        )}
      </div>

      {selection && (
        <div 
          className="absolute z-[200000] pointer-events-none no-print animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 ease-out" 
          style={{ 
            left: selection.x, 
            top: selection.isTop ? selection.y + 40 : selection.y - 70, 
            transform: 'translateX(-50%)' 
          }}
        >
          <div className="flex items-stretch bg-white/80 dark:bg-zinc-900/85 backdrop-blur-3xl p-1 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.1)] pointer-events-auto border border-white/20 dark:border-white/5 overflow-hidden">
            <button onClick={handleHighlight} className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-amber-500/15 text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-lg transition-all group active:scale-95">
              <Highlighter className="w-3.5 h-3.5 text-amber-500/70 group-hover:text-amber-500 transition-transform group-hover:scale-110" />
              <span className="text-[7px] font-black uppercase tracking-[0.15em] opacity-80 group-hover:opacity-100">Surligner</span>
            </button>
            
            <div className="w-px bg-zinc-200/50 dark:bg-zinc-700/50 my-1.5 mx-0.5" />
            
            <button onClick={() => { handleCopy(); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg transition-all group active:scale-95">
              <Copy className="w-3.5 h-3.5 text-zinc-400/70 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-transform group-hover:scale-110" />
              <span className="text-[7px] font-black uppercase tracking-[0.15em] opacity-80 group-hover:opacity-100">Copier</span>
            </button>
            
            <div className="w-px bg-zinc-200/50 dark:bg-zinc-700/50 my-1.5 mx-0.5" />

            <button onClick={() => { handleDefine(); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-sky-500/15 text-zinc-600 dark:text-zinc-400 hover:text-sky-600 dark:hover:text-sky-400 rounded-lg transition-all group active:scale-95">
              <BookOpen className="w-3.5 h-3.5 text-sky-500/70 group-hover:text-sky-600 transition-transform group-hover:scale-110" />
              <span className="text-[7px] font-black uppercase tracking-[0.15em] opacity-80 group-hover:opacity-100">Définer</span>
            </button>

            <button onClick={() => { triggerStudyRequest(selection.text); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-teal-600/15 text-zinc-600 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-lg transition-all group active:scale-95">
              <Sparkles className="w-3.5 h-3.5 text-teal-600/70 group-hover:text-teal-600 transition-transform group-hover:scale-110 animate-pulse" />
              <span className="text-[7px] font-black uppercase tracking-[0.15em] opacity-80 group-hover:opacity-100">Étudier</span>
            </button>
            
            <div className="w-px bg-zinc-200/50 dark:bg-zinc-700/50 my-1.5 mx-0.5" />

            <button onClick={() => { setNoteSelectorPayload({ text: selection.text, sermon }); setSelection(null); }} className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 hover:bg-emerald-500/15 text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg transition-all group active:scale-95">
              <NotebookPen className="w-3.5 h-3.5 text-emerald-500/70 group-hover:text-emerald-500 transition-transform group-hover:scale-110" />
              <span className="text-[7px] font-black uppercase tracking-[0.15em] opacity-80 group-hover:opacity-100">Note</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reader;