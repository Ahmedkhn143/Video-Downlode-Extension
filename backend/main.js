const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// 1. Start the Express server in the background
try {
  require('./server');
  console.log('[Electron] Background Express server started successfully.');
} catch (err) {
  console.error('[Electron] Failed to start Express server:', err);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 650,
    height: 520,
    minWidth: 550,
    minHeight: 450,
    title: 'NexDown Desktop Assistant',
    icon: path.join(__dirname, '..', 'extension', 'icon128.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true, // Clean native UI window
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links (like folders or browser URLs) in user's default browser/explorer
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
