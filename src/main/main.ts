import { app, BrowserWindow } from 'electron';
import * as path from 'path';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      // Important: Keep nodeIntegration false and contextIsolation true for React later
      nodeIntegration: false,
      contextIsolation: true, 
    },
  });

  // For now, load a basic string. Later, this will load your React index.html
  mainWindow.loadURL('data:text/html;charset=utf-8,<h2>Electron Backend Initialized</h2>');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});