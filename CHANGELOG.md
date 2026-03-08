# Changelog

## [1.3.0] - 2026-03-08

### Added
- **Branch colors** — toggle in Settings to color-code branches on the timeline canvas using an 8-color palette (applied to nodes and edges)
- **Milestone tags** — assign tags (release, experiment, wip, backup, archived) to milestones from the detail panel; tags appear as colored pills on timeline nodes
- **Milestone rename** — inline rename any milestone from the detail panel
- **Milestone export** — export any milestone as a `.zip` archive via native save dialog
- **Branch from here** — create a new branch starting from any milestone via the detail panel
- **Unsaved changes warning** — restore and branch-from-here actions now detect uncommitted changes and prompt before discarding
- **Storage stats** — view total base snapshot, patch, and milestone counts from the toolbar stats button
- **Milestone storage size** — each milestone's actual on-disk size shown in the detail panel
- **Tracked files list** — expandable list of files captured in each milestone snapshot
- **Search & filter** — search milestones by name, branch, or tag from the toolbar; non-matching nodes dim to 25% opacity
- **MiniMap** — a mini-map overview of the timeline canvas for easier navigation
- **Keyboard shortcut** — `Ctrl+M` / `Cmd+M` to quickly create a new milestone
- **Configurable auto-watch debounce** — choose 5s, 10s, 30s, or 1 min debounce interval in Project Settings
- **Project rename** — right-click a project on the Dashboard to rename it
- **Recent activity on Dashboard** — project cards now show the last milestone message
- New IPC channels: `milestone:storage-size`, `milestone:tracked-files`, `project:has-changes`, `milestone:rename`, `milestone:set-tags`, `milestone:export-zip`, `project:storage-stats`, `project:rename`, `settings:get`, `settings:set`

## [1.2.0] - 2026-03-08

### Added
- **Blacklist** — per-project file/folder exclusion list accessible from Project Settings
  - Blacklisted items are completely ignored: no base copies, no xdelta3 patches, no git tracking
  - "Add Files" and "Add Folders" buttons open a native file picker rooted at the project directory with multi-select support
  - Files/folders outside the project directory are rejected
  - Remove items instantly with a trash icon
  - Blacklist entries are persisted in the project registry and survive app restarts
  - `.gitignore` is automatically regenerated when the blacklist changes
- New IPC channels: `blacklist:get`, `blacklist:set`
- Multi-select support added to `dialog:open-file` and `dialog:open-directory` via optional `multiSelect` parameter

## [1.1.0] - 2026-03-08

### Added
- **Auto-watch** — automatically creates milestones when files in a project folder change
  - Toggle per-project via the Create Project modal or Project Settings
  - 10-second debounce to prevent multiple commits during rapid saves
  - Setting persists across app restarts
  - Watcher is suspended during milestone restore to avoid false triggers
  - Real-time UI update when an auto-save milestone is created
  - Dashboard shows a live "Auto-watch" indicator on watched projects
- New IPC channels: `autowatch:start`, `autowatch:stop`, `autowatch:status`, `autowatch:milestone-created`

## [1.0.0] - 2026-03-08

This is the initial release of Bonsai — a version control app built for creative people who don't want to deal with Git. Track changes to your projects, create milestones, and manage your work history through a simple visual interface.

### Added
- Project creation and management
- Milestone-based version history
- Visual project workspace
- Cross-platform support (Windows, macOS, Linux)
