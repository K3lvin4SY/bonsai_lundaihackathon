# Changelog

## [1.4.2] - 2026-03-09

### Fixed
- **Sidebar height** — sidebar no longer scrolls when the window is short; it is now always exactly the height of the window using `h-screen overflow-hidden` on the root layout
- **Settings & About sticky headers** — the back button and page title in both Settings and About are now sticky and remain visible while the page content scrolls beneath them
- **Milestone panel flashing on edit** — when editing a milestone tag, name, or description, the panel no longer closes and reopens. Now uses a silent tree refresh (without showing the loading skeleton) so edits update smoothly in place

### Changed
- **Settings back button** — updated to match the About page style (rounded icon button with arrow + inline page title) for consistency
- **Branch colors default** — branch colors are now enabled by default for new users
- **Minimap default** — minimap is now enabled by default for new users

## [1.4.1] - 2026-03-09

### Added
- **About page** — new page accessible from the sidebar (`Info` icon) with:
  - App identity, description, and design philosophy
  - Step-by-step "How to use" guide for new users
  - Key features overview (Timelines, Milestones, Time Travel, Tags, Auto-Watch, Export)
  - Creator cards with clickable GitHub profile links for all four contributors

## [1.4.0] - 2026-03-09

### Added
- **Custom project tags** — tags are no longer hardcoded. Each project stores its own set of tags (`label` + `color`) in its registry. Tags can be created and deleted from:
  - The **Milestone detail panel** — inline create with a color picker, applied immediately to the open panel
  - **Project Settings** — full tag management for the current project (add / remove)
- **Default tags in App Settings** — define a set of default tags (with custom colors) that are automatically copied into every new project. These can be freely customized or cleared from Settings
- New IPC channels: `project:get-tags`, `project:set-tags`
- New settings key: `defaultTags` (`TagDefinition[]` — array of `{ label: string; color: string }`)

### Changed
- Milestone tag pills on canvas nodes now use each tag's stored color instead of a hardcoded palette
- Milestone tag buttons in the detail panel are driven by the project's own tag list (no built-in tags shipped by default)

### Previous additions in 1.4.0
- **Milestone descriptions** — attach a longer description to any milestone at creation time or edit it later from the detail panel
- **Settings page expansion** — three new global settings:
  - **Auto-watch debounce default** — quick-pick the global auto-watch debounce interval from Settings (5 s, 10 s, 30 s, 1 min)
  - **Milestone name template** — configure the default milestone name using `{{n}}` (count) and `{{date}}` (locale date) placeholders
  - **Canvas layout direction** — choose between horizontal (Left → Right) and vertical (Top → Down) milestone graph layout
- **Dashboard sorting & filtering** — search projects by name, path, or last milestone message; sort by name, last modified, milestone count, or date created
- **Keyboard shortcut panel** — press `Ctrl+H` / `Cmd+H` anywhere on the canvas to see a quick-reference dialog of all keyboard shortcuts (`Ctrl+M`, `Ctrl+F`, `Escape`, `Ctrl+H`)
- New IPC channel: `milestone:set-description`
- New settings keys: `milestoneNameTemplate`, `canvasDirection`

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
- **File watcher reliability** — replaced `fs.watch` in `autowatch.ts` with [chokidar](https://github.com/paulmillr/chokidar), which handles macOS/Linux edge cases, symlinks, deep directory nesting, and rename events more reliably than the native Node.js API
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
