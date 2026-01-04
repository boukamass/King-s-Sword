
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
      const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
      
      // On cherche l'écran secondaire physique
      let targetDisplay = displays.find(d => d.id !== currentDisplay.id);

      // Si un seul écran logique est détecté (mode Dupliqué), on bloque l'ouverture du masque
      // pour ne pas perdre le contrôle de l'application principale.
      if (!targetDisplay && isMask) {
        return { action: 'deny' };
      }
      
      // Par défaut, si pas de second écran, on utilise l'écran actuel (pour la projection simple)
      if (!targetDisplay) targetDisplay = currentDisplay;

      const windowOptions = {
        fullscreen: true,
        autoHideMenuBar: true,
        backgroundColor: '#000000',
        title: isMask ? "King's Sword - Masque" : "King's Sword - Projection",
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
        frame: false,
        movable: false,
        resizable: false,
        closable: true,
        alwaysOnTop: isMask,
        skipTaskbar: true,
        focusable: !isMask,
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

// Logicielle de mise à jour
autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update_available');
});
autoUpdater.on('update-downloaded', (info) => {
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
