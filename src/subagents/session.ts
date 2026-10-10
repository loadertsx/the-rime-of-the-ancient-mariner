import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ToolAvailability } from "../tools/availability.js";
import type { SubagentsPreference } from "./preferences.ts";

/** Restores and saves the cwd's subagent preference, with session-local startup overrides. */
export interface SubagentsSession {
	restore(ctx: ExtensionContext, startEnabled: boolean): void;
	toggle(ctx: ExtensionContext): void;
}

export function openSubagentsSession(
	availability: ToolAvailability,
	preference: SubagentsPreference,
): SubagentsSession {
	let enabled = false;

	function apply(ctx: ExtensionContext): void {
		availability.update({ subagentsEnabled: enabled });
		if (ctx.hasUI) {
			ctx.ui.setStatus("subagents", `subagents: ${enabled ? "on" : "off"}`);
		}
	}

	function restore(ctx: ExtensionContext, startEnabled: boolean): void {
		enabled = startEnabled || preference.isEnabled(ctx.cwd);
		apply(ctx);
	}

	function toggle(ctx: ExtensionContext): void {
		const nextEnabled = !enabled;
		preference.setEnabled(ctx.cwd, nextEnabled);
		enabled = nextEnabled;
		apply(ctx);
		if (ctx.hasUI) {
			ctx.ui.notify(`Subagents ${enabled ? "enabled" : "disabled"}.`, "info");
		}
	}

	return { restore, toggle };
}
