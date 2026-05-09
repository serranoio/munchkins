# munchkins

Autonomous coding agents that ship — not chatbots that suggest. Drop a bug description in, get a merged commit out. Every run is sandboxed in a fresh git worktree, gated by `lint` + `typecheck` + `scenario`, and only fast-forwarded into your branch when the gate goes green. Plug in `claude` or `codex` as the backend; swap freely per run.

## Usage

```sh
bun install
bun run munchkins <agent> --user-message="<text or path-to-markdown>"
```

Examples:

```sh
# Fix a bug from a literal description
bun run munchkins bug-fix --user-message="Fix add() in src/math.ts; returns a-b instead of a+b"

# Refactor a target from a markdown brief
bun run munchkins refactor --user-message=./scratch/dry-up-auth.md

# Add a small feature using codex as the backend
bun run munchkins feat-small --cli=codex --user-message=./scratch/new-flag.md
```

List the agent surface:

```sh
bun run munchkins --help
```

### Default agents

| Agent | What it does |
|-------|--------------|
| `bug-fix` | Roots out the cause, applies the minimal fix, then refactors what it touched. |
| `feat-small` | Adds a small, scoped feature end-to-end. |
| `refactor` | Behavior-preserving cleanup: DRY, naming, decomposition, clarity. |

### Backend selection

Pick a CLI backend per run (default `claude`):

```sh
bun run munchkins bug-fix --cli=codex --user-message=./bug.md
MUNCHKINS_CLI=codex bun run munchkins bug-fix --user-message=./bug.md
```

`--cli` wins on conflict. `codex` requires the `codex` CLI on `PATH` and `codex login`.

### Per-run lifecycle

1. Spawns a fresh worktree at `.worktrees/<agent>-<ts>/` from your current branch.
2. Runs the agent against real `claude`/`codex` (no mocks).
3. Deterministic gate: `bun run lint`, `bun run typecheck`, `bun run scenario`. A fixer subagent gets up to 3 retries.
4. **Pass** → `git merge --no-ff` into your branch; worktree and agent branch deleted.
5. **Fail** → worktree preserved at the printed path for inspection.

## What's in the box

- `packages/munchkins-core` — `@serranolabs.io/munchkins-core`: `AgentBuilder`, `Prompt`, `AgentRegistry`, worktree helpers, the `claude`/`codex` spawn seam.
- `packages/munchkins` — `@serranolabs.io/munchkins`: the defaults bundle (`bug-fix`, `feat-small`, `refactor`) and the CLI entrypoint.
- `scenarios/` — single E2E scenario harness (`bugfix-agent-e2e`) that mocks the CLI seam to verify the framework end-to-end without burning real tokens.
- `docs/` — Rspress site. `bun run docs:dev` to browse.

## Build your own agent

```ts
// packages/munchkins/agents/my-agent/my-agent.ts
import { AgentBuilder, registry } from '@serranolabs.io/munchkins-core';

const agent = new AgentBuilder('my-agent')
  .step({ systemPrompt: '…', userPrompt: '…' });

registry.register(agent);
```

Then side-effect-import it from `packages/munchkins/src/index.ts`. It shows up in `--help` automatically.

## Requirements

- Bun ≥ 1.3.0 (this repo is Bun-only — no `npm`/`pnpm`).
- `claude` and/or `codex` on `PATH`, authenticated.

## Repo conventions

See [`AGENTS.md`](./AGENTS.md) for the full operating contract: hard rules, command registry, workspace layout, and the manual GitHub setup needed for branch protection and publishing.
