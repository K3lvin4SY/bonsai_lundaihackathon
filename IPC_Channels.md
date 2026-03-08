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
| [`milestone:create-initial`](#milestonecreateinitial) | `milestoneCreateInitial()` | Renderer → Main |
| [`milestone:create`](#milestonecreate) | `milestoneCreate()` | Renderer → Main |
| [`milestone:restore`](#milestonerestore) | `milestoneRestore()` | Renderer → Main |
| [`milestone:delete`](#milestonedelete) | `milestoneDelete()` | Renderer → Main |
| [`autowatch:start`](#autowatchstart) | `autoWatchStart()` | Renderer → Main |
| [`autowatch:stop`](#autowatchstop) | `autoWatchStop()` | Renderer → Main |
| [`autowatch:status`](#autowatchstatus) | `autoWatchStatus()` | Renderer → Main |
| [`autowatch:milestone-created`](#autowatchmilestone-created) | `onAutoWatchMilestoneCreated()` | Main → Renderer |
| [`settings:get`](#settingsget) | `settingsGet()` | Renderer → Main |
| [`settings:set`](#settingsset) | `settingsSet()` | Renderer → Main |

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
  createdAt: string;            // ISO 8601 timestamp
  lastMilestoneAt: string | null;  // ISO 8601 or null if no milestones
  milestoneCount: number;
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
    "milestoneCount": 5
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
const result = await window.electronAPI.milestoneCreateInitial(projectPath, message);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory (binary files are scanned from here) |
| `message` | `string` | Description for the initial milestone |

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
const result = await window.electronAPI.milestoneCreate(projectPath, message);
```

### Parameters

| Name | Type | Description |
|---|---|---|
| `projectPath` | `string` | Absolute path to the project root directory |
| `message` | `string` | Description for this milestone |

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

## Common Types Reference

### `ProjectSummary`

Returned by `project:list`. One entry per registered project.

```ts
interface ProjectSummary {
  id: string;                    // UUID
  name: string;                  // Human-readable name
  projectPath: string;           // Absolute filesystem path
  createdAt: string;             // ISO 8601 timestamp
  lastMilestoneAt: string | null;  // ISO 8601 or null
  milestoneCount: number;        // Total milestones in the project
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
}
```

### `MilestoneRecord`

Full milestone data (stored in `.app_data/metadata.json`).

```ts
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
| `launchToTray` | `boolean` | `false` | When true, Bonsai starts minimized to the system tray instead of showing the main window |

---

## `autowatch:start`

Start watching a project folder for file changes. When a change is detected, Bonsai waits 10 seconds after the last change before automatically creating a milestone. This debounce prevents corruption from rapid saves (e.g. an application writing multiple files at once). Changes to internal bookkeeping directories (`.git`, `.app_data`, `.tmp`, `node_modules`) are ignored.

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
