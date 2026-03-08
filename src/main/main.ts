/**
 * main.ts — Bonsai Electron Main Process
 *
 * Sets up the BrowserWindow and registers all IPC handlers that the
 * renderer (React frontend) calls via window.electronAPI.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as path from 'path';
import {
  projectCreate,
  projectDelete,
  projectList,
  projectTree,
  milestoneCreateInitial,
  milestoneCreate,
  milestoneRestore,
  milestoneDelete,
} from './core/vcs';
import {
  autoWatchStart,
  autoWatchStop,
  autoWatchStatus,
  autoWatchStopAll,
} from './core/autowatch';

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: process.platform === 'darwin' || process.platform === 'win32',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform === 'win32' || process.platform === 'linux',
    title: 'Bonsai',
    icon: path.join(__dirname, '../../assets/images/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the test / production renderer page
  const rendererIndex = path.join(__dirname, '../../src/renderer/dist/index.html');
  mainWindow.loadFile(rendererIndex).catch(() => {
    mainWindow.loadURL(
      'data:text/html;charset=utf-8,<h2>Bonsai — Electron Backend Ready</h2>',
    );
  });
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  // ---- project:create ----
  ipcMain.handle(
    'project:create',
    async (_event, projectPath: string, name: string) => {
      console.log(`[ipc] project:create  path=${projectPath}  name=${name}`);
      return projectCreate(projectPath, name);
    },
  );

  // ---- project:delete ----
  ipcMain.handle(
    'project:delete',
    async (_event, projectPath: string) => {
      console.log(`[ipc] project:delete  path=${projectPath}`);
      return projectDelete(projectPath);
    },
  );

  // ---- project:list ----
  ipcMain.handle('project:list', async () => {
    console.log('[ipc] project:list');
    return projectList();
  });

  // ---- project:tree ----
  ipcMain.handle(
    'project:tree',
    async (_event, projectPath: string) => {
      console.log(`[ipc] project:tree  path=${projectPath}`);
      return projectTree(projectPath);
    },
  );

  // ---- milestone:create-initial ----
  ipcMain.handle(
    'milestone:create-initial',
    async (_event, projectPath: string, message: string) => {
      console.log(`[ipc] milestone:create-initial  path=${projectPath}`);
      return milestoneCreateInitial(projectPath, message);
    },
  );

  // ---- milestone:create ----
  ipcMain.handle(
    'milestone:create',
    async (_event, projectPath: string, message: string) => {
      console.log(`[ipc] milestone:create  path=${projectPath}`);
      return milestoneCreate(projectPath, message);
    },
  );

  // ---- milestone:restore ----
  ipcMain.handle(
    'milestone:restore',
    async (_event, projectPath: string, milestoneId: string) => {
      console.log(`[ipc] milestone:restore  path=${projectPath}  id=${milestoneId}`);
      return milestoneRestore(projectPath, milestoneId);
    },
  );

  // ---- milestone:delete ----
  ipcMain.handle(
    'milestone:delete',
    async (_event, projectPath: string, milestoneId: string) => {
      console.log(`[ipc] milestone:delete  path=${projectPath}  id=${milestoneId}`);
      return milestoneDelete(projectPath, milestoneId);
    },
  );

  // ---- dialog:open-directory ----
  ipcMain.handle(
    'dialog:open-directory',
    async (_event, title?: string, defaultPath?: string) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: title || 'Select Directory',
        defaultPath: defaultPath || undefined,
        properties: ['openDirectory', 'createDirectory'],
      });
      return { canceled: result.canceled, path: result.filePaths[0] ?? null };
    },
  );

  // ---- dialog:open-file ----
  ipcMain.handle(
    'dialog:open-file',
    async (_event, title?: string, defaultPath?: string, filters?: Electron.FileFilter[]) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: title || 'Select File',
        defaultPath: defaultPath || undefined,
        properties: ['openFile'],
        filters: filters || undefined,
      });
      return { canceled: result.canceled, path: result.filePaths[0] ?? null };
    },
  );

  // ---- autowatch:start ----
  ipcMain.handle(
    'autowatch:start',
    async (_event, projectPath: string) => {
      console.log(`[ipc] autowatch:start  path=${projectPath}`);
      return autoWatchStart(projectPath);
    },
  );

  // ---- autowatch:stop ----
  ipcMain.handle(
    'autowatch:stop',
    async (_event, projectPath: string) => {
      console.log(`[ipc] autowatch:stop  path=${projectPath}`);
      return autoWatchStop(projectPath);
    },
  );

  // ---- autowatch:status ----
  ipcMain.handle(
    'autowatch:status',
    async (_event, projectPath: string) => {
      console.log(`[ipc] autowatch:status  path=${projectPath}`);
      return autoWatchStatus(projectPath);
    },
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  autoWatchStopAll();
  if (process.platform !== 'darwin') app.quit();
});