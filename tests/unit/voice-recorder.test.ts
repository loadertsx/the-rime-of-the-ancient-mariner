import { describe, expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { MicrophoneUnavailableError, createVoiceRecorder } from "../../src/voice/recorder.ts";

class FakeChild extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	signals: string[] = [];
	closed = false;
	ignoreTerm = false;
	ignoreKill = false;
	unref() {}
	close(code: number | null = 0) {
		if (this.closed) return;
		this.closed = true;
		this.emit("close", code);
	}
	kill(signal: string) {
		this.signals.push(signal);
		if ((signal === "SIGTERM" && this.ignoreTerm) || this.ignoreKill) return true;
		queueMicrotask(() => this.close(null));
		return true;
	}
}

function harness(
	options: {
		audio?: boolean;
		stop?: boolean;
		size?: number;
		ignoreTerm?: boolean;
		ignoreKill?: boolean;
		stallTimeoutMs?: number;
	} = {},
) {
	let deviceLines = "[avfoundation @ 0] [0] Mac Microphone\n[avfoundation @ 0] [2] AirPods";
	const invocations: string[][] = [];
	const recordings: Array<{ child: FakeChild; pcm: Buffer }> = [];
	const recorder = createVoiceRecorder({
		launch(args) {
			invocations.push(args);
			const child = new FakeChild();
			child.ignoreTerm = options.ignoreTerm ?? false;
			child.ignoreKill = options.ignoreKill ?? false;
			queueMicrotask(() => {
				if (args.includes("-devices")) {
					child.stdout.write(" D  avfoundation    AVFoundation input device\n");
					child.close();
				} else if (args.includes("-list_devices")) {
					child.stderr.write(
						`[avfoundation @ 0] AVFoundation video devices:\n[avfoundation @ 0] [0] Camera\n[avfoundation @ 0] AVFoundation audio devices:\n${deviceLines}\n`,
					);
					child.close(1);
				} else {
					const pcm = Buffer.alloc(options.size ?? 200, 0xa5);
					recordings.push({ child, pcm });
					if (options.audio !== false) child.stdout.write(pcm);
					child.stdin.on("data", () => {
						if (options.stop !== false) queueMicrotask(() => child.close());
					});
				}
			});
			return child as unknown as ChildProcessWithoutNullStreams;
		},
		startupTimeoutMs: 30,
		stopTimeoutMs: 10,
		stallTimeoutMs: options.stallTimeoutMs ?? 1000,
		maxDurationSeconds: 1,
	});
	return {
		recorder,
		recordings,
		invocations,
		devices: (lines: string) => {
			deviceLines = lines;
		},
	};
}

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("Fixture did not become ready");
}

const signal = () => new AbortController().signal;

describe("FFmpeg recorder", () => {
	test("checks the backend and parses only audio devices despite enumeration exit code 1", async () => {
		const h = harness();
		await h.recorder.check(signal());
		expect(await h.recorder.microphones(signal())).toEqual([
			{ kind: "default" },
			{ kind: "device", name: "Mac Microphone" },
			{ kind: "device", name: "AirPods" },
		]);
	});

	test("resolves fresh indexes, captures audio only, finalizes on stop, and cleans up idempotently", async () => {
		const h = harness();
		await h.recorder.microphones(signal());
		h.devices("[avfoundation @ 0] [7] AirPods");
		let ready = false;
		const capture = h.recorder.capture({ kind: "device", name: "AirPods" }, signal(), () => {
			ready = true;
		});
		await waitFor(() => ready);
		expect(h.invocations.at(-1)).toContain("none:7");
		expect(h.invocations.at(-1)).toContain("pcm_s16le");
		expect(h.invocations.at(-1)).toContain("s16le");
		expect(h.invocations.at(-1)?.at(-1)).toBe("pipe:1");
		expect(h.invocations.at(-1)).not.toContain("-progress");
		capture.stop();
		capture.stop();
		const audio = await capture.result;
		expect(audio.limitReached).toBe(false);
		expect(audio).not.toHaveProperty("path");
		const bytes = audio.bytes;
		const wav = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		expect(wav.length).toBe(244);
		expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
		expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
		expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
		expect(wav.readUInt32LE(16)).toBe(16);
		expect(wav.readUInt16LE(20)).toBe(1);
		expect(wav.readUInt16LE(22)).toBe(1);
		expect(wav.readUInt32LE(24)).toBe(16000);
		expect(wav.readUInt32LE(28)).toBe(32000);
		expect(wav.readUInt16LE(32)).toBe(2);
		expect(wav.readUInt16LE(34)).toBe(16);
		expect(wav.toString("ascii", 36, 40)).toBe("data");
		expect(wav.readUInt32LE(40)).toBe(200);
		expect(wav.subarray(44)).toEqual(h.recordings[0].pcm);
		await capture.dispose();
		await capture.dispose();
		expect(audio.bytes.byteLength).toBe(0);
		expect(bytes.every((byte) => byte === 0)).toBe(true);
	});

	test("system default deliberately uses the AVFoundation default alias", async () => {
		const h = harness();
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => h.recordings.length > 0);
		expect(h.invocations.at(-1)).toContain("none:default");
		capture.stop();
		await capture.result;
		await capture.dispose();
	});

	test("missing or ambiguous devices never fall back to another input", async () => {
		for (const lines of [
			"[avfoundation @ 0] [0] Mac",
			"[avfoundation @ 0] [0] AirPods\n[avfoundation @ 0] [1] AirPods",
		]) {
			const h = harness();
			h.devices(lines);
			const capture = h.recorder.capture({ kind: "device", name: "AirPods" }, signal(), () => {});
			await expect(capture.result).rejects.toBeInstanceOf(MicrophoneUnavailableError);
			expect(h.recordings).toHaveLength(0);
			await capture.dispose();
		}
	});

	test("picker omits duplicate names that cannot be persisted reliably", async () => {
		const h = harness();
		h.devices("[avfoundation @ 0] [0] USB\n[avfoundation @ 0] [1] USB");
		expect(await h.recorder.microphones(signal())).toEqual([{ kind: "default" }]);
	});

	test("cancel stops the child and discards buffered audio", async () => {
		const h = harness();
		const controller = new AbortController();
		const capture = h.recorder.capture({ kind: "default" }, controller.signal, () => {});
		await waitFor(() => h.recordings.length > 0);
		controller.abort();
		await expect(capture.result).rejects.toThrow();
		await capture.dispose();
		expect(h.recordings[0].child.signals).toContain("SIGTERM");
		expect(h.recordings[0].child.closed).toBe(true);
	});

	test("already-cancelled capture never launches FFmpeg", async () => {
		const h = harness();
		const controller = new AbortController();
		controller.abort();
		const capture = h.recorder.capture({ kind: "default" }, controller.signal, () => {});
		await expect(capture.result).rejects.toThrow();
		await capture.dispose();
		expect(h.invocations).toHaveLength(0);
	});

	test("unresponsive graceful stop escalates and discards the recording", async () => {
		const h = harness({ stop: false });
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => h.recordings.length > 0);
		capture.stop();
		await expect(capture.result).rejects.toThrow("did not stop cleanly");
		expect(h.recordings[0].child.signals).toContain("SIGKILL");
		await capture.dispose();
	});

	test("even a child that never closes cannot keep disposal waiting forever", async () => {
		const h = harness({ ignoreTerm: true, ignoreKill: true });
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => h.recordings.length > 0);
		await capture.dispose();
		expect(h.recordings[0].child.signals).toEqual(["SIGTERM", "SIGKILL"]);
		expect(h.recordings[0].child.stdout.destroyed).toBe(true);
	});

	test("startup timeout explains permission recovery and cleans the recording", async () => {
		const h = harness({ audio: false });
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await expect(capture.result).rejects.toThrow("Microphone did not start");
		expect(h.recordings[0].child.closed).toBe(true);
		await capture.dispose();
	});

	test("rejects empty audio and unexpected capture termination", async () => {
		const empty = harness({ size: 0 });
		const capture = empty.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => empty.recordings.length > 0);
		capture.stop();
		await expect(capture.result).rejects.toThrow("No audio");
		await capture.dispose();
		const disconnected = harness();
		const other = disconnected.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => disconnected.recordings.length > 0);
		disconnected.recordings[0].child.close();
		await expect(other.result).rejects.toThrow("could not capture");
		await other.dispose();
	});

	test("stalled audio and display failures stop capture and discard audio", async () => {
		const stalled = harness({ stallTimeoutMs: 15 });
		const first = stalled.recorder.capture({ kind: "default" }, signal(), () => {});
		await expect(first.result).rejects.toThrow("stopped delivering audio");
		await first.dispose();
		expect(stalled.recordings[0].child.closed).toBe(true);
		const broken = harness();
		const second = broken.recorder.capture({ kind: "default" }, signal(), () => {
			throw new Error("UI is unavailable");
		});
		await expect(second.result).rejects.toThrow("display could not update");
		await second.dispose();
		expect(broken.recordings[0].child.signals).toContain("SIGTERM");
	});

	test("audio bytes signal readiness and permission failures are reported safely", async () => {
		const h = harness({ audio: false });
		let ready = false;
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {
			ready = true;
		});
		await waitFor(() => h.recordings.length > 0);
		const child = h.recordings[0].child;
		child.stdout.write(Buffer.from([0x80, 0xff]));
		expect(ready).toBe(true);
		child.stderr.write("permission denied: raw diagnostic must not be shown");
		child.close(1);
		await expect(capture.result).rejects.toThrow("Microphone access denied");
		await capture.dispose();
	});

	test("probe timeouts and cancellation terminate their processes", async () => {
		const children: FakeChild[] = [];
		const recorder = createVoiceRecorder({
			probeTimeoutMs: 15,
			stopTimeoutMs: 10,
			launch() {
				const child = new FakeChild();
				children.push(child);
				return child as unknown as ChildProcessWithoutNullStreams;
			},
		});
		await expect(recorder.check(signal())).rejects.toThrow("timed out");
		expect(children[0].signals).toEqual(["SIGTERM"]);
		const controller = new AbortController();
		const listing = recorder.microphones(controller.signal);
		controller.abort();
		await expect(listing).rejects.toThrow("cancelled");
		expect(children[1].signals).toEqual(["SIGTERM"]);
	});

	test("duration-limit completion is successful and marked for the UI", async () => {
		const h = harness();
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => h.recordings.length > 0);
		h.recordings[0].child.stdout.write(Buffer.alloc(32000 - h.recordings[0].pcm.length));
		h.recordings[0].child.close();
		const audio = await capture.result;
		expect(audio.limitReached).toBe(true);
		expect(audio.bytes.byteLength).toBe(32044);
		await capture.dispose();
	});

	test("preserves binary PCM across chunks split in the middle of a sample", async () => {
		const h = harness({ audio: false });
		let readyCalls = 0;
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {
			readyCalls++;
		});
		await waitFor(() => h.recordings.length > 0);
		const pcm = Buffer.from([0xff, 0x80, 0x00, 0x1b, 0x0a, 0x0d, 0xc0, 0xfe]);
		const child = h.recordings[0].child;
		child.stdout.write(pcm.subarray(0, 1));
		child.stdout.write(pcm.subarray(1, 3));
		child.stdout.write(pcm.subarray(3));
		capture.stop();
		const audio = await capture.result;
		expect(Buffer.from(audio.bytes.subarray(44))).toEqual(pcm);
		expect(readyCalls).toBe(1);
		await capture.dispose();
	});

	test("rejects oversized audio immediately instead of growing the buffer", async () => {
		const h = harness({ size: 32002 });
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await expect(capture.result).rejects.toThrow("in-memory audio limit");
		expect(h.recordings[0].child.signals).toContain("SIGTERM");
		await capture.dispose();
	});

	test("rejects incomplete PCM samples instead of uploading a malformed WAV", async () => {
		const h = harness({ size: 3 });
		const capture = h.recorder.capture({ kind: "default" }, signal(), () => {});
		await waitFor(() => h.recordings.length > 0);
		capture.stop();
		await expect(capture.result).rejects.toThrow("incomplete audio");
		await capture.dispose();
	});

	test("missing executable and unsupported backend have actionable diagnostics", async () => {
		const missing = createVoiceRecorder({
			launch() {
				throw new Error("not found");
			},
		});
		await expect(missing.check(signal())).rejects.toThrow("brew install ffmpeg");
		const unsupported = createVoiceRecorder({
			launch() {
				const child = new FakeChild();
				queueMicrotask(() => child.close());
				return child as unknown as ChildProcessWithoutNullStreams;
			},
		});
		await expect(unsupported.check(signal())).rejects.toThrow("AVFoundation");
	});
});
