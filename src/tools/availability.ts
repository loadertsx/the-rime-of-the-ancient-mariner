import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isReadOnlyBashCommand } from "../plan-mode/bash-safety.ts";
import { UPDATE_PLAN_TOOL } from "../tasks/model.ts";

export const PLAN_EXIT_TOOL = "plan_exit";
const SUBAGENT_TOOLS = ["list_available_subagents", "subagent_execute"];
const READ_ONLY_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"question",
	"questionnaire",
	"get_current_session",
	"get_memory",
	"list_memories",
	"count_lines",
	UPDATE_PLAN_TOOL,
	PLAN_EXIT_TOOL,
];

export interface PlanToolState {
	enabled: boolean;
	savedActiveTools?: string[];
}

export interface ToolCall {
	toolName: string;
	input: unknown;
}

export interface ToolBlockResult {
	block: true;
	reason: string;
}

/**
 * Owns this package's tool restrictions, including delegated access. Updates preserve
 * unrelated active tools; leaving planning restores the selection captured on entry.
 * Persistence crosses the same interface through detached, legacy-compatible snapshots.
 */
export interface ToolAvailability {
	update(change: { planMode?: boolean; subagentsEnabled?: boolean }): void;
	restorePlanMode(state: PlanToolState): void;
	planState(): PlanToolState;
	blockToolCall(call: ToolCall): ToolBlockResult | undefined;
	subagentAccess(): "full" | "read-only";
}

type ToolRuntime = Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">;

export function createToolAvailability(runtime: ToolRuntime): ToolAvailability {
	let planMode = false;
	// Undefined means the subagents extension has not supplied its preference.
	let subagentsEnabled: boolean | undefined;
	let savedActiveTools: string[] | undefined;

	function availableTools(names: readonly string[]): string[] {
		const available = new Set(runtime.getAllTools().map((tool) => tool.name));
		return [...new Set(names)].filter((name) => available.has(name));
	}

	function withoutManagedTools(names: readonly string[]): string[] {
		return names.filter((name) => name !== PLAN_EXIT_TOOL && !SUBAGENT_TOOLS.includes(name));
	}

	function withSubagents(names: readonly string[]): string[] {
		const tools = names.filter((name) => !SUBAGENT_TOOLS.includes(name));
		return subagentsEnabled ? [...tools, ...SUBAGENT_TOOLS] : tools;
	}

	function readOnlyTools(): string[] {
		return withSubagents(READ_ONLY_TOOLS);
	}

	function apply(names = runtime.getActiveTools()): void {
		if (planMode) {
			runtime.setActiveTools(availableTools(readOnlyTools()));
			return;
		}
		const tools = names.filter((name) => name !== PLAN_EXIT_TOOL);
		runtime.setActiveTools(
			availableTools(subagentsEnabled === undefined ? tools : withSubagents(tools)),
		);
	}

	return {
		update(change) {
			if (change.subagentsEnabled !== undefined) {
				subagentsEnabled = change.subagentsEnabled;
			}
			if (change.planMode === true && !planMode) {
				savedActiveTools = withoutManagedTools(runtime.getActiveTools());
			}
			const leaving = change.planMode === false && planMode;
			planMode = change.planMode ?? planMode;
			if (leaving) {
				// Older snapshots may have no selection. Match the previous fallback.
				const tools = savedActiveTools ?? runtime.getAllTools().map((tool) => tool.name);
				apply(withSubagents(tools));
				savedActiveTools = undefined;
			} else {
				apply();
			}
		},

		restorePlanMode(state) {
			planMode = state.enabled;
			savedActiveTools = state.savedActiveTools
				? withoutManagedTools(state.savedActiveTools)
				: undefined;
			apply();
		},

		planState() {
			return {
				enabled: planMode,
				savedActiveTools: savedActiveTools
					? availableTools(withSubagents(savedActiveTools))
					: undefined,
			};
		},

		blockToolCall({ toolName, input }) {
			if (planMode) {
				if (!readOnlyTools().includes(toolName)) {
					return {
						block: true,
						reason: `Plan mode blocks the ${toolName} tool. Only read-only tools are available.`,
					};
				}
				if (toolName === "bash") {
					const command =
						typeof input === "object" && input !== null && "command" in input
							? input.command
							: undefined;
					if (typeof command !== "string" || !isReadOnlyBashCommand(command)) {
						return {
							block: true,
							reason: `Plan mode blocks unsafe bash commands. Command: ${String(command)}`,
						};
					}
				}
			} else if (subagentsEnabled === false && SUBAGENT_TOOLS.includes(toolName)) {
				return {
					block: true,
					reason: "Subagents are disabled. Run /subagents to enable them.",
				};
			}
			return undefined;
		},

		subagentAccess: () => (planMode ? "read-only" : "full"),
	};
}

const REQUEST_EVENT = "the-ancient-mariner:request-tool-availability";

/**
 * Acquires one policy per extension runtime, even with independently loaded modules.
 * Factories only wire the seam; tool operations happen after session startup.
 */
export function getToolAvailability(pi: ExtensionAPI): ToolAvailability {
	let shared: ToolAvailability | undefined;
	pi.events.emit(REQUEST_EVENT, {
		accept(availability: ToolAvailability) {
			shared = availability;
		},
	});
	if (shared) return shared;

	const availability = createToolAvailability(pi);
	const unsubscribe = pi.events.on(REQUEST_EVENT, (request) => {
		if (typeof request !== "object" || request === null || !("accept" in request)) return;
		if (typeof request.accept === "function") request.accept(availability);
	});
	pi.on("tool_call", (event) => availability.blockToolCall(event));
	pi.on("session_shutdown", () => unsubscribe());
	return availability;
}
