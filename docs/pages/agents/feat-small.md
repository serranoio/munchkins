# Small feature

Implement a scoped new feature in a sandboxed worktree, refactor what you touched, write tests for the new public surface, gate on `lint` / `typecheck` / `scenario` / `test`, and land a commit.

## What it does

`feat-small` is a five-stage pipeline tuned for net-new code: an implementation step, a refactor pass scoped to the files the implementation touched, a test-writer pass that adds minimal coverage for any new public surface, the deterministic gate with a fixer subagent, and a summary writer that produces the commit message and changelog entry. The full run is real `claude` (or `codex`) end-to-end.

## When to reach for it

- You're adding **new** behavior — a new function, flag, endpoint, component → `feat-small`.
- The behavior already exists and is wrong → use [`bug-fix`](/agents/bug-fix). `feat-small` doesn't have a "find the bug" phase.
- You want to clean up working code → use [`refactor`](/agents/refactor). `feat-small` has scope creep guardrails but its job is to *expand* the surface, not contract it.
- The work is large enough to need design conversation → don't use any of these. Land a plan first; come back when the plan is concrete.

## Quickstart

`scratch/cli-quiet-flag.md`:

```markdown
# Add a --quiet flag to the export command

`src/cli/export.ts` should accept `--quiet`, which suppresses the per-file
progress lines and only prints the final summary.

## Acceptance criteria

- `bun run export --quiet` prints exactly one line on success.
- `bun run export` (no flag) preserves current behavior.
- Existing tests still pass.

## Out of scope

- Anything outside `src/cli/export.ts` and its existing test file.
```

Run:

```sh
bun run munchkins feat-small --user-message=./scratch/cli-quiet-flag.md
```

## The user-message file

Like every default agent, `--user-message` accepts either a markdown file path or an inline string. The `feat-small` pipeline is the most common case for the inline form, because briefs for tiny additions are often one paragraph long:

```sh
bun run munchkins feat-small --user-message="Add a --quiet flag to src/cli/export.ts that suppresses per-file progress lines."
```

A markdown brief is still recommended once the feature has any structure:

```markdown
# <one-line goal>

<one paragraph describing what the feature does and why>

## Target file(s)

- `src/foo.ts:42` — extension point
- `src/foo.test.ts` — where the new tests should live

## Acceptance criteria

- <observable, runnable check>
- <observable, runnable check>

## Out of scope

- <files / behaviors not to touch>
```

The `feat-small` agent has a built-in test-writer step (see Pipeline below). You don't need to dictate the test plan — just describe the new public surface clearly enough that the test-writer can identify what to cover.

## Pipeline

`feat-small` registers five steps plus a summary writer. Every step has the shared `agents/_shared/prompts/agent-guidelines.md` prepended to its system prompt.

| # | Kind | System prompt | What it does |
|---|------|---------------|--------------|
| 1 | agent | `agents/feat-small/prompts/feat-small.md` | Reads the user-message and implements the feature. |
| 2 | agent | `agents/_shared/prompts/refactorer.md` | Refactors **only files the previous step touched** for DRY/clarity. |
| 3 | agent | `agents/_shared/prompts/test-writer.md` | Reads the diff and adds minimal tests for any new public surface. Skips itself if there's nothing new to test. |
| 4 | deterministic | — | Runs the gate. On failure, invokes the fixer subagent. |
| 5 | summary writer | `agents/feat-small/prompts/summary-writer.md` | Reads the staged diff, emits a commit message + changelog markdown. |

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
| `--user-message <value>` (required) | Markdown file path **or** inline text describing the feature. | Always. |
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
bun run munchkins feat-small --cli=codex --user-message=./feat.md
MUNCHKINS_CLI=codex bun run munchkins feat-small --user-message=./feat.md
```

`codex` requires the `codex` CLI on `PATH` and a prior `codex login`. The framework does not pre-validate this; failures surface as a non-zero exit from the spawn.

**Cost reporting caveat.** Codex's JSONL stream does not emit per-call cost. Runs that include any Codex-backed call render the cost field as `—` in the PASS line, the `summary.json`, and the changelog entry. Token in/out are still reported in full.

## Integration modes

Strategy resolves: `--integrate` flag → author declaration on the builder → run-layer default (`integrateMerge`).

**`merge` (default).** Rebase the worktree branch onto your base branch, resolving any conflicts via the merge-fixer subagent (up to 3 iterations), then fast-forward your base branch to the rebased tip. Result: your branch points at the agent's commits. The summary writer's commit message becomes the head commit's title.

**`pr`.** Same rebase, then `git push -u origin <branch>` and open a PR/MR. Provider is auto-detected from the remote URL: GitLab if the URL contains `gitlab`, GitHub otherwise. The CLI used to open the PR is `gh` for GitHub and `glab` for GitLab — both must be on `PATH` and authenticated. The PR's title is the summary writer's commit message; its body is the markdown changelog entry. The PR URL is returned and printed in the PASS line.

```sh
bun run munchkins feat-small --integrate=pr --user-message=./feat.md
```

## What you get back

On success:

- A new commit on your base branch with the summary writer's message as the title (and a `docs(changelog): <title>` commit beneath it for the changelog entry).
- A prepended entry in your `CHANGELOG.md` (path overridable via `MUNCHKINS_CHANGELOG_PATH`) with the date, agent name, duration, cost, and a markdown body.
- `summary.json` with `tokensIn`, `tokensOut`, `costUsd`, `durationMs`, `agentSteps`, `deterministicCommands`, `fixerInvocations`, the commit message, and the markdown body.
- `events.jsonl` — one event per Claude call, deterministic iteration, or fixer invocation.
- Per-step `step-NN-agent.{system.md,user.md,response.txt}` and `step-NN-det-iter-MM.log` — exact prompts and outputs for each phase. The test-writer step also lands as a `step-NN-agent.*` triple.

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

Cron a `feat-small` run by attaching `.cron(spec, { userMessage, verbosity })` to the builder in your own bundle and starting the daemon:

```ts
import { builder } from "@serranolabs.io/munchkins/agents/feat-small/feat-small-agent.js";

builder.cron("0 6 * * 1", {
  userMessage: "./scratch/weekly-feature.md",
  verbosity: "thinking",
});
```

```sh
bun run munchkins daemon
```

The daemon parses each cron spec, prints the next firing time, and arms a timer per agent. The user-message is fixed per cron config — if you want a different brief on each tick, regenerate the markdown file from a wrapper script before the cron fires. Verbosity options: `default`, `thinking`, `verbose`.

## Delegating from Claude Code

The `launch-munchkin` Claude Code skill hands a task off to a `feat-small` agent and exits. From within Claude Code:

> "Launch a feat-small agent for the --quiet flag we discussed."

The skill picks the right subcommand, drafts a `scratch/<slug>.md` spec from the conversation, shows it to you for one confirmation, then fires `bun run munchkins feat-small --user-message=<path>` in the background. It does not poll or report back — the agent integrates its own commits when it's done.

**Spec-only mode.** Say "just write the spec" or "give me the command, don't run it" and the skill writes the markdown file, prints the exact CLI invocation, and stops without spawning anything.

Install the skills bundle into a host repo with `bun run munchkins skills install`.

## Pass / fail behavior

**Pass.** Worktree branch is rebased and fast-forwarded into your base branch. The worktree directory is removed. The agent's branch is deleted. The PASS line prints the duration, tokens, cost, commit message, and (for `--integrate=pr`) the PR URL.

**Fail.** Worktree and branch are preserved at the printed path. Inspect the diff with `cd <path> && git diff main`, look at the prompts and responses under `.munchkins/runs/<slug>-<id>/`, and clean up by hand:

```sh
git worktree remove /repo/.worktrees/feat-small-1700000000-12ab34cd
```

That removes the directory and the branch. (`failureReason` in `summary.json` and `state.json` tells you which phase exploded.)

## Worked example — inline user-message

Sometimes the brief is short enough that a file is overkill. `feat-small` accepts the user-message inline:

```sh
bun run munchkins feat-small \
  --user-message="Add a --quiet flag to src/cli/export.ts that suppresses per-file progress lines but keeps the final summary line. Default behavior unchanged. Add one test in src/cli/export.test.ts that asserts the flag suppresses progress."
```

Excerpt of what gets printed:

```
[feat-small] worktree: /repo/.worktrees/feat-small-1700000000-12ab34cd  branch: agent/cli-quiet-flag-9f8e7d6c
[feat-small] step 1/4 — agent
[feat-small] step 2/4 — agent
[feat-small] step 3/4 — agent (test writer added 1 test in src/cli/export.test.ts)
[feat-small] step 4/4 — deterministic — iter 1/3 — all 5 commands passed
[feat-small] summary writer: ok (1 commit + 1 docs(changelog) commit)
[feat-small] integrate: rebase ok, ff-merge → main
PASS — feat-small — 5m 47s — in 21882 / out 8744 — $0.9213
       feat(cli/export): add --quiet flag suppressing per-file progress lines
       log: /repo/.munchkins/runs/cli-quiet-flag-9f8e7d6c/
```

Resulting commit message:

```
feat(cli/export): add --quiet flag suppressing per-file progress lines

The export command now accepts --quiet, which silences per-file progress
output but preserves the final summary line. Default behavior is unchanged.
A new assertion in export.test.ts confirms the flag suppresses the per-file
output without affecting the summary.
```

Resulting `CHANGELOG.md` entry (prepended; default path is `CHANGELOG.md`):

```markdown
## feat(cli/export): add --quiet flag suppressing per-file progress lines (a1b2c3d)
**2026-05-10 14:32 PDT · feat-small · 347.0s · $0.9213**

`src/cli/export.ts` now accepts `--quiet`. When set, per-file progress lines
are suppressed; the final summary line is unchanged. The default mode
(no flag) preserves the prior output exactly.

A new assertion in `src/cli/export.test.ts` covers the suppression. Existing
behavior is asserted unchanged by the pre-existing tests.

---
```
