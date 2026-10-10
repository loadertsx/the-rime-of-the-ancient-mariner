import { describe, expect, test } from "bun:test";
import { createToolAvailability } from "../../src/tools/availability.ts";

const subagentTools = ["list_available_subagents", "subagent_execute"];
const registered = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"update_plan",
	"plan_exit",
	"custom",
	...subagentTools,
];

function harness(initial = ["read", "bash", "edit", "custom"]) {
	let tools = [...initial];
	let allTools = [...registered];
	const runtime = {
		getActiveTools: () => [...tools],
		getAllTools: () => allTools.map((name) => ({ name, description: "", parameters: {} })),
		setActiveTools(names: string[]) {
			tools = [...names];
		},
	};
	return {
		availability: createToolAvailability(runtime),
		activeTools: () => tools,
		setRegistered(names: string[]) {
			allTools = names;
		},
		runtime,
	};
}

describe("ToolAvailability", () => {
	for (const planMode of [false, true]) {
		for (const subagentsEnabled of [false, true]) {
			test(`composes planning=${planMode} and subagents=${subagentsEnabled}`, () => {
				const { availability, activeTools } = harness();
				availability.update({ planMode, subagentsEnabled });
				expect(activeTools().includes("subagent_execute")).toBe(subagentsEnabled);
				expect(activeTools().includes("edit")).toBe(!planMode);
				expect(activeTools().includes("plan_exit")).toBe(planMode);
				expect(availability.subagentAccess()).toBe(planMode ? "read-only" : "full");
				expect(availability.blockToolCall({ toolName: "edit", input: {} })?.block).toBe(
					planMode ? true : undefined,
				);
				for (const toolName of subagentTools) {
					expect(availability.blockToolCall({ toolName, input: {} })?.block).toBe(
						subagentsEnabled ? undefined : true,
					);
				}
			});
		}
	}

	test("restores the original selection with the latest subagent preference", () => {
		const { availability, activeTools } = harness();
		availability.update({ subagentsEnabled: false });
		availability.update({ planMode: true });
		expect(activeTools()).not.toContain("custom");
		availability.update({ subagentsEnabled: true });
		availability.update({ planMode: true }); // Re-entry must not capture restricted tools.
		availability.update({ planMode: false });
		expect(activeTools()).toEqual(["read", "bash", "edit", "custom", ...subagentTools]);
		expect(activeTools()).not.toContain("write");
		availability.update({ planMode: true });
		availability.update({ subagentsEnabled: false });
		availability.update({ planMode: false });
		expect(activeTools()).toEqual(["read", "bash", "edit", "custom"]);
	});

	test("subagent toggles preserve changes to unrelated tools outside planning", () => {
		const { availability, activeTools, runtime } = harness();
		availability.update({ subagentsEnabled: true });
		runtime.setActiveTools(["read", "custom", ...subagentTools]);
		availability.update({ subagentsEnabled: false });
		expect(activeTools()).toEqual(["read", "custom"]);
	});

	test("guards unsafe and malformed bash while allowing existing read-only commands", () => {
		const { availability } = harness();
		availability.update({ planMode: true });
		for (const input of [{ command: "rm -rf src" }, {}, null, undefined, { command: 42 }]) {
			expect(availability.blockToolCall({ toolName: "bash", input })?.block).toBe(true);
		}
		expect(
			availability.blockToolCall({ toolName: "bash", input: { command: "git status" } }),
		).toBeUndefined();
		expect(availability.blockToolCall({ toolName: "update_plan", input: {} })).toBeUndefined();
		availability.update({ planMode: false });
		expect(
			availability.blockToolCall({ toolName: "bash", input: { command: "rm file" } }),
		).toBeUndefined();
	});

	test("restores legacy snapshots without inheriting their subagent selection", () => {
		const { availability, activeTools } = harness();
		availability.update({ subagentsEnabled: false });
		availability.restorePlanMode({
			enabled: true,
			savedActiveTools: ["read", "custom", "plan_exit", ...subagentTools],
		});
		expect(activeTools()).not.toContain("custom");
		expect(availability.subagentAccess()).toBe("read-only");
		availability.update({ planMode: false });
		expect(activeTools()).toEqual(["read", "custom"]);
	});

	test("detached snapshots survive reload and reflect the latest preference", () => {
		const first = harness();
		first.availability.update({ planMode: true, subagentsEnabled: true });
		const snapshot = first.availability.planState();
		const second = harness(first.activeTools());
		second.availability.restorePlanMode(snapshot);
		second.availability.update({ subagentsEnabled: false });
		second.availability.update({ planMode: false });
		expect(second.activeTools()).toEqual(["read", "bash", "edit", "custom"]);
		snapshot.savedActiveTools?.push("write");
		first.availability.update({ planMode: false });
		expect(first.activeTools()).not.toContain("write");
	});

	test("preserves an empty selection and ignores tools no longer registered", () => {
		const empty = harness([]);
		empty.availability.update({ planMode: true });
		empty.availability.update({ planMode: false });
		expect(empty.activeTools()).toEqual([]);
		const h = harness();
		h.availability.update({ planMode: true });
		h.setRegistered(["read"]);
		h.availability.update({ planMode: false });
		expect(h.activeTools()).toEqual(["read"]);
	});

	test("supports snapshots predating savedActiveTools", () => {
		const { availability, activeTools } = harness();
		availability.restorePlanMode({ enabled: true });
		availability.update({ planMode: false });
		expect(activeTools()).toContain("write");
		expect(activeTools()).not.toContain("plan_exit");
		expect(activeTools()).not.toContain("subagent_execute");
	});

	test("delegated access follows state, not the presence of plan_exit", () => {
		const { availability, runtime } = harness();
		availability.update({ planMode: true });
		runtime.setActiveTools(["read"]);
		expect(availability.subagentAccess()).toBe("read-only");
		availability.update({ planMode: false });
		runtime.setActiveTools(["read", "plan_exit"]);
		expect(availability.subagentAccess()).toBe("full");
	});
});
