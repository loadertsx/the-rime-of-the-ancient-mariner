import { eq } from "drizzle-orm";
import { openDb } from "../db/connection.ts";
import { subagentPreferences } from "./schema.ts";

/** Stores independent subagent availability choices for each exact cwd supplied by Pi. */
export interface SubagentsPreference {
	/** Returns false when this cwd has no saved choice. */
	isEnabled(cwd: string): boolean;

	/** Saves the choice for this cwd without affecting other directories. */
	setEnabled(cwd: string, enabled: boolean): void;
}

export function openSubagentsPreference(path?: string): SubagentsPreference {
	const db = openDb(path);

	return {
		isEnabled(cwd) {
			return (
				db
					.select({ enabled: subagentPreferences.enabled })
					.from(subagentPreferences)
					.where(eq(subagentPreferences.cwd, cwd))
					.get()?.enabled ?? false
			);
		},

		setEnabled(cwd, enabled) {
			db.insert(subagentPreferences)
				.values({ cwd, enabled })
				.onConflictDoUpdate({
					target: subagentPreferences.cwd,
					set: { enabled, updatedAt: new Date() },
				})
				.run();
		},
	};
}
