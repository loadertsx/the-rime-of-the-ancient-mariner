import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PLAN_EXIT_TOOL } from "../src/plan-mode/session.ts";
import { openSubagentsPreference } from "../src/subagents/preferences.ts";
import { openSubagentsSession } from "../src/subagents/session.ts";
import { createSubagentsOrchestrator } from "../src/subagents/subagents-orchestrator.ts";

export default function subAgentsExtension(pi: ExtensionAPI) {
	pi.registerFlag("subagents", {
		description: "Enable subagent tools at startup without changing the saved cwd preference",
		type: "boolean",
		default: false,
	});

	const subagents = openSubagentsSession(pi, openSubagentsPreference());
	const subAgentsOrchestrator = createSubagentsOrchestrator({
		pi,
		resolveAccess: () => (pi.getActiveTools().includes(PLAN_EXIT_TOOL) ? "read-only" : "full"),
	});

	pi.registerTool({
		name: "list_available_subagents",
		label: "List Available Subagents",
		description: "List specialized subagents with their purpose and prompt path.",
		promptSnippet: "Discover specialized subagents available for delegated tasks",
		promptGuidelines: [
			"Use list_available_subagents only when delegation is likely useful and no suitable subagent or prompt path is already known from the current conversation.",
			"Do not call list_available_subagents again when a suitable subagent was already discovered earlier in the session.",
		],
		parameters: Type.Object({}),
		async execute() {
			return subAgentsOrchestrator.list();
		},
	});

	pi.registerTool({
		name: "subagent_execute",
		label: "Subagent Execute",
		description:
			"Run a discovered specialized subagent in an isolated Pi process. It uses full coding tools normally and native read-only tools in plan mode.",
		promptSnippet: "Delegate a task to a specialized isolated subagent",
		promptGuidelines: [
			"Use subagent_execute when a task requires substantial exploration of unfamiliar code, broad cross-module research, or an isolated context window.",
			"Do not use subagent_execute for follow-up changes to code already inspected or implemented in the current conversation when the relevant files and behavior are known.",
			"Reuse previous subagent findings instead of repeating equivalent research.",
			"Run another codebase-search subagent only when the requested change expands into unfamiliar areas, the existing findings may be stale, or important context is missing.",
		],
		parameters: Type.Object({
			promptPath: Type.String({
				description: "Exact prompt path returned by list_available_subagents",
				minLength: 1,
			}),
			task: Type.String({
				description: "Task to delegate to the subagent",
				minLength: 1,
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return subAgentsOrchestrator.run({
				promptPath: params.promptPath,
				task: params.task,
				cwd: ctx.cwd,
				signal,
				ui: ctx.ui,
			});
		},
	});

	pi.registerCommand("subagents", {
		description: "Toggle subagent tools and save the choice for the current cwd",
		handler: async (_args, ctx) => subagents.toggle(ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		subagents.restore(ctx, pi.getFlag("subagents") === true);
	});

	pi.on("tool_call", async (event) => subagents.blockToolCall(event));
}
