/**
 * VCS Milestone Operations — Unit Tests
 *
 * Tests for milestone delete, and related edge cases that exercise
 * the DAG manipulation logic.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mocks (same pattern as vcs.test.ts)
// ---------------------------------------------------------------------------

vi.mock('../autowatch', () => ({
  autoWatchRefreshBlacklist: vi.fn(),
}));

let memFs: Record<string, string> = {};

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async (filePath: string) => {
    const content = memFs[filePath.replace(/\\/g, '/')];
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  }),
  writeFile: vi.fn(async (filePath: string, data: string) => {
    memFs[filePath.replace(/\\/g, '/')] = data;
  }),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ size: 100 })),
  copyFile: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  createWriteStream: vi.fn(() => ({
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') setTimeout(cb, 0);
    }),
  })),
  Dirent: class {},
}));

const mockGitInstance = {
  init: vi.fn(async () => {}),
  add: vi.fn(async () => {}),
  commit: vi.fn(async () => ({ commit: 'abc1234' })),
  status: vi.fn(async () => ({})),
  branch: vi.fn(async () => {}),
  raw: vi.fn(async () => ''),
  show: vi.fn(async (ref: string) => {
    // Return a mock commit state when asked
    return JSON.stringify({
      milestoneId: 'ms-child',
      parentMilestoneId: 'ms-root',
      files: [
        {
          relativePath: 'design.psd',
          baseFileId: 'base-1.psd',
          patches: ['ms-child_design.psd.patch'],
        },
      ],
    });
  }),
  checkoutLocalBranch: vi.fn(async () => {}),
};

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
    }),
  })),
}));

vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    pipe: vi.fn(),
    directory: vi.fn(),
    finalize: vi.fn(),
    on: vi.fn(),
  })),
}));

let uuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: () => `test-uuid-${++uuidCounter}`,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  milestoneDelete,
  milestoneRestore,
  type GlobalRegistry,
} from '../vcs';

import * as fsPromises from 'fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PROJECT_PATH = '/test/project';

function normalizedPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function setFileContent(filePath: string, content: unknown): void {
  memFs[normalizedPath(filePath)] = typeof content === 'string'
    ? content
    : JSON.stringify(content, null, 2);
}

function createRegistryWithParentChild(): GlobalRegistry {
  return {
    projectId: 'proj-1',
    projectName: 'Test',
    createdAt: '2026-01-01T00:00:00Z',
    activeMilestoneId: 'ms-child',
    activeBranch: 'main',
    branches: ['main'],
    milestones: {
      'ms-root': {
        milestoneId: 'ms-root',
        message: 'Root',
        commitHash: 'abc',
        branch: 'main',
        parentMilestoneId: null,
        createdAt: '2026-01-01T00:00:00Z',
        children: ['ms-child'],
      },
      'ms-child': {
        milestoneId: 'ms-child',
        message: 'Child',
        commitHash: 'def',
        branch: 'main',
        parentMilestoneId: 'ms-root',
        createdAt: '2026-01-02T00:00:00Z',
        children: [],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memFs = {};
  uuidCounter = 0;
});

// ===================================================================
// Milestone Delete
// ===================================================================

describe('VCS — milestoneDelete', () => {
  it('should delete a leaf milestone', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    const result = await milestoneDelete(TEST_PROJECT_PATH, 'ms-child');

    expect(result.status).toBe('success');
  });

  it('should remove milestone from parent children array', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    await milestoneDelete(TEST_PROJECT_PATH, 'ms-child');

    const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
    const registryWrite = writeFileCalls.find(
      (call: string[]) => normalizedPath(call[0]).includes('global_registry.json'),
    );
    const registry = JSON.parse(registryWrite![1]) as GlobalRegistry;
    expect(registry.milestones['ms-root'].children).toEqual([]);
  });

  it('should update activeMilestoneId to parent when deleting active', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    await milestoneDelete(TEST_PROJECT_PATH, 'ms-child');

    const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
    const registryWrite = writeFileCalls.find(
      (call: string[]) => normalizedPath(call[0]).includes('global_registry.json'),
    );
    const registry = JSON.parse(registryWrite![1]) as GlobalRegistry;
    expect(registry.activeMilestoneId).toBe('ms-root');
  });

  it('should delete associated patch files', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    await milestoneDelete(TEST_PROJECT_PATH, 'ms-child');

    expect(fsPromises.unlink).toHaveBeenCalled();
  });

  it('should return error when deleting milestone with children', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    const result = await milestoneDelete(TEST_PROJECT_PATH, 'ms-root');

    expect(result.status).toBe('error');
  });

  it('should return error for non-existent milestone', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    const result = await milestoneDelete(TEST_PROJECT_PATH, 'nonexistent');
    expect(result.status).toBe('error');
  });

  it('should remove the milestone node from registry', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    await milestoneDelete(TEST_PROJECT_PATH, 'ms-child');

    const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
    const registryWrite = writeFileCalls.find(
      (call: string[]) => normalizedPath(call[0]).includes('global_registry.json'),
    );
    const registry = JSON.parse(registryWrite![1]) as GlobalRegistry;
    expect(registry.milestones['ms-child']).toBeUndefined();
  });
});

// ===================================================================
// Milestone Restore
// ===================================================================

describe('VCS — milestoneRestore', () => {
  it('should return error for non-existent milestone', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );

    const result = await milestoneRestore(TEST_PROJECT_PATH, 'nonexistent');
    expect(result.status).toBe('error');
  });

  it('should checkout the milestone commit via git', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );
    // Also need commit_state.json to exist after checkout
    setFileContent(
      path.join(TEST_PROJECT_PATH, 'commit_state.json'),
      { milestoneId: 'ms-child', parentMilestoneId: 'ms-root', files: [] },
    );

    const result = await milestoneRestore(TEST_PROJECT_PATH, 'ms-child');

    expect(result.status).toBe('success');
    expect(mockGitInstance.raw).toHaveBeenCalledWith(
      expect.arrayContaining(['checkout', '-f', 'def']),
    );
  });

  it('should update active milestone in registry', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );
    setFileContent(
      path.join(TEST_PROJECT_PATH, 'commit_state.json'),
      { milestoneId: 'ms-root', parentMilestoneId: null, files: [] },
    );

    await milestoneRestore(TEST_PROJECT_PATH, 'ms-root');

    const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
    const registryWrite = writeFileCalls.find(
      (call: string[]) => normalizedPath(call[0]).includes('global_registry.json'),
    );
    const registry = JSON.parse(registryWrite![1]) as GlobalRegistry;
    expect(registry.activeMilestoneId).toBe('ms-root');
    expect(registry.activeBranch).toBe('main');
  });

  it('should clean up .tmp directory after restore', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createRegistryWithParentChild(),
    );
    setFileContent(
      path.join(TEST_PROJECT_PATH, 'commit_state.json'),
      { milestoneId: 'ms-child', parentMilestoneId: 'ms-root', files: [] },
    );

    await milestoneRestore(TEST_PROJECT_PATH, 'ms-child');

    expect(fsPromises.rm).toHaveBeenCalled();
  });
});
