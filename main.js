
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Database = require('better-sqlite3');

// Détection officielle Electron : si l'app n'est pas "packagée", on est en dev.
const isDev = !app.isPackaged;

let mainWindow;
let db;

console.log("--------------------------------------------------");
console.log(`[Main] Démarrage...`);
console.log(`[Main] app.isPackaged: ${app.isPackaged}`);
console.log(`[Main] Mode détecté: ${isDev ? 'DÉVELOPPEMENT' : 'PRODUCTION'}`);
console.log("--------------------------------------------------");

// --- INITIALISATION SQLITE ---
function initDatabase() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'kings_sword_v2.db');
    console.log(`[DB] Chemin base de données: ${dbPath}`);
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
    console.log(`[DB] Tables vérifiées avec succès.`);
  } catch (err) {
    console.error(`[DB] Erreur fatale initialisation:`, err);
  }
}

// --- IPC HANDLERS ---
ipcMain.handle('db:getSermonsMetadata', () => db.prepare('SELECT id, title, date, city, version, time, audio_url FROM sermons ORDER BY date DESC').all());
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
  if (mode === 'EXACT_PHRASE') sqlQuery = `"${sqlQuery}"`;
  else if (mode === 'DIVERSE') sqlQuery = sqlQuery.split(/\s+/).filter(v => v).map(v => `${v}*`).join(' AND ');
  else sqlQuery = `${sqlQuery}*`;

  return db.prepare(`
    SELECT rowid as paragraphId, sermon_id as sermonId, paragraph_index as paragraphIndex, 
    snippet(paragraphs_fts, 0, '<mark class="bg-teal-600/30">', '</mark>', '...', 32) as snippet
    FROM paragraphs_fts WHERE content MATCH ? LIMIT ? OFFSET ?
  `).all(sqlQuery, limit, offset).map(res => ({ ...res, ...db.prepare('SELECT title, date, city FROM sermons WHERE id = ?').get(res.sermonId) }));
});
ipcMain.handle('db:importSermons', (event, sermons) => {
  db.transaction((data) => {
    db.prepare('DELETE FROM sermons').run();
    const insS = db.prepare('INSERT INTO sermons VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insP = db.prepare('INSERT INTO paragraphs VALUES (?, ?, ?, ?)');
    for (const s of data) {
      insS.run(s.id, s.title, s.date, s.city, s.version || 'VGR', s.time || 'Soir', s.audio_url || '');
      s.text.split(/\n\s*\n/).forEach((p, i) => insP.run(`${s.id}_${i}`, s.id, i + 1, p.trim()));
    }
  })(sermons);
  return { success: true };
});
ipcMain.handle('db:getNotes', () => {
  const ns = db.prepare('SELECT * FROM notes ORDER BY "order" ASC').all();
  ns.forEach(n => n.citations = db.prepare('SELECT * FROM citations WHERE note_id = ?').all(n.id));
  return ns;
});
ipcMain.handle('db:saveNote', (event, note) => {
  db.prepare('INSERT INTO notes VALUES (@id, @title, @content, @color, @order, @creation_date) ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, color=excluded.color, "order"=excluded."order"').run({ ...note, creation_date: note.creationDate });
  db.prepare('DELETE FROM citations WHERE note_id = ?').run(note.id);
  const insC = db.prepare('INSERT INTO citations VALUES (?, ?, ?, ?, ?, ?, ?)');
  note.citations.forEach(c => insC.run(c.id || Math.random().toString(), note.id, c.sermon_id, c.sermon_title_snapshot, c.sermon_date_snapshot, c.quoted_text, c.date_added || new Date().toISOString()));
  return { success: true };
});
ipcMain.handle('db:deleteNote', (event, id) => (db.prepare('DELETE FROM notes WHERE id = ?').run(id), { success: true }));
ipcMain.handle('db:reorderNotes', (event, notes) => (db.transaction(items => items.forEach((it, i) => db.prepare('UPDATE notes SET "order" = ? WHERE id = ?').run(i, it.id)))(notes), { success: true }));

function createWindow() {
  initDatabase();
  
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Utile en dev pour charger des assets locaux si besoin
    },
  });

  if (isDev) {
    console.log("[Main] Tentative de chargement de Vite: http://localhost:5173");
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    console.log(`[Main] Chargement du fichier prod: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log(`[Main] Échec de chargement (${errorCode}): ${errorDescription}`);
    console.log(`[Main] URL tentée: ${validatedURL}`);
    
    // Si Vite n'est pas encore prêt, on réessaie
    if (isDev && validatedURL.includes('localhost')) {
      console.log("[Main] Le serveur Vite semble indisponible, nouvel essai dans 2s...");
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) mainWindow.loadURL('http://localhost:5173');
      }, 2000);
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
