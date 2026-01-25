
// Fix: Added React to imports to resolve "Cannot find namespace 'React'" errors for React.FC and React.MouseEvent
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { askGeminiChat } from '../services/geminiChatService';
import { analyzeSelectionContext } from '../services/studyService';
import { getSermonById } from '../services/db';
import { translations } from '../translations';
import { marked } from 'marked';
import NoteSelectorModal from './NoteSelectorModal';
import { Sermon, ChatMessage } from '../types';
import { 
  Sparkles, 
  X, 
  Send, 
  Notebook, 
  BookOpen,
  Trash2,
  Layers,
  MinusCircle,
  Hash,
  Library,
  Zap,
  Globe,
  ExternalLink
} from 'lucide-react';

interface ChatMessageWithSources extends ChatMessage {
  sources?: { title: string; uri: string }[];
}

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
  const [noteSelectorData, setNoteSelectorData] = useState<{ text: string; sermon: Sermon } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  
  const chatKey = contextSermonIds.join(',') || 'global';
  const history = (chatHistory[chatKey] || []) as ChatMessageWithSources[];
  
  const selectedSermonsMetadata = useMemo(() => {
    const uniqueMap = new Map<string, any>();
    sermons.forEach(s => {
      if (contextSermonIds.includes(s.id)) {
        uniqueMap.set(s.id, s);
      }
    });
    return Array.from(uniqueMap.values());
  }, [sermons, contextSermonIds]);

  const formatAIResponse = (text: string) => {
    const formattedText = text.replace(/\[Réf:\s*([\w-]+),\s*Para\.\s*(\d+)\s*\]/gi, (match, sermonId, paraNum) => {
      const sermon = sermons.find(s => s.id === sermonId);
      if (sermon) {
        return `<a href="#" data-sermon-id="${sermonId}" data-para-num="${paraNum}" class="sermon-ref inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-600/5 dark:bg-teal-400/10 text-teal-700 dark:text-teal-300 rounded-md text-[9px] font-black hover:bg-teal-600/20 transition-all border border-teal-600/10 mx-1 align-middle shadow-sm"><span>Para. ${paraNum} - ${sermon.title} (${sermon.date})</span></a>`;
      }
      return match;
    });
    return marked(formattedText, { breaks: true });
  };
  
  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a.sermon-ref');
    if (link instanceof HTMLAnchorElement && link.dataset.sermonId) {
        e.preventDefault();
        const sermonId = link.dataset.sermonId;
        const paraNumStr = link.dataset.paraNum;
        
        if (sermons.some(s => s.id === sermonId)) {
            setSelectedSermonId(sermonId);
            if (paraNumStr) {
                const num = parseInt(paraNumStr);
                if (!isNaN(num)) {
                    setJumpToParagraph(num);
                    return;
                }
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
      if (!isSqliteAvailable) {
        return sermonsMap.get(id) as Sermon;
      }
      return await getSermonById(id);
    }));
    return results.filter((s): s is Sermon => !!s && !!s.text);
  };

  // Gestion automatique du bouton "Étudier"
  useEffect(() => {
    if (pendingStudyRequest && activeSermon) {
      const textToStudy = pendingStudyRequest;
      // On réinitialise immédiatement la demande pour éviter les boucles
      triggerStudyRequest(null);

      const performStudy = async () => {
        setIsTyping(true);
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
          addNotification(e.message, 'error');
        } finally {
          setIsTyping(false);
        }
      };
      performStudy();
    }
  }, [pendingStudyRequest, activeSermon, chatKey, t.ai_deep_study]);

  const handleSend = async () => {
    if (!input.trim() || contextSermonIds.length === 0) return;
    const msg = input;
    setInput('');
    addChatMessage(chatKey, { role: 'user', content: msg, timestamp: new Date().toISOString() });
    setIsTyping(true);
    try {
      const validSermons = await getFullSermons(contextSermonIds);
      const ctx = validSermons.map(s => {
        const numberedText = s.text.split(/\n\s*\n/)
              .map((p, i) => `[Para. ${i + 1}] ${p.trim()}`)
              .join('\n');
        return `[DOC ID: ${s.id}] - TITRE: ${s.title} (${s.date})\nCONTENU:\n${numberedText.substring(0, 15000)}`;
      }).join('\n\n---\n\n');
      
      const { text, sources } = await askGeminiChat(msg, ctx, history);
      
      const newMessage: ChatMessageWithSources = { 
        role: 'assistant', 
        content: text, 
        timestamp: new Date().toISOString(),
        sources: sources.length > 0 ? sources : undefined
      };
      
      addChatMessage(chatKey, newMessage);
    } catch (e: any) {
       addChatMessage(chatKey, { role: 'assistant', content: e.message, timestamp: new Date().toISOString() });
       addNotification(e.message, 'error');
    } finally { setIsTyping(false); }
  };

  return (
    <div className="w-full bg-white dark:bg-zinc-950 h-full flex flex-col min-w-0 border-l border-zinc-200 dark:border-zinc-800 transition-all duration-500 shadow-2xl relative">
      {noteSelectorData && <NoteSelectorModal selectionText={noteSelectorData.text} sermon={noteSelectorData.sermon} onClose={() => setNoteSelectorData(null)} />}
      
      <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-3xl z-50">
        <div 
          onClick={toggleAI}
          className="flex items-center gap-3 cursor-pointer group/ai-title hover:opacity-80 transition-all active:scale-95"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-lg group-hover/ai-title:border-teal-600/40 transition-all">
            <Sparkles className="w-4 h-4" />
          </div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-zinc-50 leading-none group-hover/ai-title:text-teal-600 transition-colors">ASSISTANT IA</h2>
        </div>
        <button onClick={toggleAI} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 active:scale-90">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="shrink-0 bg-zinc-50/50 dark:bg-zinc-900/40 border-b border-zinc-100 dark:border-zinc-800/50 px-5 py-3">
         <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">Ressources en Mémoire ({selectedSermonsMetadata.length})</span>
            {contextSermonIds.length > 0 && (
              <button onClick={clearContextSermons} className="text-[8px] font-black text-red-500 hover:text-red-600 uppercase tracking-widest transition-colors">Vider le dock</button>
            )}
         </div>

         <div className="flex gap-2.5 overflow-x-auto pb-1.5 custom-scrollbar pr-2">
            {selectedSermonsMetadata.map((s) => (
              <div key={s.id} className="flex-shrink-0 w-[180px] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-zinc-200 dark:border-zinc-700 rounded-xl p-2.5 shadow-sm relative group">
                 <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/10 shrink-0">
                       <BookOpen className="w-3 h-3 text-teal-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                       <p className="text-[9px] font-black text-zinc-800 dark:text-zinc-100 truncate leading-tight tracking-tight">{s.title}</p>
                       <p className="text-[7px] font-bold text-zinc-400 mt-0.5 uppercase tracking-tighter">{s.date}</p>
                    </div>
                 </div>
              </div>
            ))}
         </div>
      </div>

      <div 
        ref={scrollRef} 
        className="flex-1 overflow-y-auto px-6 py-8 space-y-10 custom-scrollbar bg-white dark:bg-zinc-950 flex flex-col scroll-smooth transition-colors duration-500"
        onClick={handleContentClick}
      >
        {history.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-3 duration-700 w-full`}>
            <div className={`max-w-[94%] p-5 rounded-[28px] relative group transition-all duration-300 ${
              msg.role === 'user' 
                ? 'bg-teal-600 text-white rounded-tr-none shadow-xl shadow-teal-600/10 border border-teal-500/20' 
                : 'bg-teal-50/50 dark:bg-teal-900/20 text-zinc-900 dark:text-zinc-100 border border-teal-100 dark:border-teal-800/50 rounded-tl-none'
            }`}>
              {msg.role === 'assistant' 
                ? <div className="prose-styles text-[13px] leading-relaxed serif-text" dangerouslySetInnerHTML={{ __html: formatAIResponse(msg.content) as string }} />
                : <p className="text-[13px] font-bold leading-relaxed tracking-tight break-words">{msg.content}</p>
              }

              {msg.role === 'assistant' && msg.sources && (
                <div className="mt-4 pt-4 border-t border-teal-600/10 flex flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 w-full mb-1">
                    <Globe className="w-2.5 h-2.5 text-teal-600" />
                    <span className="text-[8px] font-black text-teal-600 uppercase tracking-widest">Sources consultées</span>
                  </div>
                  {msg.sources.map((source, sIdx) => (
                    <a 
                      key={sIdx}
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-100 dark:border-zinc-700 hover:border-teal-600/30 transition-all text-[9px] font-bold text-zinc-500 hover:text-teal-600 shadow-sm"
                    >
                      <span className="max-w-[120px] truncate">{source.title}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                    </a>
                  ))}
                </div>
              )}

              {msg.role === 'assistant' && (
                 <button 
                  onClick={() => setNoteSelectorData({ text: msg.content, sermon: { id: `ia-${Date.now()}`, title: 'Réponse Assistant IA', date: new Date().toISOString().split('T')[0], city: 'Grounding Search', text: '' } })} 
                  className="absolute -right-2 -bottom-2 w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-all shadow-xl border border-zinc-100 dark:border-zinc-700 z-10"
                  title="Ajouter au journal"
                 >
                    <Notebook className="w-3.5 h-3.5" />
                 </button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 px-3 opacity-30">
              <span className="text-[7px] font-black uppercase tracking-[0.3em] text-zinc-500">
                {msg.role === 'user' ? 'Étudiant' : 'Assistant IA'} • {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </span>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-3 text-teal-600 animate-pulse ml-3">
            <div className="flex gap-1">
                <div className="w-1 h-1 bg-teal-600 rounded-full animate-bounce" style={{animationDelay: '0ms'}} />
                <div className="w-1 h-1 bg-teal-600 rounded-full animate-bounce" style={{animationDelay: '200ms'}} />
                <div className="w-1 h-1 bg-teal-600 rounded-full animate-bounce" style={{animationDelay: '400ms'}} />
            </div>
            <span className="text-[8px] font-black uppercase tracking-[0.4em] text-teal-600">Recherche bibliographique...</span>
          </div>
        )}
      </div>

      <div className="p-4 bg-white dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800/50">
        <div className="relative flex items-end gap-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-[24px] border border-zinc-200 dark:border-zinc-800 px-4 py-3 focus-within:ring-4 focus-within:ring-teal-600/5 focus-within:border-teal-600/40 transition-all duration-500">
          <textarea
            className="flex-1 bg-transparent border-none text-[13px] font-medium text-zinc-900 dark:text-zinc-100 resize-none outline-none py-1 max-h-40 placeholder:text-zinc-400 placeholder:text-[8px] placeholder:uppercase placeholder:tracking-[0.3em]"
            placeholder={contextSermonIds.length > 0 ? "POSEZ VOTRE QUESTION..." : "SÉLECTIONNEZ DES SOURCES D'ABORD"}
            rows={1}
            disabled={contextSermonIds.length === 0 || isTyping}
            value={input}
            onChange={(e) => { 
              setInput(e.target.value); 
              e.target.style.height = 'auto'; 
              e.target.style.height = `${e.target.scrollHeight}px`; 
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || contextSermonIds.length === 0 || isTyping}
            className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-[18px] hover:bg-teal-700 disabled:opacity-20 transition-all shrink-0 shadow-lg active:scale-90"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
