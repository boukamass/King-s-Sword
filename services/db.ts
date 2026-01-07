
import { Sermon, Note } from '../types';

const DB_NAME = 'SermonStudyDB';
const DB_VERSION = 3;
const SERMONS_STORE_NAME = 'sermons';
const NOTES_STORE_NAME = 'notes';

let db: IDBDatabase;

export const initDB = (): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (db) return resolve(true);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(SERMONS_STORE_NAME)) {
        dbInstance.createObjectStore(SERMONS_STORE_NAME, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(NOTES_STORE_NAME)) {
        const notesStore = dbInstance.createObjectStore(NOTES_STORE_NAME, { keyPath: 'id' });
        notesStore.createIndex('order', 'order', { unique: false });
      } else if (event.oldVersion < 3) {
        const notesStore = request.transaction!.objectStore(NOTES_STORE_NAME);
        if (!notesStore.indexNames.contains('order')) {
          notesStore.createIndex('order', 'order', { unique: false });
        }
      }
    };

    request.onsuccess = (event) => {
      db = (event.target as IDBOpenDBRequest).result;
      resolve(true);
    };

    request.onerror = (event) => {
      console.error('Erreur IndexedDB:', (event.target as IDBOpenDBRequest).error);
      reject("Erreur lors de l'ouverture de la base de données.");
    };
  });
};

/**
 * Récupère uniquement les métadonnées de tous les sermons.
 * Utilise un curseur pour éviter de cloner les objets textuels en mémoire.
 */
export const getAllSermonsMetadata = (): Promise<Omit<Sermon, 'text'>[]> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const results: Omit<Sermon, 'text'>[] = [];
    const request = store.openCursor();
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const { text, ...metadata } = cursor.value;
        results.push(metadata);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject('Erreur de lecture des métadonnées.');
  });
};

/**
 * Récupère le nombre total de sermons.
 */
export const getSermonsCount = (): Promise<number> => {
  return new Promise((resolve) => {
    if (!db) return resolve(0);
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
  });
};

/**
 * Récupère un sermon complet par son ID (Texte inclus).
 */
export const getSermonById = (id: string): Promise<Sermon | null> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject('Erreur de récupération du sermon.');
  });
};

/**
 * Récupère uniquement le texte d'un sermon pour économiser la RAM.
 */
export const getSermonTextById = async (id: string): Promise<string> => {
  const sermon = await getSermonById(id);
  return sermon?.text || "";
};

export const bulkAddSermons = (sermons: Sermon[], clearFirst: boolean): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject('Erreur de transaction.');

    if (clearFirst) store.clear();
    
    sermons.forEach(sermon => {
      if (sermon && sermon.id) {
        store.put(sermon);
      }
    });
  });
};

export const updateSermon = (sermon: Sermon): Promise<void> => {
  return new Promise((resolve, reject) => {
      if (!db) return reject("Base non initialisée.");
      const transaction = db.transaction(SERMONS_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(SERMONS_STORE_NAME);
      const request = store.put(sermon);
      request.onsuccess = () => resolve();
      request.onerror = () => reject('Erreur de mise à jour.');
  });
};

export const getAllNotes = (): Promise<Note[]> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(NOTES_STORE_NAME, 'readonly');
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('Erreur de lecture des notes.');
  });
};

export const putNote = (note: Note): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(NOTES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const request = store.put(note);
    request.onsuccess = () => resolve();
    request.onerror = () => reject("Erreur d'écriture de la note.");
  });
};

export const deleteNoteFromDB = (id: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(NOTES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject('Erreur de suppression de la note.');
  });
};
