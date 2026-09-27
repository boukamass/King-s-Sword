import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { askGeminiChat, GeminiSource } from '../services/geminiChatService';
import { analyzeSelectionContext } from '../services/studyService';
import { retrieveRelevantSermonPassages, formatRagContextForGemini, RetrievedParagraph } from '../services/sermonRagService';
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
import { Sermon, ChatMessage } from '../types';
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
  Undo2
} from 'lucide-react';

interface ChatMessageWithSources extends ChatMessage {
  sources?: GeminiSource[];
}

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
    toggleAI,
    pendingStudyRequest,
    triggerStudyRequest,
    assistantMode,
    setAssistantMode,
    languageFilter,
    setSelectedSermonId,
    setJumpToText,
    setJumpToParagraph,
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

  // Transforme les balises de référence [Réf: ID_SERMON, Para. N] en liens interactifs cliquables
  const formatAIResponse = (text: string) => {
    const formattedText = text.replace(/\[Réf:\s*([a-zA-Z0-9_-]+)(?:,\s*Para\.?\s*(\d+))?\]/gi, (match, sermonId, paraNum) => {
      const cleanId = (sermonId || '').trim();
      const pNum = paraNum ? parseInt(paraNum, 10) : 1;
      
      // Recherche du sermon dans les métadonnées (exact ou avec préfixe de date/version)
      const foundSermon = 
        selectedSermonsMetadata.find(s => s.id === cleanId || s.id.startsWith(cleanId) || cleanId.startsWith(s.id)) ||
        sermons.find(s => s.id === cleanId || s.id.startsWith(cleanId) || cleanId.startsWith(s.id));

      const titleDisplay = foundSermon ? `${foundSermon.title} (${foundSermon.date})` : cleanId;
      const targetId = foundSermon ? foundSermon.id : cleanId;

      return `<a href="#" data-sermon-id="${targetId}" data-para-num="${pNum}" class="sermon-ref inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-600/10 dark:bg-teal-400/15 text-teal-800 dark:text-teal-200 rounded-md text-[9px] font-black hover:bg-teal-600/25 transition-all border border-teal-600/20 mx-1 align-middle shadow-xs cursor-pointer"><span>📖 §${pNum} — ${titleDisplay}</span></a>`;
    });
    return marked(formattedText, { breaks: true });
  };
  
  // Gestion du clic sur une référence ou un lien interne vers un sermon
  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a.sermon-ref, [data-sermon-id]') as HTMLElement;
    if (link && link.dataset.sermonId) {
      e.preventDefault();
      const sId = link.dataset.sermonId;
      const paraNumStr = link.dataset.paraNum;
      
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

  // Envoi d'une question par l'utilisateur
  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    
    // En mode Dock, vérifier qu'au moins une ressource a été sélectionnée
    if (assistantMode === 'dock' && contextSermonIds.length === 0) {
      addNotification("Veuillez sélectionner au moins un sermon ou une ressource dans le Dock IA.", "error");
      return;
    }

    const msg = input.trim();
    setInput('');

    // Mise à jour automatique du titre de la conversation si c'est encore "Nouvelle discussion"
    if (currentConversation.title === 'Nouvelle discussion') {
      const cleanTitle = msg.length > 34 ? msg.slice(0, 34) + '...' : msg;
      setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, title: cleanTitle, updatedAt: new Date().toISOString() } : c));
    }

    addChatMessage(chatKey, { role: 'user', content: msg, timestamp: new Date().toISOString() });
    setIsTyping(true);

    try {
      if (assistantMode === 'auto-rag') {
        // ==============================================================
        // MODE RAG AUTOMATIQUE SUR L'ENSEMBLE DES SERMONS
        // ==============================================================
        setTypingStatus("Recherche des passages pertinents dans les sermons...");
        
        const ragResult = await retrieveRelevantSermonPassages(msg, {
          maxParagraphs: 8,
          minScoreThreshold: 10
        });

        // Cas où aucun passage pertinent n'est identifié
        if (!ragResult.hasResults || ragResult.paragraphs.length === 0) {
          const noResultMsg: ChatMessageWithSources = {
            role: 'assistant',
            content: `🔍 **Aucun passage pertinent n'a été trouvé dans les sermons disponibles pour :** *"${msg}"*.\n\nLes termes doctrinaux analysés (*${ragResult.keywordsUsed.join(', ') || 'aucun'}*) ne correspondent à aucun extrait significatif dans la bibliothèque actuelle. Vous pouvez reformuler votre question avec des termes doctrinaux plus spécifiques ou ajouter manuellement des sermons dans le Dock IA.`,
            timestamp: new Date().toISOString(),
          };
          addChatMessage(chatKey, noResultMsg);
          return;
        }

        setTypingStatus(`Analyse théologique de ${ragResult.paragraphs.length} extrait(s) retrouvé(s)...`);

        const formattedContext = formatRagContextForGemini(ragResult.paragraphs, msg);

        // Appel direct RAG à Gemini basé exclusivement sur les sermons internes
        const { text, sources } = await askGeminiChat(msg, formattedContext, history, {
          mode: 'auto-rag',
          retrievedParagraphs: ragResult.paragraphs
        });

        const newMessage: ChatMessageWithSources = { 
          role: 'assistant', 
          content: text, 
          timestamp: new Date().toISOString(),
          sources: sources.length > 0 ? sources : undefined
        };
        addChatMessage(chatKey, newMessage);

      } else {
        // ==============================================================
        // MODE DOCK IA (DOCUMENTS CHOISIS MANUELLEMENT)
        // ==============================================================
        setTypingStatus("Lecture des ressources du Dock IA...");
        const validSermons = await getFullSermons(contextSermonIds);
        const ctx = validSermons.map(s => {
          const numberedText = s.text.split(/\n\s*\n/)
                .map((p, i) => `[Para. ${i + 1}] ${p.trim()}`)
                .join('\n');
          return `[DOC ID: ${s.id}] - TITRE: ${s.title} (${s.date})\nCONTENU:\n${numberedText.substring(0, 15000)}`;
        }).join('\n\n---\n\n');
        
        setTypingStatus("Génération de l'exégèse...");
        const { text, sources } = await askGeminiChat(msg, ctx, history, { mode: 'dock' });
        
        const newMessage: ChatMessageWithSources = { 
          role: 'assistant', 
          content: text, 
          timestamp: new Date().toISOString(),
          sources: sources.length > 0 ? sources : undefined
        };
        addChatMessage(chatKey, newMessage);
      }
    } catch (e: any) {
      let displayMessage = e?.message || "Une erreur est survenue lors de l'analyse.";
      if (displayMessage.includes("Failed to call the Gemini API")) {
        displayMessage = "❌ Impossible de joindre les serveurs Google Gemini. Veuillez vérifier votre connexion Internet ou votre clé API.";
      }
      addChatMessage(chatKey, { 
        role: 'assistant', 
        content: displayMessage, 
        timestamp: new Date().toISOString() 
      });
    } finally {
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
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-zinc-50 leading-none group-hover/ai-title:text-teal-600 transition-colors">ASSISTANT IA</h2>
        </div>
        
        <div className="flex items-center gap-1.5">
          {/* Bouton Nouveau Chat (+) */}
          <button 
            onClick={handleCreateNewChat}
            data-tooltip="Nouveau chat (+)"
            className="w-7 h-7 flex items-center justify-center text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/50 hover:bg-teal-100 dark:hover:bg-teal-900/50 border border-teal-200 dark:border-teal-800 transition-all rounded-lg active:scale-95 cursor-pointer shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>

          {/* Bouton Liste des discussions */}
          <button 
            onClick={() => setIsConversationsDrawerOpen(prev => !prev)}
            data-tooltip="Toutes les discussions"
            className={`w-7 h-7 flex items-center justify-center transition-all rounded-lg border active:scale-90 cursor-pointer ${
              isConversationsDrawerOpen 
                ? 'bg-teal-600 text-white border-teal-600 shadow-xs' 
                : 'text-zinc-500 hover:text-teal-600 bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>

          {/* Bouton Effacer la discussion courante */}
          {history.length > 0 && (
            <button 
              onClick={() => handleClearChat(activeConvId)}
              data-tooltip="Effacer cette discussion"
              data-tooltip-icon="trash"
              className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 active:scale-90 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button 
            onClick={() => setIsApiKeyModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all border ${
              hasKey 
                ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' 
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 animate-pulse'
            }`}
            data-tooltip="Configurer ma clé Google Gemini"
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

        <button
          onClick={handleCreateNewChat}
          data-tooltip="Créer un nouveau chat (+)"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-bold shadow-xs active:scale-95 cursor-pointer shrink-0"
        >
          <Plus className="w-3 h-3 stroke-[2.5]" />
          <span>Nouveau</span>
        </button>
      </div>

      {/* Tiroir déroulant de gestion des conversations multiples */}
      {isConversationsDrawerOpen && (
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl space-y-2.5 z-30 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between pb-1 border-b border-zinc-100 dark:border-zinc-800">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
              Discussions sauvegardées ({conversations.length})
            </span>
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Disponible hors-ligne
            </span>
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

      {/* Connection & Engine Status Banner */}
      <div className="px-5 py-2 bg-zinc-100/70 dark:bg-zinc-900/60 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
              <Wifi className="w-3 h-3" />
              <span>En ligne</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
              <WifiOff className="w-3 h-3" />
              <span>Hors-ligne</span>
            </span>
          )}
          <span className="text-zinc-300 dark:text-zinc-700">•</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {isOnline && hasKey ? 'Moteur : Gemini Flash' : 'Moteur : Index Local'}
          </span>
        </div>
        <button 
          onClick={() => setIsApiKeyModalOpen(true)}
          data-tooltip="Gérer les clés API Google Gemini"
          className="text-teal-600 dark:text-teal-400 hover:underline font-bold text-[9px] uppercase tracking-wider"
        >
          {hasKey ? 'Gérer' : '+ Clé Google'}
        </button>
      </div>

      {/* Sélecteur de Mode : Bibliothèque Entière (Auto RAG) vs Dock IA (Manuel) */}
      <div className="p-2 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white/40 dark:bg-zinc-900/40">
        <div className="flex p-1 bg-zinc-200/70 dark:bg-zinc-800/70 rounded-xl gap-1">
          <button
            onClick={() => setAssistantMode('auto-rag')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              assistantMode === 'auto-rag'
                ? 'bg-white dark:bg-zinc-900 text-teal-700 dark:text-teal-300 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
            data-tooltip="Recherche automatique dans tous les sermons de la bibliothèque"
          >
            <Library className="w-3.5 h-3.5 text-teal-600" />
            <span>Tous les sermons (Auto RAG)</span>
          </button>
          
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

        {assistantMode === 'auto-rag' ? (
          <div className="mt-1.5 px-2 flex items-center justify-between text-[9px] text-zinc-500">
            <span className="flex items-center gap-1">
              <Search className="w-2.5 h-2.5 text-teal-600" />
              Recherche FTS5 automatique sur l'ensemble des sermons
            </span>
            <span className="font-semibold text-teal-600 dark:text-teal-400">
              {sermons.length} sermons indexés
            </span>
          </div>
        ) : (
          <div className="mt-2 shrink-0">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Sources Dock ({selectedSermonsMetadata.length})
              </span>
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
                  Aucun sermon dans le dock. Ajoutez-en un depuis la bibliothèque ou basculez sur "Tous les sermons".
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
                {msg.role === 'assistant' 
                  ? <div className="prose-styles text-[13px] leading-relaxed serif-text" dangerouslySetInnerHTML={{ __html: formatAIResponse(msg.content) as string }} />
                  : <p className="text-[13px] font-bold leading-relaxed tracking-tight break-words">{msg.content}</p>
                }

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

                {/* Bouton d'export vers le journal de notes */}
                {msg.role === 'assistant' && (
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
                    className="absolute -right-2 -bottom-2 w-8 h-8 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-all shadow-xl border border-zinc-100 dark:border-zinc-700 z-10 cursor-pointer"
                    data-tooltip="Ajouter cette réponse au journal de notes"
                    data-tooltip-icon="notes"
                  >
                    <Notebook className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
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
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isTyping || (assistantMode === 'dock' && contextSermonIds.length === 0)}
            className="w-8 h-8 flex items-center justify-center bg-teal-600 text-white rounded-[16px] hover:bg-teal-700 disabled:opacity-20 transition-all shrink-0 shadow-md active:scale-95 cursor-pointer"
            data-tooltip="Envoyer la question"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
