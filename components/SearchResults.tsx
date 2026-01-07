
import React, { useState, useEffect, useCallback, memo } from 'react';
import { useAppStore, SearchResult } from '../store';
import { translations } from '../translations';
import { SearchMode } from '../types';
import { FileText, Loader2, Calendar, Search, ChevronLeft } from 'lucide-react';
import { jsPDF } from 'jspdf';

const RESULTS_PER_PAGE = 30;

const SearchResultCard = memo(({ 
    result, 
    index, 
    onClick 
}: { 
    result: SearchResult; 
    index: number; 
    onClick: () => void;
}) => (
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
            </div>
        </div>
        <div className="serif-text text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 pl-8 border-l-2 border-zinc-100 dark:border-zinc-800 group-hover:border-teal-500 transition-all duration-500">
            <span className="font-mono text-teal-600 mr-2 font-bold">{result.paragraphIndex}.</span>
            <span dangerouslySetInnerHTML={{ __html: result.snippet || '' }} />
        </div>
    </div>
));

const SearchResults: React.FC = () => {
  const { 
    searchQuery, 
    searchMode,
    searchResults,
    setSearchResults,
    isSearching,
    setIsSearching,
    setSelectedSermonId, 
    languageFilter,
    setSearchQuery,
    setJumpToText,
  } = useAppStore();
  
  const t = translations[languageFilter === 'Anglais' ? 'en' : 'fr'];
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const performSearch = useCallback(async (q: string, m: SearchMode, off: number) => {
    if (!q || q.length < 2) return;
    setIsSearching(true);
    try {
      const results = await window.electronAPI.db.search({ 
        query: q, 
        mode: m, 
        limit: RESULTS_PER_PAGE, 
        offset: off 
      });
      
      if (off === 0) setSearchResults(results);
      else setSearchResults([...searchResults, ...results]);
      
      setHasMore(results.length === RESULTS_PER_PAGE);
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      setIsSearching(false);
    }
  }, [searchResults, setSearchResults, setIsSearching]);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    performSearch(searchQuery, searchMode, 0);
  }, [searchQuery, searchMode]);

  const loadMore = () => {
    const nextOffset = offset + RESULTS_PER_PAGE;
    setOffset(nextOffset);
    performSearch(searchQuery, searchMode, nextOffset);
  };

  const handleResultClick = async (res: SearchResult) => {
    // Extraire le texte brut du snippet pour le jump-to
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = res.snippet || '';
    const jumpText = tempDiv.textContent || '';
    
    await setSelectedSermonId(res.sermonId);
    setJumpToText(jumpText);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Résultats de recherche : ${searchQuery}`, 15, 20);
    doc.setFontSize(10);
    searchResults.slice(0, 50).forEach((res, i) => {
      const y = 30 + (i * 10);
      if (y < 280) {
        doc.text(`${i+1}. ${res.title} (${res.date}) - Para ${res.paragraphIndex}`, 15, y);
      }
    });
    doc.save('resultats_etude.pdf');
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500">
      <div className="px-8 h-14 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl z-20">
        <div className="flex items-center gap-5">
          <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </div>
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-zinc-800 dark:text-zinc-100">SQLITE FTS5 ENGINE</h2>
            <p className="text-[8px] font-black text-teal-600 uppercase tracking-[0.3em] mt-0.5">
              {searchResults.length} occurrences trouvées
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            <button onClick={handleExportPdf} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-teal-600" title="Exporter PDF">
              <FileText className="w-4 h-4" />
            </button>
            <button onClick={() => setSearchQuery('')} className="px-5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg text-zinc-600 dark:text-zinc-300 transition-all">
                {t.reader_exit}
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-6 pb-32">
          {searchResults.length === 0 && !isSearching ? (
            <div className="h-96 flex flex-col items-center justify-center opacity-30">
              <Search className="w-12 h-12 mb-4" />
              <p className="text-[10px] font-black uppercase tracking-widest">{t.no_results}</p>
            </div>
          ) : (
            searchResults.map((res, idx) => (
                <SearchResultCard 
                    key={`${res.sermonId}-${res.paragraphId}-${idx}`}
                    result={res}
                    index={idx}
                    onClick={() => handleResultClick(res)}
                />
            ))
          )}
          
          {searchResults.length > 0 && hasMore && (
            <div className="flex justify-center pt-8">
              <button 
                onClick={loadMore} 
                disabled={isSearching}
                className="px-10 py-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-[20px] text-[10px] font-black uppercase tracking-widest hover:bg-teal-600 hover:text-white transition-all shadow-sm active:scale-95 disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Charger plus de résultats"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
