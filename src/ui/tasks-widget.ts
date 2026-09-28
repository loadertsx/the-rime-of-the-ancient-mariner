import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, TruncatedText } from "@earendil-works/pi-tui";
import type { PlanTask } from "../tasks/model.js";

const markers = { pending: "[ ]", in_progress: "[>]", done: "[x]", blocked: "[!]" };
const colors = {
	pending: "muted",
	in_progress: "accent",
	done: "success",
	blocked: "warning",
} as const;

export function taskLabel(task: PlanTask): string {
	return `${markers[task.status]} ${task.title}${task.status === "blocked" ? " — blocked" : ""}`;
}

/** Selects a compact task preview; Pi components own line composition and truncation. */
export class TasksWidget {
	constructor(
		private readonly tasks: readonly PlanTask[],
		private readonly getTheme: () => Theme,
		private readonly terminalRows: () => number,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (width < 1 || this.tasks.length === 0) return [];
		const theme = this.getTheme();
		const cap = Math.max(1, Math.min(7, Math.floor(this.terminalRows() / 4)));
		const completed = this.tasks.filter((task) => task.status === "done").length;
		// Rebuild the small component tree so terminal size and theme remain live.
		const content = new Container();
		content.addChild(
			new TruncatedText(theme.fg("muted", `Tasks · ${completed}/${this.tasks.length} completed`)),
		);
		if (cap === 1) return content.render(width);

		const hidden = this.tasks.length > cap - 1;
		const slots = Math.max(0, cap - 1 - (hidden && cap > 2 ? 1 : 0));
		// Prefer active/blocked work, then pending work, but preserve plan order in the preview.
		const priority = { in_progress: 0, blocked: 1, pending: 2, done: 3 };
		const selected = this.tasks
			.map((task, index) => ({ task, index }))
			.sort((a, b) => priority[a.task.status] - priority[b.task.status] || a.index - b.index)
			.slice(0, slots)
			.sort((a, b) => a.index - b.index);
		for (const { task } of selected) {
			content.addChild(new TruncatedText(theme.fg(colors[task.status], taskLabel(task))));
		}
		if (hidden && cap > 2) {
			content.addChild(
				new TruncatedText(theme.fg("dim", `+${this.tasks.length - selected.length} more · /tasks`)),
			);
		}
		return content.render(width);
	}
}
