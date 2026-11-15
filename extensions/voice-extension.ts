import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createVoiceSession } from "../src/voice/session.ts";

export default function voiceExtension(pi: ExtensionAPI) {
	const voice = createVoiceSession();

	pi.registerCommand("voice", {
		description: "Record a voice prompt; /voice setup checks prerequisites",
		getArgumentCompletions(prefix) {
			return "setup".startsWith(prefix)
				? [
						{
							value: "setup",
							label: "setup",
							description: "Check voice prerequisites without recording",
						},
					]
				: null;
		},
		async handler(args, ctx) {
			const action = args.trim();
			if (action === "setup") await voice.setup(ctx);
			else if (!action) await voice.dictate(ctx);
			else
				ctx.ui.notify(
					"Usage: /voice or /voice setup. Change microphones with /voice-mic.",
					"warning",
				);
		},
	});

	pi.registerCommand("voice-mic", {
		description: "Select and remember a microphone for voice prompts",
		async handler(args, ctx) {
			if (args.trim()) {
				ctx.ui.notify("Usage: /voice-mic", "warning");
				return;
			}
			await voice.selectMicrophone(ctx);
		},
	});

	pi.on("session_shutdown", () => voice.dispose());
}
