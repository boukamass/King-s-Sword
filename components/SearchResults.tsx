
import React, { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { useAppStore, SearchResult } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { getSermonById } from '../services/db';
import NoteSelectorModal from './NoteSelectorModal';
import { jsPDF } from 'jspdf';
import { Printer, FileText, NotebookPen, Loader2, Calendar, Search, X } from 'lucide-react';

const RESULTS_PER_PAGE = 20;

const SearchResultCard = memo(({ 
    result, 
    index, 
    searchQuery, 
    searchMode, 
    onClick, 
    onAddNote 
}: { 
    result: SearchResult; 
    index: number; 
    searchQuery: string; 
    searchMode: SearchMode;
    onClick: () => void;
    onAddNote: (e: React.MouseEvent) => void;
}) => {
    const [snippet, setSnippet] = useState<string | null>(result.snippet || null);
    const [isLoading, setIsLoading] = useState(!result.snippet);

    useEffect(() => {
        if (!snippet) {
            getSermonById(result.sermonId).then(s => {
                if (s && s.text) {
                    const paragraphs = s.text.split(/\n\s*\n/);
                    const p = paragraphs[result.paragraphIndex - 1] || "";
                    setSnippet(p.trim());
                }
                setIsLoading(false);
            });
        }
    }, [result.sermonId, result.paragraphIndex, snippet]);

    return (
        <div 
            onClick={onClick}
            className="group bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-[32px] p-8 shadow-sm hover:shadow-2xl hover:border-teal-500/30 transition-all duration-500 cursor-pointer relative"
        >
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <span className="text-[10px] font-mono font-black text-teal-600 bg-teal-600/5 px-4 py-1.5 rounded-full border border-teal-600/10">
                        #{index + 1}
                    </span>
                    <h3 className="text-[14px] font-black text-zinc-800 dark:text-zinc-100 group-hover:text-teal-600 transition-colors uppercase tracking-tight">
                        {result.title}
                    </h3>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 font-mono italic opacity-70">
                        <Calendar className="w-3 h-3" />
                        {result.date}
                    </div>
                    <button 
                        onClick={onAddNote}
                        className="w-8 h-8 flex items-center justify-center bg-zinc-50 dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 rounded-lg border border-zinc-100 dark:border-zinc-700 opacity-0 group-hover:opacity-100 transition-all no-print"
                    >
                        <NotebookPen className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div className="serif-text text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 pl-8 border-l-2 border-zinc-100 dark:border-zinc-800 group-hover:border-teal-500 transition-all duration-500">
                {isLoading ? (
                    <div className="h-4 w-48 bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded" />
                ) : (
                    <>
                        <span className="font-mono text-teal-600 mr-2 font-bold">{result.paragraphIndex}.</span>
                        {snippet}
                    </>
                )}
            </div>
        </div>
    );
});

const SearchResults: React.FC = () => {
  const { 
    searchQuery, 
    searchMode,
    searchResults,
    setSearchResults,
    isSearching,
    setIsSearching,
    setSelectedSermonId, 
    setJumpToText, 
    languageFilter,
    setSearchQuery,
    addNotification,
    setLastSearchQuery,
    setLastSearchMode,
    setNavigatedFromSearch,
    sermonsMap
  } = useAppStore();
  
  const lang = languageFilter === 'Anglais' ? 'en' : 'fr';
  const t = translations[lang];

  const [visibleCount, setVisibleCount] = useState(RESULTS_PER_PAGE);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon } | null>(null);
  const searchWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Worker autonome qui ouvre sa propre connexion IndexedDB
    const workerCode = `
      self.onmessage = async function(e) {
        const { searchQuery, searchMode } = e.data;
        
        const DB_NAME = 'SermonStudyDB';
        const DB_VERSION = 3;
        const STORE_NAME = 'sermons';

        const normalize = (str) => {
          if (!str) return '';
          return str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim();
        };

        const qNorm = normalize(searchQuery);
        if (!qNorm) return self.postMessage([]);

        const openDB = () => new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        try {
          const db = await openDB();
          const transaction = db.transaction(STORE_NAME, 'readonly');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.openCursor();
          const matches = [];

          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const sermon = cursor.value;
              if (sermon.text) {
                const paragraphs = sermon.text.split(/\\n\\s*\\n/);
                paragraphs.forEach((p, idx) => {
                  const pNorm = normalize(p);
                  if (pNorm.includes(qNorm)) {
                    matches.push({
                      sermonId: sermon.id,
                      title: sermon.title,
                      date: sermon.date,
                      city: sermon.city,
                      paragraphIndex: idx + 1
                    });
                  }
                });
              }
              cursor.continue();
            } else {
              self.postMessage(matches);
              db.close();
            }
          };
        } catch (err) {
          self.postMessage({ error: err.message });
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    searchWorkerRef.current = new Worker(URL.createObjectURL(blob));

    searchWorkerRef.current.onmessage = (e) => {
      if (e.data.error) {
          console.error("Worker Error:", e.data.error);
      } else {
          setSearchResults(e.data);
      }
      setIsSearching(false);
    };

    return () => searchWorkerRef.current?.terminate();
  }, [setSearchResults, setIsSearching]);

  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setVisibleCount(RESULTS_PER_PAGE);
    searchWorkerRef.current?.postMessage({ searchQuery, searchMode });
  }, [searchQuery, searchMode, setIsSearching, setSearchResults]);

  const loadMore = useCallback(() => setVisibleCount(v => v + RESULTS_PER_PAGE), []);

  const handleResultClick = async (res: SearchResult) => {
    setLastSearchQuery(searchQuery);
    setLastSearchMode(searchMode);
    setNavigatedFromSearch(true);
    
    const s = await getSermonById(res.sermonId);
    if (s && s.text) {
        const paragraphs = s.text.split(/\n\s*\n/);
        const text = paragraphs[res.paragraphIndex - 1] || "";
        await setSelectedSermonId(res.sermonId);
        setJumpToText(text.trim());
        setSearchQuery('');
    }
  };

  const handleExportPdf = () => {
      // Exportation simplifiée des métadonnées car le texte n'est pas en mémoire
      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text(`Résultats de recherche pour : ${searchQuery}`, 15, 20);
      searchResults.slice(0, 50).forEach((res, i) => {
          doc.setFontSize(10);
          doc.text(`${i+1}. ${res.title} (${res.date}) - Parg. ${res.paragraphIndex}`, 15, 30 + (i*6));
      });
      doc.save('resultats.pdf');
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500">
      {noteSelectorPayload && (
        <NoteSelectorModal 
          selectionText={noteSelectorPayload.text} 
          sermon={noteSelectorPayload.sermon} 
          onClose={() => setNoteSelectorPayload(null)} 
        />
      )}
      
      <div className="px-8 h-14 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl z-20">
        <div className="flex items-center gap-5">
          <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </div>
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-zinc-800 dark:text-zinc-100">
              RECHERCHE INTEGRALE
            </h2>
            <p className="text-[8px] font-black text-teal-600 dark:text-blue-400 uppercase tracking-[0.3em] mt-0.5">
              {isSearching ? "Indexation..." : `${searchResults.length} résultats`} 
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            <button onClick={handleExportPdf} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-teal-600">
              <FileText className="w-4 h-4" />
            </button>
            <button onClick={() => setSearchQuery('')} className="px-5 py-2 bg-zinc-100 dark:bg-zinc-800 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg text-zinc-600">
                {t.reader_exit}
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-6 pb-32">
          {isSearching && searchResults.length === 0 ? (
            <div className="h-96 flex flex-col items-center justify-center opacity-40">
                <Loader2 className="w-12 h-12 animate-spin text-teal-600" />
                <p className="mt-4 text-[10px] font-black uppercase tracking-widest">Exploration...</p>
            </div>
          ) : searchResults.length === 0 && !isSearching ? (
            <div className="h-96 flex flex-col items-center justify-center opacity-30">
              <Search className="w-12 h-12" />
              <p className="mt-4 text-[10px] font-black uppercase tracking-widest">Aucun résultat.</p>
            </div>
          ) : (
            searchResults.slice(0, visibleCount).map((res, idx) => (
                <SearchResultCard 
                    key={`${res.sermonId}-${idx}`}
                    result={res}
                    index={idx}
                    searchQuery={searchQuery}
                    searchMode={searchMode}
                    onClick={() => handleResultClick(res)}
                    onAddNote={async (e) => {
                        e.stopPropagation();
                        const s = await getSermonById(res.sermonId);
                        if (s) {
                            const p = s.text.split(/\n\s*\n/)[res.paragraphIndex - 1];
                            setNoteSelectorPayload({ text: p.trim(), sermon: s });
                        }
                    }}
                />
            ))
          )}
          
          {visibleCount < searchResults.length && (
            <div className="flex justify-center pt-8">
              <button onClick={loadMore} className="px-10 py-4 bg-white dark:bg-zinc-800 border border-zinc-200 rounded-[20px] text-[10px] font-black uppercase tracking-widest hover:bg-teal-600 hover:text-white transition-all">
                Voir plus de résultats ({searchResults.length - visibleCount})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
