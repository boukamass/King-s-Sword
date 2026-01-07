
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Database = require('better-sqlite3');

const isDev = !app.isPackaged;
let mainWindow;
let db;
let projectionWindow = null;

function initDatabase() {
  try {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    const dbPath = path.join(userDataPath, 'kings_sword_v2.db');
    db = new Database(dbPath, { verbose: isDev ? console.log : null });
    
    // Optimisations PRAGMA
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('foreign_keys = ON');
    
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
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        sermon_id TEXT, 
        paragraph_index INTEGER, 
        content TEXT, 
        FOREIGN KEY(sermon_id) REFERENCES sermons(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS paragraphs_fts USING fts5(
        content, 
        sermon_id UNINDEXED, 
        paragraph_index UNINDEXED
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
    console.log("[DB] Initialisée avec succès à :", dbPath);
  } catch (err) {
    console.error(`[DB Error] Échec de l'initialisation :`, err);
    db = null;
  }
}

const checkDb = () => { 
  if (!db) {
    initDatabase();
    if (!db) throw new Error("Base de données SQLite non disponible (Erreur système)");
  }
};

ipcMain.handle('open-projection-window', () => {
  if (projectionWindow && !projectionWindow.isDestroyed()) {
    projectionWindow.focus();
    const projBounds = projectionWindow.getBounds();
    const primaryBounds = screen.getPrimaryDisplay().bounds;
    const onSecond = projBounds.x !== primaryBounds.x || projBounds.y !== primaryBounds.y;
    return { onSecondScreen: onSecond };
  }
  
  const displays = screen.getAllDisplays();
  const externalDisplay = displays.find(d => d.id !== screen.getPrimaryDisplay().id);
  const targetDisplay = externalDisplay || screen.getPrimaryDisplay();
  
  projectionWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: true,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false 
    },
    title: "King's Sword Projection"
  });

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, 'dist/index.html')}`;

  const projectionUrl = new URL(startUrl);
  projectionUrl.searchParams.set('projection', 'true');
  
  projectionWindow.loadURL(projectionUrl.toString());
  
  projectionWindow.on('closed', () => {
    projectionWindow = null;
  });

  return { onSecondScreen: !!externalDisplay };
});

ipcMain.handle('db:isReady', () => !!db);

ipcMain.handle('db:getSermonsMetadata', () => {
  if (!db) return [];
  try {
    return db.prepare('SELECT id, title, date, city, version FROM sermons ORDER BY date DESC').all();
  } catch (e) {
    return [];
  }
});

ipcMain.handle('db:getSermonFull', (event, id) => {
  if (!db) return null;
  try {
    const sermon = db.prepare('SELECT * FROM sermons WHERE id = ?').get(id);
    if (!sermon) return null;
    const paragraphs = db.prepare('SELECT content FROM paragraphs WHERE sermon_id = ? ORDER BY paragraph_index ASC').all();
    sermon.text = paragraphs.map(p => p.content).join('\n\n');
    return sermon;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('db:search', (event, { query, mode, limit = 30, offset = 0 }) => {
  if (!db) return [];
  let sqlQuery = query.trim();
  if (!sqlQuery || sqlQuery.length < 2) return [];

  const terms = sqlQuery.split(/\s+/).filter(v => v).map(v => v.replace(/"/g, '""'));

  if (mode === 'EXACT_PHRASE') {
    sqlQuery = `"${terms.join(' ')}"`;
  } else if (mode === 'DIVERSE') {
    sqlQuery = terms.join(' OR ');
  } else {
    sqlQuery = terms.join(' AND ');
  }

  try {
    const stmt = db.prepare(`
      SELECT 
        f.rowid as paragraphId, 
        f.sermon_id as sermonId, 
        f.paragraph_index as paragraphIndex, 
        snippet(paragraphs_fts, 0, '<mark class="bg-teal-600/30 text-teal-900 dark:text-teal-100 font-bold px-0.5 rounded">', '</mark>', '...', 32) as snippet,
        s.title, s.date, s.city
      FROM paragraphs_fts f
      JOIN sermons s ON f.sermon_id = s.id
      WHERE paragraphs_fts MATCH ? 
      LIMIT ? OFFSET ?
    `);
    return stmt.all(sqlQuery, limit, offset);
  } catch (e) {
    console.error("SQL Search Error:", e);
    return [];
  }
});

ipcMain.handle('db:importSermons', (event, sermons) => {
  try {
    checkDb();

    // Désactivation temporaire des FK pour la rapidité de purge
    db.pragma('foreign_keys = OFF');

    const transaction = db.transaction((data) => {
      // Nettoyage complet
      db.prepare('DELETE FROM paragraphs_fts').run();
      db.prepare('DELETE FROM paragraphs').run();
      db.prepare('DELETE FROM sermons').run();

      const insertSermon = db.prepare('INSERT INTO sermons (id, title, date, city, version, time, audio_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const insertPara = db.prepare('INSERT INTO paragraphs (sermon_id, paragraph_index, content) VALUES (?, ?, ?)');
      const insertFTS = db.prepare('INSERT INTO paragraphs_fts (content, sermon_id, paragraph_index) VALUES (?, ?, ?)');

      for (const s of data) {
        if (!s.id || !s.text) continue;
        
        insertSermon.run(s.id, s.title || 'Sans titre', s.date || '0000-00-00', s.city || '', s.version || 'VGR', s.time || 'Soir', s.audio_url || '');
        
        const segments = s.text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        segments.forEach((p, i) => {
          const content = p.trim();
          insertPara.run(s.id, i + 1, content);
          insertFTS.run(content, s.id, i + 1);
        });
      }
      return data.length;
    });

    const count = transaction(sermons);
    db.pragma('foreign_keys = ON');
    return { success: true, count };
  } catch (error) {
    db.pragma('foreign_keys = ON');
    console.error("[DB Import Error]:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:getNotes', () => {
  if (!db) return [];
  try {
    const ns = db.prepare('SELECT * FROM notes ORDER BY "order" ASC').all();
    ns.forEach(n => {
      n.creationDate = n.creation_date;
      n.citations = db.prepare('SELECT * FROM citations WHERE note_id = ?').all(n.id);
    });
    return ns;
  } catch (e) {
    return [];
  }
});

ipcMain.handle('db:saveNote', (event, note) => {
  try {
    checkDb();
    db.prepare('INSERT INTO notes (id, title, content, color, "order", creation_date) VALUES (@id, @title, @content, @color, @order, @creationDate) ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, color=excluded.color, "order"=excluded."order"').run(note);
    db.prepare('DELETE FROM citations WHERE note_id = ?').run(note.id);
    const insC = db.prepare('INSERT INTO citations (id, note_id, sermon_id, sermon_title_snapshot, sermon_date_snapshot, quoted_text, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)');
    note.citations.forEach(c => insC.run(c.id || Math.random().toString(), note.id, c.sermon_id, c.sermon_title_snapshot, c.sermon_date_snapshot, c.quoted_text, c.date_added || new Date().toISOString()));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:deleteNote', (event, id) => {
  try {
    checkDb();
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:reorderNotes', (event, notes) => {
  try {
    checkDb();
    db.transaction(items => items.forEach((it, i) => db.prepare('UPDATE notes SET "order" = ? WHERE id = ?').run(i, it.id)))(notes);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function createWindow() {
  initDatabase();
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false 
    },
  });
  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
