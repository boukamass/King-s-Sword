
import { Sermon, Note, SearchMode } from '../types';
import { normalizeText, getAccentInsensitiveRegex, getMultiWordHighlightRegex } from '../utils/textUtils';
import { useAppStore } from '../store';

const isElectron = !!window.electronAPI;

export const isDatabaseReady = async (): Promise<boolean> => {
  if (!isElectron) return false;
  try {
    return await window.electronAPI.db.isReady();
  } catch {
    return false;
  }
};

export const getAllSermonsMetadata = async (): Promise<Omit<Sermon, 'text'>[]> => {
  if (!isElectron) return [];
  return window.electronAPI.db.getSermonsMetadata();
};

export const getSermonsCount = async (): Promise<number> => {
  if (!isElectron) return 0;
  const meta = await window.electronAPI.db.getSermonsMetadata();
  return meta ? meta.length : 0;
};

export const getSermonById = async (id: string): Promise<Sermon | null> => {
  if (!isElectron) return null;
  return window.electronAPI.db.getSermonFull(id);
};

export const bulkAddSermons = async (sermons: Sermon[]): Promise<{ success: boolean; count: number; error?: string }> => {
  if (!isElectron) return { success: true, count: 0 };
  const result = await window.electronAPI.db.importSermons(sermons);
  if (!result) return { success: false, count: 0, error: "Réponse IPC vide" };
  
  return {
    success: result.success,
    count: result.count ?? 0,
    error: result.error
  };
};

/**
 * Moteur de recherche de secours pour le Web (Fallback)
 */
const webSearchFallback = async (params: { query: string; mode: SearchMode; limit: number; offset: number }): Promise<any[]> => {
  const store = useAppStore.getState();
  const sermonsMap = store.sermonsMap;
  const results: any[] = [];
  const query = params.query.trim().toLowerCase();
  
  if (!query) return [];

  const safeLimit = Math.min(params.limit, 50);
  const allSermons = Array.from(sermonsMap.values()) as Sermon[];
  const markClass = "bg-amber-400/40 dark:bg-amber-500/40 text-amber-950 dark:text-white font-bold px-0.5 rounded-sm shadow-sm border-b-2 border-amber-600/30";
  
  const highlightRegex = params.mode === SearchMode.EXACT_PHRASE 
    ? getAccentInsensitiveRegex(query, false)
    : getMultiWordHighlightRegex(query);

  const normalizedQuery = normalizeText(query);
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

  for (const s of allSermons) {
    if (!s.text) continue;
    
    const paragraphs = s.text.split(/\n\s*\n/);
    paragraphs.forEach((p, i) => {
      const content = p.trim();
      if (!content) return;
      
      const normalizedContent = normalizeText(content);
      
      let match = false;
      if (params.mode === SearchMode.EXACT_PHRASE) {
        match = normalizedContent.includes(normalizedQuery);
      } else if (params.mode === SearchMode.DIVERSE) {
        match = queryWords.some(w => normalizedContent.includes(w));
      } else { 
        match = queryWords.every(w => normalizedContent.includes(w));
      }

      if (match) {
        const snippetRaw = content.replace(highlightRegex, (m) => `<mark class="${markClass}">${m}</mark>`);
        
        results.push({
          paragraphId: `${s.id}-${i}`,
          sermonId: s.id,
          paragraphIndex: i + 1,
          snippet: snippetRaw.length > 600 ? snippetRaw.substring(0, 600) + '...' : snippetRaw,
          title: s.title,
          date: s.date,
          city: s.city
        });
      }
    });
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results.slice(params.offset, params.offset + safeLimit);
};

export const searchSermons = async (params: { query: string; mode: SearchMode; limit: number; offset: number }): Promise<any[]> => {
  const isSqliteAvailable = useAppStore.getState().isSqliteAvailable;
  
  if (!isElectron || !isSqliteAvailable) {
    return webSearchFallback(params);
  }
  
  try {
    const results = await window.electronAPI.db.search(params);
    // Si la DB Electron est instanciée mais retourne vide alors qu'on s'attend à des résultats,
    // ou si l'appel IPC échoue silencieusement
    if (!results || (results.length === 0 && params.offset === 0 && params.query.length > 2)) {
      // On tente quand même le fallback si aucun résultat n'est retourné par SQLite
      // cela aide si la table FTS n'est pas encore synchronisée
      const fallbackResults = await webSearchFallback(params);
      if (fallbackResults.length > 0) return fallbackResults;
    }
    return results || [];
  } catch (error) {
    console.error("Erreur Search IPC (Fallback activé):", error);
    return webSearchFallback(params);
  }
};

// Notes & Citations
export const getAllNotes = async (): Promise<Note[]> => {
  if (!isElectron) {
    const saved = localStorage.getItem('kings_sword_web_notes');
    return saved ? JSON.parse(saved) : [];
  }
  try {
    return await window.electronAPI.db.getNotes();
  } catch (e) {
    return [];
  }
};

export const saveNoteToDB = async (note: Note): Promise<void> => {
  if (!isElectron) {
    const saved = await getAllNotes();
    const index = saved.findIndex(n => n.id === note.id);
    if (index >= 0) saved[index] = note;
    else saved.push(note);
    localStorage.setItem('kings_sword_web_notes', JSON.stringify(saved));
    return;
  }
  try {
    await window.electronAPI.db.saveNote(note);
  } catch (e) {
    console.error("Save Note Error", e);
  }
};

export const deleteNoteFromDB = async (id: string): Promise<void> => {
  if (!isElectron) {
    const saved = await getAllNotes();
    const filtered = saved.filter(n => n.id !== id);
    localStorage.setItem('kings_sword_web_notes', JSON.stringify(filtered));
    return;
  }
  try {
    await window.electronAPI.db.deleteNote(id);
  } catch (e) {
    console.error("Delete Note Error", e);
  }
};

export const syncNotesOrder = async (notes: Note[]): Promise<void> => {
  if (!isElectron) {
    localStorage.setItem('kings_sword_web_notes', JSON.stringify(notes));
    return;
  }
  try {
    await window.electronAPI.db.reorderNotes(notes);
  } catch (e) {
    console.error("Sync Notes Order Error", e);
  }
};
