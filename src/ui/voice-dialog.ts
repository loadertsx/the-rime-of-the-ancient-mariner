import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

export type VoicePhase = "starting" | "recording" | "stopping" | "transcribing" | "cancelling";

interface VoiceDialogOptions {
	microphone: string;
	keybindings: KeybindingsManager;
	getTheme: () => Theme;
	terminalRows: () => number;
	requestRender: () => void;
	onStop: () => void;
	onCancel: () => void;
	/** Unexpected removal must stop capture too; the owner distinguishes normal completion. */
	onDispose: () => void;
	now?: () => number;
}

const titles: Record<VoicePhase, string> = {
	starting: "Starting microphone…",
	recording: "Recording",
	stopping: "Finalizing audio…",
	transcribing: "Transcribing with OpenAI…",
	cancelling: "Cancelling…",
};

/** A compact inline screen; owns only rendering, key handling, and its refresh timer. */
export class VoiceDialog {
	private phase: VoicePhase = "starting";
	private startedAt = 0;
	private limitReached = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	private readonly now: () => number;
	private readonly options: VoiceDialogOptions;

	constructor(options: VoiceDialogOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
	}

	setPhase(phase: VoicePhase, limitReached = false): void {
		if (this.disposed || this.phase === "cancelling") return;
		if (phase === "recording" && this.phase !== "recording") {
			this.startedAt = this.now();
			this.timer = setInterval(() => this.options.requestRender(), 1000);
		} else if (phase !== "recording") {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.phase = phase;
		this.limitReached = limitReached;
		this.options.requestRender();
	}

	handleInput(data: string): void {
		if (this.disposed || this.phase === "cancelling") return;
		const { keybindings } = this.options;
		if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "ctrl+c")) {
			this.setPhase("cancelling");
			this.options.onCancel();
		} else if (this.phase === "recording" && keybindings.matches(data, "tui.select.confirm")) {
			this.setPhase("stopping");
			this.options.onStop();
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width < 1) return [];
		const { keybindings, terminalRows, getTheme } = this.options;
		const theme = getTheme();
		const elapsed = Math.max(0, Math.floor((this.now() - this.startedAt) / 1000));
		const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
		const title = titles[this.phase] + (this.phase === "recording" ? ` · ${timer}` : "");
		const cancel = `${keybindings.getKeys("tui.select.cancel").join("/")}: cancel`;
		const hint =
			this.phase === "recording"
				? `${keybindings.getKeys("tui.select.confirm").join("/")}: stop and transcribe · ${cancel}`
				: this.phase === "cancelling"
					? "Discarding recording…"
					: cancel;
		const microphone = this.limitReached
			? "Five-minute limit reached; microphone stopped."
			: `Microphone: ${this.options.microphone.replace(/\p{Cc}/gu, "")}`;
		const cap = Math.max(1, Math.min(3, terminalRows() - 1));
		const lines =
			cap === 1 ? [`${title} · ${hint}`] : cap === 2 ? [title, hint] : [title, microphone, hint];
		return lines.map((line, index) =>
			truncateToWidth(theme.fg(index === 0 ? "accent" : "muted", line), width),
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		clearInterval(this.timer);
		this.options.onDispose();
	}
}
