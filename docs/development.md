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
import voiceExtension from "../../extensions/voice-extension.ts";

export default function (pi: ExtensionAPI) {
 sessionExtension(pi);
 memoryExtension(pi);
 lifeCycleExtension(pi, { discoverResources: true });
 subAgentsExtension(pi);
 planModeExtension(pi);
 tasksExtension(pi);
 voiceExtension(pi);
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

## Tool Availability

`src/tools/availability.ts` owns this package's active-tool selection, call restrictions,
previous-tool restoration, and delegated subagent access. Plan mode and subagents pass
state changes to it; neither writes the active-tool list directly.

Both extensions acquire the same policy through `getToolAvailability(pi)`. Acquisition
uses `pi.events` because independently loaded extensions do not share a `pi` object or
necessarily share imported module instances. The first caller registers the shared
policy and one `tool_call` handler. `session_shutdown` removes the acquisition listener
so reload or session replacement cannot reuse the old runtime's policy. Either extension
can still load independently.

Plan mode continues to persist `plan-mode-state` entries with `enabled`,
`savedActiveTools`, and `exitRequested`. Tool snapshots are detached copies; restoration
combines the saved selection with the latest cwd preference rather than inheriting stale
subagent tools. Preference changes do not require rewriting the plan snapshot.

Tests inject the policy directly for session behavior, exercise tool combinations
through its interface, and load both extension registrations together (including Pi's
file loader) to verify composition and lifecycle. Run `bun run test` for both suites.

## Implementation Tasks

`update_plan` publishes a complete task snapshot with stable IDs, English titles, and statuses (`pending`, `in_progress`, `done`, `blocked`). An empty list clears the widget. It updates session metadata only and is available during plan mode without enabling project writes.

The English checkbox preview appears above the editor and remains visible during implementation. `/tasks` opens the complete read-only list. State follows the active session branch; completed tasks remain visible until cleared or replaced.

After `/reload`, ask the agent to publish a short task list, change one status, and clear it. Also check a long list in a short/narrow terminal, resume the session, and navigate to an earlier branch to verify restoration. Plan approval should preserve the tasks and no longer request a pause after each task.

## Voice Input

`extensions/voice-extension.ts` registers `/voice`, `/voice setup`, and `/voice-mic`. `src/voice/session.ts` owns command orchestration and cancellation, `recorder.ts` owns AVFoundation/FFmpeg process handling and bounded in-memory audio, `transcription.ts` uploads the in-memory WAV to OpenAI as multipart data, and `preferences.ts` stores the user-wide microphone choice outside the database. `src/ui/voice-dialog.ts` renders the inline recording screen.

The extension starts no background work when loaded. It resolves the OpenAI key through pi's `getApiKeyForProvider("openai")`, uses `getAgentDir()` for preferences, and supports both the installed 0.75.x SDK and newer pi contexts (where `ctx.mode` is available). FFmpeg is a user-installed external dependency; no OpenAI npm SDK is needed.

Capture uses `-f s16le pipe:1` for binary PCM rather than an audio-file path. The recorder constructs a complete WAV header after stopping because FFmpeg cannot finalize WAV sizes on a non-seekable output pipe. `RecordedAudio.bytes` is valid only until `AudioCapture.dispose()`, which zeroes the recorder's owned buffer and empties the result's byte view. The transcription module never accesses the filesystem. The five-minute, mono 16-kHz 16-bit limit also imposes a 9.6-MB PCM buffer cap; overflow and incomplete samples are rejected.

Focused automated checks (fake recorder processes/HTTP requests; no microphone or paid API calls):

```bash
bun test tests/unit/voice-*.test.ts
node --experimental-strip-types --test tests/integration/voice-*.test.ts
```

For an isolated interactive test:

```bash
pi --no-extensions --extension extensions/voice-extension.ts
```

Or add `voiceExtension(pi)` to your local `.pi/extensions/index.ts` as shown above and `/reload`. Installed packages already discover the file through `package.json["pi"].extensions`.

Manual verification checklist, performed explicitly by the user:

- Configure an OpenAI **API key**, install FFmpeg, then run `/voice setup`. Confirm it records/uploads nothing and does not claim the key or billing is validated.
- Use `/voice-mic` to switch between the Mac microphone, AirPods, and System default. Confirm persistence after restarting pi and changing projects.
- Run `/voice`, allow microphone permission, speak, and press Enter. Confirm the transcript appears for review and is not submitted automatically.
- Cancel during startup, recording, and upload. Confirm the recorder exits, the draft remains unchanged, and the recorder buffer is released. No audio files should be created. Cancellation cannot retract audio already sent to OpenAI.
- Disconnect the selected AirPods before capture. Confirm the picker opens instead of silently falling back; select another input and run `/voice` again.
- Exercise permission denial, empty capture, missing FFmpeg/key, and API errors. Verify actionable errors and no secrets or raw API responses in notifications.
- Check a short/narrow terminal, theme changes, five-minute automatic stop, graceful shutdown, and reload/session replacement cleanup.

## Verification

| Step | Command |
|------|---------|
| Build | `bun run build` |
| Lint | `bun run lint` |
| Tests | `bun run test` |
| DB migrations | `bun run db:generate` |
| Interactive test | `pi --extension .pi/extensions/index.ts` |
