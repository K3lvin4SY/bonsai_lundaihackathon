/**
 * VCS Module — Unit Tests
 *
 * Tests the main VCS public API: project lifecycle, milestone CRUD,
 * blacklist management, tag management, settings, and storage stats.
 *
 * All filesystem, Git, and xdelta3 dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock autowatch before importing vcs (vcs imports autowatch)
vi.mock('../autowatch', () => ({
  autoWatchRefreshBlacklist: vi.fn(),
}));

// In-memory filesystem for testing
let memFs: Record<string, string> = {};
let memDirs: Set<string> = new Set();

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async (dir: string) => {
    memDirs.add(dir);
  }),
  readFile: vi.fn(async (filePath: string) => {
    const content = memFs[filePath.replace(/\\/g, '/')];
    if (content === undefined) {
      throw new Error(`ENOENT: ${filePath}`);
    }
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
  show: vi.fn(async () => '{}'),
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

// Mock crypto.randomUUID to return predictable values
let uuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: () => `test-uuid-${++uuidCounter}`,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  projectCreate,
  projectDelete,
  projectList,
  projectTree,
  milestoneRename,
  milestoneSetTags,
  milestoneSetDescription,
  blacklistGet,
  blacklistSet,
  projectGetTags,
  projectSetTags,
  projectRename,
  projectArchive,
  projectUnarchive,
  settingsGet,
  settingsSet,
  projectStorageStats,
  type GlobalRegistry,
  type CommitState,
} from '../vcs';

import * as fsPromises from 'fs/promises';
import { autoWatchRefreshBlacklist } from '../autowatch';

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

function getFileContent<T>(filePath: string): T | undefined {
  const raw = memFs[normalizedPath(filePath)];
  if (raw === undefined) return undefined;
  return JSON.parse(raw) as T;
}

function createMockRegistry(overrides: Partial<GlobalRegistry> = {}): GlobalRegistry {
  return {
    projectId: 'proj-1',
    projectName: 'Test Project',
    createdAt: '2026-01-01T00:00:00Z',
    activeMilestoneId: null,
    activeBranch: 'main',
    branches: ['main'],
    milestones: {},
    ...overrides,
  };
}

function createMockRegistryWithMilestone(): GlobalRegistry {
  return createMockRegistry({
    activeMilestoneId: 'ms-1',
    milestones: {
      'ms-1': {
        milestoneId: 'ms-1',
        message: 'Initial milestone',
        commitHash: 'abc1234',
        branch: 'main',
        parentMilestoneId: null,
        createdAt: '2026-01-01T00:00:00Z',
        children: [],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  memFs = {};
  memDirs = new Set();
  uuidCounter = 0;
});

// ===================================================================
// 1. Project Lifecycle
// ===================================================================

describe('VCS — Project Lifecycle', () => {
  describe('projectCreate', () => {
    it('should create a new project successfully', async () => {
      // Empty projects list
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      const result = await projectCreate(TEST_PROJECT_PATH, 'My Project');

      expect(result.status).toBe('success');
      expect(result.id).toBeTruthy();
    });

    it('should return duplicate_path error for existing path', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'existing', name: 'Existing', projectPath: TEST_PROJECT_PATH, createdAt: '2026-01-01T00:00:00Z' }],
      );

      const result = await projectCreate(TEST_PROJECT_PATH, 'Duplicate');

      expect(result.status).toBe('error');
      expect(result.error).toBe('duplicate_path');
    });

    it('should scaffold required directories', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      await projectCreate(TEST_PROJECT_PATH, 'My Project');

      expect(fsPromises.mkdir).toHaveBeenCalled();
    });

    it('should initialize a Git repository', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      await projectCreate(TEST_PROJECT_PATH, 'My Project');

      expect(mockGitInstance.init).toHaveBeenCalled();
    });

    it('should write .gitignore file', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      await projectCreate(TEST_PROJECT_PATH, 'My Project');

      const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
      const gitignoreWrite = writeFileCalls.find(
        (call: string[]) => normalizedPath(call[0]).includes('.gitignore'),
      );
      expect(gitignoreWrite).toBeTruthy();
    });

    it('should write registry with correct structure', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      await projectCreate(TEST_PROJECT_PATH, 'My Project');

      // Find the registry write
      const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
      const registryWrite = writeFileCalls.find(
        (call: string[]) => normalizedPath(call[0]).includes('global_registry.json'),
      );
      expect(registryWrite).toBeTruthy();
      const registry = JSON.parse(registryWrite![1]);
      expect(registry.projectName).toBe('My Project');
      expect(registry.activeBranch).toBe('main');
      expect(registry.branches).toEqual(['main']);
      expect(registry.milestones).toEqual({});
    });

    it('should register project in global list', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      const result = await projectCreate(TEST_PROJECT_PATH, 'My Project');

      const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
      const projectsListWrite = writeFileCalls.find(
        (call: string[]) => normalizedPath(call[0]).includes('projects.json'),
      );
      expect(projectsListWrite).toBeTruthy();
      const list = JSON.parse(projectsListWrite![1]);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('My Project');
      expect(list[0].id).toBe(result.id);
    });
  });

  describe('projectDelete', () => {
    it('should remove project data directories', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Test', projectPath: TEST_PROJECT_PATH, createdAt: '2026-01-01T00:00:00Z' }],
      );

      const result = await projectDelete(TEST_PROJECT_PATH);

      expect(result.status).toBe('success');
      expect(fsPromises.rm).toHaveBeenCalled();
    });

    it('should unregister from global projects list', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Test', projectPath: TEST_PROJECT_PATH, createdAt: '2026-01-01T00:00:00Z' }],
      );

      await projectDelete(TEST_PROJECT_PATH);

      const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
      const projectsListWrite = writeFileCalls.find(
        (call: string[]) => normalizedPath(call[0]).includes('projects.json'),
      );
      const list = JSON.parse(projectsListWrite![1]);
      expect(list).toHaveLength(0);
    });
  });

  describe('projectList', () => {
    it('should return empty array when no projects exist', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      const result = await projectList();
      expect(result).toEqual([]);
    });

    it('should return project summaries with milestone info', async () => {
      const projectPath = '/test/proj1';
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Test', projectPath, createdAt: '2026-01-01T00:00:00Z' }],
      );
      setFileContent(
        path.join(projectPath, '.app_data', 'global_registry.json'),
        createMockRegistryWithMilestone(),
      );

      const result = await projectList();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Project');
      expect(result[0].milestoneCount).toBe(1);
      expect(result[0].lastMilestoneMessage).toBe('Initial milestone');
    });

    it('should skip projects with missing registries', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Missing', projectPath: '/nonexistent', createdAt: '2026-01-01T00:00:00Z' }],
      );

      const result = await projectList();
      expect(result).toHaveLength(0);
    });
  });

  describe('projectRename', () => {
    it('should update project name in registry and global list', async () => {
      const regPath = normalizedPath(path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'));
      setFileContent(regPath, createMockRegistry());
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Old Name', projectPath: TEST_PROJECT_PATH, createdAt: '2026-01-01T00:00:00Z' }],
      );

      const result = await projectRename(TEST_PROJECT_PATH, 'New Name');

      expect(result.status).toBe('success');
    });
  });

  describe('projectArchive / projectUnarchive', () => {
    it('should archive a project', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Test', projectPath: TEST_PROJECT_PATH, createdAt: '2026-01-01T00:00:00Z' }],
      );

      const result = await projectArchive(TEST_PROJECT_PATH);
      expect(result.status).toBe('success');
    });

    it('should unarchive a project', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [{ id: 'p1', name: 'Test', projectPath: TEST_PROJECT_PATH, createdAt: '2026-01-01T00:00:00Z', archived: true }],
      );

      const result = await projectUnarchive(TEST_PROJECT_PATH);
      expect(result.status).toBe('success');
    });

    it('should return error for non-existent project', async () => {
      setFileContent(
        path.join(process.env.APPDATA || '', 'bonsai', 'projects.json'),
        [],
      );

      const result = await projectArchive('/nonexistent');
      expect(result.status).toBe('error');
    });
  });
});

// ===================================================================
// 2. Project Tree
// ===================================================================

describe('VCS — Project Tree', () => {
  it('should return empty tree for project with no milestones', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createMockRegistry(),
    );

    const result = await projectTree(TEST_PROJECT_PATH);

    expect(result.tree).toEqual([]);
    expect(result.branches).toEqual(['main']);
    expect(result.milestones).toEqual([]);
    expect(result.activeMilestoneId).toBeNull();
  });

  it('should build tree with single root milestone', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createMockRegistryWithMilestone(),
    );

    const result = await projectTree(TEST_PROJECT_PATH);

    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].milestoneId).toBe('ms-1');
    expect(result.tree[0].message).toBe('Initial milestone');
    expect(result.tree[0].children).toEqual([]);
    expect(result.activeMilestoneId).toBe('ms-1');
  });

  it('should build tree with parent-child relationships', async () => {
    const registry = createMockRegistry({
      activeMilestoneId: 'ms-2',
      milestones: {
        'ms-1': {
          milestoneId: 'ms-1',
          message: 'Root',
          commitHash: 'abc',
          branch: 'main',
          parentMilestoneId: null,
          createdAt: '2026-01-01T00:00:00Z',
          children: ['ms-2'],
        },
        'ms-2': {
          milestoneId: 'ms-2',
          message: 'Child',
          commitHash: 'def',
          branch: 'main',
          parentMilestoneId: 'ms-1',
          createdAt: '2026-01-02T00:00:00Z',
          children: [],
        },
      },
    });
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      registry,
    );

    const result = await projectTree(TEST_PROJECT_PATH);

    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].children).toHaveLength(1);
    expect(result.tree[0].children[0].milestoneId).toBe('ms-2');
  });

  it('should handle branching (multiple children)', async () => {
    const registry = createMockRegistry({
      activeMilestoneId: 'ms-3',
      branches: ['main', 'feature'],
      milestones: {
        'ms-1': {
          milestoneId: 'ms-1',
          message: 'Root',
          commitHash: 'abc',
          branch: 'main',
          parentMilestoneId: null,
          createdAt: '2026-01-01T00:00:00Z',
          children: ['ms-2', 'ms-3'],
        },
        'ms-2': {
          milestoneId: 'ms-2',
          message: 'Main branch',
          commitHash: 'def',
          branch: 'main',
          parentMilestoneId: 'ms-1',
          createdAt: '2026-01-02T00:00:00Z',
          children: [],
        },
        'ms-3': {
          milestoneId: 'ms-3',
          message: 'Feature branch',
          commitHash: 'ghi',
          branch: 'feature',
          parentMilestoneId: 'ms-1',
          createdAt: '2026-01-03T00:00:00Z',
          children: [],
        },
      },
    });
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      registry,
    );

    const result = await projectTree(TEST_PROJECT_PATH);

    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].children).toHaveLength(2);
    expect(result.branches).toEqual(['main', 'feature']);
  });

  it('should include tags and description in milestone records', async () => {
    const registry = createMockRegistry({
      activeMilestoneId: 'ms-1',
      milestones: {
        'ms-1': {
          milestoneId: 'ms-1',
          message: 'Tagged milestone',
          description: 'A description',
          commitHash: 'abc',
          branch: 'main',
          parentMilestoneId: null,
          createdAt: '2026-01-01T00:00:00Z',
          children: [],
          tags: ['release', 'v1.0'],
        },
      },
    });
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      registry,
    );

    const result = await projectTree(TEST_PROJECT_PATH);

    expect(result.milestones[0].tags).toEqual(['release', 'v1.0']);
    expect(result.milestones[0].description).toBe('A description');
    expect(result.tree[0].tags).toEqual(['release', 'v1.0']);
  });
});

// ===================================================================
// 3. Milestone Metadata
// ===================================================================

describe('VCS — Milestone Metadata', () => {
  describe('milestoneRename', () => {
    it('should update milestone message', async () => {
      const regPath = normalizedPath(path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'));
      setFileContent(regPath, createMockRegistryWithMilestone());

      const result = await milestoneRename(TEST_PROJECT_PATH, 'ms-1', 'Renamed');

      expect(result.status).toBe('success');
    });

    it('should return error for non-existent milestone', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      const result = await milestoneRename(TEST_PROJECT_PATH, 'nonexistent', 'Name');
      expect(result.status).toBe('error');
    });
  });

  describe('milestoneSetTags', () => {
    it('should set tags on a milestone', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistryWithMilestone(),
      );

      const result = await milestoneSetTags(TEST_PROJECT_PATH, 'ms-1', ['release', 'v1.0']);

      expect(result.status).toBe('success');
    });

    it('should return error for non-existent milestone', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      const result = await milestoneSetTags(TEST_PROJECT_PATH, 'nope', ['tag']);
      expect(result.status).toBe('error');
    });
  });

  describe('milestoneSetDescription', () => {
    it('should set description on a milestone', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistryWithMilestone(),
      );

      const result = await milestoneSetDescription(TEST_PROJECT_PATH, 'ms-1', 'New desc');
      expect(result.status).toBe('success');
    });

    it('should clear description when empty string is passed', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistryWithMilestone(),
      );

      const result = await milestoneSetDescription(TEST_PROJECT_PATH, 'ms-1', '');
      expect(result.status).toBe('success');
    });
  });
});

// ===================================================================
// 4. Blacklist Management
// ===================================================================

describe('VCS — Blacklist', () => {
  describe('blacklistGet', () => {
    it('should return empty array when no blacklist is set', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      const result = await blacklistGet(TEST_PROJECT_PATH);
      expect(result).toEqual([]);
    });

    it('should return blacklist items from registry', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry({ blacklist: ['node_modules', 'dist'] }),
      );

      const result = await blacklistGet(TEST_PROJECT_PATH);
      expect(result).toEqual(['node_modules', 'dist']);
    });
  });

  describe('blacklistSet', () => {
    it('should update blacklist in registry', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      const result = await blacklistSet(TEST_PROJECT_PATH, ['build', 'cache']);
      expect(result.status).toBe('success');
    });

    it('should regenerate .gitignore', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      await blacklistSet(TEST_PROJECT_PATH, ['build']);

      const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
      const gitignoreWrite = writeFileCalls.find(
        (call: string[]) => normalizedPath(call[0]).includes('.gitignore'),
      );
      expect(gitignoreWrite).toBeTruthy();
      expect(gitignoreWrite![1]).toContain('/build');
    });

    it('should refresh autowatch blacklist cache', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      await blacklistSet(TEST_PROJECT_PATH, ['dist']);
      expect(autoWatchRefreshBlacklist).toHaveBeenCalledWith(
        TEST_PROJECT_PATH,
        ['dist'],
      );
    });
  });
});

// ===================================================================
// 5. Tag Definitions
// ===================================================================

describe('VCS — Project Tags', () => {
  describe('projectGetTags', () => {
    it('should return empty array when no custom tags', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      const result = await projectGetTags(TEST_PROJECT_PATH);
      expect(result).toEqual([]);
    });

    it('should return custom tag definitions', async () => {
      const tags = [
        { label: 'WIP', color: '#ff0' },
        { label: 'Release', color: '#0f0' },
      ];
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry({ customTags: tags }),
      );

      const result = await projectGetTags(TEST_PROJECT_PATH);
      expect(result).toEqual(tags);
    });
  });

  describe('projectSetTags', () => {
    it('should update custom tags in registry', async () => {
      setFileContent(
        path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
        createMockRegistry(),
      );

      const tags = [{ label: 'Draft', color: '#aaa' }];
      const result = await projectSetTags(TEST_PROJECT_PATH, tags);
      expect(result.status).toBe('success');
    });
  });
});

// ===================================================================
// 6. Settings
// ===================================================================

describe('VCS — Settings', () => {
  const settingsPath = normalizedPath(
    path.join(
      process.env.APPDATA || '',
      'bonsai',
      'settings.json',
    ),
  );

  describe('settingsGet', () => {
    it('should return null when settings file does not exist', async () => {
      const result = await settingsGet('theme');
      expect(result).toBeNull();
    });

    it('should return value for existing key', async () => {
      setFileContent(settingsPath, { theme: 'dark', fontSize: 14 });

      const result = await settingsGet('theme');
      expect(result).toBe('dark');
    });

    it('should return null for missing key', async () => {
      setFileContent(settingsPath, { theme: 'dark' });

      const result = await settingsGet('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('settingsSet', () => {
    it('should create settings file if it does not exist', async () => {
      const result = await settingsSet('theme', 'light');

      expect(result.status).toBe('success');
    });

    it('should update existing settings', async () => {
      setFileContent(settingsPath, { theme: 'dark' });

      const result = await settingsSet('theme', 'light');
      expect(result.status).toBe('success');
    });

    it('should preserve other settings when updating', async () => {
      setFileContent(settingsPath, { theme: 'dark', fontSize: 14 });

      await settingsSet('theme', 'light');

      const writeFileCalls = (fsPromises.writeFile as Mock).mock.calls;
      const settingsWrite = writeFileCalls.find(
        (call: string[]) => normalizedPath(call[0]).includes('settings.json'),
      );
      const settings = JSON.parse(settingsWrite![1]);
      expect(settings.fontSize).toBe(14);
    });
  });
});

// ===================================================================
// 7. Storage Stats
// ===================================================================

describe('VCS — Storage Stats', () => {
  it('should return zero stats for empty project', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createMockRegistry(),
    );

    const result = await projectStorageStats(TEST_PROJECT_PATH);

    expect(result.totalBase).toBe(0);
    expect(result.totalPatches).toBe(0);
    expect(result.milestoneCount).toBe(0);
  });

  it('should count milestones from registry', async () => {
    setFileContent(
      path.join(TEST_PROJECT_PATH, '.app_data', 'global_registry.json'),
      createMockRegistryWithMilestone(),
    );

    const result = await projectStorageStats(TEST_PROJECT_PATH);
    expect(result.milestoneCount).toBe(1);
  });
});
