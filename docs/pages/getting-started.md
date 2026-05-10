# Getting started

Install munchkins, run your first agent, and learn where the artifacts land. By the end of this page you'll have a real pipeline running against a real Claude (or Codex) backend.

## Prerequisites

1. **Bun ≥ 1.3.0.** Munchkins is Bun-only. `npm install` and `pnpm install` are not supported.
2. **A git repository.** Every run cuts a fresh worktree from your current branch. If `git rev-parse --show-toplevel` doesn't find a repo, the agent refuses to start.
3. **A backend CLI on `PATH`, authenticated.**
   - **`claude`** is the default. Sign in once with `claude` and accept the auth flow.
   - **`codex`** is the alternate backend. Run `codex login` once if you intend to use `--cli=codex`.

The host repo doesn't have to be the munchkins monorepo — any git repo with the package manager and gate scripts described below will do.

## Install

In a fresh repo:

```sh
bun add -D @serranolabs.io/munchkins
```

Then add a `munchkins` script to your `package.json` so you can invoke it without remembering the entry path:

```json
{
  "scripts": {
    "munchkins": "bun run node_modules/@serranolabs.io/munchkins/src/index.ts"
  }
}
```

The deterministic gate the default agents run after each step calls these five commands inside the worktree. Any of them can be a no-op, but they must exist:

```json
{
  "scripts": {
    "lint:fix": "biome check --write --unsafe .",
    "lint":     "biome check .",
    "typecheck": "tsc --noEmit",
    "scenario": "echo 'no scenario harness'",
    "test":     "echo 'no tests' "
  }
}
```

Use whichever lint/typecheck/test runners your project already prefers. The agent invokes them as plain shell, not Bun-specific tasks.

## Your first run

Create a short markdown spec at `scratch/first-bug.md`:

```markdown
# Fix add() in src/math.ts

`add(a, b)` currently returns `a - b`. Change it to return `a + b`.

## Acceptance criteria

- `add(2, 3) === 5`
- The exported signature does not change.

## Out of scope

- Anything outside `src/math.ts`.
```

Then run:

```sh
bun run munchkins bug-fix --user-message=./scratch/first-bug.md
```

What you should see, roughly in order:

1. **Worktree spawn.** A fresh checkout under `.worktrees/bug-fix-<ts>-<uuid>/` on a new branch named `agent/<slug>-<short-id>`. The slug is derived from your spec via Claude.
2. **Agent steps.** For `bug-fix`: a fix step → a refactor pass on touched files. Each step prints its system + user prompt header (or streams Claude tokens with `--thinking` / `--verbose`).
3. **Deterministic gate.** `bun run lint:fix`, `bun run lint`, `bun run typecheck`, `bun run scenario`, `bun test --pass-with-no-tests`. If anything fails, the `deterministic-fixer` subagent gets up to 3 iterations to recover.
4. **Summary writer.** A short Claude call that converts the staged diff into a commit message + a markdown changelog entry. The entry is prepended to `CHANGELOG.md` in the worktree and committed there.
5. **Integration.** Default is `merge`: rebase the worktree onto your branch, then fast-forward your branch to the rebased tip. Worktree and branch are removed on success.
6. **PASS line.** Total duration, token in/out, dollar cost (or `—` for Codex), the commit message, and the run's log directory.

## Where the artifacts go

Every run writes to `.munchkins/runs/<slug>-<short-id>/` under your repo root. Override the location with the `MUNCHKINS_RUN_LOG_DIR` env var (relative paths resolve against the repo root).

```
.munchkins/runs/first-bug-1a2b3c4d/
├── state.json                       # full RunState — used by `munchkins resume`
├── summary.json                     # totals: duration, tokens, cost, commit message
├── events.jsonl                     # one event per agent / deterministic / fixer call
├── step-01-agent.system.md          # exact system prompt sent to Claude
├── step-01-agent.user.md            # exact user prompt sent to Claude
├── step-01-agent.response.txt       # Claude's response
├── step-02-agent.system.md
├── step-02-agent.user.md
├── step-02-agent.response.txt
├── step-03-det-iter-01.log          # deterministic gate output, iteration 1
└── step-04-summary.system.md        # summary writer prompts + response
```

The summary writer also prepends a markdown entry to your `CHANGELOG.md` (override the path with `MUNCHKINS_CHANGELOG_PATH`). The default location is `CHANGELOG.md` in your repo root; the entry includes the run's commit SHA, agent name, duration, and cost.

## If it fails

When the gate exhausts its retries or any step blows up, munchkins **preserves the worktree and branch** so you can inspect them. The PASS line becomes a FAIL line and prints the worktree path:

```
worktree preserved at /repo/.worktrees/bug-fix-1700000000-12ab34cd (branch: agent/first-bug-1a2b3c4d)
reason: deterministic step failed after 3 iteration(s): …
```

Inspect the worktree with `cd <path>`, `git log`, `git diff`. When you're done:

```sh
git worktree remove /repo/.worktrees/bug-fix-1700000000-12ab34cd
```

That removes both the directory and the agent's branch.

## Next steps

Pick the page that matches your next task — each one covers every flag, env var, and integration the agent supports:

- [**Bug fix**](/agents/bug-fix) — root-cause analysis, minimal patch, refactor pass on touched files.
- [**Small feature**](/agents/feat-small) — scoped new functionality with a test-writer pass.
- [**Refactor**](/agents/refactor) — behavior-preserving cleanup.
- [**Build your own**](/agents/custom) — full `AgentBuilder` surface and the `new-munchkin` skill.
