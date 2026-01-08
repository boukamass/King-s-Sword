
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { askGeminiChat } from '../services/geminiChatService';
import { analyzeSelectionContext } from '../services/studyService';
import { getSermonById } from '../services/db';
import { translations } from '../translations';
import { marked } from 'marked';
import NoteSelectorModal from './NoteSelectorModal';
import { Sermon } from '../types';
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
  Zap
} from 'lucide-react';

const AIAssistant: React.FC = () => {
  const { 
    contextSermonIds, 
    selectedSermonId,
    toggleContextSermon,
    clearContextSermons,
    sermons, 
    chatHistory, 
    addChatMessage, 
    toggleAI,
    pendingStudyRequest,
    triggerStudyRequest,
    languageFilter,
    setSelectedSermonId,
    setJumpToText,
    aiWidth
  } = useAppStore();
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [noteSelectorData, setNoteSelectorData] = useState<{ text: string; sermon: Sermon } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  
  const chatKey = contextSermonIds.join(',') || 'global';
  const history = chatHistory[chatKey] || [];
  
  const selectedSermonsMetadata = useMemo(() => 
    sermons.filter(s => contextSermonIds.includes(s.id)),
    [sermons, contextSermonIds]
  );

  const formatAIResponse = (text: string) => {
    // Regex pour capturer les références [Réf: ID, Para. N] et les transformer en liens riches
    const formattedText = text.replace(/\[Réf:\s*([\w-]+),\s*Para\.\s*(\d+)\s*\]/gi, (match, sermonId, paraNum) => {
      const sermon = sermons.find(s => s.id === sermonId);
      if (sermon) {
        // Inclusion du numéro de paragraphe, titre et date dans le lien
        return `<a href="#" data-sermon-id="${sermonId}" class="sermon-ref inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-600/5 dark:bg-teal-400/10 text-teal-700 dark:text-teal-300 rounded-md text-[9px] font-black hover:bg-teal-600/20 transition-all border border-teal-600/10 mx-1 align-middle shadow-sm"><span>Para. ${paraNum} - ${sermon.title} (${sermon.date})</span></a>`;
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
        if (sermons.some(s => s.id === sermonId)) {
            setSelectedSermonId(sermonId);

            const blockquote = link.closest('blockquote');
            if (blockquote) {
                const quoteClone = blockquote.cloneNode(true) as HTMLElement;
                quoteClone.querySelectorAll('a.sermon-ref').forEach(a => a.remove()); // Remove ref link from text
                const text = quoteClone.textContent?.trim();
                if (text) setJumpToText(text);
            } else {
                // Fallback for safety
                const parent = link.closest('p, li');
                if (parent) {
                    const text = parent.textContent?.replace(/\[.*?\]/g, '').trim();
                    if (text) setJumpToText(text);
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

  useEffect(() => {
    if (pendingStudyRequest && contextSermonIds.length > 0) {
      handleAutoStudy(pendingStudyRequest);
      triggerStudyRequest(null);
    }
  }, [pendingStudyRequest]);

  const handleAutoStudy = async (text: string) => {
    setIsTyping(true);
    addChatMessage(chatKey, { role: 'user', content: `Analyser : "${text}"`, timestamp: new Date().toISOString() });
    
    try {
      const fullSermons = await Promise.all(contextSermonIds.map(id => getSermonById(id)));
      const validSermons = fullSermons.filter((s): s is Sermon => !!s);
      const mainSermon = validSermons.find(s => s.id === selectedSermonId) || validSermons[0];

      if (!mainSermon) throw new Error("Aucun sermon sélectionné.");

      const r = await analyzeSelectionContext(text, mainSermon, validSermons);
      addChatMessage(chatKey, { role: 'assistant', content: r, timestamp: new Date().toISOString() });
    } catch (e: any) {
      addChatMessage(chatKey, { role: 'assistant', content: `Erreur d'analyse contextuelle : ${e.message}`, timestamp: new Date().toISOString() });
    } finally { setIsTyping(false); }
  };

  const handleSend = async () => {
    if (!input.trim() || contextSermonIds.length === 0) return;
    const msg = input;
    setInput('');
    addChatMessage(chatKey, { role: 'user', content: msg, timestamp: new Date().toISOString() });
    setIsTyping(true);
    try {
      const fullSermons = await Promise.all(contextSermonIds.map(id => getSermonById(id)));
      const validSermons = fullSermons.filter((s): s is Sermon => !!s);

      const ctx = validSermons.map(s => {
        const numberedText = s.text
          ? s.text.split(/\n\s*\n/)
              .map((p, i) => `[Para. ${i + 1}] ${p.trim()}`)
              .join('\n')
          : '';
        return `[DOC ID: ${s.id}] - TITRE: ${s.title} (${s.date})\nCONTENU:\n${numberedText.substring(0, 18000)}`;
      }).join('\n\n---\n\n');
      
      const r = await askGeminiChat(msg, ctx, history);
      addChatMessage(chatKey, { role: 'assistant', content: r, timestamp: new Date().toISOString() });
    } catch (e: any) {
       addChatMessage(chatKey, { role: 'assistant', content: e.message, timestamp: new Date().toISOString() });
    } finally { setIsTyping(false); }
  };

  return (
    <div className="w-full bg-white dark:bg-zinc-950 h-full flex flex-col min-w-0 border-l border-zinc-200 dark:border-zinc-800 transition-all duration-500 shadow-2xl relative">
      {noteSelectorData && <NoteSelectorModal selectionText={noteSelectorData.text} sermon={noteSelectorData.sermon} onClose={() => setNoteSelectorData(null)} />}
      
      {/* Header Premium Interactif */}
      <div className="px-6 h-14 border-b border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-3xl z-50">
        <button 
          onClick={toggleAI}
          className="flex items-center gap-3 group active:scale-95 transition-all outline-none"
        >
          <div className="w-7 h-7 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-lg shadow-teal-600/5 group-hover:bg-teal-600 group-hover:text-white transition-all duration-500">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex flex-col items-start">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-zinc-50 group-hover:text-teal-600 transition-colors leading-none">ASSISTANT IA</h2>
            <div className="flex items-center gap-1.5 mt-1 opacity-60">
               <div className="w-1 h-1 bg-teal-500 rounded-full animate-pulse" />
               <span className="text-[7px] font-bold text-teal-600 dark:text-blue-400 uppercase tracking-widest leading-none">Exégèse en temps réel</span>
            </div>
          </div>
        </button>
        <button onClick={toggleAI} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 active:scale-90">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Resources Dock - Premium Glassmorphism */}
      <div className="shrink-0 bg-zinc-50/50 dark:bg-zinc-900/40 border-b border-zinc-100 dark:border-zinc-800/50 px-5 py-3">
         <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2 opacity-50">
               <Layers className="w-3 h-3 text-teal-600" />
               <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">Ressources en Mémoire ({selectedSermonsMetadata.length})</span>
            </div>
            {contextSermonIds.length > 0 && (
              <button onClick={clearContextSermons} className="text-[8px] font-black text-red-500 hover:text-red-600 uppercase tracking-widest transition-colors">Vider le dock</button>
            )}
         </div>

         <div className="flex gap-2.5 overflow-x-auto pb-1.5 custom-scrollbar no-scrollbar-buttons pr-2">
            {selectedSermonsMetadata.length > 0 ? (
              selectedSermonsMetadata.map((s) => {
                const isActive = s.id === selectedSermonId;
                return (
                  <div key={s.id} className={`flex-shrink-0 w-[180px] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border rounded-xl p-2.5 shadow-sm relative group animate-in slide-in-from-right-3 duration-500 ${isActive ? 'border-teal-600/40 ring-1 ring-teal-600/10' : 'border-zinc-200 dark:border-zinc-700'}`}>
                     <div className="flex items-start gap-2.5">
                        <div className={`w-7 h-7 flex items-center justify-center rounded-lg border shrink-0 ${isActive ? 'bg-teal-600/20 border-teal-600/30' : 'bg-teal-600/5 dark:bg-teal-600/10 border-teal-600/10'}`}>
                           <BookOpen className={`w-3 h-3 ${isActive ? 'text-teal-700 dark:text-teal-400' : 'text-teal-600'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                           <div className="flex items-center gap-1.5">
                             <p className="text-[9px] font-black text-zinc-800 dark:text-zinc-100 truncate leading-tight tracking-tight">{s.title}</p>
                             {isActive && <div className="w-1.5 h-1.5 bg-teal-600 rounded-full shrink-0" title="Sermon actuellement ouvert (Auto)" />}
                           </div>
                           <p className="text-[7px] font-bold text-zinc-400 mt-0.5 uppercase tracking-tighter">{s.date} {isActive ? '• OUVERT' : ''}</p>
                        </div>
                     </div>
                     {!isActive && (
                       <button 
                        onClick={() => toggleContextSermon(s.id)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-full flex items-center justify-center text-zinc-400 hover:text-red-500 shadow-md opacity-0 group-hover:opacity-100 transition-all active:scale-90"
                       >
                         <MinusCircle className="w-3 h-3" />
                       </button>
                     )}
                  </div>
                );
              })
            ) : (
              <div className="w-full py-4 flex flex-col items-center justify-center border-2 border-dashed border-zinc-200/50 dark:border-zinc-800/50 rounded-xl opacity-30">
                 <Library className="w-5 h-5 mb-1.5 text-zinc-300" />
                 <p className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-400">En attente de sources...</p>
              </div>
            )}
         </div>
      </div>

      {/* Chat Space */}
      <div 
        ref={scrollRef} 
        className="flex-1 overflow-y-auto px-6 py-8 space-y-10 custom-scrollbar bg-white dark:bg-zinc-950 flex flex-col scroll-smooth transition-colors duration-500"
        onClick={handleContentClick}
      >
        {history.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-10 space-y-6">
            <div className="relative">
                <div className="absolute inset-0 bg-teal-600/10 blur-3xl rounded-full scale-150 animate-pulse" />
                <Sparkles className="w-16 h-16 stroke-[1] text-teal-600 relative" />
            </div>
            <div className="space-y-3">
                <p className="text-[11px] font-black uppercase tracking-[0.5em] text-zinc-900 dark:text-zinc-50">Prêt pour l'Exégèse</p>
                <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest max-w-[200px] mx-auto leading-relaxed">L'intelligence artificielle analyse le contexte de vos sermons sélectionnés.</p>
            </div>
          </div>
        )}
        
        {history.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-3 duration-700 w-full`}>
            <div className={`max-w-[94%] p-5 rounded-[28px] relative group transition-all duration-300 ${
              msg.role === 'user' 
                ? 'bg-teal-600 text-white rounded-tr-none shadow-xl shadow-teal-600/10 border border-teal-500/20' 
                : 'bg-teal-50/50 dark:bg-teal-900/20 text-zinc-900 dark:text-zinc-100 border border-teal-100 dark:border-teal-800/50 rounded-tl-none shadow-sm'
            }`}>
              {msg.role === 'assistant' 
                ? <div className="prose-styles text-[13px] leading-relaxed serif-text selection:bg-teal-500/20" dangerouslySetInnerHTML={{ __html: formatAIResponse(msg.content) as string }} />
                : <p className="text-[13px] font-bold leading-relaxed tracking-tight break-words">{msg.content}</p>
              }
              {msg.role === 'assistant' && (
                 <button 
                  onClick={() => setNoteSelectorData({ text: msg.content, sermon: { id: `ia-${Date.now()}`, title: 'Réponse Assistant IA', date: new Date().toISOString().split('T')[0], city: 'King\'s Sword', text: '' } })} 
                  className="absolute -right-2 -bottom-2 w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-all shadow-xl border border-zinc-100 dark:border-zinc-700 z-10 active:scale-90"
                  title="Ajouter au journal"
                 >
                    <Notebook className="w-3.5 h-3.5" />
                 </button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-3 px-3 opacity-30">
              <span className="text-[7px] font-black uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
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
            <span className="text-[8px] font-black uppercase tracking-[0.4em] text-teal-600">Réflexion scripturaire...</span>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800/50 no-print">
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
            className="w-9 h-9 flex items-center justify-center bg-teal-600 text-white rounded-[18px] hover:bg-teal-700 disabled:opacity-20 transition-all shrink-0 shadow-2xl shadow-teal-600/30 active:scale-90"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
