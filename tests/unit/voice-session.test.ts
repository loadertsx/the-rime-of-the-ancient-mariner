import { describe, expect, test } from "bun:test";
import type {
	ExtensionCommandContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	TUI_KEYBINDINGS,
	KeybindingsManager as TuiKeybindingsManager,
} from "@earendil-works/pi-tui";
import type { VoiceDialog } from "../../src/ui/voice-dialog.ts";
import type { MicrophonePreference } from "../../src/voice/preferences.ts";
import { MicrophoneUnavailableError, type RecordedAudio } from "../../src/voice/recorder.ts";
import { createVoiceSession } from "../../src/voice/session.ts";
import type { TranscribeAudio } from "../../src/voice/transcription.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Fixture is not ready");
	return value;
}

function harness(environment = { platform: "darwin", isTTY: true, isSSH: false }) {
	let microphone: MicrophonePreference = { kind: "default" };
	let selection: string | undefined = "Microphone: AirPods";
	let draft = "";
	let idle = true;
	let key: string | undefined = "private-test-key";
	let keyResolver: (() => Promise<string | undefined>) | undefined;
	let checkError: Error | undefined;
	let preferenceError: Error | undefined;
	let captureError: Error | undefined;
	let writeError: Error | undefined;
	let checks = 0;
	let captures = 0;
	let disposals = 0;
	let stops = 0;
	let reads = 0;
	let selectCalls = 0;
	let transcription: TranscribeAudio = async () => "Fix the tests.";
	const requests: string[] = [];
	const writes: MicrophonePreference[] = [];
	const keys: string[] = [];
	const notifications: Array<[string, string | undefined]> = [];
	const statuses: Array<[string, string | undefined]> = [];
	let dialog: VoiceDialog | undefined;
	let audio: ReturnType<typeof deferred<RecordedAudio>> | undefined;
	let recordingSignal: AbortSignal | undefined;
	const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;
	const ctx = {
		hasUI: true,
		isIdle: () => idle,
		modelRegistry: {
			async getApiKeyForProvider(provider: string) {
				keys.push(provider);
				return keyResolver ? keyResolver() : key;
			},
		},
		ui: {
			theme,
			notify(text: string, severity?: string) {
				notifications.push([text, severity]);
			},
			setStatus(name: string, text: string | undefined) {
				statuses.push([name, text]);
			},
			getEditorText: () => draft,
			setEditorText(text: string) {
				draft = text;
			},
			async select(_title: string, _labels: string[]) {
				selectCalls++;
				return selection;
			},
			custom(
				factory: (
					tui: unknown,
					theme: Theme,
					keybindings: KeybindingsManager,
					done: (result: unknown) => void,
				) => VoiceDialog,
			) {
				return new Promise((resolve) => {
					dialog = factory(
						{ terminal: { rows: 24 }, requestRender() {} },
						theme,
						new TuiKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager,
						(result) => {
							dialog?.dispose();
							resolve(result);
						},
					);
				});
			},
		},
	} as unknown as ExtensionCommandContext;
	const session = createVoiceSession({
		environment,
		credentialTimeoutMs: 25,
		preferences: {
			async read() {
				reads++;
				if (preferenceError) throw preferenceError;
				return microphone;
			},
			async write(value) {
				if (writeError) throw writeError;
				writes.push(value);
				microphone = value;
			},
		},
		recorder: {
			async check() {
				checks++;
				if (checkError) throw checkError;
			},
			async microphones() {
				return [{ kind: "default" }, { kind: "device", name: "AirPods" }];
			},
			capture(_microphone, signal, onRecording) {
				captures++;
				recordingSignal = signal;
				audio = deferred<RecordedAudio>();
				const pending = audio;
				const abort = () => pending.reject(new Error("cancelled"));
				signal.addEventListener("abort", abort, { once: true });
				queueMicrotask(() => {
					if (captureError) pending.reject(captureError);
					else onRecording();
				});
				return {
					result: pending.promise,
					stop() {
						stops++;
						pending.resolve({ bytes: new Uint8Array([1, 2, 3, 4]), limitReached: false });
					},
					async dispose() {
						disposals++;
						signal.removeEventListener("abort", abort);
					},
				};
			},
		},
		transcribe: async (bytes, apiKey, signal) => {
			requests.push(apiKey);
			return transcription(bytes, apiKey, signal);
		},
	});
	return {
		ctx,
		session,
		notifications,
		statuses,
		requests,
		writes,
		keys,
		dialog: () => required(dialog),
		draft: () => draft,
		setDraft: (value: string) => {
			draft = value;
		},
		setIdle: (value: boolean) => {
			idle = value;
		},
		setKey: (value: string | undefined) => {
			key = value;
		},
		setKeyResolver: (value: typeof keyResolver) => {
			keyResolver = value;
		},
		setCheckError: (value: Error) => {
			checkError = value;
		},
		setPreferenceError: (value: Error) => {
			preferenceError = value;
		},
		setWriteError: (value: Error) => {
			writeError = value;
		},
		setCaptureError: (value: Error) => {
			captureError = value;
		},
		setSelection: (value: string | undefined) => {
			selection = value;
		},
		setTranscription: (value: TranscribeAudio) => {
			transcription = value;
		},
		audio: () => required(audio),
		signal: () => required(recordingSignal),
		checks: () => checks,
		captures: () => captures,
		disposals: () => disposals,
		stops: () => stops,
		reads: () => reads,
		selections: () => selectCalls,
	};
}

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("Voice fixture did not become ready");
}

async function recording(h: ReturnType<typeof harness>) {
	await waitFor(() => h.captures() > 0);
	await Promise.resolve();
}

describe("VoiceSession", () => {
	test("setup checks prerequisites without recording, uploading, or writing preferences", async () => {
		const h = harness();
		await h.session.setup(h.ctx);
		expect(h.checks()).toBe(1);
		expect(h.keys).toEqual(["openai"]);
		expect(h.captures()).toBe(0);
		expect(h.requests).toEqual([]);
		expect(h.writes).toEqual([]);
		expect(h.notifications.at(-1)?.[0]).toContain("not validated");
		expect(JSON.stringify(h.notifications)).not.toContain("private-test-key");
		expect(h.statuses.at(-1)).toEqual(["voice", undefined]);
	});

	test("setup reports missing FFmpeg and credentials independently", async () => {
		const h = harness();
		h.setKey(undefined);
		h.setCheckError(new Error("Install FFmpeg"));
		await h.session.setup(h.ctx);
		expect(h.notifications.at(-1)?.[0]).toContain("Install FFmpeg");
		expect(h.notifications.at(-1)?.[0]).toContain("missing API key");
	});

	test("microphone selection works without credentials and can repair bad preferences", async () => {
		const h = harness();
		h.setKey(undefined);
		h.setPreferenceError(new Error("Invalid preferences"));
		await h.session.selectMicrophone(h.ctx);
		expect(h.writes).toEqual([{ kind: "device", name: "AirPods" }]);
		expect(h.reads()).toBe(0);
		expect(h.keys).toEqual([]);
		expect(h.captures()).toBe(0);
	});

	test("cancelled selection does not save and failed saves do not claim success", async () => {
		const h = harness();
		h.setSelection(undefined);
		await h.session.selectMicrophone(h.ctx);
		expect(h.writes).toHaveLength(0);
		h.setSelection("Microphone: AirPods");
		h.setWriteError(new Error("Cannot save voice preferences"));
		await h.session.selectMicrophone(h.ctx);
		expect(h.notifications.at(-1)).toEqual(["Cannot save voice preferences", "error"]);
	});

	test("record-stop-transcribe appends to the current draft without submitting", async () => {
		const h = harness();
		h.setTranscription(async (bytes) => {
			expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
			return "Fix the tests.";
		});
		h.setDraft("Existing draft");
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().handleInput("\r");
		await work;
		expect(h.stops()).toBe(1);
		expect(h.requests).toEqual(["private-test-key"]);
		expect(h.draft()).toBe("Existing draft\n\nFix the tests.");
		expect(h.disposals()).toBe(1);
		expect(h.statuses.at(-1)).toEqual(["voice", undefined]);
	});

	test("preserves draft changes made while the upload is in flight", async () => {
		const h = harness();
		const response = deferred<string>();
		h.setTranscription(async () => response.promise);
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().handleInput("\r");
		await waitFor(() => h.requests.length > 0);
		h.setDraft("New draft");
		response.resolve("Spoken text");
		await work;
		expect(h.draft()).toBe("New draft\n\nSpoken text");
	});

	test("Esc during recording cancels without uploading or changing the draft", async () => {
		const h = harness();
		h.setDraft("Keep this");
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().handleInput("\x1b");
		await work;
		expect(h.requests).toHaveLength(0);
		expect(h.draft()).toBe("Keep this");
		expect(h.disposals()).toBe(1);
		expect(h.notifications).toHaveLength(0);
	});

	test("Esc during upload suppresses late results and keeps cleanup serialized", async () => {
		const h = harness();
		const response = deferred<string>();
		h.setTranscription(async () => response.promise);
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().handleInput("\r");
		await waitFor(() => h.requests.length > 0);
		h.dialog().handleInput("\x1b");
		await h.session.dictate(h.ctx);
		expect(h.notifications.at(-1)?.[0]).toContain("Wait");
		response.resolve("Too late");
		await work;
		expect(h.signal().aborted).toBe(true);
		expect(h.draft()).toBe("");
		expect(h.disposals()).toBe(1);
	});

	test("shutdown is idempotent, stops capture, and blocks further commands", async () => {
		const h = harness();
		const work = h.session.dictate(h.ctx);
		await recording(h);
		await Promise.all([h.session.dispose(), h.session.dispose()]);
		await work;
		expect(h.signal().aborted).toBe(true);
		expect(h.disposals()).toBe(1);
		expect(h.draft()).toBe("");
		await h.session.dictate(h.ctx);
		expect(h.captures()).toBe(1);
	});

	test("shutdown aborts upload, clears status, and does not insert a late result", async () => {
		const h = harness();
		h.setTranscription(
			async (_bytes, _key, signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				}),
		);
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().handleInput("\r");
		await waitFor(() => h.requests.length > 0);
		await h.session.dispose();
		await work;
		expect(h.disposals()).toBe(1);
		expect(h.draft()).toBe("");
		expect(h.statuses.at(-1)).toEqual(["voice", undefined]);
	});

	test("a failed UI mount aborts an already-started capture and reports recovery", async () => {
		const h = harness();
		const custom = h.ctx.ui.custom.bind(h.ctx.ui);
		h.ctx.ui.custom = async (factory, options) => {
			void custom(factory, options);
			throw new Error("UI mount failed");
		};
		await h.session.dictate(h.ctx);
		expect(h.captures()).toBe(1);
		expect(h.signal().aborted).toBe(true);
		expect(h.disposals()).toBe(1);
		expect(h.notifications.at(-1)).toEqual(["Voice UI failed. Recording cancelled.", "error"]);
	});

	test("shutdown dismisses a pending microphone picker without saving", async () => {
		const h = harness();
		let pickerOpened = false;
		h.ctx.ui.select = async (_title, _choices, options) =>
			new Promise((resolve) => {
				pickerOpened = true;
				options?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
			});
		const work = h.session.selectMicrophone(h.ctx);
		await waitFor(() => pickerOpened);
		await h.session.dispose();
		await work;
		expect(h.writes).toHaveLength(0);
		expect(h.statuses.at(-1)).toEqual(["voice", undefined]);
	});

	test("unexpected dialog disposal cancels recording", async () => {
		const h = harness();
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().dispose();
		await work;
		expect(h.signal().aborted).toBe(true);
		expect(h.disposals()).toBe(1);
	});

	test("limit completion uploads and reports the limit in the dialog", async () => {
		const h = harness();
		const response = deferred<string>();
		h.setTranscription(async () => response.promise);
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.audio().resolve({ bytes: new Uint8Array([1, 2, 3, 4]), limitReached: true });
		await waitFor(() => h.requests.length > 0);
		expect(h.dialog().render(100).join("\n")).toContain("limit reached");
		response.resolve("Transcript");
		await work;
		expect(h.draft()).toBe("Transcript");
	});

	test("a missing device opens the picker without starting a replacement recording", async () => {
		const h = harness();
		h.setCaptureError(new MicrophoneUnavailableError());
		await h.session.dictate(h.ctx);
		expect(h.selections()).toBe(1);
		expect(h.writes).toEqual([{ kind: "device", name: "AirPods" }]);
		expect(h.captures()).toBe(1);
		expect(h.requests).toHaveLength(0);
		expect(h.notifications.at(-1)?.[0]).toContain("Run /voice");
	});

	test("recording and upload failures leave the editor alone and release the operation lock", async () => {
		const h = harness();
		h.setTranscription(async () => {
			throw new Error("API quota exceeded");
		});
		const work = h.session.dictate(h.ctx);
		await recording(h);
		h.dialog().handleInput("\r");
		await work;
		expect(h.draft()).toBe("");
		expect(h.notifications.at(-1)).toEqual(["API quota exceeded", "error"]);
		expect(h.disposals()).toBe(1);
		await h.session.selectMicrophone(h.ctx);
		expect(h.writes).toHaveLength(1);
	});

	test("missing credentials fail before opening the microphone", async () => {
		const h = harness();
		h.setKey(undefined);
		await h.session.dictate(h.ctx);
		expect(h.captures()).toBe(0);
		expect(h.checks()).toBe(0);
		expect(h.notifications.at(-1)?.[0]).toContain("API key is required");
	});

	test("credential errors cannot expose secret-manager output", async () => {
		const h = harness();
		h.setKeyResolver(async () => {
			throw new Error("secret-key-from-command");
		});
		await h.session.dictate(h.ctx);
		expect(JSON.stringify(h.notifications)).not.toContain("secret-key-from-command");
		expect(h.notifications.at(-1)?.[0]).toContain("Cannot resolve OpenAI");
	});

	test("credential lookup is bounded and shutdown does not wait for late secrets", async () => {
		const h = harness();
		const key = deferred<string>();
		h.setKeyResolver(async () => key.promise);
		await h.session.dictate(h.ctx);
		expect(h.notifications.at(-1)?.[0]).toContain("timed out");
		const work = h.session.dictate(h.ctx);
		await waitFor(() => h.keys.length === 2);
		await h.session.dispose();
		key.resolve("late-key");
		await work;
		expect(h.captures()).toBe(0);
	});

	test("busy agents and simultaneous voice commands do not start extra work", async () => {
		const h = harness();
		h.setIdle(false);
		await h.session.dictate(h.ctx);
		expect(h.keys).toHaveLength(0);
		h.setIdle(true);
		const work = h.session.dictate(h.ctx);
		await recording(h);
		await h.session.selectMicrophone(h.ctx);
		expect(h.selections()).toBe(0);
		h.dialog().handleInput("\x1b");
		await work;
	});

	for (const environment of [
		{ platform: "linux", isTTY: true, isSSH: false },
		{ platform: "darwin", isTTY: false, isSSH: false },
		{ platform: "darwin", isTTY: true, isSSH: true },
	]) {
		test(`unsupported environment stays inert: ${JSON.stringify(environment)}`, async () => {
			const h = harness(environment);
			await h.session.dictate(h.ctx);
			expect(h.checks()).toBe(0);
			expect(h.keys).toHaveLength(0);
			expect(h.notifications).toHaveLength(1);
		});
	}

	test("newer Pi mode guard rejects RPC even when hasUI is true", async () => {
		const h = harness();
		Object.assign(h.ctx, { mode: "rpc" });
		await h.session.setup(h.ctx);
		expect(h.checks()).toBe(0);
		expect(h.notifications.at(-1)?.[0]).toContain("local interactive");
	});
});
