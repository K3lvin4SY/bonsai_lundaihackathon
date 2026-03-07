# Bonsai — Backend Prompt

I am building an Electron application called Bonsai that acts as a visual version control system for large binary creative files (e.g., Photoshop files, Minecraft worlds). I am using a Lovable-generated React frontend, so I need you to write the complete Electron backend (Main process and Preload script).

---

## Core Architecture & State Management

1. **Git for Graph State:** Git will be used purely to track the graph/tree state (commits, branches) and localized milestone blueprints. 
2. **xdelta3 for Binary Diffing:** `xdelta3` will be used to handle binary diffing. We will bundle pre-compiled `xdelta3` executables for Windows, macOS, and Linux inside an `assets/bin/` folder. The app must detect `process.platform` to call the correct binary using Node's `child_process.spawn`.
3. **The Metadata Split (Crucial):** If metadata.json holds the entire DAG and is committed to Git, checking out an old milestone will revert the JSON, erasing the "future" DAG history from the UI. Therefore, metadata must be split into two separate files:
    * `global_registry.json` (Git-ignored): Stores the full tree structure, all milestone IDs, and branch names. Because it is git-ignored, Git never touches it. It acts as the absolute source of truth for the UI, and it never disappears when traveling back in time.
    * `commit_state.json` (Tracked by Git): This is the only file committed to Git. It acts as a localized blueprint for a single specific milestone (e.g., "I am Milestone 3. My parent is Milestone 2. To reconstruct hero_image.psd, use Base ID 'xyz' and apply patches 'm2.patch' and 'm3.patch'."). When checking out an old milestone, Git swaps this file so the reconstruction script knows exactly what to do.
4. **Strict Git Tracking Rules:** To prevent Git from choking on large binaries, we must be ruthless about what Git is allowed to see.
    * **Tracked by Git (The absolute minimum):**
        * `.gitignore` (so rules are enforced)
        * `commit_state.json` (the tiny text blueprint for the current milestone)
    * **Git-ignored (Everything heavy):**
        * The working directory binaries (`*.psd`, `*.mcworld`, etc.)
        * `.app_data/base/` (Exact copies of heavy binaries. Tracking these would explode repo size instantly)
        * `.app_data/patches/` (While xdelta3 patches are smaller, they are still binary files. Keep them out of Git)
        * `.tmp/` (The temporary reconstruction folder)
        * `global_registry.json` (To avoid time-travel deletion)

---

## JSON State Schemas

To ensure the backend perfectly matches the frontend rendering logic, you must strictly adhere to the following data structures for the two state files.

### 1. `global_registry.json` (The Git-Ignored Source of Truth)
This file sits in `.app_data/global_registry.json`.

```typescript
interface GlobalRegistry {
  projectId: string;
  projectName: string;
  createdAt: string; // ISO-8601
  activeMilestoneId: string | null;
  activeBranch: string;
  branches: string[]; 
  milestones: Record<string, MilestoneNode>; // Keyed by milestoneId
}

interface MilestoneNode {
  milestoneId: string;
  message: string;
  commitHash: string; // The Git commit hash associated with this milestone
  branch: string;
  parentMilestoneId: string | null;
  createdAt: string; // ISO-8601
  children: string[]; // Array of child milestoneIds
}
```

### 2. `commit_state.json` (The Git-Tracked Blueprint)

This file sits in the root of the project (or tracked inside `.app_data/`).

```typescript
interface CommitState {
  milestoneId: string;
  parentMilestoneId: string | null;
  files: TrackedFile[];
}

interface TrackedFile {
  relativePath: string; // e.g., "designs/hero_image.psd"
  baseFileId: string; // The filename of the original base copy in .app_data/base/
  patches: string[]; // Ordered array of patch filenames to apply sequentially from .app_data/patches/
}
```

---

## The Workflow

**Project Initialization (First Milestone):** The user initializes a folder. If large binary files exist, copy them to `.app_data/base/`. Init Git, build the `.gitignore` (applying the strict rules above), create the first `global_registry.json`, and commit the initial `commit_state.json`.

**Subsequent Milestones (Sequential Diffing):** When creating a new milestone, the app scans for changes.

* **For existing tracked binaries:** Run `xdelta3` to calculate the diff between the **immediate parent milestone's state** and the current state. *(Technical requirement: reconstruct the parent milestone's binary file in a `.tmp/` directory first, then diff that reconstructed parent against the current working file).* Save the patch to `.app_data/patches/`.
* **For newly added binaries:** Copy brand new large binaries directly into `.app_data/base/` to serve as the permanent base file. Do not attempt to diff them.
* **Commit:** Update `global_registry.json` with the new node/branch. Update the `commit_state.json` blueprint for this specific milestone. Git commits *only* `commit_state.json` (and `.gitignore` if changed). If the current commit already has children, create a new Git branch before committing.

**Restore (Sequential Application & Patch Storage Logic):** Because `.app_data/patches/` is git-ignored, patch accumulation happens purely on the user's hard drive file system.
*Example Scenario:*

1. Milestone 1: Folder is empty (uses base file).
2. Milestone 2: Folder contains `m2.patch`.
3. Milestone 3: Folder contains `m2.patch` and `m3.patch`.
*Jumping back to Milestone 1:*
4. Git checks out the Milestone 1 commit.
5. The working directory updates to the Milestone 1 `commit_state.json`.
6. The `.app_data/patches/` folder *still* contains `m2.patch` and `m3.patch` (Git leaves it alone).
7. `core/vcs.js` reads the M1 `commit_state.json`, sees it requires zero patches, reconstructs the base file from `.app_data/base/`, and completely ignores the future patches sitting right there in the folder.
This keeps Git lightning-fast (managing only tiny JSON files) while the node script safely manages the heavy binary lifting.

---

# IPC Channel Reference

All IPC communication uses Electron's `ipcRenderer.invoke()` / `ipcMain.handle()` pattern. Every call is **asynchronous** and returns a `Promise`. The renderer accesses these via `window.electronAPI.<method>()` (exposed by the preload script).

## Table of Contents

| Channel | Preload method | Direction |
| --- | --- | --- |
| `project:create` | `projectCreate()` | Renderer → Main |
| `project:delete` | `projectDelete()` | Renderer → Main |
| `project:list` | `projectList()` | Renderer → Main |
| `project:tree` | `projectTree()` | Renderer → Main |
| `milestone:create-initial` | `milestoneCreateInitial()` | Renderer → Main |
| `milestone:create` | `milestoneCreate()` | Renderer → Main |
| `milestone:restore` | `milestoneRestore()` | Renderer → Main |
| `milestone:delete` | `milestoneDelete()` | Renderer → Main |

*(Descriptions for each channel are outlined below)*

### `project:create`

Create a new Bonsai project. Scaffolds the `.app_data/` folder and registers the project in the global registry.

* **Call:** `await window.electronAPI.projectCreate(projectPath, name)`
* **Returns:** `{ id: string; status: 'success' | 'error' }`

### `project:delete`

Delete a Bonsai project. Removes `.app_data/`, `.git/`, `.gitignore` and unregisters from the global list.

* **Call:** `await window.electronAPI.projectDelete(projectPath)`
* **Returns:** `{ status: 'success' | 'error' }`

### `project:list`

List all registered Bonsai projects with summary information.

* **Call:** `await window.electronAPI.projectList()`
* **Returns:** `Array<ProjectSummary>`

### `project:tree`

Get the full milestone tree (DAG), branch list, and flat milestone array for a project. Read primarily from `global_registry.json`.

* **Call:** `await window.electronAPI.projectTree(projectPath)`
* **Returns:** `{ tree: TreeNode[]; branches: string[]; milestones: MilestoneRecord[]; activeMilestoneId: string | null; }`

### `milestone:create-initial`

Create the first milestone for a project. Copies binary files to the base folder, initialises Git, builds `.gitignore`, creates `global_registry.json`, and commits `commit_state.json`.

* **Call:** `await window.electronAPI.milestoneCreateInitial(projectPath, message)`
* **Returns:** `{ milestoneId: string }`

### `milestone:create`

Create a subsequent milestone. Runs `xdelta3` to compute binary diffs, stores patches, updates both state files, and commits `commit_state.json` to Git. Auto-creates branches if HEAD has children.

* **Call:** `await window.electronAPI.milestoneCreate(projectPath, message)`
* **Returns:** `{ milestoneId: string }`

### `milestone:restore`

Restore the working directory to a specific milestone. Checks out the Git commit and reconstructs binary files sequentially using `commit_state.json`.

* **Call:** `await window.electronAPI.milestoneRestore(projectPath, milestoneId)`
* **Returns:** `{ status: 'success' | 'error' }`

### `milestone:delete`

Delete a milestone. Removes its patch files and metadata entry in `global_registry.json`. The Git commit stays in the DAG but becomes unreachable if the branch is pruned. Cannot delete a milestone that has children.

* **Call:** `await window.electronAPI.milestoneDelete(projectPath, milestoneId)`
* **Returns:** `{ status: 'success' | 'error' }`

---

## Common Types Reference

```typescript
interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  createdAt: string;
  lastMilestoneAt: string | null;
  milestoneCount: number;
}

interface TreeNode {
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  createdAt: string;
  children: TreeNode[];
}

interface MilestoneRecord {
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  parentMilestoneId: string | null;
  patchFiles: string[];
  createdAt: string;
}
```

---

## Deliverables

1. `main.js`: Setup Electron, register IPC handlers for all 8 channels defined above.
2. `preload.js`: Create the `contextBridge` exposing `window.electronAPI` with exact method names.
3. `core/vcs.js`: A utility module containing the wrapper functions for the `xdelta3` child processes and the `simple-git` commands to execute the workflow described above. Includes logic for managing the DAG, creating branches, maintaining the `global_registry.json`, and committing the `commit_state.json`.
4. `package.json`: Include necessary dependencies like `simple-git`.

Ensure error handling is robust, as large files might take time to patch. Include basic console logging for the IPC communication to help debug the frontend connection.
