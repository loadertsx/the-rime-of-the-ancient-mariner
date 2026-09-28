# Local Development & Testing

## Setup

```bash
git clone <repo-url>
cd the-ancient-mariner
bun install
```

## Local Testing with pi

The `.pi/extensions/` directory is **gitignored** — each developer creates it locally. It aggregates all extensions into a single entrypoint for pi to load during development.

Create `.pi/extensions/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import lifeCycleExtension from "../../extensions/lifecycle.ts";
import memoryExtension from "../../extensions/memory-extension.ts";
import sessionExtension from "../../extensions/session-extension.ts";
import planModeExtension from "../../extensions/plan-mode.ts";
import subAgentsExtension from "../../extensions/subagents-extension.ts";
import tasksExtension from "../../extensions/tasks-extension.ts";

export default function (pi: ExtensionAPI) {
 sessionExtension(pi);
 memoryExtension(pi);
 lifeCycleExtension(pi, { discoverResources: true });
 subAgentsExtension(pi);
 planModeExtension(pi);
 tasksExtension(pi);
}
```

Then run pi loading just that entrypoint:

```bash
pi --extension .pi/extensions/index.ts
```

## How It Works

- **`extensions/`** — the production extension files, declared in `package.json` → `"pi"."extensions"`. These are what users get when they install the package.
- **`package.json["pi"].skills` and `package.json["pi"].prompts`** — the production source of skills and prompt templates for installed package usage.
- **`.pi/extensions/index.ts`** — a local dev harness that re-exports all extensions from a single file. This lets you load everything with one `--extension` flag during development.
- **`lifeCycleExtension(pi, { discoverResources: true })`** — local-only resource discovery. This makes prompts and skills available when using `pi --extension .pi/extensions/index.ts`, because that mode loads only the extension entrypoint and not the package manifest resources.
- **`.pi/` is gitignored** — it never ships to users and is never committed.

When you add a new extension file, remember to add its import to `.pi/extensions/index.ts`.

Do **not** enable `discoverResources` in package/production loading. The installed package already declares `skills/` and `prompts/` in `package.json`; enabling both would load the same prompt templates twice and produce `[Prompt conflicts]` warnings.

## Plan Mode Shortcut and Keybinding Collision

The plan-mode extension registers `Shift+Tab` to toggle `/plan-mode`. Default pi uses `Shift+Tab` for `app.thinking.cycle`, and pi skips extension shortcuts that collide with reserved built-in keybindings.

For local testing, remap the built-in thinking shortcuts in `~/.pi/agent/keybindings.json` before expecting `Shift+Tab` to toggle plan mode:

```json
{
 "app.clipboard.pasteImage": "ctrl+v",
 "app.thinking.toggle": "ctrl+r",
 "app.thinking.cycle": "ctrl+t"
}
```

Run `/reload` in pi after changing keybindings. This keeps `Ctrl+V` for paste-image on macOS, uses `Ctrl+T` to cycle thinking level, and frees `Shift+Tab` for plan mode.

## Implementation Tasks

`update_plan` publishes a complete task snapshot with stable IDs, English titles, and statuses (`pending`, `in_progress`, `done`, `blocked`). An empty list clears the widget. It updates session metadata only and is available during plan mode without enabling project writes.

The English checkbox preview appears above the editor and remains visible during implementation. `/tasks` opens the complete read-only list. State follows the active session branch; completed tasks remain visible until cleared or replaced.

After `/reload`, ask the agent to publish a short task list, change one status, and clear it. Also check a long list in a short/narrow terminal, resume the session, and navigate to an earlier branch to verify restoration. Plan approval should preserve the tasks and no longer request a pause after each task.

## Verification

| Step | Command |
|------|---------|
| Build | `bun run build` |
| Lint | `bun run lint` |
| DB migrations | `bun run db:generate` |
| Interactive test | `pi --extension .pi/extensions/index.ts` |
