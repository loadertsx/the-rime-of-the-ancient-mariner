import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentsPreference } from "./preferences.ts";

export const SUBAGENT_TOOL_NAMES = ["list_available_subagents", "subagent_execute"] as const;
export const SUBAGENTS_AVAILABILITY_CHANGED_EVENT = "subagents:availability-changed";

export interface SubagentsAvailabilityChanged {
	enabled: boolean;
}

export interface SubagentsToolCall {
	toolName: string;
}

export interface SubagentsToolBlockResult {
	block: true;
	reason: string;
}

/** Controls subagent tool availability for the current extension runtime. */
export interface SubagentsSession {
	restore(ctx: ExtensionContext, startEnabled: boolean): void;
	toggle(ctx: ExtensionContext): void;
	blockToolCall(event: SubagentsToolCall): SubagentsToolBlockResult | undefined;
}

export function openSubagentsSession(
	pi: ExtensionAPI,
	preference: SubagentsPreference,
): SubagentsSession {
	let enabled = false;

	function availableSubagentTools(): string[] {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		return SUBAGENT_TOOL_NAMES.filter((name) => available.has(name));
	}

	function applyToolAvailability(): void {
		const subagentTools = new Set<string>(SUBAGENT_TOOL_NAMES);
		const activeTools = pi.getActiveTools().filter((name) => !subagentTools.has(name));

		if (enabled) {
			activeTools.push(...availableSubagentTools());
		}

		pi.setActiveTools([...new Set(activeTools)]);
	}

	function refreshUi(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("subagents", `subagents: ${enabled ? "on" : "off"}`);
	}

	function publishAvailability(): void {
		pi.events.emit(SUBAGENTS_AVAILABILITY_CHANGED_EVENT, {
			enabled,
		} satisfies SubagentsAvailabilityChanged);
	}

	function apply(ctx: ExtensionContext): void {
		applyToolAvailability();
		refreshUi(ctx);
		publishAvailability();
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

	function blockToolCall(event: SubagentsToolCall): SubagentsToolBlockResult | undefined {
		if (
			enabled ||
			!SUBAGENT_TOOL_NAMES.includes(event.toolName as (typeof SUBAGENT_TOOL_NAMES)[number])
		) {
			return undefined;
		}

		return {
			block: true,
			reason: "Subagents are disabled. Run /subagents to enable them.",
		};
	}

	return {
		restore,
		toggle,
		blockToolCall,
	};
}
