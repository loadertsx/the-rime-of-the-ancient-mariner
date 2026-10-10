import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Subagent availability choices keyed by Pi's cwd, without resolving symlinks or Git roots. */
export const subagentPreferences = sqliteTable("subagent_preferences", {
	cwd: text("cwd").primaryKey(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`)
		.$onUpdate(() => new Date()),
});
