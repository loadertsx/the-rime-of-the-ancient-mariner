import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SUBAGENT_TOOL_NAMES } from "../subagents/session.js";
import { UPDATE_PLAN_TOOL } from "../tasks/model.js";
import { isReadOnlyBashCommand } from "./bash-safety.ts";
import {
	PLAN_MODE_LABEL,
	type PlanModeEditorFactory,
	createPlanModeEditorFactory,
	planModeMuted,
	planModeTitle,
} from "./editor.ts";
import { buildPlanInfo, renderPlanPrompt } from "./prompt.ts";

const STATE_ENTRY_TYPE = "plan-mode-state";
export const PLAN_EXIT_TOOL = "plan_exit";

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

export interface PlanModeOptions {
	systemPromptPath: string;
}

export interface PlanModeState {
	enabled: boolean;
	savedActiveTools?: string[];
	exitRequested?: boolean;
}

export interface PlanModeToolCall {
	toolName: string;
	input: unknown;
}

export interface PlanModeBeforeAgentStart {
	systemPrompt: string;
}

export interface ToolBlockResult {
	block: true;
	reason: string;
}

export interface PlanModeSession {
	planExitTool(): Parameters<ExtensionAPI["registerTool"]>[0];
	handleCommand(args: string, ctx: ExtensionContext): void;
	restore(ctx: ExtensionContext, startEnabled: boolean): void;
	setSubagentsEnabled(enabled: boolean): void;
	beforeAgentStart(event: PlanModeBeforeAgentStart): Promise<{ systemPrompt: string } | undefined>;
	blockToolCall(event: PlanModeToolCall): ToolBlockResult | undefined;
	handleAgentSettled(ctx: ExtensionContext): Promise<void>;
}

interface CustomEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

export function openPlanModeSession(pi: ExtensionAPI, options: PlanModeOptions): PlanModeSession {
	let enabled = false;
	let savedActiveTools: string[] | undefined;
	let savedEditorComponent: PlanModeEditorFactory | undefined;
	let hasPlanModeEditor = false;
	let exitRequested = false;
	let subagentsEnabled = false;

	function saveState(): void {
		pi.appendEntry(STATE_ENTRY_TYPE, { enabled, savedActiveTools, exitRequested });
	}

	function availableTools(names: readonly string[]): string[] {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		return names.filter((name) => available.has(name));
	}

	function readOnlyTools(): string[] {
		return [...READ_ONLY_TOOLS, ...(subagentsEnabled ? availableTools(SUBAGENT_TOOL_NAMES) : [])];
	}

	function syncSavedSubagentTools(): void {
		if (!savedActiveTools) return;

		const subagentTools = new Set<string>(SUBAGENT_TOOL_NAMES);
		savedActiveTools = savedActiveTools.filter((name) => !subagentTools.has(name));
		if (subagentsEnabled) {
			savedActiveTools.push(...availableTools(SUBAGENT_TOOL_NAMES));
		}
	}

	function captureSavedTools(): void {
		savedActiveTools = pi.getActiveTools().filter((name) => name !== PLAN_EXIT_TOOL);
		syncSavedSubagentTools();
	}

	function installPlanModeEditor(ctx: ExtensionContext): void {
		if (!ctx.hasUI || hasPlanModeEditor) return;

		savedEditorComponent = ctx.ui.getEditorComponent();
		hasPlanModeEditor = true;
		ctx.ui.setEditorComponent(createPlanModeEditorFactory());
	}

	function restoreEditor(ctx: ExtensionContext): void {
		if (!ctx.hasUI || !hasPlanModeEditor) return;

		ctx.ui.setEditorComponent(savedEditorComponent);
		savedEditorComponent = undefined;
		hasPlanModeEditor = false;
	}

	function refreshUi(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!enabled) {
			ctx.ui.setStatus("plan-mode", undefined);
			ctx.ui.setWidget("plan-mode", undefined);
			restoreEditor(ctx);
			return;
		}

		installPlanModeEditor(ctx);
		ctx.ui.setWidget(
			"plan-mode",
			[
				planModeMuted("use shift+tab or /plan-mode off to leave"),
				planModeMuted("Write/edit and unsafe bash are blocked; finish with plan_exit."),
			],
			{ placement: "belowEditor" },
		);
	}

	function enter(ctx: ExtensionContext, notify = true): void {
		if (!enabled) {
			captureSavedTools();
		}
		enabled = true;
		exitRequested = false;
		pi.setActiveTools(availableTools(readOnlyTools()));
		saveState();
		refreshUi(ctx);
		if (notify && ctx.hasUI) {
			ctx.ui.notify("Plan mode enabled. Write tools are blocked.", "info");
		}
	}

	function leave(ctx: ExtensionContext, notify = true): void {
		const wasEnabled = enabled;
		enabled = false;
		exitRequested = false;

		if (wasEnabled) {
			const restoreList = savedActiveTools ?? pi.getAllTools().map((tool) => tool.name);
			pi.setActiveTools(availableTools(restoreList).filter((name) => name !== PLAN_EXIT_TOOL));
		}

		savedActiveTools = undefined;
		saveState();
		refreshUi(ctx);

		if (notify && ctx.hasUI) {
			ctx.ui.notify(
				wasEnabled
					? "Plan mode disabled. Previous tools restored."
					: "Plan mode is already inactive.",
				"info",
			);
		}
	}

	function restore(ctx: ExtensionContext, startEnabled: boolean): void {
		const entries = ctx.sessionManager.getBranch() as CustomEntryLike[];
		const restored = entries
			.filter((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE)
			.pop()?.data as PlanModeState | undefined;

		if (restored) {
			enabled = restored.enabled;
			savedActiveTools = restored.savedActiveTools;
			exitRequested = restored.exitRequested ?? false;
		}

		if (startEnabled) {
			if (!enabled) {
				captureSavedTools();
			}
			enabled = true;
		}

		syncSavedSubagentTools();
		if (enabled) {
			pi.setActiveTools(availableTools(readOnlyTools()));
		}
		refreshUi(ctx);
	}

	function setSubagentsEnabled(nextEnabled: boolean): void {
		subagentsEnabled = nextEnabled;
		syncSavedSubagentTools();
		if (enabled) {
			pi.setActiveTools(availableTools(readOnlyTools()));
			saveState();
		}
	}

	function handleCommand(args: string, ctx: ExtensionContext): void {
		switch (args.trim() || "toggle") {
			case "on":
				enter(ctx);
				return;
			case "off":
				leave(ctx);
				return;
			case "toggle":
				if (enabled) leave(ctx);
				else enter(ctx);
				return;
			case "status":
				ctx.ui.notify(
					enabled
						? `Plan mode is active. Tools: ${availableTools(readOnlyTools()).join(", ")}`
						: "Plan mode is inactive.",
					"info",
				);
				return;
			default:
				ctx.ui.notify("Usage: /plan-mode [on|off|toggle|status]", "info");
		}
	}

	async function beforeAgentStart(
		event: PlanModeBeforeAgentStart,
	): Promise<{ systemPrompt: string } | undefined> {
		if (!enabled) return undefined;

		const template = await readFile(options.systemPromptPath, "utf8");
		const renderedPrompt = renderPlanPrompt(template, {
			planInfo: buildPlanInfo(),
		});

		return {
			systemPrompt: `${event.systemPrompt}\n\n${renderedPrompt}`,
		};
	}

	function blockToolCall(event: PlanModeToolCall): ToolBlockResult | undefined {
		if (!enabled) return undefined;

		if (!readOnlyTools().includes(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode blocks the ${event.toolName} tool. Only read-only tools are available.`,
			};
		}

		if (event.toolName !== "bash") return undefined;

		const input = event.input as Record<string, unknown>;
		const command = input.command;
		if (typeof command !== "string" || !isReadOnlyBashCommand(command)) {
			return {
				block: true,
				reason: `Plan mode blocks unsafe bash commands. Command: ${String(command)}`,
			};
		}

		return undefined;
	}

	async function handleAgentSettled(ctx: ExtensionContext): Promise<void> {
		if (!enabled || !exitRequested) return;

		if (!ctx.hasUI) {
			exitRequested = false;
			saveState();
			pi.sendMessage(
				{
					customType: "plan-mode-exit-requested",
					content:
						"plan_exit was called, but no interactive UI is available. Use /plan-mode off to leave plan mode.",
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		const approved = await ctx.ui.confirm(
			"Approve plan and start implementation?",
			"Restore the previous write-capable tools and begin implementing the approved plan?",
		);

		if (approved) {
			leave(ctx);
			pi.sendMessage(
				{
					customType: "plan-mode-execute",
					content:
						"The user approved the entire plan. Plan mode is off. Implement all approved tasks in dependency order, respecting the plan's scope. Do not ask for per-task review or approval: after completing a task, update its status and continue to the next task. Keep the progress widget current with update_plan when available and run the relevant checks. Only after the full implementation, summarize behavior and verification results for human review. If findings require changing the approved design or scope, pause for clarification.",
					display: true,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
			return;
		}

		exitRequested = false;
		saveState();
		refreshUi(ctx);
		ctx.ui.notify("Staying in plan mode. Write tools remain blocked.", "info");
	}

	function planExitTool(): Parameters<ExtensionAPI["registerTool"]>[0] {
		return {
			name: PLAN_EXIT_TOOL,
			label: "Plan Exit",
			description:
				"Request approval to leave native plan mode after producing a final implementation plan. Does not change files.",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
				if (!enabled) {
					return {
						content: [{ type: "text", text: "Plan mode is not active." }],
						details: { status: "inactive" },
					};
				}

				exitRequested = true;
				saveState();
				return {
					content: [
						{
							type: "text",
							text: "Plan exit requested. The user will be asked to approve restoring write tools.",
						},
					],
					details: { status: "exit-requested" },
				};
			},
		};
	}

	return {
		planExitTool,
		handleCommand,
		restore,
		setSubagentsEnabled,
		beforeAgentStart,
		blockToolCall,
		handleAgentSettled,
	};
}
