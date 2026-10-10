PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_subagent_preferences` (
	`cwd` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
-- The former global choice has no cwd and is intentionally not inherited.
DROP TABLE `subagent_preferences`;--> statement-breakpoint
ALTER TABLE `__new_subagent_preferences` RENAME TO `subagent_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;