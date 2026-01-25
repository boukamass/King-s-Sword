import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useAppStore, SearchResult } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { FileText, Loader2, Calendar, Search, ChevronLeft, MapPin, Hash, NotebookPen, Sparkles, Layers, Type } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { searchSermons } from '../services/db';
import NoteSelectorModal from './NoteSelectorModal';

const RESULTS_PER_PAGE = 50;

// Variables persistantes hors du cycle de vie du composant pour garder la position de scroll entre les montages
let savedSearchScrollTop = 0;
let lastSearchContext = "";

const SkeletonCard = () => (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[28px] p-7 shadow-sm animate-pulse">
        <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
                <div className="w-9 h-9 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />
                <div className="space-y-2">
                    <div className="h-4 w-48 bg-zinc-100 dark:bg-zinc-800 rounded" />
                    <div className="h-2 w-32 bg-zinc-50 dark:bg-zinc-800/50 rounded" />
                </div>
            </div>
            <div className="w-20 h-8 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl" />
        </div>
        <div className="space-y-3">
            <div className="h-3 w-full bg-zinc-50 dark:bg-zinc-800/50 rounded" />
            <div className="h-3 w-[90%] bg-zinc-50 dark:bg-zinc-800/50 rounded" />
            <div className="h-3 w-[80%] bg-zinc-50 dark:bg-zinc-800/50 rounded" />
        </div>
    </div>
);

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
    includeSynonyms,
    showOnlySynonyms,
    setShowOnlySynonyms,
    showOnlyQuery,
    setShowOnlyQuery,
    activeSynonyms,
    sidebarOpen,
    toggleSidebar
  } = useAppStore();
  
  const t = translations[languageFilter === 'Anglais' ? 'en' : 'fr'];
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [noteSelectorPayload, setNoteSelectorPayload] = useState<{ text: string; sermon: Sermon; paragraphIndex?: number } | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastPerformedSearchRef = useRef<string>("");

  const performSearch = useCallback(async (q: string, m: SearchMode, off: number) => {
    if (!q || q.length < 2) return;
    
    const searchId = `${q}-${m}-${off}-${showOnlySynonyms}-${showOnlyQuery}-${includeSynonyms}`;
    if (off === 0 && searchId === lastPerformedSearchRef.current && searchResults.length > 0) return;
    
    setIsSearching(true);
    try {
      const results = await searchSermons({ 
        query: q, 
        mode: m, 
        limit: RESULTS_PER_PAGE, 
        offset: off 
      });
      
      if (off === 0) {
        setSearchResults(results);
        lastPerformedSearchRef.current = searchId;
      } else {
        setSearchResults(prev => [...prev, ...results]);
      }
      
      setHasMore(results.length === RESULTS_PER_PAGE);
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      setIsSearching(false);
    }
  }, [setSearchResults, setIsSearching, showOnlySynonyms, showOnlyQuery, includeSynonyms, searchResults.length]);

  useEffect(() => {
    // Si les paramètres de recherche changent, on réinitialise la position de scroll mémorisée
    const currentSearchId = `${searchQuery}-${searchMode}-${showOnlySynonyms}-${showOnlyQuery}-${includeSynonyms}`;
    if (currentSearchId !== lastSearchContext) {
      savedSearchScrollTop = 0;
      lastSearchContext = currentSearchId;
    }

    setOffset(0);
    setHasMore(true);
    performSearch(searchQuery, searchMode, 0);
  }, [searchQuery, searchMode, performSearch, showOnlySynonyms, showOnlyQuery, includeSynonyms]);

  // Restaurer la position de scroll une fois les résultats chargés dans le DOM
  useEffect(() => {
    if (scrollContainerRef.current && savedSearchScrollTop > 0 && searchResults.length > 0) {
      // Utilisation de requestAnimationFrame pour s'assurer que le rendu est terminé avant le scroll
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = savedSearchScrollTop;
        }
      });
    }
  }, [searchResults]);

  const loadMore = () => {
    const nextOffset = offset + RESULTS_PER_PAGE;
    setOffset(nextOffset);
    performSearch(searchQuery, searchMode, nextOffset);
  };

  const handleResultClick = async (res: SearchResult) => {
    // Sauvegarder la position actuelle avant que le composant ne soit démonté
    if (scrollContainerRef.current) {
      savedSearchScrollTop = scrollContainerRef.current.scrollTop;
    }
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
    <div className="flex-1 h-full flex flex-col bg-slate-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500">
      {noteSelectorPayload && (
        <NoteSelectorModal 
            selectionText={noteSelectorPayload.text} 
            sermon={noteSelectorPayload.sermon} 
            paragraphIndex={noteSelectorPayload.paragraphIndex}
            onClose={() => setNoteSelectorPayload(null)} 
        />
      )}
      
      <div className="px-4 md:px-8 h-14 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl z-20">
        <div className="flex items-center gap-4">
          {!sidebarOpen && (
             <button 
                onClick={toggleSidebar} 
                data-tooltip="Ouvrir la bibliothèque" 
                className="flex items-center gap-3 hover:opacity-80 active:scale-95 group shrink-0 mr-1"
             >
               <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 rounded-lg border border-teal-600/20 shadow-sm shrink-0 group-hover:border-teal-600/40 transition-all duration-300">
                 <img src="https://branham.fr/source/favicon/favicon-32x32.png" alt="Logo" className="w-4 h-4 grayscale group-hover:grayscale-0 group-hover:scale-110 group-hover:rotate-[-5deg] transition-all duration-300" />
               </div>
             </button>
          )}
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 hidden sm:flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-zinc-50 leading-none">Résultats de recherche</h2>
              <p className="text-[7px] font-black text-teal-600 uppercase tracking-widest mt-0.5">
                {isSearching ? "Scan de la bibliothèque..." : `${searchResults.length} segments trouvés`}
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
            {includeSynonyms && activeSynonyms.length > 0 && (
                <div className="flex items-center gap-2 bg-zinc-100/50 dark:bg-zinc-900/50 p-1 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
                    <button 
                      onClick={() => setShowOnlyQuery(!showOnlyQuery)}
                      data-tooltip={showOnlyQuery ? "Voir tous les résultats" : "Mot recherché uniquement"}
                      className={`flex items-center gap-2 px-4 h-9 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-sm tooltip-bottom ${
                        showOnlyQuery 
                          ? 'bg-amber-600 text-white border-amber-600' 
                          : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-amber-600'
                      }`}
                    >
                      <Search className={`w-3.5 h-3.5 ${showOnlyQuery ? 'animate-pulse' : ''}`} />
                      <span className="hidden lg:inline">{showOnlyQuery ? "Mot Strict (Filtre Actif)" : "Mot recherché"}</span>
                      <span className="lg:hidden">Strict</span>
                    </button>

                    <button 
                      onClick={() => setShowOnlySynonyms(!showOnlySynonyms)}
                      data-tooltip={showOnlySynonyms ? "Voir tous les résultats" : "Synonymes uniquement"}
                      className={`flex items-center gap-2 px-4 h-9 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-sm tooltip-bottom ${
                        showOnlySynonyms 
                          ? 'bg-teal-600 text-white border-teal-600' 
                          : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-teal-600'
                      }`}
                    >
                      <Layers className={`w-3.5 h-3.5 ${showOnlySynonyms ? 'animate-pulse' : ''}`} />
                      <span className="hidden lg:inline">{showOnlySynonyms ? "Synonymes (Filtre Actif)" : "Synonymes"}</span>
                      <span className="lg:hidden">Syns</span>
                    </button>
                </div>
            )}
            <button 
                onClick={handleExportPdf}
                data-tooltip="Exporter PDF"
                className="w-9 h-9 flex items-center justify-center bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-400 hover:text-teal-600 transition-all active:scale-95 shadow-sm tooltip-bottom"
            >
                <FileText className="w-4 h-4" />
            </button>
            <button 
              onClick={() => { setIsFullTextSearch(false); setSearchQuery(''); }}
              className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-500 hover:text-red-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Fermer
            </button>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto p-10 space-y-8 pb-32">
          {searchResults.length === 0 && isSearching ? (
             <div className="space-y-8 animate-in fade-in duration-300">
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                   <div className="w-12 h-12 bg-teal-600/10 rounded-full flex items-center justify-center border border-teal-600/20">
                      <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
                   </div>
                   <div className="text-center">
                      <p className="text-[10px] font-black uppercase tracking-[0.4em] text-teal-600 animate-pulse">Exploration des archives...</p>
                      <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mt-1">Recherche de "{searchQuery}" dans toute la collection</p>
                   </div>
                </div>
                {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
             </div>
          ) : searchResults.length === 0 && !isSearching ? (
            <div className="py-40 flex flex-col items-center justify-center text-center space-y-6 opacity-20">
              <Search className="w-20 h-20 stroke-[1]" />
              <p className="text-[11px] font-black uppercase tracking-[0.4em]">Aucun résultat trouvé pour "{searchQuery}"</p>
            </div>
          ) : (
            <>
              {searchResults.map((result, idx) => (
                <SearchResultCard 
                    key={result.paragraphId} 
                    result={result} 
                    index={idx} 
                    onClick={() => handleResultClick(result)}
                    onAddToNotes={(e) => handleAddToNotes(e, result)}
                />
              ))}

              {isSearching && (
                <div className="space-y-8 mt-8 animate-in fade-in duration-300">
                   {[1, 2].map(i => <SkeletonCard key={`more-${i}`} />)}
                   <div className="py-10 flex flex-col items-center justify-center gap-4 text-teal-600 animate-pulse">
                     <Loader2 className="w-8 h-8 animate-spin" />
                     <span className="text-[10px] font-black uppercase tracking-[0.3em]">Chargement des segments suivants...</span>
                   </div>
                </div>
              )}

              {hasMore && !isSearching && (
                <div className="flex justify-center pt-8">
                  <button 
                    onClick={loadMore}
                    className="px-8 py-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-teal-600 hover:border-teal-600 transition-all shadow-sm active:scale-95"
                  >
                    Charger plus de résultats
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchResults;