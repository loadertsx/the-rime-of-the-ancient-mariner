import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVoicePreferences } from "../../src/voice/preferences.ts";

const directories: string[] = [];
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "voice-preferences-unit-"));
	directories.push(directory);
	const path = join(directory, "voice.json");
	return { directory, path, preferences: openVoicePreferences(path) };
}
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("voice preferences", () => {
	test("missing preferences mean system default without writing files", async () => {
		const { preferences, directory } = await fixture();
		expect(await preferences.read()).toEqual({ kind: "default" });
		expect(await readdir(directory)).toEqual([]);
	});

	for (const value of [
		"not json",
		"null",
		'{"version":2,"microphone":{"kind":"default"}}',
		'{"version":1,"microphone":{"kind":"device","name":""}}',
		'{"version":1,"microphone":{"kind":"device","name":"bad\\nname"}}',
		'{"version":1,"microphone":{"kind":"other"}}',
	]) {
		test(`rejects malformed preferences (${value}) with recovery guidance`, async () => {
			const { preferences, path } = await fixture();
			await writeFile(path, value);
			await expect(preferences.read()).rejects.toThrow("Run /voice-mic");
			await preferences.write({ kind: "default" });
			expect(await preferences.read()).toEqual({ kind: "default" });
		});
	}

	test("rejects invalid writes without changing an existing choice", async () => {
		const { preferences } = await fixture();
		await preferences.write({ kind: "device", name: "AirPods" });
		await expect(preferences.write({ kind: "device", name: "" })).rejects.toThrow("Invalid");
		expect(await preferences.read()).toEqual({ kind: "device", name: "AirPods" });
	});
});
