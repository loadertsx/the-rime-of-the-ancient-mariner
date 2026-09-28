import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import tasksExtension from "../../extensions/tasks-extension.ts";
import { openTasksSession } from "../../src/tasks/session.ts";

const task = { id: "contracts", title: "Define contracts", status: "pending" };

function harness(mode = "tui") {
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const widgets: unknown[] = [];
	const shown: string[][] = [];
	const pi = {
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		mode,
		hasUI: mode === "tui",
		sessionManager: { getBranch: () => entries },
		ui: {
			setWidget(_key: string, content: unknown) {
				widgets.push(content);
			},
			select: async (_title: string, options: string[]) => {
				shown.push(options);
			},
			notify() {},
		},
	} as unknown as ExtensionContext;
	const session = openTasksSession(pi);
	return {
		pi,
		ctx,
		entries,
		widgets,
		shown,
		session,
		update: (tasks: unknown[]) =>
			session.tool().execute("test", { tasks }, undefined, undefined, ctx),
	};
}

describe("implementation tasks", () => {
	test("persists snapshots, restores branches, and clears without stale state", async () => {
		const h = harness();
		await h.update([task]);
		const pending = h.entries[0];
		await h.update([{ ...task, status: "done" }]);
		expect(h.session.contextMessage()?.message.content).toContain('"done"');
		const reopened = openTasksSession(h.pi);
		reopened.restore(h.ctx);
		expect(reopened.contextMessage()?.message.content).toContain('"done"');
		h.entries.splice(0, h.entries.length, pending);
		h.session.restore(h.ctx);
		expect(h.session.contextMessage()?.message.content).toContain('"pending"');
		await h.update([]);
		expect(h.widgets.at(-1)).toBeUndefined();
		expect(h.session.contextMessage()).toBeUndefined();
		h.session.restore(h.ctx);
		expect(h.session.contextMessage()).toBeUndefined();
		h.entries.length = 0;
		reopened.restore(h.ctx);
		expect(reopened.contextMessage()).toBeUndefined();
	});

	test("invalid updates leave persistence and UI unchanged", async () => {
		const h = harness();
		await h.update([task]);
		for (const tasks of [
			[task, task],
			[{ ...task, status: "unknown" }],
			[{ ...task, title: " " }],
			[{ ...task, title: "Bad\nTitle" }],
			[{ ...task, title: "\x1b[31mBad" }],
		]) {
			await expect(h.update(tasks)).rejects.toThrow();
		}
		expect(h.entries).toHaveLength(1);
		expect(h.widgets).toHaveLength(1);
	});

	test("malformed restored state does not leave stale tasks", async () => {
		const h = harness();
		await h.update([task]);
		h.entries.push({ type: "custom", customType: "implementation-tasks", data: {} });
		h.session.restore(h.ctx);
		expect(h.session.contextMessage()).toBeUndefined();
		expect(h.widgets.at(-1)).toBeUndefined();
	});

	test("non-interactive operation persists without rendering", async () => {
		const h = harness("print");
		await h.update([task]);
		h.session.restore(h.ctx);
		await h.session.show(h.ctx);
		expect(h.entries).toHaveLength(1);
		expect(h.widgets).toHaveLength(0);
		expect(h.shown).toHaveLength(0);
	});

	test("full list browsing does not mutate tasks", async () => {
		const h = harness();
		await h.update([task, { ...task, id: "ui", title: "Connect UI", status: "blocked" }]);
		await h.session.show(h.ctx);
		expect(h.shown[0]).toEqual(["contracts: [ ] Define contracts", "ui: [!] Connect UI — blocked"]);
		expect(h.entries).toHaveLength(1);
	});

	test("extension wires branch restoration and context injection", () => {
		const handlers = new Map<string, unknown>();
		const tools: string[] = [];
		const commands: string[] = [];
		const h = harness();
		Object.assign(h.pi, {
			registerTool: (tool: { name: string }) => tools.push(tool.name),
			registerCommand: (name: string) => commands.push(name),
			on: (name: string, handler: unknown) => handlers.set(name, handler),
		});
		tasksExtension(h.pi);
		expect(tools).toEqual(["update_plan"]);
		expect(commands).toEqual(["tasks"]);
		expect([...handlers.keys()]).toEqual(["session_start", "session_tree", "before_agent_start"]);
	});
});
