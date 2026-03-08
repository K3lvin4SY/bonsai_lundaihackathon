/**
 * core/autowatch.ts — Bonsai Auto-Watch
 *
 * Watches a project folder for file changes and automatically creates
 * milestones after a 10-second debounce period. This ensures multiple
 * rapid saves (e.g. an application writing to disk) are coalesced into
 * a single milestone, preventing corruption or noise.
 */

import * as fs from 'fs';
import * as path from 'path';
import { milestoneCreate } from './vcs';

const DEBOUNCE_MS = 10_000; // 10 seconds

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
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** True while a milestone creation is in-flight (prevents overlapping commits). */
  busy: boolean;
  /** Set to true if another change arrived while busy, so we re-trigger after finish. */
  pendingRetrigger: boolean;
}

/** Active watchers keyed by project path. */
const watchers = new Map<string, WatcherEntry>();

/**
 * Start watching `projectPath` for file changes.
 * If already watching, this is a no-op.
 */
export function autoWatchStart(
  projectPath: string,
): { status: 'success' | 'error'; error?: string } {
  if (watchers.has(projectPath)) {
    return { status: 'success' }; // already watching
  }

  console.log(`[autowatch] starting watcher for ${projectPath}`);

  try {
    const entry: WatcherEntry = {
      watcher: null as any,
      debounceTimer: null,
      busy: false,
      pendingRetrigger: false,
    };

    const onChange = (eventType: string, filename: string | null) => {
      // Ignore events from our own bookkeeping directories
      if (filename) {
        const topLevel = filename.split(/[\\/]/)[0];
        if (IGNORED_NAMES.has(topLevel)) return;
      }

      console.log(`[autowatch] change detected: ${eventType} ${filename ?? '(unknown)'}`);

      // If we're currently creating a milestone, just flag for re-trigger
      if (entry.busy) {
        entry.pendingRetrigger = true;
        return;
      }

      // Reset the debounce timer every time a change comes in
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }

      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        triggerMilestone(projectPath, entry);
      }, DEBOUNCE_MS);
    };

    entry.watcher = fs.watch(projectPath, { recursive: true }, onChange);

    entry.watcher.on('error', (err) => {
      console.error(`[autowatch] watcher error for ${projectPath}:`, err);
      // Clean up on error
      autoWatchStop(projectPath);
    });

    watchers.set(projectPath, entry);
    return { status: 'success' };
  } catch (err: any) {
    console.error('[autowatch] failed to start watcher:', err);
    return { status: 'error', error: err.message };
  }
}

/**
 * Stop watching a project folder.
 */
export function autoWatchStop(
  projectPath: string,
): { status: 'success' | 'error' } {
  const entry = watchers.get(projectPath);
  if (!entry) {
    return { status: 'success' }; // nothing to stop
  }

  console.log(`[autowatch] stopping watcher for ${projectPath}`);

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  try {
    entry.watcher.close();
  } catch {
    // ignore close errors
  }
  watchers.delete(projectPath);
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
 * Stop all active watchers. Called on app quit.
 */
export function autoWatchStopAll(): void {
  for (const projectPath of watchers.keys()) {
    autoWatchStop(projectPath);
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

  const message = 'Auto-save';

  console.log(`[autowatch] creating milestone: "${message}"`);

  try {
    const result = await milestoneCreate(projectPath, message);
    console.log(`[autowatch] milestone created: ${result.milestoneId}`);
  } catch (err) {
    console.error('[autowatch] milestone creation failed:', err);
  } finally {
    entry.busy = false;

    // If changes came in while we were busy, restart the debounce
    if (entry.pendingRetrigger && watchers.has(projectPath)) {
      entry.pendingRetrigger = false;
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        triggerMilestone(projectPath, entry);
      }, DEBOUNCE_MS);
    }
  }
}
