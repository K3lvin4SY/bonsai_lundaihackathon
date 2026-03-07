# Bonsai — Frontend Prompt (Active Milestone Edition)

**Role & Tech Stack:**
You are an expert frontend engineer building "Bonsai", a modern, sleek desktop application UI for visual version control.
Tech stack: React, TypeScript, Tailwind CSS, Vite, Shadcn UI, Tabler Icons. Ensure a seamless Dark/Light mode toggle.

**Aesthetic/Design Inspiration:**
Native macOS/Windows feel, inspired by Linear, Vercel, and GitHub Desktop. Deep slate/zinc for dark mode, crisp white/gray for light mode. Primary accent color: electric blue or vibrant purple. Minimalist, smooth transitions, subtle borders.

---

## Technical Requirement (Crucial Electron IPC Abstraction)

Create a `lib/api.ts` file to mock our Electron backend. Use the following exact TypeScript interfaces:

```typescript
export interface ProjectSummary { id: string; name: string; projectPath: string; createdAt: string; lastMilestoneAt: string | null; milestoneCount: number; }
export interface TreeNode { milestoneId: string; message: string; commitHash: string; branch: string; createdAt: string; children: TreeNode[]; }
export interface MilestoneRecord { milestoneId: string; message: string; commitHash: string; branch: string; parentMilestoneId: string | null; patchFiles: string[]; createdAt: string; }
export interface ProjectTreeResponse { tree: TreeNode[]; branches: string[]; milestones: MilestoneRecord[]; activeMilestoneId: string | null; }
```

Expose these async methods. If `window.electronAPI` exists, call it. Otherwise, return realistic mock data shaped exactly like the interfaces above, using `setTimeout` (1.5s) to simulate heavy binary diffing:

- `projectCreate(projectPath: string, name: string)`
- `projectDelete(projectPath: string)`
- `projectList()` -> returns `ProjectSummary[]`
- `projectTree(projectPath: string)` -> returns `ProjectTreeResponse`
- `milestoneCreateInitial(projectPath: string, targetPath: string, message: string)`
- `milestoneCreate(projectPath: string, message: string)`
- `milestoneRestore(projectPath: string, milestoneId: string)`
- `milestoneDelete(projectPath: string, milestoneId: string)`

### Common Types Reference

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

interface ProjectTreeResponse {
  tree: TreeNode[];
  branches: string[];
  milestones: MilestoneRecord[];
  activeMilestoneId: string | null;
}
```

---

## IPC Channel Reference

All backend calls go through `window.electronAPI.<method>()`. Every method is **async** and returns a `Promise`. Use these exact method names in `lib/api.ts` — they map directly to the backend handlers.

| Preload method | When to call it |
| --- | --- |
| `projectCreate()` | User submits the Create Project modal |
| `projectDelete()` | User confirms deletion via the context menu |
| `projectList()` | App load, dashboard mount, after any create/delete |
| `projectTree()` | Project workspace mount, after any milestone action |
| `milestoneCreateInitial()` | *(handled internally — the backend calls this on first save; the UI only calls `milestoneCreate`)* |
| `milestoneCreate()` | User clicks "Create Milestone" in the top bar |
| `milestoneRestore()` | User clicks "Restore to this state" in the Milestone Panel |
| `milestoneDelete()` | User clicks "Delete Milestone" in the Milestone Panel |

### `projectCreate`

Creates a new project and registers it so it appears on the dashboard.

- **Call:** `await window.electronAPI.projectCreate(projectPath, name)`
- **Parameters:** `projectPath` (string, absolute path chosen by user), `name` (string, display name)
- **Response:** `{ id: string; status: 'success' | 'error' }`
- **UI:** Show a loading spinner in the modal. On success, close modal and refresh the project list. On error, show an inline error message.

### `projectDelete`

Permanently deletes a project and all its history.

- **Call:** `await window.electronAPI.projectDelete(projectPath)`
- **Parameters:** `projectPath` (string, absolute path)
- **Response:** `{ status: 'success' | 'error' }`
- **UI:** Always confirm with an alert dialog before calling. On success, remove the card from the dashboard immediately.

### `projectList`

Returns all projects registered with Bonsai for display on the dashboard.

- **Call:** `await window.electronAPI.projectList()`
- **Parameters:** *None.*
- **Response:** `Array<ProjectSummary>`
- **UI:** Call on dashboard mount. Render each result as a project card. Show empty state if the array is empty.

### `projectTree`

Returns the complete milestone graph for a project — the primary data source for the canvas.

- **Call:** `await window.electronAPI.projectTree(projectPath)`
- **Parameters:** `projectPath` (string)
- **Response:** `{ tree: TreeNode[]; branches: string[]; milestones: MilestoneRecord[]; activeMilestoneId: string | null; }`
- **UI:** Call on workspace mount and after every milestone action. Use `tree` to render the React Flow graph. Use `activeMilestoneId` to highlight the current node with a glowing accent ring.

### `milestoneCreate`

Saves the current state of the project as a new named milestone. The backend handles whether this is the first milestone or a subsequent one — the UI always calls this single method.

- **Call:** `await window.electronAPI.milestoneCreate(projectPath, message)`
- **Parameters:** `projectPath` (string), `message` (string, user-provided label)
- **Response:** `{ milestoneId: string }`
- **UI:** Show a loading spinner on the "Create Milestone" button for the full duration — this can take several seconds for large files. On success, refresh the project tree. On error, show a toast notification.

### `milestoneRestore`

Restores the project's working files to exactly the state they were in at the selected milestone.

- **Call:** `await window.electronAPI.milestoneRestore(projectPath, milestoneId)`
- **Parameters:** `projectPath` (string), `milestoneId` (string)
- **Response:** `{ status: 'success' | 'error' }`
- **UI:** Show a loading spinner on the "Restore" button. This is a destructive action — optionally confirm first. On success, refresh the project tree so the active node indicator updates.

### `milestoneDelete`

Deletes a milestone and its saved data. A milestone with children cannot be deleted.

- **Call:** `await window.electronAPI.milestoneDelete(projectPath, milestoneId)`
- **Parameters:** `projectPath` (string), `milestoneId` (string)
- **Response:** `{ status: 'success' | 'error' }`
- **UI:** The "Delete Milestone" button must be disabled when the selected node has children (i.e. `children.length > 0` on the `TreeNode`). Confirm with an alert dialog before calling. On success, close the panel and refresh the tree.

---

## Core Views & Layout

### 1. Global Layout & App Settings

- **Sidebar:** A permanent, thin left sidebar containing icons for 'Home/Dashboard', a '+' button for New Project, and a 'Settings' gear at the bottom.
- **Global Settings Page:** Clicking the gear opens a dedicated view. Include functional UI toggles for Dark/Light mode, a text input for "Default Save Directory", and a toggle for "Launch quietly in System Tray".

### 2. Dashboard (Home)

- This is the default screen. Show a grid/list of `ProjectSummary` cards. Include a Context Menu to delete a project (calls `projectDelete`).
- **Empty State:** If no projects exist, display a friendly, prominent "Create your first project" call-to-action.
- **Create Project Modal:** Triggered by the '+' button or Empty State. Inputs: Project Name, simulated OS File/Folder Picker. Include two UI Toggles: "Enable Binary Optimization (xdelta3)" (with a small info tooltip) and "Auto-watch for changes vs. Manual Milestones". Calls `projectCreate` on submit.

### 3. Project Workspace (The Core Canvas)

- **Top Bar:** Displays Project Name, the current active milestone name, a "Project Settings" icon, and a prominent 'Create Milestone' button (shows a loading spinner when clicked).
- **Project Settings Modal:** Accessed from the Top Bar. Allows adjusting the "Auto-watch vs Manual" toggle specifically for this project.
- **Main Canvas (React Flow):** Must be a pannable, zoomable canvas. Render a horizontal tree graph (left-to-right) mapped from `TreeNode[]`.
- **Custom Nodes:** Sleek, rounded cards showing the `message` and timestamp. The node whose `milestoneId` matches the `activeMilestoneId` from `projectTree` MUST have a glowing accent ring (e.g., `ring-2 ring-primary`). Connect nodes with smooth bezier edges.

### 4. Milestone Context Panel

- Clicking a React Flow node slides in a right-hand side-panel (Shadcn Sheet).
- Displays `MilestoneRecord` details (Timestamp, Hash, Branch) AND a mocked "Patch Size" (e.g., "45 MB").
- Primary Button: 'Restore to this state' (calls `milestoneRestore` with spinner).
- Destructive Button: 'Delete Milestone' (calls `milestoneDelete`, disabled if node has children).

---

Please generate the full React application adhering strictly to these IPC contracts and visual guidelines.
