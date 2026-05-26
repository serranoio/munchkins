# Feature: refactor Foreman end-to-end scenario

PURPOSE.md Success #1 requires every default agent to have a Foreman
(`--integrate=pr`) scenario asserting an opened PR. The bug-fix and
feat-small Foreman slots are filled
(`scenarios/bugfix-pr-integrate-e2e.ts`,
`scenarios/feat-small-pr-integrate-e2e.ts`). The refactor Foreman slot is
empty. Close it by adding `scenarios/refactor-pr-integrate-e2e.ts` that
drives the registered `refactor` agent through its pipeline with
`--integrate=pr` against a fake `gh` shim and a bare-repo `origin`.

**Parallel-execution note:** A sibling refactor Lights out scenario is
being written concurrently. To avoid merge collision, this Foreman slice
owns its own fixture directory
(`scenarios/fixtures/refactor-pr-integrate-e2e/`) and does **not** reuse
the Lights out fixtures. Consolidation belongs in a follow-up refactor.

## User-facing change

`bun scenarios/refactor-pr-integrate-e2e.ts` exits 0 when the refactor
agent, configured with `--integrate=pr`, pushes its `agent/*` branch to a
local bare remote and invokes `gh pr create` with valid `--base / --title
/ --body`. Regressions to the refactor Foreman path now break the gate.

## Target file(s)

- `scenarios/refactor-pr-integrate-e2e.ts` (new — the harness)
- `scenarios/fixtures/refactor-pr-integrate-e2e/seed-repo/` (new)
- `scenarios/fixtures/refactor-pr-integrate-e2e/mock-claude-responses/` (new)
- `package.json` scenario script entry only if non-auto-discovered

## What to add

Pattern-clone `scenarios/feat-small-pr-integrate-e2e.ts` with these
substitutions:

1. `SCENARIO_ID = "refactor-pr-integrate-e2e"`
2. Fixture path → `scenarios/fixtures/refactor-pr-integrate-e2e/`
   (its own copy — does **not** point at the Lights out fixtures)
3. Install the `munchkins-refactor` skill — see
   `packages/serrano-munchkins/agents/refactor/refactor-agent.ts:21`
4. Resolve `registry.get("refactor")`
5. `__MUNCHKINS_OPT_userMessage` points at `<sandbox>/refactor.md`
6. Mock responses match the refactor pipeline shape: **one** agent step +
   **one** summary-writer step (deterministic checks loop between, no
   explicit Claude responses needed for it). The summary-writer fixture
   must emit a body containing the `**Goal:**` marker so the existing PR
   body assertion holds.
7. Seed-repo contains a small TS file with duplication the mocked refactor
   response collapses; the bare remote's `agent/*` branch tip should have
   a `docs(changelog):` commit (emitted by the framework's summary phase).

## Constraints

1. Reuse `scenarios/lib/mock-spawn-claude.ts`, `scenarios/lib/result.ts`,
   `scenarios/lib/sandbox.ts`, `scenarios/lib/fake-gh-bin/gh` verbatim.
2. Zero real `claude` spawns. Zero real `gh` calls.
3. Do not modify the `refactor` agent definition or any existing scenario.
4. **Do not touch `scenarios/fixtures/refactor-agent-e2e/`** — that path
   belongs to the parallel Lights out slice.
5. No new dependencies.

## Acceptance criteria

- `bun scenarios/refactor-pr-integrate-e2e.ts` exits 0 from clean tree.
- Harness drives `refactor` with `__MUNCHKINS_OPT_integrate = "pr"`.
- Asserts: `agentResult.succeeded`, zero real `claude`, exactly one
  `gh pr create` with `--base main` + non-empty `--title`/`--body`, body
  contains `**Goal:**`, local main unchanged, bare remote has an
  `agent/*` ref whose tip subject starts with `docs(changelog):`,
  `.worktrees/` empty + no leaked local `agent/*` branches.
- Second run exits 0, no leftover state.
- Pre-existing scenarios unaffected.
- `bun run lint` and `bun run typecheck` pass.

## Out of scope

- The refactor Lights out scenario — separate parallel slice.
- Sharing fixtures with the Lights out slice.
- `director` Foreman scenario — separate parallel slice.
- Backend parity (#4), fixer-cap (#5).
- Refactoring `scenarios/lib/*` or extracting a shared Foreman helper.
