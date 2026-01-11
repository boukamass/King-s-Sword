const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Database = require('better-sqlite3');

const isDev = !app.isPackaged;
let mainWindow;
let db;

function initDatabase() {
  try {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const dbPath = path.join(userDataPath, 'kings_sword_v2.db');
    
    db = new Database(dbPath);
    // Optimisations PRAGMA pour la performance
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
        paragraph_index UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 1'
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
        sermon_version_snapshot TEXT,
        quoted_text TEXT, 
        date_added TEXT, 
        paragraph_index INTEGER,
        FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
      );
    `);

    try {
      db.prepare('SELECT sermon_version_snapshot FROM citations LIMIT 1').get();
    } catch (e) {
      db.exec('ALTER TABLE citations ADD COLUMN sermon_version_snapshot TEXT');
    }

  } catch (err) {
    console.error(`[DB] Erreur fatale initialisation: ${err.message}`);
    db = null;
  }
}

const checkDb = () => { 
  if (!db) {
    initDatabase();
    if (!db) throw new Error("Base de données indisponible.");
  }
};

ipcMain.handle('db:isReady', () => !!db);

ipcMain.handle('db:getSermonsMetadata', () => {
  if (!db) return [];
  try {
    return db.prepare('SELECT id, title, date, city, version FROM sermons ORDER BY date DESC').all();
  } catch (e) {
    console.error("[DB] Metadata error:", e.message);
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
    console.error("[DB] Get Sermon error:", e.message);
    return null;
  }
});

ipcMain.handle('db:search', (event, { query, mode, limit = 50, offset = 0 }) => {
  if (!db) return [];
  const rawQuery = (query || "").trim();
  if (!rawQuery || rawQuery.length < 2) return [];

  // Nettoyage des termes pour FTS5
  const cleanTerms = rawQuery.replace(/[*\-"'()]/g, ' ').split(/\s+/).filter(v => v.length > 0);
  if (cleanTerms.length === 0) return [];

  let ftsQuery = '';
  if (mode === 'EXACT_PHRASE') {
    ftsQuery = `"${cleanTerms.join(' ')}"`;
  } else if (mode === 'DIVERSE') {
    ftsQuery = cleanTerms.map(t => `${t}*`).join(' OR ');
  } else { 
    // EXACT_WORDS: Utiliser explicitement AND pour garantir que tous les termes sont présents
    ftsQuery = cleanTerms.map(t => `${t}*`).join(' AND ');
  }

  const safeLimit = Number(limit) || 50;
  const safeOffset = Number(offset) || 0;

  try {
    const highlightOpen = '<mark class="bg-amber-400/40 dark:bg-amber-500/40 text-amber-950 dark:text-white font-bold px-0.5 rounded-sm shadow-sm border-b-2 border-amber-600/30">';
    const highlightClose = '</mark>';
    
    // Correction FTS5 : l'alias de table 'f' doit être utilisé dans snippet et MATCH pour les jointures
    const stmt = db.prepare(`
      SELECT 
        f.rowid as paragraphId, 
        f.sermon_id as sermonId, 
        f.paragraph_index as paragraphIndex, 
        snippet(f, 0, ?, ?, '...', 64) as snippet,
        s.title, s.date, s.city
      FROM paragraphs_fts f
      INNER JOIN sermons s ON f.sermon_id = s.id
      WHERE f MATCH ? 
      ORDER BY s.date DESC
      LIMIT ? OFFSET ?
    `);
    
    return stmt.all(highlightOpen, highlightClose, ftsQuery, safeLimit, safeOffset);
  } catch (e) {
    console.error("[DB Search Error]:", e.message);
    return [];
  }
});

ipcMain.handle('db:importSermons', (event, sermons) => {
  try {
    checkDb();
    
    const transaction = db.transaction((data) => {
      db.prepare('DELETE FROM paragraphs_fts').run();
      db.prepare('DELETE FROM paragraphs').run();
      db.prepare('DELETE FROM sermons').run();

      const insS = db.prepare('INSERT OR REPLACE INTO sermons (id, title, date, city, version, time, audio_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const insP = db.prepare('INSERT INTO paragraphs (sermon_id, paragraph_index, content) VALUES (?, ?, ?)');
      const insFTS = db.prepare('INSERT INTO paragraphs_fts (content, sermon_id, paragraph_index) VALUES (?, ?, ?)');
      
      for (const s of data) {
        const baseId = s.id || `gen-${Math.random().toString(36).substr(2, 9)}`;
        const sId = s.version ? `${baseId}-${s.version}` : baseId;
        const sText = s.text || "...";

        insS.run(
          sId, 
          s.title || 'Sermon sans titre', 
          s.date || '0000-00-00', 
          s.city || '', 
          s.version || 'VGR', 
          s.time || 'Inconnu', 
          s.audio_url || ''
        );
        
        const segments = sText.split(/\n\s*\n/);
        segments.forEach((p, i) => {
          const content = p.trim();
          if (content) {
            insP.run(sId, i + 1, content);
            insFTS.run(content, sId, i + 1);
          }
        });
      }
    });

    transaction(sermons);
    return { success: true, count: sermons.length };
  } catch (e) {
    console.error(`[DB] Erreur fatale importation: ${e.message}`);
    return { success: false, error: e.message };
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
    const insC = db.prepare('INSERT INTO citations (id, note_id, sermon_id, sermon_title_snapshot, sermon_date_snapshot, sermon_version_snapshot, quoted_text, date_added, paragraph_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    if (note.citations && Array.isArray(note.citations)) {
      note.citations.forEach(c => insC.run(c.id || Math.random().toString(), note.id, c.sermon_id, c.sermon_title_snapshot, c.sermon_date_snapshot, c.sermon_version_snapshot || null, c.quoted_text, c.date_added || new Date().toISOString(), c.paragraph_index || null));
    }
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    const isProjection = parsedUrl.searchParams.get('projection') === 'true';
    const isMask = parsedUrl.searchParams.get('mask') === 'true';

    if (isProjection || isMask) {
      const displays = screen.getAllDisplays();
      const externalDisplay = displays.length > 1 ? displays[1] : displays[0];

      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          x: externalDisplay.bounds.x,
          y: externalDisplay.bounds.y,
          width: externalDisplay.bounds.width,
          height: externalDisplay.bounds.height,
          fullscreen: true,
          autoHideMenuBar: true,
          backgroundColor: '#000000',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
          }
        }
      };
    }
    return { action: 'allow' };
  });

  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));

  autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update_available');
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update_downloaded');
  });

  mainWindow.once('ready-to-show', () => {
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());