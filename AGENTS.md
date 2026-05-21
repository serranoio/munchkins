# AGENTS.md — operating contract for munchkins

This file is the operating contract for any agent (human or automated) working in the `munchkins` monorepo. It tells you what this repo is, what it ships, and how to operate inside it.

## What this repo is

`munchkins` is a Bun + Turborepo monorepo containing three workspaces:

- `packages/munchkins` — the `@serranolabs.io/munchkins` package (published): framework primitives (`AgentBuilder`, `Prompt`, `AgentRegistry`, `spawnClaude`, `runCli`, worktree/integrate/sandbox/scheduler helpers) plus the `munchkins-init` bootstrap bin and the two meta-skills (`munchkins-new-munchkin`, `munchkins-launch-munchkin`). Ships zero default agents.
- `packages/serrano-munchkins` — the `@serranolabs.io/serrano-munchkins` package (private, this repo's dogfood). Owns the four default agents (`bug-fix`, `feat-small`, `refactor`, `director`) and their skill bodies, plus the `agentRegistry.ts` that imports them and calls `runCli()`.
- `docs` — the Rspress docs site rendering the project's documentation.

Plus one non-workspace harness directory:

- `scenarios/` — the single-scenario testing harness (`bugfix-agent-e2e`).

The framework package declares two bins: `munchkins` (`./src/index.ts`, used by consumers' `package.json` scripts) and `munchkins-init` (`./src/init/bin.ts`, the bootstrap). The repo-level `bun run munchkins` script invokes `packages/serrano-munchkins/agentRegistry.ts`.

The plan-funnel artifacts that produced this scaffold live under `docs/pages/internal/`. They are excluded from public docs builds via the `PUBLIC_DOCS=true` env-gated `route.exclude` in `docs/rspress.config.ts`.

## Hard rules

1. **Bun only.** Never `npm install`, never `pnpm install`. Always `bun install`. Always `bun run <script>`.
2. **Workspace package names are scoped to `@serranolabs.io/`.** The published framework is `@serranolabs.io/munchkins`; the private dogfood is `@serranolabs.io/serrano-munchkins`. Cross-package imports go through the package name, never relative paths across workspace boundaries.
3. **The munchkins package does not depend on the harness.** The harness imports `@serranolabs.io/serrano-munchkins` and installs Claude mocks at the `spawnClaude` seam. No `scenario_id`, `run_id`, or harness-only identifier may flow into the production CLI surface.
4. **Public docs builds (`PUBLIC_DOCS=true`) must filter `docs/pages/internal/**` out of the build output.** The env-gated `route.exclude` in `rspress.config.ts` is the single mechanism. Do not bypass it.
5. **Never invoke real `claude` from inside the scenario harness.** The `spawnClaude` mock + `Bun.spawn` audit guard enforce this. A real-claude invocation fails the scenario regardless of pipeline outcome.

## Workflow conventions

- **Commit per slice.** Each meaningful unit of work commits independently with a message that names the PRD scenario IDs it satisfies (e.g., `feat(rspress): wire env-gated route.exclude — satisfies S2/S3/S4`).
- **Manual verification recording.** When an operator manually verifies a scenario (S2, S8, S9, S10, S11, S12), record the outcome in the relevant PR's description or commit message body. There is no separate manual log file in the scaffold milestone.
- **Version bumps for `@serranolabs.io/munchkins` are manual.** Edit `packages/munchkins/package.json` `version`, commit, tag `v<version>`, push. The `publish.yml` workflow takes it from there.

## Where things live

| What | Where |
|------|-------|
| Framework: `AgentBuilder` + `Prompt` + `spawnClaude` | `packages/munchkins/src/builder/` |
| Framework: `AgentRegistry` + CLI generator | `packages/munchkins/src/registry/` |
| Framework: worktree helpers | `packages/munchkins/src/worktree.ts` |
| Framework entry + `runCli` | `packages/munchkins/src/index.ts` |
| `munchkins-init` bootstrap bin | `packages/munchkins/src/init/bin.ts` |
| Default agents (dogfood) | `packages/serrano-munchkins/agents/<name>/` (each agent owns its `<name>-agent.ts` + `prompts/`) |
| Shared agent presets + system-prompt prelude | `packages/serrano-munchkins/agents/_shared/` |
| Dogfood `agentRegistry.ts` entry | `packages/serrano-munchkins/agentRegistry.ts` |
| Scenario harness entry | `scenarios/index.ts` |
| Harness fixtures | `scenarios/fixtures/bugfix-agent-e2e/` (reused verbatim by `scenarios/dirty-main-e2e.ts`) |
| Public docs landing | `docs/pages/index.mdx` |
| Internal planning docs | `docs/pages/internal/` |
| Rspress config | `docs/rspress.config.ts` |
| Turbo task graph | `turbo.json` |
| Lint + format config | `biome.json` |
| GitHub Actions workflows | `.github/workflows/` |

## Command registry

Every canonical command in the `@serranolabs.io/munchkins` monorepo is listed here. If a command exists but is not listed, it is unsanctioned. If a sanctioned command needs adding, update this section in the same PR that introduces it. Invoke from the repo root with `bun run <name>` unless otherwise noted.

### Repo-level

| Name | Invocation | Purpose |
|------|------------|---------|
| `lint` | `bun run lint` | Biome lint + format check. Required CI check on every PR. |
| `format` | `bun run format` | Apply Biome's safe auto-fix. |
| `format:check` | `bun run format:check` | Check formatting without writing. |
| `typecheck` | `bun run typecheck` | `tsc --noEmit` per workspace via Turborepo. |
| `test` | `bun run test` | Per-workspace `test` scripts via Turborepo (currently no-op; deep verification is the scenario harness). |
| `build` | `bun run build` | Per-workspace `build` scripts via Turborepo. Outputs cached. |
| `scenario` | `bun run scenario` | Run the single scenario harness (`bugfix-agent-e2e`). Required CI check on every PR. |
| `munchkins` | `bun run munchkins <agent> [...]` | Project-local entrypoint for running registered default agents against this repo. Resolves to `packages/serrano-munchkins/agentRegistry.ts`, which imports `runCli` from the framework and registers the four dogfood agents via side-effect imports. |

### Docs

| Name | Invocation | Purpose |
|------|------------|---------|
| `docs:dev` | `bun run docs:dev` | Start Rspress dev server. Internal artifacts ARE rendered in dev. |
| `docs:build` | `bun run docs:build` | Build Rspress site. Set `PUBLIC_DOCS=true` to filter `docs/pages/internal/**` from output. |

## Running default agents

The bundle (`@serranolabs.io/munchkins`) registers two default agents on import. List the surface with `bun run munchkins --help`.

| Agent | What it does |
|-------|--------------|
| `bug-fix` | Diagnose and fix a bug end-to-end via the munchkins bug-fix agent — runs in a fresh worktree, applies a minimal fix, refactors what was touched, gates with lint/typecheck/scenario, then merges or opens a PR. Use when the user wants a bug fixed via the deterministic agent rather than inline editing. |
| `feat-small` | Implement a small new feature via the munchkins feat-small agent — adds the feature in a fresh worktree, refactors touched files, writes minimal tests for new public surface, gates with lint/typecheck/scenario, then merges or opens a PR. Use when the user wants a small feature added via the deterministic agent rather than inline editing. |
| `refactor` | Behavior-preserving refactor of a target via the munchkins refactor agent — runs in a fresh worktree, applies DRY/clarity changes inside the named scope, gates with lint/typecheck/scenario, then merges or opens a PR. Use when the user wants refactoring done via the deterministic agent rather than inline editing. |
| `director` | Cron-driven orchestrator that triages, plans, and dispatches work via other munchkins. Reads PURPOSE.md as its north star, picks a vertical slice independent of in-flight work, and hands the slice to feat-small / bug-fix / refactor. |

Invocation:

```sh
bun run munchkins <agent> --user-message=<value>
```

`--user-message` accepts either:
- A path to a markdown file describing the work (`./scratch/my-bug.md`) — file contents become the agent's user prompt.
- A literal text string (`"Fix add() in src/math.ts; returns a-b instead of a+b"`) — used as the user prompt directly.

Per-run lifecycle:
1. The agent runs in a fresh git worktree under `.worktrees/<agent>-<ts>/` cut from the current branch.
2. Real Claude calls execute (no harness mocks). Each agent step's system prompt is `agents/_shared/prompts/agent-guidelines.md` followed by the agent's own step-specific prompt.
3. After the agent steps, the deterministic loop runs `bun run lint`, `bun run typecheck`, and `bun run scenario` in the worktree. If any fails, the deterministic-fixer subagent gets up to 3 iterations to recover.
4. **On pass:** the worktree is merged into the current branch (`git merge --no-ff`), the worktree directory is removed, and the agent's branch is deleted. The deterministic loop is the gate; if it green-lit, the merge is trusted.
5. **On fail:** the worktree and branch are preserved at the printed path. Inspect, fix manually, or remove with `git worktree remove <path>`.

Adding a new dogfood agent: create `packages/serrano-munchkins/agents/<name>/<name>-agent.ts` constructing an `AgentBuilder` and calling `registry.register(builder)`, then side-effect-import it from `packages/serrano-munchkins/agentRegistry.ts`.

### Selecting the agent CLI backend

Every agent run shells out to a CLI. The default is `claude`; `codex` is available as an alternate backend. The selection is process-wide — one backend per run.

Two ways to pick the backend, with this priority (flag wins on conflict):

1. `--cli <claude|codex>` — flag on any registered agent subcommand.
2. `MUNCHKINS_CLI=<claude|codex>` — environment variable.

Examples:

```sh
bun run munchkins bug-fix --cli=codex --user-message=./bug.md
MUNCHKINS_CLI=codex bun run munchkins bug-fix --user-message=./bug.md
```

Codex prerequisite: the `codex` CLI must be on `PATH` and authenticated (`codex login`) for `--cli=codex` to work. Failures surface from `Bun.spawn` and are not pre-validated.

Cost tracking caveat: Codex's JSONL stream does not emit a per-call cost. Runs that include any Codex-backed call render the cost field as `—` instead of a dollar amount in the PASS line, run summary, and CHANGELOG entry. Token counts are still reported.

### Manual prerequisites (one-time GitHub setup, not commands)

These cannot be verified by S10/S11/S12 until configured by an operator with repo admin rights:

1. **Branch protection on `main`** requiring status checks `lint` and `test` from `ci.yml`.
2. **Repository secret `NPM_TOKEN`** with publish rights to the `@serranolabs.io` npm scope.
3. **GitHub Pages source** set to "GitHub Actions" (Settings → Pages).

## Reading order for new collaborators

1. This file.
2. `docs/pages/internal/prd.md` — what the scaffold delivers (12 scenarios S1–S12).
3. `docs/pages/internal/scenario-testing-strategy.md` — how each scenario is verified.
4. `docs/pages/internal/technology-decisions.md` — locked technology choices and why.
5. `docs/pages/internal/plan.md` — the slice-by-slice execution plan.
