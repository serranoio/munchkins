# Feature: feat-small Foreman end-to-end scenario

PURPOSE.md Success #1 requires every default agent to have a Foreman
(`--integrate=pr`) scenario asserting an opened PR. The bug-fix slot is
satisfied by `scenarios/bugfix-pr-integrate-e2e.ts`. The feat-small Lights
out half was just closed by `scenarios/feat-small-agent-e2e.ts` (commit
`3830c95`). Close the feat-small Foreman half by adding
`scenarios/feat-small-pr-integrate-e2e.ts` that drives the registered
`feat-small` agent through its four-step pipeline with `--integrate=pr`
against a fake `gh` shim and a bare-repo `origin`.

This is the smallest possible slice: reuse the just-shipped
`scenarios/fixtures/feat-small-agent-e2e/` fixtures verbatim (the same
mocked pipeline — only the integration boundary differs), the same way
`bugfix-pr-integrate-e2e.ts` reuses `bugfix-agent-e2e/` fixtures.

## User-facing change

`bun scenarios/feat-small-pr-integrate-e2e.ts` exits 0 when the feat-small
agent, configured with `--integrate=pr`, pushes its `agent/*` branch to a
local bare remote and invokes `gh pr create` with valid `--base / --title
/ --body`. Regressions to the feat-small Foreman path now break the gate.

## Target file(s)

- `scenarios/feat-small-pr-integrate-e2e.ts` (new — the harness)
- `package.json` scenario script entry, **only if** the existing runner does
  not auto-discover by filename. Verify first against how
  `feat-small-agent-e2e.ts` and `bugfix-pr-integrate-e2e.ts` are wired and
  match that pattern.

No new fixtures. No changes to `scenarios/lib/*`. No changes to the
feat-small agent or any other scenario.

## What to add

A new harness file `scenarios/feat-small-pr-integrate-e2e.ts` patterned
after `scenarios/bugfix-pr-integrate-e2e.ts` with these substitutions:

1. `SCENARIO_ID = "feat-small-pr-integrate-e2e"`
2. Fixture path points at `scenarios/fixtures/feat-small-agent-e2e/`
   (not `bugfix-agent-e2e/`) — see `bugfix-pr-integrate-e2e.ts:53`.
3. Install the `munchkins-feat-small` skill (not `munchkins-bug-fix`) into
   the sandbox — see `bugfix-pr-integrate-e2e.ts:126-137`.
4. `__MUNCHKINS_OPT_userMessage` points at `<sandbox>/feature.md` (not
   `bug.md`) — match the naming the Lights out scenario settled on in
   `scenarios/feat-small-agent-e2e.ts`.
5. Resolve the registered agent via `registry.get("feat-small")` (not
   `"bug-fix"`) — see `bugfix-pr-integrate-e2e.ts:170`.

All other harness logic (audit guard, fake-gh shim activation via PATH,
bare-remote setup, `gh pr create` assertion, local-main-unchanged
assertion, remote `agent/*` branch + `docs(changelog):` tip subject
assertion, worktree teardown assertion) carries over unchanged. The PR
body marker `**Goal:**` is emitted by the same summary-writer prompt
shape, so the assertion at `bugfix-pr-integrate-e2e.ts:213` works as-is.

## Constraints

1. Reuse `scenarios/fixtures/feat-small-agent-e2e/` verbatim. Do not fork,
   copy, or modify the fixtures.
2. Reuse `scenarios/lib/mock-spawn-claude.ts`, `scenarios/lib/result.ts`,
   `scenarios/lib/sandbox.ts`, `scenarios/lib/fake-gh-bin/gh` verbatim.
3. Zero real `claude` spawns — `setupAuditGuard()` must pass.
4. Zero real GitHub calls — `gh` resolves to the shim via PATH prepend.
5. Do not modify `scenarios/feat-small-agent-e2e.ts`,
   `scenarios/bugfix-pr-integrate-e2e.ts`, or any other existing scenario.
6. Do not modify the `feat-small` agent definition
   (`packages/serrano-munchkins/agents/feat-small/feat-small-agent.ts`).
7. No new dependencies.

## Acceptance criteria

- `bun scenarios/feat-small-pr-integrate-e2e.ts` exits 0 from a clean
  working tree.
- The harness imports `feat-small` from the registry and runs it to
  completion with `__MUNCHKINS_OPT_integrate = "pr"`.
- The harness asserts:
  - `agentResult.succeeded === true`
  - zero real `claude` spawn attempts
  - exactly one `gh pr create` invocation
  - that invocation has `--base main`, non-empty `--title`, non-empty
    `--body`, and the body contains `**Goal:**`
  - local `main` SHA is unchanged
  - the bare remote has at least one `refs/heads/agent/*` branch
  - that branch's tip subject starts with `docs(changelog):`
  - `.worktrees/` empty and no `agent/*` local branches survive teardown
- A second run (after the first passes) exits 0 with no leftover state.
- Pre-existing scenarios still pass — `bun scenarios/index.ts`,
  `bun scenarios/bugfix-pr-integrate-e2e.ts`, and
  `bun scenarios/feat-small-agent-e2e.ts` are unaffected.
- `bun run lint` and `bun run typecheck` pass.

## Out of scope

- `refactor` Lights out / Foreman scenarios — separate slices each.
- `director` Foreman scenario.
- Backend parity (Success #4) and fixer-cap (Success #5).
- Refactoring or extending `scenarios/lib/*`. If you spot a sharp edge
  while writing the harness, leave a `// TODO` and move on — abstraction
  belongs in its own slice.
- Adding run-log artifact assertions beyond what
  `bugfix-pr-integrate-e2e.ts` already asserts. (The Lights out scenario
  covers per-step run-log artifact presence; duplicating that here adds
  no coverage.)
