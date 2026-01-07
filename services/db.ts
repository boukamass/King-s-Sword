
import { Sermon, Note, SearchMode } from '../types';

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
  return meta.length;
};

export const getSermonById = async (id: string): Promise<Sermon | null> => {
  if (!isElectron) return null;
  return window.electronAPI.db.getSermonFull(id);
};

export const bulkAddSermons = async (sermons: Sermon[]): Promise<void> => {
  if (!isElectron) return;
  await window.electronAPI.db.importSermons(sermons);
};

export const searchSermons = async (params: { query: string; mode: SearchMode; limit: number; offset: number }): Promise<any[]> => {
  if (!isElectron) return [];
  try {
    return await window.electronAPI.db.search(params);
  } catch (error) {
    console.error("Search API Error:", error);
    return [];
  }
};

// Notes & Citations
export const getAllNotes = async (): Promise<Note[]> => {
  if (!isElectron) {
    const saved = localStorage.getItem('kings_sword_web_notes');
    return saved ? JSON.parse(saved) : [];
  }
  return window.electronAPI.db.getNotes();
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
  await window.electronAPI.db.saveNote(note);
};

export const deleteNoteFromDB = async (id: string): Promise<void> => {
  if (!isElectron) {
    const saved = await getAllNotes();
    const filtered = saved.filter(n => n.id !== id);
    localStorage.setItem('kings_sword_web_notes', JSON.stringify(filtered));
    return;
  }
  await window.electronAPI.db.deleteNote(id);
};

export const syncNotesOrder = async (notes: Note[]): Promise<void> => {
  if (!isElectron) {
    localStorage.setItem('kings_sword_web_notes', JSON.stringify(notes));
    return;
  }
  await window.electronAPI.db.reorderNotes(notes);
};
