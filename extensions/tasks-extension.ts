import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openTasksSession } from "../src/tasks/session.ts";

export default function tasksExtension(pi: ExtensionAPI) {
	const tasks = openTasksSession(pi);
	pi.registerTool(tasks.tool());
	pi.registerCommand("tasks", {
		description: "View all implementation tasks (read-only)",
		handler: async (_args, ctx) => tasks.show(ctx),
	});
	pi.on("session_start", (_event, ctx) => tasks.restore(ctx));
	pi.on("session_tree", (_event, ctx) => tasks.restore(ctx));
	pi.on("before_agent_start", () => tasks.contextMessage());
}
