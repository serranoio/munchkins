# Getting started

Install munchkins, bootstrap the framework into your repo, then scaffold your first project-local agent.

## Prerequisites

1. **Bun ≥ 1.3.0.** Munchkins is Bun-only. `npm install` and `pnpm install` are not supported.
2. **A git repository.** Every run cuts a fresh worktree from your current branch. If `git rev-parse --show-toplevel` doesn't find a repo, the agent refuses to start.
3. **A backend CLI on `PATH`, authenticated.**
   - **`claude`** is the default. Sign in once with `claude` and accept the auth flow.
   - **`codex`** is the alternate backend. Run `codex login` once if you intend to use `--cli=codex`.
4. **Lint / typecheck / scenario / test scripts** in the host repo's `package.json` (see [Gate scripts](#gate-scripts)). The deterministic gate calls them by name; any of them can be a no-op, but they must exist.
5. **Claude Code (optional but recommended).** The fastest path to your first custom agent is the `/munchkins:new-munchkin` skill, which only runs inside Claude Code. Without Claude Code you can still build agents by hand — see [Build your own](/agents/custom).

The host repo doesn't have to be the munchkins monorepo — any git repo with the package manager and gate scripts described below will do.

## Install

Three commands and you're ready to author your first agent.

```sh
# 1. Install the package
bun add -D @serranolabs.io/munchkins

# 2. Bootstrap — writes .munchkins/config.json, the bundle entry,
#    a "munchkins" script in package.json, and symlinks the meta-skills
#    into .claude/skills/ so Claude Code can discover them
bunx munchkins-init

# 3. Verify the framework is wired up
bun run munchkins --help
```

After step 3 you should see the framework commands `resume`, `status`, `daemon` — **and no agents**. The framework ships zero default agents; you author your own (or copy patterns from the [dogfood agents](https://github.com/serranoio/munchkins/tree/main/packages/serrano-munchkins/agents)).

`bunx munchkins-init` is idempotent — safe to re-run. It skips any file that already exists, so consumer edits to `.claude/skills/*/SKILL.md` are never clobbered.

## Gate scripts

Every agent run finishes with a deterministic gate that calls these five `package.json` scripts inside the worktree. Any of them can be a no-op, but they must exist:

```json
{
  "scripts": {
    "lint:fix": "biome check --write --unsafe .",
    "lint":     "biome check .",
    "typecheck": "tsc --noEmit",
    "scenario": "echo 'no scenario harness'",
    "test":     "echo 'no tests'"
  }
}
```

Use whichever lint/typecheck/test runners your project already prefers. The agent invokes them as plain shell, not Bun-specific tasks.

## Scaffold your first agent

Open Claude Code in this repo's root and trigger the skill:

```
/munchkins:new-munchkin
```

The trigger phrases *"new munchkin"*, *"scaffold a munchkin agent"*, *"design an agent for this repo"* all reach the same skill. It first introspects your repo (agents directory, existing agents, CI gate commands, lint configs, package manager) so nothing it generates is hardcoded, then walks you through a short design interview via [grill-me](https://github.com/anthropics/claude-skills/tree/main/skills/grill-me): purpose, distinctness from existing agents, archetype, kebab-case name, and optional flags (custom CLI options, PR integration, cron schedule).

Create-mode produces three artifacts:

- **`<bundleDir>/agents/<name>/<name>-agent.ts`** — fully wired against `AgentBuilder`, the framework templates, the deterministic gate, and the summary writer.
- **`<skillsDir>/<namespace>-<name>/SKILL.md`** — the agent's user-facing workflow, with a **functional default body** drawn from the chosen archetype's template. The agent is runnable immediately; refine the prompt later via edit mode (`/munchkins:new-munchkin` → edit).
- **`<bundleDir>/agents/<name>/spec-template.md`** — the template that `/munchkins:launch-munchkin` uses when generating specs for this agent.

Auto-discovery picks up the new agent at boot — **no bundle-entry edits required**. The agent appears in `bun run munchkins --help` and is invokable as `/<namespace>:<name>` in Claude Code.

## Run your agent

From the terminal:

```sh
bun run munchkins <your-agent> --user-message=path/to/brief.md
```

Or in Claude Code, let the meta-skill dispatch:

```
/munchkins:launch-munchkin
```

What happens, roughly in order:

1. **Worktree spawn.** A fresh checkout under `.worktrees/<agent>-<ts>-<uuid>/` on a new branch named `agent/<slug>-<short-id>`.
2. **Agent steps.** The archetype-defined chain — for example, single-step archetypes run one custom step; main+refactor runs a fix step then a refactor pass on touched files.
3. **Deterministic gate.** `bun run lint:fix && bun run lint && bun run typecheck && bun run scenario && bun test`. If anything fails, the `deterministic-fixer` subagent gets up to 3 iterations to recover.
4. **Summary writer.** A short Claude call that converts the staged diff into a commit message + a markdown changelog entry. The entry is prepended to `CHANGELOG.md` in the worktree and committed.
5. **Integration.** Defaults to whatever `.munchkins/config.json` `integrate` says (`pr` for fresh consumer setups; override per-run with `--integrate=merge`). `merge` rebases + fast-forwards onto your branch; `pr` pushes + opens a PR via `gh`/`glab`.
6. **PASS line.** Total duration, token in/out, dollar cost (or `—` for Codex), the commit message, and the run's log directory.

Run artifacts land under `.munchkins/runs/<slug>-<short-id>/` — see [Build your own](/agents/custom) for the full layout. If a run fails, the worktree and branch are preserved at the printed path; clean up with `git worktree remove <path>`, which deletes both.

## Next steps

- **Patterns to copy** — the dogfood agents under [`packages/serrano-munchkins/agents/`](https://github.com/serranoio/munchkins/tree/main/packages/serrano-munchkins/agents) show the three main archetypes in production form: [Bug fix](/agents/bug-fix), [Small feature](/agents/feat-small), [Refactor](/agents/refactor), plus a cron-driven [Director](/agents/director). Read them as references; copy any as a starting point.
- **`AgentBuilder` API** and the manual path to building agents: [Build your own](/agents/custom).
