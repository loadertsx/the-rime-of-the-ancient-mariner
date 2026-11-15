import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	createEventBus,
	discoverAndLoadExtensions,
} from "@earendil-works/pi-coding-agent";
import voiceExtension from "../../extensions/voice-extension.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("registers commands, completion, and shutdown without tools or startup work", async () => {
	const commands = new Map<string, Command>();
	const handlers = new Map<string, () => Promise<void>>();
	const notifications: string[] = [];
	voiceExtension({
		registerCommand(name: string, command: Command) {
			commands.set(name, command);
		},
		on(name: string, handler: () => Promise<void>) {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI);
	assert.deepEqual([...commands.keys()], ["voice", "voice-mic"]);
	assert.deepEqual([...handlers.keys()], ["session_shutdown"]);
	const voice = commands.get("voice");
	const mic = commands.get("voice-mic");
	assert.ok(voice);
	assert.ok(mic);
	assert.equal((await voice.getArgumentCompletions?.("set"))?.[0].value, "setup");
	assert.equal(await voice.getArgumentCompletions?.("other"), null);
	const ctx = {
		hasUI: false,
		ui: {
			notify(text: string) {
				notifications.push(text);
			},
		},
	} as unknown as ExtensionCommandContext;
	await voice.handler("invalid", ctx);
	await mic.handler("invalid", ctx);
	assert.match(notifications[0], /Usage: \/voice/);
	assert.match(notifications[1], /Usage: \/voice-mic/);
	await voice.handler("setup", ctx);
	await voice.handler("", ctx);
	await mic.handler("", ctx);
	assert.equal(notifications.filter((text) => text.includes("local interactive")).length, 3);
	await handlers.get("session_shutdown")?.();
	await handlers.get("session_shutdown")?.();
});

test("Pi's file loader discovers voice and loads it without creating preferences", async () => {
	const directory = await mkdtemp(join(tmpdir(), "voice-extension-loader-"));
	directories.push(directory);
	const path = fileURLToPath(new URL("../../extensions/voice-extension.ts", import.meta.url));
	const loaded = await discoverAndLoadExtensions([path], directory, directory, createEventBus());
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	const extension = loaded.extensions[0];
	assert.deepEqual([...extension.commands.keys()], ["voice", "voice-mic"]);
	assert.equal(extension.tools.size, 0);
	assert.equal(extension.handlers.has("session_start"), false);
	assert.deepEqual(await readdir(directory), []);
	for (const handler of extension.handlers.get("session_shutdown") ?? []) {
		await (handler as () => Promise<void>)();
	}
});
