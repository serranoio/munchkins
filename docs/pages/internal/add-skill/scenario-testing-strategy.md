---
stage: scenario-testing-strategy
artifact_root: docs/pages/internal/add-skill/
status: draft
upstream:
  - docs/pages/internal/add-skill/prd.md
  - docs/pages/internal/add-skill/diagnosis.md
---

# Scenario Testing Strategy — addSkill

## PRD Summary

The PRD defines seven user scenarios (S1–S7) describing how operators compose Claude Code skills as steps in a munchkins agent pipeline via a new `addSkill(name, args?)` builder primitive. The PRD's Testing Decisions section explicitly splits coverage:

- **S1 (happy path)** is the only scenario verified through the scenario harness, by adding a second mini-builder run inside the existing `bugfix-agent-e2e` scenario rather than creating a new harness scenario. AGENTS.md hard-rule #3 (harness owns exactly one scenario) is preserved.
- **S2–S7** are verified by code review at PR time and by an operator's manual ad-hoc check during a live S1 verification.
- A live-`claude` happy path is verified manually and recorded in the PR description, per AGENTS.md hard-rule #6.

This strategy operates inside an **existing** harness scaffold (`scenarios/index.ts`, `scenarios/lib/`, `scenarios/fixtures/bugfix-agent-e2e/`). No new harness scenario, no new top-level harness directory, no new CLI verb. The strategy is therefore an amendment-shaped delta on the existing `docs/pages/internal/scenario-testing-strategy.md`, not a replacement.

## Scenario Mapping

The harness still owns exactly one deep scenario: `bugfix-agent-e2e`. addSkill happy-path coverage rides inside that one scenario as an additional builder run (after the bugfix-agent run, before the harness's audit assertions). All other addSkill scenarios are out-of-harness.

| PRD ID | E2E ID                        | In Harness? | Verification Mechanism                                                                                                                                  |
|--------|-------------------------------|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| S1     | `bugfix-agent-e2e` (extended) | ✓           | `bun run scenario` — second mini-builder run exercises `addSkill("noop-fixture")`; mock-call audit asserts one call had user prompt `/noop-fixture` and empty system prompt; cleanup audit asserts the addSkill marker file landed in main via squash-merge |
| S2     | —                             | ✗           | Code review + manual: operator passes a multi-line / multi-word `args` during S1-live and confirms the skill receives it intact                                |
| S3     | —                             | ✗           | Code review + manual: operator authors a project-local skill in `<repo>/.claude/skills/` and runs S1-live against it; confirms project-local resolution wins  |
| S4     | —                             | ✗           | Code review + manual: operator runs S1-live against a plugin-namespaced skill (e.g. `addSkill("plugin:foo")`); confirms colon passes through unparsed   |
| S5     | —                             | ✗           | Code review + manual: operator deliberately triggers a non-zero exit and confirms `SkillStepError` propagates, finalize-on-fail runs, sandbox preserved |
| S6     | —                             | ✗           | Code review only: `addSkill("nonexistent")` is a no-op contract; reviewer confirms no munchkins-side validation exists                                 |
| S7     | —                             | ✗           | Code review only: reviewer confirms `addSkill` lives in the same step-ordering loop as `add` and `addDeterministic`; no special ordering branches      |
| Live   | —                             | ✗           | **Manual verification** (CLI). See subsection below.                                                                                                    |

## Harness CLI Contract

Unchanged: `bun run scenario` continues to invoke `scenarios/index.ts` and runs `bugfix-agent-e2e`. The script is wired in the root `package.json` as `"scenario": "bun run scenarios/index.ts"`.

**Behavior delta:** the harness adds a second builder run after the existing bugfix-agent run completes. The new run:

```ts
// inside scenarios/index.ts, after agentResult success but before the audit assertions
const skillBuilder = new AgentBuilder("addskill-coverage", "Harness addSkill coverage", gitWorktreeSandbox())
  .addSkill("noop-fixture")
  .summaryWriter(defaultSummaryWriter())
const skillResult = await skillBuilder.run()
if (!skillResult.succeeded) { /* fail the scenario */ }
```

The harness's mocked `spawnClaude` returns a canned response (one new file in `mock-claude-responses/`) whose content matches the existing pattern: it writes a marker file `__mock_<index>_<stem>.txt` to the worktree so the squash-merge teardown lands the marker on main. The cleanup audit (`assertHappyPathCleanup`) is updated to:
- expect one additional worktree to have been created and torn down (no leaked `.worktrees/` entries),
- expect one additional `agent/*` branch to have been deleted,
- expect the new marker file to be tracked in main.

**Audit-log enrichment (required addition to `mock-spawn-claude.ts`):** the current `spawnClaudeMock` records only `{ index, bytesRead }` plus the marker file write. To assert "the addSkill step had user prompt `/noop-fixture`," `MockCallEntry` gains `systemPrompt`, `userPrompt`, and `cwd` fields. `spawnClaudeMock` accepts `opts: SpawnClaudeOptions` (already passed by the production runner) and records those fields per call.

**New audit assertion in `scenarios/index.ts`:** walk `mockCallLog`, find at least one entry whose `userPrompt === "/noop-fixture"` (exact equality) AND whose `systemPrompt === ""`. If none, fail the scenario with a clear message naming the assertion.

**Mock-claude-responses fixture growth:** exactly one new canned response file. Filename sorts after all bugfix-agent responses (e.g. `99-noop-skill-fixture.json`). Content: minimal `{ exitCode: 0, output: "<skill output text>", durationMs: 100, usage: { ... }, markerFile: "__mock_<n>_<stem>.txt" }` matching the existing fixture conventions.

## Scenario Placement

Existing harness layout is unchanged:

```
scenarios/
├── index.ts                                  # extended: +second builder run, +new audit assertion, +cleanup checks
├── lib/
│   ├── mock-spawn-claude.ts                  # extended to record systemPrompt/userPrompt/cwd
│   ├── result.ts                             # JSON schema gains the three new fields
│   └── sandbox.ts                            # unchanged
└── fixtures/bugfix-agent-e2e/
    ├── seed-repo/                            # unchanged
    ├── mock-claude-responses/                # +1 canned response for the addSkill spawn
    └── ...                                   # unchanged
```

**Mock-target path:** `scenarios/index.ts` mocks `packages/munchkins-core/src/builder/spawn-claude.ts` (the post-refactor location). The plan must verify this path is current at implementation time.

## Environment Recreation Model

**Harness scenario (S1):** unchanged from existing strategy. Fresh sandbox per run via `createSandbox(seedRepoDir)`, real git init from seed fixture, real Bun + filesystem, mocked Claude only via `mock.module()` of `spawn-claude.ts`. Audit guard rejects any real `claude` spawn.

The new addSkill mini-builder uses its own `gitWorktreeSandbox()`-produced sandbox (a worktree off the test sandbox). Each builder run creates and tears down its own worktree under `.worktrees/`. The cleanup audit at the end of the scenario verifies all worktrees were removed and all agent branches deleted.

**Manual verification (live):** real `claude` binary, real worktree (created by `gitWorktreeSandbox()`), real `~/.claude/skills/<name>/SKILL.md` resolved by Claude Code itself. No munchkins-side sandbox.

## External Dependency Strategy

**Harness scenario:** unchanged. `spawnClaude` is the only mocked surface. The audit guard wrapping `Bun.spawn` continues to reject any argv whose first element is `"claude"`, regardless of which step kind triggered the spawn.

**Manual verification:** all dependencies real. Operator chooses a known-safe skill (e.g. `dry-refactor` or a no-op skill they author for the test) and a throwaway worktree.

## Observability And Failure Artifacts

**Harness scenario:** existing JSON-result schema is amended:

```diff
  {
    "scenarioId": "bugfix-agent-e2e",
    "result": "pass" | "fail",
    "durationMs": 0,
    "sandboxPath": "/tmp/...",
-   "mockCallLog": [{ "index": 0, "bytesRead": 1234 }, ...],
+   "mockCallLog": [
+     { "index": 0, "bytesRead": 1234, "systemPrompt": "...", "userPrompt": "...", "cwd": "/tmp/..." },
+     ...
+   ],
    "failure": { "phase": "setup|execution|assertion|cleanup", "message": "...", "stack": "..." },
    "harnessVersion": "0.2.0"
  }
```

The enrichment is required by the new audit assertion. Existing audit assertions (call count, ordering, zero real-claude attempts, cleanup checks) are preserved and extended.

**Manual verification:** operator records in PR description (existing repo convention):
- skill name, args, worktree path
- expected files modified vs actual
- final pipeline exit code (0 = pass; addSkill marker file should appear in main's tree on pass)
- terminal log excerpt showing the addSkill banner and the streaming output
- the corresponding `.munchkins/runs/<agent>-<ts>-<uuid>/summary.json` file (or its key fields)

## Completion Gate

A vertical slice in `plan.md` that delivers any portion of addSkill is "done" only when:

- **S1:** `bun run scenario` exits 0, JSON `result: "pass"`, mock-call audit shows the addSkill step's spawn call had `userPrompt === "/noop-fixture"` and empty `systemPrompt`, mock-call audit shows zero real-claude attempts, cleanup audit shows no leaked worktrees / branches / missing markers.
- **S2–S7:** verified by code review at PR time + manual checks performed during the live S1 verification (multi-line args, project-local skill, plugin-namespaced skill, deliberate non-zero exit). Each manual check's outcome recorded in the PR description.
- **Live manual:** operator runs the documented manual procedure once against a real worktree, records the result in the PR description, and confirms (a) the skill performed visible work in the worktree, (b) the pipeline reached the summary writer + teardown, (c) the worktree was squash-merged to main on pass with the run captured in `.munchkins/runs/...`.
- **CI:** the existing `test` job runs `bun run scenario` (unchanged command). No new commands.

A slice that ships `addSkill` source code without S1 green AND a recorded manual-verification block in the PR description is NOT done.

## Manual Verification Subsections

This is a CLI feature — no browser, no UI. The "manual verification" subsection is a CLI procedure.

### S1-live — Operator runs addSkill against real `claude` end-to-end

- **Run:**
  1. Pick a skill known to operate on a worktree without external dependencies (e.g. `dry-refactor` from the global registry, or a project-local no-op skill the operator authors at `<repo>/.claude/skills/manual-test-noop/SKILL.md` whose body is "Reply with the exact string `MANUAL_TEST_NOOP_OK` and do nothing else").
  2. Construct an ad-hoc agent pipeline (e.g. an exploratory `examples/manual-addskill-test.ts` or a direct registry registration in a scratch file) that uses:
     ```ts
     new AgentBuilder("manual-test", "addSkill manual verification", gitWorktreeSandbox())
       .addSkill("manual-test-noop")
       .summaryWriter(defaultSummaryWriter())
     ```
  3. Run via `bun run packages/munchkins/src/index.ts manual-test` (after registering the test agent into the registry).
- **Open:** terminal — observe stdout streaming.
- **Expected:**
  - Banner sequence renders (`AgentBuilder.run() — manual-test`, then `Step 1/N — agent` for the addSkill step).
  - The streamed output includes the literal string `MANUAL_TEST_NOOP_OK` (from the no-op skill) or, for `dry-refactor`, the skill's actual analysis output.
  - Summary writer phase runs (one additional Claude call, captured in the run log).
  - "PASS" banner; `gitWorktreeSandbox().teardown("pass", { commitMessage })` squash-merges the agent's work onto main.
  - `.munchkins/runs/manual-test-<ts>-<uuid>/` directory exists with `summary.json`, `step-01-agent.{system,user,response}` files, and `events.jsonl`.
  - `CHANGELOG.md` gets a new top entry.
- **Forbidden:**
  - The output does not contain the skill's response (suggests Claude received the slash command as literal text and did not invoke the skill — possible regression in headless skill resolution).
  - "FAIL" banner. Non-zero exit. Worktree preserved without a clear failure reason.
  - The mock audit guard somehow firing — it must NOT be installed in this manual run (this is real `claude`, not the harness).
  - Any plan-funnel artifact files modified outside the worktree.
- **Inspect:**
  - Stdout for the banner sequence and the streamed skill output.
  - Filesystem under the worktree path (logged at the start of the run) — confirm any expected file edits or, for the no-op skill, that nothing was written outside the expected files.
  - Process exit code.
  - `.munchkins/runs/<agent>-<ts>-<uuid>/summary.json` for accumulated tokens and cost.
  - `CHANGELOG.md` top entry for the auto-generated commit message + markdown.
- **Additional checks during the same session (covers S2/S3/S4/S5 manually):**
  - **S2 (multi-word args):** rerun with `addSkill("manual-test-noop", "first arg with spaces and a 'quoted phrase'")`. Confirm the skill receives the args verbatim.
  - **S3 (project-local resolution):** the `manual-test-noop` skill above already lives at `<repo>/.claude/skills/`. Confirm it resolved without falling through to a global skill of the same name.
  - **S4 (plugin namespace):** if any plugin is installed, run `addSkill("plugin-name:skill-name")`. Confirm Claude Code resolves it. If no plugin is available, skip and note in the PR.
  - **S5 (failure path):** rerun with a deliberately invalid skill body that causes `claude -p` to exit non-zero (e.g. a skill whose body asserts a missing file). Confirm the pipeline throws `SkillStepError`, finalize-on-fail commands run, sandbox `teardown("fail")` preserves the worktree at the path printed on FAIL.

## Ambiguities And Walkthrough Questions

Non-blocking for `plan.md` creation:

1. **Where in the harness's `scenarios/index.ts` should the addSkill mini-builder run go?** Options: (a) before the bugfix-agent run, (b) after, or (c) parallel via `Promise.all`. Recommended: after — keeps the existing bugfix-agent run as the lead scenario; addSkill is verified incrementally. Resolved in `plan.md`.
2. **Which skill name does the addSkill mini-builder use?** Recommended: `noop-fixture` — never resolves; mock catches it before resolution. Stable name not registered anywhere. Resolved in `plan.md`.
3. **Fixture canned response shape.** The existing fixtures include `markerFile` instructions so the squash-merge cleanup audit works. The addSkill canned response must follow the same pattern. Resolved in `plan.md`.
