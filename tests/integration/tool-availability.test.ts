import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	type ExtensionContext,
	type SlashCommandInfo,
	createEventBus,
	discoverAndLoadExtensions,
} from "@earendil-works/pi-coding-agent";
import planModeExtension from "../../extensions/plan-mode.ts";
import subagentsExtension from "../../extensions/subagents-extension.ts";
import { openSubagentsPreference } from "../../src/subagents/preferences.ts";
import { getToolAvailability } from "../../src/tools/availability.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Tool = Parameters<ExtensionAPI["registerTool"]>[0];
const cwd = "/projects/example";
let directory: string;
let previousDbPath: string | undefined;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "ancient-mariner-tool-availability-"));
	previousDbPath = process.env.THE_ANCIENT_MARINER_DB_PATH;
	process.env.THE_ANCIENT_MARINER_DB_PATH = join(directory, "preferences.db");
});

afterEach(() => {
	if (previousDbPath === undefined)
		Reflect.deleteProperty(process.env, "THE_ANCIENT_MARINER_DB_PATH");
	else process.env.THE_ANCIENT_MARINER_DB_PATH = previousDbPath;
	rmSync(directory, { recursive: true, force: true });
});

/** Distinct extension objects share only the runtime and the real Pi event bus. */
function harness(flags: Record<string, boolean> = {}) {
	let activeTools = ["read", "bash", "edit", "custom"];
	const registered = new Set([...activeTools, "write", "grep", "find", "ls", "update_plan"]);
	const tools = new Map<string, Tool>();
	const commands = new Map<string, (args: string, ctx: ExtensionContext) => unknown>();
	const handlers = new Map<string, Handler[]>();
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const invocations: string[][] = [];
	const messages: unknown[] = [];
	const events = createEventBus();
	const ctx = {
		cwd,
		hasUI: true,
		ui: {
			notify() {},
			setStatus() {},
			setWidget() {},
			getEditorComponent: () => undefined,
			setEditorComponent() {},
			confirm: async () => true,
		},
		sessionManager: { getBranch: () => entries },
	} as unknown as ExtensionContext;
	const prompt: SlashCommandInfo = {
		name: "subagent-research",
		source: "prompt",
		sourceInfo: {
			path: "/package/prompts/subagent-research.md",
			source: "test-package",
			scope: "temporary",
			origin: "package",
			baseDir: "/package/prompts",
		},
	};

	function client(): ExtensionAPI {
		return {
			events,
			on(name: string, handler: Handler) {
				const list = handlers.get(name) ?? [];
				list.push(handler);
				handlers.set(name, list);
			},
			getActiveTools: () => [...activeTools],
			getAllTools: () => [...registered].map((name) => ({ name })),
			setActiveTools(names: string[]) {
				activeTools = [...names];
			},
			registerFlag() {},
			getFlag: (name: string) => flags[name] ?? false,
			registerTool(tool: Tool) {
				tools.set(tool.name, tool);
				registered.add(tool.name);
				activeTools.push(tool.name);
			},
			registerCommand(
				name: string,
				options: { handler: (args: string, ctx: ExtensionContext) => unknown },
			) {
				commands.set(name, options.handler);
			},
			registerShortcut() {},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
			sendMessage(message: unknown) {
				messages.push(message);
			},
			getCommands: () => [prompt],
			exec: async (_command: string, args: string[]) => {
				invocations.push(args);
				return { stdout: "Done", stderr: "", code: 0, killed: false };
			},
		} as unknown as ExtensionAPI;
	}

	async function emit(name: string, event: unknown = {}) {
		for (const handler of handlers.get(name) ?? []) {
			const result = await handler(event, ctx);
			if (result && typeof result === "object" && "block" in result) return result;
		}
		return undefined;
	}

	return {
		client,
		ctx,
		emit,
		entries,
		invocations,
		messages,
		activeTools: () => activeTools,
		command: async (name: string, args = "") => {
			const handler = commands.get(name);
			assert.ok(handler, `Missing command: ${name}`);
			await handler(args, ctx);
		},
		runTool: async (name: string, params = {}) => {
			const tool = tools.get(name);
			assert.ok(tool, `Missing tool: ${name}`);
			return tool.execute("test", params, undefined, undefined, ctx);
		},
		reload: async (factories: Array<(pi: ExtensionAPI) => void>) => {
			await emit("session_shutdown", { reason: "reload" });
			handlers.clear();
			tools.clear();
			commands.clear();
			for (const factory of factories) factory(client());
			await emit("session_start", { reason: "reload" });
		},
		handlerCount: (name: string) => handlers.get(name)?.length ?? 0,
	};
}

const subagentParams = {
	promptPath: "/package/prompts/subagent-research.md",
	task: "Inspect the code",
};

describe("shared tool availability", () => {
	for (const order of [
		[planModeExtension, subagentsExtension],
		[subagentsExtension, planModeExtension],
	]) {
		test(`composes both extensions (${order[0].name} first)`, async () => {
			const h = harness({ "with-plan": true, subagents: true });
			for (const factory of order) factory(h.client());
			await h.emit("session_start");
			assert.equal(h.handlerCount("tool_call"), 1);
			assert.ok(h.activeTools().includes("subagent_execute"));
			assert.ok(!h.activeTools().includes("edit"));
			assert.equal(
				((await h.emit("tool_call", { toolName: "write", input: {} })) as { block: boolean }).block,
				true,
			);
			await h.runTool("subagent_execute", subagentParams);
			assert.ok(h.invocations.at(-1)?.includes("read,grep,find,ls"));

			await h.command("subagents");
			assert.ok(!h.activeTools().includes("subagent_execute"));
			assert.ok(await h.emit("tool_call", { toolName: "subagent_execute", input: subagentParams }));
			await h.command("subagents");
			await h.command("plan-mode", "off");
			assert.ok(h.activeTools().includes("edit"));
			assert.ok(h.activeTools().includes("custom"));
			assert.ok(!h.activeTools().includes("write"));
			assert.ok(!h.activeTools().includes("plan_exit"));
			await h.runTool("subagent_execute", subagentParams);
			assert.ok(h.invocations.at(-1)?.includes("read,bash,edit,write,grep,find,ls"));
		});
	}

	test("plan mode works without the subagents extension", async () => {
		const h = harness();
		planModeExtension(h.client());
		await h.emit("session_start");
		await h.command("plan-mode", "on");
		assert.ok(!h.activeTools().includes("edit"));
		assert.ok(await h.emit("tool_call", { toolName: "bash", input: { command: "rm file" } }));
		await h.runTool("plan_exit");
		await h.emit("agent_settled");
		assert.ok(h.activeTools().includes("edit"));
		assert.equal(h.messages.length, 1);
	});

	test("subagents work without plan mode and preserve per-cwd preferences", async () => {
		const h = harness();
		subagentsExtension(h.client());
		await h.emit("session_start");
		assert.ok(!h.activeTools().includes("subagent_execute"));
		await h.command("subagents");
		assert.equal(openSubagentsPreference().isEnabled(cwd), true);
		await h.runTool("subagent_execute", subagentParams);
		assert.ok(h.invocations.at(-1)?.includes("read,bash,edit,write,grep,find,ls"));
	});

	test("startup flags survive reload without losing the original selection or saving the cwd preference", async () => {
		const h = harness({ "with-plan": true, subagents: true });
		const order = [planModeExtension, subagentsExtension];
		for (const factory of order) factory(h.client());
		await h.emit("session_start");
		await h.reload(order);
		assert.ok(!h.activeTools().includes("edit"));
		await h.command("plan-mode", "off");
		assert.ok(h.activeTools().includes("edit"));
		assert.ok(h.activeTools().includes("custom"));
		assert.ok(!h.activeTools().includes("write"));
		assert.equal(openSubagentsPreference().isEnabled(cwd), false);
	});

	test("reload acquires a new policy and restores pending approval and tool selection", async () => {
		const h = harness();
		const order = [subagentsExtension, planModeExtension];
		for (const factory of order) factory(h.client());
		await h.emit("session_start");
		const old = getToolAvailability(h.client());
		await h.command("plan-mode", "on");
		await h.command("subagents");
		await h.runTool("plan_exit");
		await h.reload(order);
		assert.notEqual(getToolAvailability(h.client()), old);
		assert.equal(h.handlerCount("tool_call"), 1);
		await h.runTool("subagent_execute", subagentParams);
		assert.ok(h.invocations.at(-1)?.includes("read,grep,find,ls"));
		await h.emit("agent_settled");
		assert.equal(h.messages.length, 1);
		assert.ok(h.activeTools().includes("edit"));
		assert.ok(h.activeTools().includes("custom"));
		assert.ok(!h.activeTools().includes("write"));
	});

	for (const enabled of [false, true]) {
		test(`a saved snapshot cannot override a later cwd preference (${enabled})`, async () => {
			const h = harness();
			const order = [planModeExtension, subagentsExtension];
			for (const factory of order) factory(h.client());
			await h.emit("session_start");
			if (!enabled) await h.command("subagents");
			await h.command("plan-mode", "on");
			await h.command("subagents");
			await h.reload(order);
			assert.equal(h.activeTools().includes("subagent_execute"), enabled);
			await h.command("plan-mode", "off");
			assert.equal(h.activeTools().includes("subagent_execute"), enabled);
		});
	}

	test("independent file loading through Pi shares one policy without factory-time actions", async () => {
		const events = createEventBus();
		const paths = ["plan-mode.ts", "subagents-extension.ts"].map((name) =>
			fileURLToPath(new URL(`../../extensions/${name}`, import.meta.url)),
		);
		const loaded = await discoverAndLoadExtensions(paths, directory, directory, events);
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.extensions.length, 2);
		assert.equal(
			loaded.extensions.flatMap((extension) => extension.handlers.get("tool_call") ?? []).length,
			1,
		);
		let activeTools = ["read", "edit", "plan_exit", "list_available_subagents", "subagent_execute"];
		Object.assign(loaded.runtime, {
			appendEntry() {},
			getActiveTools: () => activeTools,
			getAllTools: () =>
				["read", "edit", "plan_exit", "list_available_subagents", "subagent_execute"].map(
					(name) => ({ name }),
				),
			setActiveTools(names: string[]) {
				activeTools = names;
			},
		});
		loaded.runtime.flagValues.set("with-plan", true);
		loaded.runtime.flagValues.set("subagents", true);
		const h = harness();
		for (const extension of loaded.extensions) {
			for (const handler of extension.handlers.get("session_start") ?? []) {
				await (handler as Handler)({ type: "session_start", reason: "startup" }, h.ctx);
			}
		}
		assert.deepEqual(activeTools, [
			"read",
			"plan_exit",
			"list_available_subagents",
			"subagent_execute",
		]);
		for (const extension of loaded.extensions) {
			for (const handler of extension.handlers.get("session_shutdown") ?? []) {
				await (handler as Handler)({ type: "session_shutdown", reason: "reload" }, h.ctx);
			}
		}
	});

	test("acquisition is idempotent and isolates runtimes", async () => {
		const first = harness();
		const second = harness();
		const policy = getToolAvailability(first.client());
		assert.equal(getToolAvailability(first.client()), policy);
		const other = getToolAvailability(second.client());
		assert.notEqual(policy, other);
		policy.update({ planMode: true });
		assert.equal(other.subagentAccess(), "full");
		await first.emit("session_shutdown", { reason: "quit" });
		assert.notEqual(getToolAvailability(first.client()), policy);
	});
});
