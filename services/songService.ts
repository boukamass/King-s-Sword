import { Song, Sermon, SearchMode } from '../types';
import { SearchResult } from '../store';
import { getAccentInsensitiveRegex, normalizeText } from '../utils/textUtils';

const STORAGE_KEY = 'kings_sword_songs_store_v2';
const CUSTOM_SONGS_KEY = 'kings_sword_custom_songs_v2';
const DELETED_SONGS_KEY = 'kings_sword_deleted_songs_v2';
const DB_NAME = 'kings_sword_app_db';
const DB_VERSION = 2;
const STORE_SONGS = 'songs';
const STORE_CUSTOM = 'custom_songs';

let inMemorySongs: Song[] | null = null;
let idbPromise: Promise<IDBDatabase> | null = null;

// IndexedDB Connection Helper
const getIDB = (): Promise<IDBDatabase> => {
  if (idbPromise) return idbPromise;

  idbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CUSTOM)) {
        db.createObjectStore(STORE_CUSTOM, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.warn('Error opening IndexedDB:', request.error);
      reject(request.error);
    };
  });

  return idbPromise;
};

// IDB Helpers
const idbGetAll = async <T>(storeName: string): Promise<T[]> => {
  try {
    const db = await getIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
};

const idbPut = async (storeName: string, item: any): Promise<void> => {
  try {
    const db = await getIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Fallback silently if IDB fails
  }
};

const idbPutAll = async (storeName: string, items: any[]): Promise<void> => {
  try {
    const db = await getIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Fallback silently
  }
};

const idbDelete = async (storeName: string, key: any): Promise<void> => {
  try {
    const db = await getIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Fallback silently
  }
};

// LocalStorage helpers for custom & deleted deltas
const getCustomSongsFromLS = (): Record<string, Song> => {
  try {
    const data = localStorage.getItem(CUSTOM_SONGS_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

const saveCustomSongToLS = (song: Song) => {
  try {
    const existing = getCustomSongsFromLS();
    existing[String(song.id)] = song;
    localStorage.setItem(CUSTOM_SONGS_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn('LocalStorage error writing custom song:', e);
  }
};

const getDeletedSongIdsFromLS = (): string[] => {
  try {
    const data = localStorage.getItem(DELETED_SONGS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const addDeletedSongIdToLS = (id: string | number) => {
  try {
    const existing = getDeletedSongIdsFromLS();
    const strId = String(id);
    if (!existing.includes(strId)) {
      existing.push(strId);
      localStorage.setItem(DELETED_SONGS_KEY, JSON.stringify(existing));
    }
  } catch (e) {
    console.warn('LocalStorage error marking song deleted:', e);
  }
};

export const formatSongTitle = (rawTitle: string): string => {
  if (!rawTitle) return '';
  const trimmed = rawTitle.trim();
  if (!trimmed) return '';

  // Check if starts with a number prefix like "1. " or "12. "
  const numMatch = trimmed.match(/^(\d+[\.\-\)]\s*)(.*)$/);
  if (numMatch) {
    const prefix = numMatch[1];
    const rest = numMatch[2].trim();
    if (!rest) return trimmed;
    return prefix + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

export const formatSongContent = (rawContent: string, songTitle?: string): string => {
  if (!rawContent) return '';
  const titleNorm = songTitle ? normalizeText(songTitle) : '';

  let text = rawContent.replace(/\r\n/g, '\n');

  // Strip explicit stanza headers like "Couplet 1", "Couplet 2", "Strophe X", "Verse X"
  text = text.replace(/^[ \t]*(?:couplet|strophe|verse)\s*\d*[ \t]*\n?/gim, '');

  // Normalize chorus indicators like "Chœur:", "Chœur", "Refrain:" so that following text is part of the same block
  text = text.replace(/^[ \t]*(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?[ \t]*\n+/gim, 'Chœur :\n');

  const rawBlocks = text.split(/\n\s*\n+/);
  const cleanedBlocks: string[] = [];
  let strippedFileHeaderTitle = false;
  let mainChorusText = '';

  for (let blockIdx = 0; blockIdx < rawBlocks.length; blockIdx++) {
    const rawBlock = rawBlocks[blockIdx];
    const lines = rawBlock.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // Check if entire block is just title or an isolated chorus marker
    if (lines.length === 1) {
      const lineNorm = normalizeText(lines[0]);
      if (!strippedFileHeaderTitle && titleNorm && lineNorm === titleNorm) {
        strippedFileHeaderTitle = true;
        continue;
      }
      if (/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?$/i.test(lines[0])) {
        continue;
      }
    }

    let isChorus = false;
    const newLines: string[] = [];
    let strippedBannerInThisBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;

      // Standalone Chorus header on its line
      if (/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:?$/i.test(trimmed)) {
        isChorus = true;
        continue;
      }

      // Inline Chorus header: "Chœur: Paroles..."
      const chorusMatch = trimmed.match(/^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:\s*(.*)$/i);
      if (chorusMatch) {
        isChorus = true;
        if (chorusMatch[1] && chorusMatch[1].trim()) {
          newLines.push(chorusMatch[1].trim());
        }
        continue;
      }

      // In the very first lyrics block, if line 0 is an all-caps banner or duplicate title line:
      if (cleanedBlocks.length === 0 && !strippedBannerInThisBlock && newLines.length === 0) {
        const lineNorm = normalizeText(trimmed);
        if (titleNorm && lineNorm === titleNorm && lines.length > i + 1) {
          strippedBannerInThisBlock = true;
          continue;
        }
        if (trimmed === trimmed.toUpperCase() && trimmed.length >= 3 && !/^\d/.test(trimmed) && lines.length > i + 1) {
          strippedBannerInThisBlock = true;
          continue;
        }
      }

      // Remove leading numbers like "1-", "1.", "1 -", "1 )", "1. ", "1 - "
      const cleanLine = trimmed.replace(/^\d+[\s\.\-\)]+\s*/, '').trim();
      if (cleanLine) {
        newLines.push(cleanLine);
      }
    }

    if (newLines.length > 0) {
      if (isChorus) {
        const chorusBody = newLines.join('\n');
        const chorusBlock = "Chœur :\n" + chorusBody;
        cleanedBlocks.push(chorusBlock);
        if (!mainChorusText) {
          mainChorusText = chorusBlock;
        }
      } else {
        cleanedBlocks.push(newLines.join('\n'));
      }
    }
  }

  // Ensure the chorus is repeated after each couplet if a chorus exists
  if (mainChorusText && cleanedBlocks.length > 1) {
    const finalBlocks: string[] = [];
    for (let i = 0; i < cleanedBlocks.length; i++) {
      const block = cleanedBlocks[i];
      finalBlocks.push(block);

      const isCurrentBlockChorus = /^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:/i.test(block.trim());
      const isNextBlockChorus = i + 1 < cleanedBlocks.length && /^(?:ch[oœ\u0152\u0153]ur|refrain|chorus)\s*:/i.test(cleanedBlocks[i + 1].trim());

      // If this was a couplet and not already followed by a chorus, repeat the chorus
      if (!isCurrentBlockChorus && !isNextBlockChorus) {
        finalBlocks.push(mainChorusText);
      }
    }
    return finalBlocks.join('\n\n');
  }

  return cleanedBlocks.join('\n\n');
};

export const loadAllSongs = async (): Promise<Song[]> => {
  if (inMemorySongs && inMemorySongs.length > 0) {
    return inMemorySongs;
  }

  const customMap = getCustomSongsFromLS();
  const deletedList = getDeletedSongIdsFromLS();

  // Helper to merge raw songs with custom and deleted lists
  const mergeSongs = (baseList: Song[], existingIdbSongs?: Song[]) => {
    const songMap = new Map<string, Song>();

    // 1. Add base songs from songs.json
    baseList.forEach(s => {
      songMap.set(String(s.id), { ...s, title: formatSongTitle(s.title) });
    });

    // 2. Overlay any IndexedDB records if provided
    if (existingIdbSongs) {
      existingIdbSongs.forEach(s => {
        songMap.set(String(s.id), { ...s, title: formatSongTitle(s.title) });
      });
    }

    // 3. Overlay custom user-saved songs
    Object.values(customMap).forEach(customSong => {
      songMap.set(String(customSong.id), { ...customSong, title: formatSongTitle(customSong.title) });
    });

    // 4. Filter out deleted songs
    const merged = Array.from(songMap.values()).filter(s => !deletedList.includes(String(s.id)));

    merged.sort((a, b) => {
      const numA = Number(a.id);
      const numB = Number(b.id);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.title).localeCompare(String(b.title));
    });

    return merged;
  };

  // Try fetching fresh songs.json first
  try {
    const res = await fetch('songs.json');
    if (res.ok) {
      const data = await res.json();
      const rawList: Song[] = Array.isArray(data) ? data : data.songs || [];
      let idbSongs: Song[] = [];
      try {
        idbSongs = (await idbGetAll<Song>(STORE_SONGS)) || [];
      } catch (e) {}

      const merged = mergeSongs(rawList, idbSongs);
      inMemorySongs = merged;

      // Update IndexedDB & LocalStorage
      idbPutAll(STORE_SONGS, merged);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch (e) {}

      return inMemorySongs;
    }
  } catch (err) {
    console.warn('Could not fetch songs.json, falling back to cached storage:', err);
  }

  // Fallback 1: Try loading from IndexedDB
  try {
    const idbSongs = await idbGetAll<Song>(STORE_SONGS);
    if (idbSongs && idbSongs.length > 0) {
      const merged = mergeSongs(idbSongs);
      inMemorySongs = merged;
      return inMemorySongs;
    }
  } catch (e) {
    console.warn('Error reading from IndexedDB:', e);
  }

  // Fallback 2: Try loading from LocalStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const merged = mergeSongs(parsed);
        inMemorySongs = merged;
        idbPutAll(STORE_SONGS, merged);
        return inMemorySongs;
      }
    }
  } catch (e) {
    console.warn('Failed to parse songs from localStorage:', e);
  }

  inMemorySongs = [];
  return [];
};

export const persistSongs = async (songs: Song[]) => {
  inMemorySongs = songs;
  // Write to IndexedDB
  await idbPutAll(STORE_SONGS, songs);
  // Mirror to LocalStorage
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch (e) {
    console.warn('Error saving songs to localStorage:', e);
  }
};

export const getSongById = async (id: string | number): Promise<Song | null> => {
  const songs = await loadAllSongs();
  const rawId = typeof id === 'string' && id.startsWith('song-') ? id.replace('song-', '') : String(id);
  const found = songs.find(s => String(s.id) === rawId);
  return found || null;
};

export const getSongAsSermon = async (id: string | number): Promise<Sermon | null> => {
  const song = await getSongById(id);
  if (!song) return null;

  const cleanTitle = formatSongTitle(song.title);
  const formattedText = formatSongContent(song.content || '', cleanTitle);

  return {
    id: `song-${song.id}`,
    title: `${song.id}. ${cleanTitle}`,
    date: 'Cantique',
    city: song.language ? song.language.toUpperCase() : 'FR',
    time: 'Chant',
    version: 'Recueil',
    text: formattedText,
    highlights: []
  };
};

export const saveSong = async (songData: {
  id?: number | string;
  title: string;
  content: string;
  language?: string;
}): Promise<Song> => {
  const songs = await loadAllSongs();
  const now = new Date().toISOString();

  let targetId = songData.id;
  if (targetId === undefined || targetId === null || targetId === '') {
    // Generate new numeric ID as highest numeric ID + 1
    const numericIds = songs
      .map(s => (typeof s.id === 'number' ? s.id : parseInt(String(s.id), 10)))
      .filter(n => !isNaN(n));
    targetId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
  } else if (typeof targetId === 'string' && !isNaN(Number(targetId))) {
    targetId = Number(targetId);
  }

  const existingIndex = songs.findIndex(s => String(s.id) === String(targetId));
  const formattedTitle = formatSongTitle(songData.title);

  let updatedSong: Song;
  if (existingIndex >= 0) {
    updatedSong = {
      ...songs[existingIndex],
      id: targetId,
      title: formattedTitle,
      content: songData.content.trim(),
      language: songData.language || songs[existingIndex].language || 'fr',
      updatedAt: now
    };
    songs[existingIndex] = updatedSong;
  } else {
    updatedSong = {
      id: targetId,
      title: formattedTitle,
      filename: `${formattedTitle}.txt`,
      content: songData.content.trim(),
      language: songData.language || 'fr',
      updatedAt: now
    };
    songs.push(updatedSong);
  }

  // Sort songs by numeric id if possible
  songs.sort((a, b) => {
    const numA = Number(a.id);
    const numB = Number(b.id);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return String(a.title).localeCompare(String(b.title));
  });

  // Save to persistent storage
  await idbPut(STORE_SONGS, updatedSong);
  await idbPut(STORE_CUSTOM, updatedSong);
  saveCustomSongToLS(updatedSong);
  await persistSongs(songs);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kings_sword_songs_updated'));
  }

  return updatedSong;
};

export const deleteSong = async (id: number | string): Promise<boolean> => {
  const songs = await loadAllSongs();
  const rawId = typeof id === 'string' && id.startsWith('song-') ? id.replace('song-', '') : String(id);
  const filtered = songs.filter(s => String(s.id) !== rawId);
  
  if (filtered.length === songs.length) {
    return false; // not found
  }

  // Persist deletion
  await idbDelete(STORE_SONGS, rawId);
  await idbDelete(STORE_SONGS, Number(rawId));
  await idbDelete(STORE_CUSTOM, rawId);
  await idbDelete(STORE_CUSTOM, Number(rawId));
  addDeletedSongIdToLS(rawId);

  await persistSongs(filtered);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kings_sword_songs_updated'));
  }

  return true;
};

export const resetSongsToDefault = async (): Promise<Song[]> => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CUSTOM_SONGS_KEY);
    localStorage.removeItem(DELETED_SONGS_KEY);
    try {
      const db = await getIDB();
      const tx = db.transaction([STORE_SONGS, STORE_CUSTOM], 'readwrite');
      tx.objectStore(STORE_SONGS).clear();
      tx.objectStore(STORE_CUSTOM).clear();
    } catch {}
    inMemorySongs = null;
    return await loadAllSongs();
  } catch (error) {
    console.error('Error resetting songs:', error);
    return [];
  }
};

export const searchSongs = async (
  query: string,
  mode: SearchMode = SearchMode.DIVERSE
): Promise<SearchResult[]> => {
  const songs = await loadAllSongs();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: SearchResult[] = [];
  const queryRegex = getAccentInsensitiveRegex(trimmed);
  const normalizedQuery = normalizeText(trimmed);

  for (const song of songs) {
    if (!song.content) continue;

    const cleanTitle = formatSongTitle(song.title);
    const stanzas = song.content.split(/\n\s*\n/);
    stanzas.forEach((stanza, stanzaIdx) => {
      const trimmedStanza = stanza.trim();
      if (!trimmedStanza) return;

      const isMatch = queryRegex.test(trimmedStanza) || 
                      normalizeText(trimmedStanza).includes(normalizedQuery);

      if (isMatch) {
        // Build clean snippet around match
        const snippetLines = trimmedStanza.split('\n').filter(l => l.trim().length > 0);
        const snippet = snippetLines.slice(0, 3).join(' • ');

        results.push({
          paragraphId: `song-${song.id}-p${stanzaIdx}`,
          sermonId: `song-${song.id}`,
          title: `${song.id}. ${cleanTitle}`,
          date: 'Cantique',
          city: song.language ? song.language.toUpperCase() : 'FR',
          paragraphIndex: stanzaIdx,
          snippet: snippet.length > 180 ? snippet.slice(0, 180) + '...' : snippet
        });
      }
    });

    if (results.length >= 10000) break;
  }

  return results;
};
