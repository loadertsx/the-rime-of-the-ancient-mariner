import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { VoiceDialog } from "../ui/voice-dialog.ts";
import {
	type MicrophonePreference,
	type VoicePreferences,
	openVoicePreferences,
} from "./preferences.ts";
import { MicrophoneUnavailableError, type VoiceRecorder, createVoiceRecorder } from "./recorder.ts";
import { type TranscribeAudio, createTranscriber } from "./transcription.ts";

/** User-facing voice operations. No resources are started until a command is invoked. */
export interface VoiceSession {
	setup(ctx: ExtensionCommandContext): Promise<void>;
	selectMicrophone(ctx: ExtensionCommandContext): Promise<void>;
	dictate(ctx: ExtensionCommandContext): Promise<void>;
	/** Cancels pending work and waits for recording cleanup; safe on repeated shutdown. */
	dispose(): Promise<void>;
}

interface VoiceSessionOptions {
	preferences?: VoicePreferences;
	recorder?: VoiceRecorder;
	transcribe?: TranscribeAudio;
	environment?: { platform: string; isTTY: boolean; isSSH: boolean };
	credentialTimeoutMs?: number;
}

interface Operation {
	controller: AbortController;
	finished: Promise<void>;
	clearStatus(): void;
}

type DictationResult =
	| { kind: "text"; text: string }
	| { kind: "error"; error: unknown }
	| { kind: "cancelled" };

function microphoneLabel(microphone: MicrophonePreference): string {
	return microphone.kind === "default" ? "System default" : microphone.name;
}

function message(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Voice operation failed. Run /voice setup and try again.";
}

export function createVoiceSession(options: VoiceSessionOptions = {}): VoiceSession {
	const preferences = options.preferences ?? openVoicePreferences();
	const recorder = options.recorder ?? createVoiceRecorder();
	const transcribe = options.transcribe ?? createTranscriber();
	const environment = options.environment ?? {
		platform: process.platform,
		isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
		isSSH: Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY),
	};
	let active: Operation | undefined;
	let closed = false;

	async function run(
		ctx: ExtensionCommandContext,
		work: (signal: AbortSignal, cancel: () => void) => Promise<void>,
	) {
		if (closed) return;
		// ctx.mode exists in newer Pi releases; older releases need the terminal check as well as hasUI.
		const mode = (ctx as ExtensionCommandContext & { mode?: string }).mode;
		if (
			!ctx.hasUI ||
			!environment.isTTY ||
			(mode !== undefined && mode !== "tui") ||
			environment.isSSH
		) {
			ctx.ui.notify(
				"Voice requires local interactive pi; RPC, print mode, and SSH microphone forwarding are not supported.",
				"warning",
			);
			return;
		}
		if (environment.platform !== "darwin") {
			ctx.ui.notify(
				"Voice currently supports macOS only. Other package features remain available.",
				"warning",
			);
			return;
		}
		if (active || !ctx.isIdle()) {
			ctx.ui.notify(
				"Wait for the current voice operation or agent response to finish, then try again.",
				"warning",
			);
			return;
		}
		let finish!: () => void;
		const operation: Operation = {
			controller: new AbortController(),
			clearStatus: () => ctx.ui.setStatus("voice", undefined),
			finished: new Promise<void>((resolve) => {
				finish = resolve;
			}),
		};
		active = operation;
		try {
			ctx.ui.setStatus("voice", "voice: checking prerequisites…");
			await work(operation.controller.signal, () => operation.controller.abort());
		} catch (error) {
			if (!closed && !operation.controller.signal.aborted) ctx.ui.notify(message(error), "error");
		} finally {
			operation.controller.abort();
			if (active === operation) active = undefined;
			try {
				if (!closed) ctx.ui.setStatus("voice", undefined);
			} finally {
				finish();
			}
		}
	}

	async function apiKey(
		ctx: ExtensionCommandContext,
		signal: AbortSignal,
	): Promise<string | undefined> {
		// Credential commands may not accept a signal. Bound our wait and discard late results.
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() =>
					settle(
						new Error(
							"OpenAI credential lookup timed out. Check pi's OpenAI credential configuration.",
						),
					),
				options.credentialTimeoutMs ?? 10_000,
			);
			const abort = () => settle(new Error("Voice cancelled."));
			function settle(error?: Error, key?: string) {
				clearTimeout(timeout);
				signal.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(key?.trim() || undefined);
			}
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) {
				abort();
				return;
			}
			Promise.resolve()
				.then(() => ctx.modelRegistry.getApiKeyForProvider("openai"))
				.then(
					(key) => settle(undefined, key),
					() =>
						settle(
							new Error(
								"Cannot resolve OpenAI credentials. Run /login and choose OpenAI API-key authentication.",
							),
						),
				);
		});
	}

	async function chooseMicrophone(
		ctx: ExtensionCommandContext,
		signal: AbortSignal,
	): Promise<boolean> {
		const microphones = await recorder.microphones(signal);
		signal.throwIfAborted();
		const labels = microphones.map((microphone) =>
			microphone.kind === "default"
				? "System default (follow macOS input settings)"
				: `Microphone: ${microphone.name}`,
		);
		const selected = await ctx.ui.select(
			"Select microphone (only unique device names are listed)",
			labels,
			{ signal },
		);
		signal.throwIfAborted();
		if (selected === undefined) return false;
		const index = labels.indexOf(selected);
		if (index < 0) return false;
		await preferences.write(microphones[index]);
		signal.throwIfAborted();
		ctx.ui.notify(`Voice microphone: ${microphoneLabel(microphones[index])}`, "info");
		return true;
	}

	return {
		setup(ctx) {
			return run(ctx, async (signal) => {
				const checks: string[] = [];
				try {
					await recorder.check(signal);
					checks.push("FFmpeg: installed with AVFoundation support.");
				} catch (error) {
					checks.push(message(error));
				}
				signal.throwIfAborted();
				try {
					checks.push(
						(await apiKey(ctx, signal))
							? "OpenAI: API credential configured (not validated; billing/model access not checked)."
							: "OpenAI: missing API key. Run /login → OpenAI (API key), or set OPENAI_API_KEY before starting pi. ChatGPT/Codex subscription login is not sufficient.",
					);
				} catch (error) {
					checks.push(message(error));
				}
				signal.throwIfAborted();
				try {
					checks.push(`Microphone: ${microphoneLabel(await preferences.read())}.`);
				} catch (error) {
					checks.push(message(error));
				}
				signal.throwIfAborted();
				checks.push(
					"Choose a microphone with /voice-mic. Permission is checked when recording starts; allow your terminal in macOS System Settings → Privacy & Security → Microphone.",
				);
				checks.push(
					"/voice records up to five minutes, then uploads directly to OpenAI gpt-transcribe using your API account. Audio stays in RAM; no audio files are created. The recording buffer is cleared after completion/cancellation. This setup check records and uploads nothing.",
				);
				ctx.ui.notify(checks.join("\n\n"), "info");
			});
		},

		selectMicrophone(ctx) {
			return run(ctx, async (signal) => {
				await recorder.check(signal);
				await chooseMicrophone(ctx, signal);
			});
		},

		dictate(ctx) {
			return run(ctx, async (signal, abort) => {
				const key = await apiKey(ctx, signal);
				if (!key)
					throw new Error(
						"An OpenAI API key is required. Run /voice setup for instructions; ChatGPT/Codex login alone does not enable transcription.",
					);
				await recorder.check(signal);
				const microphone = await preferences.read();
				signal.throwIfAborted();
				let workflow: Promise<DictationResult> | undefined;
				try {
					await ctx.ui.custom<DictationResult>((tui, theme, keybindings, done) => {
						let finished = false;
						let stop: (() => void) | undefined;
						const dialog = new VoiceDialog({
							microphone: microphoneLabel(microphone),
							keybindings,
							getTheme: () => ctx.ui.theme ?? theme,
							terminalRows: () => tui.terminal.rows,
							requestRender: () => {
								if (!closed && !finished) tui.requestRender();
							},
							onStop: () => stop?.(),
							onCancel: abort,
							onDispose: () => {
								if (!finished) abort();
							},
						});
						function finish(result: DictationResult) {
							if (finished) return;
							finished = true;
							signal.removeEventListener("abort", cancel);
							dialog.dispose();
							done(result);
						}
						const cancel = () => finish({ kind: "cancelled" });
						signal.addEventListener("abort", cancel, { once: true });
						workflow = (async (): Promise<DictationResult> => {
							signal.throwIfAborted();
							ctx.ui.setStatus("voice", "voice: starting microphone…");
							const capture = recorder.capture(microphone, signal, () => {
								if (closed || signal.aborted) return;
								dialog.setPhase("recording");
								ctx.ui.setStatus("voice", `voice: recording · ${microphoneLabel(microphone)}`);
							});
							stop = () => capture.stop();
							try {
								const audio = await capture.result;
								signal.throwIfAborted();
								dialog.setPhase("transcribing", audio.limitReached);
								ctx.ui.setStatus("voice", "voice: transcribing…");
								const text = await transcribe(audio.bytes, key, signal);
								signal.throwIfAborted();
								return { kind: "text", text };
							} finally {
								await capture.dispose();
							}
						})().catch((error): DictationResult => ({ kind: "error", error }));
						void workflow.then(finish);
						if (signal.aborted) cancel();
						return dialog;
					});
				} catch (error) {
					if (!closed && !signal.aborted)
						ctx.ui.notify("Voice UI failed. Recording cancelled.", "error");
					abort();
					throw error;
				} finally {
					// Cancellation may close the dialog before FFmpeg exits. Keep the operation locked until cleanup finishes.
					await workflow;
				}
				if (closed || signal.aborted) return;
				const result = await workflow;
				if (!result) throw new Error("Voice requires pi's interactive terminal UI.");
				if (result.kind === "error") {
					if (result.error instanceof MicrophoneUnavailableError) {
						ctx.ui.notify(result.error.message, "warning");
						if (await chooseMicrophone(ctx, signal))
							ctx.ui.notify("Microphone updated. Run /voice to record.", "info");
						return;
					}
					throw result.error;
				}
				if (result.kind !== "text") return;
				const draft = ctx.ui.getEditorText();
				ctx.ui.setEditorText(draft ? `${draft}\n\n${result.text}` : result.text);
				ctx.ui.notify("Transcript added to the editor. Review it, then submit when ready.", "info");
			});
		},

		async dispose() {
			closed = true;
			const operation = active;
			operation?.controller.abort();
			try {
				operation?.clearStatus();
			} finally {
				await operation?.finished;
			}
		},
	};
}
