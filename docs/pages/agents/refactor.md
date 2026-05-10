# Refactor

Behavior-preserving cleanup in a sandboxed worktree. DRY violations, naming, decomposition, clarity. The deterministic gate enforces that nothing changed observably; the summary writer documents what got tidier.

## What it does

`refactor` is a three-stage pipeline: a single agent step that reads the user-message and edits the target, the deterministic gate (`lint` / `typecheck` / `scenario` / `test`) with a fixer subagent, and a summary writer that produces the commit message and changelog entry. Unlike `bug-fix` and `feat-small`, it does **not** chain a separate test-writer step — the existing tests are the contract. If a behavior-preserving refactor breaks them, the gate catches it and the run fails.

## When to reach for it

- Working code is hard to read, duplicated, or has crept into the wrong shape → `refactor`.
- The behavior is wrong → use [`bug-fix`](/agents/bug-fix). `refactor` will *fight* you on changing observable behavior.
- You're adding new functionality → use [`feat-small`](/agents/feat-small). `refactor` doesn't have an "implement new things" frame.
- You're sweeping the whole repo → that's a project, not an agent run. Refactor a single concern at a time and chain a few runs.

## Quickstart

`scratch/dry-up-auth-helpers.md`:

```markdown
# DRY up the auth header helpers in src/auth/

`buildAuthHeader()`, `buildBearerHeader()`, and `buildSignedHeader()` in
`src/auth/headers.ts` repeat the same `{ "Content-Type", "Accept" }` defaults
inline. Extract a shared `BASE_HEADERS` constant and re-use it.

## Constraints

- The exported signatures of all three functions must not change.
- Existing tests in `src/auth/headers.test.ts` must still pass.

## Out of scope

- Anything outside `src/auth/headers.ts`.
- Renaming the public functions.
```

Run:

```sh
bun run munchkins refactor --user-message=./scratch/dry-up-auth-helpers.md
```

## The user-message file

`--user-message` accepts either a markdown file path or an inline string. For refactors, a file is almost always worth the extra ceremony — the brief should pin down what *not* to touch as carefully as what to clean up. The agent's instinct is to keep going; the brief is your only knob.

Recommended template:

```markdown
# <one-line refactor goal>

<one paragraph describing the smell, the target shape, and the public
contract that must not change>

## Target file(s)

- `src/foo.ts:42-120` — the duplicated section
- `src/foo.ts:210-260` — second copy

## Constraints

- <invariant the refactor must preserve — usually a public signature>
- <invariant — usually a behavior asserted by an existing test>

## Acceptance criteria

- <observable, runnable check — usually "all existing tests pass">
- <structural check — e.g., "no callers of the deprecated helper remain">

## Out of scope

- <files / behaviors not to touch>
- New tests (use feat-small for that).
```

The `Constraints` section is the most important one for refactor briefs. The deterministic gate proves the public surface still works, but a strict-mode-only contract or a doc-comment guarantee won't show up in `lint` or `typecheck` — the brief has to spell it out.

## Pipeline

`refactor` registers two steps plus a summary writer. Every step has the shared `agents/_shared/prompts/agent-guidelines.md` prepended to its system prompt.

| # | Kind | System prompt | What it does |
|---|------|---------------|--------------|
| 1 | agent | `agents/refactor/prompts/refactor.md` | Reads the user-message and refactors the target. |
| 2 | deterministic | — | Runs the gate. On failure, invokes the fixer subagent. |
| 3 | summary writer | `agents/refactor/prompts/summary-writer.md` | Reads the staged diff, emits a commit message + changelog markdown. |

Note the absence of a separate test-writer step. `refactor` is behavior-preserving; the existing tests are the contract. If you want new tests as part of the work, run `feat-small` after.

The deterministic gate runs these five commands in order, all in the worktree:

```
bun run lint:fix
bun run lint
bun run typecheck
bun run scenario
bun test --pass-with-no-tests
```

Failures loop up to **3** iterations: the `deterministic-fixer` subagent reads the failing output, edits the worktree, then the gate re-runs. After 3 failed iterations the run is preserved as a FAIL.

## Flags

| Flag | What it does | When you'd use it |
|------|--------------|-------------------|
| `--user-message <value>` (required) | Markdown file path or inline text describing the refactor. | Always. |
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
bun run munchkins refactor --cli=codex --user-message=./scratch/dry.md
MUNCHKINS_CLI=codex bun run munchkins refactor --user-message=./scratch/dry.md
```

`codex` requires the `codex` CLI on `PATH` and a prior `codex login`. The framework does not pre-validate this; failures surface as a non-zero exit from the spawn.

**Cost reporting caveat.** Codex's JSONL stream does not emit per-call cost. Runs that include any Codex-backed call render the cost field as `—` in the PASS line, the `summary.json`, and the changelog entry. Token in/out are still reported in full.

## Integration modes

Strategy resolves: `--integrate` flag → author declaration on the builder → run-layer default (`integrateMerge`).

**`merge` (default).** Rebase the worktree branch onto your base branch, resolving any conflicts via the merge-fixer subagent (up to 3 iterations), then fast-forward your base branch to the rebased tip. Result: your branch points at the agent's commits. The summary writer's commit message becomes the head commit's title.

**`pr`.** Same rebase, then `git push -u origin <branch>` and open a PR/MR. Provider is auto-detected from the remote URL: GitLab if the URL contains `gitlab`, GitHub otherwise. The CLI used to open the PR is `gh` for GitHub and `glab` for GitLab — both must be on `PATH` and authenticated. The PR's title is the summary writer's commit message; its body is the markdown changelog entry. The PR URL is returned and printed in the PASS line.

```sh
bun run munchkins refactor --integrate=pr --user-message=./scratch/dry.md
```

## What you get back

On success:

- A new commit on your base branch with the summary writer's message as the title (and a `docs(changelog): <title>` commit beneath it for the changelog entry).
- A prepended entry in your `CHANGELOG.md` (path overridable via `MUNCHKINS_CHANGELOG_PATH`) with the date, agent name, duration, cost, and a markdown body.
- `summary.json` with `tokensIn`, `tokensOut`, `costUsd`, `durationMs`, `agentSteps`, `deterministicCommands`, `fixerInvocations`, the commit message, and the markdown body.
- `events.jsonl` — one event per Claude call, deterministic iteration, or fixer invocation.
- Per-step `step-NN-agent.{system.md,user.md,response.txt}` and `step-NN-det-iter-MM.log` — exact prompts and outputs for each phase.

When `--integrate=pr` succeeds, the PR URL is also printed in the PASS line.

## Resuming an interrupted run

If you Ctrl-C, lose power, or the spawn crashes mid-run, the run state lives at `.munchkins/runs/<slug>-<id>/state.json` and the worktree stays intact.

```sh
bun run munchkins resume --list
bun run munchkins resume --latest
bun run munchkins resume <run-id>
```

`<run-id>` matches either the directory's run id or the slug (slug must be unambiguous). Replay semantics:

- Steps already marked `completed` are skipped.
- For an in-flight agent step, if the CLI captured a session id (Claude or Codex), the run resumes that session and the model picks up where it left off.
- If the session can't be restored (expired, CLI restarted, etc.) the step restarts with a worktree-state preamble appended to the system prompt: `git status --short` and `git diff --stat HEAD` — so the model sees its partial work.
- Resume restores the original `--user-message`, `--cli`, `--verbose`, and `--thinking` choices via the env snapshot stored in `state.json`.

## Scheduling

Cron a `refactor` run by attaching `.cron(spec, { userMessage, verbosity })` to the builder in your own bundle and starting the daemon:

```ts
import { builder } from "@serranolabs.io/munchkins/agents/refactor/refactor-agent.js";

builder.cron("30 3 * * 6", {
  userMessage: "./scratch/weekly-tidy.md",
  verbosity: "default",
});
```

```sh
bun run munchkins daemon
```

The daemon parses each cron spec, prints the next firing time, and arms a timer per agent. The user-message is fixed per cron config — regenerate it from a wrapper script if you need a different target each tick. Verbosity options: `default`, `thinking`, `verbose`.

## Delegating from Claude Code

The `launch-munchkin` Claude Code skill hands a task off to a `refactor` agent and exits. From within Claude Code:

> "Send this duplication to a refactor agent."

The skill picks the right subcommand, drafts a `scratch/<slug>.md` spec from the conversation, shows it to you for one confirmation, then fires `bun run munchkins refactor --user-message=<path>` in the background. It does not poll or report back — the agent integrates its own commits when it's done.

**Spec-only mode.** Say "just write the spec" or "give me the command, don't run it" and the skill writes the markdown file, prints the exact CLI invocation, and stops without spawning anything.

Install the skills bundle into a host repo with `bun run munchkins skills install`.

## Pass / fail behavior

**Pass.** Worktree branch is rebased and fast-forwarded into your base branch. The worktree directory is removed. The agent's branch is deleted. The PASS line prints the duration, tokens, cost, commit message, and (for `--integrate=pr`) the PR URL.

**Fail.** Worktree and branch are preserved at the printed path. Inspect the diff with `cd <path> && git diff main`, look at the prompts and responses under `.munchkins/runs/<slug>-<id>/`, and clean up by hand:

```sh
git worktree remove /repo/.worktrees/refactor-1700000000-12ab34cd
```

That removes the directory and the branch. (`failureReason` in `summary.json` and `state.json` tells you which phase exploded.)

A common refactor-specific failure mode: the model lands a behavior change disguised as a structural one, and an existing test catches it. The PASS line becomes a FAIL line referencing the failing test; the agent's branch is preserved so you can either tighten the brief and re-run, or inspect the diff to see what the model thought was a no-op.

## Worked example

Brief at `scratch/dry-up-auth-helpers.md`:

```markdown
# DRY up the auth header helpers in src/auth/

`buildAuthHeader()`, `buildBearerHeader()`, and `buildSignedHeader()` in
`src/auth/headers.ts` repeat the same `{ "Content-Type", "Accept" }` defaults
inline. Extract a shared `BASE_HEADERS` constant and re-use it.

## Constraints

- The exported signatures of all three functions must not change.
- Existing tests in `src/auth/headers.test.ts` must still pass.

## Out of scope

- Anything outside `src/auth/headers.ts`.
- Renaming the public functions.
```

Run:

```sh
bun run munchkins refactor --user-message=./scratch/dry-up-auth-helpers.md
```

Excerpt of what gets printed:

```
[refactor] worktree: /repo/.worktrees/refactor-1700000000-12ab34cd  branch: agent/dry-up-auth-helpers-9f8e7d6c
[refactor] step 1/2 — agent
[refactor] step 2/2 — deterministic — iter 1/3 — all 5 commands passed
[refactor] summary writer: ok (1 commit + 1 docs(changelog) commit)
[refactor] integrate: rebase ok, ff-merge → main
PASS — refactor — 2m 31s — in 9412 / out 3210 — $0.3812
       refactor(auth/headers): extract BASE_HEADERS shared default
       log: /repo/.munchkins/runs/dry-up-auth-helpers-9f8e7d6c/
```

Resulting commit message:

```
refactor(auth/headers): extract BASE_HEADERS shared default

The three header builders previously inlined the same Content-Type / Accept
defaults. They now spread a shared BASE_HEADERS constant. Public signatures
are unchanged; existing tests still pass.
```

Resulting `CHANGELOG.md` entry (prepended; default path is `CHANGELOG.md`):

```markdown
## refactor(auth/headers): extract BASE_HEADERS shared default (a1b2c3d)
**2026-05-10 14:32 PDT · refactor · 151.0s · $0.3812**

`buildAuthHeader()`, `buildBearerHeader()`, and `buildSignedHeader()` in
`src/auth/headers.ts` previously duplicated the `Content-Type` / `Accept`
defaults inline. They now spread a shared `BASE_HEADERS` constant.

Public signatures are unchanged. Tests in `src/auth/headers.test.ts` pass
unmodified.

---
```
