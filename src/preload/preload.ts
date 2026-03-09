/**
 * preload.ts — Bonsai Preload Script
 *
 * Exposes a safe `window.electronAPI` object to the renderer process via
 * Electron's contextBridge.  Every method maps 1-to-1 to an IPC channel
 * handled in main.ts.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- Projects ----

  /** Create a new Bonsai project at `projectPath` with name `name`. */
  projectCreate: (projectPath: string, name: string) =>
    ipcRenderer.invoke('project:create', projectPath, name),

  /** Delete a Bonsai project (removes .app_data, .git, .gitignore). */
  projectDelete: (projectPath: string) =>
    ipcRenderer.invoke('project:delete', projectPath),

  /** List all registered Bonsai projects. */
  projectList: () => ipcRenderer.invoke('project:list'),

  /** Get the full milestone tree / DAG for a project. */
  projectTree: (projectPath: string) =>
    ipcRenderer.invoke('project:tree', projectPath),

  // ---- Milestones ----

  /** Create the very first milestone (initialise base files + Git). */
  milestoneCreateInitial: (
    projectPath: string,
    message: string,
    description?: string,
  ) =>
    ipcRenderer.invoke('milestone:create-initial', projectPath, message, description),

  /** Create a subsequent milestone (diff, patch, commit). */
  milestoneCreate: (projectPath: string, message: string, description?: string) =>
    ipcRenderer.invoke('milestone:create', projectPath, message, description),

  /** Restore working directory to a specific milestone. */
  milestoneRestore: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:restore', projectPath, milestoneId),

  /** Delete a leaf milestone. */
  milestoneDelete: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:delete', projectPath, milestoneId),

  /** Get total storage size for a milestone (bytes). */
  milestoneStorageSize: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:storage-size', projectPath, milestoneId),

  /** Get list of tracked file paths for a milestone. */
  milestoneTrackedFiles: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:tracked-files', projectPath, milestoneId),

  /** Rename a milestone's message. */
  milestoneRename: (projectPath: string, milestoneId: string, newMessage: string) =>
    ipcRenderer.invoke('milestone:rename', projectPath, milestoneId, newMessage),

  /** Set tags on a milestone. */
  milestoneSetTags: (projectPath: string, milestoneId: string, tags: string[]) =>
    ipcRenderer.invoke('milestone:set-tags', projectPath, milestoneId, tags),

  /** Set description on a milestone. */
  milestoneSetDescription: (projectPath: string, milestoneId: string, description: string) =>
    ipcRenderer.invoke('milestone:set-description', projectPath, milestoneId, description),

  /** Export a milestone's reconstructed files as a ZIP. */
  milestoneExportZip: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:export-zip', projectPath, milestoneId),

  /** Check if project has unsaved changes since last milestone. */
  projectHasChanges: (projectPath: string) =>
    ipcRenderer.invoke('project:has-changes', projectPath),

  /** Get storage statistics for a project. */
  projectStorageStats: (projectPath: string) =>
    ipcRenderer.invoke('project:storage-stats', projectPath),

  /** Rename a project. */
  projectRename: (projectPath: string, newName: string) =>
    ipcRenderer.invoke('project:rename', projectPath, newName),

  // ---- Dialogs ----

  /** Open a native directory picker dialog. */
  openDirectory: (title?: string, defaultPath?: string, multiSelect?: boolean) =>
    ipcRenderer.invoke('dialog:open-directory', title, defaultPath, multiSelect),

  /** Open a native file picker dialog. */
  openFile: (title?: string, defaultPath?: string, filters?: { name: string; extensions: string[] }[], multiSelect?: boolean) =>
    ipcRenderer.invoke('dialog:open-file', title, defaultPath, filters, multiSelect),

  // ---- Settings ----

  /** Get a single app setting by key. */
  settingsGet: (key: string) =>
    ipcRenderer.invoke('settings:get', key),

  /** Set a single app setting by key. */
  settingsSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('settings:set', key, value),

  // ---- Auto-Watch ----

  /** Start auto-watching a project folder for file changes. */
  autoWatchStart: (projectPath: string) =>
    ipcRenderer.invoke('autowatch:start', projectPath),

  /** Stop auto-watching a project folder. */
  autoWatchStop: (projectPath: string) =>
    ipcRenderer.invoke('autowatch:stop', projectPath),

  /** Check if auto-watch is active for a project. */
  autoWatchStatus: (projectPath: string) =>
    ipcRenderer.invoke('autowatch:status', projectPath),

  // ---- Blacklist ----

  /** Get the blacklist (ignored files/folders) for a project. */
  blacklistGet: (projectPath: string) =>
    ipcRenderer.invoke('blacklist:get', projectPath),

  /** Set the blacklist (ignored files/folders) for a project. */
  blacklistSet: (projectPath: string, items: string[]) =>
    ipcRenderer.invoke('blacklist:set', projectPath, items),

  /** Listen for auto-watch milestone creation events from the backend. */
  onAutoWatchMilestoneCreated: (callback: (projectPath: string, milestoneId: string) => void) => {
    const handler = (_event: any, projectPath: string, milestoneId: string) => {
      callback(projectPath, milestoneId);
    };
    ipcRenderer.on('autowatch:milestone-created', handler);
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('autowatch:milestone-created', handler);
    };
  },

  /** Current OS platform (e.g. 'darwin', 'win32', 'linux'). */
  platform: process.platform,
});