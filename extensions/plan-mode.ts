import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openPlanModeSession } from "../src/plan-mode/session.ts";
import { getToolAvailability } from "../src/tools/availability.ts";

export default function planModeExtension(pi: ExtensionAPI) {
	const baseDir = dirname(fileURLToPath(import.meta.url));
	const availability = getToolAvailability(pi);
	const planMode = openPlanModeSession(
		pi,
		{ systemPromptPath: join(baseDir, "..", "resources", "plan-system.md") },
		availability,
	);

	pi.registerFlag("with-plan", {
		description: "Start in native plan mode (read-only planning)",
		type: "boolean",
		default: false,
	});

	pi.registerTool(planMode.planExitTool());

	pi.registerCommand("plan-mode", {
		description: "Toggle native read-only plan mode",
		handler: async (args, ctx) => planMode.handleCommand(args, ctx),
	});

	pi.registerShortcut("shift+tab", {
		description: "Toggle native read-only plan mode",
		handler: async (ctx) => planMode.handleCommand("toggle", ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		planMode.restore(ctx, pi.getFlag("with-plan") === true);
	});

	pi.on("before_agent_start", async (event) => planMode.beforeAgentStart(event));

	// agent_end still runs inside the active loop; start implementation only after it settles.
	pi.on("agent_settled", async (_event, ctx) => {
		await planMode.handleAgentSettled(ctx);
	});
}
