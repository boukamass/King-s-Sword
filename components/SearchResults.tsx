
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import { translations } from '../translations';
import { SearchMode, Sermon } from '../types';
import { normalizeText, getAccentInsensitiveRegex } from '../utils/textUtils';
import { getAllSermonsFull } from '../services/db';
import NoteSelectorModal from './NoteSelectorModal';
import { jsPDF } from 'jspdf';
import saveAs from 'file-saver';
import { Printer, FileText, FileDown, NotebookPen, Loader2, Calendar, MapPin, Search, X } from 'lucide-react';

const RESULTS_PER_PAGE = 20;

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
    const workerCode = `
      self.onmessage = function(e) {
        const { sermons, searchQuery, searchMode, queryWords } = e.data;
        const matches = [];
        
        const normalize = (str) => {
          if (!str) return '';
          return str.normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .toLowerCase()
            .replace(/[.,;:“”"?!()]/g, " ")
            .replace(/\\s+/g, ' ')
            .trim();
        };

        const escapeRegex = (string) => {
          return string.replace(/[.*+?^$\${}()|[\\]\\\\]/g, '\\\\$&');
        };

        const qNorm = normalize(searchQuery);
        const queryWordsNorm = queryWords.map(w => normalize(w));

        sermons.forEach(sermon => {
          if (!sermon.text) return;
          const paragraphs = sermon.text.split(/\\n\\s*\\n/);
          
          paragraphs.forEach((p, pIdx) => {
            const pNorm = normalize(p);
            if (!pNorm) return;

            let isMatch = false;

            if (searchMode === 'DIVERSE') {
              isMatch = queryWordsNorm.every(word => pNorm.includes(word));
            } else if (searchMode === 'EXACT_WORDS') {
              isMatch = queryWordsNorm.every(word => {
                const regex = new RegExp("(^|[^a-z0-9À-ÿ])" + escapeRegex(word) + "($|[^a-z0-9À-ÿ])", 'i');
                return regex.test(pNorm);
              });
            } else if (searchMode === 'EXACT_PHRASE') {
              isMatch = pNorm.includes(qNorm);
            } else {
              isMatch = pNorm.includes(qNorm);
            }

            if (isMatch) {
              matches.push({
                sermonId: sermon.id,
                title: sermon.title,
                date: sermon.date,
                city: sermon.city,
                paragraph: p.trim(),
                paragraphIndex: pIdx + 1,
                version: sermon.version
              });
            }
          });
        });

        self.postMessage(matches);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    searchWorkerRef.current = new Worker(URL.createObjectURL(blob));

    searchWorkerRef.current.onmessage = (e) => {
      setSearchResults(e.data);
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

    const runSearch = async () => {
      setIsSearching(true);
      setVisibleCount(RESULTS_PER_PAGE);
      
      try {
        const sermonsFull = await getAllSermonsFull();
        const queryWords = searchQuery.trim().split(/\s+/).filter(w => w.length > 0);
        
        searchWorkerRef.current?.postMessage({
          sermons: sermonsFull,
          searchQuery,
          searchMode,
          queryWords
        });
      } catch (err) {
        console.error("Erreur lors de la recherche intégrale:", err);
        setIsSearching(false);
      }
    };

    runSearch();
  }, [searchQuery, searchMode, setIsSearching, setSearchResults]);

  const visibleResults = useMemo(() => {
    return searchResults.slice(0, visibleCount);
  }, [searchResults, visibleCount]);

  const loadMore = useCallback(() => {
    setVisibleCount(prev => prev + RESULTS_PER_PAGE);
  }, []);

  const highlightText = (text: string, query: string, mode: SearchMode) => {
    if (!query) return text;
    const regex = getAccentInsensitiveRegex(query, mode === SearchMode.EXACT_WORDS);

    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) => {
          const isMatch = regex.test(part);
          regex.lastIndex = 0;
          return isMatch ? (
            <mark key={i} className="bg-amber-600/15 text-amber-700 dark:text-amber-400 rounded-md px-1 font-bold ring-1 ring-amber-600/20">
              {part}
            </mark>
          ) : part;
        })}
      </>
    );
  };

  const handleResultClick = async (sermonId: string, text: string) => {
    const cleanText = text.trim();
    setLastSearchQuery(searchQuery);
    setLastSearchMode(searchMode);
    setNavigatedFromSearch(true);
    await setSelectedSermonId(sermonId);
    setJumpToText(cleanText);
    setSearchQuery('');
  };

  const handlePrint = () => {
    if (window.electronAPI) window.electronAPI.printPage();
    else window.print();
  };

  const handleExportPdf = () => {
    if (searchResults.length === 0) return;
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      const margin = 15;
      const maxLineWidth = pageWidth - margin * 2;
      let y = margin;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`Résultats de recherche : "${searchQuery}"`, margin, y);
      y += 10;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`${searchResults.length} passages trouvés`, margin, y);
      y += 15;

      searchResults.slice(0, 50).forEach((res, i) => {
        if (y > doc.internal.pageSize.height - 30) {
          doc.addPage();
          y = margin;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${res.paragraphIndex}. ${res.title} (${res.date})`, margin, y);
        y += 6;
        doc.setFont('times', 'italic');
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(res.paragraph, maxLineWidth);
        doc.text(lines, margin, y);
        y += lines.length * 5 + 10;
      });

      doc.save(`recherche_${searchQuery.replace(/\s+/g, '_')}.pdf`);
      addNotification("Export PDF réussi (50 premiers résultats)", "success");
    } catch (err) {
      addNotification("Erreur lors de l'export PDF", "error");
    }
  };

  const handleAddToNote = (e: React.MouseEvent, res: any) => {
    e.stopPropagation();
    const sermon = sermonsMap[res.sermonId] || { id: res.sermonId, title: res.title, date: res.date, city: res.city, text: '' };
    setNoteSelectorPayload({
      text: `${res.paragraphIndex}. ${res.paragraph}`,
      sermon: sermon as Sermon
    });
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden animate-in fade-in duration-500 transition-colors duration-500">
      {noteSelectorPayload && (
        <NoteSelectorModal 
          selectionText={noteSelectorPayload.text} 
          sermon={noteSelectorPayload.sermon} 
          onClose={() => setNoteSelectorPayload(null)} 
        />
      )}
      
      <div className="px-8 h-14 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between shrink-0 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-2xl z-20 no-print">
        <div className="flex items-center gap-5">
          <div className="w-8 h-8 flex items-center justify-center bg-teal-600/10 text-teal-600 rounded-lg border border-teal-600/20 shadow-sm">
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </div>
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-zinc-800 dark:text-zinc-100 leading-tight">
              {t.full_text_search}
            </h2>
            <p className="text-[8px] font-black text-teal-600 dark:text-blue-400 uppercase tracking-[0.3em] mt-0.5">
              {isSearching ? "Analyse de la bibliothèque..." : `${searchResults.length} passages indexés`} 
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
            <button 
              onClick={handlePrint} 
              data-tooltip={t.print}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-zinc-500 hover:text-teal-600 dark:text-zinc-400 tooltip-bottom"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button 
              onClick={handleExportPdf} 
              data-tooltip={t.export_pdf}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-zinc-500 hover:text-teal-600 dark:text-zinc-400 tooltip-bottom"
            >
              <FileText className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-2" />
            <button onClick={() => setSearchQuery('')} className="px-5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[9px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-95 text-zinc-600 dark:text-zinc-300">
                {t.reader_exit}
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar bg-transparent">
        <div className="max-w-4xl mx-auto space-y-8 pb-32 printable-content">
          {isSearching && searchResults.length === 0 && (
            <div className="h-96 flex flex-col items-center justify-center text-center space-y-6 opacity-40 no-print">
                <Loader2 className="w-16 h-16 animate-spin text-teal-600" />
                <p className="text-[12px] font-black uppercase tracking-[0.6em] text-zinc-500">Exploration prophétique...</p>
            </div>
          )}
          
          {!isSearching && searchResults.length === 0 && (
            <div className="h-96 flex flex-col items-center justify-center text-center space-y-4 opacity-40 no-print">
              <Search className="w-12 h-12 text-zinc-300" />
              <p className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Aucun résultat trouvé pour cette recherche.</p>
            </div>
          )}
          
          {visibleResults.map((res, idx) => (
            <div 
              key={`${res.sermonId}-${idx}`} 
              onClick={() => handleResultClick(res.sermonId, res.paragraph)}
              className="group bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60 rounded-[32px] p-8 shadow-sm hover:shadow-2xl hover:border-teal-500/30 transition-all duration-500 cursor-pointer relative"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono font-black text-teal-600 bg-teal-600/5 px-4 py-1.5 rounded-full border border-teal-600/10">
                    RESULTAT #{idx + 1}
                  </span>
                  <h3 className="text-[14px] font-black text-zinc-800 dark:text-zinc-100 group-hover:text-teal-600 transition-colors uppercase tracking-tight">
                    {res.title}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 font-mono italic opacity-70">
                    <Calendar className="w-3 h-3" />
                    {res.date}
                  </div>
                  <button 
                    onClick={(e) => handleAddToNote(e, res)}
                    data-tooltip={t.tooltip_save_to_note}
                    className="w-8 h-8 flex items-center justify-center bg-zinc-50 dark:bg-zinc-800 text-zinc-400 hover:text-teal-600 rounded-lg border border-zinc-100 dark:border-zinc-700 opacity-0 group-hover:opacity-100 transition-all no-print"
                  >
                    <NotebookPen className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="serif-text text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 pl-8 border-l-2 border-zinc-100 dark:border-zinc-800 group-hover:border-teal-500 transition-all duration-500">
                <span className="font-mono text-teal-600 mr-2 font-bold">{res.paragraphIndex}.</span>
                {highlightText(res.paragraph, searchQuery, searchMode)}
              </div>
            </div>
          ))}
          
          {visibleCount < searchResults.length && (
            <div className="flex justify-center pt-12 no-print">
              <button onClick={loadMore} className="px-12 py-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-[20px] text-[11px] font-black uppercase tracking-[0.2em] hover:bg-teal-600 hover:text-white transition-all shadow-xl active:scale-95">
                Explorer la suite ({searchResults.length - visibleCount})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
