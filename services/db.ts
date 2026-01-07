
import { Sermon, Note } from '../types';

/**
 * Service de données utilisant SQLite via IPC (Main Process).
 */

export const getAllSermonsMetadata = async (): Promise<Omit<Sermon, 'text'>[]> => {
  return window.electronAPI.db.getSermonsMetadata();
};

export const getSermonsCount = async (): Promise<number> => {
  const meta = await window.electronAPI.db.getSermonsMetadata();
  return meta.length;
};

export const getSermonById = async (id: string): Promise<Sermon | null> => {
  return window.electronAPI.db.getSermonFull(id);
};

export const bulkAddSermons = async (sermons: Sermon[]): Promise<void> => {
  await window.electronAPI.db.importSermons(sermons);
};

// Notes & Citations
export const getAllNotes = async (): Promise<Note[]> => {
  return window.electronAPI.db.getNotes();
};

export const saveNoteToDB = async (note: Note): Promise<void> => {
  await window.electronAPI.db.saveNote(note);
};

export const deleteNoteFromDB = async (id: string): Promise<void> => {
  await window.electronAPI.db.deleteNote(id);
};

export const syncNotesOrder = async (notes: Note[]): Promise<void> => {
  await window.electronAPI.db.reorderNotes(notes);
};
