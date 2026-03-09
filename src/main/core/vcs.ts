/**
 * core/vcs.ts — Bonsai Version Control System
 *
 * Manages the full DAG lifecycle: project scaffolding, milestone creation
 * (with xdelta3 binary diffing), milestone restoration (sequential patch
 * application), deletion, and a project-level registry.
 *
 * Two state files:
 *   global_registry.json  – git-ignored, full DAG (source of truth for UI)
 *   commit_state.json     – git-tracked, per-milestone blueprint
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import simpleGit, { SimpleGit } from 'simple-git';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { autoWatchRefreshBlacklist } from './autowatch';

const uuidv4 = randomUUID;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_DATA_DIR = '.app_data';
const BASE_DIR = 'base';
const PATCHES_DIR = 'patches';
const TMP_DIR = '.tmp';
const GLOBAL_REGISTRY_FILE = 'global_registry.json';
const COMMIT_STATE_FILE = 'commit_state.json';

/** Global file that stores the list of all Bonsai projects */
const PROJECTS_LIST_FILE = path.join(
  process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME || '~', 'Library', 'Application Support')
      : path.join(process.env.HOME || '~', '.config')),
  'bonsai',
  'projects.json',
);

// Binary extensions we treat as "large binary" files
const BINARY_EXTENSIONS = new Set([
  '.psd',
  '.psb',
  '.ai',
  '.indd',
  '.sketch',
  '.fig',
  '.xd',
  '.blend',
  '.fbx',
  '.obj',
  '.stl',
  '.3ds',
  '.max',
  '.c4d',
  '.ma',
  '.mb',
  '.hip',
  '.hiplc',
  '.zpr',
  '.ztl',
  '.spp',
  '.sbsar',
  '.mcworld',
  '.mcpack',
  '.mctemplate',
  '.mcaddon',
  '.png',
  '.jpg',
  '.jpeg',
  '.tiff',
  '.tif',
  '.bmp',
  '.exr',
  '.hdr',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.aac',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
]);

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Path to the global app settings file. */
const SETTINGS_FILE = path.join(
  process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME || '~', 'Library', 'Application Support')
      : path.join(process.env.HOME || '~', '.config')),
  'bonsai',
  'settings.json',
);

export interface GlobalRegistry {
  projectId: string;
  projectName: string;
  createdAt: string;
  activeMilestoneId: string | null;
  activeBranch: string;
  branches: string[];
  milestones: Record<string, MilestoneNode>;
  autoWatch?: boolean;
  blacklist?: string[];
}

export interface MilestoneNode {
  milestoneId: string;
  message: string;
  description?: string;
  commitHash: string;
  branch: string;
  parentMilestoneId: string | null;
  createdAt: string;
  children: string[];
  tags?: string[];
}

export interface CommitState {
  milestoneId: string;
  parentMilestoneId: string | null;
  files: TrackedFile[];
}

export interface TrackedFile {
  relativePath: string;
  baseFileId: string;
  patches: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  createdAt: string;
  lastMilestoneAt: string | null;
  milestoneCount: number;
  lastMilestoneMessage: string | null;
}

export interface TreeNode {
  milestoneId: string;
  message: string;
  description?: string;
  commitHash: string;
  branch: string;
  createdAt: string;
  children: TreeNode[];
  tags?: string[];
}

export interface MilestoneRecord {
  milestoneId: string;
  message: string;
  description?: string;
  tags?: string[];
  commitHash: string;
  branch: string;
  parentMilestoneId: string | null;
  patchFiles: string[];
  createdAt: string;
}

interface ProjectEntry {
  id: string;
  name: string;
  projectPath: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers — paths
// ---------------------------------------------------------------------------

function appDataPath(projectPath: string): string {
  return path.join(projectPath, APP_DATA_DIR);
}

function basePath(projectPath: string): string {
  return path.join(appDataPath(projectPath), BASE_DIR);
}

function patchesPath(projectPath: string): string {
  return path.join(appDataPath(projectPath), PATCHES_DIR);
}

function tmpPath(projectPath: string): string {
  return path.join(projectPath, TMP_DIR);
}

function registryPath(projectPath: string): string {
  return path.join(appDataPath(projectPath), GLOBAL_REGISTRY_FILE);
}

// Re-export so autowatch.ts can read/write the registry
export { registryPath, readJson, writeJson };

function commitStatePath(projectPath: string): string {
  return path.join(projectPath, COMMIT_STATE_FILE);
}

// ---------------------------------------------------------------------------
// Helpers — FS
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function isBinaryFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a relative path is covered by the blacklist.
 * Matches exact paths as well as any child paths of blacklisted directories.
 */
function isBlacklisted(relativePath: string, blacklist: string[]): boolean {
  if (blacklist.length === 0) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  for (const item of blacklist) {
    const normalizedItem = item.replace(/\\/g, '/');
    if (
      normalized === normalizedItem ||
      normalized.startsWith(normalizedItem + '/')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively list all files under `dir`, returning paths relative to `root`.
 */
async function listFilesRecursive(
  dir: string,
  root: string,
  blacklist: string[] = [],
): Promise<string[]> {
  const results: string[] = [];
  let entries: fsSync.Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as fsSync.Dirent[];
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);

    // Check user-configured blacklist
    if (isBlacklisted(relPath, blacklist)) continue;

    if (entry.isDirectory()) {
      // Skip hidden directories and our bookkeeping folders
      if (
        entry.name.startsWith('.') ||
        entry.name === TMP_DIR ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      results.push(...(await listFilesRecursive(fullPath, root, blacklist)));
    } else {
      // Skip bookkeeping files
      if (
        entry.name === COMMIT_STATE_FILE ||
        entry.name === '.gitignore'
      ) {
        continue;
      }
      if (isBinaryFile(entry.name)) {
        results.push(path.relative(root, fullPath));
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers — xdelta3
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the bundled xdelta3 binary for the current platform.
 * Falls back to a system-installed `xdelta3` on PATH.
 */
function xdelta3Binary(): string {
  const platformMap: Record<string, string> = {
    win32: 'xdelta3.exe',
    darwin: 'xdelta3-macos',
    linux: 'xdelta3-linux',
  };
  const binaryName = platformMap[process.platform] || 'xdelta3';

  // In production, binaries end up in extraResources or app.asar.unpacked.
  // Check those before relative __dirname paths (which may point inside the
  // asar archive where spawn() cannot execute binaries).
  const candidates = [
    path.join(process.resourcesPath || '', 'assets', 'bin', binaryName),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', '..', 'assets', 'bin', binaryName),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', 'assets', 'bin', binaryName),
    path.join(__dirname, '..', '..', 'assets', 'bin', binaryName),
    path.join(__dirname, '..', '..', '..', 'assets', 'bin', binaryName),
  ];

  console.log(`[vcs] xdelta3 lookup: platform=${process.platform}  binary=${binaryName}  __dirname=${__dirname}  resourcesPath=${process.resourcesPath}`);
  for (const c of candidates) {
    const exists = fsSync.existsSync(c);
    console.log(`[vcs]   candidate: ${c}  exists=${exists}`);
    if (exists) {
      console.log(`[vcs] xdelta3 resolved: ${c}`);
      return c;
    }
  }

  // Fallback: assume xdelta3 is on the system PATH
  console.warn('[vcs] Bundled xdelta3 not found, falling back to system PATH');
  return 'xdelta3';
}

/**
 * Run xdelta3 to create a patch:  diff(oldFile, newFile) => patchFile
 */
function xdelta3Encode(
  oldFile: string,
  newFile: string,
  patchFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[vcs] xdelta3 encode: ${oldFile} -> ${newFile} => ${patchFile}`);
    const proc = spawn(xdelta3Binary(), [
      '-e',   // encode
      '-f',   // force overwrite
      '-s', oldFile,
      newFile,
      patchFile,
    ]);

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`xdelta3 encode exited ${code}: ${stderr}`));
    });

    proc.on('error', (err) =>
      reject(new Error(`xdelta3 encode spawn error: ${err.message}`)),
    );
  });
}

/**
 * Run xdelta3 to apply a patch:  apply(sourceFile, patchFile) => outputFile
 */
function xdelta3Decode(
  sourceFile: string,
  patchFile: string,
  outputFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[vcs] xdelta3 decode: ${sourceFile} + ${patchFile} => ${outputFile}`);
    const proc = spawn(xdelta3Binary(), [
      '-d',   // decode
      '-f',   // force overwrite
      '-s', sourceFile,
      patchFile,
      outputFile,
    ]);

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`xdelta3 decode exited ${code}: ${stderr}`));
    });

    proc.on('error', (err) =>
      reject(new Error(`xdelta3 decode spawn error: ${err.message}`)),
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers — Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct a single tracked file to a destination directory by applying all
 * patches sequentially on top of its base file.
 */
async function reconstructFile(
  projectPath: string,
  trackedFile: TrackedFile,
  destDir: string,
): Promise<string> {
  const baseFile = path.join(basePath(projectPath), trackedFile.baseFileId);
  const outputFile = path.join(destDir, trackedFile.relativePath);
  await ensureDir(path.dirname(outputFile));

  if (trackedFile.patches.length === 0) {
    // No patches — just copy the base directly
    await fs.copyFile(baseFile, outputFile);
    return outputFile;
  }

  // Apply patches sequentially: base → +p1 → +p2 → … → final
  let currentSource = baseFile;

  for (let i = 0; i < trackedFile.patches.length; i++) {
    const patchFile = path.join(
      patchesPath(projectPath),
      trackedFile.patches[i],
    );
    const isLast = i === trackedFile.patches.length - 1;
    const targetFile = isLast
      ? outputFile
      : path.join(destDir, `__stage_${i}_${path.basename(trackedFile.relativePath)}`);

    await xdelta3Decode(currentSource, patchFile, targetFile);

    // Clean up intermediate staging files
    if (currentSource !== baseFile) {
      await fs.unlink(currentSource).catch(() => {});
    }
    currentSource = targetFile;
  }

  // Clean up any remaining staging files that aren't the final output
  // (already handled in the loop above)

  return outputFile;
}

/**
 * Reconstruct the parent milestone's version of a file into .tmp/
 * so we can diff against it to create a patch.
 */
async function reconstructParentFile(
  projectPath: string,
  trackedFile: TrackedFile,
): Promise<string> {
  const tmp = tmpPath(projectPath);
  await ensureDir(tmp);
  return reconstructFile(projectPath, trackedFile, tmp);
}

// ---------------------------------------------------------------------------
// Helpers — Git
// ---------------------------------------------------------------------------

function getGit(projectPath: string): SimpleGit {
  return simpleGit(projectPath);
}

// ---------------------------------------------------------------------------
// Helpers — Projects list (global, outside any project)
// ---------------------------------------------------------------------------

async function loadProjectsList(): Promise<ProjectEntry[]> {
  try {
    return await readJson<ProjectEntry[]>(PROJECTS_LIST_FILE);
  } catch {
    return [];
  }
}

async function saveProjectsList(list: ProjectEntry[]): Promise<void> {
  await writeJson(PROJECTS_LIST_FILE, list);
}

// ---------------------------------------------------------------------------
// .gitignore builder
// ---------------------------------------------------------------------------

function buildGitignore(blacklist: string[] = []): string {
  const lines = [
    '# === Bonsai — auto-generated ===',
  ];

  const body = [
    '',
    '# Heavy binary working files',
    '*.psd',
    '*.psb',
    '*.ai',
    '*.indd',
    '*.sketch',
    '*.fig',
    '*.xd',
    '*.blend',
    '*.fbx',
    '*.obj',
    '*.stl',
    '*.3ds',
    '*.max',
    '*.c4d',
    '*.ma',
    '*.mb',
    '*.hip',
    '*.hiplc',
    '*.zpr',
    '*.ztl',
    '*.spp',
    '*.sbsar',
    '*.mcworld',
    '*.mcpack',
    '*.mctemplate',
    '*.mcaddon',
    '*.png',
    '*.jpg',
    '*.jpeg',
    '*.tiff',
    '*.tif',
    '*.bmp',
    '*.exr',
    '*.hdr',
    '*.gif',
    '*.webp',
    '*.svg',
    '*.ico',
    '*.mp4',
    '*.mov',
    '*.avi',
    '*.mkv',
    '*.mp3',
    '*.wav',
    '*.flac',
    '*.ogg',
    '*.aac',
    '*.zip',
    '*.rar',
    '*.7z',
    '*.tar',
    '*.gz',
    '*.pdf',
    '*.docx',
    '*.xlsx',
    '*.pptx',
    '',
    '# Bonsai internal data (binary bases, patches, registry)',
    `${APP_DATA_DIR}/${BASE_DIR}/`,
    `${APP_DATA_DIR}/${PATCHES_DIR}/`,
    `${APP_DATA_DIR}/${GLOBAL_REGISTRY_FILE}`,
    '',
    '# Temporary reconstruction folder',
    `${TMP_DIR}/`,
    '',
    '# Misc',
    'node_modules/',
    '.DS_Store',
    'Thumbs.db',
  ];

  lines.push(...body);

  if (blacklist.length > 0) {
    lines.push('');
    lines.push('# User blacklisted files/folders');
    for (const item of blacklist) {
      lines.push('/' + item.replace(/\\/g, '/'));
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Ensures .gitignore is never committed to git.
 * Adds it to .git/info/exclude (repo-local, not committed) and removes
 * it from the git index if it was previously tracked.
 * This prevents `git checkout` from failing when the blacklist changed.
 */
async function ensureGitignoreUntracked(projectPath: string): Promise<void> {
  const gitInfoDir = path.join(projectPath, '.git', 'info');
  const excludeFile = path.join(gitInfoDir, 'exclude');
  await ensureDir(gitInfoDir);

  let content = '';
  try {
    content = await fs.readFile(excludeFile, 'utf-8');
  } catch { /* file doesn't exist yet */ }

  if (!content.split('\n').some(line => line.trim() === '.gitignore')) {
    content = (content === '' || content.endsWith('\n') ? content : content + '\n') + '.gitignore\n';
    await fs.writeFile(excludeFile, content, 'utf-8');
  }

  // Remove .gitignore from git index if it was previously tracked
  const git = getGit(projectPath);
  try {
    await git.raw(['rm', '--cached', '--ignore-unmatch', '.gitignore']);
  } catch { /* not a git repo yet or already untracked */ }
}

// ===================================================================
// PUBLIC API
// ===================================================================

// ------------------------------------------------------------------
// project:create
// ------------------------------------------------------------------

export async function projectCreate(
  projectPath: string,
  name: string,
): Promise<{ id: string; status: 'success' | 'error'; error?: string }> {
  console.log(`[vcs] project:create  path=${projectPath}  name=${name}`);
  try {
    // Check for duplicate path
    const existing = await loadProjectsList();
    if (existing.some((p) => p.projectPath === projectPath)) {
      return { id: '', status: 'error', error: 'duplicate_path' };
    }

    const projectId = uuidv4();

    // Scaffold directories
    await ensureDir(basePath(projectPath));
    await ensureDir(patchesPath(projectPath));
    await ensureDir(tmpPath(projectPath));

    // Write the .gitignore
    await fs.writeFile(
      path.join(projectPath, '.gitignore'),
      buildGitignore(),
      'utf-8',
    );

    // Create the global registry (empty DAG)
    const registry: GlobalRegistry = {
      projectId,
      projectName: name,
      createdAt: new Date().toISOString(),
      activeMilestoneId: null,
      activeBranch: 'main',
      branches: ['main'],
      milestones: {},
    };
    await writeJson(registryPath(projectPath), registry);

    // Init Git repo (if not already)
    const git = getGit(projectPath);
    await git.init();

    // Register project globally
    const list = await loadProjectsList();
    list.push({
      id: projectId,
      name,
      projectPath,
      createdAt: registry.createdAt,
    });
    await saveProjectsList(list);

    console.log(`[vcs] project:create  SUCCESS  id=${projectId}`);
    return { id: projectId, status: 'success' };
  } catch (err: any) {
    console.error('[vcs] project:create  ERROR', err);
    return { id: '', status: 'error' };
  }
}

// ------------------------------------------------------------------
// project:delete
// ------------------------------------------------------------------

export async function projectDelete(
  projectPath: string,
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] project:delete  path=${projectPath}`);
  try {
    // Remove .app_data/, .git/, .gitignore, commit_state.json, .tmp/
    const removals = [
      appDataPath(projectPath),
      path.join(projectPath, '.git'),
      path.join(projectPath, '.gitignore'),
      commitStatePath(projectPath),
      tmpPath(projectPath),
    ];

    for (const p of removals) {
      await fs.rm(p, { recursive: true, force: true });
    }

    // Unregister from global list
    let list = await loadProjectsList();
    list = list.filter((e) => e.projectPath !== projectPath);
    await saveProjectsList(list);

    console.log('[vcs] project:delete  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] project:delete  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// project:list
// ------------------------------------------------------------------

export async function projectList(): Promise<ProjectSummary[]> {
  console.log('[vcs] project:list');
  const list = await loadProjectsList();
  const summaries: ProjectSummary[] = [];

  for (const entry of list) {
    try {
      const regFile = registryPath(entry.projectPath);
      const registry = await readJson<GlobalRegistry>(regFile);
      const milestoneIds = Object.keys(registry.milestones);
      const milestoneCount = milestoneIds.length;

      let lastMilestoneAt: string | null = null;
      let lastMilestoneMessage: string | null = null;
      if (milestoneCount > 0) {
        let latestTime = 0;
        let latestId: string | null = null;
        for (const id of milestoneIds) {
          const t = new Date(registry.milestones[id].createdAt).getTime();
          if (t > latestTime) { latestTime = t; latestId = id; }
        }
        lastMilestoneAt = new Date(latestTime).toISOString();
        if (latestId) lastMilestoneMessage = registry.milestones[latestId].message;
      }

      summaries.push({
        id: registry.projectId,
        name: registry.projectName,
        projectPath: entry.projectPath,
        createdAt: registry.createdAt,
        lastMilestoneAt,
        milestoneCount,
        lastMilestoneMessage,
      });
    } catch {
      // Project folder may have been manually deleted — skip it
      console.warn(`[vcs] project:list  skipping missing project at ${entry.projectPath}`);
    }
  }

  return summaries;
}

// ------------------------------------------------------------------
// project:tree
// ------------------------------------------------------------------

export async function projectTree(
  projectPath: string,
): Promise<{
  tree: TreeNode[];
  branches: string[];
  milestones: MilestoneRecord[];
  activeMilestoneId: string | null;
}> {
  console.log(`[vcs] project:tree  path=${projectPath}`);
  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));

  // Build flat MilestoneRecord[]
  const milestones: MilestoneRecord[] = Object.values(registry.milestones).map(
    (node) => {
      // Collect patch files for this milestone from the commit state recorded
      // in the node.  We only have patch filenames if we check all commit
      // states, but that would be expensive.  Instead, derive from parent's
      // patches + this milestone's patches.  Simplification: store nothing
      // extra here; the frontend doesn't typically need patch filenames.  We
      // still expose the field for completeness.
      return {
        milestoneId: node.milestoneId,
        message: node.message,
        description: node.description,
        tags: node.tags,
        commitHash: node.commitHash,
        branch: node.branch,
        parentMilestoneId: node.parentMilestoneId,
        patchFiles: [], // populated below
        createdAt: node.createdAt,
      };
    },
  );

  // Recursive tree builder
  function buildTree(milestoneId: string): TreeNode {
    const node = registry.milestones[milestoneId];
    return {
      milestoneId: node.milestoneId,
      message: node.message,
      description: node.description,
      commitHash: node.commitHash,
      branch: node.branch,
      createdAt: node.createdAt,
      tags: node.tags,
      children: node.children.map(buildTree),
    };
  }

  // Roots are milestones with no parent
  const rootIds = Object.keys(registry.milestones).filter(
    (id) => registry.milestones[id].parentMilestoneId === null,
  );
  const tree: TreeNode[] = rootIds.map(buildTree);

  return {
    tree,
    branches: registry.branches,
    milestones,
    activeMilestoneId: registry.activeMilestoneId,
  };
}

// ------------------------------------------------------------------
// milestone:create-initial
// ------------------------------------------------------------------

export async function milestoneCreateInitial(
  projectPath: string,
  message: string,
  description?: string,
): Promise<{ milestoneId: string }> {
  console.log(`[vcs] milestone:create-initial  project=${projectPath}  msg="${message}"`);

  const milestoneId = uuidv4();
  const now = new Date().toISOString();

  // Load blacklist from registry
  let blacklist: string[] = [];
  try {
    const reg = await readJson<GlobalRegistry>(registryPath(projectPath));
    blacklist = reg.blacklist || [];
  } catch { /* registry may not exist yet */ }

  // 1. Discover binary files in the project root
  const binaryFiles = await listFilesRecursive(projectPath, projectPath, blacklist);
  console.log(`[vcs] found ${binaryFiles.length} binary file(s)`);

  // 2. Copy binaries to .app_data/base/ (use a unique base-file name)
  const trackedFiles: TrackedFile[] = [];
  for (const relPath of binaryFiles) {
    const srcFile = path.join(projectPath, relPath);
    const baseFileId = `${uuidv4()}${path.extname(relPath)}`;
    const destFile = path.join(basePath(projectPath), baseFileId);
    await ensureDir(path.dirname(destFile));
    await fs.copyFile(srcFile, destFile);
    trackedFiles.push({ relativePath: relPath, baseFileId, patches: [] });
    console.log(`[vcs]   base copy: ${relPath} → ${baseFileId}`);
  }

  // 3. Write commit_state.json
  const commitState: CommitState = {
    milestoneId,
    parentMilestoneId: null,
    files: trackedFiles,
  };
  await writeJson(commitStatePath(projectPath), commitState);

  // 4. Ensure Git is initialised & .gitignore is written
  const git = getGit(projectPath);
  try {
    await git.status();
  } catch {
    await git.init();
  }

  // Make sure .gitignore exists (in case project:create was skipped)
  const giPath = path.join(projectPath, '.gitignore');
  if (!fsSync.existsSync(giPath)) {
    await fs.writeFile(giPath, buildGitignore(blacklist), 'utf-8');
  }

  // 5. Ensure .gitignore is not git-tracked (prevents checkout conflicts
  //    when the blacklist changes between milestones)
  await ensureGitignoreUntracked(projectPath);

  // Git add & commit (use '.' so ALL non-binary files are staged;
  //    binary files are already in .gitignore so they will be skipped)
  await git.add('.');
  const commitResult = await git.commit(message || 'Initial milestone');

  await git.branch(['-M', 'main']);
  // simple-git may return "HEAD <hash>" when in detached HEAD — strip the prefix
  const commitHash = (commitResult.commit || '').replace(/^HEAD\s+/i, '');

  // 6. Update global_registry.json
  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  registry.milestones[milestoneId] = {
    milestoneId,
    message: message || 'Initial milestone',
    description: description || undefined,
    commitHash,
    branch: registry.activeBranch,
    parentMilestoneId: null,
    createdAt: now,
    children: [],
  };
  registry.activeMilestoneId = milestoneId;
  await writeJson(registryPath(projectPath), registry);

  console.log(`[vcs] milestone:create-initial  SUCCESS  id=${milestoneId}  hash=${commitHash}`);
  return { milestoneId };
}

// ------------------------------------------------------------------
// milestone:create  (subsequent)
// ------------------------------------------------------------------

export async function milestoneCreate(
  projectPath: string,
  message: string,
  description?: string,
): Promise<{ milestoneId: string }> {
  console.log(`[vcs] milestone:create  project=${projectPath}  msg="${message}"`);

  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  const parentId = registry.activeMilestoneId;
  if (!parentId) {
    throw new Error('No active milestone — run milestone:create-initial first');
  }
  const parentNode = registry.milestones[parentId];
  const blacklist = registry.blacklist || [];

  // If parent already has children → create a new Git branch
  const git = getGit(projectPath);
  let branchName = parentNode.branch;

  // Ensure .gitignore is not tracked before any checkout (prevents conflicts
  // when the blacklist was changed since the last milestone commit)
  await ensureGitignoreUntracked(projectPath);
  // Re-write .gitignore in case git cleared it during a previous force-checkout
  await fs.writeFile(path.join(projectPath, '.gitignore'), buildGitignore(blacklist), 'utf-8');

  if (parentNode.children.length > 0) {
    branchName = `branch-${uuidv4().slice(0, 8)}`;
    console.log(`[vcs] parent already has children, creating branch ${branchName}`);
    // Checkout the parent commit first, then create branch
    // Use -f (force) to discard any uncommitted changes to tracked files
    await git.raw(['checkout', '-f', parentNode.commitHash]);
    await git.checkoutLocalBranch(branchName);
    if (!registry.branches.includes(branchName)) {
      registry.branches.push(branchName);
    }
  } else {
    // Ensure we're on the correct branch (not detached HEAD from a restore)
    // Use -f (force) to discard any uncommitted changes to tracked files
    await git.raw(['checkout', '-f', branchName]);
  }

  // Read parent commit_state so we know which files are tracked & their patches
  const parentCommitState = await readJson<CommitState>(
    commitStatePath(projectPath),
  );

  // Discover current binary files on disk (respecting blacklist)
  const currentFiles = await listFilesRecursive(projectPath, projectPath, blacklist);

  const milestoneId = uuidv4();
  const now = new Date().toISOString();
  const newTrackedFiles: TrackedFile[] = [];

  // Map parent tracked files by relativePath for quick lookup
  const parentFileMap = new Map<string, TrackedFile>();
  for (const tf of parentCommitState.files) {
    parentFileMap.set(tf.relativePath, tf);
  }

  await ensureDir(tmpPath(projectPath));

  for (const relPath of currentFiles) {
    const currentFilePath = path.join(projectPath, relPath);
    const parentTracked = parentFileMap.get(relPath);

    if (parentTracked) {
      // ------ Existing file: compute diff against parent's reconstructed version
      const reconstructedParent = await reconstructParentFile(
        projectPath,
        parentTracked,
      );

      // Check if the file actually changed (quick size check, then hash could
      // be added later).  For now always create a patch — xdelta3 will produce
      // a tiny patch if nothing changed.
      const patchName = `${milestoneId}_${relPath.replace(/[\\/]/g, '_')}.patch`;
      const patchFilePath = path.join(patchesPath(projectPath), patchName);
      await ensureDir(path.dirname(patchFilePath));

      try {
        await xdelta3Encode(reconstructedParent, currentFilePath, patchFilePath);

        // Check if the patch is essentially empty (very small = unchanged)
        const stat = await fs.stat(patchFilePath);
        if (stat.size === 0) {
          // File didn't change — keep parent's patches, skip adding a new one
          await fs.unlink(patchFilePath).catch(() => {});
          newTrackedFiles.push({
            relativePath: relPath,
            baseFileId: parentTracked.baseFileId,
            patches: [...parentTracked.patches],
          });
        } else {
          newTrackedFiles.push({
            relativePath: relPath,
            baseFileId: parentTracked.baseFileId,
            patches: [...parentTracked.patches, patchName],
          });
        }
      } catch (err) {
        // If xdelta3 fails (e.g., not installed), log and re-throw
        console.error(`[vcs] xdelta3 encode failed for ${relPath}`, err);
        throw err;
      }

      // Clean up reconstructed temp file
      await fs.unlink(reconstructedParent).catch(() => {});
    } else {
      // ------ New file: copy to base
      const baseFileId = `${uuidv4()}${path.extname(relPath)}`;
      const destFile = path.join(basePath(projectPath), baseFileId);
      await ensureDir(path.dirname(destFile));
      await fs.copyFile(currentFilePath, destFile);
      newTrackedFiles.push({
        relativePath: relPath,
        baseFileId,
        patches: [],
      });
      console.log(`[vcs]   new base: ${relPath} → ${baseFileId}`);
    }
  }

  // Clean up .tmp/
  await fs.rm(tmpPath(projectPath), { recursive: true, force: true });

  // Write new commit_state.json
  const commitState: CommitState = {
    milestoneId,
    parentMilestoneId: parentId,
    files: newTrackedFiles,
  };
  await writeJson(commitStatePath(projectPath), commitState);

  // Ensure .gitignore is still excluded from staging (force-checkout above
  // may have restored a tracked version of it)
  await ensureGitignoreUntracked(projectPath);
  await fs.writeFile(path.join(projectPath, '.gitignore'), buildGitignore(blacklist), 'utf-8');

  // Git add & commit (use '.' so ALL non-binary files are staged;
  //    binary files are already in .gitignore so they will be skipped)
  await git.add('.');
  const commitResult = await git.commit(message || `Milestone ${milestoneId}`);
  // simple-git may return "HEAD <hash>" when in detached HEAD — strip the prefix
  const commitHash = (commitResult.commit || '').replace(/^HEAD\s+/i, '');

  // Update global_registry
  registry.milestones[milestoneId] = {
    milestoneId,
    message: message || `Milestone ${milestoneId}`,
    description: description || undefined,
    commitHash,
    branch: branchName,
    parentMilestoneId: parentId,
    createdAt: now,
    children: [],
  };
  parentNode.children.push(milestoneId);
  registry.activeMilestoneId = milestoneId;
  registry.activeBranch = branchName;
  await writeJson(registryPath(projectPath), registry);

  console.log(`[vcs] milestone:create  SUCCESS  id=${milestoneId}  hash=${commitHash}`);
  return { milestoneId };
}

// ------------------------------------------------------------------
// milestone:restore
// ------------------------------------------------------------------

export async function milestoneRestore(
  projectPath: string,
  milestoneId: string,
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] milestone:restore  project=${projectPath}  milestone=${milestoneId}`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    const node = registry.milestones[milestoneId];
    if (!node) {
      throw new Error(`Milestone ${milestoneId} not found in registry`);
    }

    // 1. Git checkout the commit (detached HEAD is fine).
    //    Use -f (force) to discard any uncommitted changes (e.g. .gitignore
    //    modified by blacklistSet without a corresponding commit).
    const git = getGit(projectPath);
    await ensureGitignoreUntracked(projectPath);
    await git.raw(['checkout', '-f', node.commitHash]);

    // Re-write .gitignore with the current blacklist since force-checkout may
    // have restored the version committed at the target milestone.
    const blacklist = registry.blacklist || [];
    await fs.writeFile(
      path.join(projectPath, '.gitignore'),
      buildGitignore(blacklist),
      'utf-8',
    );

    // 2. Read the commit_state.json that Git just swapped in
    const commitState = await readJson<CommitState>(
      commitStatePath(projectPath),
    );

    // 3. Remove existing binary files in the working directory
    const existingBinaries = await listFilesRecursive(projectPath, projectPath);
    for (const rel of existingBinaries) {
      await fs.unlink(path.join(projectPath, rel)).catch(() => {});
    }

    // 4. Reconstruct every tracked file
    for (const trackedFile of commitState.files) {
      await reconstructFile(projectPath, trackedFile, projectPath);
      console.log(`[vcs]   restored: ${trackedFile.relativePath}`);
    }

    // 5. Clean up .tmp/
    await fs.rm(tmpPath(projectPath), { recursive: true, force: true });

    // 6. Update registry active state
    registry.activeMilestoneId = milestoneId;
    registry.activeBranch = node.branch;
    await writeJson(registryPath(projectPath), registry);

    console.log('[vcs] milestone:restore  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] milestone:restore  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// milestone:delete
// ------------------------------------------------------------------

export async function milestoneDelete(
  projectPath: string,
  milestoneId: string,
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] milestone:delete  project=${projectPath}  milestone=${milestoneId}`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    const node = registry.milestones[milestoneId];
    if (!node) {
      throw new Error(`Milestone ${milestoneId} not found in registry`);
    }

    if (node.children.length > 0) {
      throw new Error('Cannot delete a milestone that has children');
    }

    // 1. Determine which patches are *exclusively* owned by this milestone
    //    (i.e., the last patch in any tracked file's patch list that matches
    //    this milestone's ID prefix).
    //    We load the commit_state for this milestone to find those patches.
    //    Since we may not be on that commit right now, we'll read it from Git.
    const git = getGit(projectPath);
    let commitStateContent: string;
    try {
      commitStateContent = await git.show(`${node.commitHash}:${COMMIT_STATE_FILE}`);
    } catch {
      // If we can't read it from Git, it might be the current commit
      commitStateContent = await fs.readFile(
        commitStatePath(projectPath),
        'utf-8',
      );
    }
    const commitState: CommitState = JSON.parse(commitStateContent);

    // Delete patch files that belong to this milestone
    for (const trackedFile of commitState.files) {
      for (const patchName of trackedFile.patches) {
        if (patchName.startsWith(milestoneId)) {
          const patchFile = path.join(patchesPath(projectPath), patchName);
          await fs.unlink(patchFile).catch(() => {});
          console.log(`[vcs]   deleted patch: ${patchName}`);
        }
      }
    }

    // 2. Remove from parent's children array
    if (node.parentMilestoneId) {
      const parent = registry.milestones[node.parentMilestoneId];
      if (parent) {
        parent.children = parent.children.filter((c) => c !== milestoneId);
      }
    }

    // 3. Remove from registry
    delete registry.milestones[milestoneId];

    // 4. If this was the active milestone, set active to parent
    if (registry.activeMilestoneId === milestoneId) {
      registry.activeMilestoneId = node.parentMilestoneId;
    }

    await writeJson(registryPath(projectPath), registry);

    console.log('[vcs] milestone:delete  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] milestone:delete  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// blacklist:get
// ------------------------------------------------------------------

export async function blacklistGet(
  projectPath: string,
): Promise<string[]> {
  console.log(`[vcs] blacklist:get  path=${projectPath}`);
  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  return registry.blacklist || [];
}

// ------------------------------------------------------------------
// blacklist:set
// ------------------------------------------------------------------

export async function blacklistSet(
  projectPath: string,
  items: string[],
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] blacklist:set  path=${projectPath}  items=${JSON.stringify(items)}`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    registry.blacklist = items;
    await writeJson(registryPath(projectPath), registry);

    // Regenerate .gitignore so blacklisted items are git-ignored too
    await fs.writeFile(
      path.join(projectPath, '.gitignore'),
      buildGitignore(items),
      'utf-8',
    );

    // Refresh the auto-watch cache so it immediately respects the new blacklist
    autoWatchRefreshBlacklist(projectPath, items);

    console.log('[vcs] blacklist:set  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] blacklist:set  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// milestone:storage-size
// ------------------------------------------------------------------

export async function milestoneStorageSize(
  projectPath: string,
  milestoneId: string,
): Promise<{ totalBytes: number }> {
  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  const node = registry.milestones[milestoneId];
  if (!node) throw new Error(`Milestone ${milestoneId} not found`);

  // Read the commit_state for this milestone from git
  const git = getGit(projectPath);
  let commitStateContent: string;
  try {
    commitStateContent = await git.show(`${node.commitHash}:${COMMIT_STATE_FILE}`);
  } catch {
    commitStateContent = await fs.readFile(commitStatePath(projectPath), 'utf-8');
  }
  const commitState: CommitState = JSON.parse(commitStateContent);

  let totalBytes = 0;
  for (const trackedFile of commitState.files) {
    // Count base file
    try {
      const baseStat = await fs.stat(path.join(basePath(projectPath), trackedFile.baseFileId));
      totalBytes += baseStat.size;
    } catch { /* skip */ }

    // Count patch files
    for (const patchName of trackedFile.patches) {
      try {
        const patchStat = await fs.stat(path.join(patchesPath(projectPath), patchName));
        totalBytes += patchStat.size;
      } catch { /* skip */ }
    }
  }

  return { totalBytes };
}

// ------------------------------------------------------------------
// milestone:tracked-files
// ------------------------------------------------------------------

export async function milestoneTrackedFiles(
  projectPath: string,
  milestoneId: string,
): Promise<string[]> {
  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  const node = registry.milestones[milestoneId];
  if (!node) throw new Error(`Milestone ${milestoneId} not found`);

  const git = getGit(projectPath);
  let commitStateContent: string;
  try {
    commitStateContent = await git.show(`${node.commitHash}:${COMMIT_STATE_FILE}`);
  } catch {
    commitStateContent = await fs.readFile(commitStatePath(projectPath), 'utf-8');
  }
  const commitState: CommitState = JSON.parse(commitStateContent);
  return commitState.files.map((f) => f.relativePath);
}

// ------------------------------------------------------------------
// project:has-changes
// ------------------------------------------------------------------

export async function projectHasChanges(
  projectPath: string,
): Promise<{ hasChanges: boolean }> {
  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  if (!registry.activeMilestoneId) return { hasChanges: false };
  const blacklist = registry.blacklist || [];

  // Read the commit_state.json on disk (should match the active milestone)
  let commitState: CommitState;
  try {
    commitState = await readJson<CommitState>(commitStatePath(projectPath));
  } catch {
    return { hasChanges: true }; // can't read = assume changes
  }

  // Get current files on disk
  const currentFiles = await listFilesRecursive(projectPath, projectPath, blacklist);
  const trackedPaths = new Set(commitState.files.map((f) => f.relativePath));

  // New or removed files?
  const currentSet = new Set(currentFiles);
  for (const rel of currentFiles) {
    if (!trackedPaths.has(rel)) return { hasChanges: true };
  }
  for (const rel of trackedPaths) {
    if (!currentSet.has(rel)) return { hasChanges: true };
  }

  // Check file sizes for changes (fast heuristic)
  for (const trackedFile of commitState.files) {
    const currentFilePath = path.join(projectPath, trackedFile.relativePath);
    try {
      const currentStat = await fs.stat(currentFilePath);
      const reconstructed = await reconstructFile(projectPath, trackedFile, tmpPath(projectPath));
      const reconstructedStat = await fs.stat(reconstructed);
      if (currentStat.size !== reconstructedStat.size) {
        await fs.unlink(reconstructed).catch(() => {});
        await fs.rm(tmpPath(projectPath), { recursive: true, force: true });
        return { hasChanges: true };
      }
      // Compare content
      const [currentBuf, reconBuf] = await Promise.all([
        fs.readFile(currentFilePath),
        fs.readFile(reconstructed),
      ]);
      await fs.unlink(reconstructed).catch(() => {});
      if (!currentBuf.equals(reconBuf)) {
        await fs.rm(tmpPath(projectPath), { recursive: true, force: true });
        return { hasChanges: true };
      }
    } catch {
      // If reconstruction fails, assume changed
      await fs.rm(tmpPath(projectPath), { recursive: true, force: true });
      return { hasChanges: true };
    }
  }

  // Clean up tmp
  await fs.rm(tmpPath(projectPath), { recursive: true, force: true });
  return { hasChanges: false };
}

// ------------------------------------------------------------------
// milestone:rename
// ------------------------------------------------------------------

export async function milestoneRename(
  projectPath: string,
  milestoneId: string,
  newMessage: string,
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] milestone:rename  project=${projectPath}  milestone=${milestoneId}  msg="${newMessage}"`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    const node = registry.milestones[milestoneId];
    if (!node) throw new Error(`Milestone ${milestoneId} not found`);

    node.message = newMessage;
    await writeJson(registryPath(projectPath), registry);

    console.log('[vcs] milestone:rename  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] milestone:rename  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// milestone:set-tags
// ------------------------------------------------------------------

export async function milestoneSetTags(
  projectPath: string,
  milestoneId: string,
  tags: string[],
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] milestone:set-tags  project=${projectPath}  milestone=${milestoneId}  tags=${JSON.stringify(tags)}`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    const node = registry.milestones[milestoneId];
    if (!node) throw new Error(`Milestone ${milestoneId} not found`);

    node.tags = tags;
    await writeJson(registryPath(projectPath), registry);

    console.log('[vcs] milestone:set-tags  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] milestone:set-tags  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// milestone:set-description
// ------------------------------------------------------------------

export async function milestoneSetDescription(
  projectPath: string,
  milestoneId: string,
  description: string,
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] milestone:set-description  project=${projectPath}  milestone=${milestoneId}`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    const node = registry.milestones[milestoneId];
    if (!node) throw new Error(`Milestone ${milestoneId} not found`);

    node.description = description || undefined;
    await writeJson(registryPath(projectPath), registry);

    console.log('[vcs] milestone:set-description  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] milestone:set-description  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// milestone:export-zip
// ------------------------------------------------------------------

export async function milestoneExportZip(
  projectPath: string,
  milestoneId: string,
  outputZipPath: string,
): Promise<{ status: 'success' | 'error'; path?: string }> {
  console.log(`[vcs] milestone:export-zip  project=${projectPath}  milestone=${milestoneId}  output=${outputZipPath}`);
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    const node = registry.milestones[milestoneId];
    if (!node) throw new Error(`Milestone ${milestoneId} not found`);

    // Read commit state from git
    const git = getGit(projectPath);
    let commitStateContent: string;
    try {
      commitStateContent = await git.show(`${node.commitHash}:${COMMIT_STATE_FILE}`);
    } catch {
      commitStateContent = await fs.readFile(commitStatePath(projectPath), 'utf-8');
    }
    const commitState: CommitState = JSON.parse(commitStateContent);

    // Reconstruct all files into a temp directory
    const exportTmp = path.join(tmpPath(projectPath), `export_${milestoneId}`);
    await ensureDir(exportTmp);

    for (const trackedFile of commitState.files) {
      await reconstructFile(projectPath, trackedFile, exportTmp);
    }

    // Create ZIP
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outputZipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(exportTmp, false);
      archive.finalize();
    });

    // Clean up temp
    await fs.rm(exportTmp, { recursive: true, force: true });

    console.log('[vcs] milestone:export-zip  SUCCESS');
    return { status: 'success', path: outputZipPath };
  } catch (err: any) {
    console.error('[vcs] milestone:export-zip  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// project:storage-stats
// ------------------------------------------------------------------

export async function projectStorageStats(
  projectPath: string,
): Promise<{ totalBase: number; totalPatches: number; milestoneCount: number }> {
  let totalBase = 0;
  let totalPatches = 0;

  // Sum all files in base/
  try {
    const baseDir = basePath(projectPath);
    const baseFiles = await fs.readdir(baseDir);
    for (const f of baseFiles) {
      const stat = await fs.stat(path.join(baseDir, f));
      totalBase += stat.size;
    }
  } catch { /* empty */ }

  // Sum all files in patches/
  try {
    const patchDir = patchesPath(projectPath);
    const patchFiles = await fs.readdir(patchDir);
    for (const f of patchFiles) {
      const stat = await fs.stat(path.join(patchDir, f));
      totalPatches += stat.size;
    }
  } catch { /* empty */ }

  let milestoneCount = 0;
  try {
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    milestoneCount = Object.keys(registry.milestones).length;
  } catch { /* empty */ }

  return { totalBase, totalPatches, milestoneCount };
}

// ------------------------------------------------------------------
// project:rename
// ------------------------------------------------------------------

export async function projectRename(
  projectPath: string,
  newName: string,
): Promise<{ status: 'success' | 'error' }> {
  console.log(`[vcs] project:rename  path=${projectPath}  newName=${newName}`);
  try {
    // Update registry
    const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
    registry.projectName = newName;
    await writeJson(registryPath(projectPath), registry);

    // Update global projects list
    const list = await loadProjectsList();
    const entry = list.find((e) => e.projectPath === projectPath);
    if (entry) {
      entry.name = newName;
      await saveProjectsList(list);
    }

    console.log('[vcs] project:rename  SUCCESS');
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] project:rename  ERROR', err);
    return { status: 'error' };
  }
}

// ------------------------------------------------------------------
// settings:get / settings:set
// ------------------------------------------------------------------

export async function settingsGet(key: string): Promise<unknown> {
  try {
    const all = await readJson<Record<string, unknown>>(SETTINGS_FILE);
    return all[key] ?? null;
  } catch {
    return null;
  }
}

export async function settingsSet(
  key: string,
  value: unknown,
): Promise<{ status: 'success' | 'error' }> {
  try {
    let all: Record<string, unknown> = {};
    try {
      all = await readJson<Record<string, unknown>>(SETTINGS_FILE);
    } catch { /* file doesn't exist yet */ }
    all[key] = value;
    await writeJson(SETTINGS_FILE, all);
    return { status: 'success' };
  } catch (err: any) {
    console.error('[vcs] settings:set  ERROR', err);
    return { status: 'error' };
  }
}
