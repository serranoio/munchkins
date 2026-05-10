# Bug fix

Fix a described bug in a sandboxed worktree, run a refactor pass on the files the fix touched, and only land the work on your branch when the deterministic gate goes green.

## What it does

`bug-fix` is a four-stage pipeline: a root-cause-and-fix step, a refactor pass scoped to the files the fix touched, a deterministic gate (`lint` / `typecheck` / `scenario` / `test`) with a fixer subagent, and a summary writer that produces the commit message and changelog entry. It runs against real `claude` (or `codex`) — there is no chat back-and-forth, no question loop. You give it a markdown brief; it ships a commit.

## When to reach for it

- The system is doing the wrong thing and you can describe what "right" looks like → `bug-fix`.
- You want **new** behavior that doesn't exist yet → use [`feat-small`](/agents/feat-small) instead. `bug-fix` reads the existing code as the source of truth; if the right answer is "write this from scratch," it's the wrong tool.
- You want to clean up code that's already correct → use [`refactor`](/agents/refactor). `bug-fix` always has a target *behavior* to satisfy.

## Quickstart

`scratch/add-returns-difference.md`:

```markdown
# add() returns a-b instead of a+b

`src/math.ts` exports `add(a, b)` which currently returns `a - b`. The exported
signature is correct; only the body is wrong.

## Acceptance criteria

- `add(2, 3) === 5`
- The exported signature does not change.

## Out of scope

- Anything outside `src/math.ts`.
```

Run:

```sh
bun run munchkins bug-fix --user-message=./scratch/add-returns-difference.md
```

## The user-message file

`--user-message` accepts either a path to a markdown file (relative to the repo root or absolute) **or** an inline string. If the value is an existing file path, the file's contents become the user prompt; otherwise the value itself is used directly. The same resolution applies if you point at a file from inside `scratch/`, `docs/`, or anywhere else under the repo.

A bug-fix brief works best when it's specific about *what* is wrong, not *how* to fix it:

```markdown
# <short bug title>

<one-paragraph problem statement — what's happening, what should happen,
where you've already looked>

## Target file(s)

- `src/foo.ts:42` — describe the suspected location
- `src/bar.ts` — adjacent area worth checking

## Acceptance criteria

- <observable, runnable check>
- <observable, runnable check>

## Out of scope

- <files / behaviors not to touch>
```

Avoid prescribing the implementation. The first agent step does its own root-cause analysis; over-specifying the patch wastes the model's diagnostic phase.

## Pipeline

`bug-fix` registers four steps plus a summary writer. Every step has the shared `agents/_shared/prompts/agent-guidelines.md` prepended to its system prompt.

| # | Kind | System prompt | What it does |
|---|------|---------------|--------------|
| 1 | agent | `agents/bugfix/prompts/bug-fix.md` | Reads the user-message, finds the root cause, applies a minimal fix. |
| 2 | agent | `agents/_shared/prompts/refactorer.md` | Refactors **only files the previous step touched** for DRY/clarity. |
| 3 | deterministic | — | Runs the gate commands. On failure, invokes the fixer subagent. |
| 4 | summary writer | `agents/_shared/prompts/summary-writer.md` | Reads the staged diff, emits a commit message + changelog markdown. |

The deterministic gate runs these five commands in order, all in the worktree:

```
bun run lint:fix
bun run lint
bun run typecheck
bun run scenario
bun test --pass-with-no-tests
```

If any of them exits non-zero, the run loops up to **3** iterations: a `deterministic-fixer` subagent reads the failing output, edits the worktree, then the gate re-runs. After 3 failed iterations the run is preserved as a FAIL.

## Flags

| Flag | What it does | When you'd use it |
|------|--------------|-------------------|
| `--user-message <value>` (required) | Markdown file path or inline text describing the bug. | Always. |
| `--cli <claude\|codex>` | Pick the backend CLI. Default `claude`. Equivalent to `MUNCHKINS_CLI`. Flag wins. | When you want to swap backends without setting an env var. |
| `--integrate <merge\|pr>` | How to land the result. `merge` (default): rebase + ff-merge. `pr`: rebase + push + open PR via `gh`/`glab`. | Use `pr` when your team gates landings on review. |
| `--dry-run` | Print the resolved pipeline (system + user prompts, commands, summary writer config) and exit. No Claude invoked, no worktree. | Sanity-checking a brief or exploring what an agent will do. |
| `--thinking` | Stream Claude's thinking + responses inline. Skips the boxed prompt prefaces. | Watching a single run play out. |
| `--verbose` | Highest verbosity: full step prompts, command outputs, streaming Claude. | Debugging an unexpected failure. |

## Backends

Every run shells out to one CLI. The selector resolves in this order, flag winning on conflict:

1. `--cli <claude|codex>` on the subcommand.
2. `MUNCHKINS_CLI=<claude|codex>` environment variable.
3. `claude` (default).

```sh
bun run munchkins bug-fix --cli=codex --user-message=./bug.md
MUNCHKINS_CLI=codex bun run munchkins bug-fix --user-message=./bug.md
```

`codex` requires the `codex` CLI on `PATH` and a prior `codex login`. The framework does not pre-validate this; failures surface as a non-zero exit from the spawn.

**Cost reporting caveat.** Codex's JSONL stream does not emit per-call cost. Runs that include any Codex-backed call render the cost field as `—` in the PASS line, the `summary.json`, and the changelog entry. Token in/out are still reported in full.

## Integration modes

After all steps pass, the agent's branch has to land somewhere. The strategy resolves: `--integrate` flag → author declaration on the builder → run-layer default (`integrateMerge`).

**`merge` (default).** Rebase the worktree branch onto your base branch, resolving any conflicts via the merge-fixer subagent (up to 3 iterations), then fast-forward your base branch to the rebased tip. Result: your branch now points at the agent's commits. The summary writer's commit message becomes the head commit's title.

**`pr`.** Same rebase, then `git push -u origin <branch>` and open a PR/MR. Provider is auto-detected from the remote URL: GitLab if the URL contains `gitlab`, GitHub otherwise. The CLI used to open the PR is `gh` for GitHub and `glab` for GitLab — both must be on `PATH` and authenticated. The PR's title is the summary writer's commit message; its body is the markdown changelog entry. The PR URL is returned and printed in the PASS line.

```sh
bun run munchkins bug-fix --integrate=pr --user-message=./bug.md
```

## What you get back

On success:

- A new commit on your base branch with the summary writer's message as the title (and a `docs(changelog): <title>` commit beneath it for the changelog entry).
- A prepended entry in your `CHANGELOG.md` (path overridable via `MUNCHKINS_CHANGELOG_PATH`) with the date, agent name, duration, cost, and a markdown body.
- `summary.json` with `tokensIn`, `tokensOut`, `costUsd`, `durationMs`, `agentSteps`, `deterministicCommands`, `fixerInvocations`, the commit message, and the markdown body.
- `events.jsonl` — one line per Claude call, deterministic iteration, or fixer invocation.
- Per-step `step-NN-agent.{system.md,user.md,response.txt}` and `step-NN-det-iter-MM.log` — exact prompts and outputs for each phase.

When `--integrate=pr` succeeds, the PR URL is also printed in the PASS line.

## Resuming an interrupted run

If you Ctrl-C, lose power, or the spawn crashes mid-run, the run state lives at `.munchkins/runs/<slug>-<id>/state.json` and the worktree stays intact. List, pick, or jump straight into the most recent:

```sh
bun run munchkins resume --list
bun run munchkins resume --latest
bun run munchkins resume <run-id>
```

`<run-id>` matches either the directory's run id or the slug (slug must be unambiguous). Replay semantics:

- Steps already marked `completed` are skipped — no double work.
- For an in-flight agent step, if the CLI captured a session id (Claude or Codex), the run resumes that session and the model picks up where it left off.
- If the session can't be restored (expired, CLI restarted, etc.) the step restarts with a worktree-state preamble appended to the system prompt: `git status --short` and `git diff --stat HEAD` — so the model sees its partial work.
- Resume restores the original `--user-message`, `--cli`, `--verbose`, and `--thinking` choices via the env snapshot stored in `state.json`.

## Scheduling

Cron a `bug-fix` run by attaching `.cron(spec, { userMessage, verbosity })` to the builder in your own bundle and starting the daemon:

```ts
import { builder } from "@serranolabs.io/munchkins/agents/bugfix/bugfix-agent.js";

builder.cron("0 2 * * *", {
  userMessage: "./scratch/recurring-bug.md",
  verbosity: "default",
});
```

```sh
bun run munchkins daemon
```

The daemon parses each cron spec, prints the next firing time, and arms a timer per agent. The user-message is fixed per cron config — if you want a different brief on each tick, write a small shell wrapper that regenerates the markdown file before the cron fires. Verbosity options: `default`, `thinking`, `verbose`.

## Delegating from Claude Code

The `launch-munchkin` Claude Code skill (shipped in this package's `skills/` directory) hands a task off to a `bug-fix` agent and exits. From within Claude Code:

> "Launch a bug-fix agent on the regression I just described."

The skill picks the right subcommand, drafts a `scratch/<slug>.md` spec from the conversation, shows it to you for one confirmation, then fires `bun run munchkins bug-fix --user-message=<path>` in the background. It does not poll or report back — the agent integrates its own commits when it's done.

**Spec-only mode.** Say "just write the spec" or "give me the command, don't run it" and the skill writes the markdown file, prints the exact CLI invocation, and stops without spawning anything.

Install the skills bundle into a host repo with `bun run munchkins skills install`.

## Pass / fail behavior

**Pass.** Worktree branch is rebased and fast-forwarded into your base branch. The worktree directory is removed. The agent's branch is deleted. The PASS line prints the duration, tokens, cost, commit message, and (for `--integrate=pr`) the PR URL.

**Fail.** Worktree and branch are preserved at the printed path. Inspect the diff with `cd <path> && git diff main`, look at the prompts and responses under `.munchkins/runs/<slug>-<id>/`, and clean up by hand:

```sh
git worktree remove /repo/.worktrees/bug-fix-1700000000-12ab34cd
```

That removes the directory and the branch. (`failureReason` in `summary.json` and `state.json` tells you which phase exploded.)

## Worked example

Brief at `scratch/auth-token-refresh.md`:

```markdown
# Token refresh leaks the old session

When `refreshToken()` in `src/auth/session.ts` succeeds, the old session
record stays in the in-memory cache. New requests intermittently use the
stale token and 401.

## Acceptance criteria

- After `refreshToken()` returns, `sessionCache.get(userId)` returns the new token.
- The existing test in `src/auth/session.test.ts` for `refreshToken` still passes.
- A new assertion is added that the old token is no longer in the cache after refresh.

## Out of scope

- Token rotation policy.
- Anything outside `src/auth/`.
```

Run:

```sh
bun run munchkins bug-fix --user-message=./scratch/auth-token-refresh.md
```

Excerpt of what gets printed:

```
[bug-fix] worktree: /repo/.worktrees/bug-fix-1700000000-12ab34cd  branch: agent/auth-token-refresh-9f8e7d6c
[bug-fix] step 1/3 — agent
[bug-fix] step 2/3 — agent
[bug-fix] step 3/3 — deterministic — iter 1/3 — all 5 commands passed
[bug-fix] summary writer: ok (1 commit + 1 docs(changelog) commit)
[bug-fix] integrate: rebase ok, ff-merge → main
PASS — bug-fix — 4m 12s — in 18243 / out 6112 — $0.7421
       fix(auth/session): evict stale token from sessionCache after refresh
       log: /repo/.munchkins/runs/auth-token-refresh-9f8e7d6c/
```

Resulting commit message:

```
fix(auth/session): evict stale token from sessionCache after refresh

The previous refreshToken() implementation only inserted the new token,
leaving the old entry resolvable by subsequent reads. The cache now deletes
the prior entry before the insert, ensuring no stale tokens survive a
refresh.
```

Resulting `CHANGELOG.md` entry (prepended at the top, default path is `CHANGELOG.md`; this repo's runs land in `docs/pages/changelog.md` because `MUNCHKINS_CHANGELOG_PATH` is set in `package.json`):

```markdown
## fix(auth/session): evict stale token from sessionCache after refresh (a1b2c3d)
**2026-05-10 14:32 PDT · bug-fix · 252.0s · $0.7421**

The previous `refreshToken()` implementation only inserted the new token,
leaving the old entry resolvable by subsequent reads. The cache now deletes
the prior entry before the insert, ensuring no stale tokens survive a refresh.

A regression assertion was added in `src/auth/session.test.ts` confirming the
old token is no longer in the cache after refresh.

---
```
