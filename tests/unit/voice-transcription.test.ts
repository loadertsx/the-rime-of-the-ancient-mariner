import { describe, expect, test } from "bun:test";
import { createTranscriber } from "../../src/voice/transcription.ts";

function audio(): Uint8Array {
	return new Uint8Array(100).fill(0xa5);
}
const signal = () => new AbortController().signal;
function request(
	fn: (url: string | URL | Request, options?: RequestInit) => Promise<Response>,
): typeof fetch {
	return fn as typeof fetch;
}

describe("OpenAI transcription", () => {
	test("sends one multipart request with the selected model and returns trimmed text", async () => {
		let calls = 0;
		const transcribe = createTranscriber({
			fetch: request(async (url, options) => {
				calls++;
				expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
				expect(options?.method).toBe("POST");
				expect(options?.headers).toEqual({ Authorization: "Bearer private-key" });
				expect(options?.redirect).toBe("error");
				const form = options?.body as FormData;
				expect(form.get("model")).toBe("gpt-transcribe");
				const file = form.get("file") as File;
				expect(file.name).toBe("recording.wav");
				expect(file.type).toBe("audio/wav");
				expect(file.size).toBe(100);
				expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio());
				return Response.json({ text: "  Fix the tests.\n" });
			}),
		});
		// A short recording is a view into the recorder's larger capacity buffer.
		const capacity = new Uint8Array(1000).fill(0xff);
		capacity.set(audio(), 100);
		expect(await transcribe(capacity.subarray(100, 200), "private-key", signal())).toBe(
			"Fix the tests.",
		);
		expect(calls).toBe(1);
	});

	for (const [status, message] of [
		[401, "API key"],
		[403, "permissions"],
		[429, "quota"],
		[413, "size"],
		[500, "temporarily unavailable"],
		[400, "HTTP 400"],
	] as const) {
		test(`handles HTTP ${status} without retrying or exposing the response`, async () => {
			let calls = 0;
			const transcribe = createTranscriber({
				fetch: request(async () => {
					calls++;
					return new Response("secret response including private-key", { status });
				}),
			});
			const error = await transcribe(audio(), "private-key", signal()).catch(
				(error: Error) => error,
			);
			expect(error).toBeInstanceOf(Error);
			expect(String(error)).toContain(message);
			expect(String(error)).not.toContain("private-key");
			expect(calls).toBe(1);
		});
	}

	for (const body of ["not json", "null", '{"text":42}', "{}", '{"text":"  "}']) {
		test(`rejects invalid or empty transcription (${body})`, async () => {
			const transcribe = createTranscriber({ fetch: request(async () => new Response(body)) });
			await expect(transcribe(audio(), "key", signal())).rejects.toThrow();
		});
	}

	test("rejects empty, disposed, or oversized buffers before making any request", async () => {
		let calls = 0;
		const transcribe = createTranscriber({
			fetch: request(async () => {
				calls++;
				return Response.json({ text: "x" });
			}),
		});
		await expect(transcribe(new Uint8Array(0), "key", signal())).rejects.toThrow("No audio");
		await expect(transcribe(new Uint8Array(44), "key", signal())).rejects.toThrow("No audio");
		await expect(transcribe(new Uint8Array(25_000_001), "key", signal())).rejects.toThrow("25 MB");
		await expect(transcribe(audio(), "", signal())).rejects.toThrow("No OpenAI API key");
		expect(calls).toBe(0);
	});

	test("bounds the response and hides network exception details", async () => {
		const bytes = audio();
		const oversized = createTranscriber({
			fetch: request(async () => new Response("x".repeat(1_000_001))),
		});
		await expect(oversized(bytes, "key", signal())).rejects.toThrow(
			"invalid transcription response",
		);
		const failed = createTranscriber({
			fetch: request(async () => {
				throw new Error("Authorization: Bearer secret");
			}),
		});
		await expect(failed(bytes, "secret", signal())).rejects.toThrow("Cannot reach OpenAI");
	});

	test("aborts the request on timeout", async () => {
		let aborted = false;
		const transcribe = createTranscriber({
			timeoutMs: 15,
			fetch: request(
				async (_url, options) =>
					new Promise((_resolve, reject) => {
						options?.signal?.addEventListener(
							"abort",
							() => {
								aborted = true;
								reject(new Error("aborted"));
							},
							{ once: true },
						);
					}),
			),
		});
		await expect(transcribe(audio(), "key", signal())).rejects.toThrow("timed out");
		expect(aborted).toBe(true);
	});

	test("timeout also cancels a stalled response body after HTTP headers arrive", async () => {
		let cancelled = false;
		const transcribe = createTranscriber({
			timeoutMs: 15,
			fetch: request(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode('{"text":"'));
							},
							cancel() {
								cancelled = true;
							},
						}),
					),
			),
		});
		await expect(transcribe(audio(), "key", signal())).rejects.toThrow("timed out");
		expect(cancelled).toBe(true);
	});

	test("cancels in-flight requests and rejects late responses", async () => {
		const controller = new AbortController();
		const transcribe = createTranscriber({
			fetch: request(async () => {
				controller.abort();
				return Response.json({ text: "must not be inserted" });
			}),
		});
		await expect(transcribe(audio(), "key", controller.signal)).rejects.toThrow("cancelled");
	});

	test("already-cancelled operations do not call OpenAI", async () => {
		let called = false;
		const transcribe = createTranscriber({
			fetch: request(async () => {
				called = true;
				return Response.json({ text: "x" });
			}),
		});
		const controller = new AbortController();
		controller.abort();
		await expect(transcribe(audio(), "key", controller.signal)).rejects.toThrow("cancelled");
		expect(called).toBe(false);
	});
});
