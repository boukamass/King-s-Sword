
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
  try {
    const meta = await window.electronAPI.db.getSermonsMetadata();
    return meta ? meta.length : 0;
  } catch { return 0; }
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

const webSearchFallback = async (params: { 
  query: string; 
  mode: SearchMode; 
  limit: number; 
  offset: number; 
  synonyms?: string[]; 
  selectedSynonym?: string | null;
  showOnlySynonyms?: boolean; 
  showOnlyQuery?: boolean;
  filters?: {
    year: string | null;
    month: string | null;
    day: string | null;
    city: string | null;
    version: string | null;
    audio: boolean;
  }
}): Promise<any[]> => {
  const store = useAppStore.getState();
  const sermonsMap = store.sermonsMap;
  const results: any[] = [];
  
  const activeTerm = params.selectedSynonym || params.query.trim();
  const query = activeTerm.toLowerCase();
  
  if (!query && (!params.synonyms || params.synonyms.length === 0)) return [];

  const allSermons = Array.from(sermonsMap.values()) as Sermon[];
  if (allSermons.length === 0) return [];
  
  const markClass = "bg-amber-400/40 dark:bg-amber-500/40 text-amber-950 dark:text-white font-bold px-0.5 rounded-sm shadow-sm border-b-2 border-amber-600/30";
  const synonymMarkClass = "bg-teal-400/40 dark:bg-teal-500/40 text-teal-950 dark:text-white font-bold px-0.5 rounded-sm shadow-sm border-b-2 border-teal-600/30";
  
  let regexSource = "";
  if (params.selectedSynonym) {
      regexSource = params.selectedSynonym;
  } else if (params.synonyms && params.synonyms.length > 0) {
    if (params.showOnlySynonyms) {
      regexSource = params.synonyms!.join('|');
    } else if (params.showOnlyQuery) {
      regexSource = params.query;
    } else {
      regexSource = [params.query, ...params.synonyms!].join('|');
    }
  } else {
    regexSource = params.query;
  }

  const highlightRegex = getMultiWordHighlightRegex(regexSource);
  const synonymWords = (params.synonyms && !params.showOnlyQuery) ? params.synonyms.map(s => normalizeText(s)).filter(w => w.length > 0) : [];

  for (let idx = 0; idx < allSermons.length; idx++) {
    const s = allSermons[idx];
    if (!s.text) continue;

    if (params.filters) {
      const { year, month, day, city, version, audio } = params.filters;
      if (year && (!s.date || !s.date.startsWith(year))) continue;
      if (month && (!s.date || s.date.substring(5, 7) !== month)) continue;
      if (day && (!s.date || s.date.substring(8, 10) !== day)) continue;
      if (city && s.city !== city) continue;
      if (version && s.version !== version) continue;
      if (audio && !s.audio_url) continue;
    }
    
    if (idx > 0 && idx % 30 === 0) await new Promise(r => setTimeout(r, 0));

    const paragraphs = s.text.split(/\n\s*\n/);
    paragraphs.forEach((p, i) => {
      const content = p.trim();
      if (!content) return;
      
      const normalizedContent = normalizeText(content);
      let matchFound = false;
      
      if (params.selectedSynonym) {
          matchFound = normalizedContent.includes(normalizeText(params.selectedSynonym));
      } else if (synonymWords.length > 0 && !params.showOnlyQuery) {
        const queryMatch = normalizedContent.includes(normalizeText(params.query));
        const synMatch = synonymWords.some(w => normalizedContent.includes(w));
        
        if (params.showOnlySynonyms) {
          matchFound = synMatch;
        } else {
          matchFound = queryMatch || synMatch;
        }
      } else {
        const queryWords = normalizeText(params.query).split(/\s+/).filter(w => w.length > 0);
        if (params.mode === SearchMode.EXACT_PHRASE) {
          matchFound = normalizedContent.includes(normalizeText(params.query));
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
          const windowStart = Math.max(0, matchPos - 200);
          const windowEnd = Math.min(content.length, matchPos + 500);
          snippetContent = content.substring(windowStart, windowEnd);
          if (windowStart > 0) snippetContent = '...' + snippetContent;
          if (windowEnd < content.length) snippetContent = snippetContent + '...';
        } else {
          snippetContent = content.substring(0, 800) + (content.length > 800 ? '...' : '');
        }

        const snippetHighlighted = snippetContent.replace(highlightRegex, (m) => {
            const normalizedMatch = normalizeText(m);
            const isSpecificSynonymMatch = params.selectedSynonym && normalizedMatch.includes(normalizeText(params.selectedSynonym));
            const isGeneralSynonymMatch = synonymWords.some(sw => normalizedMatch.includes(sw));
            
            if (isSpecificSynonymMatch) return `<mark class="${synonymMarkClass}">${m}</mark>`;
            if (isGeneralSynonymMatch && !params.showOnlyQuery) return `<mark class="${synonymMarkClass}">${m}</mark>`;
            return `<mark class="${markClass}">${m}</mark>`;
        });
        
        results.push({
          paragraphId: `${s.id}-${i}`,
          sermonId: s.id,
          paragraphIndex: i + 1,
          snippet: snippetHighlighted,
          title: s.title,
          date: s.date,
          city: s.city,
          audio_url: s.audio_url
        });
      }
    });
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results.slice(params.offset, params.offset + params.limit);
};

export const searchSermons = async (params: { query: string; mode: SearchMode; limit: number; offset: number }): Promise<any[]> => {
  const store = useAppStore.getState();
  const isSqliteAvailable = store.isSqliteAvailable;
  const includeSynonyms = store.includeSynonyms;
  const showOnlySynonyms = store.showOnlySynonyms;
  const showOnlyQuery = store.showOnlyQuery;
  const selectedSynonym = store.selectedSynonym;
  
  const filters = {
    year: store.yearFilter,
    month: store.monthFilter,
    day: store.dayFilter,
    city: store.cityFilter,
    version: store.versionFilter,
    audio: store.audioFilter
  };
  
  let synonyms: string[] = [];
  
  if (includeSynonyms && params.query.trim().split(/\s+/).length === 1 && params.query.trim().length > 2) {
    try {
      const def = await getDefinition(params.query.trim());
      if (def && def.synonyms) {
        synonyms = def.synonyms.slice(0, 10);
        store.setActiveSynonyms(synonyms);
      }
    } catch (e) {
      console.warn("Synonym retrieval failed:", e);
    }
  } else if (!includeSynonyms) {
    store.setActiveSynonyms([]);
  }
  
  const searchParams = { ...params, synonyms, selectedSynonym, showOnlySynonyms, showOnlyQuery, filters };

  if (isElectron && isSqliteAvailable) {
    try {
      const results = await window.electronAPI.db.search(searchParams);
      if (results) return results;
    } catch (error) {
      console.error("IPC Search Error:", error);
    }
  }
  
  return webSearchFallback(searchParams);
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
