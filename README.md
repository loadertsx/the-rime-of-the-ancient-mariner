# the-rime-of-the-ancient-mariner

> A [pi](https://pi.dev) package for knowledge tracking and agent memory — persistent session storage, read-only plan mode, and summarization tools for the pi coding agent.

---

## Overview

`the-rime-of-the-ancient-mariner` extends the pi coding agent with persistent, project-scoped memory backed by SQLite. It tracks session metadata, stores agent memories as JSON documents, enforces a native read-only plan mode, and provides tools for summarization and search. Built as a pi package, all extensions, prompts, and skills load directly at runtime.

## Features

| Feature | Description |
|---------|-------------|
| **Agent Memory Store** | Persist project-scoped key-value memories with JSON data via SQLite + Drizzle ORM |
| **Session Tracking** | Save and update session metadata with `update-info` command |
| **Typed Session Summaries** | Distill a session into `{title, description, context, sessionType, tags}` and merge into persistent memory |
| **Memory Library** | Search memories as you type, scope to the current project or all of them, read contents in a live preview pane, and insert any number into the LLM context |
| **Plan Mode** | Collaborative read-only planning through System Architecture, Program Design, and reviewable Vertical Slices |
| **Subagents** | Discover prompt-based subagents and run them in isolated pi processes |
| **Session Info** | Inspect session metadata (ID, file, name, CWD, entry count, leaf) |
| **Prompts & Skills** | Planning, isolated codebase research, exploration, understanding, and typed summary prompts; `save-summary` skill |

## Installation

```bash
# Install as a pi package
pi install the-ancient-mariner

# Or clone and link locally
git clone <repo-url>
cd the-rime-of-the-ancient-mariner
bun install
bun run build
```

The package declares its extensions, skills, prompts, and themes in `package.json` under the `"pi"` key. pi auto-discovers and loads them.

## Usage

Once installed, pi loads all extensions, skills, and prompts automatically. The following tools, commands, and skills become available:

### Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_memory` | Retrieve a specific memory by name | `project: string`, `name: string` |
| `list_memories` | List all stored memories for a project | `project: string` |
| `save_session_summary` | Persist a typed session summary into the session's memory row | `title: string`, `description: string`, `context: string`, optional `sessionType`, `tags` |
| `insert_memories` | Insert selected memories into the current LLM context | `memories: { projectName, memoryName }[]` |
| `get_current_session` | Return current pi session metadata | _(none)_ |
| `count_lines` | Count lines in a file | `path: string` |
| `list_available_subagents` | List loaded `subagent-*` prompt templates and their authoritative paths | _(none)_ |
| `subagent_execute` | Run a discovered prompt in an isolated pi process with mode-appropriate tools | `promptPath: string`, `task: string` |

`subagent_execute` accepts only paths returned by `list_available_subagents`. Normally its child process has the full built-in coding tool set (`read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`). In native plan mode, subagents remain available but the child receives only native read-only tools (`read`, `grep`, `find`, and `ls`); `bash`, `edit`, and `write` are omitted. Cancelling the parent tool terminates the child process; failed children report their exit code and prefer `stderr` diagnostics, falling back to `stdout` when needed.

Supported `sessionType` values are `implementation`, `code-exploration`, `implementation-exploration`, `code-understanding`, and `mixed`.

### Commands

| Command | Description |
|---------|-------------|
| `/update-info` | Update the current session's stored memory in place |
| `/recent-memories` | Open the searchable memory library and send selected memories to the LLM |
| `/session-info` | Print current session metadata (ID, file, name, CWD, entries) |
| `/plan-mode [on\|off\|toggle\|status]` | Toggle native read-only plan mode |
| `/subagents` | Toggle subagent tools and persist the choice for future sessions in the current cwd |
| `--subagents` | Force-enable subagent tools for the current session without changing the saved choice |
| `Shift+Tab` | Toggle native read-only plan mode, if `Shift+Tab` is not already bound to a built-in pi action |
| `--with-plan` (flag) | Start pi with plan mode enabled from the start |

Subagent preferences use Pi's exact absolute cwd: subdirectories, worktrees, and symlink paths have independent choices. A cwd without a saved preference starts disabled; the former global preference is not inherited.

### Memory Library

Use `/recent-memories` to open the memory library: an overlay with a search field, a scrolling result list, and a live preview of whatever memory the cursor is on. There are no modes to switch between — typing always searches, and the preview always follows the cursor. On wide terminals the preview sits beside the list; on narrow ones it moves below it. The dialog sizes itself to the terminal on every render, so it fills a tall window and stays intact in a short one.

The library opens scoped to the current project when that project has memories, and `Shift+Tab` widens it to every project.

| Key | Action |
|-----|--------|
| *any character* | Search by memory name, project, description, or tag |
| `↑` / `↓` | Move through results |
| `PgUp` / `PgDn` | Move a page at a time |
| `Tab` | Check or uncheck the focused memory |
| `Shift+Tab` | Switch between the current project and all projects |
| `Shift+↑` / `Shift+↓` | Scroll the preview pane (`Alt` also works) |
| `Enter` | Insert the checked memories, or the focused one when nothing is checked |
| `Esc` | Cancel |

Checked memories stay checked while you search and change scope, so a selection can be assembled from several queries. Search requires every space-separated token to appear in a memory; a single token that matches nothing literally falls back to fuzzy matching, so `authref` still finds `auth-refactor`.

The dialog loads the newest 500 memories and searches within them; when the store is larger, the scope row shows both counts. Navigation keys follow pi's keybindings, so rebinding `tui.select.*` rebinds them here too.

Submitted memories are formatted with the same context renderer used by the `insert_memories` tool and sent as a `memories` custom message. Inserted context includes `sessionType`, `tags`, `cwd`, `title`, `description`, and `context` when present. Preview text is formatted separately for human-readable browsing and does not change what gets inserted into the LLM context.

### Plan Mode

Plan mode is a native read-only mode that blocks all filesystem writes, code edits, config changes, and unsafe bash commands. Its compact internal prompt guides the human and agent through System Architecture, Program Design, and end-to-end Vertical Slices, with explicit alignment checkpoints between phases. The final plan requires implementation to stop after every slice for human review. The agent can only use read-only tools (`read`, `grep`, `find`, `ls`, safe `bash` commands, etc.) and must call `plan_exit` to request user approval before leaving.

The extension registers `Shift+Tab` as a shortcut for toggling plan mode. In default pi, `Shift+Tab` is already bound to `app.thinking.cycle`, so users who want the plan-mode shortcut must remap that built-in action in `~/.pi/agent/keybindings.json` to avoid a collision:

```json
{
 "app.clipboard.pasteImage": "ctrl+v",
 "app.thinking.toggle": "ctrl+r",
 "app.thinking.cycle": "ctrl+t"
}
```

After editing the file, run `/reload` in pi. With the example above, `Shift+Tab` toggles plan mode, `Ctrl+T` cycles thinking level, `Ctrl+R` hides/shows thinking blocks, and `Ctrl+V` keeps the default paste-image behavior on macOS.

**Blocked operations in plan mode:**

- All file writes (`edit`, `write`)
- Destructive bash (`rm`, `mv`, `mkdir`, `git commit`, `npm install`, etc.)
- Package managers, editors, system control commands

**Allowed operations in plan mode:**

- `read`, `grep`, `find`, `ls`, `bash` (read-only subset), `question` / `questionnaire` when available, `list_available_subagents`, `subagent_execute`, `plan_exit`
- Plan-mode subagents run with `read`, `grep`, `find`, and `ls`; they do not receive `bash`, `edit`, or `write`
- Safe parent-session bash: `cat`, `head`, `tail`, `grep`, `find`, `ls`, `git status/log/diff`, `curl`, `jq`, `rg`, `fd`, etc.

### Skills

| Skill | Description |
|-------|-------------|
| `save-summary` | Triggered via `/save-summary` — classifies the session type, distills title/description/context/tags, and persists via `save_session_summary` |
| `plan-design-guide` | Detailed planning artifacts: architecture diagrams, call stacks, file trees, contracts, vertical slices, and approval checkpoints |

### Prompts

| Prompt | Description |
|--------|-------------|
| `subagent-codebase-search.md` | Isolated read-only research handoff with optional architecture, program-design, and focused code excerpts |
| `explore-codebase.md` | Read-only `code-exploration` workflow for codebase orientation |
| `explore-implementation.md` | Read-only `implementation-exploration` workflow for comparing approaches before coding |
| `understand-code.md` | Read-only `code-understanding` workflow for explaining existing modules, flows, APIs, or behavior |
| `save-summary.md` | Guides the agent to classify and persist a typed session summary |

## Architecture

The repo has two distinct execution surfaces:

```
the-rime-of-the-ancient-mariner/
├── src/                    # Domain layer (compiled by tsc → dist/)
│   ├── memory/             # Knowledge store: schema, repository, catalog, previews
│   │   ├── schema.ts       # Drizzle schema (projects, agent_memories tables)
│   │   ├── types.ts        # Public type re-exports
│   │   ├── repository.ts   # MemoryRepository: persistence-only table access
│   │   ├── catalog.ts      # MemoryCatalog: recent-memory browsing projections
│   │   └── preview.ts      # Human-readable preview formatting for the memory library UI
│   ├── session/
│   │   ├── info.ts         # getSessionInfo(ctx) — session metadata extraction
│   │   └── memory.ts       # SessionMemory: current-session memory operations
│   ├── plan-mode/
│   │   ├── session.ts      # PlanModeSession: openPlanModeSession()
│   │   ├── prompt.ts       # Template rendering helpers
│   │   └── bash-safety.ts  # Read-only bash command validation
│   ├── subagents/
│   │   └── subagents-orchestrator.ts # Prompt discovery and full-tool subagent execution
│   ├── ui/
│   │   └── memory-browser.ts # Searchable memory library dialog
│   └── db/
│       └── connection.ts   # openDb() — internal sqlite + Drizzle + auto-migration
├── extensions/             # pi extensions (runtime-loaded, NOT compiled)
│   ├── lifecycle.ts        # session_start + resources_discover events
│   ├── memory-extension.ts # Memory tools + update-info command
│   ├── session-extension.ts# Session info tool + command
│   ├── subagents-extension.ts # Subagent discovery and execution tools
│   └── plan-mode.ts        # Plan mode tool, command, flag, and hooks
├── skills/                 # pi skills (Markdown)
│   └── save-summary.md
├── prompts/                # pi prompt templates (Markdown)
│   ├── subagent-codebase-search.md
│   ├── explore-codebase.md
│   ├── explore-implementation.md
│   ├── understand-code.md
│   └── save-summary.md
├── resources/              # Internal extension resources (not pi prompt templates)
│   └── plan-system.md      # Compact plan-mode system prompt
├── migrations/             # Drizzle-generated SQL migrations
└── dist/                   # Compiled output (gitignored, vestigial)
```

**Key principle:** Business logic lives in `src/` behind named interfaces. Extensions in `extensions/` register tools, commands, and event handlers with pi, delegating all logic to `src/`. Extensions import `.ts` files directly because pi loads them at runtime without `tsc`.

## Persistence

Data is stored in a global SQLite database (default: `~/.pi/agent/the-ancient-mariner/rime-ancient-mariner.db`) with auto-migration on first access.

### Schema

| Table | Columns | Notes |
|-------|---------|-------|
| `projects` | `id`, `name` (unique), `created_at` | One row per project directory |
| `agent_memories` | `id`, `name`, `project_id` (FK → projects), `created_at`, `updated_at`, `data` (JSON) | Memories are unique per (project, name); cascade-deletes with project |

### Memory APIs

```ts
const repository = openMemoryRepository(); // Auto-opens DB, runs migrations
const catalog = createMemoryCatalog(repository);

repository.createMemory("my-project", "session-001", { summary: "..." });
repository.updateMemory("my-project", "session-001", { summary: "updated" });
repository.findMemory("my-project", "session-001");
repository.listMemories("my-project");
catalog.listRecentMemories(5, 0); // newest first, paged, includes session type, tags + preview text
repository.countMemories();
```

Reads do not create project rows; writes create project rows only when needed through `ensureProject()` inside the repository.

## Development

### Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run build` | Compile `src/` → `dist/` via `tsc` |
| `bun run lint` | Biome linter check |
| `bun run lint:fix` | Biome linter + auto-fix |
| `bun run format` | Biome formatter |
| `bun run db:generate` | Generate Drizzle migration from schema changes |
| `bun run db:studio` | Open Drizzle Studio against the global ancient-mariner DB |

### Local Testing

Create `.pi/extensions/index.ts` (gitignored) as a dev harness:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import lifeCycleExtension from "../../extensions/lifecycle.ts";
import memoryExtension from "../../extensions/memory-extension.ts";
import sessionExtension from "../../extensions/session-extension.ts";
import planModeExtension from "../../extensions/plan-mode.ts";
import subAgentsExtension from "../../extensions/subagents-extension.ts";

export default function (pi: ExtensionAPI) {
 sessionExtension(pi);
 memoryExtension(pi);
 lifeCycleExtension(pi, { discoverResources: true });
 subAgentsExtension(pi);
 planModeExtension(pi);
}
```

Then run pi with:

```bash
pi --extension .pi/extensions/index.ts
```

### Schema Change Workflow

1. Edit `src/memory/schema.ts`
2. Run `bun run db:generate`
3. Commit the new migration file alongside the schema change
4. The DB auto-migrates on next `openMemoryRepository()` call

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5.8+ (ES2022, strict mode) |
| Runtime / Bundler | Bun |
| Package SDK | `@earendil-works/pi-coding-agent` |
| Validation / Schemas | [TypeBox](https://github.com/sinclairzx81/typebox) |
| Local DB | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (sync) |
| ORM / Migrations | [Drizzle ORM](https://orm.drizzle.team/) + drizzle-kit |
| Lint & Format | [Biome](https://biomejs.dev/) 1.9.4 |
| Git Hooks | Husky + lint-staged |

## License

ISC
