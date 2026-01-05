
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isProjection = url.includes('projection=true');
    const isMask = url.includes('mask=true');

    if (isProjection || isMask) {
      const displays = screen.getAllDisplays();
      const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
      let targetDisplay = displays.find(d => d.id !== currentDisplay.id);

      // Si pas de second écran, on utilise l'écran courant
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
