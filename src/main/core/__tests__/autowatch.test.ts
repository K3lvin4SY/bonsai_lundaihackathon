/**
 * Auto-Watch Module — Unit Tests
 *
 * Tests the auto-watch public API: start/stop, suspend/resume,
 * status checking, blacklist refresh, and restore-all logic.
 *
 * Chokidar, Electron BrowserWindow, and VCS milestone creation are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks  (vi.hoisted runs before vi.mock so references are available)
// ---------------------------------------------------------------------------

let memFs: Record<string, string> = {};

const {
  mockWatcherInstance,
  mockMilestoneCreate,
  mockWriteJson,
  mockReadJson,
} = vi.hoisted(() => ({
  mockWatcherInstance: {
    on: vi.fn().mockReturnThis(),
    close: vi.fn(async () => {}),
  },
  mockMilestoneCreate: vi.fn(),
  mockWriteJson: vi.fn(),
  mockReadJson: vi.fn(),
}));

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcherInstance),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('../vcs', () => ({
  milestoneCreate: mockMilestoneCreate,
  registryPath: vi.fn((projectPath: string) =>
    `${projectPath}/.app_data/global_registry.json`,
  ),
  readJson: mockReadJson,
  writeJson: mockWriteJson,
  settingsGet: vi.fn(async () => null),
  projectList: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  autoWatchStart,
  autoWatchStop,
  autoWatchStatus,
  autoWatchSuspend,
  autoWatchResume,
  autoWatchStopAll,
  autoWatchRefreshBlacklist,
} from '../autowatch';

import * as chokidar from 'chokidar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PATH = '/test/project';

function setRegistryContent(projectPath: string, data: unknown): void {
  const key = `${projectPath}/.app_data/global_registry.json`;
  memFs[key] = JSON.stringify(data);
}

function createMockRegistry(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'proj-1',
    projectName: 'Test',
    createdAt: '2026-01-01T00:00:00Z',
    activeMilestoneId: 'ms-1',
    activeBranch: 'main',
    branches: ['main'],
    milestones: {},
    autoWatch: false,
    blacklist: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  memFs = {};

  // Re-set implementations after clearAllMocks
  mockMilestoneCreate.mockImplementation(async () => ({
    milestoneId: 'auto-ms-1',
  }));
  mockWriteJson.mockImplementation(async (filePath: string, data: unknown) => {
    memFs[filePath.replace(/\\/g, '/')] = JSON.stringify(data);
  });
  mockReadJson.mockImplementation(async (filePath: string) => {
    const key = filePath.replace(/\\/g, '/');
    const content = memFs[key];
    if (!content) throw new Error(`ENOENT: ${filePath}`);
    return JSON.parse(content);
  });
  mockWatcherInstance.on.mockReturnThis();
  mockWatcherInstance.close.mockImplementation(async () => {});

  // Stop all watchers between tests
  autoWatchStopAll();
});

afterEach(() => {
  autoWatchStopAll();
});

describe('Auto-Watch — Start / Stop', () => {
  it('should start watching a project', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());

    const result = await autoWatchStart(TEST_PATH);

    expect(result.status).toBe('success');
    expect(chokidar.watch).toHaveBeenCalledWith(
      TEST_PATH,
      expect.objectContaining({
        ignoreInitial: true,
        persistent: true,
      }),
    );
  });

  it('should be idempotent (no-op if already watching)', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());

    await autoWatchStart(TEST_PATH);
    const result = await autoWatchStart(TEST_PATH);

    expect(result.status).toBe('success');
    // chokidar.watch should only be called once
    expect(chokidar.watch).toHaveBeenCalledTimes(1);
  });

  it('should stop watching a project', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    const result = await autoWatchStop(TEST_PATH);

    expect(result.status).toBe('success');
    expect(mockWatcherInstance.close).toHaveBeenCalled();
  });

  it('should handle stopping a non-watched project gracefully', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());

    const result = await autoWatchStop(TEST_PATH);
    expect(result.status).toBe('success');
  });

  it('should persist autoWatch flag as true on start', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());

    await autoWatchStart(TEST_PATH);

    // writeJson should have been called to persist autoWatch: true
    expect(mockWriteJson).toHaveBeenCalledWith(
      expect.stringContaining('global_registry.json'),
      expect.objectContaining({ autoWatch: true }),
    );
  });
});

describe('Auto-Watch — Status', () => {
  it('should report inactive for unwatched project', () => {
    const result = autoWatchStatus(TEST_PATH);
    expect(result.active).toBe(false);
  });

  it('should report active for watched project', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    const result = autoWatchStatus(TEST_PATH);
    expect(result.active).toBe(true);
  });

  it('should report inactive after stopping', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);
    await autoWatchStop(TEST_PATH);

    const result = autoWatchStatus(TEST_PATH);
    expect(result.active).toBe(false);
  });
});

describe('Auto-Watch — Suspend / Resume', () => {
  it('should suspend a watcher (no-op for non-watched)', () => {
    // Should not throw
    autoWatchSuspend('/nonexistent');
  });

  it('should resume a watcher (no-op for non-watched)', () => {
    // Should not throw
    autoWatchResume('/nonexistent');
  });

  it('should suspend and resume an active watcher', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    autoWatchSuspend(TEST_PATH);
    // Still active (just suspended, not stopped)
    expect(autoWatchStatus(TEST_PATH).active).toBe(true);

    autoWatchResume(TEST_PATH);
    expect(autoWatchStatus(TEST_PATH).active).toBe(true);
  });
});

describe('Auto-Watch — Stop All', () => {
  it('should stop all active watchers', async () => {
    setRegistryContent('/proj1', createMockRegistry());
    setRegistryContent('/proj2', createMockRegistry());

    await autoWatchStart('/proj1');
    await autoWatchStart('/proj2');

    autoWatchStopAll();

    expect(autoWatchStatus('/proj1').active).toBe(false);
    expect(autoWatchStatus('/proj2').active).toBe(false);
  });

  it('should handle empty watchers gracefully', () => {
    // Should not throw
    autoWatchStopAll();
  });
});

describe('Auto-Watch — Blacklist Refresh', () => {
  it('should update cached blacklist for active watcher', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    // Should not throw
    autoWatchRefreshBlacklist(TEST_PATH, ['new-folder', 'build']);
  });

  it('should be no-op for non-watched project', () => {
    // Should not throw
    autoWatchRefreshBlacklist('/nonexistent', ['folder']);
  });
});

describe('Auto-Watch — Watcher Configuration', () => {
  it('should ignore internal directories', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    const watchCall = (chokidar.watch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(watchCall[1].ignored).toBeDefined();
    expect(watchCall[1].ignored).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.git'),
        expect.stringContaining('.app_data'),
        expect.stringContaining('.tmp'),
        expect.stringContaining('node_modules'),
      ]),
    );
  });

  it('should set ignoreInitial to true', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    const watchCall = (chokidar.watch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(watchCall[1].ignoreInitial).toBe(true);
  });

  it('should register "all" and "error" event handlers', async () => {
    setRegistryContent(TEST_PATH, createMockRegistry());
    await autoWatchStart(TEST_PATH);

    const onCalls = mockWatcherInstance.on.mock.calls.map(
      (call: string[]) => call[0],
    );
    expect(onCalls).toContain('all');
    expect(onCalls).toContain('error');
  });
});
