
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Database = require('better-sqlite3');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow;
let db;

// --- CACHE LRU MÉMOIRE (1000 entrées) ---
const paragraphCache = new Map();
const MAX_CACHE_SIZE = 1000;

function addToCache(id, data) {
  if (paragraphCache.size >= MAX_CACHE_SIZE) {
    const firstKey = paragraphCache.keys().next().value;
    paragraphCache.delete(firstKey);
  }
  paragraphCache.set(id, data);
}

// --- INITIALISATION SQLITE ---
function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'kings_sword_v2.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sermons (
      id TEXT PRIMARY KEY,
      title TEXT,
      date TEXT,
      city TEXT,
      version TEXT,
      time TEXT,
      audio_url TEXT
    );

    CREATE TABLE IF NOT EXISTS paragraphs (
      id TEXT PRIMARY KEY,
      sermon_id TEXT,
      paragraph_index INTEGER,
      content TEXT,
      FOREIGN KEY(sermon_id) REFERENCES sermons(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS paragraphs_fts USING fts5(
      content,
      sermon_id UNINDEXED,
      paragraph_index UNINDEXED,
      content='paragraphs',
      content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      color TEXT,
      "order" INTEGER,
      creation_date TEXT
    );

    CREATE TABLE IF NOT EXISTS citations (
      id TEXT PRIMARY KEY,
      note_id TEXT,
      sermon_id TEXT,
      sermon_title_snapshot TEXT,
      sermon_date_snapshot TEXT,
      quoted_text TEXT,
      date_added TEXT,
      FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
  `);

  // Triggers FTS5
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS paragraphs_ai AFTER INSERT ON paragraphs BEGIN
      INSERT INTO paragraphs_fts(rowid, content, sermon_id, paragraph_index)
      VALUES (new.id, new.content, new.sermon_id, new.paragraph_index);
    END;
    CREATE TRIGGER IF NOT EXISTS paragraphs_ad AFTER DELETE ON paragraphs BEGIN
      INSERT INTO paragraphs_fts(paragraphs_fts, rowid, content, sermon_id, paragraph_index)
      VALUES('delete', old.id, old.content, old.sermon_id, old.paragraph_index);
    END;
    CREATE TRIGGER IF NOT EXISTS paragraphs_au AFTER UPDATE ON paragraphs BEGIN
      INSERT INTO paragraphs_fts(paragraphs_fts, rowid, content, sermon_id, paragraph_index)
      VALUES('delete', old.id, old.content, old.sermon_id, old.paragraph_index);
      INSERT INTO paragraphs_fts(rowid, content, sermon_id, paragraph_index)
      VALUES (new.id, new.content, new.sermon_id, new.paragraph_index);
    END;
  `);
}

// --- IPC HANDLERS ---

// Sermons
ipcMain.handle('db:getSermonsMetadata', () => {
  return db.prepare('SELECT id, title, date, city, version, time, audio_url FROM sermons ORDER BY date DESC').all();
});

ipcMain.handle('db:getSermonFull', (event, id) => {
  const sermon = db.prepare('SELECT * FROM sermons WHERE id = ?').get(id);
  if (!sermon) return null;
  const paragraphs = db.prepare('SELECT content FROM paragraphs WHERE sermon_id = ? ORDER BY paragraph_index ASC').all();
  sermon.text = paragraphs.map(p => p.content).join('\n\n');
  return sermon;
});

ipcMain.handle('db:search', (event, { query, mode, limit = 50, offset = 0 }) => {
  let sqlQuery = query.trim();
  if (!sqlQuery) return [];

  if (mode === 'EXACT_PHRASE') {
    sqlQuery = `"${sqlQuery}"`;
  } else if (mode === 'DIVERSE') {
    sqlQuery = sqlQuery.split(/\s+/).filter(v => v).map(v => `${v}*`).join(' AND ');
  } else {
    sqlQuery = `${sqlQuery}*`;
  }

  const stmt = db.prepare(`
    SELECT 
      rowid as paragraphId, 
      sermon_id as sermonId, 
      paragraph_index as paragraphIndex, 
      snippet(paragraphs_fts, 0, '<mark class="bg-teal-600/30 text-teal-900 dark:text-teal-200 px-0.5 rounded">', '</mark>', '...', 32) as snippet
    FROM paragraphs_fts 
    WHERE content MATCH ? 
    ORDER BY rank
    LIMIT ? OFFSET ?
  `);
  
  const results = stmt.all(sqlQuery, limit, offset);
  return results.map(res => {
    const meta = db.prepare('SELECT title, date, city FROM sermons WHERE id = ?').get(res.sermonId);
    return { ...res, ...meta };
  });
});

ipcMain.handle('db:importSermons', (event, sermons) => {
  const deleteSermons = db.prepare('DELETE FROM sermons');
  const insertSermon = db.prepare('INSERT INTO sermons (id, title, date, city, version, time, audio_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertPara = db.prepare('INSERT INTO paragraphs (id, sermon_id, paragraph_index, content) VALUES (?, ?, ?, ?)');

  const transaction = db.transaction((data) => {
    deleteSermons.run();
    for (const s of data) {
      insertSermon.run(s.id, s.title, s.date, s.city, s.version || 'VGR', s.time || 'Soir', s.audio_url || '');
      const paragraphs = s.text.split(/\n\s*\n/);
      paragraphs.forEach((p, idx) => {
        const pId = `${s.id}_${idx}`;
        insertPara.run(pId, s.id, idx + 1, p.trim());
      });
    }
  });

  transaction(sermons);
  paragraphCache.clear();
  return { success: true, count: sermons.length };
});

// Notes & Citations
ipcMain.handle('db:getNotes', () => {
  const notes = db.prepare('SELECT * FROM notes ORDER BY "order" ASC').all();
  for (const n of notes) {
    n.citations = db.prepare('SELECT * FROM citations WHERE note_id = ?').all(n.id);
  }
  return notes;
});

ipcMain.handle('db:saveNote', (event, note) => {
  const upsert = db.prepare(`
    INSERT INTO notes (id, title, content, color, "order", creation_date)
    VALUES (@id, @title, @content, @color, @order, @creationDate)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      content=excluded.content,
      color=excluded.color,
      "order"=excluded."order"
  `);
  upsert.run(note);

  // Sync citations
  db.prepare('DELETE FROM citations WHERE note_id = ?').run(note.id);
  const insertCit = db.prepare(`
    INSERT INTO citations (id, note_id, sermon_id, sermon_title_snapshot, sermon_date_snapshot, quoted_text, date_added)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of note.citations) {
    insertCit.run(c.id || crypto.randomUUID(), note.id, c.sermon_id, c.sermon_title_snapshot, c.sermon_date_snapshot, c.quoted_text, c.date_added || new Date().toISOString());
  }
  return { success: true };
});

ipcMain.handle('db:deleteNote', (event, id) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('db:reorderNotes', (event, notes) => {
  const updateOrder = db.prepare('UPDATE notes SET "order" = ? WHERE id = ?');
  const transaction = db.transaction((items) => {
    items.forEach((item, idx) => updateOrder.run(idx, item.id));
  });
  transaction(notes);
  return { success: true };
});

// --- ELECTRON WINDOW SETUP ---
function createWindow() {
  initDatabase();

  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 1000, minHeight: 700,
    title: "King's Sword - Étude de Sermons",
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('projection=true') || url.includes('mask=true')) {
      const displays = screen.getAllDisplays();
      const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
      let targetDisplay = displays.find(d => d.id !== currentDisplay.id) || currentDisplay;

      return { 
        action: 'allow',
        overrideBrowserWindowOptions: {
          fullscreen: true, frame: false,
          x: targetDisplay.bounds.x, y: targetDisplay.bounds.y,
          alwaysOnTop: url.includes('mask=true'),
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
