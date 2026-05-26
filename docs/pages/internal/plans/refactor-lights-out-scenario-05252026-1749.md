# Feature: refactor Lights out end-to-end scenario

PURPOSE.md Success #1 requires every default agent to have a Lights out
(`--integrate=merge`) scenario asserting a merged diff. The bug-fix and
feat-small slots are filled (`scenarios/index.ts`,
`scenarios/feat-small-agent-e2e.ts`). The refactor slot is empty. Close it
by adding `scenarios/refactor-agent-e2e.ts` that drives the registered
`refactor` agent through its pipeline against mocked Claude responses and
asserts the squash-merged result on `main`.

**Parallel-execution note:** Two sibling refactor scenarios are being
written concurrently (this one + `refactor-pr-integrate-e2e`). Each owns
its own fixture directory so neither blocks the other on merge.

## User-facing change

`bun scenarios/refactor-agent-e2e.ts` exits 0 when the refactor agent
integrates a merged diff with intact run-log artifacts. Regressions to the
refactor Lights out path now break the gate.

## Target file(s)

- `scenarios/refactor-agent-e2e.ts` (new — the harness)
- `scenarios/fixtures/refactor-agent-e2e/seed-repo/` (new — minimal git seed
  with a small TS file containing duplication the refactor agent could
  collapse)
- `scenarios/fixtures/refactor-agent-e2e/mock-claude-responses/` (new — one
  JSON per pipeline step)
- `package.json` scenario script, **only if** the existing runner does not
  auto-discover by filename — match how `feat-small-agent-e2e.ts` and
  `bugfix-pr-integrate-e2e.ts` are wired

## What to add

Pattern-clone `scenarios/feat-small-agent-e2e.ts` with these substitutions:

1. `SCENARIO_ID = "refactor-agent-e2e"`
2. Fixture path → `scenarios/fixtures/refactor-agent-e2e/`
3. Install the `munchkins-refactor` skill (not `feat-small`/`bug-fix`) — see
   the agent definition at
   `packages/serrano-munchkins/agents/refactor/refactor-agent.ts:21`
4. Resolve `registry.get("refactor")`
5. `summary.json` assertion: `agent === "refactor"`
6. Run-log artifact assertions match the refactor pipeline shape:
   **one** agent step + **one** summary-writer step, with the deterministic
   checks loop between (no explicit run-log artifacts). Required files:
   - `step-01-agent.{system,user,response}`
   - `step-02-summary.{system,user,response}`
   (Verify against actual emitted naming; follow what the framework emits.)
7. Mock responses must produce deterministic marker file(s) the
   squash-merge assertion can verify landed on `main`.
8. The seed-repo should contain a small `.ts` file with obvious duplication
   so the agent's mocked "refactor" response can reduce it; the markers
   prove the squash carried the diff through.

## Constraints

1. Reuse `scenarios/lib/mock-spawn-claude.ts`, `scenarios/lib/result.ts`,
   `scenarios/lib/sandbox.ts` verbatim. Do not fork or extend.
2. Zero real `claude` spawns — `setupAuditGuard()` must pass.
3. Zero real GitHub calls — no `origin` remote needed for Lights out.
4. No new dependencies. No changes to existing scenarios.
5. Do not modify the `refactor` agent definition.
6. **Do not touch `scenarios/fixtures/refactor-pr-integrate-e2e/`** — that
   path belongs to the parallel Foreman slice.

## Acceptance criteria

- `bun scenarios/refactor-agent-e2e.ts` exits 0 from a clean working tree.
- The harness imports `refactor` from the registry and runs it to
  completion.
- Asserts: `agentResult.succeeded`, mock-count match, zero real `claude`,
  `.worktrees/` empty + no `agent/*` branches leaked, main advanced past
  seed, marker files tracked on main, `summary.json.agent === "refactor"`,
  all step-pair run-log files present + non-empty `events.jsonl`.
- A second run exits 0 with no leftover state.
- Pre-existing scenarios still pass (`bun scenarios/index.ts`,
  `bun scenarios/bugfix-pr-integrate-e2e.ts`,
  `bun scenarios/feat-small-agent-e2e.ts`,
  `bun scenarios/feat-small-pr-integrate-e2e.ts`).
- `bun run lint` and `bun run typecheck` pass.

## Out of scope

- The refactor Foreman scenario (`scenarios/refactor-pr-integrate-e2e.ts`)
  — separate parallel slice.
- Sharing fixtures with the Foreman slice. Each Lights out / Foreman pair
  owns its own fixtures for now; consolidation belongs in a future
  refactor slice.
- Equivalent scenarios for `director`. Separate slice.
- Backend parity (#4), fixer-cap (#5).
- Refactoring `scenarios/lib/*`.
