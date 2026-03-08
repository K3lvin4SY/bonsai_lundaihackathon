# Changelog

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
