# Feature: feat-small Lights out end-to-end scenario

PURPOSE.md Success #1 requires every default agent to have a Lights out
(`--integrate=merge`) scenario asserting a merged diff. The bug-fix slot is
satisfied by `scenarios/index.ts` (scenario id `bugfix-agent-e2e`); the
`feat-small` slot is empty. Close that half of #1 by adding a parallel
`scenarios/feat-small-agent-e2e.ts` that drives the registered `feat-small`
agent through its full pipeline against mocked Claude responses and a fake
git sandbox, then asserts the squash-merged result on `main`.

The scenario must be a faithful structural mirror of `scenarios/index.ts`
adapted to the four-step feat-small pipeline (implementer → refactorer →
test-writer → summary-writer, with the deterministic checks loop between
test-writer and summary-writer). Reuse `scenarios/lib/*` verbatim — do not
fork the shared harness.

## User-facing change

A new gated scenario `scenarios/feat-small-agent-e2e.ts` runs in CI / locally
via `bun scenarios/feat-small-agent-e2e.ts` and exits 0 when the feat-small
agent integrates a merged diff with intact run-log artifacts. Regressions to
the feat-small Lights out path now break the gate instead of slipping through.

## Target file(s)

- `scenarios/feat-small-agent-e2e.ts` (new — the harness)
- `scenarios/fixtures/feat-small-agent-e2e/seed-repo/` (new — minimal git seed)
- `scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/` (new — one JSON per pipeline step)
- `packages/munchkins/package.json` or root `package.json` scripts entry, **only if** the existing scenario runner doesn't auto-discover by filename — verify before editing

## What to add

1. New harness file `scenarios/feat-small-agent-e2e.ts` patterned after
   `scenarios/index.ts:1-339`:
   - `SCENARIO_ID = "feat-small-agent-e2e"`
   - Import `feat-small` from the registry instead of `bug-fix`
     (`scenarios/index.ts:256`)
   - Install the `munchkins-feat-small` skill into the sandbox instead of
     `munchkins-bug-fix` (`scenarios/index.ts:237-247`)
   - Use a `userMessagePath` named `feature.md` (analog to `bug.md` at
     `scenarios/index.ts:249`)
   - Update `assertArtifacts()` required-files list to cover all four
     feat-small steps:
     - `step-01-agent.{system,user,response}` (implementer)
     - `step-02-agent.{system,user,response}` (refactorer)
     - `step-03-agent.{system,user,response}` (test-writer)
     - `step-04-summary.{system,user,response}` (summary writer)
     (compare against the actual run-log naming the framework emits — if the
     framework numbers differently, follow what it emits, not this list)
   - Assert `summary.json` has `agent === "feat-small"` (not `"bug-fix"`)
2. Seed repo fixture under `scenarios/fixtures/feat-small-agent-e2e/seed-repo/`
   modeled on the bug-fix seed but representing a "missing-feature" starting
   state (e.g. a tiny TS module with a TODO the feature is supposed to fill).
3. Mock Claude responses under
   `scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/`, one JSON
   per pipeline step, each producing deterministic marker files so the
   squash-merge assertion in `assertHappyPathCleanup` can verify all four
   step-products landed on `main`.
4. If the scenario runner is registered explicitly anywhere (e.g. a turbo
   task, a root script, or a CI workflow), add the new scenario there.
   Auto-discovery is fine — only wire it if discovery doesn't pick the file
   up by convention.

## Constraints

1. Reuse `scenarios/lib/mock-spawn-claude.ts`, `scenarios/lib/result.ts`,
   `scenarios/lib/sandbox.ts` — do not duplicate or fork them. If the
   shared harness needs a new hook to support feat-small, that is **out of
   scope** for this slice; constrain yourself to what the existing lib
   already exposes.
2. Zero real `claude` spawns — the audit guard (`setupAuditGuard()`) must
   pass.
3. Zero real GitHub calls — Lights out integrates locally, so no `gh`
   shim is needed, but verify by not setting an `origin` remote.
4. No new dependencies. No new top-level scripts beyond at most a single
   entry pointing at the new harness file.
5. Do not modify `scenarios/index.ts`, `scenarios/bugfix-pr-integrate-e2e.ts`,
   or any other existing scenario — this slice is additive only.
6. Do not introduce evaluator-style assertions about agent judgment. The
   harness proves deterministic plumbing on mocked input (PURPOSE.md
   "Out of scope" line about scenarios).

## Acceptance criteria

- `bun scenarios/feat-small-agent-e2e.ts` exits 0 from a clean working tree.
- The harness imports the registered `feat-small` agent and runs it to
  completion against mocked Claude responses.
- The harness asserts:
  - `agentResult.succeeded === true`
  - mock call count matches `getExpectedMockCallCount()`
  - zero real `claude` spawn attempts
  - `.worktrees/` empty and no `agent/*` branches leak after teardown
  - `main` advanced past the seed commit (squash-merge landed)
  - per-step marker files from the mocked responses are tracked on `main`
  - `summary.json` parses and `agent === "feat-small"`
  - all four step pairs of run-log artifacts exist and `events.jsonl` is
    non-empty
- A second run (after the first passes) exits 0 with no leftover state.
- The pre-existing scenarios still pass — `bun scenarios/index.ts` and
  `bun scenarios/bugfix-pr-integrate-e2e.ts` are unaffected.
- `bun run lint` and `bun run typecheck` pass.

## Out of scope

- The `feat-small` Foreman scenario (`scenarios/feat-small-pr-integrate-e2e.ts`)
  — that's a separate slice closing the other half of Success #1.
- Refactoring `scenarios/lib/*` to be more ergonomic for future scenarios.
  If you find a sharp edge, leave a `// TODO(feat-small slice)` comment and
  move on — refactor belongs in its own slice.
- Equivalent scenarios for `refactor` or `director`. One agent per slice.
- Any change to the `feat-small` agent definition itself
  (`packages/serrano-munchkins/agents/feat-small/feat-small-agent.ts`) — the
  scenario validates the agent as-is.
- Backend-parity (Success #4) and fixer-cap (Success #5) coverage.
