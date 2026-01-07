
import { create } from 'zustand';
import { Sermon, Note, ChatMessage, SearchMode, Notification, Citation, Highlight } from './types';
import { 
  getAllSermonsMetadata,
  bulkAddSermons, 
  getSermonById,
  getAllNotes,
  saveNoteToDB,
  deleteNoteFromDB,
  syncNotesOrder,
  getSermonsCount,
  isDatabaseReady
} from './services/db';

export interface SearchResult {
  paragraphId: string;
  sermonId: string;
  title: string;
  date: string;
  city: string;
  paragraphIndex: number;
  snippet?: string;
}

interface AppState {
  sermons: Omit<Sermon, 'text'>[];
  sermonsMap: Map<string, Omit<Sermon, 'text'>>;
  activeSermon: Sermon | null; 
  notes: Note[];
  selectedSermonId: string | null;
  activeNoteId: string | null;
  contextSermonIds: string[];
  manualContextIds: string[];
  sidebarOpen: boolean;
  aiOpen: boolean;
  notesOpen: boolean;
  isLoading: boolean;
  isSearching: boolean;
  loadingMessage: string | null;
  loadingProgress: number;
  searchQuery: string;
  searchMode: SearchMode;
  searchResults: SearchResult[];
  isFullTextSearch: boolean;
  cityFilter: string | null;
  yearFilter: string | null;
  versionFilter: string | null;
  timeFilter: string | null;
  languageFilter: string;
  fontSize: number;
  theme: 'light' | 'dark' | 'system';
  notifications: Notification[];
  chatHistory: Record<string, ChatMessage[]>;
  pendingStudyRequest: string | null;
  jumpToText: string | null;
  projectionBlackout: boolean;
  isExternalMaskOpen: boolean;
  sidebarWidth: number;
  aiWidth: number;
  notesWidth: number;
  navigatedFromSearch: boolean;
  lastSearchQuery: string;
  lastSearchMode: SearchMode;
  isSqliteAvailable: boolean;

  initializeDB: () => Promise<void>;
  resetLibrary: () => Promise<void>;
  setSelectedSermonId: (id: string | null) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setIsSearching: (val: boolean) => void;
  setIsFullTextSearch: (active: boolean) => void;
  addNotification: (message: string, type: 'success' | 'error') => void;
  removeNotification: (id: string) => void;
  setActiveNoteId: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleAI: () => void;
  toggleNotes: () => void;
  setSidebarOpen: (v: boolean) => void;
  setAiOpen: (v: boolean) => void;
  setNotesOpen: (v: boolean) => void;
  setCityFilter: (city: string | null) => void;
  setYearFilter: (year: string | null) => void;
  setVersionFilter: (v: string | null) => void;
  setTimeFilter: (v: string | null) => void;
  setFontSize: (updater: number | ((size: number) => number)) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  addChatMessage: (key: string, message: ChatMessage) => void;
  toggleContextSermon: (id: string) => void;
  clearContextSermons: () => void;
  addNote: (note: Partial<Note>) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  addCitationToNote: (noteId: string, citation: Partial<Citation>) => void;
  reorderNotes: (draggedId: string, targetId: string) => void;
  triggerStudyRequest: (text: string | null) => void;
  setJumpToText: (text: string | null) => void;
  updateSermonHighlights: (id: string, highlights: Highlight[]) => void;
  setProjectionBlackout: (v: boolean) => void;
  setExternalMaskOpen: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setAiWidth: (w: number) => void;
  setNotesWidth: (w: number) => void;
  setNavigatedFromSearch: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sermons: [],
  sermonsMap: new Map(),
  activeSermon: null,
  notes: [], 
  selectedSermonId: null,
  activeNoteId: null,
  contextSermonIds: [], 
  manualContextIds: [],
  sidebarOpen: true,
  aiOpen: false,
  notesOpen: false,
  isLoading: true,
  isSearching: false,
  searchResults: [],
  loadingMessage: "Initialisation...",
  loadingProgress: 0,
  searchQuery: '',
  searchMode: SearchMode.EXACT_PHRASE,
  isFullTextSearch: false,
  cityFilter: null,
  yearFilter: null,
  versionFilter: null,
  timeFilter: null,
  languageFilter: 'Français',
  fontSize: 20,
  theme: 'system',
  notifications: [],
  chatHistory: {},
  pendingStudyRequest: null,
  jumpToText: null,
  projectionBlackout: false,
  isExternalMaskOpen: false,
  sidebarWidth: 320,
  aiWidth: 400,
  notesWidth: 350,
  navigatedFromSearch: false,
  lastSearchQuery: '',
  lastSearchMode: SearchMode.EXACT_PHRASE,
  isSqliteAvailable: true,

  initializeDB: async () => {
    set({ isLoading: true, loadingMessage: "Accès à la base..." });
    const hasSqlite = await isDatabaseReady();
    set({ isSqliteAvailable: hasSqlite });
    
    try {
      if (!hasSqlite) {
        console.warn("SQLite non détecté, mode Web/Fallback activé.");
        const response = await fetch('library.json');
        const data: Sermon[] = await response.json();
        const map = new Map();
        data.forEach(s => map.set(s.id, s));
        const notes = await getAllNotes();
        set({ sermons: data, sermonsMap: map, notes, isLoading: false });
        return;
      }

      const count = await getSermonsCount();
      if (count === 0) {
        await get().resetLibrary();
      } else {
        const metadata = await getAllSermonsMetadata();
        const map = new Map();
        metadata.forEach(s => map.set(s.id, s));
        const notes = await getAllNotes();
        set({ sermons: metadata, sermonsMap: map, notes });
      }
    } catch (error) {
      console.error("DB Init Error:", error);
      get().addNotification("Erreur d'initialisation", 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  resetLibrary: async () => {
    set({ isLoading: true, loadingMessage: "Récupération des données...", loadingProgress: 10 });
    try {
      // S'assurer du chemin absolu relatif à l'application
      const response = await fetch('library.json');
      if (!response.ok) {
        throw new Error(`Le fichier library.json est manquant ou inaccessible (Status: ${response.status})`);
      }
      
      let incoming: Sermon[];
      try {
        incoming = await response.json();
      } catch (parseError) {
        throw new Error("Le format du fichier library.json est invalide.");
      }
      
      if (!Array.isArray(incoming)) {
        throw new Error("Les données importées doivent être une liste de sermons.");
      }

      if (get().isSqliteAvailable) {
        set({ loadingProgress: 40, loadingMessage: "Indexation SQLite..." });
        const result = await bulkAddSermons(incoming);
        
        if (!result || !result.success) {
          throw new Error(result?.error || "L'indexation SQLite a échoué.");
        }
      }
      
      const metadata = incoming.map(({text, ...meta}) => meta);
      const map = new Map();
      metadata.forEach(s => map.set(s.id, s));
      
      set({ 
        sermons: metadata as any, 
        sermonsMap: map, 
        loadingProgress: 100,
        isLoading: false,
        loadingMessage: null
      });
      
      get().addNotification("Bibliothèque importée avec succès", "success");
    } catch (error: any) {
      console.error("Import failure:", error);
      get().addNotification(`Échec de l'importation : ${error.message}`, 'error');
      set({ isLoading: false, loadingMessage: null });
    }
  },

  setSelectedSermonId: async (id) => {
    if (!id) {
      set({ selectedSermonId: null, activeSermon: null, contextSermonIds: get().manualContextIds });
      return;
    }
    
    const currentId = get().selectedSermonId;
    if (currentId === id && get().activeSermon) return; 

    set({ selectedSermonId: id, activeSermon: null }); 
    
    try {
      if (!get().isSqliteAvailable) {
        const s = get().sermonsMap.get(id) as Sermon;
        set({ activeSermon: s });
      } else {
        const fullSermon = await getSermonById(id);
        set({ activeSermon: fullSermon });
      }
      
      const manual = get().manualContextIds;
      const newContext = Array.from(new Set([id, ...manual].filter(Boolean) as string[]));
      set({ contextSermonIds: newContext });

    } catch (error) {
      get().addNotification("Erreur lors du chargement du sermon", "error");
    }
  },

  addNote: async (note) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: note.title || "Nouvelle Note",
      content: note.content || "",
      citations: note.citations || [],
      date: new Date().toISOString(),
      creationDate: new Date().toISOString(),
      order: get().notes.length,
      ...note
    };
    set(state => ({ notes: [...state.notes, newNote] }));
    await saveNoteToDB(newNote);
  },

  updateNote: async (id, updates) => {
    set(state => ({ 
      notes: state.notes.map(n => n.id === id ? { ...n, ...updates } : n) 
    }));
    const note = get().notes.find(n => n.id === id);
    if (note) await saveNoteToDB(note);
  },

  deleteNote: async (id) => {
    set(state => ({ 
      notes: state.notes.filter(n => n.id !== id), 
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId 
    }));
    await deleteNoteFromDB(id);
  },

  addCitationToNote: async (noteId, citation) => {
    const newCit: Citation = {
      id: crypto.randomUUID(),
      date_added: new Date().toISOString(),
      sermon_id: citation.sermon_id || "",
      sermon_title_snapshot: citation.sermon_title_snapshot || "",
      sermon_date_snapshot: citation.sermon_date_snapshot || "",
      quoted_text: citation.quoted_text || "",
    };
    const note = get().notes.find(n => n.id === noteId);
    if (note) {
      const updatedNote = { ...note, citations: [...note.citations, newCit] };
      set(state => ({ notes: state.notes.map(n => n.id === noteId ? updatedNote : n) }));
      await saveNoteToDB(updatedNote);
    }
  },

  reorderNotes: async (draggedId, targetId) => {
    const { notes } = get();
    const oldIndex = notes.findIndex(n => n.id === draggedId);
    const newIndex = notes.findIndex(n => n.id === targetId);
    if (oldIndex === -1 || newIndex === -1) return;
    const newNotes = [...notes];
    const [removed] = newNotes.splice(oldIndex, 1);
    newNotes.splice(newIndex, 0, removed);
    set({ notes: newNotes });
    await syncNotesOrder(newNotes);
  },

  addChatMessage: (key, msg) => set(s => ({
    chatHistory: { ...s.chatHistory, [key]: [...(s.chatHistory[key] || []), msg] }
  })),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (val) => set({ isSearching: val }),
  setIsFullTextSearch: (active) => set({ isFullTextSearch: active }),
  addNotification: (message, type) => set(state => ({
    notifications: [{ id: crypto.randomUUID(), message, type }, ...state.notifications]
  })),
  removeNotification: (id) => set(state => ({
    notifications: state.notifications.filter(n => n.id !== id)
  })),
  setActiveNoteId: (id) => set({ activeNoteId: id }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  toggleAI: () => set(s => ({ aiOpen: !s.aiOpen })),
  toggleNotes: () => set(s => ({ notesOpen: !s.notesOpen })),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setAiOpen: (v) => set({ aiOpen: v }),
  setNotesOpen: (v) => set({ notesOpen: v }),
  setCityFilter: (f) => set({ cityFilter: f }),
  setYearFilter: (f) => set({ yearFilter: f }),
  setVersionFilter: (f) => set({ versionFilter: f }),
  setTimeFilter: (f) => set({ timeFilter: f }),
  setFontSize: (updater) => set(state => {
    const newSize = typeof updater === 'function' ? updater(state.fontSize) : updater;
    return { fontSize: Math.max(8, Math.min(150, newSize)) };
  }),
  setTheme: (t) => set({ theme: t }),
  
  toggleContextSermon: (id) => set(s => {
    const isManual = s.manualContextIds.includes(id);
    const newManual = isManual 
      ? s.manualContextIds.filter(x => x !== id) 
      : [...s.manualContextIds, id];
    
    const activeId = s.selectedSermonId;
    const newContext = Array.from(new Set([activeId, ...newManual].filter(Boolean) as string[]));
    
    return { manualContextIds: newManual, contextSermonIds: newContext };
  }),

  clearContextSermons: () => set(s => {
    const activeId = s.selectedSermonId;
    return { manualContextIds: [], contextSermonIds: activeId ? [activeId] : [] };
  }),

  triggerStudyRequest: (t) => set({ pendingStudyRequest: t, aiOpen: true }),
  setJumpToText: (t) => set({ jumpToText: t }),
  updateSermonHighlights: (id, h) => {},
  setProjectionBlackout: (v) => set({ projectionBlackout: v }),
  setExternalMaskOpen: (v) => set({ isExternalMaskOpen: v }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setAiWidth: (w) => set({ aiWidth: w }),
  setNotesWidth: (w) => set({ notesWidth: w }),
  setNavigatedFromSearch: (v) => set({ navigatedFromSearch: v })
}));
