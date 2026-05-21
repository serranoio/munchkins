# munchkins

**Project-specific, OPINIONATED, deterministic skills.**

Prompt → review.
Prompt → production.
Configurable your way.

OPINIONATED because every agent's output is gated by your repo's standards before it lands — no exceptions. Configurable because *your* standards are whatever your repo declares: your lint config, your typecheck rules, your scenario harness, your branch protection, your integration target. munchkins enforces; you define what gets enforced.

Spawn a coding agent against your repo. It runs in a fresh worktree, runs your gate (`lint` + `typecheck` + `scenario`), and either opens a reviewable PR (`--integrate=pr`) or merges straight into a deployable branch (`--integrate=merge`, the default) — your call per run. Same agent runs from your terminal or from CI. Skills live in your `.claude/skills/`, get committed to git, and your edits survive package upgrades.

```
prompt ──┬── local CLI:  bun run munchkins <agent>
         │
         └── CI trigger: issue label / webhook / manual dispatch
                            (you wire this up)
                  │
                  ▼
            fresh worktree
                  │
                  ▼
       agent steps (claude / codex)
                  │
                  ▼
       gate: lint • typecheck • scenario        (≤3 fixer retries)
                  │
             ┌────┴────┐
           pass       fail
             │         │
       merge or     worktree
       open PR      preserved
             │
             ▼
        human review
```

## Onboarding

```sh
# 1. set up
bun add -D @serranolabs.io/munchkins && bunx munchkins-init

# 2. design your first agent
#    /munchkins:new-munchkin   (in Claude Code)

# 3. use it
bun run munchkins <your-agent> --user-message="…"
```

`bunx munchkins-init` scaffolds an `agentRegistry.ts` at the repo root, adds a `"munchkins"` script to `package.json`, and installs the bundled meta-skills into `.claude/skills/`. The framework package ships zero default agents — you author your own (or copy the dogfood agents in [serranoio/munchkins](https://github.com/serranoio/munchkins/tree/main/packages/serrano-munchkins)).

After setup, Claude Code in your repo discovers two meta-skills:

```
/munchkins:new-munchkin        # author or revise a project-local agent
/munchkins:launch-munchkin     # delegate to a munchkin from any Claude Code session
```

One file, two surfaces. Edit `.claude/skills/<my-skill>/SKILL.md` and both `bun run munchkins <my-agent>` and `/<namespace>:<my-skill>` use your edits.

## Backends

Pick `claude` (default) or `codex` per run:

```sh
bun run munchkins bug-fix --cli=codex --user-message=./bug.md
MUNCHKINS_CLI=codex bun run munchkins bug-fix --user-message=./bug.md
```

`--cli` wins on conflict. `codex` requires the `codex` CLI on `PATH` and `codex login`.

## Per-run lifecycle

1. Spawns a fresh worktree at `.worktrees/<agent>-<ts>/` cut from your current branch.
2. Loads the workflow body from `.claude/skills/munchkins-<agent>/SKILL.md` via `withSkill('munchkins:<agent>')`.
3. Runs the agent against real `claude`/`codex` (no mocks).
4. Deterministic gate: `bun run lint`, `bun run typecheck`, `bun run scenario`. A fixer subagent gets up to 3 retries.
5. **Pass** → `git merge --no-ff` into your branch, OR `gh pr create` / `glab mr create` with `--integrate=pr`; worktree and agent branch deleted.
6. **Fail** → worktree preserved at the printed path for inspection.

## CI

munchkins is the architecture for an "agent-on-issue" workflow — not a packaged GitHub Action. You wire it up however your CI prefers (issue label, PR comment, scheduled job, manual dispatch). The agent runs the same way it does locally: spawn → gate → produce a diff. Use `--integrate=pr` so the result lands as a reviewable PR/MR instead of a direct merge.

Cross-platform PR/MR creation is built in: `gh` for GitHub, `glab` for GitLab, auto-detected from `git remote`.

## Build your own agent

Easiest path: `/munchkins:new-munchkin` in Claude Code. It walks you through the design, scaffolds the bundle file (if your repo doesn't have one yet), writes the SKILL.md and the agent .ts, and registers everything for `bun run munchkins` to pick up.

By hand:

```ts
// my-repo/munchkins/agents/release-notes/release-notes-agent.ts
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins";

const builder = new AgentBuilder("release-notes", "Generate release notes from recent commits.", gitWorktreeSandbox())
  .add(new Prompt().withSkill("lumen:release-notes").withUserMessageFromOption("userMessage"))
  .addDeterministic([
    "bun run lint",
    "bun run typecheck",
    "bun run scenario",
  ], { loop: { maxIterations: 3 } });

registry.register(builder);
```

Project-local skills go at `.claude/skills/<namespace>-<slug>/SKILL.md` with frontmatter `name: <namespace>:<slug>`. Pick a namespace specific to your org (e.g., `lumen`). The bare `name: foo` form is reserved for non-munchkin Claude Code skills.

## Opinions

- **munchkins expects to live in your project.** Skills get committed. There's no opaque package-internal agent surface — the SKILL.md is *your* file, in *your* repo, reviewed in *your* PRs. If you want a black box, this isn't it.
- **One source of truth per skill.** No fallback layer, no override hierarchy. Either the file exists at `.claude/skills/<namespace>-<slug>/SKILL.md` or the agent throws a clear error pointing at `bunx munchkins-init`.
- **Customizations survive upgrades.** `bunx munchkins-init` is skip-if-exists; consumer edits are sacred. Edit your local skill, run `bun update @serranolabs.io/munchkins`, edit again. Your changes are never clobbered.
- **The `munchkins:` namespace is reserved.** Defaults shipped by `@serranolabs.io/munchkins` use it. Your project-local skills should use a different namespace (`<org>:<slug>`) so they don't collide with future defaults.

## Requirements

- Bun ≥ 1.3.0 (this repo is Bun-only — no `npm`/`pnpm`).
- `claude` and/or `codex` CLI on `PATH`, authenticated.
- Optional: `gh` (GitHub) or `glab` (GitLab) for `--integrate=pr`.

## Repo conventions

See [`AGENTS.md`](./AGENTS.md) for the full operating contract: hard rules, command registry, workspace layout, and the manual GitHub setup needed for branch protection and publishing.
(GitHub) or `glab` (GitLab) for `--integrate=pr`.

## Repo conventions

See [`AGENTS.md`](./AGENTS.md) for the full operating contract: hard rules, command registry, workspace layout, and the manual GitHub setup needed for branch protection and publishing.
