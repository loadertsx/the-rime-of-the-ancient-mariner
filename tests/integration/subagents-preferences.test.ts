import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSubagentsPreference } from "../../src/subagents/preferences.ts";

const directories: string[] = [];
const cwd = "/projects/api";

function temporaryDatabasePath(): string {
	const directory = mkdtempSync(join(tmpdir(), "ancient-mariner-subagents-"));
	directories.push(directory);
	return join(directory, "preferences.db");
}

/** Builds a database using only the migrations that stored a global choice. */
function createLegacyDatabase(path: string, enabled: boolean): void {
	const source = fileURLToPath(new URL("../../migrations/", import.meta.url));
	const legacyFolder = join(dirname(path), "legacy-migrations");
	const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8"));
	journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 2);
	mkdirSync(join(legacyFolder, "meta"), { recursive: true });
	writeFileSync(join(legacyFolder, "meta", "_journal.json"), JSON.stringify(journal));
	for (const entry of journal.entries) {
		copyFileSync(join(source, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`));
	}

	const sqlite = new Database(path);
	try {
		migrate(drizzle({ client: sqlite }), { migrationsFolder: legacyFolder });
		sqlite
			.prepare("INSERT INTO subagent_preferences (id, enabled) VALUES (1, ?)")
			.run(Number(enabled));
	} finally {
		sqlite.close();
	}
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("SubagentsPreference", () => {
	test("defaults to disabled without saving a preference", () => {
		const path = temporaryDatabasePath();
		const preference = openSubagentsPreference(path);

		assert.equal(preference.isEnabled(cwd), false);
		const sqlite = new Database(path);
		try {
			assert.deepEqual(sqlite.prepare("SELECT * FROM subagent_preferences").all(), []);
		} finally {
			sqlite.close();
		}
	});

	test("persists and replaces the choice for a cwd", () => {
		const path = temporaryDatabasePath();
		const preference = openSubagentsPreference(path);

		preference.setEnabled(cwd, true);
		assert.equal(openSubagentsPreference(path).isEnabled(cwd), true);

		preference.setEnabled(cwd, false);
		assert.equal(openSubagentsPreference(path).isEnabled(cwd), false);
	});

	test("keeps projects, subdirectories, worktrees, and symlink paths independent", () => {
		const path = temporaryDatabasePath();
		const preference = openSubagentsPreference(path);
		const otherCwds = [
			"/projects/web",
			`${cwd}/src`,
			"/projects/api-worktree",
			"/projects/api-link",
		];

		preference.setEnabled(cwd, true);
		for (const otherCwd of otherCwds) {
			assert.equal(preference.isEnabled(otherCwd), false);
			preference.setEnabled(otherCwd, true);
		}

		preference.setEnabled(cwd, false);
		const reopened = openSubagentsPreference(path);
		assert.equal(reopened.isEnabled(cwd), false);
		for (const otherCwd of otherCwds) {
			assert.equal(reopened.isEnabled(otherCwd), true);
		}
	});

	for (const legacyEnabled of [false, true]) {
		test(`migrates without inheriting the global choice (${legacyEnabled})`, () => {
			const path = temporaryDatabasePath();
			createLegacyDatabase(path, legacyEnabled);

			const preference = openSubagentsPreference(path);
			assert.equal(preference.isEnabled(cwd), false);
			assert.equal(preference.isEnabled("/projects/web"), false);
			const sqlite = new Database(path);
			try {
				assert.deepEqual(sqlite.prepare("SELECT * FROM subagent_preferences").all(), []);
			} finally {
				sqlite.close();
			}

			preference.setEnabled(cwd, true);
			assert.equal(openSubagentsPreference(path).isEnabled(cwd), true);
			assert.equal(preference.isEnabled("/projects/web"), false);
		});
	}
});
