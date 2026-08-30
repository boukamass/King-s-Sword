
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { autoUpdater } = require('electron-updater');

// Delay loading better-sqlite3 to handle missing bindings gracefully
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[DB] Erreur: Impossible de charger better-sqlite3 (bindings manquants).', e.message);
}

const isDev = !app.isPackaged;
let mainWindow;
let db = null;

// ==========================================
// SÉCURITÉ LOCALE & CHIFFREMENT
// ==========================================
const SECURITY_SECRET = 'KS_SWORD_MASTER_SECURITY_KEY_2026';

function encryptSecret(plainText) {
  if (!plainText) return '';
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(plainText);
      return 'DPAPI:' + buffer.toString('base64');
    }
  } catch (e) {
    // safeStorage non supporté dans cet environnement
  }
  try {
    const key = crypto.scryptSync(SECURITY_SECRET, 'ks_salt_2026', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return 'AES:' + iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    return 'RAW:' + Buffer.from(plainText).toString('base64');
  }
}

function decryptSecret(cipherText) {
  if (!cipherText) return '';
  try {
    if (cipherText.startsWith('DPAPI:')) {
      const { safeStorage } = require('electron');
      const raw = Buffer.from(cipherText.replace('DPAPI:', ''), 'base64');
      return safeStorage.decryptString(raw);
    } else if (cipherText.startsWith('AES:')) {
      const parts = cipherText.split(':');
      const iv = Buffer.from(parts[1], 'hex');
      const data = parts[2];
      const key = crypto.scryptSync(SECURITY_SECRET, 'ks_salt_2026', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } else if (cipherText.startsWith('RAW:')) {
      return Buffer.from(cipherText.replace('RAW:', ''), 'base64').toString('utf8');
    }
  } catch (e) {
    console.warn('[SECURITY] Erreur déchiffrement secret:', e.message);
  }
  return cipherText;
}

function initDatabase() {
  if (!Database) {
    console.error('[DB] Initialisation avortée: Le module better-sqlite3 n\'est pas disponible.');
    return;
  }

  try {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const dbPath = path.join(userDataPath, 'kings_sword_v2.db');
    
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -64000'); // 64MB memory page cache
    db.pragma('mmap_size = 30000000000'); // Memory-mapped I/O for instantaneous reads
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

      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        language TEXT,
        filename TEXT,
        custom INTEGER DEFAULT 0,
        updated_at TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
        title,
        content,
        song_id UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 1'
      );

      CREATE TABLE IF NOT EXISTS key_value_store (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_paragraphs_sermon_id ON paragraphs(sermon_id);
      CREATE INDEX IF NOT EXISTS idx_citations_note_id ON citations(note_id);
      CREATE INDEX IF NOT EXISTS idx_notes_order ON notes("order");
      CREATE INDEX IF NOT EXISTS idx_sermons_date ON sermons(date DESC);
    `);

    try {
      db.prepare('SELECT sermon_version_snapshot FROM citations LIMIT 1').get();
    } catch (e) {
      db.exec('ALTER TABLE citations ADD COLUMN sermon_version_snapshot TEXT');
    }

  } catch (err) {
    console.error(`[DB] Erreur fatale initialisation base de données: ${err.message}`);
    db = null;
  }
}

ipcMain.handle('db:isReady', () => db !== null);

ipcMain.handle('db:getSermonsMetadata', () => {
  if (!db) return [];
  try {
    return db.prepare('SELECT id, title, date, city, version, audio_url FROM sermons ORDER BY date DESC').all();
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

ipcMain.handle('db:search', (event, { query, mode, limit = 50, offset = 0, synonyms = [], showOnlySynonyms = false, showOnlyQuery = false, selectedSynonym = null, filters = {} }) => {
  if (!db) {
    console.warn("[DB] Recherche impossible: Base de données non initialisée.");
    return [];
  }
  
  const rawQuery = (query || "").trim();
  const cleanTerms = rawQuery.replace(/[*\-"'()]/g, ' ').split(/\s+/).filter(v => v.length > 0);
  
  let ftsQuery = '';

  if (selectedSynonym) {
    ftsQuery = `${selectedSynonym.trim().replace(/[*\-"'()]/g, ' ')}*`;
  } else if (synonyms && synonyms.length > 0) {
    let termsToUse = [];
    if (showOnlySynonyms) {
      termsToUse = synonyms;
    } else if (showOnlyQuery) {
      termsToUse = [rawQuery];
    } else {
      termsToUse = [rawQuery, ...synonyms];
    }
    
    const allTerms = termsToUse.map(s => s.trim().replace(/[*\-"'()]/g, ' ')).filter(s => s.length > 0);
    if (allTerms.length === 0) return [];
    ftsQuery = allTerms.map(t => `${t}*`).join(' OR ');
  } else {
    if (cleanTerms.length === 0) return [];
    if (mode === 'EXACT_PHRASE') {
      ftsQuery = `"${cleanTerms.join(' ')}"`;
    } else if (mode === 'DIVERSE') {
      ftsQuery = cleanTerms.map(t => `${t}*`).join(' OR ');
    } else { 
      ftsQuery = cleanTerms.map(t => `${t}*`).join(' AND ');
    }
  }

  const safeLimit = Number(limit) || 50;
  const safeOffset = Number(offset) || 0;

  try {
    // Classes CSS unifiées pour l'élégance et la visibilité (Style Ultra-Black)
    const markBase = "font-black px-1 rounded-sm underline decoration-[3.5px] underline-offset-4 shadow-sm";
    const highlightOpen = `<mark class="${markBase} bg-amber-500 text-white dark:bg-amber-600 decoration-amber-200">`;
    const highlightClose = '</mark>';
    
    let filterClauses = '';
    const queryParams = [highlightOpen, highlightClose, ftsQuery];

    if (filters.year) {
      filterClauses += ' AND s.date LIKE ?';
      queryParams.push(`${filters.year}%`);
    }
    if (filters.month) {
      filterClauses += ' AND SUBSTR(s.date, 6, 2) = ?';
      queryParams.push(filters.month);
    }
    if (filters.day) {
      filterClauses += ' AND SUBSTR(s.date, 9, 2) = ?';
      queryParams.push(filters.day);
    }
    if (filters.city) {
      filterClauses += ' AND s.city = ?';
      queryParams.push(filters.city);
    }
    if (filters.version) {
      filterClauses += ' AND s.version = ?';
      queryParams.push(filters.version);
    }
    if (filters.audio) {
      filterClauses += " AND s.audio_url IS NOT NULL AND s.audio_url != ''";
    }

    queryParams.push(safeLimit, safeOffset);

    const sql = `
      SELECT 
        f.rowid as paragraphId, 
        f.sermon_id as sermonId, 
        f.paragraph_index as paragraphIndex, 
        snippet(paragraphs_fts, 0, ?, ?, '...', 64) as snippet,
        s.title, s.date, s.city, s.audio_url
      FROM paragraphs_fts f
      INNER JOIN sermons s ON f.sermon_id = s.id
      WHERE paragraphs_fts MATCH ? 
      ${filterClauses}
      ORDER BY s.date DESC
      LIMIT ? OFFSET ?
    `;
    
    const rows = db.prepare(sql).all(...queryParams);
    return rows.map(r => {
      let snippet = r.snippet || '';
      let prev = '';
      while (snippet !== prev) {
        prev = snippet;
        snippet = snippet.replace(/<\/mark>([\s.,;:!–?\"“”'()\n\r]*?)<mark[^>]*>/gi, '$1');
      }
      return { ...r, snippet };
    });
  } catch (e) {
    console.error("[DB] Erreur SQL lors de la recherche intégrale:", e.message);
    return [];
  }
});

ipcMain.handle('db:importSermons', (event, sermons) => {
  if (!db) return { success: false, error: "Base de données non initialisée (Problème de bindings SQLite)" };
  
  try {
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
  if (!db) return { success: false, error: "DB Unavailable" };
  try {
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
  if (!db) return { success: false, error: "DB Unavailable" };
  try {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:reorderNotes', (event, notes) => {
  if (!db) return { success: false, error: "DB Unavailable" };
  try {
    db.transaction(items => items.forEach((it, i) => db.prepare('UPDATE notes SET "order" = ? WHERE id = ?').run(i, it.id)))(notes);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:getSongs', () => {
  if (!db) return [];
  try {
    const songs = db.prepare('SELECT id, title, content, language, filename, custom, updated_at as updatedAt FROM songs ORDER BY CAST(id AS INTEGER) ASC, title ASC').all();
    return songs.map(s => ({
      ...s,
      custom: Boolean(s.custom)
    }));
  } catch (e) {
    console.error("[DB] Get Songs error:", e.message);
    return [];
  }
});

ipcMain.handle('db:getSong', (event, id) => {
  if (!db) return null;
  try {
    const song = db.prepare('SELECT id, title, content, language, filename, custom, updated_at as updatedAt FROM songs WHERE id = ?').get(String(id));
    if (!song) return null;
    return {
      ...song,
      custom: Boolean(song.custom)
    };
  } catch (e) {
    console.error("[DB] Get Song error:", e.message);
    return null;
  }
});

ipcMain.handle('db:saveSong', (event, song) => {
  if (!db) return { success: false, error: "DB Unavailable" };
  try {
    const strId = String(song.id);
    const now = song.updatedAt || new Date().toISOString();
    
    const ins = db.prepare(`
      INSERT INTO songs (id, title, content, language, filename, custom, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        title = excluded.title, 
        content = excluded.content, 
        language = excluded.language, 
        filename = excluded.filename, 
        custom = excluded.custom, 
        updated_at = excluded.updated_at
    `);
    
    ins.run(
      strId,
      song.title || '',
      song.content || '',
      song.language || 'fr',
      song.filename || `${song.title}.txt`,
      song.custom ? 1 : 0,
      now
    );

    try {
      db.prepare('DELETE FROM songs_fts WHERE song_id = ?').run(strId);
      db.prepare('INSERT INTO songs_fts (title, content, song_id) VALUES (?, ?, ?)').run(
        song.title || '',
        song.content || '',
        strId
      );
    } catch (ftsErr) {
      console.warn("[DB] Song FTS update warning:", ftsErr.message);
    }

    return { success: true, song: { ...song, id: strId, updatedAt: now } };
  } catch (e) {
    console.error("[DB] Save Song error:", e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:deleteSong', (event, id) => {
  if (!db) return { success: false, error: "DB Unavailable" };
  try {
    const strId = String(id);
    db.prepare('DELETE FROM songs WHERE id = ?').run(strId);
    try {
      db.prepare('DELETE FROM songs_fts WHERE song_id = ?').run(strId);
    } catch (ftsErr) {}
    return { success: true };
  } catch (e) {
    console.error("[DB] Delete Song error:", e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:bulkImportSongs', (event, songsList) => {
  if (!db) return { success: false, error: "DB Unavailable" };
  try {
    const transaction = db.transaction((songs) => {
      const ins = db.prepare(`
        INSERT OR REPLACE INTO songs (id, title, content, language, filename, custom, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insFts = db.prepare(`
        INSERT INTO songs_fts (title, content, song_id) VALUES (?, ?, ?)
      `);

      try {
        db.prepare('DELETE FROM songs_fts').run();
        db.prepare('DELETE FROM songs').run();
      } catch (e) {}

      for (const s of songs) {
        const strId = String(s.id);
        ins.run(
          strId,
          s.title || '',
          s.content || '',
          s.language || 'fr',
          s.filename || `${s.title}.txt`,
          s.custom ? 1 : 0,
          s.updatedAt || new Date().toISOString()
        );
        try {
          insFts.run(s.title || '', s.content || '', strId);
        } catch (e) {}
      }
    });

    transaction(songsList);
    return { success: true, count: songsList.length };
  } catch (e) {
    console.error("[DB] Bulk Import Songs error:", e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:getKV', (event, key) => {
  if (!db) return null;
  try {
    const row = db.prepare('SELECT value FROM key_value_store WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('db:setKV', (event, key, value) => {
  if (!db) return { success: false };
  try {
    db.prepare('INSERT INTO key_value_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(key, typeof value === 'string' ? value : JSON.stringify(value), new Date().toISOString());
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('security:getLockStatus', () => {
  return { locked: false, machineId: '' };
});

ipcMain.handle('security:activateDevice', () => {
  return { success: true };
});

ipcMain.handle('security:encryptSecureData', (event, plainText) => {
  return encryptSecret(plainText);
});

ipcMain.handle('security:decryptSecureData', (event, cipherText) => {
  return decryptSecret(cipherText);
});

ipcMain.handle('backup:exportUserData', async () => {
  if (!db) return { success: false, error: 'Base de données non disponible' };
  try {
    const notes = db.prepare('SELECT * FROM notes').all();
    const songs = db.prepare('SELECT * FROM songs').all();
    const kv = db.prepare('SELECT * FROM key_value_store').all();
    
    return {
      success: true,
      backup: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        appName: "L'Épée du Roi",
        data: {
          notes,
          songs,
          kv
        }
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('backup:importUserData', async (event, backupData) => {
  if (!db) return { success: false, error: 'Base de données non disponible' };
  if (!backupData || !backupData.data) {
    return { success: false, error: 'Format de sauvegarde invalide.' };
  }
  try {
    const { notes, songs, kv } = backupData.data;
    const transaction = db.transaction(() => {
      if (Array.isArray(notes)) {
        const stmtNote = db.prepare(`
          INSERT INTO notes (id, title, content, citations, color, position, created_at, updated_at)
          VALUES (@id, @title, @content, @citations, @color, @position, @created_at, @updated_at)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            citations = excluded.citations,
            color = excluded.color,
            position = excluded.position,
            updated_at = excluded.updated_at
        `);
        for (const n of notes) {
          stmtNote.run({
            id: n.id,
            title: n.title,
            content: n.content,
            citations: typeof n.citations === 'string' ? n.citations : JSON.stringify(n.citations || []),
            color: n.color || null,
            position: n.position || 0,
            created_at: n.created_at || new Date().toISOString(),
            updated_at: n.updated_at || new Date().toISOString()
          });
        }
      }
      
      if (Array.isArray(songs)) {
        const stmtSong = db.prepare(`
          INSERT INTO songs (id, number, title, key_signature, category, lyrics, created_at, updated_at)
          VALUES (@id, @number, @title, @key_signature, @category, @lyrics, @created_at, @updated_at)
          ON CONFLICT(id) DO UPDATE SET
            number = excluded.number,
            title = excluded.title,
            key_signature = excluded.key_signature,
            category = excluded.category,
            lyrics = excluded.lyrics,
            updated_at = excluded.updated_at
        `);
        for (const s of songs) {
          stmtSong.run({
            id: s.id,
            number: s.number,
            title: s.title,
            key_signature: s.key_signature || null,
            category: s.category || null,
            lyrics: typeof s.lyrics === 'string' ? s.lyrics : JSON.stringify(s.lyrics || []),
            created_at: s.created_at || new Date().toISOString(),
            updated_at: s.updated_at || new Date().toISOString()
          });
        }
      }

      if (Array.isArray(kv)) {
        const stmtKV = db.prepare(`
          INSERT INTO key_value_store (key, value, updated_at)
          VALUES (@key, @value, @updated_at)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `);
        for (const item of kv) {
          stmtKV.run({
            key: item.key,
            value: typeof item.value === 'string' ? item.value : JSON.stringify(item.value),
            updated_at: item.updated_at || new Date().toISOString()
          });
        }
      }
    });

    transaction();
    return { 
      success: true, 
      importedNotes: Array.isArray(notes) ? notes.length : 0, 
      importedSongs: Array.isArray(songs) ? songs.length : 0 
    };
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

  mainWindow.maximize();

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
          kiosk: true,
          frame: false,
          titleBarStyle: 'hidden',
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

app.on('ready', () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
