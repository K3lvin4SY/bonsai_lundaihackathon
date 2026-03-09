# Bonsai — IPC Channel Reference

All IPC communication uses Electron's `ipcRenderer.invoke()` / `ipcMain.handle()` pattern.
Every call is **asynchronous** and returns a `Promise`.

The renderer accesses these channels via `window.electronAPI.<method>()` (exposed by the preload script).

---

## Table of Contents

| Channel | Preload method | Direction |
|---|---|---|
| [`project:create`](#projectcreate) | `projectCreate()` | Renderer → Main |
| [`project:delete`](#projectdelete) | `projectDelete()` | Renderer → Main |
| [`project:list`](#projectlist) | `projectList()` | Renderer → Main |
| [`project:tree`](#projecttree) | `projectTree()` | Renderer → Main |
| [`project:rename`](#projectrename) | `projectRename()` | Renderer → Main |
| [`project:archive`](#projectarchive) | `projectArchive()` | Renderer → Main |
| [`project:unarchive`](#projectunarchive) | `projectUnarchive()` | Renderer → Main |
| [`project:has-changes`](#projecthas-changes) | `projectHasChanges()` | Renderer → Main |
| [`project:storage-stats`](#projectstorage-stats) | `projectStorageStats()` | Renderer → Main |
| [`project:get-tags`](#projectget-tags) | `projectGetTags()` | Renderer → Main |
| [`project:set-tags`](#projectset-tags) | `projectSetTags()` | Renderer → Main |
| [`milestone:create-initial`](#milestonecreateinitial) | `milestoneCreateInitial()` | Renderer → Main |
| [`milestone:create`](#milestonecreate) | `milestoneCreate()` | Renderer → Main |
| [`milestone:restore`](#milestonerestore) | `milestoneRestore()` | Renderer → Main |
| [`milestone:delete`](#milestonedelete) | `milestoneDelete()` | Renderer → Main |
| [`milestone:rename`](#milestonerename) | `milestoneRename()` | Renderer → Main |
| [`milestone:set-tags`](#milestoneset-tags) | `milestoneSetTags()` | Renderer → Main |
| [`milestone:set-description`](#milestoneset-description) | `milestoneSetDescription()` | Renderer → Main |
| [`milestone:storage-size`](#milestonestorage-size) | `milestoneStorageSize()` | Renderer → Main |
| [`milestone:tracked-files`](#milestonetracked-files) | `milestoneTrackedFiles()` | Renderer → Main |
| [`milestone:export-zip`](#milestoneexport-zip) | `milestoneExportZip()` | Renderer → Main |
| [`autowatch:start`](#autowatchstart) | `autoWatchStart()` | Renderer → Main |
| [`autowatch:stop`](#autowatchstop) | `autoWatchStop()` | Renderer → Main |
| [`autowatch:status`](#autowatchstatus) | `autoWatchStatus()` | Renderer → Main |
| [`autowatch:milestone-created`](#autowatchmilestone-created) | `onAutoWatchMilestoneCreated()` | Main → Renderer |
| [`settings:get`](#settingsget) | `settingsGet()` | Renderer → Main |
| [`settings:set`](#settingsset) | `settingsSet()` | Renderer → Main |
| [`shell:open-external`](#shellopen-external) | `openExternal()` | Renderer → Main |
| [`blacklist:get`](#blacklistget) | `blacklistGet()` | Renderer → Main |
| [`blacklist:set`](#blacklistset) | `blacklistSet()` | Renderer → Main |

---

## `project:create`

Create a new Bonsai project. Scaffolds the `.app_data/` folder and registers the project in the global registry.

### Renderer call

```ts
const result = await window.electronAPI.projectCreate(projectPath, name);
```

### Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `projectPath` | `string` | — | Absolute path to the project root directory |
| `name` | `string` | — | Human-readable project name |

### Response

```ts
{ id: string; status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "City Poster Design"]

// Response
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success"
}
```

---

## `project:delete`

Delete a Bonsai project. Removes `.app_data/`, `.git/`, `.gitignore` and unregisters from the global list.

### Renderer call

```ts
const result = await window.electronAPI.projectDelete(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "status": "success"
}
```

---

## `project:list`

List all registered Bonsai projects with summary information.

### Renderer call

```ts
const projects = await window.electronAPI.projectList();
```

### Parameters

_None._

### Response

```ts
Array<{
  id: string;
  name: string;
  projectPath: string;
  createdAt: string;                   // ISO 8601 timestamp
  lastMilestoneAt: string | null;      // ISO 8601 or null if no milestones
  milestoneCount: number;
  lastMilestoneMessage: string | null; // Message of the most recent milestone
}>
```

### Example

```jsonc
// Response
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "City Poster Design",
    "projectPath": "/home/user/city-poster",
    "createdAt": "2026-03-01T10:00:00.000Z",
    "lastMilestoneAt": "2026-03-05T14:30:00.000Z",
    "milestoneCount": 5,
    "lastMilestoneMessage": "Refined color grading"
  },
  {
    "id": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
    "name": "Logo Redesign",
    "projectPath": "/home/user/logo-redesign",
    "createdAt": "2026-02-15T08:00:00.000Z",
    "lastMilestoneAt": "2026-02-28T16:45:00.000Z",
    "milestoneCount": 12
  }
]
```

> **Note:** If a project's folder was deleted externally, its entry will still appear with `name: "(unavailable)"`, empty `createdAt`, and `milestoneCount: 0`.

---

## `project:tree`

Get the full milestone tree (DAG), branch list, and flat milestone array for a project. This is the primary data source for rendering the visual version-control graph.

### Renderer call

```ts
const data = await window.electronAPI.projectTree(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{
  tree: TreeNode[];         // Root node(s) of the milestone DAG
  branches: string[];       // All Git branch names in the project
  milestones: MilestoneRecord[];  // Flat list of every milestone
  activeMilestoneId: string | null;  // Milestone matching current HEAD (null if none)
}
```

**`TreeNode` shape:**

```ts
{
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  createdAt: string;        // ISO 8601
  children: TreeNode[];     // Nested child milestones
  tags?: string[];          // Optional semantic tags (e.g. "release", "wip")
  description?: string;     // Optional longer description
}
```

**`MilestoneRecord` shape:**

```ts
{
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  parentMilestoneId: string | null;
  patchFiles: string[];     // Relative paths inside .app_data/patches/
  createdAt: string;        // ISO 8601
  tags?: string[];          // Optional semantic tags
  description?: string;     // Optional longer description
}
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "tree": [
    {
      "milestoneId": "aaa-111",
      "message": "Initial canvas setup",
      "commitHash": "e3b0c44",
      "branch": "main",
      "createdAt": "2026-03-01T10:00:00.000Z",
      "children": [
        {
          "milestoneId": "bbb-222",
          "message": "Added background layer",
          "commitHash": "a1b2c3d",
          "branch": "main",
          "createdAt": "2026-03-02T12:00:00.000Z",
          "children": [
            {
              "milestoneId": "ccc-333",
              "message": "Refined color grading",
              "commitHash": "d4e5f6a",
              "branch": "main",
              "createdAt": "2026-03-03T09:00:00.000Z",
              "children": []
            },
            {
              "milestoneId": "ddd-444",
              "message": "Alternative: dark theme",
              "commitHash": "7b8c9d0",
              "branch": "branch-ddd-444",
              "createdAt": "2026-03-03T11:00:00.000Z",
              "children": []
            }
          ]
        }
      ]
    }
  ],
  "branches": ["main", "branch-ddd-444"],
  "milestones": [
    {
      "milestoneId": "aaa-111",
      "message": "Initial canvas setup",
      "commitHash": "e3b0c44",
      "branch": "main",
      "parentMilestoneId": null,
      "patchFiles": [],
      "createdAt": "2026-03-01T10:00:00.000Z"
    },
    {
      "milestoneId": "bbb-222",
      "message": "Added background layer",
      "commitHash": "a1b2c3d",
      "branch": "main",
      "parentMilestoneId": "aaa-111",
      "patchFiles": ["patches/bbb-222/city-poster.psd.patch"],
      "createdAt": "2026-03-02T12:00:00.000Z"
    },
    {
      "milestoneId": "ccc-333",
      "message": "Refined color grading",
      "commitHash": "d4e5f6a",
      "branch": "main",
      "parentMilestoneId": "bbb-222",
      "patchFiles": ["patches/ccc-333/city-poster.psd.patch"],
      "createdAt": "2026-03-03T09:00:00.000Z"
    },
    {
      "milestoneId": "ddd-444",
      "message": "Alternative: dark theme",
      "commitHash": "7b8c9d0",
      "branch": "branch-ddd-444",
      "parentMilestoneId": "bbb-222",
      "patchFiles": ["patches/ddd-444/city-poster.psd.patch"],
      "createdAt": "2026-03-03T11:00:00.000Z"
    }
  ],
  "activeMilestoneId": "ccc-333"
}
```

---

## `milestone:create-initial`

Create the first milestone for a project. Copies binary files to the base folder, initialises Git, builds `.gitignore`, and commits metadata.

### Renderer call

```ts
const result = await window.electronAPI.milestoneCreateInitial(projectPath, message, description?);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory (binary files are scanned from here) |
| `message` | `string` | Description for the initial milestone |
| `description` | `string?` | Optional longer description for the milestone |

### Response

```ts
{ milestoneId: string }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "Initial canvas setup"]

// Response
{
  "milestoneId": "aaa-111-bbb-222-ccc"
}
```

---

## `milestone:create`

Create a subsequent milestone. Runs `xdelta3` to compute binary diffs against the previous state, stores patches, and commits to Git. If the current HEAD already has children, a new branch is created automatically.

### Renderer call

```ts
const result = await window.electronAPI.milestoneCreate(projectPath, message, description?);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `message` | `string` | Description for this milestone |
| `description` | `string?` | Optional longer description for the milestone |

### Response

```ts
{ milestoneId: string }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "Added skyline silhouette layer"]

// Response
{
  "milestoneId": "bbb-222-ccc-333-ddd"
}
```

---

## `milestone:restore`

Restore the project's working directory to the state at a specific milestone. Checks out the Git commit and reconstructs binary files by sequentially applying xdelta3 patches from the base.

### Renderer call

```ts
const result = await window.electronAPI.milestoneRestore(projectPath, milestoneId);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the target milestone |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "aaa-111-bbb-222-ccc"]

// Response
{
  "status": "success"
}
```

---

## `milestone:delete`

Delete a milestone. Removes its patch files and metadata entry. The Git commit is not rewritten — it stays in the DAG but becomes unreachable if the branch is pruned.

> **Constraint:** A milestone that has children (other milestones that depend on it) cannot be deleted. You must delete the leaf milestones first.

### Renderer call

```ts
const result = await window.electronAPI.milestoneDelete(projectPath, milestoneId);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the milestone to delete |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "ccc-333-ddd-444-eee"]

// Response
{
  "status": "success"
}
```


---

## `project:rename`

Rename an existing project. Updates the entry in the global registry without touching the project's files or Git history.

### Renderer call

```ts
const result = await window.electronAPI.projectRename(projectPath, newName);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `newName` | `string` | New human-readable project name |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "City Poster 2026"]

// Response
{
  "status": "success"
}
```

---

## `project:archive`

Archive a project. Sets the `archived` flag in `projects.json` and stops auto-watch if active. Archived projects still appear in `project:list` with `archived: true` but are displayed in a separate collapsed section in the UI.

### Renderer call

```ts
const result = await window.electronAPI.projectArchive(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "status": "success"
}
```

---

## `project:unarchive`

Unarchive a previously archived project. Clears the `archived` flag in `projects.json`, restoring the project to the active list.

### Renderer call

```ts
const result = await window.electronAPI.projectUnarchive(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "status": "success"
}
```

---

## `project:has-changes`

Check whether the project's working directory has unsaved changes relative to the currently active milestone. Used to warn the user before a restore or branch operation would discard work.

### Renderer call

```ts
const result = await window.electronAPI.projectHasChanges(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ hasChanges: boolean }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "hasChanges": true
}
```

---

## `project:storage-stats`

Return aggregate storage statistics for a project: total size of base snapshots, total size of patch files, and number of milestones.

### Renderer call

```ts
const result = await window.electronAPI.projectStorageStats(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{
  totalBase: number;       // Bytes used by .app_data/base/
  totalPatches: number;    // Bytes used by .app_data/patches/
  milestoneCount: number;  // Total number of milestones
}
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "totalBase": 52428800,
  "totalPatches": 8388608,
  "milestoneCount": 12
}
```

---

## `milestone:rename`

Rename an existing milestone. Updates the message stored in the project registry.

### Renderer call

```ts
const result = await window.electronAPI.milestoneRename(projectPath, milestoneId, newMessage);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the target milestone |
| `newMessage` | `string` | The new milestone name / description |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "bbb-222", "First background pass (revised)"]

// Response
{
  "status": "success"
}
```

---

## `milestone:set-tags`

Replace the tag list for a milestone. Tags are labels from the project's own custom tag definitions (see [`project:get-tags`](#projectget-tags)). Pass an empty array to clear all tags.

### Renderer call

```ts
const result = await window.electronAPI.milestoneSetTags(projectPath, milestoneId, tags);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the target milestone |
| `tags` | `string[]` | Replacement tag list — labels must exist in the project's `customTags` (pass `[]` to clear all tags) |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "ccc-333", ["release", "backup"]]

// Response
{
  "status": "success"
}
```

---

## `milestone:storage-size`

Get the total on-disk size (in bytes) of the patch files stored for a specific milestone.

### Renderer call

```ts
const result = await window.electronAPI.milestoneStorageSize(projectPath, milestoneId);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the target milestone |

### Response

```ts
{ bytes: number }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "bbb-222"]

// Response
{
  "bytes": 2097152
}
```

---

## `milestone:tracked-files`

List the relative file paths that are tracked (stored) by a specific milestone. For the initial milestone these are the base copies; for subsequent milestones these are the files for which a patch was computed.

### Renderer call

```ts
const result = await window.electronAPI.milestoneTrackedFiles(projectPath, milestoneId);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the target milestone |

### Response

```ts
{ files: string[] }   // Relative paths from the project root
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "bbb-222"]

// Response
{
  "files": ["city-poster.psd", "reference/skyline.png"]
}
```

---

## `milestone:export-zip`

Export the full reconstructed file state of a milestone as a `.zip` archive. Opens a native Save As dialog for the user to choose the destination. Returns `null` if the user cancels the dialog.

### Renderer call

```ts
const result = await window.electronAPI.milestoneExportZip(projectPath, milestoneId);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the milestone to export |

### Response

```ts
{ status: 'success' | 'cancelled' | 'error'; outputPath?: string }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "ccc-333"]

// Response (user chose a path)
{
  "status": "success",
  "outputPath": "/home/user/Downloads/city-poster-ccc-333.zip"
}

// Response (user cancelled)
{
  "status": "cancelled"
}
```

---

## Common Types Reference

### `ProjectSummary`

Returned by `project:list`. One entry per registered project.

```ts
interface ProjectSummary {
  id: string;                          // UUID
  name: string;                        // Human-readable name
  projectPath: string;                 // Absolute filesystem path
  createdAt: string;                   // ISO 8601 timestamp
  lastMilestoneAt: string | null;      // ISO 8601 or null
  milestoneCount: number;              // Total milestones in the project
  lastMilestoneMessage: string | null; // Message of the most recent milestone
}
```

### `TagDefinition`

A custom tag belonging to a project or the global default-tags list.

```ts
interface TagDefinition {
  label: string;   // Short display name (e.g. "release", "wip")
  color: string;   // Hex color string (e.g. "#22c55e")
}
```

### `TreeNode`

A node in the milestone DAG (used by `project:tree`).

```ts
interface TreeNode {
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  createdAt: string;
  children: TreeNode[];
  tags?: string[];       // Labels from the project's customTags
  description?: string;  // Optional longer description
}
```

### `MilestoneRecord`

Full milestone data (stored in `global_registry.json`).

```ts
interface MilestoneRecord {
  milestoneId: string;
  message: string;
  commitHash: string;
  branch: string;
  parentMilestoneId: string | null;
  patchFiles: string[];
  createdAt: string;
  tags?: string[];       // Labels from the project's customTags
  description?: string;  // Optional longer description
}
```

---

## `milestone:set-description`

Set or update the description for an existing milestone.

### Renderer call

```ts
const result = await window.electronAPI.milestoneSetDescription(projectPath, milestoneId, description);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `milestoneId` | `string` | UUID of the target milestone |
| `description` | `string` | The new description text (pass `""` to clear) |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", "bbb-222", "Added the skyline silhouette layer with gradient masking"]

// Response
{
  "status": "success"
}
```

---

## `settings:get`

Retrieve a single app setting value by key. Settings are persisted in `~/.config/bonsai/settings.json` (or platform equivalent).

### Renderer call

```ts
const value = await window.electronAPI.settingsGet(key);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `key` | `string` | The setting key to read (e.g. `"launchToTray"`) |

### Response

The value of the setting, or `undefined` if not set.

### Example

```jsonc
// Request args
["launchToTray"]

// Response
false
```

---

## `settings:set`

Update a single app setting and persist it to disk. Changes to `launchToTray` take effect immediately (creating or destroying the system tray icon).

### Renderer call

```ts
const result = await window.electronAPI.settingsSet(key, value);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `key` | `string` | The setting key to update (e.g. `"launchToTray"`) |
| `value` | `unknown` | The new value for the setting |

### Response

```ts
{ status: 'success' }
```

### Example

```jsonc
// Request args
["launchToTray", true]

// Response
{
  "status": "success"
}
```

### Available Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `branchColorsEnabled` | `boolean` | `true` | Color-code branches on the timeline canvas using the 8-color palette |
| `minimapEnabled` | `boolean` | `true` | Show the minimap overview panel on the timeline canvas |
| `autoWatchDebounceMs` | `number` | `10000` | Milliseconds to wait after the last file change before auto-creating a milestone (min 1000) |
| `milestoneNameTemplate` | `string` | `""` | Default milestone name template. Supports `{{n}}` (milestone count) and `{{date}}` (locale date) placeholders |
| `canvasDirection` | `string` | `"horizontal"` | Canvas layout direction: `"horizontal"` (Left → Right) or `"vertical"` (Top → Down) |
| `defaultTags` | `TagDefinition[]` | `[]` | Default set of custom tags copied into every newly created project. Each entry is `{ label: string; color: string }` |

---

## `shell:open-external`

Open a URL in the user's default system browser. Only `http://` and `https://` URLs are permitted — other schemes are silently ignored.

### Renderer call

```ts
await window.electronAPI.openExternal(url);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `url` | `string` | The URL to open. Must begin with `http://` or `https://` |

### Response

`void`

### Example

```ts
await window.electronAPI.openExternal('https://github.com/K3lvin4SY');
```

---

## `autowatch:start`

Start watching a project folder for file changes. When a change is detected, Bonsai waits for the configured debounce interval (default 10 s, adjustable per project via `settings:set` → `autoWatchDebounceMs`) before automatically creating a milestone. This prevents corruption from rapid saves (e.g. an application writing multiple files at once). Changes to internal bookkeeping directories (`.git`, `.app_data`, `.tmp`, `node_modules`) are ignored.

The watcher is **off by default** and must be explicitly enabled per project.

### Renderer call

```ts
const result = await window.electronAPI.autoWatchStart(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ status: 'success' | 'error'; error?: string }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "status": "success"
}
```

---

## `autowatch:stop`

Stop watching a project folder for file changes. Any pending debounce timer is cancelled.

### Renderer call

```ts
const result = await window.electronAPI.autoWatchStop(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "status": "success"
}
```

---

## `autowatch:status`

Check whether auto-watch is currently active for a project.

### Renderer call

```ts
const result = await window.electronAPI.autoWatchStatus(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
{ active: boolean }
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
{
  "active": true
}
```

---

## `autowatch:milestone-created`

Pushed from the main process to all renderer windows whenever the auto-watch system creates a milestone. The renderer uses this to refresh the project tree in real time.

This is **not** an invoke/handle channel — it uses `ipcMain → webContents.send()` / `ipcRenderer.on()`.

### Renderer listener

```ts
const cleanup = window.electronAPI.onAutoWatchMilestoneCreated(
  (projectPath, milestoneId) => {
    console.log(`Auto-save milestone ${milestoneId} created for ${projectPath}`);
  }
);

// Call cleanup() to unsubscribe
```

### Payload

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path of the project that was auto-saved |
| `milestoneId` | `string` | UUID of the newly created milestone |

### Example

```jsonc
// Payload sent by main process
["/home/user/city-poster", "f47ac10b-58cc-4372-a567-0e02b2c3d479"]
```

---

## `blacklist:get`

Retrieve the blacklist (list of ignored file/folder paths) for a project. Blacklisted items are completely excluded from Bonsai’s version tracking — no base copies, no xdelta3 patches, and they are added to `.gitignore`.

### Renderer call

```ts
const items = await window.electronAPI.blacklistGet(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
string[]   // Array of relative paths (e.g. ["renders", "archive/old-assets", "tmp-export.psd"])
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
["renders", "archive/old-assets", "tmp-export.psd"]
```

---

## `blacklist:set`

Replace the entire blacklist for a project. Persists the list in the project registry and regenerates `.gitignore` to include the blacklisted paths.

### Renderer call

```ts
const result = await window.electronAPI.blacklistSet(projectPath, items);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `items` | `string[]` | Array of relative paths to ignore (files and/or folders) |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
["/home/user/city-poster", ["renders", "archive/old-assets", "tmp-export.psd"]]

// Response
{
  "status": "success"
}
```

---

## `project:get-tags`

Get the list of custom tag definitions for a project. Tags are stored in the project's `global_registry.json` under `customTags`.

### Renderer call

```ts
const tags = await window.electronAPI.projectGetTags(projectPath);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |

### Response

```ts
Array<{ label: string; color: string }>
```

### Example

```jsonc
// Request args
["/home/user/city-poster"]

// Response
[
  { "label": "release", "color": "#22c55e" },
  { "label": "wip",     "color": "#f59e0b" },
  { "label": "draft",  "color": "#a855f7" }
]
```

---

## `project:set-tags`

Replace the entire custom tag list for a project. This is the single source of truth for which tags can be assigned to milestones in this project. Pass an empty array to clear all tags.

> **Note:** Removing a tag definition here does **not** remove it from milestones that already reference it — it simply becomes an orphaned label with no color mapping.

### Renderer call

```ts
const result = await window.electronAPI.projectSetTags(projectPath, tags);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `tags` | `Array<{ label: string; color: string }>` | Full replacement tag list |

### Response

```ts
{ status: 'success' | 'error' }
```

### Example

```jsonc
// Request args
[
  "/home/user/city-poster",
  [
    { "label": "release", "color": "#22c55e" },
    { "label": "wip",     "color": "#f59e0b" },
    { "label": "draft",  "color": "#a855f7" }
  ]
]

// Response
{
  "status": "success"
}
```
