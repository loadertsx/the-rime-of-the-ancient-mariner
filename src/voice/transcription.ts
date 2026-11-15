const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25_000_000;
const MAX_RESPONSE_BYTES = 1_000_000;

/** Uploads a complete in-memory WAV. No filesystem access, retries, or credential logging. */
export type TranscribeAudio = (
	bytes: Uint8Array,
	apiKey: string,
	signal: AbortSignal,
) => Promise<string>;

interface TranscriptionOptions {
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
}

function apiError(status: number): Error {
	if (status === 401)
		return new Error(
			"OpenAI rejected the API key. Run /login and choose OpenAI API-key authentication.",
		);
	if (status === 403)
		return new Error(
			"OpenAI denied transcription access. Check your API key permissions and model access.",
		);
	if (status === 429)
		return new Error(
			"OpenAI transcription is rate-limited or out of quota. Check API billing and limits before trying again.",
		);
	if (status === 413)
		return new Error("OpenAI rejected the recording size. Try a shorter recording.");
	if (status >= 500)
		return new Error("OpenAI transcription is temporarily unavailable. Try again later.");
	return new Error(
		`OpenAI transcription failed (HTTP ${status}). Check API access to gpt-transcribe and try again.`,
	);
}

async function responseText(response: Response, signal: AbortSignal): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("OpenAI returned an empty transcription response.");
	const chunks: Uint8Array[] = [];
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_RESPONSE_BYTES)
				throw new Error("OpenAI returned an oversized transcription response.");
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		signal.removeEventListener("abort", abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/** Uses the public OpenAI endpoint only; keys are sent in headers, never subprocess arguments. */
export function createTranscriber(options: TranscriptionOptions = {}): TranscribeAudio {
	const request = options.fetch ?? globalThis.fetch;
	return async (bytes, apiKey, signal) => {
		if (!apiKey.trim()) throw new Error("No OpenAI API key configured. Run /voice setup.");
		const controller = new AbortController();
		const combined = AbortSignal.any([signal, controller.signal]);
		const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
		try {
			combined.throwIfAborted();
			if (bytes.byteLength <= 44) throw new Error("No audio was recorded. Try /voice again.");
			if (bytes.byteLength > MAX_AUDIO_BYTES)
				throw new Error("Recording exceeds OpenAI's 25 MB limit. Try a shorter recording.");
			const form = new FormData();
			form.append("model", "gpt-transcribe");
			form.append(
				"file",
				new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
				"recording.wav",
			);
			combined.throwIfAborted();
			let response: Response;
			try {
				response = await request(ENDPOINT, {
					method: "POST",
					headers: { Authorization: `Bearer ${apiKey}` },
					body: form,
					signal: combined,
					redirect: "error",
				});
			} catch {
				throw new Error("Cannot reach OpenAI transcription. Check your network and try again.");
			}
			if (!response.ok) {
				await response.body?.cancel().catch(() => {});
				throw apiError(response.status);
			}
			let value: unknown;
			try {
				value = JSON.parse(await responseText(response, combined));
			} catch {
				throw new Error("OpenAI returned an invalid transcription response. Try again.");
			}
			combined.throwIfAborted();
			if (
				!value ||
				typeof value !== "object" ||
				!("text" in value) ||
				typeof value.text !== "string"
			) {
				throw new Error("OpenAI returned an invalid transcription response. Try again.");
			}
			const text = value.text.trim();
			if (!text) throw new Error("No speech was transcribed. Check your microphone and try again.");
			return text;
		} catch (error) {
			if (signal.aborted) throw new Error("Voice transcription cancelled.");
			if (controller.signal.aborted)
				throw new Error("OpenAI transcription timed out. Try again later.");
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	};
}
