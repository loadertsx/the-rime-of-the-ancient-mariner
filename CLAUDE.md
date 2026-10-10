# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the deeper agent-facing reference (conventions, dependencies, examples). This file captures only the high-signal context for getting productive quickly.

## What this repo is

`the-ancient-mariner` is a **pi package** — a plugin for the [pi coding agent](https://pi.dev). It extends pi with tools, commands, event handlers, skills, and prompts. The MVP target (`docs/mvp.md`) is knowledge tracking: detecting stale code, storing summaries, and enabling search/retrieval over agent memories.

## Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run build` | Compile `src/` → `dist/` via `tsc` (declarations + source maps) |
| `bun run lint` | Biome check |
| `bun run lint:fix` | Biome check + auto-fix |
| `bun run format` | Biome format |
| `bun run db:generate` | Emit a new Drizzle migration into `migrations/` from `src/memory/schema.ts` |
| `bun run db:studio` | Open Drizzle Studio against the global ancient-mariner DB |

There is **no test framework configured**. Verify changes by building, linting, and exercising extensions inside pi.

## Architecture

This repo has **two distinct execution surfaces**, which is the most important thing to understand before editing:

1. **`src/`** — domain layer. Compiled to `dist/` by `tsc` (`tsconfig.json` sets `rootDir: ./src`). Holds reusable logic that extensions delegate to: `src/memory/` (knowledge store), `src/session/` (session metadata), `src/db/` (sqlite connection, internal). Relative imports in compiled output need `.js` suffixes per ESM + NodeNext.

2. **`extensions/`, `skills/`, `prompts/`, `themes/`** — consumed by pi **at runtime** via the paths declared in `package.json` under the `"pi"` key. These are **not** built by `tsc`; pi loads the `.ts` files directly, so extension imports of `../src/**/*.ts` never go through the TypeScript compiler.

Rule of thumb: business logic lives in `src/`, behind named interfaces. Extension files register tools/commands/events and delegate to `src/`.

### Extension shape

Every extension file exports a default function that receives `ExtensionAPI` and registers tools / commands / event handlers:

```ts
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name, parameters: Type.Object({...}), async execute(...) {...} });
  pi.registerCommand("name", { handler: async (args, ctx) => {...} });
  pi.on("session_start", async (event, ctx) => {...});
}
```

Canonical examples: `extensions/memory-extension.ts` (tool registration), `extensions/lifecycle.ts` (event handlers), `extensions/session-extension.ts` (tool + command sharing logic from `src/session/info.ts`). Tool parameter schemas use **TypeBox** (`typebox`), not Zod. Use plain `async`/`await` — no Effect-TS at the extension boundary.

### Persistence layer

- `src/memory/schema.ts` — Drizzle schema (internal to the memory module). Tables: `projects` (unique `name`) and `agent_memories` (JSON `data`, FK to `projects` with cascade delete). Exports inferred row types and `AgentMemoryData`.
- `src/memory/types.ts` — public type re-exports for consumers.
- `src/memory/repository.ts` — `MemoryRepository` owns persistence-only operations. Reads use `findProject()` and never create rows; writes use `ensureProject()` when a parent project row is needed. Extensions never touch Drizzle directly.
- `src/memory/catalog.ts` — `MemoryCatalog` owns browsing projections such as recent-memory previews.
- `src/db/connection.ts` — `openDb(path)` opens `better-sqlite3`, wraps in Drizzle, and **runs migrations automatically** before returning. Internal; only `memory/repository.ts` imports it.
- Schema change workflow: edit `src/memory/schema.ts` → `bun run db:generate` → commit the new migration alongside the schema change.
- Default DB file: `~/.pi/agent/the-ancient-mariner/rime-ancient-mariner.db`. Override with `THE_ANCIENT_MARINER_DB_PATH` if needed.

## Conventions & gotchas

- **ESM only** (`"type": "module"`). Source is TypeScript, compiled output is `.js`.
- **Biome** enforces tabs, double quotes, semicolons, trailing commas, 100-char lines. Pre-commit hook (Husky + lint-staged) runs `biome check --write` on staged `*.{js,ts,json,md}`.
- **Do not commit** `dist/` or `node_modules/` (both gitignored).

## Local Testing

The `.pi/extensions/` directory is gitignored — each developer creates it locally.

Create `.pi/extensions/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import lifeCycleExtension from "../extensions/lifecycle.ts";
import memoryExtension from "../extensions/memory-extension.ts";
import sessionExtension from "../extensions/session-extension.ts";
import planModeExtension from "../extensions/plan-mode.ts";

export default function (pi: ExtensionAPI) {
	sessionExtension(pi);
	memoryExtension(pi);
	lifeCycleExtension(pi);
	planModeExtension(pi);
}
```

Then run pi loading just that entrypoint:

```bash
pi --extension .pi/extensions/index.ts
```

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Nahuelluca20/the-rime-of-the-ancient-mariner`, accessed via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
