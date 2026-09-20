import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Star, 
  Clock, 
  Search, 
  X, 
  Trash2, 
  BookOpen, 
  BookText, 
  Music, 
  Library, 
  ChevronRight, 
  Bookmark,
  Sparkles,
  ArrowUpRight,
  Check
} from 'lucide-react';
import { QuickAccessItem, QuickAccessItemType } from '../types';
import { 
  getFavorites, 
  getRecents, 
  removeFavorite, 
  removeRecent, 
  clearRecents, 
  toggleFavorite, 
  formatRelativeTime, 
  navigateToQuickAccessItem,
  QUICK_ACCESS_UPDATED_EVENT 
} from '../services/quickAccessService';
import { useAppStore } from '../store';

interface QuickAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'favorites' | 'recents';
}

export const QuickAccessModal: React.FC<QuickAccessModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'favorites'
}) => {
  const [activeTab, setActiveTab] = useState<'favorites' | 'recents'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | QuickAccessItemType>('ALL');
  const [favorites, setFavorites] = useState<QuickAccessItem[]>([]);
  const [recents, setRecents] = useState<QuickAccessItem[]>([]);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const setSelectedSermonId = useAppStore(s => s.setSelectedSermonId);
  const setLibraryMode = useAppStore(s => s.setLibraryMode);
  const setSelectedBibleBookId = useAppStore(s => s.setSelectedBibleBookId);
  const setSelectedBibleChapter = useAppStore(s => s.setSelectedBibleChapter);
  const setSelectedBibleVerse = useAppStore(s => s.setSelectedBibleVerse);
  const setJumpToParagraph = useAppStore(s => s.setJumpToParagraph);
  const addNotification = useAppStore(s => s.addNotification);

  const loadData = useCallback(() => {
    setFavorites(getFavorites());
    setRecents(getRecents());
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
      setActiveTab(initialTab);
      setSearchQuery('');
      setTypeFilter('ALL');
      setIsConfirmingClear(false);
    }
  }, [isOpen, initialTab, loadData]);

  useEffect(() => {
    const handleUpdate = () => loadData();
    window.addEventListener(QUICK_ACCESS_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(QUICK_ACCESS_UPDATED_EVENT, handleUpdate);
  }, [loadData]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const displayedList = useMemo(() => {
    const list = activeTab === 'favorites' ? favorites : recents;
    return list.filter(item => {
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        (item.snippet && item.snippet.toLowerCase().includes(q)) ||
        (item.date && item.date.toLowerCase().includes(q))
      );
    });
  }, [activeTab, favorites, recents, typeFilter, searchQuery]);

  const handleItemClick = async (item: QuickAccessItem) => {
    try {
      await navigateToQuickAccessItem(item, {
        setSelectedSermonId,
        setLibraryMode,
        setSelectedBibleBookId,
        setSelectedBibleChapter,
        setSelectedBibleVerse,
        setJumpToParagraph
      });
      onClose();
    } catch (e) {
      addNotification("Erreur lors de l'accès au document", "error");
    }
  };

  const handleToggleFav = (e: React.MouseEvent, item: QuickAccessItem) => {
    e.stopPropagation();
    const isNowFav = toggleFavorite(item);
    loadData();
    addNotification(
      isNowFav ? "Ajouté aux favoris" : "Retiré des favoris",
      "success"
    );
  };

  const handleRemoveRecent = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeRecent(id);
    loadData();
  };

  const handleConfirmClearAllRecents = () => {
    clearRecents();
    setRecents([]);
    loadData();
    setIsConfirmingClear(false);
    addNotification("Historique des récents effacé", "info");
  };

  const getItemIcon = (type: QuickAccessItemType) => {
    switch (type) {
      case 'bible':
        return <BookOpen className="w-4 h-4 text-blue-500" />;
      case 'expose':
        return <BookText className="w-4 h-4 text-purple-500" />;
      case 'song':
        return <Music className="w-4 h-4 text-amber-500" />;
      case 'sermon':
      default:
        return <Library className="w-4 h-4 text-teal-600 dark:text-teal-400" />;
    }
  };

  const getItemTypeBadge = (type: QuickAccessItemType) => {
    switch (type) {
      case 'bible':
        return (
          <span className="text-[9px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
            Bible
          </span>
        );
      case 'expose':
        return (
          <span className="text-[9px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">
            Exposé
          </span>
        );
      case 'song':
        return (
          <span className="text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">
            Cantique
          </span>
        );
      case 'sermon':
      default:
        return (
          <span className="text-[9px] font-black uppercase tracking-wider bg-teal-600/10 text-teal-700 dark:text-teal-400 px-2 py-0.5 rounded border border-teal-600/20">
            Sermon
          </span>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100050] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600/10 dark:bg-teal-500/10 border border-teal-600/20 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-xs shrink-0">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>Accès Rapide</span>
                <span className="text-[10px] font-mono font-bold bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">
                  {activeTab === 'favorites' ? `${favorites.length} favoris` : `${recents.length} récents`}
                </span>
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Retrouvez instantanément vos documents favoris et l'historique des éléments projetés
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher: Favoris vs Récents */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 shrink-0 flex-wrap">
          <div className="flex items-center p-1 bg-slate-100 dark:bg-zinc-800/70 rounded-xl border border-slate-200 dark:border-zinc-750">
            <button
              onClick={() => { setActiveTab('favorites'); setIsConfirmingClear(false); }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'favorites'
                  ? 'bg-white dark:bg-zinc-700 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${activeTab === 'favorites' ? 'fill-amber-500 text-amber-500' : ''}`} />
              <span>Favoris</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeTab === 'favorites'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
              }`}>
                {favorites.length}
              </span>
            </button>

            <button
              onClick={() => { setActiveTab('recents'); setIsConfirmingClear(false); }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'recents'
                  ? 'bg-white dark:bg-zinc-700 text-teal-600 dark:text-teal-400 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Projections récentes</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeTab === 'recents'
                  ? 'bg-teal-600/15 text-teal-700 dark:text-teal-300 font-bold'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
              }`}>
                {recents.length}
              </span>
            </button>
          </div>

          {activeTab === 'recents' && recents.length > 0 && (
            isConfirmingClear ? (
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 animate-in fade-in duration-150 shadow-2xs">
                <span className="text-[11px] font-bold text-red-600 dark:text-red-400 px-1.5">
                  Tout effacer ?
                </span>
                <button
                  type="button"
                  onClick={handleConfirmClearAllRecents}
                  className="text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 active:scale-95 flex items-center gap-1 px-2.5 py-1 rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  <Check className="w-3 h-3 stroke-[3]" />
                  <span>Oui, effacer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(false)}
                  className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800 active:scale-95 px-2 py-1 rounded-lg transition-all cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsConfirmingClear(true)}
                className="text-[11px] font-bold text-red-500 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer active:scale-95 border border-transparent hover:border-red-200 dark:hover:border-red-900/40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Effacer l'historique</span>
              </button>
            )
          )}
        </div>

        {/* Search & Filter Toolbar */}
        <div className="px-5 py-2.5 border-b border-slate-200/80 dark:border-zinc-800/80 flex items-center gap-3 bg-slate-50/50 dark:bg-zinc-950/30 shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'favorites' ? "Rechercher dans vos favoris..." : "Rechercher dans les récents..."}
              className="w-full pl-8.5 pr-8 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-teal-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar py-0.5">
            {[
              { id: 'ALL', label: 'Tous' },
              { id: 'sermon', label: 'Sermons' },
              { id: 'bible', label: 'Bible' },
              { id: 'expose', label: 'Exposé' },
              { id: 'song', label: 'Chants' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setTypeFilter(tab.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                  typeFilter === tab.id
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700/80 border border-slate-200/80 dark:border-zinc-750'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 custom-scrollbar min-h-[250px]">
          {displayedList.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 flex items-center justify-center text-zinc-400">
                {activeTab === 'favorites' ? (
                  <Star className="w-6 h-6 text-amber-500/40" />
                ) : (
                  <Clock className="w-6 h-6 text-teal-500/40" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
                  {searchQuery.trim()
                    ? "Aucun résultat trouvé pour votre recherche"
                    : activeTab === 'favorites'
                      ? "Aucun favori enregistré"
                      : "Aucun élément projeté dans l'historique"}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm">
                  {searchQuery.trim()
                    ? "Essayez d'autres mots-clés ou désactivez le filtre par catégorie."
                    : activeTab === 'favorites'
                      ? "Cliquez sur l'icône étoile ★ sur un sermon, un verset biblique ou un cantique pour le retrouver instantanément ici."
                      : "Seuls les sermons, versets et cantiques que vous projetez sur grand écran s'afficheront ici."}
                </p>
              </div>
            </div>
          ) : (
            displayedList.map(item => {
              const isFav = activeTab === 'favorites' || favorites.some(f => f.id === item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className="group flex items-start gap-3 p-3.5 rounded-xl bg-white dark:bg-zinc-850/60 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 border border-slate-200/80 dark:border-zinc-800 hover:border-teal-500/40 transition-all cursor-pointer shadow-xs hover:shadow-md"
                >
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 shrink-0 mt-0.5 group-hover:bg-teal-600/10 transition-colors">
                    {getItemIcon(item.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {getItemTypeBadge(item.type)}
                      {item.subtitle && (
                        <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                          {item.subtitle}
                        </span>
                      )}
                      {item.date && item.type === 'sermon' && (
                        <span className="text-[10px] font-mono text-zinc-400">
                          {item.date}
                        </span>
                      )}
                      {item.paragraphIndex && (
                        <span className="text-[9.5px] font-bold font-mono text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.2 rounded border border-teal-500/20">
                          {item.type === 'bible' ? `Verset ${item.paragraphIndex}` : `§ ${item.paragraphIndex}`}
                        </span>
                      )}
                    </div>

                    <h3 className="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors leading-snug line-clamp-1">
                      {item.title}
                    </h3>

                    {item.snippet && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1 leading-relaxed italic bg-slate-50 dark:bg-zinc-900/60 p-2 rounded-lg border border-slate-100 dark:border-zinc-800/60">
                        « {item.snippet} »
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-2 text-[10px] font-medium text-zinc-400">
                      <Clock className="w-3 h-3" />
                      <span>{formatRelativeTime(item.timestamp)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 self-center">
                    <button
                      onClick={e => handleToggleFav(e, item)}
                      className={`p-2 rounded-lg transition-all ${
                        isFav 
                          ? 'text-amber-500 hover:text-amber-600 bg-amber-50 dark:bg-amber-950/40' 
                          : 'text-zinc-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                      }`}
                      data-tooltip={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
                    >
                      <Star className={`w-4 h-4 ${isFav ? 'fill-amber-500' : ''}`} />
                    </button>

                    {activeTab === 'recents' ? (
                      <button
                        onClick={e => handleRemoveRecent(e, item.id)}
                        className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                        data-tooltip="Retirer de l'historique"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          removeFavorite(item.id);
                          loadData();
                          addNotification("Retiré des favoris", "info");
                        }}
                        className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                        data-tooltip="Supprimer ce favori"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <div className="p-1.5 text-zinc-300 dark:text-zinc-600 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      <ArrowUpRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-950/40 flex items-center justify-between text-[11px] text-zinc-500 shrink-0">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-teal-600" />
            Cliquez sur un élément pour l'ouvrir immédiatement
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-opacity"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
