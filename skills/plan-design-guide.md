---
name: plan-design-guide
description: Guides collaborative implementation planning with System Architecture diagrams, Program Design call stacks and file trees, key contracts, implementation tasks, and approval checkpoints. Use while native plan mode is active when detailed planning artifacts are needed.
---

# Plan Design Guide

Use this playbook to make a plan reviewable before implementation. Native plan mode enforces read-only behavior; this skill defines the planning artifacts, not tool permissions.

Work through the phases in order. Do not repeat a phase the user has approved. If feedback invalidates an earlier decision, return to that phase and revise downstream work. Ask focused questions when ambiguity materially affects the design.

## Phase 1: Initial Understanding

Read only the relevant project guidance, code, tests, documentation, and configuration. Trace real entrypoints, callers, data flow, and boundaries. Prefer focused searches and independent read-only checks in parallel. Ask concise clarifying questions before making material assumptions.

## Phase 2: System Architecture

Present only artifacts that clarify how major boundaries communicate; do not descend into private helpers or line-by-line implementation.

- Use compact plain-text diagrams in fenced `text` blocks; do not use Mermaid.
- Use boxes and arrows for cross-boundary flow, aligned columns for sequences, and indented trees for hierarchy or control flow.
- Identify existing, new, and changed boundaries; show meaningful failure paths.
- State external contracts, data models, schema/query changes, compatibility constraints, decisions, and unresolved questions when relevant.

Example endpoint contract:

```text
PUT /api/resources/:slug
  request:  { destination: string }
  response: { resource: Resource }
```

Example schema/query artifact:

```sql
CREATE TABLE resource (
  slug         TEXT PRIMARY KEY,
  destination  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SELECT ... FROM ...
```

End this phase with an explicit human approval checkpoint.

## Phase 3: Program Design

After architecture approval, describe internal control flow and code organization. Use only artifacts that add information.

### Call-stack trees

Show orchestration and control-flow changes. Mark additions/removals when useful:

```text
 entrypoint
   runCommand
+    handleCreateResource
+      ResourceClient.create(input)
+        PUT /api/resources/:slug
+      renderResult
-    legacyCreateFlow
```

Show separate production and test call graphs when their wiring differs materially.

### File-tree diffs

Orient the user to where code belongs:

```text
 src
 └── resource
+    ├── resource-client.ts      # NEW - wraps API contract calls
+    ├── resource-client.test.ts # NEW - covers request/response mapping
~    └── resource-route.ts       # MODIFIED - wires create action into UI
```

### Key types and signatures

Specify internal contracts that are easy to misunderstand:

```ts
interface Item {
  id: ItemId;
  parentId: ItemId | null;
}

interface Cursor {
  position: ItemId;
  direction: "up" | "down";
}

function resolveTarget(items: Item[], cursor: Cursor): ItemId | null;
```

Identify ownership, state transitions, errors, edge cases, and tests. Compare alternatives only when a real choice remains, then recommend one. End with an explicit human approval checkpoint.

## Phase 4: Implementation Tasks

After program-design approval, turn the design into concrete tasks ordered by dependencies. Group work by responsibility, module, or change when that makes implementation clearer. Tasks do not need to deliver standalone end-to-end behavior.

When `update_plan` is available, publish the complete task list with stable IDs, concise English titles, and initial `pending` statuses. Update the complete list as work progresses using `pending`, `in_progress`, `done`, or `blocked`; preserve IDs when reordering. Mark tasks done only after their relevant checks. Task tracking changes session metadata only and never substitutes for human approval. Keep it current during implementation after leaving plan mode.

For the implementation as a whole, provide:

1. **Observable outcome** — behavior reachable through a browser, CLI, tool, `curl`, or another realistic interface.
2. **End-to-end changes** — the minimal contract, client/UI, orchestration, service, and persistence work.
3. **Files** — concrete paths expected to change.
4. **Verification** — focused automated checks and a manual demonstration when possible.
5. **Review gate** — implement the plan, summarize behavior and checks, then wait for human review.

Keep tasks specific, list their dependencies, and avoid restating the approved design. These five elements apply to the overall plan, not to each task. Do not require a human review gate after every task unless the user requests it.

## Phase 5: Final Review

Before presenting the final plan:

1. Re-read critical files and verify assumptions.
2. Confirm every task conforms to the approved architecture and program design.
3. Cover edge cases, compatibility, migrations, and user-visible behavior.
4. Keep scope explicit and identify files that must remain untouched.

Include the approved architecture and program-design artifacts, ordered tasks, assumptions, and overall verification. Implementation follows the approved plan and runs the relevant checks without mandatory pauses between tasks. Summarize behavior and checks when complete, then wait for human review. If new findings require changing the approved design or scope, pause for clarification and return to plan mode when architecture changes.

Only after presenting this final plan should the agent call `plan_exit`.
