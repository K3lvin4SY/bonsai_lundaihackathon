<div align="center">

<img src="assets/images/icon.png" alt="Bonsai" width="90" />

# Bonsai

**The safety net for creative workflows — minus the developer complexity.**

<br/>

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-CC0000?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)

</div>

---

## Problem Statement

Creative professionals — designers, illustrators, 3D artists, game developers — work with large binary files that change constantly: Photoshop documents, Blender scenes, Minecraft worlds, video clips. They need the same safety net that software developers have: the ability to **save a snapshot at any point**, **go back in time**, and **explore multiple creative directions simultaneously** without duplicating entire folders.

Existing tools fail them in two critical ways:

| Problem | Why it fails |
|---|---|
| **Git** | Built for text/code — bloats or breaks with large binaries, and its terminology (`commit`, `branch`, `HEAD`) is intimidating to non-technical users |
| **Manual folder duplication** | `design_v1/`, `design_v2_FINAL/`, `design_v2_FINAL_USE_THIS/` — unscalable, wastes disk space, makes parallel experimentation a nightmare |

**Bonsai solves this.**

---

## Solution

Bonsai is a desktop application that gives creative projects a **visual, branch-based history** built on familiar language: **Milestones** instead of commits, **Timelines** instead of branches.

Under the hood, a smart hybrid storage strategy keeps things fast and lean:

| Layer | Tool | Role |
|---|---|---|
| **Graph state** | Git | Tracks the tiny JSON blueprint for each milestone — lightning fast because Git never sees the heavy files |
| **Binary diffing** | xdelta3 | Computes compact binary patches between milestone versions — stores *only the changes*, not full copies |
| **Source of truth** | `global_registry.json` | A git-ignored file that holds the complete milestone tree so time travel never erases history |

### Core Interactions

| Action | What happens |
|---|---|
| **Save a Milestone** | Bonsai snapshots your file state. New files get a base copy; existing files get an `xdelta3` patch storing only what changed |
| **Restore a Milestone** | Bonsai checks out the right Git commit, reads the tiny blueprint, and reconstructs files by replaying patches. Warns if there are unsaved changes before proceeding |
| **Branch a Timeline** | Creates a new Git branch and keeps both histories alive on the canvas — restore any past milestone and save forward to start a parallel history |
| **Tag a Milestone** | Attach semantic labels (release, experiment, wip, backup, archived) to milestones for quick visual filtering |
| **Export a Milestone** | Save any milestone's full file state as a `.zip` archive via native dialog |
| **Visual Canvas** | Every milestone and timeline is rendered as an interactive node graph — branch-colored edges, tag pills, a MiniMap, and a search bar for instant filtering |
| **Auto-watch** | Bonsai monitors the project folder and auto-creates milestones when files change. The debounce interval (5 s – 1 min) is configurable per project |

### Design Philosophy

- **No Git vocabulary** — users see Milestones and Timelines, never commits or branches
- **Binary-first** — the workflow is designed around large creative files, not source code
- **Non-destructive time travel** — restoring an old milestone never erases future history; `global_registry.json` is always git-ignored and stays intact
- **Lean storage** — only deltas are stored after the first snapshot; projects don't balloon in size as history grows

---

## Tech Stack

### Backend — Electron Main Process

| Technology | Purpose |
|---|---|
| **Electron** | Cross-platform desktop shell |
| **TypeScript** | Type-safe backend logic |
| **Node.js `child_process`** | Spawning the bundled `xdelta3` binary |
| **simple-git** | Programmatic Git operations (init, commit, checkout, branch) |
| **xdelta3** | Binary delta encoding / decoding (bundled for Linux, macOS & Windows) |
| **archiver** | ZIP archive creation for milestone export |
| **chokidar** | Reliable cross-platform file watching for auto-watch (handles symlinks, renames, and deep nesting) |

### Frontend — Renderer Process

| Technology | Purpose |
|---|---|
| **React + TypeScript** | UI component framework |
| **Vite** | Fast frontend build tooling |
| **Tailwind CSS** | Utility-first styling |
| **Shadcn UI** | Accessible, composable component primitives |
| **React Flow** | Pannable / zoomable milestone graph canvas |
| **Tabler Icons** | Icon set |

### IPC Bridge

The frontend and backend communicate exclusively through Electron's `contextBridge` / `ipcMain.handle` pattern. The preload script exposes a typed `window.electronAPI` object so the renderer never touches Node directly.

---

## Project Structure

```
bonsai/
├── assets/
│   └── bin/
│       ├── xdelta3.exe         # xdelta3 for Windows
│       ├── xdelta3-linux       # xdelta3 for Linux
│       └── xdelta3-macos       # xdelta3 for macOS
├── src/
│   ├── main/
│   │   ├── main.ts             # Electron main process + IPC handler registration
│   │   └── core/
│   │       └── vcs.ts          # Full VCS engine (project & milestone lifecycle)
│   ├── preload/
│   │   └── preload.ts          # contextBridge → window.electronAPI
│   └── renderer/               # React frontend (Vite build output goes here)
├── package.json
├── tsconfig.json
└── IPC_Channels.md             # Full IPC API reference
```

**Key runtime files created inside each project folder:**

```
<your-project-folder>/
├── .app_data/
│   ├── global_registry.json    # Git-IGNORED — full DAG, never disappears on time travel
│   ├── base/                   # Git-IGNORED — original full copies of tracked binaries
│   └── patches/                # Git-IGNORED — xdelta3 binary patches per milestone
├── .tmp/                       # Git-IGNORED — scratch space for file reconstruction
├── commit_state.json           # Git-TRACKED — tiny per-milestone blueprint
└── .gitignore                  # Git-TRACKED — enforces the rules above
```

---

## Releases

Pre-built installers are available for all major platforms on the [Releases](../../releases) page:

| Platform | Format |
|---|---|
| ![Windows](https://img.shields.io/badge/Windows-0078D4?style=flat-square&logo=windows&logoColor=white) **Windows** | `.exe` installer |
| ![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white) **macOS** | `.dmg` image |
| ![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black) **Linux** | `.AppImage` |

> No build step required — just download, install, and launch.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git** installed and available on your `PATH`

### 1. Clone (with submodules)

The renderer is a git submodule. Use `--recurse-submodules` when cloning:

```bash
git clone --recurse-submodules git@github.com:K3lvin4SY/bonsai_lundaihackathon.git
cd bonsai_lundaihackathon/
```

If you already cloned without the flag:

```bash
git submodule update --init --recursive
```

### 2. Install dependencies

```bash
npm install
cd src/renderer && npm install && cd ../..
```

### 3. Build & launch

```bash
npm start
```

This compiles all TypeScript sources into `dist/`, copies the renderer output, and launches Electron.

---

## IPC API Reference

The full IPC channel specification — parameters, response shapes, and usage examples — is documented in [IPC_Channels.md](IPC_Channels.md).

| Method | Description |
|---|---|
| `projectCreate(path, name)` | Scaffold a new Bonsai project |
| `projectDelete(path)` | Remove a project and all its history |
| `projectList()` | List all registered projects |
| `projectTree(path)` | Fetch the full milestone DAG for the canvas |
| `milestoneCreate(path, message)` | Save the current state as a new milestone |
| `milestoneRestore(path, milestoneId)` | Rewind working files to a past milestone |
| `milestoneDelete(path, milestoneId)` | Delete a leaf milestone |
| `autoWatchStart(path)` | Start auto-watching a project folder for changes |
| `autoWatchStop(path)` | Stop auto-watching a project folder |
| `autoWatchStatus(path)` | Check if auto-watch is active for a project |
| `onAutoWatchMilestoneCreated(cb)` | Listen for auto-save milestone events (Main → Renderer) |
| `blacklistGet(path)` | Get the ignored files/folders list for a project |
| `blacklistSet(path, items)` | Update the ignored files/folders list for a project |
| `projectRename(path, name)` | Rename a project |
| `projectHasChanges(path)` | Check whether the project has unsaved changes since the active milestone |
| `projectStorageStats(path)` | Get total base, patch, and milestone count for a project |
| `milestoneRename(path, id, name)` | Rename an existing milestone |
| `milestoneSetTags(path, id, tags)` | Set the tag list for a milestone |
| `milestoneStorageSize(path, id)` | Get the on-disk size of a milestone's stored patches |
| `milestoneTrackedFiles(path, id)` | List the files tracked by a milestone |
| `milestoneExportZip(path, id)` | Export a milestone's file state as a `.zip` archive |
| `settingsGet(key)` | Read a persisted app setting |
| `settingsSet(key, value)` | Update and persist an app setting |
