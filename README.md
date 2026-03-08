# <img src="assets/images/icon.png" alt="Bonsai Icon" style="height: 1em; vertical-align: middle;"> Bonsai

> Version history for creative people — no Git knowledge required.

---

## Problem Statement

Creative professionals (designers, illustrators, 3D artists, game developers) work with large binary files — Photoshop documents, Blender scenes, Minecraft worlds, video clips — that change constantly. They need the same safety net that software developers have: the ability to **save a snapshot of their work at any point**, **go back in time**, and **explore multiple creative directions simultaneously** without duplicating entire folders.

Existing tools fail them in two ways:

1. **Git** is built for text/code. It bloats or breaks entirely when tracking large binary files, and its terminology (`commit`, `branch`, `merge`, `HEAD`) is intimidating to non-technical users.
2. **Manual folder duplication** (`design_v1/`, `design_v2_FINAL/`, `design_v2_FINAL_USE_THIS/`) is unscalable, wastes disk space, and makes parallel experimentation a nightmare.

**Bonsai solves this.**

---

## Solution

Bonsai is a desktop application that gives creative projects a **visual, branch-based history** built on familiar language: **Milestones** instead of commits, **Timelines** instead of branches.

Under the hood, Bonsai uses a smart hybrid storage strategy that keeps things fast and lean:

| Layer | Tool | Role |
|---|---|---|
| **Graph state** | Git | Tracks the tiny JSON blueprint for each milestone — lightning fast because Git never sees the heavy files |
| **Binary diffing** | xdelta3 | Computes compact binary patches between milestone versions — stores *only the changes*, not full copies |
| **Source of truth** | `global_registry.json` | A git-ignored file that holds the complete milestone tree so "traveling back in time" never erases your history |

### How it works

- **Save a Milestone** — Bonsai snapshots your current file state. For new files it stores a base copy; for existing files it runs `xdelta3` to store only what changed.
- **Restore a Milestone** — Bonsai checks out the right Git commit, reads the tiny blueprint, and reconstructs your files by replaying the appropriate patches.
- **Branch a Timeline** — When you want to explore a creative direction without losing your current path, Bonsai automatically creates a new timeline (Git branch) and keeps both histories alive on the canvas.
- **Visual Canvas** — Every milestone and timeline is rendered as an interactive node graph so you can see your entire creative history at a glance.

---

## Tech Stack

### Backend (Electron Main Process)
| Technology | Purpose |
|---|---|
| **Electron** | Cross-platform desktop shell |
| **TypeScript** | Type-safe backend logic |
| **Node.js `child_process`** | Spawning the bundled `xdelta3` binary |
| **simple-git** | Programmatic Git operations (init, commit, checkout, branch) |
| **xdelta3** | Binary delta encoding / decoding (bundled for Linux & macOS) |

### Frontend (Renderer Process)
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
│       ├── xdelta3.exe         # xdelta3 for windows
│       ├── xdelta3-linux       # Bundled xdelta3 binaries
│       └── xdelta3-macos
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

### Key runtime files (created inside each project folder)

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

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git** installed and available on your `PATH`
- Linux or macOS (bundled `xdelta3` binaries are included; Windows support requires adding an `xdelta3.exe` to `assets/bin/`)

---

## Getting Started

### 1. Clone (with submodules)

The renderer is a git submodule. Use `--recurse-submodules` when cloning:

```bash
git clone --recurse-submodules git@github.com:K3lvin4SY/bonsai_lundaihackathon.git
```

If you already cloned without it:

```bash
git submodule update --init --recursive
```

Go into the repository folder:
```bash
cd bonsai_lundaihackathon/
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

The full IPC channel specification (parameters, response shapes, and usage examples) is documented in [IPC_Channels.md](IPC_Channels.md).

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
| `settingsGet(key)` | Read a persisted app setting |
| `settingsSet(key, value)` | Update and persist an app setting |

---

## Design Philosophy

- **No Git vocabulary** — users see Milestones and Timelines, never commits or branches.
- **Binary-first** — the workflow is designed around large creative files, not source code.
- **Non-destructive time travel** — restoring an old milestone never erases future history; `global_registry.json` is always git-ignored and stays intact.
- **Lean storage** — only deltas are stored after the first snapshot; projects don't balloon in size as history grows.
