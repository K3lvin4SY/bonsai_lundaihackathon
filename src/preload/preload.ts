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
  ) =>
    ipcRenderer.invoke('milestone:create-initial', projectPath, message),

  /** Create a subsequent milestone (diff, patch, commit). */
  milestoneCreate: (projectPath: string, message: string) =>
    ipcRenderer.invoke('milestone:create', projectPath, message),

  /** Restore working directory to a specific milestone. */
  milestoneRestore: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:restore', projectPath, milestoneId),

  /** Delete a leaf milestone. */
  milestoneDelete: (projectPath: string, milestoneId: string) =>
    ipcRenderer.invoke('milestone:delete', projectPath, milestoneId),
});