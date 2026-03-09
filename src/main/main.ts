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
  blacklistGet,
  blacklistSet,
  milestoneStorageSize,
  milestoneTrackedFiles,
  projectHasChanges,
  milestoneRename,
  milestoneSetTags,
  milestoneExportZip,
  projectStorageStats,
  projectRename,
  settingsGet,
  settingsSet,
} from './core/vcs';
import {
  autoWatchStart,
  autoWatchStop,
  autoWatchStatus,
  autoWatchStopAll,
  autoWatchSuspend,
  autoWatchResume,
  autoWatchRestoreAll,
} from './core/autowatch';

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: true,
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
      autoWatchSuspend(projectPath);
      try {
        return await milestoneRestore(projectPath, milestoneId);
      } finally {
        autoWatchResume(projectPath);
      }
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
    async (_event, title?: string, defaultPath?: string, multiSelect?: boolean) => {
      const win = BrowserWindow.getFocusedWindow();
      const properties: Electron.OpenDialogOptions['properties'] = ['openDirectory', 'createDirectory'];
      if (multiSelect) properties.push('multiSelections');
      const result = await dialog.showOpenDialog(win!, {
        title: title || 'Select Directory',
        defaultPath: defaultPath || undefined,
        properties,
      });
      return { canceled: result.canceled, path: result.filePaths[0] ?? null, paths: result.filePaths };
    },
  );

  // ---- dialog:open-file ----
  ipcMain.handle(
    'dialog:open-file',
    async (_event, title?: string, defaultPath?: string, filters?: Electron.FileFilter[], multiSelect?: boolean) => {
      const win = BrowserWindow.getFocusedWindow();
      const properties: Electron.OpenDialogOptions['properties'] = ['openFile'];
      if (multiSelect) properties.push('multiSelections');
      const result = await dialog.showOpenDialog(win!, {
        title: title || 'Select File',
        defaultPath: defaultPath || undefined,
        properties,
        filters: filters || undefined,
      });
      return { canceled: result.canceled, path: result.filePaths[0] ?? null, paths: result.filePaths };
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

  // ---- blacklist:get ----
  ipcMain.handle(
    'blacklist:get',
    async (_event, projectPath: string) => {
      console.log(`[ipc] blacklist:get  path=${projectPath}`);
      return blacklistGet(projectPath);
    },
  );

  // ---- blacklist:set ----
  ipcMain.handle(
    'blacklist:set',
    async (_event, projectPath: string, items: string[]) => {
      console.log(`[ipc] blacklist:set  path=${projectPath}`);
      return blacklistSet(projectPath, items);
    },
  );

  // ---- milestone:storage-size ----
  ipcMain.handle(
    'milestone:storage-size',
    async (_event, projectPath: string, milestoneId: string) => {
      console.log(`[ipc] milestone:storage-size  path=${projectPath}  id=${milestoneId}`);
      return milestoneStorageSize(projectPath, milestoneId);
    },
  );

  // ---- milestone:tracked-files ----
  ipcMain.handle(
    'milestone:tracked-files',
    async (_event, projectPath: string, milestoneId: string) => {
      console.log(`[ipc] milestone:tracked-files  path=${projectPath}  id=${milestoneId}`);
      return milestoneTrackedFiles(projectPath, milestoneId);
    },
  );

  // ---- project:has-changes ----
  ipcMain.handle(
    'project:has-changes',
    async (_event, projectPath: string) => {
      console.log(`[ipc] project:has-changes  path=${projectPath}`);
      return projectHasChanges(projectPath);
    },
  );

  // ---- milestone:rename ----
  ipcMain.handle(
    'milestone:rename',
    async (_event, projectPath: string, milestoneId: string, newMessage: string) => {
      console.log(`[ipc] milestone:rename  path=${projectPath}  id=${milestoneId}`);
      return milestoneRename(projectPath, milestoneId, newMessage);
    },
  );

  // ---- milestone:set-tags ----
  ipcMain.handle(
    'milestone:set-tags',
    async (_event, projectPath: string, milestoneId: string, tags: string[]) => {
      console.log(`[ipc] milestone:set-tags  path=${projectPath}  id=${milestoneId}`);
      return milestoneSetTags(projectPath, milestoneId, tags);
    },
  );

  // ---- milestone:export-zip ----
  ipcMain.handle(
    'milestone:export-zip',
    async (_event, projectPath: string, milestoneId: string) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: 'Export Milestone as ZIP',
        defaultPath: `milestone-${milestoneId.slice(0, 8)}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) {
        return { status: 'canceled' as const };
      }
      return milestoneExportZip(projectPath, milestoneId, result.filePath);
    },
  );

  // ---- project:storage-stats ----
  ipcMain.handle(
    'project:storage-stats',
    async (_event, projectPath: string) => {
      console.log(`[ipc] project:storage-stats  path=${projectPath}`);
      return projectStorageStats(projectPath);
    },
  );

  // ---- project:rename ----
  ipcMain.handle(
    'project:rename',
    async (_event, projectPath: string, newName: string) => {
      console.log(`[ipc] project:rename  path=${projectPath}  newName=${newName}`);
      return projectRename(projectPath, newName);
    },
  );

  // ---- settings:get ----
  ipcMain.handle(
    'settings:get',
    async (_event, key: string) => {
      return settingsGet(key);
    },
  );

  // ---- settings:set ----
  ipcMain.handle(
    'settings:set',
    async (_event, key: string, value: unknown) => {
      return settingsSet(key, value);
    },
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  registerIpcHandlers();
  createWindow();

  // Re-activate auto-watch for projects that had it enabled
  await autoWatchRestoreAll();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  autoWatchStopAll();
  if (process.platform !== 'darwin') app.quit();
});