import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planModeExtension from "../../extensions/plan-mode.ts";
import { openPlanModeSession } from "../../src/plan-mode/session.ts";

function createHarness(
	options: { hasUI?: boolean; approved?: boolean; systemPromptPath?: string } = {},
) {
	const toolNames = [
		"read",
		"bash",
		"edit",
		"write",
		"list_available_subagents",
		"subagent_execute",
		"plan_exit",
		"update_plan",
	];
	let activeTools = [...toolNames];
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const messages: Array<{
		message: Parameters<ExtensionAPI["sendMessage"]>[0];
		options: Parameters<ExtensionAPI["sendMessage"]>[1];
		activeTools: string[];
	}> = [];
	const confirmations: string[] = [];
	const pi = {
		sendMessage(
			message: Parameters<ExtensionAPI["sendMessage"]>[0],
			options: Parameters<ExtensionAPI["sendMessage"]>[1],
		) {
			messages.push({ message, options, activeTools: [...activeTools] });
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		getActiveTools: () => [...activeTools],
		getAllTools: () => toolNames.map((name) => ({ name })),
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: options.hasUI ?? false,
		ui: {
			confirm: async (title: string) => {
				confirmations.push(title);
				return options.approved ?? false;
			},
			notify() {},
			setStatus() {},
			setWidget() {},
			getEditorComponent: () => undefined,
			setEditorComponent() {},
		},
		sessionManager: { getBranch: () => entries },
	} as unknown as ExtensionContext;

	return {
		activeTools: () => activeTools,
		messages,
		pi,
		confirmations,
		ctx,
		session: openPlanModeSession(pi, {
			systemPromptPath: options.systemPromptPath ?? "/unused/plan-system.md",
		}),
	};
}

describe("openPlanModeSession", () => {
	async function requestExit(harness: ReturnType<typeof createHarness>) {
		await harness.session.planExitTool().execute("exit", {}, undefined, undefined, harness.ctx);
	}

	test("extension waits for agent_settled before approval and execution", async () => {
		const harness = createHarness({ hasUI: true, approved: true });
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
		let exitTool: ReturnType<typeof harness.session.planExitTool> | undefined;
		Object.assign(harness.pi, {
			registerFlag() {},
			registerCommand() {},
			registerShortcut() {},
			registerTool(tool: NonNullable<typeof exitTool>) {
				exitTool = tool;
			},
			getFlag: () => true,
			events: { on() {} },
			on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) {
				handlers.set(name, handler);
			},
		});
		planModeExtension(harness.pi);
		await handlers.get("session_start")?.({}, harness.ctx);
		expect(exitTool).toBeDefined();
		await exitTool?.execute("exit", {}, undefined, undefined, harness.ctx);

		await handlers.get("agent_end")?.({}, harness.ctx);
		expect(handlers.has("agent_end")).toBe(false);
		expect(harness.confirmations).toHaveLength(0);
		expect(harness.messages).toHaveLength(0);
		expect(harness.activeTools()).not.toContain("write");

		expect(handlers.has("agent_settled")).toBe(true);
		await handlers.get("agent_settled")?.({}, harness.ctx);
		await handlers.get("agent_settled")?.({}, harness.ctx);
		expect(harness.confirmations).toHaveLength(1);
		expect(harness.messages).toHaveLength(1);
		expect(harness.messages[0].options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		expect(harness.messages[0].activeTools).toContain("write");
	});

	test("approval restores tools before starting implementation exactly once", async () => {
		const harness = createHarness({ hasUI: true, approved: true });
		const { session, ctx, messages, confirmations } = harness;
		session.handleCommand("on", ctx);
		await requestExit(harness);
		expect(messages).toHaveLength(0);

		await session.handleAgentSettled(ctx);
		await session.handleAgentSettled(ctx);

		expect(confirmations).toEqual(["Approve plan and start implementation?"]);
		expect(messages).toHaveLength(1);
		expect(messages[0].message).toEqual({
			customType: "plan-mode-execute",
			content:
				"The user approved the entire plan. Plan mode is off. Implement all approved tasks in dependency order, respecting the plan's scope. Do not ask for per-task review or approval: after completing a task, update its status and continue to the next task. Keep the progress widget current with update_plan when available and run the relevant checks. Only after the full implementation, summarize behavior and verification results for human review. If findings require changing the approved design or scope, pause for clarification.",
			display: true,
		});
		expect(messages[0].options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		expect(messages[0].activeTools).toContain("edit");
		expect(messages[0].activeTools).toContain("write");
		expect(messages[0].activeTools).not.toContain("plan_exit");
		expect(session.blockToolCall({ toolName: "write", input: {} })).toBeUndefined();
	});

	test("task metadata updates remain available during and after planning", () => {
		const { session, ctx, activeTools } = createHarness();
		session.handleCommand("on", ctx);
		expect(activeTools()).toContain("update_plan");
		expect(session.blockToolCall({ toolName: "update_plan", input: {} })).toBeUndefined();
		expect(activeTools()).not.toContain("write");
		session.handleCommand("off", ctx);
		expect(activeTools()).toContain("update_plan");
	});

	test("rejection or cancellation keeps planning active without execution", async () => {
		const harness = createHarness({ hasUI: true, approved: false });
		harness.session.handleCommand("on", harness.ctx);
		await requestExit(harness);
		await harness.session.handleAgentSettled(harness.ctx);
		await harness.session.handleAgentSettled(harness.ctx);

		expect(harness.messages).toHaveLength(0);
		expect(harness.confirmations).toHaveLength(1);
		expect(harness.activeTools()).not.toContain("write");
	});

	test("without UI exit only reports that approval is unavailable", async () => {
		const harness = createHarness();
		harness.session.handleCommand("on", harness.ctx);
		await requestExit(harness);
		await harness.session.handleAgentSettled(harness.ctx);
		await harness.session.handleAgentSettled(harness.ctx);

		expect(harness.confirmations).toHaveLength(0);
		expect(harness.messages).toHaveLength(1);
		expect(harness.messages[0].message.customType).toBe("plan-mode-exit-requested");
		expect(harness.messages[0].options).toEqual({ triggerTurn: false });
		expect(harness.activeTools()).not.toContain("write");
	});

	for (const command of ["off", "toggle"]) {
		test(`manual ${command} clears pending exit without starting implementation`, async () => {
			const harness = createHarness({ hasUI: true, approved: true });
			harness.session.handleCommand("on", harness.ctx);
			await requestExit(harness);
			harness.session.handleCommand(command, harness.ctx);
			await harness.session.handleAgentSettled(harness.ctx);

			expect(harness.messages).toHaveLength(0);
			expect(harness.confirmations).toHaveLength(0);
			expect(harness.activeTools()).toContain("write");
		});
	}

	test("injects the compact system prompt without a task placeholder", async () => {
		const { ctx, session } = createHarness({
			systemPromptPath: fileURLToPath(new URL("../../resources/plan-system.md", import.meta.url)),
		});

		session.handleCommand("on", ctx);
		const result = await session.beforeAgentStart({ systemPrompt: "Base prompt" });

		expect(result?.systemPrompt).toContain("Plan collaboratively:");
		expect(result?.systemPrompt).toContain("Native pi plan mode is active");
		expect(result?.systemPrompt).not.toContain("${planInfo}");
		expect(result?.systemPrompt).not.toContain("$@");
		expect(result?.systemPrompt).toContain("Base prompt");
		expect(result?.systemPrompt).toContain(
			"Approval of the final plan authorizes implementation of all its tasks.",
		);
		expect(result?.systemPrompt).toContain("without asking for per-task review or approval");
	});

	test("does not enable subagent tools when entering plan mode", () => {
		const { activeTools, ctx, session } = createHarness();

		session.handleCommand("on", ctx);

		expect(activeTools()).not.toContain("list_available_subagents");
		expect(activeTools()).not.toContain("subagent_execute");
		expect(activeTools()).not.toContain("edit");
		expect(activeTools()).not.toContain("write");
		expect(session.blockToolCall({ toolName: "list_available_subagents", input: {} })).toEqual({
			block: true,
			reason:
				"Plan mode blocks the list_available_subagents tool. Only read-only tools are available.",
		});
	});

	test("keeps enabled subagent tools available with plan-mode restrictions", () => {
		const { activeTools, ctx, session } = createHarness();
		session.setSubagentsEnabled(true);

		session.handleCommand("on", ctx);

		expect(activeTools()).toContain("list_available_subagents");
		expect(activeTools()).toContain("subagent_execute");
		expect(activeTools()).not.toContain("edit");
		expect(activeTools()).not.toContain("write");
		expect(
			session.blockToolCall({ toolName: "list_available_subagents", input: {} }),
		).toBeUndefined();
		expect(session.blockToolCall({ toolName: "subagent_execute", input: {} })).toBeUndefined();
	});

	test("updates subagent tools immediately while plan mode is active", () => {
		const { activeTools, ctx, session } = createHarness();
		session.handleCommand("on", ctx);

		session.setSubagentsEnabled(true);
		expect(activeTools()).toContain("list_available_subagents");
		expect(activeTools()).toContain("subagent_execute");

		session.setSubagentsEnabled(false);
		expect(activeTools()).not.toContain("list_available_subagents");
		expect(activeTools()).not.toContain("subagent_execute");
	});

	test("preserves the latest subagent state when leaving plan mode", () => {
		const { activeTools, ctx, session } = createHarness();
		session.handleCommand("on", ctx);
		session.setSubagentsEnabled(true);

		session.handleCommand("off", ctx);

		expect(activeTools()).toContain("list_available_subagents");
		expect(activeTools()).toContain("subagent_execute");

		session.handleCommand("on", ctx);
		session.setSubagentsEnabled(false);
		session.handleCommand("off", ctx);

		expect(activeTools()).not.toContain("list_available_subagents");
		expect(activeTools()).not.toContain("subagent_execute");
	});
});
