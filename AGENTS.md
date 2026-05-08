# AGENTS.md — operating contract for munchkins

This file is the operating contract for any agent (human or automated) working in the `munchkins` monorepo. It tells you what this repo is, what it ships, and how to operate inside it.

## What this repo is

`munchkins` is a minimal Bun + Turborepo monorepo containing two workspaces:

- `packages/munchkins` — the `@serranolabs.io/munchkins` package: autonomous agent infrastructure (CLI binary `munchkins`).
- `docs` — the Rspress docs site rendering the project's documentation.

Plus one non-workspace harness directory:

- `scenarios/` — the single-scenario testing harness (`bugfix-agent-e2e`).

The plan-funnel artifacts that produced this scaffold live under `docs/pages/internal/`. They are excluded from public docs builds via the `PUBLIC_DOCS=true` env-gated `route.exclude` in `docs/rspress.config.ts`.

## Hard rules

1. **Bun only.** Never `npm install`, never `pnpm install`. Always `bun install`. Always `bun run <script>`.
2. **Workspace package names are scoped to `@serranolabs.io/`.** The agents-derived package is `@serranolabs.io/munchkins`. Cross-package imports go through the package name, never relative paths across workspace boundaries.
3. **Scenario harness owns exactly one scenario.** S7 (`bugfix-agent-e2e`) is the single deep scenario. Other PRD scenarios are verified outside the harness — see `docs/pages/internal/scenario-testing-strategy.md`.
4. **The munchkins package does not depend on the harness.** The harness imports `@serranolabs.io/munchkins` and installs Claude mocks at the `spawnClaude` seam. No `scenario_id`, `run_id`, or harness-only identifier may flow into the production CLI surface.
5. **Public docs builds (`PUBLIC_DOCS=true`) must filter `docs/pages/internal/**` out of the build output.** The env-gated `route.exclude` in `rspress.config.ts` is the single mechanism. Do not bypass it.
6. **Never invoke real `claude` from inside the scenario harness.** The `spawnClaude` mock + `Bun.spawn` audit guard enforce this. A real-claude invocation fails the scenario regardless of pipeline outcome.

## Workflow conventions

- **Commit per slice.** Each meaningful unit of work commits independently with a message that names the PRD scenario IDs it satisfies (e.g., `feat(rspress): wire env-gated route.exclude — satisfies S2/S3/S4`).
- **Manual verification recording.** When an operator manually verifies a scenario (S2, S8, S9, S10, S11, S12), record the outcome in the relevant PR's description or commit message body. There is no separate manual log file in the scaffold milestone.
- **Version bumps for `@serranolabs.io/munchkins` are manual.** Edit `packages/munchkins/package.json` `version`, commit, tag `v<version>`, push. The `publish.yml` workflow takes it from there.

## Where things live

| What | Where |
|------|-------|
| CLI binary source | `packages/munchkins/src/cli/` |
| Agent builder + bugfix-agent constructor | `packages/munchkins/src/builder/` |
| Subagent prompt placeholders | `packages/munchkins/docs/subagents/` |
| Scenario harness entry | `scenarios/index.ts` |
| Harness fixtures | `scenarios/fixtures/bugfix-agent-e2e/` |
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

### Docs

| Name | Invocation | Purpose |
|------|------------|---------|
| `docs:dev` | `bun run docs:dev` | Start Rspress dev server. Internal artifacts ARE rendered in dev. |
| `docs:build` | `bun run docs:build` | Build Rspress site. Set `PUBLIC_DOCS=true` to filter `docs/pages/internal/**` from output. |

### Munchkins CLI

The CLI binary is `munchkins`. Dev: `bun run --cwd packages/munchkins cli <subcommand>`. After global install: `munchkins <subcommand>`.

| Subcommand | Purpose |
|------------|---------|
| `agent` | Run autonomous agents against the current repo. |
| `workflow` | Run predefined agent workflows. |
| `autonomous` | Run the autonomous improvement loop. |
| `changelog` | Manage the autonomous changelog. |
| `bugfix --focus <path>` | Run the bugfix agent against a focus markdown file. Default loop commands: `bun run lint` + `bun run typecheck`. Override via the `createBugfixAgent` library API. |

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
