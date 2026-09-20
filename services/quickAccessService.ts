import { QuickAccessItem, QuickAccessItemType } from '../types';

const FAVORITES_STORAGE_KEY = 'kings_sword_favorites';
const RECENTS_STORAGE_KEY = 'kings_sword_recents';
const MAX_RECENTS = 60;
const MAX_FAVORITES = 200;

export const QUICK_ACCESS_UPDATED_EVENT = 'kings_sword_quick_access_updated';

const dispatchUpdateEvent = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUICK_ACCESS_UPDATED_EVENT));
  }
};

/**
 * Charge les éléments favoris depuis le stockage local
 */
export const getFavorites = (): QuickAccessItem[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.warn('Failed to parse favorites:', e);
    return [];
  }
};

/**
 * Charge l'historique des éléments récemment consultés
 */
export const getRecents = (): QuickAccessItem[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.warn('Failed to parse recents:', e);
    return [];
  }
};

/**
 * Vérifie si un identifiant est dans les favoris
 */
export const isFavorite = (id: string): boolean => {
  const favs = getFavorites();
  return favs.some(item => item.id === id);
};

/**
 * Ajoute un élément aux favoris
 */
export const addFavorite = (item: Omit<QuickAccessItem, 'timestamp' | 'isFavorite'>): QuickAccessItem => {
  const favs = getFavorites();
  const existingIdx = favs.findIndex(f => f.id === item.id);
  const now = Date.now();
  const fullItem: QuickAccessItem = {
    ...item,
    timestamp: now,
    isFavorite: true
  };

  let updated: QuickAccessItem[];
  if (existingIdx !== -1) {
    updated = [...favs];
    updated[existingIdx] = fullItem;
  } else {
    updated = [fullItem, ...favs].slice(0, MAX_FAVORITES);
  }

  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
    dispatchUpdateEvent();
  } catch (e) {
    console.error('Failed to save favorite:', e);
  }

  return fullItem;
};

/**
 * Retire un élément des favoris
 */
export const removeFavorite = (id: string): void => {
  const favs = getFavorites();
  const filtered = favs.filter(f => f.id !== id);
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(filtered));
    dispatchUpdateEvent();
  } catch (e) {
    console.error('Failed to remove favorite:', e);
  }
};

/**
 * Bascule l'état favori (toggle)
 */
export const toggleFavorite = (item: Omit<QuickAccessItem, 'timestamp' | 'isFavorite'>): boolean => {
  if (isFavorite(item.id)) {
    removeFavorite(item.id);
    return false;
  } else {
    addFavorite(item);
    return true;
  }
};

/**
 * Enregistre un élément dans l'historique des éléments effectivement projetés
 */
export const addRecent = (item: Omit<QuickAccessItem, 'timestamp'>): void => {
  if (typeof localStorage === 'undefined') return;
  // Ne pas stocker des items vides ou invalides
  if (!item.id || !item.title) return;

  const recents = getRecents();
  // Retirer l'élément s'il existe déjà pour le repositionner tout en haut
  const filtered = recents.filter(r => r.id !== item.id);
  const fullItem: QuickAccessItem = {
    ...item,
    timestamp: Date.now()
  };

  const updated = [fullItem, ...filtered].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated));
    dispatchUpdateEvent();
  } catch (e) {
    console.warn('Failed to save recent:', e);
  }
};

/**
 * Supprime un élément spécifique de l'historique récent
 */
export const removeRecent = (id: string): void => {
  const recents = getRecents();
  const filtered = recents.filter(r => r.id !== id);
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(filtered));
    dispatchUpdateEvent();
  } catch (e) {
    console.error('Failed to remove recent item:', e);
  }
};

/**
 * Efface tout l'historique des consultations récentes
 */
export const clearRecents = (): void => {
  try {
    localStorage.removeItem(RECENTS_STORAGE_KEY);
    localStorage.setItem(RECENTS_STORAGE_KEY, '[]');
    dispatchUpdateEvent();
  } catch (e) {
    console.error('Failed to clear recents:', e);
  }
};

/**
 * Efface tous les favoris
 */
export const clearFavorites = (): void => {
  try {
    localStorage.removeItem(FAVORITES_STORAGE_KEY);
    dispatchUpdateEvent();
  } catch (e) {
    console.error('Failed to clear favorites:', e);
  }
};

/**
 * Formate un timestamp sous forme lisible et chaleureuse
 */
export const formatRelativeTime = (timestamp: number): string => {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;

  // Moins d'une minute
  if (diff < 60 * 1000) {
    return "À l'instant";
  }

  // Moins d'une heure
  if (diff < 60 * 60 * 1000) {
    const mins = Math.floor(diff / (60 * 1000));
    return `Il y a ${mins} min`;
  }

  const d = new Date(timestamp);
  const today = new Date();
  const isToday = d.getDate() === today.getDate() &&
                  d.getMonth() === today.getMonth() &&
                  d.getFullYear() === today.getFullYear();

  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  if (isToday) {
    return `Aujourd'hui à ${hours}:${minutes}`;
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() &&
                      d.getMonth() === yesterday.getMonth() &&
                      d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `Hier à ${hours}:${minutes}`;
  }

  // Date complète
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Charge et affiche un élément d'accès rapide dans l'application
 */
export const navigateToQuickAccessItem = async (
  item: QuickAccessItem,
  store: {
    setSelectedSermonId: (id: string | null) => Promise<void>;
    setLibraryMode: (mode: 'sermons' | 'bible' | 'expose' | 'songs') => void;
    setSelectedBibleBookId?: (id: string | null) => void;
    setSelectedBibleChapter?: (ch: number | null) => void;
    setSelectedBibleVerse?: (v: number | null) => void;
    setJumpToParagraph?: (p: number | null) => void;
  }
) => {
  if (item.type === 'bible') {
    store.setLibraryMode('bible');
    if (item.bibleBookId && store.setSelectedBibleBookId) {
      store.setSelectedBibleBookId(item.bibleBookId);
    }
    if (item.bibleChapter && store.setSelectedBibleChapter) {
      store.setSelectedBibleChapter(item.bibleChapter);
    }
    if (item.bibleVerse && store.setSelectedBibleVerse) {
      store.setSelectedBibleVerse(item.bibleVerse);
    }
    await store.setSelectedSermonId(item.targetId);
    if (item.paragraphIndex && store.setJumpToParagraph) {
      store.setJumpToParagraph(item.paragraphIndex);
    }
  } else if (item.type === 'expose') {
    store.setLibraryMode('expose');
    await store.setSelectedSermonId(item.targetId);
    if (item.paragraphIndex && store.setJumpToParagraph) {
      store.setJumpToParagraph(item.paragraphIndex);
    }
  } else if (item.type === 'song') {
    store.setLibraryMode('songs');
    await store.setSelectedSermonId(item.targetId);
    if (item.paragraphIndex && store.setJumpToParagraph) {
      store.setJumpToParagraph(item.paragraphIndex);
    }
  } else {
    // sermon
    store.setLibraryMode('sermons');
    await store.setSelectedSermonId(item.targetId);
    if (item.paragraphIndex && store.setJumpToParagraph) {
      store.setJumpToParagraph(item.paragraphIndex);
    }
  }
};

