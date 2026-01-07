
import { create } from 'zustand';
import { Sermon, Note, ChatMessage, SearchMode, Notification, Citation, Highlight } from './types';
import { 
  initDB, 
  getSermonsCount,
  getAllSermonsMetadata,
  bulkAddSermons, 
  getSermonById,
  updateSermon, 
  getAllNotes, 
  putNote, 
  deleteNoteFromDB,
} from './services/db';
import { normalizeText } from './utils/textUtils';

const systemLang = navigator.language.startsWith('fr') ? 'Français' : 'Anglais';
const NOTE_COLORS = ['sky', 'teal', 'amber', 'rose', 'violet', 'lime', 'orange'];

export interface OptimizedSermon extends Omit<Sermon, 'text'> {
  _normalizedTitle?: string;
}

export interface SearchResult {
  sermonId: string;
  title: string;
  date: string;
  city: string;
  paragraphIndex: number;
  snippet?: string; // Chargé dynamiquement par le composant SearchResults
}

interface AppState {
  sermons: OptimizedSermon[];
  sermonsMap: Record<string, OptimizedSermon>;
  activeSermon: Sermon | null; 
  dbInitialized: boolean;
  notes: Note[];
  selectedSermonId: string | null;
  activeNoteId: string | null;
  contextSermonIds: string[];
  sidebarOpen: boolean;
  aiOpen: boolean;
  notesOpen: boolean;
  isLoading: boolean;
  isSearching: boolean;
  loadingMessage: string | null;
  loadingProgress: number;
  sidebarWidth: number;
  aiWidth: number;
  notesWidth: number;
  searchQuery: string;
  searchMode: SearchMode;
  searchResults: SearchResult[];
  lastSearchQuery: string;
  lastSearchMode: SearchMode;
  navigatedFromSearch: boolean;
  isFullTextSearch: boolean;
  cityFilter: string | null;
  yearFilter: string | null;
  languageFilter: string;
  versionFilter: string | null;
  timeFilter: string | null;
  chatHistory: Record<string, ChatMessage[]>;
  projectionMode: boolean;
  isExternalProjectionOpen: boolean;
  isExternalMaskOpen: boolean;
  projectionBlackout: boolean;
  fontSize: number;
  pendingStudyRequest: string | null;
  jumpToText: string | null;
  theme: 'light' | 'dark' | 'system';
  notifications: Notification[];

  initializeDB: () => Promise<void>;
  resetLibrary: () => Promise<void>;
  setSelectedSermonId: (id: string | null) => Promise<void>;
  setActiveNoteId: (id: string | null) => void;
  toggleContextSermon: (id: string) => void;
  clearContextSermons: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleAI: () => void;
  setAiOpen: (open: boolean) => void;
  toggleNotes: () => void;
  setNotesOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setAiWidth: (width: number) => void;
  setNotesWidth: (width: number) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setIsSearching: (val: boolean) => void;
  setLastSearchQuery: (query: string) => void;
  setLastSearchMode: (mode: SearchMode) => void;
  setNavigatedFromSearch: (navigated: boolean) => void;
  setIsFullTextSearch: (active: boolean) => void;
  setCityFilter: (city: string | null) => void;
  setYearFilter: (year: string | null) => void;
  setLanguageFilter: (lang: string) => void;
  setVersionFilter: (version: string | null) => void;
  setTimeFilter: (time: string | null) => void;
  updateSermonTitle: (id: string, newTitle: string) => Promise<void>;
  updateSermonHighlights: (sermonId: string, highlights: Highlight[]) => Promise<void>;
  addNote: (note: Omit<Note, 'id' | 'date' | 'creationDate' | 'order'>) => Promise<void>;
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'color'>>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  reorderNotes: (draggedId: string, dropTargetId: string) => Promise<void>;
  addCitationToNote: (noteId: string, citationData: Omit<Citation, 'id' | 'date_added'>) => Promise<void>;
  deleteCitation: (noteId: string, citationId: string) => Promise<void>;
  addChatMessage: (sermonId: string, message: ChatMessage) => void;
  toggleProjectionMode: () => void;
  setExternalProjectionOpen: (open: boolean) => void;
  setExternalMaskOpen: (open: boolean) => void;
  setProjectionBlackout: (blackout: boolean) => void;
  setFontSize: (size: number) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  triggerStudyRequest: (text: string | null) => void;
  setJumpToText: (text: string | null) => void;
  addNotification: (message: string, type: 'success' | 'error') => void;
  removeNotification: (id: string) => void;
}

const sortNotesByOrder = (notes: Note[]) => [...notes].sort((a, b) => a.order - b.order);

export const useAppStore = create<AppState>((set, get) => ({
  sermons: [],
  sermonsMap: {},
  activeSermon: null,
  dbInitialized: false,
  notes: [], 
  selectedSermonId: null,
  activeNoteId: null,
  contextSermonIds: [], 
  sidebarOpen: true,
  aiOpen: false,
  notesOpen: false,
  isLoading: true,
  isSearching: false,
  searchResults: [],
  loadingMessage: "Démarrage...",
  loadingProgress: 0,
  sidebarWidth: parseInt(localStorage.getItem('sidebarWidth') || '280'),
  aiWidth: parseInt(localStorage.getItem('aiWidth') || '320'),
  notesWidth: parseInt(localStorage.getItem('notesWidth') || '300'),
  searchQuery: '',
  searchMode: SearchMode.EXACT_PHRASE,
  lastSearchQuery: '',
  lastSearchMode: SearchMode.EXACT_PHRASE,
  navigatedFromSearch: false,
  isFullTextSearch: false,
  cityFilter: null,
  yearFilter: null,
  languageFilter: systemLang,
  versionFilter: null,
  timeFilter: null,
  chatHistory: {},
  projectionMode: false,
  isExternalProjectionOpen: false,
  isExternalMaskOpen: false,
  projectionBlackout: false,
  fontSize: parseInt(localStorage.getItem('fontSize') || '20'),
  pendingStudyRequest: null,
  jumpToText: null,
  theme: (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system',
  notifications: [],

  initializeDB: async () => {
    set({ isLoading: true, loadingMessage: "Vérification système...", loadingProgress: 5 });
    try {
      await initDB();
      const notesFromDB = await getAllNotes();
      set({ notes: sortNotesByOrder(notesFromDB), dbInitialized: true });

      const count = await getSermonsCount();
      if (count === 0) {
        await get().resetLibrary();
      } else {
        set({ loadingMessage: "Lecture de l'index...", loadingProgress: 30 });
        const metadata = await getAllSermonsMetadata();
        const optimized = metadata.map(s => ({
            ...s,
            _normalizedTitle: normalizeText(s.title || '')
        })).sort((a, b) => b.date.localeCompare(a.date));
        
        const map: Record<string, OptimizedSermon> = {};
        optimized.forEach(s => map[s.id] = s);
        
        set({ sermons: optimized, sermonsMap: map, loadingProgress: 100 });
      }
    } catch (error) {
      console.error(error);
      get().addNotification("Erreur d'accès aux données.", 'error');
    } finally {
      setTimeout(() => set({ isLoading: false }), 300);
    }
  },

  resetLibrary: async () => {
    set({ isLoading: true, loadingMessage: "Synchronisation...", loadingProgress: 10 });
    try {
      const response = await fetch('library.json');
      const incoming: Sermon[] = await response.json();
      await bulkAddSermons(incoming, true);
      
      const metadata = await getAllSermonsMetadata();
      const optimized = metadata.map(s => ({
          ...s,
          _normalizedTitle: normalizeText(s.title || '')
      })).sort((a, b) => b.date.localeCompare(a.date));
      
      const map: Record<string, OptimizedSermon> = {};
      optimized.forEach(s => map[s.id] = s);
      
      set({ sermons: optimized, sermonsMap: map, loadingProgress: 100 });
      get().addNotification("Bibliothèque synchronisée.", 'success');
    } catch (error) {
      get().addNotification("Échec de la synchronisation.", 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  setSelectedSermonId: async (id) => {
    if (!id) {
      set({ selectedSermonId: null, activeSermon: null });
      return;
    }
    
    if (get().selectedSermonId === id && get().activeSermon) return;

    set({ selectedSermonId: id });
    try {
      // Chargement granulaire du texte complet uniquement lors de la sélection
      const fullSermon = await getSermonById(id);
      set({ activeSermon: fullSermon, contextSermonIds: [id] });
    } catch (error) {
      get().addNotification("Erreur de chargement.", "error");
    }
  },

  setActiveNoteId: (id) => set({ activeNoteId: id }),
  toggleContextSermon: (id) => set((state) => ({
    contextSermonIds: state.contextSermonIds.includes(id) 
      ? state.contextSermonIds.filter(cid => cid !== id) 
      : [...state.contextSermonIds, id]
  })),
  clearContextSermons: () => set({ contextSermonIds: [] }),
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleAI: () => set((state) => ({ aiOpen: !state.aiOpen })),
  setAiOpen: (open) => set({ aiOpen: open }),
  toggleNotes: () => set((state) => ({ notesOpen: !state.notesOpen })),
  setNotesOpen: (open) => set({ notesOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setAiWidth: (width) => set({ aiWidth: width }),
  setNotesWidth: (width) => set({ notesWidth: width }),
  
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (val) => set({ isSearching: val }),
  setLastSearchQuery: (query) => set({ lastSearchQuery: query }),
  setLastSearchMode: (mode) => set({ lastSearchMode: mode }),
  setNavigatedFromSearch: (navigated) => set({ navigatedFromSearch: navigated }),
  setIsFullTextSearch: (active) => set({ isFullTextSearch: active }),
  
  setCityFilter: (city) => set({ cityFilter: city }),
  setYearFilter: (year) => set({ yearFilter: year }),
  setLanguageFilter: (lang) => set({ languageFilter: lang }),
  setVersionFilter: (version) => set({ versionFilter: version }),
  setTimeFilter: (time) => set({ timeFilter: time }),

  updateSermonTitle: async (id, newTitle) => {
    const s = await getSermonById(id);
    if (!s) return;
    const updated = { ...s, title: newTitle };
    await updateSermon(updated);
    const map = { ...get().sermonsMap };
    if (map[id]) map[id] = { ...map[id], title: newTitle, _normalizedTitle: normalizeText(newTitle) };
    set({ 
        sermons: get().sermons.map(m => m.id === id ? { ...m, title: newTitle, _normalizedTitle: normalizeText(newTitle) } : m),
        sermonsMap: map,
        activeSermon: get().selectedSermonId === id ? updated : get().activeSermon
    });
  },

  updateSermonHighlights: async (sermonId, highlights) => {
    const active = get().activeSermon;
    if (active && active.id === sermonId) {
      const updated = { ...active, highlights };
      set({ activeSermon: updated });
      updateSermon(updated).catch(() => get().addNotification("Erreur sauvegarde.", "error"));
    }
  },

  addNote: async (noteData) => {
    const now = new Date().toISOString();
    const notes = get().notes;
    const minOrder = notes.length > 0 ? Math.min(...notes.map(n => n.order)) : 0;
    const newNote: Note = {
      ...noteData,
      id: crypto.randomUUID(),
      citations: (noteData.citations as any[]).map(c => ({...c, id: crypto.randomUUID(), date_added: now})),
      creationDate: now,
      date: now,
      color: noteData.color || NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
      order: minOrder - 1,
    };
    await putNote(newNote);
    set((state) => ({ notes: sortNotesByOrder([newNote, ...state.notes]) }));
  },

  updateNote: async (id, updates) => {
    const n = get().notes.find(n => n.id === id);
    if (!n) return;
    const updated = { ...n, ...updates, date: new Date().toISOString() };
    await putNote(updated);
    set((state) => ({ notes: sortNotesByOrder(state.notes.map(x => x.id === id ? updated : x)) }));
  },

  deleteNote: async (id) => {
    await deleteNoteFromDB(id);
    set((state) => ({ 
      notes: state.notes.filter(n => n.id !== id),
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId
    }));
  },

  reorderNotes: async (draggedId, dropTargetId) => {
    const notes = [...get().notes];
    const draggedIdx = notes.findIndex(n => n.id === draggedId);
    const dropIdx = notes.findIndex(n => n.id === dropTargetId);
    const [item] = notes.splice(draggedIdx, 1);
    notes.splice(dropIdx, 0, item);
    const updated = notes.map((n, i) => ({ ...n, order: i }));
    set({ notes: updated });
    for (const n of updated) await putNote(n);
  },

  addCitationToNote: async (noteId, citationData) => {
    const n = get().notes.find(n => n.id === noteId);
    if (!n) return;
    const newCit = { ...citationData, id: crypto.randomUUID(), date_added: new Date().toISOString() };
    const updated = { ...n, citations: [newCit, ...n.citations], date: new Date().toISOString() };
    await putNote(updated);
    set(state => ({ notes: sortNotesByOrder(state.notes.map(x => x.id === noteId ? updated : x)) }));
  },

  deleteCitation: async (noteId, citationId) => {
    const n = get().notes.find(n => n.id === noteId);
    if (!n) return;
    const updated = { ...n, citations: n.citations.filter(c => c.id !== citationId), date: new Date().toISOString() };
    await putNote(updated);
    set(state => ({ notes: sortNotesByOrder(state.notes.map(x => x.id === noteId ? updated : x)) }));
  },

  addChatMessage: (sermonId, message) => set((state) => {
    const history = { ...state.chatHistory };
    const key = sermonId || 'global';
    history[key] = [...(history[key] || []), message];
    return { chatHistory: history };
  }),

  toggleProjectionMode: () => set((state) => ({ projectionMode: !state.projectionMode })),
  setExternalProjectionOpen: (open) => set({ isExternalProjectionOpen: open }),
  setExternalMaskOpen: (open) => set({ isExternalMaskOpen: open }),
  setProjectionBlackout: (blackout) => set({ projectionBlackout: blackout }),
  setFontSize: (size) => set({ fontSize: Math.max(8, Math.min(150, size)) }),
  setTheme: (theme) => set({ theme }),
  triggerStudyRequest: (text) => set({ pendingStudyRequest: text, aiOpen: text !== null }),
  setJumpToText: (text) => set({ jumpToText: text }),
  addNotification: (message, type) => set(state => ({
    notifications: [{ id: crypto.randomUUID(), message, type }, ...state.notifications]
  })),
  removeNotification: (id) => set(state => ({
    notifications: state.notifications.filter(n => n.id !== id)
  })),
}));
