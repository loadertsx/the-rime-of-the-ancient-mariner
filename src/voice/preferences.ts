import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type MicrophonePreference = { kind: "default" } | { kind: "device"; name: string };

/** User-wide microphone choice. Reading never creates files; missing means system default. */
export interface VoicePreferences {
	read(): Promise<MicrophonePreference>;
	/** Atomically replaces the choice. A failed save leaves the previous choice intact. */
	write(microphone: MicrophonePreference): Promise<void>;
}

function validMicrophone(value: unknown): value is MicrophonePreference {
	if (!value || typeof value !== "object" || !("kind" in value)) return false;
	if (value.kind === "default") return true;
	return (
		value.kind === "device" &&
		"name" in value &&
		typeof value.name === "string" &&
		value.name.trim().length > 0 &&
		value.name.length <= 1024 &&
		!/\p{Cc}/u.test(value.name)
	);
}

/** Storage format and location are private to voice, not coupled to the memory database. */
export function openVoicePreferences(
	path = join(getAgentDir(), "the-ancient-mariner", "voice.json"),
): VoicePreferences {
	return {
		async read() {
			let text: string;
			try {
				text = await readFile(path, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "default" };
				throw new Error(`Cannot read voice preferences at ${path}. Check file permissions.`);
			}
			try {
				const value: unknown = JSON.parse(text);
				if (
					value &&
					typeof value === "object" &&
					"version" in value &&
					value.version === 1 &&
					"microphone" in value &&
					validMicrophone(value.microphone)
				) {
					return value.microphone.kind === "default"
						? { kind: "default" }
						: { kind: "device", name: value.microphone.name };
				}
			} catch {
				// Never echo configuration content: it may contain accidentally pasted secrets.
			}
			throw new Error(`Invalid voice preferences at ${path}. Run /voice-mic to replace them.`);
		},

		async write(microphone) {
			if (!validMicrophone(microphone)) throw new Error("Invalid microphone selection.");
			let temporary: string | undefined;
			try {
				await mkdir(dirname(path), { recursive: true, mode: 0o700 });
				temporary = await mkdtemp(join(dirname(path), ".voice-"));
				const staged = join(temporary, "voice.json");
				const choice =
					microphone.kind === "default"
						? { kind: "default" }
						: { kind: "device", name: microphone.name };
				await writeFile(
					staged,
					`${JSON.stringify({ version: 1, microphone: choice }, null, 2)}\n`,
					{
						mode: 0o600,
					},
				);
				await rename(staged, path);
			} catch {
				throw new Error(`Cannot save voice preferences at ${path}. Check file permissions.`);
			} finally {
				if (temporary) await rm(temporary, { recursive: true, force: true });
			}
		},
	};
}
