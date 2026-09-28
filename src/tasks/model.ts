import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

export const UPDATE_PLAN_TOOL = "update_plan";

export const TasksSchema = Type.Object({
	tasks: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$" }),
			title: Type.String({
				minLength: 1,
				maxLength: 200,
				pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]+$",
				description: "Concise task title in English",
			}),
			status: Type.Union([
				Type.Literal("pending"),
				Type.Literal("in_progress"),
				Type.Literal("done"),
				Type.Literal("blocked"),
			]),
		}),
		{ maxItems: 100 },
	),
});

export type PlanTask = Static<typeof TasksSchema>["tasks"][number];

/** Validate a complete snapshot before replacing any session state. */
export function parseTasks(value: unknown): PlanTask[] {
	if (!Check(TasksSchema, value)) throw new Error("Invalid task snapshot.");
	const ids = new Set<string>();
	for (const task of value.tasks) {
		if (!task.title.trim()) throw new Error("Task titles must not be blank.");
		if (ids.has(task.id)) throw new Error(`Duplicate task ID: ${task.id}`);
		ids.add(task.id);
	}
	return value.tasks.map((task) => ({ ...task, title: task.title.trim() }));
}
