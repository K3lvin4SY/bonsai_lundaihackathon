/**
 * core/autowatch.ts — Bonsai Auto-Watch
 *
 * Watches a project folder for file changes and automatically creates
 * milestones after a 10-second debounce period. This ensures multiple
 * rapid saves (e.g. an application writing to disk) are coalesced into
 * a single milestone, preventing corruption or noise.
 *
 * The setting is persisted in each project's global_registry.json so it
 * survives app restarts.  On startup, `autoWatchRestoreAll()` re-activates
 * watchers for every project that had auto-watch enabled.
 */

import * as chokidar from 'chokidar';
import { BrowserWindow } from 'electron';
import { milestoneCreate } from './vcs';
import {
  registryPath,
  readJson,
  writeJson,
  settingsGet,
  type GlobalRegistry,
} from './vcs';

const DEFAULT_DEBOUNCE_MS = 10_000; // 10 seconds

/** Resolve the configured debounce interval (ms). */
async function getDebounceMs(): Promise<number> {
  try {
    const val = await settingsGet('autoWatchDebounceMs');
    if (typeof val === 'number' && val >= 1000) return val;
  } catch { /* use default */ }
  return DEFAULT_DEBOUNCE_MS;
}

/** Directories / files that should never trigger an auto-watch milestone. */
const IGNORED_NAMES = new Set([
  '.git',
  '.app_data',
  '.tmp',
  'node_modules',
  'commit_state.json',
  '.gitignore',
]);

interface WatcherEntry {
  watcher: chokidar.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** True while a milestone creation is in-flight (prevents overlapping commits). */
  busy: boolean;
  /** Set to true if another change arrived while busy, so we re-trigger after finish. */
  pendingRetrigger: boolean;
  /** When true, file-change events are silently ignored (e.g. during restore). */
  suspended: boolean;
  /** Cached copy of the project blacklist so change events can be filtered. */
  blacklist: string[];
}

/** Active watchers keyed by project path. */
const watchers = new Map<string, WatcherEntry>();

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Refresh the cached blacklist for an active watcher.
 * Called by vcs.ts when the blacklist is updated so the watcher
 * immediately starts respecting the new list.
 */
export function autoWatchRefreshBlacklist(
  projectPath: string,
  blacklist: string[],
): void {
  const entry = watchers.get(projectPath);
  if (entry) {
    entry.blacklist = blacklist;
  }
}

async function setAutoWatchFlag(projectPath: string, value: boolean): Promise<void> {
  try {
    const regPath = registryPath(projectPath);
    const registry = await readJson<GlobalRegistry>(regPath);
    registry.autoWatch = value;
    await writeJson(regPath, registry);
  } catch (err) {
    console.error('[autowatch] failed to persist autoWatch flag:', err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start watching `projectPath` for file changes.
 * If already watching, this is a no-op.
 * Persists the setting in the project's registry.
 */
export async function autoWatchStart(
  projectPath: string,
): Promise<{ status: 'success' | 'error'; error?: string }> {
  if (watchers.has(projectPath)) {
    return { status: 'success' }; // already watching
  }

  console.log(`[autowatch] starting watcher for ${projectPath}`);

  try {
    // Load the blacklist from the project registry
    let blacklist: string[] = [];
    try {
      const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
      blacklist = registry.blacklist || [];
    } catch { /* registry may not exist yet */ }

    const entry: WatcherEntry = {
      watcher: null as any,
      debounceTimer: null,
      busy: false,
      pendingRetrigger: false,
      suspended: false,
      blacklist,
    };

    const onChange = (eventType: string, filePath: string) => {
      if (entry.suspended) return;

      // Ignore events from blacklisted files/folders
      const normalized = filePath.replace(/\\/g, '/');
      if (entry.blacklist.some((item) => {
        const normalizedItem = item.replace(/\\/g, '/');
        return normalized === normalizedItem || normalized.startsWith(normalizedItem + '/');
      })) {
        return;
      }

      console.log(`[autowatch] change detected: ${eventType} ${filePath}`);

      // If we're currently creating a milestone, just flag for re-trigger
      if (entry.busy) {
        entry.pendingRetrigger = true;
        return;
      }

      // Reset the debounce timer every time a change comes in
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }

      getDebounceMs().then((debounceMs) => {
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          triggerMilestone(projectPath, entry);
        }, debounceMs);
      });
    };

    entry.watcher = chokidar.watch(projectPath, {
      ignored: Array.from(IGNORED_NAMES).map((name) => `**/${name}/**`),
      ignoreInitial: true,
      persistent: true,
    });

    entry.watcher.on('all', onChange);

    entry.watcher.on('error', (err) => {
      console.error(`[autowatch] watcher error for ${projectPath}:`, err);
      autoWatchStop(projectPath);
    });

    watchers.set(projectPath, entry);

    // Persist the flag
    await setAutoWatchFlag(projectPath, true);

    return { status: 'success' };
  } catch (err: any) {
    console.error('[autowatch] failed to start watcher:', err);
    return { status: 'error', error: err.message };
  }
}

/**
 * Stop watching a project folder.
 * Persists the setting in the project's registry.
 */
export async function autoWatchStop(
  projectPath: string,
): Promise<{ status: 'success' | 'error' }> {
  const entry = watchers.get(projectPath);
  if (!entry) {
    // Still persist the flag off in case it was stuck
    await setAutoWatchFlag(projectPath, false);
    return { status: 'success' };
  }

  console.log(`[autowatch] stopping watcher for ${projectPath}`);

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  try {
    await entry.watcher.close();
  } catch {
    // ignore close errors
  }
  watchers.delete(projectPath);

  await setAutoWatchFlag(projectPath, false);
  return { status: 'success' };
}

/**
 * Check whether auto-watch is active for a project.
 */
export function autoWatchStatus(
  projectPath: string,
): { active: boolean } {
  return { active: watchers.has(projectPath) };
}

/**
 * Temporarily suspend the watcher for a project (e.g. during milestone restore).
 * Any pending debounce timer is cancelled.
 */
export function autoWatchSuspend(projectPath: string): void {
  const entry = watchers.get(projectPath);
  if (!entry) return;
  console.log(`[autowatch] suspending watcher for ${projectPath}`);
  entry.suspended = true;
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = null;
  }
  entry.pendingRetrigger = false;
}

/**
 * Resume a suspended watcher.
 */
export function autoWatchResume(projectPath: string): void {
  const entry = watchers.get(projectPath);
  if (!entry) return;
  console.log(`[autowatch] resuming watcher for ${projectPath}`);
  entry.suspended = false;
}

/**
 * Stop all active watchers. Called on app quit.
 */
export function autoWatchStopAll(): void {
  for (const projectPath of watchers.keys()) {
    // Just close — don't persist (we want the flag to stay true so it restarts)
    const entry = watchers.get(projectPath);
    if (entry) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      try { entry.watcher.close().catch(() => {}); } catch {}
    }
  }
  watchers.clear();
}

/**
 * On app startup, re-activate watchers for all projects whose
 * `autoWatch` flag is true in their registry.
 */
export async function autoWatchRestoreAll(): Promise<void> {
  // Read global projects list to get all project paths
  const { projectList } = await import('./vcs');
  const projects = await projectList();
  for (const project of projects) {
    try {
      const regPath = registryPath(project.projectPath);
      const registry = await readJson<GlobalRegistry>(regPath);
      if (registry.autoWatch) {
        console.log(`[autowatch] restoring watcher for ${project.projectPath}`);
        await autoWatchStart(project.projectPath);
      }
    } catch {
      // Project may be invalid — skip
    }
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function triggerMilestone(
  projectPath: string,
  entry: WatcherEntry,
): Promise<void> {
  entry.busy = true;
  entry.pendingRetrigger = false;

  const message = 'Autosave';

  console.log(`[autowatch] creating milestone: "${message}"`);

  try {
    const result = await milestoneCreate(projectPath, message);
    console.log(`[autowatch] milestone created: ${result.milestoneId}`);

    // Notify the renderer so the tree updates visually
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      win.webContents.send('autowatch:milestone-created', projectPath, result.milestoneId);
    }
  } catch (err) {
    console.error('[autowatch] milestone creation failed:', err);
  } finally {
    entry.busy = false;

    // If changes came in while we were busy, restart the debounce
    if (entry.pendingRetrigger && watchers.has(projectPath)) {
      entry.pendingRetrigger = false;
      getDebounceMs().then((debounceMs) => {
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          triggerMilestone(projectPath, entry);
        }, debounceMs);
      });
    }
  }
}
