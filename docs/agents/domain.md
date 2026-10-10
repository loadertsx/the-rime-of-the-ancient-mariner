# Domain Docs

This repo uses a single-context layout:
- `GLOSSARY.md` at the repo root.
- Architecture decision records under `docs/adr/`.

## Before exploring

Read the glossary and ADRs relevant to the area you're working in.

If these files don't exist, proceed silently. Don't flag their absence
or suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`)
creates them lazily as terms and decisions get resolved.

## Use the glossary's vocabulary

Use the glossary's defined terms in issue titles, refactor proposals,
hypotheses, and test names. Avoid synonyms it explicitly rejects.

If a needed concept is missing, reconsider whether it belongs in the
domain or note the gap for `/domain-modeling`.

## Flag ADR conflicts

Surface contradictions with existing ADRs explicitly rather than
silently overriding them, for example:

> Contradicts ADR-0007, but worth reopening because…
