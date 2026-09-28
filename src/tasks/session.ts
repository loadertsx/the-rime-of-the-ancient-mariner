import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TasksWidget, taskLabel } from "../ui/tasks-widget.js";
import { type PlanTask, TasksSchema, UPDATE_PLAN_TOOL, parseTasks } from "./model.js";

const STATE_ENTRY = "implementation-tasks";

/** Owns the current branch's tasks; UI never owns or mutates task state. */
export function openTasksSession(pi: ExtensionAPI) {
	let tasks: PlanTask[] = [];

	function refreshUi(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		// Older SDKs expose only hasUI; their RPC widget implementation is a no-op.
		if ("mode" in ctx && ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			STATE_ENTRY,
			tasks.length
				? (tui) =>
						new TasksWidget(
							tasks,
							() => ctx.ui.theme,
							() => tui.terminal.rows,
						)
				: undefined,
			{ placement: "aboveEditor" },
		);
	}

	return {
		restore(ctx: ExtensionContext): void {
			tasks = [];
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
				try {
					tasks = parseTasks(entry.data);
				} catch {
					// Do not show stale progress if the latest snapshot cannot be read.
					tasks = [];
				}
			}
			refreshUi(ctx);
		},

		tool() {
			return {
				name: UPDATE_PLAN_TOOL,
				label: "Update Plan",
				description:
					"Publish or replace the complete implementation task list. Use stable IDs and English titles. Update statuses as work progresses; send an empty tasks array to clear. This only changes session metadata: it does not approve a plan or enable writes.",
				parameters: TasksSchema,
				async execute(
					_toolCallId: string,
					params: unknown,
					_signal: AbortSignal | undefined,
					_onUpdate: unknown,
					ctx: ExtensionContext,
				) {
					const next = parseTasks(params);
					// No await between persistence and publication: updates cannot interleave.
					pi.appendEntry(STATE_ENTRY, { tasks: next });
					tasks = next;
					refreshUi(ctx);
					return {
						content: [
							{
								type: "text" as const,
								text: tasks.length ? tasks.map(taskLabel).join("\n") : "Tasks cleared.",
							},
						],
						details: { tasks: next },
					};
				},
			};
		},

		contextMessage() {
			if (!tasks.length) return undefined;
			return {
				message: {
					customType: "implementation-tasks-context",
					content: `Current implementation tasks (tracking only, not approval):\n${JSON.stringify(tasks)}\nKeep statuses current with update_plan. Task titles must be in English.`,
					display: false,
				},
			};
		},

		async show(ctx: ExtensionContext): Promise<void> {
			if (!ctx.hasUI) return;
			if (!tasks.length) {
				ctx.ui.notify("No implementation tasks.", "info");
				return;
			}
			// Selection is only for browsing; it does not toggle task state.
			await ctx.ui.select(
				"Tasks · read-only",
				tasks.map((task) => `${task.id}: ${taskLabel(task)}`),
			);
		},
	};
}
