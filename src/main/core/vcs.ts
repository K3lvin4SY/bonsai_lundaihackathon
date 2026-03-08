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

export interface GlobalRegistry {
  projectId: string;
  projectName: string;
  createdAt: string;
  activeMilestoneId: string | null;
  activeBranch: string;
  branches: string[];
  milestones: Record<string, MilestoneNode>;
  autoWatch?: boolean;
}

export interface MilestoneNode {
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  parentMilestoneId: string | null;
  createdAt: string;
  children: string[];
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
}

export interface TreeNode {
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  createdAt: string;
  children: TreeNode[];
}

export interface MilestoneRecord {
  milestoneId: string;
  message: string;
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
 * Recursively list all files under `dir`, returning paths relative to `root`.
 */
async function listFilesRecursive(
  dir: string,
  root: string,
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
    if (entry.isDirectory()) {
      // Skip hidden directories and our bookkeeping folders
      if (
        entry.name.startsWith('.') ||
        entry.name === TMP_DIR ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      results.push(...(await listFilesRecursive(fullPath, root)));
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

function buildGitignore(): string {
  return [
    '# === Bonsai — auto-generated ===',
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
    '',
  ].join('\n');
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
      if (milestoneCount > 0) {
        const dates = milestoneIds.map(
          (id) => new Date(registry.milestones[id].createdAt).getTime(),
        );
        lastMilestoneAt = new Date(Math.max(...dates)).toISOString();
      }

      summaries.push({
        id: registry.projectId,
        name: registry.projectName,
        projectPath: entry.projectPath,
        createdAt: registry.createdAt,
        lastMilestoneAt,
        milestoneCount,
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
      commitHash: node.commitHash,
      branch: node.branch,
      createdAt: node.createdAt,
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
): Promise<{ milestoneId: string }> {
  console.log(`[vcs] milestone:create-initial  project=${projectPath}  msg="${message}"`);

  const milestoneId = uuidv4();
  const now = new Date().toISOString();

  // 1. Discover binary files in the project root
  const binaryFiles = await listFilesRecursive(projectPath, projectPath);
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
    await fs.writeFile(giPath, buildGitignore(), 'utf-8');
  }

  // 5. Git add & commit (use '.' so ALL non-binary files are staged;
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
): Promise<{ milestoneId: string }> {
  console.log(`[vcs] milestone:create  project=${projectPath}  msg="${message}"`);

  const registry = await readJson<GlobalRegistry>(registryPath(projectPath));
  const parentId = registry.activeMilestoneId;
  if (!parentId) {
    throw new Error('No active milestone — run milestone:create-initial first');
  }
  const parentNode = registry.milestones[parentId];

  // If parent already has children → create a new Git branch
  const git = getGit(projectPath);
  let branchName = parentNode.branch;

  if (parentNode.children.length > 0) {
    branchName = `branch-${uuidv4().slice(0, 8)}`;
    console.log(`[vcs] parent already has children, creating branch ${branchName}`);
    // Checkout the parent commit first, then create branch
    await git.checkout(parentNode.commitHash);
    await git.checkoutLocalBranch(branchName);
    if (!registry.branches.includes(branchName)) {
      registry.branches.push(branchName);
    }
  } else {
    // Ensure we're on the correct branch (not detached HEAD from a restore)
    await git.checkout(branchName);
  }

  // Read parent commit_state so we know which files are tracked & their patches
  const parentCommitState = await readJson<CommitState>(
    commitStatePath(projectPath),
  );

  // Discover current binary files on disk
  const currentFiles = await listFilesRecursive(projectPath, projectPath);

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

    // 1. Git checkout the commit (detached HEAD is fine)
    const git = getGit(projectPath);
    await git.checkout(node.commitHash);

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
