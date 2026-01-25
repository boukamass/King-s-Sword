
import { Sermon, Note, SearchMode } from '../types';
import { normalizeText, getAccentInsensitiveRegex, getMultiWordHighlightRegex } from '../utils/textUtils';
import { useAppStore } from '../store';
import { getDefinition } from './dictionaryService';

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
 * Optimisé pour ne pas figer l'UI
 */
const webSearchFallback = async (params: { query: string; mode: SearchMode; limit: number; offset: number; synonyms?: string[]; showOnlySynonyms?: boolean; showOnlyQuery?: boolean }): Promise<any[]> => {
  const store = useAppStore.getState();
  const sermonsMap = store.sermonsMap;
  const results: any[] = [];
  const query = params.query.trim().toLowerCase();
  
  if (!query && (!params.synonyms || params.synonyms.length === 0)) return [];

  const safeLimit = Math.min(params.limit, 50);
  const allSermons = Array.from(sermonsMap.values()) as Sermon[];
  const markClass = "bg-amber-400/40 dark:bg-amber-500/40 text-amber-950 dark:text-white font-bold px-0.5 rounded-sm shadow-sm border-b-2 border-amber-600/30";
  
  const highlightRegex = (params.synonyms && params.synonyms.length > 0 && !params.showOnlyQuery)
    ? getMultiWordHighlightRegex(params.showOnlySynonyms ? params.synonyms.join(' ') : [query, ...params.synonyms].join(' '))
    : (params.mode === SearchMode.EXACT_PHRASE 
        ? getAccentInsensitiveRegex(query, false)
        : getMultiWordHighlightRegex(query));

  const normalizedQuery = normalizeText(query);
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
  const synonymWords = (params.synonyms && !params.showOnlyQuery) ? params.synonyms.map(s => normalizeText(s)).filter(w => w.length > 0) : [];

  // Traitement par lots pour laisser l'UI respirer
  for (let idx = 0; idx < allSermons.length; idx++) {
    // Rend la main au navigateur tous les 25 sermons
    if (idx > 0 && idx % 25 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const s = allSermons[idx];
    if (!s.text) continue;
    
    const paragraphs = s.text.split(/\n\s*\n/);
    paragraphs.forEach((p, i) => {
      const content = p.trim();
      if (!content) return;
      
      const normalizedContent = normalizeText(content);
      let matchFound = false;
      
      if (synonymWords.length > 0 && !params.showOnlyQuery) {
        if (params.showOnlySynonyms) {
            matchFound = synonymWords.some(w => normalizedContent.includes(w));
        } else {
            matchFound = [normalizedQuery, ...synonymWords].some(w => normalizedContent.includes(w));
        }
      } else {
        if (params.mode === SearchMode.EXACT_PHRASE) {
          matchFound = normalizedContent.includes(normalizedQuery);
        } else if (params.mode === SearchMode.DIVERSE) {
          matchFound = queryWords.some(w => normalizedContent.includes(w));
        } else { 
          matchFound = queryWords.every(w => normalizedContent.includes(w));
        }
      }

      if (matchFound) {
        let snippetContent = content;
        const matchExec = highlightRegex.exec(content);
        highlightRegex.lastIndex = 0; 

        if (matchExec) {
          const matchPos = matchExec.index;
          const windowStart = Math.max(0, matchPos - 150);
          const windowEnd = Math.min(content.length, matchPos + 450);
          snippetContent = content.substring(windowStart, windowEnd);
          if (windowStart > 0) snippetContent = '...' + snippetContent;
          if (windowEnd < content.length) snippetContent = snippetContent + '...';
        } else {
          snippetContent = content.substring(0, 600) + (content.length > 600 ? '...' : '');
        }

        const snippetHighlighted = snippetContent.replace(highlightRegex, (m) => `<mark class="${markClass}">${m}</mark>`);
        
        results.push({
          paragraphId: `${s.id}-${i}`,
          sermonId: s.id,
          paragraphIndex: i + 1,
          snippet: snippetHighlighted,
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
  const store = useAppStore.getState();
  const isSqliteAvailable = store.isSqliteAvailable;
  const includeSynonyms = store.includeSynonyms;
  const showOnlySynonyms = store.showOnlySynonyms;
  const showOnlyQuery = store.showOnlyQuery;
  
  let synonyms: string[] = [];
  
  if (includeSynonyms && params.query.trim().split(/\s+/).length === 1) {
    try {
      const def = await getDefinition(params.query.trim());
      if (def && def.synonyms) {
        synonyms = def.synonyms.slice(0, 8);
        store.setActiveSynonyms(synonyms);
      }
    } catch (e) {
      console.warn("Échec de la récupération des synonymes via Gemini:", e);
    }
  } else if (!includeSynonyms) {
    store.setActiveSynonyms([]);
  }
  
  const searchParams = { ...params, synonyms, showOnlySynonyms, showOnlyQuery };

  if (!isElectron || !isSqliteAvailable) {
    return webSearchFallback(searchParams);
  }
  
  try {
    const results = await window.electronAPI.db.search(searchParams);
    if (!results || (results.length === 0 && params.offset === 0 && params.query.length > 2)) {
      return webSearchFallback(searchParams);
    }
    return results || [];
  } catch (error) {
    console.error("Erreur Search IPC (Fallback activé):", error);
    return webSearchFallback(searchParams);
  }
};

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
