
import React, { useState, useEffect, useCallback, memo } from 'react';
import { useAppStore, SearchResult } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { FileText, Loader2, Calendar, Search, ChevronLeft, MapPin, Hash, NotebookPen } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { searchSermons } from '../services/db';
import NoteSelectorModal from './NoteSelectorModal';

const RESULTS_PER_PAGE = 50;

const SearchResultCard = memo(({ 
    result, 
    index, 
    onClick,
    onAddToNotes
}: { 
    result: SearchResult; 
    index: number; 
    onClick: () => void;
    onAddToNotes: (e: React.MouseEvent) => void;
}) => (
    <div 
        onClick={onClick}
        className="group bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800/70 rounded-[28px] p-7 shadow-sm hover:shadow-2xl hover:border-teal-500/40 transition-all duration-500 cursor-pointer relative overflow-hidden"
    >
        {/* Accent Bar */}
        <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-600/10 group-hover:bg-teal-600 transition-all duration-500" />
        
        <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-9 h-9 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-xl border border-teal-600/10 font-mono text-[10px] font-black shrink-0">
                        {index + 1}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-black text-zinc-900 dark:text-zinc-100 group-hover:text-teal-600 transition-colors uppercase tracking-tight truncate">
                          {result.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1.5 text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
                          <div className="flex items-center gap-1">
                              <Calendar className="w-2.5 h-2.5 text-teal-600/50" />
                              <span className="font-mono">{result.date}</span>
                          </div>
                          <span className="w-1 h-1 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                          <div className="flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5 text-teal-600/50" />
                              <span className="truncate">{result.city}</span>
                          </div>
                      </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={onAddToNotes}
                        data-tooltip="Ajouter à une note d'étude"
                        className="w-9 h-9 flex items-center justify-center bg-teal-600/5 text-teal-600 rounded-xl border border-teal-600/10 hover:bg-teal-600 hover:text-white transition-all active:scale-90 shadow-sm"
                    >
                        <NotebookPen className="w-4 h-4" />
                    </button>
                    <div className="shrink-0 flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <Hash className="w-3 h-3 text-teal-600/40" />
                        <span className="text-[10px] font-black text-zinc-500">PARA {result.paragraphIndex}</span>
                    </div>
                </div>
            </div>

            <div className="relative">
                <div className="serif-text text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 pl-4 border-l-2 border-zinc-100 dark:border-zinc-800 group-hover:border-teal-600/30 transition-all duration-500 italic">
                    <span dangerouslySetInnerHTML={{ __html: result.snippet || '' }} />
                </div>
                
                {/* Visual quote indicator */}
                <div className="absolute -left-1 -top-2 text-4xl text-teal-600/5 select-none font-serif">"</div>
            </div>
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
    setJumpToParagraph,
    setNavigatedFromSearch,
    setIsFullTextSearch,
  } = useAppStore();
  
  const t = translations[languageFilter === 'Anglais' ? 'en' : 'fr'];
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);

  const performSearch = useCallback(async (q: string, m: SearchMode, off: number) => {
    if (!q || q.length < 2) return;
    setIsSearching(true);
    try {
      const results = await searchSermons({ 
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
    setNavigatedFromSearch(true);
    await setSelectedSermonId(res.sermonId);
    setJumpToParagraph(res.paragraphIndex);
    setIsFullTextSearch(false);
  };

  const handleAddToNotes = (e: React.MouseEvent, res: SearchResult) => {
    e.stopPropagation();
    const cleanText = res.snippet?.replace(/<mark[^>]*>|<\/mark>/g, '') || '';
    
    const partialSermon: Sermon = {
      id: res.sermonId,
      title: res.title,
      date: res.date,
      city: res.city,
      text: '' 
    };

    setNoteSelectorPayload({
        text: cleanText,
        sermon: partialSermon,
        paragraphIndex: res.paragraphIndex
    });
  };

  const handleExportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Résultats de recherche : ${searchQuery}`, 15, 20);
    doc.setFontSize(10);
    searchResults.slice(0, 100).forEach((res, i) => {
      const y = 30 + (i * 10);
      if (y < 280) {
        doc.text(`${i+1}. ${res.title} (${res.date}) - Para ${res.paragraphIndex}`, 15, y);
      }
    });
    doc.save('resultats_etude.pdf');
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500">
      {noteSelectorPayload && (
        <NoteSelectorModal 
            selectionText={noteSelectorPayload.text} 
            sermon={noteSelectorPayload.sermon} 
            paragraphIndex={noteSelectorPayload.paragraphIndex}
            onClose={() => setNoteSelectorPayload(null)} 
        />
      )}
      
      <div className="px-8 h-14 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl z-20">
        <div className="flex items-center gap-5">
          <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </div>
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-zinc-800 dark:text-zinc-100">MOTEUR SQLITE FTS5</h2>
            <p className="text-[8px] font-black text-teal-600 uppercase tracking-[0.3em] mt-0.5">
              {searchResults.length} occurrences trouvées
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            <button 
              onClick={handleExportPdf} 
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-teal-600 transition-all hover:shadow-lg active:scale-95" 
              title="Exporter PDF"
            >
              <FileText className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-2" />
            <button 
              onClick={() => { setSearchQuery(''); setIsFullTextSearch(false); }} 
              className="px-5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg text-zinc-600 dark:text-zinc-300 transition-all active:scale-95 shadow-sm"
            >
                {t.reader_exit}
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/20">
        <div className="max-w-4xl mx-auto space-y-6 pb-20"> {/* pb-20 au lieu de pb-40 */}
          {searchResults.length === 0 && !isSearching ? (
            <div className="h-[50vh] flex flex-col items-center justify-center opacity-20 space-y-6">
              <div className="w-20 h-20 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 rounded-full">
                <Search className="w-8 h-8" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-[0.5em]">{t.no_results}</p>
            </div>
          ) : (
            searchResults.map((res, idx) => (
                <SearchResultCard 
                    key={`${res.sermonId}-${res.paragraphId}-${idx}`}
                    result={res}
                    index={idx}
                    onClick={() => handleResultClick(res)}
                    onAddToNotes={(e) => handleAddToNotes(e, res)}
                />
            ))
          )}
          
          {searchResults.length > 0 && hasMore && (
            <div className="flex justify-center pt-8">
              <button 
                onClick={loadMore} 
                disabled={isSearching}
                className="px-10 py-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-600 hover:text-white transition-all shadow-xl shadow-teal-600/5 active:scale-95 disabled:opacity-50 flex items-center gap-3"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>Charger plus de résultats</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
