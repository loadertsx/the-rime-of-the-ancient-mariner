# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
`Nahuelluca20/the-rime-of-the-ancient-mariner`.
Use the `gh` CLI for all operations.

## Conventions

Infer the repo from the git remote when running inside this clone.
Otherwise pass `--repo Nahuelluca20/the-rime-of-the-ancient-mariner`.

- Create: `gh issue create --title "..." --body-file -`
  (supply multi-line bodies via a heredoc).
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`,
  with appropriate `--label` and `--state` filters.
- Comment: `gh issue comment <number> --body "..."`.
- Apply/remove labels: `gh issue edit <number> --add-label "..."` /
  `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.
- Link sub-issues: `gh issue create --parent <parent> ...` or
  `gh issue edit <parent> --add-sub-issue <child>` (`gh` 2.94+).
  On older versions, use the GitHub sub-issues API; if unavailable,
  put `Part of #<parent>` at the top of the child body and link it
  in the parent's task list.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the GitHub issue.

GitHub shares issue and PR numbers. If a number identifies a PR,
use `gh pr view <number> --comments` and `gh pr diff <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child tickets: sub-issues of the map, labelled `wayfinder:<type>`
  (`research`, `prototype`, `grilling`, or `task`).
- Blocking: use native GitHub issue dependencies:
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Obtain the database ID with
  `gh api repos/<owner>/<repo>/issues/<number> --jq .id`.
  If unavailable, add `Blocked by: #<number>` to the child body.
- Frontier: open map children without open blockers or an assignee;
  first in map order wins.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the answer, close the ticket, and append
  a context pointer (gist + link) to the map's Decisions-so-far.
