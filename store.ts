
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
  sermonsMap: Map<string, Sermon | Omit<Sermon, 'text'>>;
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
  includeSynonyms: boolean;
  showOnlySynonyms: boolean;
  showOnlyQuery: boolean;
  activeSynonyms: string[];
  cityFilter: string | null;
  yearFilter: string | null;
  monthFilter: string | null;
  dayFilter: string | null;
  versionFilter: string | null;
  timeFilter: string | null;
  audioFilter: boolean;
  languageFilter: string;
  fontSize: number;
  theme: 'light' | 'dark' | 'system';
  notifications: Notification[];
  chatHistory: Record<string, ChatMessage[]>;
  pendingStudyRequest: string | null;
  jumpToText: string | null;
  jumpToParagraph: number | null;
  projectionBlackout: boolean;
  isExternalMaskOpen: boolean;
  sidebarWidth: number;
  aiWidth: number;
  notesWidth: number;
  navigatedFromSearch: boolean;
  navigatedFromNoteId: string | null;
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
  setIncludeSynonyms: (active: boolean) => void;
  setShowOnlySynonyms: (active: boolean) => void;
  setShowOnlyQuery: (active: boolean) => void;
  setActiveSynonyms: (syns: string[]) => void;
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
  setMonthFilter: (month: string | null) => void;
  setDayFilter: (day: string | null) => void;
  setVersionFilter: (v: string | null) => void;
  setTimeFilter: (v: string | null) => void;
  setAudioFilter: (v: boolean) => void;
  resetFilters: () => void;
  setFontSize: (updater: number | ((size: number) => number)) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  addChatMessage: (key: string, message: ChatMessage) => void;
  toggleContextSermon: (id: string) => void;
  setManualContextIds: (ids: string[]) => void;
  clearContextSermons: () => void;
  addNote: (note: Partial<Note>) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  addCitationToNote: (noteId: string, citation: Partial<Citation>) => void;
  reorderNotes: (draggedId: string, targetId: string) => void;
  triggerStudyRequest: (text: string | null) => void;
  setJumpToText: (text: string | null) => void;
  setJumpToParagraph: (num: number | null) => void;
  updateSermonHighlights: (id: string, highlights: Highlight[]) => void;
  setProjectionBlackout: (v: boolean) => void;
  setExternalMaskOpen: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setAiWidth: (w: number) => void;
  setNotesWidth: (w: number) => void;
  setNavigatedFromSearch: (v: boolean) => void;
  setNavigatedFromNoteId: (id: string | null) => void;
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
  includeSynonyms: false,
  showOnlySynonyms: false,
  showOnlyQuery: false,
  activeSynonyms: [],
  cityFilter: null,
  yearFilter: null,
  monthFilter: null,
  dayFilter: null,
  versionFilter: null, 
  timeFilter: null,
  audioFilter: false,
  languageFilter: 'Français',
  fontSize: 20,
  theme: 'system',
  notifications: [],
  chatHistory: {},
  pendingStudyRequest: null,
  jumpToText: null,
  jumpToParagraph: null,
  projectionBlackout: false,
  isExternalMaskOpen: false,
  sidebarWidth: 320,
  aiWidth: 400,
  notesWidth: 350,
  navigatedFromSearch: false,
  navigatedFromNoteId: null,
  lastSearchQuery: '',
  lastSearchMode: SearchMode.EXACT_PHRASE,
  isSqliteAvailable: true,

  initializeDB: async () => {
    set({ isLoading: true, loadingMessage: "Accès à la base...", loadingProgress: 10 });
    const hasSqlite = await isDatabaseReady();
    set({ isSqliteAvailable: hasSqlite, loadingProgress: 25 });
    
    try {
      if (!hasSqlite) {
        set({ loadingMessage: "Chargement des sermons...", loadingProgress: 35 });
        const response = await fetch('library.json');
        set({ loadingProgress: 60 });
        const data: Sermon[] = await response.json();
        set({ loadingProgress: 80 });
        
        const uniqueMetadata: Omit<Sermon, 'text'>[] = [];
        const seenIds = new Set<string>();
        const map = new Map();
        
        data.forEach(s => {
          const uniqueKey = s.version ? `${s.id}-${s.version}` : s.id;
          if (!seenIds.has(uniqueKey)) {
            seenIds.add(uniqueKey);
            const { text, ...meta } = s;
            const metaWithUniqueId = { ...meta, id: uniqueKey };
            uniqueMetadata.push(metaWithUniqueId);
            map.set(uniqueKey, { ...s, id: uniqueKey });
          }
        });

        const notes = await getAllNotes();
        set({ sermons: uniqueMetadata, sermonsMap: map, notes, isLoading: false, loadingProgress: 100 });
        return;
      }

      set({ loadingMessage: "Vérification de la bibliothèque...", loadingProgress: 40 });
      const count = await getSermonsCount();
      if (count === 0) {
        await get().resetLibrary();
      } else {
        set({ loadingMessage: "Chargement des métadonnées...", loadingProgress: 55 });
        const metadata = await getAllSermonsMetadata();
        set({ loadingProgress: 85 });
        const map = new Map();
        
        metadata.forEach(s => {
            map.set(s.id, s);
        });

        const notes = await getAllNotes();
        set({ sermons: metadata, sermonsMap: map, notes, isLoading: false, loadingProgress: 100 });
      }
    } catch (error) {
      console.error("DB Init Error:", error);
      get().addNotification("Erreur d'initialisation", 'error');
      set({ isLoading: false, loadingProgress: 0 });
    }
  },

  resetLibrary: async () => {
    set({ isLoading: true, loadingMessage: "Récupération des données...", loadingProgress: 15 });
    try {
      const response = await fetch('library.json');
      set({ loadingProgress: 40 });
      if (!response.ok) {
        throw new Error(`Le fichier library.json est manquant ou inaccessible`);
      }
      
      let incoming: Sermon[];
      try {
        incoming = await response.json();
        set({ loadingProgress: 55 });
      } catch (parseError) {
        throw new Error("Le format du fichier library.json est invalide.");
      }
      
      if (!Array.isArray(incoming)) {
        throw new Error("Les données importées doivent être une liste de sermons.");
      }

      if (get().isSqliteAvailable) {
        set({ loadingProgress: 65, loadingMessage: "Indexation SQLite..." });
        const result = await bulkAddSermons(incoming);
        set({ loadingProgress: 90 });
        
        if (!result || !result.success) {
          throw new Error(result?.error || "L'indexation SQLite a échoué.");
        }
      }
      
      const uniqueMetadata: Omit<Sermon, 'text'>[] = [];
      const seenIds = new Set<string>();
      const map = new Map();
      
      incoming.forEach(s => {
        const baseId = s.id || `gen-${Math.random().toString(36).substr(2, 9)}`;
        const uniqueKey = s.version ? `${baseId}-${s.version}` : baseId;
        
        if (!seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          const { text, ...meta } = s;
          const metaWithUniqueId = { ...meta, id: uniqueKey };
          uniqueMetadata.push(metaWithUniqueId);
          
          if (!get().isSqliteAvailable) {
            map.set(uniqueKey, { ...s, id: uniqueKey });
          } else {
            map.set(uniqueKey, metaWithUniqueId);
          }
        }
      });
      
      const notes = await getAllNotes();
      
      set({ 
        sermons: uniqueMetadata, 
        sermonsMap: map, 
        notes,
        loadingProgress: 100,
        isLoading: false,
        loadingMessage: null,
        contextSermonIds: [],
        manualContextIds: [],
        selectedSermonId: null,
        activeSermon: null
      });
      
      get().addNotification("Bibliothèque importée avec succès", "success");
    } catch (error: any) {
      console.error("Import failure:", error);
      get().addNotification(`Échec de l'importation : ${error.message}`, 'error');
      set({ isLoading: false, loadingMessage: null, loadingProgress: 0 });
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

  setSearchQuery: (query) => set({ searchQuery: query, lastSearchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode, lastSearchMode: mode }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (val) => set({ isSearching: val }),
  setIsFullTextSearch: (active) => set({ isFullTextSearch: active }),
  setIncludeSynonyms: (active) => set({ includeSynonyms: active, showOnlySynonyms: false, showOnlyQuery: false }),
  setShowOnlySynonyms: (active) => set({ showOnlySynonyms: active, showOnlyQuery: active ? false : get().showOnlyQuery }),
  setShowOnlyQuery: (active) => set({ showOnlyQuery: active, showOnlySynonyms: active ? false : get().showOnlySynonyms }),
  setActiveSynonyms: (syns) => set({ activeSynonyms: syns }),
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
  setMonthFilter: (f) => set({ monthFilter: f }),
  setDayFilter: (f) => set({ dayFilter: f }),
  setVersionFilter: (f) => set({ versionFilter: f }),
  setTimeFilter: (f) => set({ timeFilter: f }),
  setAudioFilter: (f) => set({ audioFilter: f }),
  resetFilters: () => set({
    cityFilter: null,
    yearFilter: null,
    monthFilter: null,
    dayFilter: null,
    versionFilter: null,
    timeFilter: null,
    audioFilter: false
  }),
  setFontSize: (updater) => set(state => {
    const newSize = typeof updater === 'function' ? updater(state.fontSize) : updater;
    return { fontSize: Math.max(8, Math.min(150, newSize)) };
  }),
  setTheme: (t) => set({ theme: t }),
  
  addChatMessage: (key, message) => set(state => {
    const history = state.chatHistory[key] || [];
    return {
      chatHistory: {
        ...state.chatHistory,
        [key]: [...history, message]
      }
    };
  }),

  toggleContextSermon: (id) => set(s => {
    const isManual = s.manualContextIds.includes(id);
    const newManual = isManual 
      ? s.manualContextIds.filter(x => x !== id) 
      : [...s.manualContextIds, id];
    
    const activeId = s.selectedSermonId;
    const newContext = Array.from(new Set([activeId, ...newManual].filter(Boolean) as string[]));
    
    return { manualContextIds: newManual, contextSermonIds: newContext };
  }),

  setManualContextIds: (ids) => set(s => {
    const activeId = s.selectedSermonId;
    const newContext = Array.from(new Set([activeId, ...ids].filter(Boolean) as string[]));
    return { manualContextIds: ids, contextSermonIds: newContext };
  }),

  clearContextSermons: () => set(s => {
    const activeId = s.selectedSermonId;
    return { manualContextIds: [], contextSermonIds: activeId ? [activeId] : [] };
  }),

  addNote: async (partial) => {
    const palette = ['default', 'sky', 'teal', 'amber', 'rose', 'violet'];
    const randomColor = palette[Math.floor(Math.random() * palette.length)];
    
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: partial.title || 'Nouvelle Note',
      content: partial.content || '',
      citations: partial.citations || [],
      creationDate: new Date().toISOString(),
      date: new Date().toISOString(),
      order: get().notes.length,
      color: partial.color || randomColor,
      ...partial
    };
    set(state => ({ 
      notes: [...state.notes, newNote], 
      activeNoteId: newNote.id,
      notesOpen: true 
    }));
    await saveNoteToDB(newNote);
  },

  updateNote: async (id, updates) => {
    const { notes } = get();
    const newNotes = notes.map(n => n.id === id ? { ...n, ...updates } : n);
    set({ notes: newNotes });
    const updatedNote = newNotes.find(n => n.id === id);
    if (updatedNote) await saveNoteToDB(updatedNote);
  },

  deleteNote: async (id) => {
    const { notes, activeNoteId } = get();
    const newNotes = notes.filter(n => n.id !== id);
    set({ 
      notes: newNotes,
      activeNoteId: activeNoteId === id ? null : activeNoteId
    });
    await deleteNoteFromDB(id);
  },

  addCitationToNote: async (noteId, partialCitation) => {
    const { notes } = get();
    const noteIndex = notes.findIndex(n => n.id === noteId);
    if (noteIndex === -1) return;

    const citation: Citation = {
      id: crypto.randomUUID(),
      date_added: new Date().toISOString(),
      sermon_id: partialCitation.sermon_id || '',
      sermon_title_snapshot: partialCitation.sermon_title_snapshot || '',
      sermon_date_snapshot: partialCitation.sermon_date_snapshot || '',
      quoted_text: partialCitation.quoted_text || '',
      ...partialCitation
    } as Citation;

    const updatedNotes = [...notes];
    updatedNotes[noteIndex] = {
      ...updatedNotes[noteIndex],
      citations: [...updatedNotes[noteIndex].citations, citation]
    };

    set({ notes: updatedNotes });
    await saveNoteToDB(updatedNotes[noteIndex]);
  },

  reorderNotes: (draggedId, targetId) => {
    const { notes } = get();
    const draggedIndex = notes.findIndex(n => n.id === draggedId);
    const targetIndex = notes.findIndex(n => n.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newNotes = [...notes];
    const [removed] = newNotes.splice(draggedIndex, 1);
    newNotes.splice(targetIndex, 0, removed);

    const updatedNotes = newNotes.map((n, i) => ({ ...n, order: i }));
    set({ notes: updatedNotes });
    syncNotesOrder(updatedNotes);
  },

  triggerStudyRequest: (t) => set({ pendingStudyRequest: t, aiOpen: true }),
  setJumpToText: (t) => set({ jumpToText: t }),
  setJumpToParagraph: (num) => set({ jumpToParagraph: num }),
  
  updateSermonHighlights: (id, highlights) => set(state => {
    const activeSermon = state.activeSermon;
    let newActiveSermon = activeSermon;
    
    if (activeSermon && activeSermon.id === id) {
      newActiveSermon = { ...(activeSermon as Sermon), highlights };
    }

    const newSermonsMap = new Map(state.sermonsMap);
    const existingInMap = newSermonsMap.get(id);
    if (existingInMap && typeof existingInMap === 'object') {
      newSermonsMap.set(id, { ...existingInMap, highlights });
    }

    return { 
      activeSermon: newActiveSermon, 
      sermonsMap: newSermonsMap 
    };
  }),

  setProjectionBlackout: (v) => set({ projectionBlackout: v }),
  setExternalMaskOpen: (v) => set({ isExternalMaskOpen: v }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setAiWidth: (w) => set({ aiWidth: w }),
  setNotesWidth: (w) => set({ notesWidth: w }),
  setNavigatedFromSearch: (v) => set({ navigatedFromSearch: v }),
  setNavigatedFromNoteId: (id) => set({ navigatedFromNoteId: id })
}));
