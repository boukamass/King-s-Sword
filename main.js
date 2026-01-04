
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow;

function createWindow() {
  const iconPath = isDev 
    ? path.join(__dirname, 'public/icon.ico') 
    : path.join(__dirname, 'dist/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: "King's Sword - Étude de Sermons",
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Gestion de l'ouverture des fenêtres pour la projection et le masquage
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isProjection = url.includes('projection=true');
    const isMask = url.includes('mask=true');

    if (isProjection || isMask) {
      const displays = screen.getAllDisplays();
      
      // On identifie l'écran sur lequel se trouve l'interface de contrôle (mainWindow)
      const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
      
      // On cherche un écran physique qui n'est pas celui de l'application
      let targetDisplay = displays.find(d => d.id !== currentDisplay.id);

      // SECURITÉ CRITIQUE : Si aucun deuxième écran LOGIQUE n'est détecté (Mode Dupliquer),
      // on refuse l'ouverture du masque pour éviter de masquer l'écran de contrôle.
      // En mode "Duplicate", displays.length est égal à 1.
      if (!targetDisplay) {
        return { action: 'deny' };
      }

      const windowOptions = {
        fullscreen: true,
        autoHideMenuBar: true,
        backgroundColor: '#000000',
        title: isMask ? "King's Sword - Masque" : "King's Sword - Projection",
        // Positionnement forcé sur l'écran secondaire uniquement
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
        frame: false,
        movable: false,
        resizable: false,
        closable: true,
        alwaysOnTop: isMask, // Le masque reste au-dessus des autres fenêtres sur l'écran 2
        skipTaskbar: true,
        focusable: !isMask, // Empêche le masque de voler le focus clavier de l'app
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      };

      return { 
        action: 'allow',
        overrideBrowserWindowOptions: windowOptions
      };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });
}

// Logique de mise à jour
autoUpdater.on('checking-for-update', () => { console.log('Vérification des mises à jour...'); });
autoUpdater.on('update-available', (info) => {
  console.log('Mise à jour disponible:', info.version);
  if (mainWindow) mainWindow.webContents.send('update_available');
});
autoUpdater.on('update-not-available', (info) => { console.log('Pas de mise à jour disponible.'); });
autoUpdater.on('error', (err) => { console.log('Erreur auto-updater:', err); });
autoUpdater.on('download-progress', (progressObj) => { console.log('Téléchargé ' + progressObj.percent + '%'); });
autoUpdater.on('update-downloaded', (info) => {
  console.log('Mise à jour téléchargée');
  if (mainWindow) mainWindow.webContents.send('update_downloaded');
});

ipcMain.on('restart_app', () => { autoUpdater.quitAndInstall(); });

ipcMain.on('print-page', (event) => {
  const webContents = event.sender;
  const win = BrowserWindow.fromWebContents(webContents);
  if (win) {
    win.webContents.print({}, (success, errorType) => {
      if (!success) console.log(`Printing Error: ${errorType}`);
    });
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
