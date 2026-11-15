import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { MicrophonePreference } from "./preferences.ts";

export const VOICE_RECORDING_SECONDS = 300;
const OUTPUT_LIMIT = 64 * 1024;
const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const PCM_BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE;
const WAV_HEADER_BYTES = 44;

export class MicrophoneUnavailableError extends Error {
	constructor() {
		super(
			"The selected microphone is missing or its name is ambiguous. Choose a microphone with /voice-mic.",
		);
	}
}

export interface RecordedAudio {
	/** Complete mono PCM WAV, valid only until the owning capture is disposed. */
	bytes: Uint8Array;
	limitReached: boolean;
}

/** Owns in-memory audio until dispose, which clears its buffer and is safe to repeat. */
export interface AudioCapture {
	result: Promise<RecordedAudio>;
	/** Finish and finalize the WAV. Cancellation uses the supplied AbortSignal instead. */
	stop(): void;
	dispose(): Promise<void>;
}

export interface VoiceRecorder {
	check(signal: AbortSignal): Promise<void>;
	/** Only uniquely named audio devices can be persisted; system default is always offered. */
	microphones(signal: AbortSignal): Promise<MicrophonePreference[]>;
	/** Rediscover the selected device immediately before capturing; never fall back silently. */
	capture(
		microphone: MicrophonePreference,
		signal: AbortSignal,
		onRecording: () => void,
	): AudioCapture;
}

interface RecorderOptions {
	launch?: (args: string[]) => ChildProcessWithoutNullStreams;
	probeTimeoutMs?: number;
	startupTimeoutMs?: number;
	stopTimeoutMs?: number;
	stallTimeoutMs?: number;
	maxDurationSeconds?: number;
}

interface ProcessResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

interface ManagedProcess {
	result: Promise<ProcessResult>;
	stop(): void;
	fail(error: Error): void;
}

function captureError(stderr: string): Error {
	if (/not authorized|permission|denied/i.test(stderr)) {
		return new Error(
			"Microphone access denied. Enable your terminal in macOS System Settings → Privacy & Security → Microphone, then retry /voice.",
		);
	}
	return new Error(
		"FFmpeg could not capture audio. Check microphone permissions and connection, then run /voice-mic.",
	);
}

/** Raw PCM avoids the unknown-length WAV headers FFmpeg writes to non-seekable pipes. */
function writeWavHeader(buffer: Buffer, pcmBytes: number): void {
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + pcmBytes, 4);
	buffer.write("WAVEfmt ", 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20); // Uncompressed PCM.
	buffer.writeUInt16LE(1, 22); // Mono.
	buffer.writeUInt32LE(SAMPLE_RATE, 24);
	buffer.writeUInt32LE(PCM_BYTES_PER_SECOND, 28);
	buffer.writeUInt16LE(BYTES_PER_SAMPLE, 32);
	buffer.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(pcmBytes, 40);
}

/** Hides FFmpeg, device indexes, process cleanup, and bounded RAM-only audio storage. */
export function createVoiceRecorder(options: RecorderOptions = {}): VoiceRecorder {
	const launch = options.launch ?? ((args) => spawn("ffmpeg", args, { stdio: "pipe" }));
	const probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
	const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
	const stopTimeoutMs = options.stopTimeoutMs ?? 2_000;
	const stallTimeoutMs = options.stallTimeoutMs ?? 20_000;
	const maxDurationSeconds = options.maxDurationSeconds ?? VOICE_RECORDING_SECONDS;
	const maxPcmBytes = Math.min(maxDurationSeconds, VOICE_RECORDING_SECONDS) * PCM_BYTES_PER_SECOND;

	function run(
		args: string[],
		signal: AbortSignal,
		timeoutMs: number,
		onAudio?: (bytes: Buffer) => void,
	): ManagedProcess {
		let child: ChildProcessWithoutNullStreams | undefined;
		let finished = false;
		let stopping = false;
		let failure: Error | undefined;
		let stdout = "";
		let stderr = "";
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		let finalWait: ReturnType<typeof setTimeout> | undefined;
		let resolve!: (result: ProcessResult) => void;
		let reject!: (error: Error) => void;
		const result = new Promise<ProcessResult>((res, rej) => {
			resolve = res;
			reject = rej;
		});

		function finish(code: number | null) {
			if (finished) return;
			finished = true;
			clearTimeout(deadline);
			clearTimeout(escalation);
			clearTimeout(finalWait);
			signal.removeEventListener("abort", abort);
			if (failure) reject(failure);
			else resolve({ code, stdout, stderr });
		}

		function terminate() {
			if (!child || finished || escalation) return;
			escalation = setTimeout(() => {
				failure ??= new Error(
					"FFmpeg did not stop cleanly. Recording discarded; try /voice again.",
				);
				child?.kill("SIGKILL");
				finalWait = setTimeout(() => {
					child?.stdin.destroy();
					child?.stdout.destroy();
					child?.stderr.destroy();
					child?.unref();
					finish(null);
				}, stopTimeoutMs);
			}, stopTimeoutMs);
		}

		function fail(error: Error) {
			if (finished) return;
			failure ??= error;
			terminate();
			if (child) child.kill("SIGTERM");
			else finish(null);
		}

		function abort() {
			fail(new Error("Voice recording cancelled."));
		}

		if (signal.aborted) abort();
		else {
			try {
				child = launch(args);
				child.on("error", (error: NodeJS.ErrnoException) => {
					failure = new Error(
						error.code === "ENOENT"
							? "FFmpeg is not installed or not on PATH. Install it with: brew install ffmpeg"
							: "Cannot start FFmpeg. Check its installation and executable permissions.",
					);
					finish(null);
				});
				child.stdin.on("error", () => {
					// A closing child may reject the stop command; close/timeout determines the result.
				});
				if (onAudio) {
					// Never decode audio as text or retain it in diagnostic output.
					child.stdout.on("data", (bytes: Buffer) => {
						if (finished || failure) return;
						try {
							onAudio(bytes);
						} catch (error) {
							fail(
								error instanceof Error ? error : new Error("Could not buffer microphone audio."),
							);
						}
					});
				} else {
					child.stdout.setEncoding("utf8");
					child.stdout.on("data", (text: string) => {
						stdout = (stdout + text).slice(-OUTPUT_LIMIT);
					});
				}
				child.stderr.setEncoding("utf8");
				child.stderr.on("data", (chunk: string) => {
					stderr = (stderr + chunk.toString()).slice(-OUTPUT_LIMIT);
				});
				child.once("close", finish);
				deadline = setTimeout(
					() =>
						fail(
							new Error(
								"FFmpeg timed out. Check microphone permissions and connection, then retry.",
							),
						),
					timeoutMs,
				);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			} catch {
				failure = new Error("Cannot start FFmpeg. Install it with: brew install ffmpeg");
				finish(null);
			}
		}

		return {
			result,
			fail,
			stop() {
				if (finished || stopping || !child) return;
				stopping = true;
				terminate();
				child.stdin.end("q\n");
			},
		};
	}

	async function devices(signal: AbortSignal): Promise<Array<{ name: string; index: number }>> {
		const result = await run(
			["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
			signal,
			probeTimeoutMs,
		).result;
		// FFmpeg normally exits nonzero after listing devices because no input was selected.
		const section = result.stderr.split("AVFoundation audio devices:")[1];
		if (section === undefined) throw captureError(result.stderr);
		const found: Array<{ name: string; index: number }> = [];
		for (const line of section.split(/\r?\n/)) {
			const match = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
			if (!match || match[2].length > 1024 || /\p{Cc}/u.test(match[2])) continue;
			found.push({ index: Number(match[1]), name: match[2] });
		}
		return found;
	}

	return {
		async check(signal) {
			const result = await run(["-hide_banner", "-devices"], signal, probeTimeoutMs).result;
			if (result.code !== 0 || !/D\s+avfoundation\b/.test(result.stdout + result.stderr)) {
				throw new Error(
					"FFmpeg must include macOS AVFoundation input support. Install it with: brew install ffmpeg",
				);
			}
		},

		async microphones(signal) {
			const available = await devices(signal);
			return [
				{ kind: "default" },
				...available
					.filter((device) => available.filter((other) => other.name === device.name).length === 1)
					.map(({ name }): MicrophonePreference => ({ kind: "device", name })),
			];
		},

		capture(microphone, signal, onRecording) {
			const controller = new AbortController();
			const combined = AbortSignal.any([signal, controller.signal]);
			let wav: Buffer | undefined;
			let recorded: RecordedAudio | undefined;
			let process: ManagedProcess | undefined;
			let stopRequested = false;
			let disposal: Promise<void> | undefined;
			function releaseAudio() {
				wav?.fill(0);
				wav = undefined;
				if (recorded) recorded.bytes = new Uint8Array(0);
			}
			const result = (async (): Promise<RecordedAudio> => {
				let watchdog: ReturnType<typeof setTimeout> | undefined;
				try {
					combined.throwIfAborted();
					let input = "default";
					if (microphone.kind === "device") {
						const matches = (await devices(combined)).filter(
							({ name }) => name === microphone.name,
						);
						if (matches.length !== 1) throw new MicrophoneUnavailableError();
						input = String(matches[0].index);
					}
					combined.throwIfAborted();
					wav = Buffer.alloc(WAV_HEADER_BYTES + maxPcmBytes);
					let pcmBytes = 0;
					let ready = false;
					process = run(
						[
							"-hide_banner",
							"-nostats",
							"-f",
							"avfoundation",
							"-i",
							`none:${input}`,
							"-vn",
							"-ac",
							"1",
							"-ar",
							String(SAMPLE_RATE),
							"-c:a",
							"pcm_s16le",
							"-t",
							String(maxDurationSeconds),
							"-f",
							"s16le",
							"pipe:1",
						],
						combined,
						maxDurationSeconds * 1000 + startupTimeoutMs + stopTimeoutMs,
						(bytes) => {
							if (!wav || combined.aborted || bytes.length === 0) return;
							if (bytes.length > maxPcmBytes - pcmBytes) {
								throw new Error(
									"Recording exceeded the in-memory audio limit. Try a shorter recording.",
								);
							}
							bytes.copy(wav, WAV_HEADER_BYTES + pcmBytes);
							pcmBytes += bytes.length;
							clearTimeout(watchdog);
							watchdog = setTimeout(
								() =>
									process?.fail(
										new Error(
											"Microphone stopped delivering audio. Check its connection and run /voice-mic.",
										),
									),
								stallTimeoutMs,
							);
							if (!ready) {
								ready = true;
								try {
									onRecording();
								} catch {
									throw new Error("Voice display could not update. Recording cancelled.");
								}
							}
						},
					);
					watchdog = setTimeout(
						() =>
							process?.fail(
								new Error(
									"Microphone did not start. Allow your terminal in macOS System Settings → Privacy & Security → Microphone, then retry /voice.",
								),
							),
						startupTimeoutMs,
					);
					if (stopRequested) process.stop();
					const output = await process.result;
					combined.throwIfAborted();
					if (output.code !== 0) throw captureError(output.stderr);
					if (!ready || pcmBytes === 0)
						throw new Error("No audio was recorded. Check your microphone and retry /voice.");
					if (pcmBytes % BYTES_PER_SAMPLE !== 0)
						throw new Error("Microphone returned incomplete audio. Try /voice again.");
					const limitReached = pcmBytes === maxPcmBytes;
					if (!stopRequested && !limitReached) throw captureError(output.stderr);
					writeWavHeader(wav, pcmBytes);
					recorded = { bytes: wav.subarray(0, WAV_HEADER_BYTES + pcmBytes), limitReached };
					return recorded;
				} catch (error) {
					releaseAudio();
					throw error;
				} finally {
					clearTimeout(watchdog);
				}
			})();
			// The caller may dispose before it starts awaiting the result.
			void result.catch(() => {});
			return {
				result,
				stop() {
					stopRequested = true;
					process?.stop();
				},
				dispose() {
					disposal ??= (async () => {
						controller.abort();
						await result.catch(() => {});
						releaseAudio();
					})();
					return disposal;
				},
			};
		},
	};
}
