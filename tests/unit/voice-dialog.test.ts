import { describe, expect, test } from "bun:test";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	TUI_KEYBINDINGS,
	KeybindingsManager as TuiKeybindingsManager,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { VoiceDialog, type VoicePhase } from "../../src/ui/voice-dialog.ts";

function harness() {
	let now = 0;
	let rows = 24;
	let prefix = "";
	let stops = 0;
	let cancels = 0;
	let disposals = 0;
	const keys = new TuiKeybindingsManager(TUI_KEYBINDINGS);
	const dialog = new VoiceDialog({
		microphone: "🎙 Nahuel’s AirPods 日本語",
		keybindings: keys as unknown as KeybindingsManager,
		getTheme: () => ({ fg: (_color: string, text: string) => prefix + text }) as unknown as Theme,
		terminalRows: () => rows,
		requestRender() {},
		onStop() {
			stops++;
		},
		onCancel() {
			cancels++;
		},
		onDispose() {
			disposals++;
		},
		now: () => now,
	});
	return {
		dialog,
		keys,
		setNow: (value: number) => {
			now = value;
		},
		setRows: (value: number) => {
			rows = value;
		},
		setPrefix: (value: string) => {
			prefix = value;
		},
		stops: () => stops,
		cancels: () => cancels,
		disposals: () => disposals,
	};
}

describe("VoiceDialog", () => {
	test("Enter only stops an active recording, once", () => {
		const h = harness();
		h.dialog.handleInput("\r");
		expect(h.stops()).toBe(0);
		h.dialog.setPhase("recording");
		h.dialog.handleInput("\r");
		h.dialog.handleInput("\r");
		expect(h.stops()).toBe(1);
		expect(h.dialog.render(100)[0]).toContain("Finalizing");
		h.dialog.dispose();
	});

	for (const phase of ["starting", "recording", "stopping", "transcribing"] as VoicePhase[]) {
		test(`Esc cancels ${phase} and ignores late state updates`, () => {
			const h = harness();
			h.dialog.setPhase(phase);
			h.dialog.handleInput("\x1b");
			h.dialog.handleInput("\x1b");
			h.dialog.setPhase("recording");
			expect(h.cancels()).toBe(1);
			expect(h.dialog.render(100)[0]).toContain("Cancelling");
			h.dialog.dispose();
		});
	}

	test("reads time and theme live and explains the automatic limit", () => {
		const h = harness();
		h.dialog.setPhase("recording");
		h.setNow(65_000);
		expect(h.dialog.render(100)[0]).toContain("01:05");
		h.setPrefix("new theme: ");
		expect(h.dialog.render(100)[0]).toStartWith("new theme: ");
		h.dialog.setPhase("transcribing", true);
		expect(h.dialog.render(100).join("\n")).toContain("limit reached");
		h.dialog.dispose();
	});

	test("fits narrow/short terminals and reflects resize without cached dimensions", () => {
		const h = harness();
		for (let rows = 1; rows < 30; rows++) {
			h.setRows(rows);
			for (let width = 1; width < 100; width++) {
				const lines = h.dialog.render(width);
				expect(lines.length).toBeLessThanOrEqual(Math.max(1, Math.min(3, rows - 1)));
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
		expect(h.dialog.render(0)).toEqual([]);
		h.dialog.dispose();
	});

	test("disposal is idempotent and prevents further input or updates", () => {
		const h = harness();
		h.dialog.setPhase("recording");
		h.dialog.dispose();
		h.dialog.dispose();
		h.dialog.handleInput("\r");
		h.dialog.handleInput("\x1b");
		expect(h.disposals()).toBe(1);
		expect(h.stops()).toBe(0);
		expect(h.cancels()).toBe(0);
	});

	test("uses configured keybindings in both controls and hints", () => {
		const h = harness();
		h.keys.setUserBindings({ "tui.select.confirm": "ctrl+s", "tui.select.cancel": "ctrl+x" });
		h.dialog.setPhase("recording");
		expect(h.dialog.render(120).join("\n")).toContain("ctrl+s: stop");
		expect(h.dialog.render(120).join("\n")).toContain("ctrl+x: cancel");
		h.dialog.handleInput("\r");
		expect(h.stops()).toBe(0);
		h.dialog.handleInput("\x13");
		expect(h.stops()).toBe(1);
		h.dialog.handleInput("\x18");
		expect(h.cancels()).toBe(1);
		h.dialog.dispose();
	});

	test("Ctrl+C cancels rather than leaving the microphone running", () => {
		const h = harness();
		h.dialog.handleInput("\x03");
		expect(h.cancels()).toBe(1);
		h.dialog.dispose();
	});
});
