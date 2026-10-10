# Changelog

## Unreleased

## [0.2.0] - 2026-10-10

### Added

- Prompt-based subagents with `list_available_subagents` and `subagent_execute`, plus a `subagent-codebase-search` prompt for isolated codebase research.
- Validated subagent prompt paths, isolated pi child processes, cancellation support, bounded output, failure diagnostics, and notifications when execution starts. Subagents use the full built-in coding tool set outside plan mode.
- `/subagents` runtime toggle, an on/off status indicator, and `--subagents` to enable subagents for the current session without changing the saved preference.
- Persistent subagent availability per exact project cwd. New directories default to disabled; subdirectories, worktrees, and symlink paths have independent preferences, and the former global preference is not inherited.
- `Shift+Tab` shortcut to toggle plan mode and a custom editor border for its active state.
- Collaborative planning with explicit System Architecture and Program Design approval checkpoints, plus a `plan-design-guide` skill for detailed planning artifacts.
- Session-backed implementation task tracking through `update_plan`, with stable IDs, English titles, and `pending`, `in_progress`, `done`, and `blocked` statuses.
- Responsive task progress widget, read-only `/tasks` browser, task restoration on session/branch changes, and task context injection. Tracking does not approve plans or enable writes.
- Unit and SQLite integration test suites, `test`, `test:unit`, and `test:integration` scripts, and test execution in the pre-commit hook.

### Changed

- Replaced the paginated `/recent-memories` picker with a searchable memory library featuring live previews, current-project/all-project scoping, and multi-selection preserved across searches.
- Added token-based search over memory names, projects, descriptions, and tags, with single-token fuzzy fallback. The library searches the newest 500 memories and shows loaded/total counts when applicable.
- Made the memory browser responsive to terminal dimensions, with side-by-side or stacked previews, pi keybindings, and live theme updates.
- Split memory persistence, browsing projections, and library use cases into `MemoryRepository`, `MemoryCatalog`, and `MemoryLibrary`; moved session memory operations into `SessionMemory`.
- Replaced the legacy search-only subagent runner with a shared prompt-discovery and execution orchestrator, and added guidance to delegate matching tasks to available subagents.
- Renamed the plan-mode startup flag from `--plan` to `--with-plan`; the old flag is no longer accepted.
- Replaced the `/plan` prompt template with a compact internal plan-mode system prompt, moving detailed planning guidance into the `plan-design-guide` skill.
- Replaced Mermaid diagrams with plain-text visuals in planning and research guidance.
- Replaced vertical slices and per-slice review gates with dependency-ordered implementation tasks and review after the full approved plan is implemented.

### Fixed

- Prevented loading or recalling memories from triggering session-summary saves; saving requires an explicit user request.
- Kept subagent discovery and execution available in plan mode while restricting child sessions to native read-only tools.
- Deferred plan-exit confirmation until the agent settles, then restored write-capable tools and automatically started approved implementation in a follow-up turn.
- Clarified that final plan approval authorizes all its tasks: update progress and continue without per-task approval, pausing only when findings require changes to the approved design or scope.

### Documentation

- Documented the searchable memory library, subagent tools and cwd-scoped preferences, and local extension setup.
- Added plan-mode keybinding setup instructions, including remapping pi's conflicting default `Shift+Tab` binding.
- Updated agent architecture guidance and added domain and issue-tracker documentation.

## [0.1.1] - 2026-06-07

### Fixed

- Moved the default memory database to the global pi agent directory.
- Restricted lifecycle prompt and skill discovery to local development to avoid duplicate package resources.

## [0.1.0] - 2026-06-03

Initial development snapshot covering work from 2026-05-18 to 2026-06-03.

### Added

- Initial pi package structure with TypeScript, Bun, Biome, Husky, and lint-staged setup.
- Local SQLite persistence using `better-sqlite3`, Drizzle ORM, Drizzle migrations, and DB scripts.
- `projects` and `agent_memories` tables for project-scoped JSON memories.
- Memory domain layer with lazy cached store initialization, project creation, memory creation, updates, reads, listing, recent-memory queries, and batch retrieval.
- Session metadata support via `get_current_session` tool and `/session-info` command.
- Memory/session commands including `/save-info` and `/update-info`.
- Memory tools: `get_memory`, `list_memories`, `save_session_summary`, and `insert_memories`.
- `save-summary` skill and prompt for persisting durable session summaries.
- Typed session summaries with `sessionType` and `tags`; supported types are `implementation`, `code-exploration`, `implementation-exploration`, `code-understanding`, and `mixed`.
- Native read-only plan mode with `/plan-mode`, `--plan`, `plan_exit`, read-only tool enforcement, unsafe bash blocking, status/widget UI, and session-state restoration.
- Read-only exploration and understanding prompts: `explore-codebase`, `explore-implementation`, and `understand-code`.
- Memory context injection that formats selected memories into a single steer message.
- `/recent-memories` picker with paginated selection, insertion into LLM context, preview mode, scrollable previews, session-type badges, and Vim-style navigation keys.

### Changed

- Replaced the early Effect-TS extension example with plain async/await plus TypeBox schemas.
- Split implementation into a compiled `src/` domain layer and thin runtime-loaded `extensions/`.
- Moved DB code from `db/` into `src/db/` and memory schema/types/store into `src/memory/`.
- Updated extension imports to use `.ts` runtime imports for pi-loaded extension files.
- Refined plan mode after design review by documenting bash-safety limitations, tightening tool restoration, and simplifying `plan_exit` details.
- Aligned `prompts/plan.md` with native plan mode: plans stay in chat while write tools are blocked.
- Refactored memory retrieval to batch through `store.getMemories`.
- Changed inserted memory context from one message per memory to one formatted `memories` message.
- Expanded context rendering to include `sessionType`, `tags`, `cwd`, `title`, `description`, and `context` when present.
- Updated memory previews to use a human-readable field order for typed summaries.
- Evolved `/recent-memories` from a basic table into an interactive picker with pagination, selection, preview, and keyboard navigation.
- Made `save-summary` adaptive by classifying session type before writing the summary.

### Fixed

- Wrapped `insert_memories` parameters in `Type.Object` so tool schemas are object-shaped for provider compatibility.
- Made Husky `prepare` tolerant with `husky || true`.

### Documentation

- Added project README covering features, usage, architecture, persistence, plan mode, recent memories, prompts, skills, and development workflow.
- Added local development/testing documentation for the `.pi/extensions/index.ts` harness.
- Updated agent guidance in `AGENTS.md` and `CLAUDE.md` as the architecture moved from examples to the memory/domain-layer design.
- Documented the recent memory picker, preview mode, inserted context format, keyboard shortcuts, and session-type badges.
