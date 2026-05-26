# Feature: director Foreman end-to-end scenario

PURPOSE.md Success #1 requires every default agent to have a Foreman
(`--integrate=pr`) scenario asserting an opened PR. The director agent
has Autopilot coverage via `scenarios/director-multi-dispatch-e2e.ts`
(satisfying #2) but no explicit Foreman scenario. Close it by adding
`scenarios/director-pr-integrate-e2e.ts` that drives the registered
`director` agent with `--integrate=pr` against a fake `gh` shim and a
bare-repo `origin`.

**Parallel-execution note:** Two refactor scenarios are being written
concurrently. This slice owns its own fixture directory
(`scenarios/fixtures/director-pr-integrate-e2e/`) and shares nothing
with the refactor slices.

## User-facing change

`bun scenarios/director-pr-integrate-e2e.ts` exits 0 when the director
agent, configured with `--integrate=pr`, completes a tick and the
resulting `agent/director-*` branch is pushed to the local bare remote
with `gh pr create` invoked. Regressions to the director Foreman path
now break the gate.

## Target file(s)

- `scenarios/director-pr-integrate-e2e.ts` (new — the harness)
- `scenarios/fixtures/director-pr-integrate-e2e/seed-repo/` (new — seed
  must include a `PURPOSE.md` since the director's deterministic surveys
  read it)
- `scenarios/fixtures/director-pr-integrate-e2e/mock-claude-responses/`
  (new — one JSON per LLM step: triage, spec, plan, summary-writer)
- `package.json` scenario script entry only if non-auto-discovered

## What to add

A new harness file patterned after
`scenarios/feat-small-pr-integrate-e2e.ts` for the integration-boundary
plumbing (fake-gh shim, bare-remote, PATH prepend, PR-create assertion)
combined with the director-specific setup from
`scenarios/director-multi-dispatch-e2e.ts` (PURPOSE.md seed, triage/spec/
plan mock responses, dispatch script behavior).

Key adaptations vs the feat-small Foreman template:

1. `SCENARIO_ID = "director-pr-integrate-e2e"`
2. Resolve `registry.get("director")`
3. Install the `munchkins-director` skill into the sandbox
4. The director agent declares `.kind("cron-only")` and has a default
   `userMessage = "tick"`. Operator CLI hides it from `list-launchable`,
   but `registry.get("director").run()` works directly. The harness must
   set `__MUNCHKINS_OPT_userMessage = "tick"` (or omit it — the agent
   default applies) and `__MUNCHKINS_OPT_integrate = "pr"`.
5. The director runs deterministic surveys (`inflight-survey.ts`,
   `repo-survey.ts`) before LLM steps. The seed-repo must be in a state
   where these surveys succeed without external services. Reference the
   existing `director-multi-dispatch-e2e` seed for the minimal shape.
6. **Dispatch behavior:** The director's `dispatch.ts` script invokes
   child agents. For a PR-integrate scenario, the goal is to verify the
   director's *own* integration is via PR — not to actually dispatch a
   child. Either:
   - mock the triage step to emit an `idle` short-circuit (no dispatch),
     OR
   - stub the dispatch script via a fixture override
   Pick the path that produces the cleanest, narrowest assertion. The
   existing multi-dispatch scenario is the reference for stubbing
   dispatch.
7. PR body assertion: the director uses `defaultSummaryWriter()`, which
   emits the same `**Goal:**` marker as feat-small/bug-fix. The
   `bugfix-pr-integrate-e2e.ts:213` assertion should hold.
8. Run-log: the director has more steps than feat-small. Don't assert
   the full per-step run-log files in this scenario (that would
   duplicate what a future director Lights out scenario should cover).
   Just assert `summary.json.agent === "director"`.

## Constraints

1. Reuse `scenarios/lib/*` verbatim, including `fake-gh-bin/gh`.
2. Zero real `claude` spawns. Zero real `gh` calls. Zero real GitHub
   network access.
3. No real dispatch to child agents — the director's dispatch must be
   stubbed or short-circuited via the triage `idle` path.
4. Do not modify the `director` agent definition.
5. **Do not touch `scenarios/fixtures/refactor-*/`** — those belong to
   the parallel refactor slices.
6. Do not modify `scenarios/director-multi-dispatch-e2e.ts` — reference
   it, don't change it.

## Acceptance criteria

- `bun scenarios/director-pr-integrate-e2e.ts` exits 0 from a clean
  working tree.
- The harness drives `director` with `__MUNCHKINS_OPT_integrate = "pr"`.
- Asserts: `agentResult.succeeded`, zero real `claude`, zero real `gh`,
  exactly one `gh pr create` with `--base main` + non-empty
  `--title`/`--body`, body contains `**Goal:**`, local main unchanged,
  bare remote has an `agent/*` (or `agent/director-*`) ref whose tip
  subject starts with `docs(changelog):`, `.worktrees/` empty + no
  leaked local `agent/*` branches, `summary.json.agent === "director"`.
- Second run exits 0, no leftover state.
- Pre-existing scenarios unaffected (including
  `scenarios/director-multi-dispatch-e2e.ts`).
- `bun run lint` and `bun run typecheck` pass.

## Out of scope

- The director Lights out scenario. (If PURPOSE.md interprets
  `director-multi-dispatch-e2e.ts` as satisfying the director Lights out
  half of #1, no separate slice is needed. If not, that's a follow-up.)
- Real dispatch to child agents. The Foreman scenario only proves the
  director's own integration boundary.
- Refactor Lights out / Foreman scenarios — parallel sibling slices.
- Backend parity (#4), fixer-cap (#5).
- Refactoring `scenarios/lib/*`.
