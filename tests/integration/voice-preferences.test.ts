import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { openVoicePreferences } from "../../src/voice/preferences.ts";

const directories: string[] = [];
async function directory() {
	const path = await mkdtemp(join(tmpdir(), "voice-preferences-integration-"));
	directories.push(path);
	return path;
}
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("persists across instances and replaces choices without staging leftovers", async () => {
	const root = await directory();
	const path = join(root, "voice.json");
	await openVoicePreferences(path).write({ kind: "device", name: "AirPods Pro" });
	assert.deepEqual(await openVoicePreferences(path).read(), {
		kind: "device",
		name: "AirPods Pro",
	});
	await openVoicePreferences(path).write({ kind: "default" });
	assert.deepEqual(await openVoicePreferences(path).read(), { kind: "default" });
	assert.deepEqual(await readdir(root), ["voice.json"]);
	if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("respects Pi's agent directory override and never stores credentials", async () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	const root = await directory();
	process.env.PI_CODING_AGENT_DIR = root;
	try {
		await openVoicePreferences().write({ kind: "default" });
		const value = JSON.parse(
			await readFile(join(root, "the-ancient-mariner", "voice.json"), "utf8"),
		);
		assert.deepEqual(value, { version: 1, microphone: { kind: "default" } });
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("failed replacement preserves the destination and cleans staging files", async () => {
	const root = await directory();
	const path = join(root, "voice.json");
	await mkdir(path);
	await writeFile(join(path, "keep"), "untouched");
	await assert.rejects(openVoicePreferences(path).write({ kind: "default" }), /Cannot save/);
	assert.equal(await readFile(join(path, "keep"), "utf8"), "untouched");
	assert.deepEqual(await readdir(root), ["voice.json"]);
});
