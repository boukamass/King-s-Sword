
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
  getSermonsCount
} from './services/db';
import { normalizeText } from './utils/textUtils';

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
  sermonsMap: Record<string, Omit<Sermon, 'text'>>;
  activeSermon: Sermon | null; 
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
  searchQuery: string;
  searchMode: SearchMode;
  searchResults: SearchResult[];
  isFullTextSearch: boolean;
  cityFilter: string | null;
  yearFilter: string | null;
  languageFilter: string;
  fontSize: number;
  theme: 'light' | 'dark' | 'system';
  notifications: Notification[];
  chatHistory: Record<string, ChatMessage[]>;
  pendingStudyRequest: string | null;
  jumpToText: string | null;
  projectionBlackout: boolean;
  isExternalMaskOpen: boolean;

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
  setFontSize: (size: number) => void;
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
}

export const useAppStore = create<AppState>((set, get) => ({
  sermons: [],
  sermonsMap: {},
  activeSermon: null,
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
  loadingMessage: "Initialisation...",
  loadingProgress: 0,
  searchQuery: '',
  searchMode: SearchMode.EXACT_PHRASE,
  isFullTextSearch: false,
  cityFilter: null,
  yearFilter: null,
  languageFilter: 'Français',
  fontSize: 20,
  theme: 'system',
  notifications: [],
  chatHistory: {},
  pendingStudyRequest: null,
  jumpToText: null,
  projectionBlackout: false,
  isExternalMaskOpen: false,

  initializeDB: async () => {
    set({ isLoading: true, loadingMessage: "Accès SQLite..." });
    try {
      const count = await getSermonsCount();
      if (count === 0) {
        await get().resetLibrary();
      } else {
        const metadata = await getAllSermonsMetadata();
        const map: any = {};
        metadata.forEach(s => map[s.id] = s);
        const notes = await getAllNotes();
        set({ sermons: metadata, sermonsMap: map, notes });
      }
    } catch (error) {
      get().addNotification("Erreur de connexion SQLite", 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  resetLibrary: async () => {
    set({ isLoading: true, loadingMessage: "Importation...", loadingProgress: 20 });
    try {
      const response = await fetch('library.json');
      const incoming: Sermon[] = await response.json();
      set({ loadingProgress: 50, loadingMessage: "Indexation FTS5..." });
      await bulkAddSermons(incoming);
      const metadata = await getAllSermonsMetadata();
      const map: any = {};
      metadata.forEach(s => map[s.id] = s);
      set({ sermons: metadata, sermonsMap: map, loadingProgress: 100 });
    } catch (error) {
      get().addNotification("Échec de l'importation.", 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  setSelectedSermonId: async (id) => {
    if (!id) {
      set({ selectedSermonId: null, activeSermon: null });
      return;
    }
    set({ selectedSermonId: id });
    try {
      const fullSermon = await getSermonById(id);
      set({ activeSermon: fullSermon });
      if (id && !get().contextSermonIds.includes(id)) {
        set(s => ({ contextSermonIds: [...s.contextSermonIds, id] }));
      }
    } catch (error) {
      get().addNotification("Erreur lecture SQLite", "error");
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
    const updatedNotes = [...get().notes, newNote];
    set({ notes: updatedNotes });
    await saveNoteToDB(newNote);
  },

  updateNote: async (id, updates) => {
    const updatedNotes = get().notes.map(n => n.id === id ? { ...n, ...updates } : n);
    set({ notes: updatedNotes });
    const note = updatedNotes.find(n => n.id === id);
    if (note) await saveNoteToDB(note);
  },

  deleteNote: async (id) => {
    set(state => ({ notes: state.notes.filter(n => n.id !== id), activeNoteId: state.activeNoteId === id ? null : state.activeNoteId }));
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
  setFontSize: (s) => set({ fontSize: s }),
  setTheme: (t) => set({ theme: t }),
  toggleContextSermon: (id) => set(s => ({
    contextSermonIds: s.contextSermonIds.includes(id) ? s.contextSermonIds.filter(x => x !== id) : [...s.contextSermonIds, id]
  })),
  clearContextSermons: () => set({ contextSermonIds: [] }),
  triggerStudyRequest: (t) => set({ pendingStudyRequest: t, aiOpen: true }),
  setJumpToText: (t) => set({ jumpToText: t }),
  updateSermonHighlights: (id, h) => {}, // Facultatif
  setProjectionBlackout: (v) => set({ projectionBlackout: v }),
  setExternalMaskOpen: (v) => set({ isExternalMaskOpen: v })
}));
