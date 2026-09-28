import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { PlanTask } from "../../src/tasks/model.ts";
import { TasksWidget } from "../../src/ui/tasks-widget.ts";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const tasks: PlanTask[] = [
	{ id: "a", title: "Define contracts", status: "done" },
	{ id: "b", title: "Implement persistence", status: "in_progress" },
	{ id: "c", title: "Connect UI", status: "pending" },
	{ id: "d", title: "Verify integration", status: "blocked" },
];

describe("TasksWidget", () => {
	test("uses English labels and checkbox markers", () => {
		const widget = new TasksWidget(
			tasks,
			() => theme,
			() => 40,
		);
		expect(widget.render(80).map((line) => line.trimEnd())).toEqual([
			"Tasks · 1/4 completed",
			"[x] Define contracts",
			"[>] Implement persistence",
			"[ ] Connect UI",
			"[!] Verify integration — blocked",
		]);
	});

	test("bounds dimensions, prioritizes current work, and responds to resize", () => {
		let rows = 16;
		const many = [
			...Array.from(
				{ length: 20 },
				(_, index): PlanTask => ({ id: `done-${index}`, title: "Completed", status: "done" }),
			),
			...tasks,
		];
		const widget = new TasksWidget(
			many,
			() => theme,
			() => rows,
		);
		expect(widget.render(80).join("\n")).toContain("[>] Implement persistence");
		expect(widget.render(80).at(-1)).toContain("more · /tasks");
		for (rows = 1; rows <= 80; rows++) {
			for (const width of [1, 5, 20, 80]) {
				const lines = widget.render(width);
				expect(lines.length).toBeLessThanOrEqual(Math.max(1, Math.min(7, Math.floor(rows / 4))));
				for (const line of lines) expect(visibleWidth(line)).toBe(width);
			}
		}
	});

	test("reads live theme and handles wide titles and empty content", () => {
		let prefix = "";
		const widget = new TasksWidget(
			[{ ...tasks[0], title: "界面 👋 é" }],
			() => ({ fg: (_color: string, text: string) => `${prefix}${text}` }) as Theme,
			() => 40,
		);
		prefix = "new theme ";
		widget.invalidate();
		expect(widget.render(80)[0]).toStartWith("new theme ");
		for (const line of widget.render(10)) expect(visibleWidth(line)).toBe(10);
		expect(widget.render(0)).toEqual([]);
		expect(
			new TasksWidget(
				[],
				() => theme,
				() => 40,
			).render(80),
		).toEqual([]);
	});
});
