# Getting started

Install munchkins, run a smoke-test agent to prove the pipeline works against a real backend, then scaffold your first custom agent for this repo.

## Prerequisites

1. **Bun ≥ 1.3.0.** Munchkins is Bun-only. `npm install` and `pnpm install` are not supported.
2. **A git repository.** Every run cuts a fresh worktree from your current branch. If `git rev-parse --show-toplevel` doesn't find a repo, the agent refuses to start.
3. **A backend CLI on `PATH`, authenticated.**
   - **`claude`** is the default. Sign in once with `claude` and accept the auth flow.
   - **`codex`** is the alternate backend. Run `codex login` once if you intend to use `--cli=codex`.
4. **Lint / typecheck / scenario / test scripts** in the host repo's `package.json` (see Install). The deterministic gate calls them by name; any of them can be a no-op, but they must exist.
5. **Claude Code (optional but recommended).** The fastest path to your first custom agent is the `/new-munchkin` skill, which only runs inside Claude Code. If you don't use Claude Code, you can still build agents by hand — see [Build your own](/agents/custom). Required only for the skill, not for running agents.

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
    "munchkins": "munchkins"
  }
}
```

`bun add` puts the `munchkins` binary in `node_modules/.bin`, so `bun run munchkins …` resolves directly. `bunx @serranolabs.io/munchkins …` works as an alternative invocation form.

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

Finally, install the bundled Claude Code skills so the `/new-munchkin` and `/launch-munchkin` triggers are discoverable from inside Claude Code:

```sh
bun run munchkins skills install
```

This copies every skill shipped with `@serranolabs.io/munchkins` into `.claude/skills/` in the current working directory. Override the destination with `--dest <path>` (or `-d <path>`).

## Proof of life: run the bug-fix agent

This is a smoke test. It validates that install worked, the gate scripts are wired correctly, and the backend CLI is authenticated — before you invest in a 15-minute skill interview to build a custom agent.

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

Run artifacts land under `.munchkins/runs/<slug>-<short-id>/` — see [Build your own](/agents/custom) for the full layout. If a run fails, the worktree and branch are preserved at the printed path; clean up with `git worktree remove <path>`, which deletes both.

## Scaffold your first agent for this repo

The default agents are demos. They don't know your repo's conventions, your file layout, or what "done" looks like for the kind of work you actually do here. The value kicks in when you build agents that match — same gate, same shared presets, same terse voice.

Open Claude Code in this repo's root and trigger the skill:

```
/new-munchkin
```

The trigger phrases *"new munchkin"*, *"scaffold a munchkin agent"*, and *"design an agent for this repo"* all reach the same skill. It introspects your repo first (agents directory, existing agents, CI gate commands, lint/typecheck configs, package manager) so nothing it generates is hardcoded — then walks you through a short sequential interview: purpose, distinctness from existing agents, archetype, kebab-case name, and the prompt body.

Create-mode produces:

- `<your-agent>-agent.ts` — fully wired against `AgentBuilder`, your discovered shared presets, the deterministic gate, and the summary writer.
- `prompts/<your-agent>.md` — the system prompt, drafted in the same terse voice as your existing agent prompts.
- A side-effect import in your bundle's entry (`packages/<your-bundle>/src/index.ts`) plus an `AGENTS.md` row.

The new agent appears in `bun run munchkins --help` and runs identically to `bug-fix`, `feat-small`, or `refactor`.

## Next steps

- **Run the agents** — flag, env var, and integration details for each default: [Bug fix](/agents/bug-fix), [Small feature](/agents/feat-small), [Refactor](/agents/refactor).
- **Go deeper** — full `AgentBuilder` API and the manual path to building your own: [Build your own](/agents/custom).
