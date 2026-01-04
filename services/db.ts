
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
 * Récupère le nombre total de sermons en base.
 */
export const getSermonsCount = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject("Erreur de comptage.");
  });
};

/**
 * Récupère une page de métadonnées de sermons (pagination DB).
 */
export const getSermonsMetadataPage = (offset: number, limit: number): Promise<Omit<Sermon, 'text'>[]> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const results: any[] = [];
    let skipped = 0;
    const request = store.openCursor();
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) {
        resolve(results);
        return;
      }
      if (skipped < offset) {
        cursor.advance(offset - skipped);
        skipped = offset;
        return;
      }
      const { text, ...metadata } = cursor.value;
      results.push(metadata);
      if (results.length < limit) {
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject('Erreur de lecture paginée.');
  });
};

/**
 * Récupère tous les sermons mais SANS le champ 'text' pour économiser la RAM.
 * (Conservé pour compatibilité mais optimisé pour ne pas tout charger brutalement)
 */
export const getAllSermonsMetadata = (): Promise<Omit<Sermon, 'text'>[]> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const results: any[] = [];
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

// Utilisé pour le Web Worker de recherche intégrale
export const getAllSermonsFull = (): Promise<Sermon[]> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Base non initialisée.");
    const transaction = db.transaction(SERMONS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SERMONS_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('Erreur de lecture.');
  });
};

export const bulkAddSermons = (sermons: Sermon[], clearFirst: boolean): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("La base de données n'est pas initialisée.");
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
    if (!db) return reject("La base de données n'est pas initialisée.");
    const transaction = db.transaction(NOTES_STORE_NAME, 'readonly');
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('Erreur de lecture des notes.');
  });
};

export const putNote = (note: Note): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("La base de données n'est pas initialisée.");
    const transaction = db.transaction(NOTES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const request = store.put(note);
    request.onsuccess = () => resolve();
    request.onerror = () => reject("Erreur d'écriture de la note.");
  });
};

export const deleteNoteFromDB = (id: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!db) return reject("La base de données n'est pas initialisée.");
    const transaction = db.transaction(NOTES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(NOTES_STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject('Erreur de suppression de la note.');
  });
};
