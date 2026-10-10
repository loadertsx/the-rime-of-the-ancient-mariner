import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentsPreference } from "../../src/subagents/preferences.ts";
import { openSubagentsSession } from "../../src/subagents/session.ts";
import { createToolAvailability } from "../../src/tools/availability.ts";

function createHarness(hasUI = true, preferenceEnabled = false) {
	const toolNames = ["read", "list_available_subagents", "subagent_execute"];
	let activeTools = [...toolNames];
	const savedPreferences = new Map<string, boolean>([["/projects/api", preferenceEnabled]]);
	let preferenceError: Error | undefined;
	const preferenceWrites: Array<[string, boolean]> = [];
	const statuses: Array<[string, string | undefined]> = [];
	const notifications: Array<[string, string | undefined]> = [];
	const pi = {
		getActiveTools: () => [...activeTools],
		getAllTools: () => toolNames.map((name) => ({ name })),
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: "/projects/api",
		hasUI,
		ui: {
			notify(message: string, level?: string) {
				notifications.push([message, level]);
			},
			setStatus(key: string, value: string | undefined) {
				statuses.push([key, value]);
			},
		},
	} as unknown as ExtensionContext;

	const preference: SubagentsPreference = {
		isEnabled: (cwd) => savedPreferences.get(cwd) ?? false,
		setEnabled(cwd, enabled) {
			if (preferenceError) throw preferenceError;
			savedPreferences.set(cwd, enabled);
			preferenceWrites.push([cwd, enabled]);
		},
	};

	return {
		activeTools: () => activeTools,
		ctx,
		notifications,
		preferenceWrites,
		setPreferenceError(error: Error | undefined) {
			preferenceError = error;
		},
		session: openSubagentsSession(createToolAvailability(pi), preference),
		statuses,
	};
}

describe("openSubagentsSession", () => {
	test("starts disabled and preserves unrelated active tools", () => {
		const { activeTools, ctx, notifications, session, statuses } = createHarness();

		session.restore(ctx, false);

		expect(activeTools()).toEqual(["read"]);
		expect(statuses.at(-1)).toEqual(["subagents", "subagents: off"]);
		expect(notifications).toEqual([]);
	});

	test("restores the persisted preference unless startup forces subagents on", () => {
		const persisted = createHarness(true, true);
		persisted.session.restore(persisted.ctx, false);
		expect(persisted.activeTools()).toEqual([
			"read",
			"list_available_subagents",
			"subagent_execute",
		]);

		const forced = createHarness(true, false);
		forced.session.restore(forced.ctx, true);
		expect(forced.activeTools()).toEqual(["read", "list_available_subagents", "subagent_execute"]);
		expect(forced.preferenceWrites).toEqual([]);
	});

	test("toggles both tools, persists the choice, and notifies the user", () => {
		const { activeTools, ctx, notifications, preferenceWrites, session } = createHarness();
		session.restore(ctx, false);

		session.toggle(ctx);
		expect(activeTools()).toEqual(["read", "list_available_subagents", "subagent_execute"]);
		expect(preferenceWrites).toEqual([[ctx.cwd, true]]);
		expect(notifications.at(-1)).toEqual(["Subagents enabled.", "info"]);

		session.toggle(ctx);
		expect(activeTools()).toEqual(["read"]);
		expect(preferenceWrites).toEqual([
			[ctx.cwd, true],
			[ctx.cwd, false],
		]);
		expect(notifications.at(-1)).toEqual(["Subagents disabled.", "info"]);
	});

	test("leaves runtime state unchanged when persisting a toggle fails", () => {
		const { activeTools, ctx, session, setPreferenceError } = createHarness();
		session.restore(ctx, false);
		setPreferenceError(new Error("disk full"));

		expect(() => session.toggle(ctx)).toThrow("disk full");
		expect(activeTools()).toEqual(["read"]);
	});

	test("restore retains a persisted runtime toggle", () => {
		const { activeTools, ctx, session } = createHarness();
		session.restore(ctx, false);
		session.toggle(ctx);

		session.restore(ctx, false);

		expect(activeTools()).toEqual(["read", "list_available_subagents", "subagent_execute"]);
	});

	test("restores and toggles independent choices for the current cwd", () => {
		const { activeTools, ctx, preferenceWrites, session } = createHarness();
		const otherCtx = { ...ctx, cwd: "/projects/web" };
		session.restore(ctx, false);
		session.toggle(ctx);

		session.restore(otherCtx, false);
		expect(activeTools()).toEqual(["read"]);
		session.toggle(otherCtx);
		session.toggle(otherCtx);
		expect(preferenceWrites).toEqual([
			[ctx.cwd, true],
			[otherCtx.cwd, true],
			[otherCtx.cwd, false],
		]);

		session.restore(ctx, false);
		expect(activeTools()).toEqual(["read", "list_available_subagents", "subagent_execute"]);
		session.restore(otherCtx, false);
		expect(activeTools()).toEqual(["read"]);
	});

	test("startup flag is temporary and toggling saves the effective choice for that cwd", () => {
		const { activeTools, ctx, preferenceWrites, session } = createHarness();
		session.restore(ctx, true);
		session.restore(ctx, false);
		expect(activeTools()).toEqual(["read"]);
		expect(preferenceWrites).toEqual([]);

		session.restore(ctx, true);
		session.toggle(ctx);
		expect(activeTools()).toEqual(["read"]);
		expect(preferenceWrites).toEqual([[ctx.cwd, false]]);
	});

	test("skips UI output when no UI is available", () => {
		const { ctx, notifications, session, statuses } = createHarness(false);

		session.restore(ctx, false);
		session.toggle(ctx);

		expect(statuses).toEqual([]);
		expect(notifications).toEqual([]);
	});
});
