import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	PLAN_EXIT_TOOL,
	type PlanToolState,
	type ToolAvailability,
} from "../tools/availability.ts";
import {
	type PlanModeEditorFactory,
	createPlanModeEditorFactory,
	planModeMuted,
} from "./editor.ts";
import { buildPlanInfo, renderPlanPrompt } from "./prompt.ts";

const STATE_ENTRY_TYPE = "plan-mode-state";
export interface PlanModeOptions {
	systemPromptPath: string;
}

export interface PlanModeState extends PlanToolState {
	exitRequested?: boolean;
}

export interface PlanModeBeforeAgentStart {
	systemPrompt: string;
}

export interface PlanModeSession {
	planExitTool(): Parameters<ExtensionAPI["registerTool"]>[0];
	handleCommand(args: string, ctx: ExtensionContext): void;
	restore(ctx: ExtensionContext, startEnabled: boolean): void;
	beforeAgentStart(event: PlanModeBeforeAgentStart): Promise<{ systemPrompt: string } | undefined>;
	handleAgentSettled(ctx: ExtensionContext): Promise<void>;
}

interface CustomEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

export function openPlanModeSession(
	pi: ExtensionAPI,
	options: PlanModeOptions,
	availability: ToolAvailability,
): PlanModeSession {
	let enabled = false;
	let savedEditorComponent: PlanModeEditorFactory | undefined;
	let hasPlanModeEditor = false;
	let exitRequested = false;

	function saveState(): void {
		pi.appendEntry(STATE_ENTRY_TYPE, { ...availability.planState(), exitRequested });
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
		availability.update({ planMode: true });
		enabled = true;
		exitRequested = false;
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

		availability.update({ planMode: false });
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

		enabled = restored?.enabled ?? false;
		exitRequested = restored?.exitRequested ?? false;
		availability.restorePlanMode(restored ?? { enabled: false });
		if (startEnabled) {
			availability.update({ planMode: true });
			enabled = true;
			// A startup-only entry must retain the original selection across reload.
			saveState();
		}
		refreshUi(ctx);
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
						? `Plan mode is active. Tools: ${pi.getActiveTools().join(", ")}`
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
		beforeAgentStart,
		handleAgentSettled,
	};
}
