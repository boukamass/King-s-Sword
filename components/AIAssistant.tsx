import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { askGeminiChat, GeminiSource } from '../services/geminiChatService';
import { analyzeSelectionContext } from '../services/studyService';
import { retrieveRelevantSermonPassages, formatRagContextForGemini, RetrievedParagraph } from '../services/sermonRagService';
import { executeAutoRagPipeline, formatEvidenceContextForGemini } from '../services/autoRagRetrievalService';
import { generateNewRagResponse } from '../services/generationAdapter';
import { executeUnifiedRagAssistantFlow, executeShadowUnifiedRag } from '../services/unifiedRagIntegrationService';
import { aiConfig } from '../config/aiConfig';
import { getSermonById } from '../services/db';
import { getBibleChapterSermon, getBibleBookSermon } from '../services/bibleService';
import { BIBLE_BOOKS_META } from '../services/bibleMetadata';
import { getSongAsSermon, loadAllSongs, getSongLanguageBadge } from '../services/songService';
import { getExposePage, getExposeChapter } from '../services/exposeService';
import { translations } from '../translations';
import { marked } from 'marked';
import NoteSelectorModal from './NoteSelectorModal';
import { ApiKeyModal } from './ApiKeyModal';
import { hasValidGeminiApiKey } from '../utils/apiKeyHelper';
import { CorpusIndexingIndicator } from './CorpusIndexingIndicator';
import { loadPersistedProgressState, subscribeIndexProgress, CorpusIndexProgress, initializeCorpusIndex, forceResetIndexing } from '../services/corpusIndexInitializationService';
import { Sermon, ChatMessage } from '../types';
import { splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';
import { 
  Sparkles, 
  X, 
  Send, 
  Notebook, 
  BookOpen,
  Trash2,
  Layers,
  Library,
  BookText,
  Music,
  Globe,
  ExternalLink,
  Key,
  Wifi,
  WifiOff,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  MessageSquare,
  ChevronDown,
  Pencil,
  Check,
  Undo2,
  Copy,
  Square
} from 'lucide-react';

export function extractFollowUpQuestions(content: string): string[] {
  if (!content || (!content.includes('Pistes') && !content.includes('💡') && !content.includes('approfondissement'))) {
    return [];
  }
  const parts = content.split(/###\s*(?:💡\s*)?Pistes d'approfondissement/i);
  if (parts.length < 2) return [];
  const section = parts[1];
  const lines = section.split('\n');
  const questions: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*•\d.)\s]+/, '').trim();
    if (trimmed.endsWith('?') && trimmed.length > 8) {
      questions.push(trimmed);
    }
  }
  return questions.slice(0, 3);
}

interface ChatMessageWithSources extends ChatMessage {
  sources?: GeminiSource[];
  refusal?: boolean;
  originalQuery?: string;
  closestPassages?: any[];
}

const RefusalPassagesBlock: React.FC<{
  originalQuery: string;
  passages: any[];
  onForceSearch: (query: string) => void;
}> = ({ originalQuery, passages, onForceSearch }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!passages || passages.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-zinc-100/80 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 cursor-pointer text-left focus:outline-none"
        >
          <span className="inline-block transition-transform duration-200" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span>Passages les plus proches trouvés ({Math.min(5, passages.length)})</span>
        </button>
        
        <button
          onClick={() => onForceSearch(originalQuery)}
          className="text-xs font-black text-teal-600 dark:text-teal-400 hover:underline cursor-pointer flex items-center gap-1 focus:outline-none"
        >
          <span>Chercher quand même</span>
        </button>
      </div>

      {isOpen && (
        <div className="space-y-3 mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in duration-200">
          {passages.slice(0, 5).map((p, idx) => (
            <div key={idx} className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              <span className="font-bold text-teal-600 dark:text-teal-400 block mb-0.5">{p.title || `Passage #${idx + 1}`}</span>
              <p className="italic bg-white/40 dark:bg-black/20 p-2 rounded-lg border border-zinc-200/40 dark:border-zinc-800/40">« {p.textSnippet} »</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export type AssistantMode = 'auto-rag' | 'dock';

export interface AIConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: AssistantMode;
}

const CONV_STORAGE_KEY = 'kings_sword_ai_conversations_v1';
const ACTIVE_CONV_STORAGE_KEY = 'kings_sword_ai_active_conv_id_v1';

const AIAssistant: React.FC = () => {
  const { 
    contextSermonIds, 
    selectedSermonId,
    activeSermon,
    toggleContextSermon,
    clearContextSermons,
    sermons,
    sermonsMap,
    isSqliteAvailable,
    chatHistory, 
    addChatMessage, 
    updateChatHistory,
    toggleAI,
    pendingStudyRequest,
    triggerStudyRequest,
    assistantMode,
    setAssistantMode,
    languageFilter,
    setSelectedSermonId,
    setJumpToText,
    setJumpToParagraph,
    setLibraryMode,
    addNotification
  } = useAppStore();
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingStatus, setTypingStatus] = useState<string>("Recherche dans les sermons...");
  const [noteSelectorData, setNoteSelectorData] = useState<{ text: string; sermon: Sermon } | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [hasKey, setHasKey] = useState(hasValidGeminiApiKey());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
    setTypingStatus('');
  };

  const [retrievalStats, setRetrievalStats] = useState<{ lastMethod: string; totalQueries: number; fallbackCount: number }>({
    lastMethod: '',
    totalQueries: 0,
    fallbackCount: 0
  });  const [indexProgress, setIndexProgress] = useState<CorpusIndexProgress | null>(null);

  useEffect(() => {
    loadPersistedProgressState().then(initial => {
      setIndexProgress(initial);
      if (!initial || initial.status !== 'READY') {
        initializeCorpusIndex({ loadedSermonsMap: sermonsMap }).catch(err => {
          console.warn('[AIAssistant] Erreur auto-indexation:', err);
        });
      }
    });
    const unsubscribe = subscribeIndexProgress(updated => {
      setIndexProgress(updated);
    });
    return () => unsubscribe();
  }, [sermonsMap]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const refreshKeyState = () => {
    setHasKey(hasValidGeminiApiKey());
  };

  // Gestion des conversations multiples
  const [conversations, setConversations] = useState<AIConversation[]>(() => {
    try {
      const raw = localStorage.getItem(CONV_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    const legacyHistory = useAppStore.getState().chatHistory['global-library-rag'] || [];
    const initialId = legacyHistory.length > 0 ? 'global-library-rag' : `conv_${Date.now()}`;
    return [{
      id: initialId,
      title: legacyHistory.length > 0 ? 'Discussion principale' : 'Nouvelle discussion',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: 'auto-rag'
    }];
  });

  const [activeConvId, setActiveConvId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_CONV_STORAGE_KEY);
      if (saved) return saved;
    } catch {}
    return conversations[0]?.id || `conv_${Date.now()}`;
  });

  const [isConversationsDrawerOpen, setIsConversationsDrawerOpen] = useState(false);
  const [searchConvQuery, setSearchConvQuery] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Persistance dans localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(conversations));
    } catch {}
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_CONV_STORAGE_KEY, activeConvId);
    } catch {}
  }, [activeConvId]);

  // Démarrer le renommage d'une conversation
  const startRenaming = (id: string, currentTitle: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingConvId(id);
    setEditingTitle(currentTitle);
  };

  // Valider et sauvegarder le nouveau titre
  const saveRenaming = (id: string, e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const clean = editingTitle.trim();
    if (!clean) {
      setEditingConvId(null);
      return;
    }
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: clean, updatedAt: new Date().toISOString() } : c));
    setEditingConvId(null);
    addNotification("Discussion renommée", "success");
  };

  // Annuler le renommage
  const cancelRenaming = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingConvId(null);
    setEditingTitle('');
  };

  // Conversation courante
  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === activeConvId) || conversations[0] || {
      id: activeConvId,
      title: 'Nouvelle discussion',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: assistantMode
    };
  }, [conversations, activeConvId, assistantMode]);

  // Clé d'historique active (liée à la discussion en cours)
  const chatKey = activeConvId;
  const history = (chatHistory[chatKey] || []) as ChatMessageWithSources[];

  const handleForceSearch = async (queryStr: string) => {
    if (!queryStr.trim()) return;
    setInput('');
    setIsTyping(true);
    setTypingStatus("Génération forcée de la réponse avec signal partiel...");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    addChatMessage(chatKey, {
      role: 'user',
      content: `[Génération forcée] ${queryStr}`,
      timestamp: new Date().toISOString()
    });

    try {
      const unifiedResult = await executeUnifiedRagAssistantFlow(queryStr, contextSermonIds, {
        loadedSermonsMap: sermonsMap,
        bibleVersion,
        forceGenerate: true,
        maxEvidenceCount: 8,
        topK: 15
      });

      if (abortController.signal.aborted) return;

      if (unifiedResult.status === 'success' && unifiedResult.answerText) {
        addChatMessage(chatKey, {
          role: 'assistant',
          content: unifiedResult.answerText,
          timestamp: new Date().toISOString(),
          sources: unifiedResult.sources && unifiedResult.sources.length > 0 ? unifiedResult.sources : undefined
        });
      } else {
        addChatMessage(chatKey, {
          role: 'assistant',
          content: `❌ **Échec de génération forcée** : ${unifiedResult.errorMessage || 'Impossible d\'obtenir une réponse du modèle.'}`,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err: any) {
      if (abortController.signal.aborted) return;
      addChatMessage(chatKey, {
        role: 'assistant',
        content: `❌ **Erreur** : ${err?.message || String(err)}`,
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsTyping(false);
      setTypingStatus('');
    }
  };

  // Création d'une nouvelle discussion (+ button) tout en conservant les précédentes
  const handleCreateNewChat = () => {
    const newId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newConv: AIConversation = {
      id: newId,
      title: 'Nouvelle discussion',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: assistantMode
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(newId);
    setIsConversationsDrawerOpen(false);
    addNotification("Nouvelle discussion créée", "info");
  };

  // Suppression d'une conversation spécifique
  const handleDeleteConversation = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (conversations.length <= 1) {
      handleClearChat(id);
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title: 'Nouvelle discussion', updatedAt: new Date().toISOString() } : c));
      addNotification("Discussion réinitialisée", "info");
      return;
    }

    const remaining = conversations.filter(c => c.id !== id);
    setConversations(remaining);

    useAppStore.setState(s => {
      const nextHistory = { ...s.chatHistory };
      delete nextHistory[id];
      try {
        localStorage.setItem('kings_sword_ai_chat_history_v1', JSON.stringify(nextHistory));
      } catch {}
      return { chatHistory: nextHistory };
    });

    if (activeConvId === id) {
      setActiveConvId(remaining[0].id);
    }
    addNotification("Discussion supprimée", "info");
  };

  // Nettoyage complet de tout l'historique
  const handleClearAllHistory = () => {
    const newId = `conv_${Date.now()}`;
    const freshConv: AIConversation = {
      id: newId,
      title: 'Nouvelle discussion',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: assistantMode
    };
    setConversations([freshConv]);
    setActiveConvId(newId);
    try {
      localStorage.removeItem('kings_sword_ai_chat_history_v1');
    } catch {}
    useAppStore.setState(() => ({
      chatHistory: {}
    }));
    setIsConversationsDrawerOpen(false);
    addNotification("Historique des discussions réinitialisé", "success");
  };

  // Nettoyage des messages de la discussion courante
  const handleClearChat = (targetId = chatKey) => {
    useAppStore.setState(state => {
      const next = {
        ...state.chatHistory,
        [targetId]: []
      };
      try {
        localStorage.setItem('kings_sword_ai_chat_history_v1', JSON.stringify(next));
      } catch {}
      return { chatHistory: next };
    });
    setConversations(prev => prev.map(c => c.id === targetId ? { ...c, title: 'Nouvelle discussion', updatedAt: new Date().toISOString() } : c));
    addNotification("Discussion vidée", "info");
  };

  // Filtrage des conversations
  const filteredConversations = useMemo(() => {
    if (!searchConvQuery.trim()) return conversations;
    const q = searchConvQuery.toLowerCase();
    return conversations.filter(c => c.title.toLowerCase().includes(q));
  }, [conversations, searchConvQuery]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bibleVersion = useAppStore(s => s.bibleVersion);
  const [allLoadedSongs, setAllLoadedSongs] = useState<any[]>([]);

  useEffect(() => {
    loadAllSongs().then(s => setAllLoadedSongs(s || [])).catch(() => {});
  }, []);

  const selectedSermonsMetadata = useMemo(() => {
    const uniqueMap = new Map<string, any>();
    contextSermonIds.forEach(id => {
      if (id.startsWith('bible-')) {
        const parts = id.split('-');
        const bookId = parts[1];
        const chapterStr = parts[2];
        const meta = BIBLE_BOOKS_META.find(b => b.id.toUpperCase() === bookId.toUpperCase());
        if (meta) {
          const title = chapterStr === 'all' 
            ? `${meta.name} (Livre entier)`
            : `${meta.name} ${chapterStr}`;
          uniqueMap.set(id, {
            id,
            title,
            date: bibleVersion.toUpperCase(),
            city: meta.testament === 'OT' ? 'Ancien Testament' : 'Nouveau Testament'
          });
        }
      } else if (id.startsWith('song-')) {
        const rawId = id.replace('song-', '');
        const found = allLoadedSongs.find(s => String(s.id) === rawId);
        uniqueMap.set(id, {
          id,
          title: found ? `${found.id}. ${found.title}` : `Cantique #${rawId}`,
          date: 'Cantique',
          city: found?.language ? getSongLanguageBadge(found.language) : 'FR'
        });
      } else if (id.startsWith('expose-pg-')) {
        const pg = id.replace('expose-pg-', '');
        uniqueMap.set(id, {
          id,
          title: `Exposé des Sept Âges - Page ${pg}`,
          date: 'Exposé',
          city: 'W.M. Branham'
        });
      } else if (id.startsWith('expose-ch-')) {
        const ch = id.replace('expose-ch-', '');
        uniqueMap.set(id, {
          id,
          title: `Exposé - Chapitre ${ch}`,
          date: 'Exposé',
          city: 'W.M. Branham'
        });
      } else {
        const s = sermonsMap.get(id) || sermons.find(item => item.id === id);
        if (s) {
          uniqueMap.set(id, s);
        }
      }
    });
    return Array.from(uniqueMap.values());
  }, [sermons, sermonsMap, contextSermonIds, bibleVersion, allLoadedSongs]);

  // Estimation non-bloquante de la volumétrie et des tokens pour le Dock IA
  const estimatedDockStats = useMemo(() => {
    if (contextSermonIds.length === 0) return { chars: 0, tokens: 0 };
    let totalChars = 0;
    const docCount = Math.max(1, contextSermonIds.length);
    const maxCharsPerDoc = docCount <= 5 ? 60000 : docCount <= 20 ? 25000 : Math.max(3000, Math.floor(300000 / docCount));
    
    selectedSermonsMetadata.forEach(s => {
      const textLen = (s.text || '').length;
      totalChars += Math.min(textLen || 15000, maxCharsPerDoc);
    });
    // Ratio universel d'estimation : ~3.8 caractères par token pour le français/anglais
    const estimatedTokens = Math.round(totalChars / 3.8);
    return { chars: totalChars, tokens: estimatedTokens };
  }, [contextSermonIds, selectedSermonsMetadata]);

  // Transforme les balises de référence [Réf: ID_SERMON, Para. N], [Réf: expose-ch-N, §P], etc. en liens interactifs cliquables
  const formatAIResponse = (text: string) => {
    // Supprimer la section "💡 Pistes d'approfondissement" du corps du message pour ne pas l'inclure dans la réponse texte
    const textWithoutPistes = (text || '').replace(/(?:#{1,4}\s*(?:💡\s*)?(?:Pistes d'approfondissement|Pistes d'etude|Questions de reflexion|Pistes d'exploration|Pistes d'approfondissement suggérées)[\s\S]*)/i, '').trim();

    // Regex universelle pour capturer toutes les variantes de citations dans le corps du texte
    // Exemples: [Réf: 63-0324M, §2], [Réf: expose-ch-4, §151], [Réf: expose-ch-8, Para. 98], (Réf: 65-1212, §10), [63-0324M, §5], etc.
    const refRegex = /(?:\[|\()(?:\s*Réf\.?\s*:\s*)?([a-zA-Z0-9_-]+)(?:[,\s]+(?:§|Para\.?|Paragraphe|Page|p\.|v\.|verset)?\s*(\d+))?\s*(?:\]|\))/gi;

    const formattedText = textWithoutPistes.replace(refRegex, (match, rawDocId, rawParaNum) => {
      const cleanId = (rawDocId || '').trim();
      const pNum = rawParaNum ? parseInt(rawParaNum, 10) : 1;
      
      // Validation : Est-ce un ID documentaire valide ou reconnu ?
      const isExpose = cleanId.startsWith('expose-ch-') || cleanId.startsWith('expose-pg-') || cleanId.startsWith('expose-');
      const isBible = cleanId.startsWith('bible-');
      const isSong = cleanId.startsWith('song-');
      const isStandardSermonDate = /^\d{2}-\d{4}[A-Za-z]?/i.test(cleanId);
      
      // Recherche du sermon dans les métadonnées (exact ou avec préfixe de date/version)
      const foundSermon = 
        selectedSermonsMetadata.find(s => s.id === cleanId || s.id.startsWith(cleanId) || cleanId.startsWith(s.id)) ||
        sermons.find(s => s.id === cleanId || s.id.startsWith(cleanId) || cleanId.startsWith(s.id));

      if (!isExpose && !isBible && !isSong && !isStandardSermonDate && !foundSermon) {
        // Ce n'est pas une référence documentaire, ne pas modifier
        return match;
      }

      let titleDisplay = cleanId;
      if (isExpose) {
        if (cleanId.startsWith('expose-ch-')) {
          const chNum = cleanId.replace('expose-ch-', '');
          titleDisplay = `Exposé - Chapitre ${chNum}`;
        } else if (cleanId.startsWith('expose-pg-')) {
          const pgNum = cleanId.replace('expose-pg-', '');
          titleDisplay = `Exposé - Page ${pgNum}`;
        } else {
          titleDisplay = `Exposé des Sept Âges`;
        }
      } else if (isBible) {
        const parts = cleanId.split('-');
        const bookCode = parts[1] || '';
        const meta = BIBLE_BOOKS_META.find(b => b.id.toUpperCase() === bookCode.toUpperCase());
        const bName = meta ? meta.name : bookCode;
        const ch = parts[2] || '1';
        titleDisplay = `${bName} ${ch}`;
      } else if (isSong) {
        const sNum = cleanId.replace('song-', '');
        titleDisplay = `Cantique #${sNum}`;
      } else if (foundSermon) {
        titleDisplay = `${foundSermon.title} (${foundSermon.date})`;
      }

      const targetId = foundSermon ? foundSermon.id : cleanId;
      const paraLabel = rawParaNum ? `§${pNum}` : '';

      return `<a href="#" data-sermon-id="${targetId}" data-para-num="${pNum}" class="sermon-ref inline-flex items-center gap-1 px-2 py-0.5 bg-teal-600/10 dark:bg-teal-400/15 text-teal-800 dark:text-teal-200 rounded-md text-[9.5px] font-black hover:bg-teal-600/25 transition-all border border-teal-600/20 mx-1 align-middle shadow-xs cursor-pointer select-none group/badge" title="Ouvrir dans le lecteur (${titleDisplay})"><span>📖 ${paraLabel ? `${paraLabel} — ` : ''}${titleDisplay}</span></a>`;
    });

    return marked(formattedText, { breaks: true });
  };
  
  // Gestion du clic sur une référence ou un lien interne vers un sermon / document
  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a.sermon-ref, [data-sermon-id]') as HTMLElement;
    if (link && link.dataset.sermonId) {
      e.preventDefault();
      e.stopPropagation();
      const sId = link.dataset.sermonId;
      const paraNumStr = link.dataset.paraNum;
      
      // Basculer sur le bon mode de bibliothèque pour afficher la vue correspondante
      if (sId.startsWith('expose-')) {
        setLibraryMode('expose');
      } else if (sId.startsWith('bible-')) {
        setLibraryMode('bible');
      } else if (sId.startsWith('song-')) {
        setLibraryMode('songs');
      } else {
        setLibraryMode('sermons');
      }

      setSelectedSermonId(sId);
      if (paraNumStr) {
        const num = parseInt(paraNumStr, 10);
        if (!isNaN(num)) {
          setJumpToParagraph(num);
          return;
        }
      }
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, isTyping]);

  const getFullSermons = async (ids: string[]): Promise<Sermon[]> => {
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(uniqueIds.map(async id => {
      if (id.startsWith('bible-')) {
        const parts = id.split('-');
        const bookId = parts[1];
        const chapterStr = parts[2];
        if (chapterStr === 'all') {
          return await getBibleBookSermon(bookId, bibleVersion);
        } else {
          const chapter = parseInt(chapterStr, 10) || 1;
          return await getBibleChapterSermon(bookId, chapter, bibleVersion);
        }
      }
      if (id.startsWith('song-')) {
        return await getSongAsSermon(id);
      }
      if (id.startsWith('expose-pg-')) {
        const pageNum = parseInt(id.replace('expose-pg-', ''), 10);
        return await getExposePage(pageNum);
      }
      if (id.startsWith('expose-ch-')) {
        const chNum = id.replace('expose-ch-', '');
        return await getExposeChapter(chNum);
      }
      if (!isSqliteAvailable) {
        return sermonsMap.get(id) as Sermon;
      }
      return await getSermonById(id);
    }));
    return results.filter((s): s is Sermon => !!s && !!s.text);
  };

  // Traitement d'une demande d'étude issue d'une sélection de texte dans le Reader
  useEffect(() => {
    if (pendingStudyRequest && activeSermon) {
      const textToStudy = pendingStudyRequest;
      triggerStudyRequest(null);

      const performStudy = async () => {
        setIsTyping(true);
        setTypingStatus("Analyse contextuelle approfondie...");
        addChatMessage(chatKey, { 
          role: 'user', 
          content: `${t.ai_deep_study} : "${textToStudy}"`, 
          timestamp: new Date().toISOString() 
        });

        try {
          const validSermons = await getFullSermons(contextSermonIds);
          const analysis = await analyzeSelectionContext(textToStudy, activeSermon, validSermons);
          
          addChatMessage(chatKey, {
            role: 'assistant',
            content: analysis,
            timestamp: new Date().toISOString()
          });
        } catch (e: any) {
          addNotification(e.message || "Erreur lors de l'étude", 'error');
        } finally {
          setIsTyping(false);
        }
      };
      performStudy();
    }
  }, [pendingStudyRequest, activeSermon, chatKey, t.ai_deep_study]);

  const handleStartEdit = (index: number, content: string) => {
    setEditingIndex(index);
    setEditingText(content);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingText('');
  };

  const handleSaveEdit = (index: number) => {
    const clean = editingText.trim();
    if (!clean) return;
    if (isTyping) {
      handleStop();
    }
    setEditingIndex(null);
    setEditingText('');
    const truncatedHistory = history.slice(0, index);
    handleSend(clean, truncatedHistory);
  };

  // Envoi d'une question par l'utilisateur
  const handleSend = async (textToSend?: string, overrideHistory?: ChatMessage[]) => {
    const rawText = typeof textToSend === 'string' ? textToSend : input;
    if (!rawText.trim() || (isTyping && !overrideHistory)) return;
    
    // En mode Dock, vérifier qu'au moins une ressource a été sélectionnée
    if (assistantMode === 'dock' && contextSermonIds.length === 0) {
      addNotification("Veuillez sélectionner au moins un sermon ou une ressource dans le Dock IA.", "error");
      return;
    }

    const msg = rawText.trim();
    if (!textToSend) setInput('');

    // Mise à jour automatique du titre de la conversation si c'est encore "Nouvelle discussion"
    if (currentConversation.title === 'Nouvelle discussion') {
      const cleanTitle = msg.length > 34 ? msg.slice(0, 34) + '...' : msg;
      setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, title: cleanTitle, updatedAt: new Date().toISOString() } : c));
    }

    const historyToUse = overrideHistory || history;
    const newMsgObj: ChatMessageWithSources = { role: 'user', content: msg, timestamp: new Date().toISOString() };
    
    if (overrideHistory) {
      updateChatHistory(chatKey, [...overrideHistory, newMsgObj]);
    } else {
      addChatMessage(chatKey, newMsgObj);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsTyping(true);

    try {
      if (assistantMode === 'auto-rag') {
        // ==============================================================
        // MODE RAG AUTOMATIQUE SUR L'ENSEMBLE DES SERMONS / AI CONTEXT
        // ==============================================================
        if (aiConfig.featureFlags.useUnifiedRag || aiConfig.featureFlags.useHybridRetrieval) {
          // Inclut systématiquement le corpus complet de l'Exposé (11 chapitres) et tous les sermons disponibles
          const exposeChapters = Array.from({ length: 11 }, (_, i) => `expose-ch-${i}`);
          const sermonIds = Array.from(new Set([...Array.from(sermonsMap.keys()), ...sermons.map(s => s.id)]));
          const autoRagContext = Array.from(new Set([...exposeChapters, ...sermonIds]));

          setTypingStatus(`Recherche unifiée dans ${autoRagContext.length} ressource(s)...`);

          const unifiedResult = await executeUnifiedRagAssistantFlow(msg, autoRagContext, {
            loadedSermonsMap: sermonsMap,
            bibleVersion,
            maxEvidenceCount: 8,
            topK: 15
          });

          if (abortController.signal.aborted) return;

          // Enregistrement télémétrique du mode de retrieval et taux de repli
          const isSemanticMethod = Boolean(unifiedResult.vectorMethod?.startsWith('cosine'));
          setRetrievalStats(prev => {
            const newTotal = prev.totalQueries + 1;
            const newFallback = isSemanticMethod ? prev.fallbackCount : prev.fallbackCount + 1;
            const fallbackRate = (newFallback / newTotal) * 100;
            console.log(`[RAG_TELEMETRY] Mode: ${unifiedResult.vectorMethod || 'deterministic'} | Taux de repli: ${fallbackRate.toFixed(1)}% (${newFallback}/${newTotal})`);
            return {
              lastMethod: unifiedResult.vectorMethod || 'deterministic_overlap',
              totalQueries: newTotal,
              fallbackCount: newFallback
            };
          });

          if (unifiedResult.status === 'not_answerable' || !unifiedResult.evidencePackage.answerable) {
            const pkg = unifiedResult.evidencePackage;
            const isUnreliableClose = pkg.refusalCategory === 'unreliable_close_passages' || (pkg.closestPassages && pkg.closestPassages.length > 0);

            let refusalText = '';
            if (isUnreliableClose) {
              refusalText = `⚠️ **Passages proches trouvés mais peu fiables (signal partiel)** :\n${pkg.reason || "Des passages proches ont été trouvés dans le corpus, mais le signal documentaire reste trop partiel pour garantir une réponse doctrinale certaine."}`;
            } else {
              refusalText = `🔍 **Aucun passage lié trouvé** :\n${pkg.reason || "Les textes disponibles ne traitent pas de ce sujet."}`;
            }

            const fallbackClosest = (pkg.evidence || []).map(e => ({
              title: e.sermonTitle || e.sermonId,
              textSnippet: e.text ? e.text.slice(0, 220) + '...' : ''
            }));
            const closestPassages = (pkg.closestPassages && pkg.closestPassages.length > 0)
              ? pkg.closestPassages
              : fallbackClosest;

            const abstentionMsg: ChatMessageWithSources = {
              role: 'assistant',
              content: refusalText,
              timestamp: new Date().toISOString(),
              refusal: true,
              originalQuery: msg,
              closestPassages
            };
            if (!abortController.signal.aborted) addChatMessage(chatKey, abstentionMsg);
            return;
          }

          setTypingStatus(`Génération de la réponse sur ${unifiedResult.evidencePackage.evidence.length} preuve(s) documentaire(s)...`);

          if (!abortController.signal.aborted) {
            if (unifiedResult.status === 'success' && unifiedResult.answerText) {
              const isRefusal = unifiedResult.generationResult?.sourcesSuffisantes === false;
              const fallbackClosest = (unifiedResult.evidencePackage.evidence || []).map(e => ({
                title: e.sermonTitle || e.sermonId,
                textSnippet: e.text ? e.text.slice(0, 220) + '...' : ''
              }));
              const closestPassages = (unifiedResult.evidencePackage.closestPassages && unifiedResult.evidencePackage.closestPassages.length > 0)
                ? unifiedResult.evidencePackage.closestPassages
                : fallbackClosest;

              const newMessage: ChatMessageWithSources = { 
                role: 'assistant', 
                content: unifiedResult.answerText, 
                timestamp: new Date().toISOString(),
                sources: !isRefusal && unifiedResult.sources && unifiedResult.sources.length > 0 ? unifiedResult.sources : undefined,
                refusal: isRefusal,
                originalQuery: isRefusal ? msg : undefined,
                closestPassages: isRefusal ? closestPassages : undefined
              };
              addChatMessage(chatKey, newMessage);
            } else {
              const errorMsg: ChatMessageWithSources = {
                role: 'assistant',
                content: `❌ **Erreur de génération Gemini** : ${unifiedResult.errorMessage || 'Impossible de joindre le modèle de génération.'}`,
                timestamp: new Date().toISOString(),
              };
              addChatMessage(chatKey, errorMsg);
            }
          }

        } else {
          // ==============================================================
          // MODE RAG LEGACY (INCHANGÉ PAR DÉFAUT)
          // ==============================================================
          setTypingStatus("Recherche des passages pertinents dans les sermons...");
          
          const ragResult = await retrieveRelevantSermonPassages(msg, {
            maxParagraphs: 8,
            minScoreThreshold: 10
          });

          if (abortController.signal.aborted) return;

          // Cas où aucun passage pertinent n'est identifié
          if (!ragResult.hasResults || ragResult.paragraphs.length === 0) {
            const noResultMsg: ChatMessageWithSources = {
              role: 'assistant',
              content: `🔍 **Aucun passage pertinent n'a été trouvé dans les sermons disponibles pour :** *"${msg}"*.\n\nLes termes doctrinaux analysés (*${ragResult.keywordsUsed.join(', ') || 'aucun'}*) ne correspondent à aucun extrait significatif dans la bibliothèque actuelle. Vous pouvez reformuler votre question avec des termes doctrinaux plus spécifiques ou ajouter manuellement des sermons dans le Dock IA.`,
              timestamp: new Date().toISOString(),
            };
            if (!abortController.signal.aborted) addChatMessage(chatKey, noResultMsg);
            return;
          }

          setTypingStatus(`Analyse théologique de ${ragResult.paragraphs.length} extrait(s) retrouvé(s)...`);

          const formattedContext = formatRagContextForGemini(ragResult.paragraphs, msg);

          // Appel direct RAG à Gemini basé exclusivement sur les sermons internes
          const { text, sources } = await askGeminiChat(msg, formattedContext, historyToUse, {
            mode: 'auto-rag',
            retrievedParagraphs: ragResult.paragraphs
          });

          if (abortController.signal.aborted) return;

          const newMessage: ChatMessageWithSources = { 
            role: 'assistant', 
            content: text, 
            timestamp: new Date().toISOString(),
            sources: sources.length > 0 ? sources : undefined
          };
          addChatMessage(chatKey, newMessage);
        }

      } else {
        // ==============================================================
        // MODE DOCK IA (AI CONTEXT EXPLICITE SÉLECTIONNÉ PAR L'UTILISATEUR)
        // ==============================================================
        if (aiConfig.featureFlags.useUnifiedRag) {
          // ==============================================================
          // PIPELINE UNIFIED RAG : AI CONTEXT -> UNIFIED RAG -> EVIDENCE -> GEMINI -> CITATION VALIDATION
          // ==============================================================
          setTypingStatus(`Recherche ciblée Unified RAG dans les ${contextSermonIds.length} ressource(s)...`);

          const unifiedResult = await executeUnifiedRagAssistantFlow(msg, contextSermonIds, {
            loadedSermonsMap: sermonsMap,
            bibleVersion,
            maxEvidenceCount: 8,
            topK: 15
          });

          if (abortController.signal.aborted) return;

          // Enregistrement télémétrique du mode de retrieval et taux de repli
          const isSemanticMethod = Boolean(unifiedResult.vectorMethod?.startsWith('cosine'));
          setRetrievalStats(prev => {
            const newTotal = prev.totalQueries + 1;
            const newFallback = isSemanticMethod ? prev.fallbackCount : prev.fallbackCount + 1;
            const fallbackRate = (newFallback / newTotal) * 100;
            console.log(`[RAG_TELEMETRY] Dock Mode: ${unifiedResult.vectorMethod || 'deterministic'} | Taux de repli: ${fallbackRate.toFixed(1)}% (${newFallback}/${newTotal})`);
            return {
              lastMethod: unifiedResult.vectorMethod || 'deterministic_overlap',
              totalQueries: newTotal,
              fallbackCount: newFallback
            };
          });

          // RÈGLE : Non-answerable strict
          if (unifiedResult.status === 'not_answerable' || !unifiedResult.evidencePackage.answerable) {
            const pkg = unifiedResult.evidencePackage;
            const isUnreliableClose = pkg.refusalCategory === 'unreliable_close_passages' || (pkg.closestPassages && pkg.closestPassages.length > 0);

            let refusalText = '';
            if (isUnreliableClose) {
              refusalText = `⚠️ **Passages proches trouvés mais peu fiables (signal partiel)** :\n${pkg.reason || "Les ressources sélectionnées dans le Dock IA contiennent des passages proches, mais le signal documentaire reste trop partiel pour garantir une réponse doctrinale certaine."}`;
            } else {
              refusalText = `🔍 **Aucun passage lié trouvé** :\n${pkg.reason || "Aucun passage lié à cette question n'a été trouvé dans les documents sélectionnés. Le sujet demandé ne figure pas dans les ressources choisies."}`;
            }

            const abstentionMsg: ChatMessageWithSources = {
              role: 'assistant',
              content: refusalText,
              timestamp: new Date().toISOString(),
              refusal: true,
              originalQuery: msg,
              closestPassages: pkg.closestPassages || []
            };
            if (!abortController.signal.aborted) addChatMessage(chatKey, abstentionMsg);
            return;
          }

          setTypingStatus(`Génération de la réponse sur ${unifiedResult.evidencePackage.evidence.length} preuve(s) documentaire(s)...`);

          if (!abortController.signal.aborted) {
            if (unifiedResult.status === 'success' && unifiedResult.answerText) {
              const isRefusal = unifiedResult.generationResult?.sourcesSuffisantes === false;
              const fallbackClosest = (unifiedResult.evidencePackage.evidence || []).map(e => ({
                title: e.sermonTitle || e.sermonId,
                textSnippet: e.text ? e.text.slice(0, 220) + '...' : ''
              }));
              const closestPassages = (unifiedResult.evidencePackage.closestPassages && unifiedResult.evidencePackage.closestPassages.length > 0)
                ? unifiedResult.evidencePackage.closestPassages
                : fallbackClosest;

              const newMessage: ChatMessageWithSources = { 
                role: 'assistant', 
                content: unifiedResult.answerText, 
                timestamp: new Date().toISOString(),
                sources: !isRefusal && unifiedResult.sources && unifiedResult.sources.length > 0 ? unifiedResult.sources : undefined,
                refusal: isRefusal,
                originalQuery: isRefusal ? msg : undefined,
                closestPassages: isRefusal ? closestPassages : undefined
              };
              addChatMessage(chatKey, newMessage);
            } else {
              const errorMsg: ChatMessageWithSources = {
                role: 'assistant',
                content: `❌ **Erreur de génération Gemini** : ${unifiedResult.errorMessage || 'Impossible de joindre le modèle de génération.'}`,
                timestamp: new Date().toISOString(),
              };
              addChatMessage(chatKey, errorMsg);
            }
          }

        } else {
          // ==============================================================
          // MODE DOCK IA LEGACY (INCHANGÉ PAR DÉFAUT)
          // ==============================================================
          // Lancement en arrière-plan du Shadow Unified RAG pour comparaison passive non-autoritaire
          executeShadowUnifiedRag(msg, contextSermonIds, {
            loadedSermonsMap: sermonsMap,
            bibleVersion
          }).catch(() => {});

          setTypingStatus(`Lecture des ${contextSermonIds.length} ressource(s) du Dock IA...`);
          const validSermons = await getFullSermons(contextSermonIds);
          
          if (abortController.signal.aborted) return;

          // Calculer l'allocation de caractères par document pour garantir que 100% des ressources sont transmises
          const docCount = Math.max(1, validSermons.length);
          const maxCharsPerDoc = docCount <= 5 ? 60000 : docCount <= 20 ? 25000 : Math.max(3000, Math.floor(300000 / docCount));

          const ctx = validSermons.map(s => {
            const numberedText = splitSermonIntoParagraphs(s.text)
                  .map((p, i) => {
                    const explicitNum = extractLeadingParagraphNumber(p);
                    const pNum = explicitNum !== null ? explicitNum : i + 1;
                    return `[Para. ${pNum}] ${p.trim()}`;
                  })
                  .join('\n');
            return `[DOC ID: ${s.id}] - TITRE: ${s.title} (${s.date || 'Non daté'}, ${s.city || ''})\nCONTENU:\n${numberedText.substring(0, maxCharsPerDoc)}`;
          }).join('\n\n---\n\n');
          
          setTypingStatus(`Analyse théologique complète de ${validSermons.length} ressource(s)...`);
          const { text, sources } = await askGeminiChat(msg, ctx, historyToUse, { mode: 'dock' });
          
          if (abortController.signal.aborted) return;

          const newMessage: ChatMessageWithSources = { 
            role: 'assistant', 
            content: text, 
            timestamp: new Date().toISOString(),
            sources: sources.length > 0 ? sources : undefined
          };
          addChatMessage(chatKey, newMessage);
        }
      }
    } catch (e: any) {
      if (abortController.signal.aborted || e?.name === 'AbortError') return;
      let displayMessage = e?.message || "Une erreur est survenue lors de l'analyse.";
      if (displayMessage.includes("Failed to call the Gemini API") || displayMessage.includes("Google Gemini")) {
        displayMessage = "❌ Connexion au service d'analyse IA impossible. Veuillez vérifier votre connexion Internet ou votre clé d'accès.";
      }
      addChatMessage(chatKey, { 
        role: 'assistant', 
        content: displayMessage, 
        timestamp: new Date().toISOString() 
      });
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsTyping(false);
    }
  };

  return (
    <div className="w-full bg-slate-50 dark:bg-zinc-950 h-full flex flex-col min-0 border-l border-zinc-200 dark:border-zinc-800 transition-all duration-500 shadow-2xl relative">
      {noteSelectorData && <NoteSelectorModal selectionText={noteSelectorData.text} sermon={noteSelectorData.sermon} onClose={() => setNoteSelectorData(null)} />}
      <ApiKeyModal 
        isOpen={isApiKeyModalOpen} 
        onClose={() => setIsApiKeyModalOpen(false)} 
        onSaved={refreshKeyState}
      />
      
      {/* Header */}
      <div className="px-5 h-14 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-3xl z-50">
        <div 
          onClick={toggleAI}
          className="flex items-center gap-3 cursor-pointer group/ai-title hover:opacity-80 transition-all active:scale-95"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-lg group-hover/ai-title:border-teal-600/40 transition-all">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-zinc-50 leading-none group-hover/ai-title:text-teal-600 transition-colors">ASSISTANT IA</h2>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5">
          <button 
            onClick={() => setIsApiKeyModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all border ${
              hasKey 
                ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' 
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 animate-pulse'
            }`}
            data-tooltip="Gérer la clé d'accès IA"
          >
            <Key className="w-3 h-3" />
            <span>{hasKey ? 'Clé Active' : 'Activer IA'}</span>
          </button>

          <button onClick={toggleAI} data-tooltip="Fermer l'Assistant IA" className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 active:scale-90">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Barre de sélection active de la discussion */}
      <div className="px-3 py-1.5 bg-white/50 dark:bg-zinc-900/50 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between gap-1.5">
        {editingConvId === currentConversation.id ? (
          <form 
            onSubmit={(e) => saveRenaming(currentConversation.id, e)} 
            className="flex-1 min-w-0 flex items-center gap-1"
          >
            <input
              type="text"
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              placeholder="Titre de la discussion..."
              autoFocus
              className="flex-1 min-w-0 px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-zinc-950 border border-teal-500 focus:outline-none text-zinc-900 dark:text-zinc-100"
            />
            <button
              type="submit"
              data-tooltip="Enregistrer le titre"
              className="w-6 h-6 flex items-center justify-center bg-teal-600 hover:bg-teal-500 text-white rounded-md cursor-pointer shrink-0 shadow-2xs"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={cancelRenaming}
              data-tooltip="Annuler"
              className="w-6 h-6 flex items-center justify-center bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-md cursor-pointer shrink-0"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-1 bg-zinc-100/80 dark:bg-zinc-800/80 rounded-lg p-0.5">
            <button
              onClick={() => setIsConversationsDrawerOpen(prev => !prev)}
              className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 hover:bg-zinc-200/80 dark:hover:bg-zinc-700/80 rounded-md transition-all text-left group cursor-pointer"
              data-tooltip="Afficher les discussions enregistrées"
            >
              <MessageSquare className="w-3 h-3 text-teal-600 shrink-0" />
              <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 truncate flex-1">
                {currentConversation.title}
              </span>
              <span className="text-[9px] text-zinc-400 font-mono shrink-0">
                ({history.length} msg)
              </span>
              <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isConversationsDrawerOpen ? 'rotate-180' : ''}`} />
            </button>

            <button
              type="button"
              onClick={(e) => startRenaming(currentConversation.id, currentConversation.title, e)}
              data-tooltip="Renommer cette discussion"
              className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-teal-600 hover:bg-white dark:hover:bg-zinc-900 rounded-md transition-colors cursor-pointer shrink-0"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Bouton + pour démarrer une nouvelle discussion */}
        <button
          type="button"
          onClick={handleCreateNewChat}
          data-tooltip="Démarrer une nouvelle discussion"
          className="w-7 h-7 flex items-center justify-center bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors cursor-pointer shrink-0 shadow-sm active:scale-95 ml-1"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Notification fine, élégante et non-intrusive de l'état d'indexation / préparation */}
      {(!indexProgress || indexProgress.status !== 'READY') && (
        <div className="mx-3 my-1 px-3 py-1.5 bg-slate-100/80 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60 rounded-lg text-slate-600 dark:text-zinc-300 text-[11px] flex items-center justify-between gap-2 shrink-0 backdrop-blur-sm transition-all duration-200">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${indexProgress?.status === 'ERROR' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="truncate">
              {indexProgress?.status === 'ERROR' ? (
                <span className="text-red-600 dark:text-red-400 font-medium">
                  Indexation interrompue : {indexProgress.errorMessage || 'Erreur d\'initialisation'}
                </span>
              ) : (
                <span>
                  Indexation en arrière-plan : {indexProgress?.sermonsProcessed || 0} / {indexProgress?.totalSermons || (sermons.filter(s => !s.id.startsWith('expose-ch-')).length || sermons.length)} sermons ({Math.min(100, Math.round(((indexProgress?.chunksProcessed || 0) / Math.max(1, indexProgress?.totalChunks || 1)) * 100))}%)
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {indexProgress?.status === 'ERROR' && (
              <button
                onClick={() => forceResetIndexing().then(p => setIndexProgress(p))}
                className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 text-[10px] font-semibold cursor-pointer"
              >
                Relancer
              </button>
            )}
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 select-none">
              {indexProgress?.status === 'EMBEDDING' ? 'Vectorisation' : indexProgress?.status === 'CHUNKING' ? 'Découpage' : indexProgress?.status === 'ERROR' ? 'Erreur' : 'En cours'}
            </span>
          </div>
        </div>
      )}

      {/* Tiroir déroulant de gestion des conversations multiples */}
      {isConversationsDrawerOpen && (
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl space-y-2.5 z-30 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between pb-1 border-b border-zinc-100 dark:border-zinc-800">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
              Discussions sauvegardées ({conversations.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCreateNewChat}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-teal-600/10 text-teal-600 dark:text-teal-400 border border-teal-600/20 text-[9px] font-bold hover:bg-teal-600 hover:text-white hover:border-teal-600 transition-all cursor-pointer"
                data-tooltip="Créer une nouvelle discussion"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>Nouveau</span>
              </button>
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Disponible hors-ligne
              </span>
            </div>
          </div>

          {conversations.length > 3 && (
            <input
              type="text"
              placeholder="Filtrer les discussions..."
              value={searchConvQuery}
              onChange={(e) => setSearchConvQuery(e.target.value)}
              className="w-full px-2.5 py-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs"
            />
          )}

          <div className="max-h-56 overflow-y-auto space-y-1 custom-scrollbar">
            {filteredConversations.map(conv => {
              const isActive = conv.id === activeConvId;
              const msgCount = (chatHistory[conv.id] || []).length;
              const isEditingThis = editingConvId === conv.id;

              if (isEditingThis) {
                return (
                  <form
                    key={conv.id}
                    onSubmit={(e) => saveRenaming(conv.id, e)}
                    className="flex items-center gap-1.5 p-1.5 rounded-xl bg-teal-50/50 dark:bg-teal-950/30 border border-teal-500/40"
                  >
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      placeholder="Nom de la discussion..."
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-zinc-950 border border-teal-500 focus:outline-none text-zinc-900 dark:text-zinc-100"
                    />
                    <button
                      type="submit"
                      data-tooltip="Enregistrer"
                      className="w-6 h-6 flex items-center justify-center bg-teal-600 hover:bg-teal-500 text-white rounded-md cursor-pointer shrink-0"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelRenaming}
                      data-tooltip="Annuler"
                      className="w-6 h-6 flex items-center justify-center bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-md cursor-pointer shrink-0"
                    >
                      <Undo2 className="w-3 h-3" />
                    </button>
                  </form>
                );
              }

              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    setIsConversationsDrawerOpen(false);
                  }}
                  className={`flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer group ${
                    isActive
                      ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 border border-teal-200 dark:border-teal-800 font-bold'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-teal-600' : 'text-zinc-400'}`} />
                    <div className="min-w-0 flex-1">
                      <span className="truncate block text-[11px]">{conv.title}</span>
                      <span className="text-[9px] text-zinc-400 font-normal">
                        {new Date(conv.updatedAt || conv.createdAt).toLocaleDateString()} • {msgCount} message{msgCount > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => startRenaming(conv.id, conv.title, e)}
                      data-tooltip="Renommer"
                      className="p-1 rounded-md text-zinc-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      data-tooltip="Supprimer cette discussion"
                      className="p-1 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <button
              onClick={handleClearAllHistory}
              className="text-[10px] text-red-500 hover:text-red-600 font-bold hover:underline cursor-pointer"
            >
              Nettoyer tout l'historique
            </button>
            <button
              onClick={() => setIsConversationsDrawerOpen(false)}
              className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-semibold cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Sélecteur de Mode : Dock IA (Manuel) */}
      <div className="p-2 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white/40 dark:bg-zinc-900/40">
        <div className="flex p-1 bg-zinc-200/70 dark:bg-zinc-800/70 rounded-xl gap-1">
          <button
            onClick={() => setAssistantMode('dock')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              assistantMode === 'dock'
                ? 'bg-white dark:bg-zinc-900 text-teal-700 dark:text-teal-300 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
            data-tooltip="Étude ciblée des documents sélectionnés manuellement"
          >
            <Layers className="w-3.5 h-3.5 text-amber-600" />
            <span>Dock IA ({contextSermonIds.length})</span>
          </button>
        </div>

        {assistantMode === 'auto-rag' ? null : (
          <div className="mt-2 shrink-0">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500 shrink-0">
                  Sources Dock ({selectedSermonsMetadata.length})
                </span>
                {contextSermonIds.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[7.5px] font-bold">
                    ~{estimatedDockStats.tokens.toLocaleString()} tokens ({Math.round(estimatedDockStats.chars / 1000)}k / 300k car.)
                  </span>
                )}
              </div>
              {contextSermonIds.length > 0 && (
                <button 
                  onClick={clearContextSermons} 
                  data-tooltip="Vider toutes les ressources du dock IA" 
                  data-tooltip-icon="trash" 
                  className="text-[8px] font-black text-red-500 hover:text-red-600 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  Vider le dock
                </button>
              )}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
              {selectedSermonsMetadata.length === 0 ? (
                <div className="w-full py-2 px-3 bg-zinc-100/50 dark:bg-zinc-800/40 rounded-xl text-[10px] text-zinc-400 italic text-center">
                  Aucun document dans le dock. Ajoutez un sermon ou un passage biblique depuis la bibliothèque.
                </div>
              ) : (
                selectedSermonsMetadata.map((s) => {
                  const isSong = s.id.startsWith('song-');
                  const isBible = s.id.startsWith('bible-');
                  const isExpose = s.id.startsWith('expose-');

                  return (
                    <div key={s.id} className="flex-shrink-0 w-[170px] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-zinc-200 dark:border-zinc-700 rounded-xl p-2 shadow-xs relative group">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-md border border-teal-600/10 shrink-0">
                          {isSong ? (
                            <Music className="w-3 h-3" />
                          ) : isBible ? (
                            <BookOpen className="w-3 h-3" />
                          ) : isExpose ? (
                            <BookText className="w-3 h-3" />
                          ) : (
                            <Library className="w-3 h-3" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[9px] font-black text-zinc-800 dark:text-zinc-100 truncate leading-tight tracking-tight">{s.title}</p>
                          <p className="text-[7px] font-bold text-zinc-400 mt-0.5 uppercase tracking-tighter">{s.date}</p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleContextSermon(s.id); }}
                        data-tooltip={`Retirer "${s.title}"`}
                        data-tooltip-icon="trash"
                        className="absolute top-1 right-1 w-4 h-4 rounded-md bg-white dark:bg-zinc-800 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-xs cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Conversation History */}
      <div 
        ref={scrollRef} 
        className="flex-1 overflow-y-auto px-5 py-6 space-y-8 custom-scrollbar bg-slate-50 dark:bg-zinc-950 flex flex-col scroll-smooth transition-colors duration-500"
        onClick={handleContentClick}
      >
        {history.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4 my-auto opacity-70">
            <div className="w-12 h-12 rounded-2xl bg-teal-600/10 text-teal-600 flex items-center justify-center border border-teal-600/20 shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-100">
                {assistantMode === 'auto-rag' ? 'Recherche Globale Intelligente' : 'Étude Ciblée du Dock'}
              </h3>
              <p className="text-[11px] text-zinc-500 max-w-[260px] mt-1 leading-relaxed">
                {assistantMode === 'auto-rag'
                  ? 'Posez n’importe quelle question : les paragraphes correspondants seront extraits automatiquement des sermons pour construire la réponse.'
                  : 'Posez des questions sur les sermons et livres préalablement ajoutés au Dock IA ci-dessus.'}
              </p>
            </div>
          </div>
        ) : (
          history.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-3 duration-500 w-full`}>
              <div className={`max-w-[94%] p-4 rounded-[24px] relative group transition-all duration-300 ${
                msg.role === 'user' 
                  ? 'bg-teal-600 text-white rounded-tr-none shadow-xl shadow-teal-600/10 border border-teal-500/20' 
                  : 'bg-teal-50/60 dark:bg-teal-900/20 text-zinc-900 dark:text-zinc-100 border border-teal-100 dark:border-teal-800/50 rounded-tl-none'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="flex flex-col gap-2">
                    <div className="prose-styles text-[13px] leading-[1.75] serif-text [&_p]:my-2.5 [&_p]:leading-[1.75] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2.5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2.5 [&_ol]:space-y-1.5 [&_li]:my-1 [&_li]:leading-relaxed [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-black [&_h2]:mt-3.5 [&_h2]:mb-2 [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-bold [&_strong]:font-black text-zinc-900 dark:text-zinc-100" dangerouslySetInnerHTML={{ __html: formatAIResponse(msg.content) as string }} />
                    {msg.refusal && msg.closestPassages && msg.closestPassages.length > 0 && (
                      <RefusalPassagesBlock 
                        originalQuery={msg.originalQuery || ''}
                        passages={msg.closestPassages}
                        onForceSearch={handleForceSearch}
                      />
                    )}
                  </div>
                ) : (
                  editingIndex === i ? (
                    <div className="flex flex-col gap-2 w-full min-w-[220px]">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSaveEdit(i);
                          }
                        }}
                        autoFocus
                        className="w-full bg-teal-700/90 text-white border border-teal-300 rounded-xl p-2.5 text-[13px] font-bold outline-none resize-none leading-relaxed shadow-inner"
                        rows={2}
                      />
                      <div className="flex items-center justify-end gap-1.5 pt-0.5">
                        <button
                          onClick={handleCancelEdit}
                          className="px-2.5 py-1 rounded-lg bg-teal-800/90 hover:bg-teal-900 text-teal-100 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          <span>Annuler</span>
                        </button>
                        <button
                          onClick={() => handleSaveEdit(i)}
                          disabled={!editingText.trim()}
                          className="px-3 py-1 rounded-lg bg-white text-teal-900 hover:bg-teal-50 text-[10px] font-black transition-all flex items-center gap-1 shadow-xs cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          <span>Renvoyer</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 group/usermsg">
                      <p className="text-[13px] font-bold leading-relaxed tracking-tight break-words flex-1">{msg.content}</p>
                      <button
                        onClick={() => handleStartEdit(i, msg.content)}
                        data-tooltip="Rééditer cette question"
                        className="opacity-0 group-hover/usermsg:opacity-100 hover:opacity-100 p-1 text-teal-200 hover:text-white transition-opacity shrink-0 cursor-pointer rounded-md hover:bg-teal-500/20"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                )}

                {/* Sources vérifiées consultées (cliquables vers le lecteur) */}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-teal-600/10 flex flex-wrap gap-1.5">
                    <div className="flex items-center gap-1.5 w-full mb-1">
                      <BookOpen className="w-2.5 h-2.5 text-teal-600 dark:text-teal-400" />
                      <span className="text-[8px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest">
                        Passages de sermons consultés ({msg.sources.length}) :
                      </span>
                    </div>
                    {msg.sources.map((source, sIdx) => {
                      const isSermonUri = source.uri && source.uri.startsWith('sermon://');
                      if (isSermonUri || source.sermonId) {
                        const targetSermonId = source.sermonId || source.uri.replace('sermon://', '').split('/')[0];
                        const targetParaIndex = source.paragraphIndex || parseInt(source.uri.replace('sermon://', '').split('/')[1] || '1', 10);
                        
                        return (
                          <button
                            key={sIdx}
                            onClick={() => {
                              setSelectedSermonId(targetSermonId);
                              if (targetParaIndex) setJumpToParagraph(targetParaIndex);
                            }}
                            data-tooltip={`Ouvrir "${source.title}" dans le lecteur`}
                            className="flex items-center gap-1.5 px-2 py-1 bg-white/90 dark:bg-zinc-800/90 rounded-lg border border-teal-600/20 hover:border-teal-600/60 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-all text-[9px] font-bold text-teal-900 dark:text-teal-200 shadow-2xs cursor-pointer group/src"
                          >
                            <span className="max-w-[210px] truncate">{source.title}</span>
                            <BookOpen className="w-2.5 h-2.5 opacity-60 group-hover/src:opacity-100 text-teal-600 shrink-0" />
                          </button>
                        );
                      }

                      return (
                        <a 
                          key={sIdx}
                          href={source.uri} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-100 dark:border-zinc-700 hover:border-teal-600/30 transition-all text-[9px] font-bold text-zinc-500 hover:text-teal-600 shadow-2xs"
                        >
                          <span className="max-w-[140px] truncate">{source.title}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                        </a>
                      );
                    })}
                  </div>
                )}

                {/* Actions rapides sur la réponse assistant (Notes & Copie) */}
                {msg.role === 'assistant' && (
                  <div className="absolute -right-2 -bottom-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        addNotification("Réponse copiée dans le presse-papier", "success");
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 transition-all shadow-md border border-zinc-100 dark:border-zinc-700 cursor-pointer"
                      data-tooltip="Copier la réponse complète"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button 
                      onClick={() => setNoteSelectorData({ 
                        text: msg.content, 
                        sermon: { 
                          id: `ia-${Date.now()}`, 
                          title: assistantMode === 'auto-rag' ? 'Étude IA — RAG Sermons' : 'Réponse Assistant IA', 
                          date: new Date().toISOString().split('T')[0], 
                          city: 'Recherche Exégétique', 
                          text: '' 
                        } 
                      })} 
                      className="w-7 h-7 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 transition-all shadow-md border border-zinc-100 dark:border-zinc-700 cursor-pointer"
                      data-tooltip="Ajouter cette réponse au journal de notes"
                      data-tooltip-icon="notes"
                    >
                      <Notebook className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Pistes d'approfondissement interactives 1-clic */}
              {msg.role === 'assistant' && extractFollowUpQuestions(msg.content).length > 0 && (
                <div className="mt-2 flex flex-col gap-1 w-full pl-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <span className="text-[8px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> Pistes d'approfondissement suggérées :
                  </span>
                  <div className="flex flex-col gap-1 mt-0.5 max-w-[94%]">
                    {extractFollowUpQuestions(msg.content).map((q, qIdx) => (
                      <button
                        key={qIdx}
                        onClick={() => handleSend(q)}
                        className="text-left px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-zinc-800/80 border border-teal-600/20 hover:border-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/50 text-teal-900 dark:text-teal-200 text-[10.5px] font-semibold transition-all cursor-pointer shadow-2xs hover:shadow-xs flex items-center gap-1.5"
                      >
                        <span className="text-teal-600 font-bold shrink-0">💡</span>
                        <span className="truncate">{q}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mt-1.5 px-3 opacity-30">
                <span className="text-[7px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  {msg.role === 'user' ? 'Étudiant' : 'Assistant IA'} • {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
            </div>
          ))
        )}

        {isTyping && (
          <div className="flex items-center gap-3 text-teal-600 animate-pulse ml-2 py-2">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" style={{animationDelay: '0ms'}} />
              <div className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" style={{animationDelay: '200ms'}} />
              <div className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" style={{animationDelay: '400ms'}} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-teal-600">
              {typingStatus}
            </span>
          </div>
        )}
      </div>

      {/* Input Form */}
      <div className="p-3 bg-slate-50 dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800/50">
        <div className="relative flex items-end gap-2.5 bg-zinc-50 dark:bg-zinc-900/60 rounded-[22px] border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 focus-within:ring-4 focus-within:ring-teal-600/5 focus-within:border-teal-600/40 transition-all duration-300">
          <textarea
            className="flex-1 bg-transparent border-none text-[13px] font-medium text-zinc-900 dark:text-zinc-100 resize-none outline-none py-1 max-h-36 placeholder:text-zinc-400 placeholder:text-[9px] placeholder:uppercase placeholder:tracking-wider leading-relaxed"
            placeholder={
              assistantMode === 'auto-rag'
                ? "POSEZ UNE QUESTION SUR TOUS LES SERMONS..."
                : (contextSermonIds.length > 0 ? "POSEZ VOTRE QUESTION SUR LE DOCK..." : "SÉLECTIONNEZ DES SOURCES DANS LE DOCK")
            }
            rows={1}
            disabled={isTyping || (assistantMode === 'dock' && contextSermonIds.length === 0)}
            value={input}
            onChange={(e) => { 
              setInput(e.target.value); 
              e.target.style.height = 'auto'; 
              e.target.style.height = `${e.target.scrollHeight}px`; 
            }}
            onKeyDown={(e) => { 
              if (e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                handleSend(); 
              } 
            }}
          />
          {isTyping ? (
            <button 
              onClick={handleStop}
              className="w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded-[16px] transition-all shrink-0 shadow-md active:scale-95 cursor-pointer animate-pulse"
              data-tooltip="Arrêter la génération"
            >
              <Square className="w-3.5 h-3.5 fill-current text-white" />
            </button>
          ) : (
            <button 
              onClick={() => handleSend()}
              disabled={!input.trim() || (assistantMode === 'dock' && contextSermonIds.length === 0)}
              className="w-8 h-8 flex items-center justify-center bg-teal-600 text-white rounded-[16px] hover:bg-teal-700 disabled:opacity-20 transition-all shrink-0 shadow-md active:scale-95 cursor-pointer"
              data-tooltip="Envoyer la question"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
