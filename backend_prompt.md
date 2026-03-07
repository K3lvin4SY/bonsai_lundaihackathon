# Bonsai — Backend Prompt

I am building an Electron application called Bonsai that acts as a visual version control system for large binary creative files (e.g., Photoshop files, Minecraft worlds). I am using a Lovable-generated React frontend, so I need you to write the complete Electron backend (Main process and Preload script).

---

## Core Architecture

1. Git will be used purely to track the graph/tree state (commits, branches) and metadata.
2. Large binary files will be added to `.gitignore`.
3. `xdelta3` will be used to handle binary diffing.
4. We will bundle pre-compiled `xdelta3` executables for Windows, macOS, and Linux inside an `assets/bin/` folder. The app must detect `process.platform` to call the correct binary using Node's `child_process.spawn`.

---

## The Workflow

**Project Initialization (First Milestone):** The user initializes a folder. If any large binary files already exist, we copy them to `.app_data/base/`. We init Git, build the `.gitignore` (to ignore all large binaries in the working directory), and commit the initial `metadata.json`.

**Subsequent Milestones (Sequential Diffing):** When creating a new milestone, the app scans for changes.

- **For existing tracked binaries:** We run `xdelta3` to calculate the diff between the **immediate parent milestone's state** and the current state. *(Technical requirement: reconstruct the parent milestone's binary file in a temporary directory first, then diff that reconstructed parent against the current working file).* We save the resulting patch to `.app_data/patches/`.
- **For newly added binaries:** If a user adds a *brand new* large binary file (e.g., adding a `.psd` in Milestone 3), do not attempt to diff it. Instead, copy it directly into `.app_data/base/` to serve as the permanent base file for that specific file's future diffs.
- **Commit:** We update the metadata to map which patches (or new base files) belong to this milestone. We use Git to commit the new files in `.app_data/` and the JSON. If the current commit already has children, create a new Git branch before committing.

**Restore (Sequential Application):** We `git checkout` the target commit. To reconstruct the working directory, we read the metadata to see which binary files existed at this exact milestone. For each file, we take its original base file from `.app_data/base/` and **sequentially apply the chain of xdelta3 patches** following the direct path from the root down to the target milestone.

---

# IPC Channel Reference

All IPC communication uses Electron's `ipcRenderer.invoke()` / `ipcMain.handle()` pattern. Every call is **asynchronous** and returns a `Promise`. The renderer accesses these channels via `window.electronAPI.<method>()` (exposed by the preload script).

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

---

## `project:create`

Create a new Bonsai project. Scaffolds the `.app_data/` folder and registers the project in the global registry.

- **Renderer call:** `await window.electronAPI.projectCreate(projectPath, name)`
- **Parameters:** `projectPath` (string, absolute path), `name` (string)
- **Response:** `{ id: string; status: 'success' | 'error' }`

## `project:delete`

Delete a Bonsai project. Removes `.app_data/`, `.git/`, `.gitignore` and unregisters from the global list.

- **Renderer call:** `await window.electronAPI.projectDelete(projectPath)`
- **Parameters:** `projectPath` (string, absolute path)
- **Response:** `{ status: 'success' | 'error' }`

## `project:list`

List all registered Bonsai projects with summary information.

- **Renderer call:** `await window.electronAPI.projectList()`
- **Parameters:** *None.*
- **Response:** `Array<ProjectSummary>`

## `project:tree`

Get the full milestone tree (DAG), branch list, and flat milestone array for a project. This is the primary data source for rendering the visual version-control graph.

- **Renderer call:** `await window.electronAPI.projectTree(projectPath)`
- **Parameters:** `projectPath` (string, absolute path)
- **Response:** `{ tree: TreeNode[]; branches: string[]; milestones: MilestoneRecord[]; activeMilestoneId: string | null; }`

## `milestone:create-initial`

Create the first milestone for a project. Copies binary files to the base folder, initialises Git, builds `.gitignore`, and commits metadata.

- **Renderer call:** `await window.electronAPI.milestoneCreateInitial(projectPath, targetPath, message)`
- **Parameters:** `projectPath` (string), `targetPath` (string, absolute path to file/folder to track), `message` (string)
- **Response:** `{ milestoneId: string }`

## `milestone:create`

Create a subsequent milestone. Runs `xdelta3` to compute binary diffs against the previous state, stores patches, and commits to Git. If the current HEAD already has children, a new branch is created automatically.

- **Renderer call:** `await window.electronAPI.milestoneCreate(projectPath, message)`
- **Parameters:** `projectPath` (string), `message` (string)
- **Response:** `{ milestoneId: string }`

## `milestone:restore`

Restore the project's working directory to the state at a specific milestone. Checks out the Git commit and reconstructs binary files by sequentially applying xdelta3 patches from the base.

- **Renderer call:** `await window.electronAPI.milestoneRestore(projectPath, milestoneId)`
- **Parameters:** `projectPath` (string), `milestoneId` (string)
- **Response:** `{ status: 'success' | 'error' }`

## `milestone:delete`

Delete a milestone. Removes its patch files and metadata entry. The Git commit is not rewritten — it stays in the DAG but becomes unreachable if the branch is pruned. Note: A milestone that has children cannot be deleted.

- **Renderer call:** `await window.electronAPI.milestoneDelete(projectPath, milestoneId)`
- **Parameters:** `projectPath` (string), `milestoneId` (string)
- **Response:** `{ status: 'success' | 'error' }`

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

1. `main.js`: Setup Electron, register IPC handlers for all 8 channels defined in the documentation above.
2. `preload.js`: Create the `contextBridge` exposing `window.electronAPI` with the exact method names mapped to the channels.
3. `core/vcs.js`: A utility module containing the wrapper functions for the `xdelta3` child processes and the `simple-git` commands to execute the workflow described above. Includes logic for managing the DAG, creating branches, and maintaining the metadata/registry files.
4. `package.json`: Include necessary dependencies like `simple-git`.

Ensure error handling is robust, as large files might take time to patch. Include basic console logging for the IPC communication to help me debug when I connect the Lovable frontend.
