---
stage: scenario-testing-strategy
artifact_root: docs/pages/internal/hitl/
status: draft
upstream:
  - docs/pages/internal/hitl/prd.md
  - docs/pages/internal/hitl/diagnosis.md
---

# Scenario Testing Strategy — hitl

## PRD Summary

The PRD defines seven user scenarios (S1–S7) describing how operators compose `addHitl(prompt)` as a conversational planning step. Per PRD Testing Decisions:

- **S1 (happy path)** is the only scenario covered by the harness — verified via a second mini-builder run inside the existing `bugfix-agent-e2e` scenario, parallel to the addSkill plan's pattern.
- **S2–S7** are verified by code review at PR time and by an operator's manual ad-hoc check during a live S1 verification.
- **Live manual verification** covers a real `claude` run-through and is recorded in the PR description.

AGENTS.md hard-rule #3 (harness owns exactly one scenario) is preserved. AGENTS.md hard-rule #6 (no real-claude inside the harness) is preserved by leaning on the existing `spawnClaude` mock seam plus the new `readLine` mock seam.

## Scenario Mapping

| PRD ID | E2E ID                           | In Harness? | Verification Mechanism                                                                                                                                                |
|--------|----------------------------------|-------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| S1     | `bugfix-agent-e2e` (extended)    | ✓           | `bun run scenario` — second mini-builder run exercises `addHitl`; mocked `spawnClaude` returns canned outputs ending with `/done`; mocked `readLine` returns canned operator turn(s); audit asserts `--resume` argv used and conversation terminated; cleanup audit covers the new builder's worktree |
| S2     | —                                | ✗           | Code review + manual: operator types `/done` during live verification                                                                                                |
| S3     | —                                | ✗           | Code review + manual: reviewer confirms next step's spawn argv lacks `--resume`; manual: operator confirms the next step has no memory of the conversation           |
| S4     | —                                | ✗           | Code review + manual: operator runs `< /dev/null` and confirms `HitlError` thrown                                                                                    |
| S5     | —                                | ✗           | Code review only: reviewer confirms turn-failure branch in `runHitl` re-prompts rather than throwing                                                                 |
| S6     | —                                | ✗           | Code review + manual: operator pipes `echo -e "msg\n/done\n" \| ...` and confirms loop reads piped lines                                                            |
| S7     | —                                | ✗           | Code review only: reviewer confirms `runHitl` is invoked from the same step-loop as `runAgent` / `runDeterministic`                                                   |
| Live   | —                                | ✗           | **Manual verification** (CLI). See subsection below.                                                                                                                  |

## Harness CLI Contract

Unchanged: `bun run scenario` continues to invoke `scenarios/index.ts` and runs `bugfix-agent-e2e`.

**Behavior delta:** the harness adds a third builder run after the existing bugfix-agent run AND after the addSkill mini-builder run (assuming addSkill ships first; if the order is reversed, the comments here apply equivalently):

```ts
// inside scenarios/index.ts, after the addSkill mini-builder run completes
const hitlBuilder = new AgentBuilder("addhitl-coverage", "Harness addHitl coverage", gitWorktreeSandbox())
  .addHitl(
    new Prompt(/* fixture system prompt path or inline content */)
      .withUserMessage("Fixture opening message")
  )
const hitlResult = await hitlBuilder.run()
if (!hitlResult.succeeded) { /* fail the scenario */ }
```

The harness's mocked `spawnClaude` returns canned responses whose content includes a trailing `/done` line on the final response — the runner's terminator scan exits the loop deterministically. The harness's mocked `readLine` returns canned stdin lines (e.g. `["What about edge case X?", null]` — null = EOF, but in practice the agent's `/done` exits the loop before stdin runs out).

The mock-call audit gains assertions:
- one mock spawn call has `resumeSessionId` set to a non-empty string (proves chain after the first turn).
- the conversation terminated (mock-call count is finite — the loop exited).
- the system prompt for the first hitl-related call is non-empty (proves Prompt resolved correctly).
- `addHitl` mini-builder's worktree was torn down (cleanup audit checks).

**Audit-log enrichment:** the addSkill plan adds `systemPrompt` / `userPrompt` / `cwd` to `MockCallEntry`. The hitl plan adds **one more field**: `resumeSessionId?: string`, captured from the spawn options (which `runHitl` populates after the first turn). This is required to assert the `--resume` chain.

**Mock-claude-responses fixture growth:** depends on the canned conversation length. Recommended for the harness fixture: **2 canned responses** for the addHitl step:
- Initial reply (the "plan") — does NOT end with `/done`.
- Second reply ending with `/done` on a trailing line.

**Mock-stdin fixture:** **1 canned line** for the operator turn (a follow-up question between the two agent turns). The agent's second-turn `/done` exits the loop without consuming a second stdin line.

Total scenario mock-call count grows by 2 (or however many turns the fixture conversation has).

## Scenario Placement

Existing harness layout unchanged:

```
scenarios/
├── index.ts                                  # extended: +third builder run, +new audit assertions, +readLine mock setup
├── lib/
│   ├── mock-spawn-claude.ts                  # MockCallEntry gains resumeSessionId field
│   ├── mock-read-line.ts                     # NEW — mock for io.ts readLine seam
│   ├── result.ts                             # JSON schema gains resumeSessionId
│   └── sandbox.ts                            # unchanged
└── fixtures/bugfix-agent-e2e/
    ├── seed-repo/                            # unchanged
    ├── mock-claude-responses/                # +2 canned responses for addHitl turns
    ├── mock-stdin-lines.json                 # NEW — canned operator turns
    └── ...                                   # unchanged
```

The post-refactor codebase places the agent-builder at `packages/munchkins-core/src/builder/agent-builder.ts`. The harness's `mock.module()` calls must target both:
- `packages/munchkins-core/src/builder/spawn-claude.ts` (existing; addSkill enriches the mock signature)
- `packages/munchkins-core/src/builder/io.ts` (NEW; created by hitl Slice 1)

Manual-verification procedure is recorded inline in this document.

## Environment Recreation Model

**Harness scenario:** unchanged base. Each builder run (bugfix-agent, optional addSkill mini-builder, hitl mini-builder) creates its own `gitWorktreeSandbox()` worktree. The cleanup audit verifies all worktrees + branches are torn down.

**Stdin handling in the harness:** the addHitl runner branch checks `process.stdin.isTTY` and presence of piped data. **In the harness, neither would be true by default** — which would cause `HitlError`. The runner's TTY check uses `process.stdin.isTTY` directly; the harness bypasses it by mocking `readLine` itself (which is what the runner calls after the TTY check passes).

**Decision:** the runner's TTY check happens BEFORE the first call to `readLine()`. To bypass the TTY check in the harness, the runner exposes a small abstraction at the io.ts seam: `isStdinAvailable(): boolean`. The harness mocks `mock.module()` for `io.ts` exporting both `isStdinAvailable` (returns `true`) and `readLine` (returns canned lines). Production stays clean — `isStdinAvailable` returns `process.stdin.isTTY || hasPipedInput()`.

**Manual verification:** all dependencies real. Operator runs in a real terminal with a real `claude`.

## External Dependency Strategy

**Harness scenario:**
- `spawnClaude` mocked (existing; signature enriched).
- `readLine` + `isStdinAvailable` mocked (new — both via `mock.module()` of `io.ts`).
- `git status -s` (called for the pre-conversation header) — runs against the sandbox's real git repo. No mock needed.
- `Bun.spawn` audit guard continues to reject any `claude` argv.

**Manual verification:** all real.

## Observability And Failure Artifacts

**Harness scenario:** existing JSON-result schema is amended (additive, on top of addSkill's enrichment):

```diff
  "mockCallLog": [
    {
      "index": 0,
      "bytesRead": 1234,
      "systemPrompt": "...",
      "userPrompt": "...",
      "cwd": "/tmp/...",
+     "resumeSessionId": null
    },
    {
      "index": 1,
      ...
+     "resumeSessionId": "abc123"
    }
  ]
```

The new audit assertions:
1. At least one mock call has `resumeSessionId` set (proves the `--resume` chain happened).
2. The conversation terminated (mock-call count is finite — loop exited).
3. No real `claude` spawn attempts occurred.
4. The hitl mini-builder's worktree was torn down (no leaked `.worktrees/`, no leaked `agent/*` branches).
5. The hitl mini-builder's marker files (one per spawn) appear in main's tree (proves squash-merge cleanup ran).

**RunLog inspection:** the `.munchkins/runs/<agent>-<ts>-<uuid>/` directory for the hitl mini-builder run should contain `step-01-hitl-turn-01.user.md`, `step-01-hitl-turn-01.response.txt`, `step-01-hitl-turn-02.user.md`, `step-01-hitl-turn-02.response.txt`, plus events.jsonl entries of `{ type: "hitl", stepIndex: 0, turnIndex: N, ... }`.

**Manual verification:** operator records in PR description:

```
### Manual hitl verification
- S1-live (agent /done): PASS — conversation flowed, agent emitted /done, pipeline continued
- S2 (operator /done): PASS — operator ended with /done, pipeline continued
- S3 (no inheritance): PASS — next step had no memory of conversation
- S4 (non-TTY): PASS — `< /dev/null` triggered HitlError
- S5 (mid-conv error): SKIPPED — no model error encountered (or specify how triggered if exercised)
- S6 (piped stdin): PASS — `echo -e "...\n/done\n" | bun run ...` worked
```

## Completion Gate

A vertical slice in `plan.md` is "done" only when:

- **S1 (harness):** `bun run scenario` exits 0 with `result: "pass"`. New audit assertions all green. Zero real-claude attempts. Cleanup audit shows all worktrees/branches/markers in expected state.
- **S2–S7:** verified by code review at PR time + manual checks during the live S1 verification, recorded in the PR description.
- **Live manual:** operator runs the documented manual procedure once against a real worktree, records outcomes in the PR description.
- **CI:** the existing `test` job runs `bun run scenario` (unchanged command); the harness scenario now includes the addHitl coverage.

A slice that ships hitl source code without S1 green AND the recorded manual-verification block in the PR description is NOT done.

## Manual Verification Subsections

This is a CLI feature — no browser, no UI.

### S1-live — Operator runs addHitl against real `claude` end-to-end

- **Run:**
  1. Author a small planning subagent at `packages/munchkins/agents/manual-test/prompts/planner.md`. System-prompt body:
     ```
     You are a planning subagent. When the operator asks for a plan, produce a brief 3-bullet plan. After your initial plan, on each follow-up turn, either incorporate their input and ask one clarifying question, OR if you have nothing more to add, end your response with /done on its own line.
     ```
  2. Construct an ad-hoc agent registered into the registry:
     ```ts
     import { dirname, join } from "node:path"
     import { fileURLToPath } from "node:url"
     import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core"
     import { GUIDELINES_PATH, defaultSummaryWriter } from "../_shared/presets.js"

     const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts")

     const builder = new AgentBuilder(
       "manual-hitl-test",
       "Manual hitl verification",
       gitWorktreeSandbox(),
     )
       .addHitl(
         new Prompt(GUIDELINES_PATH)
           .withSystem(join(PROMPTS, "planner.md"))
           .withUserMessage("Plan a refactor of the auth module"),
       )
       .summaryWriter(defaultSummaryWriter())
     registry.register(builder)
     ```
  3. Run via `bun run packages/munchkins/src/index.ts manual-hitl-test`.

- **Expected:**
  - Banner sequence renders.
  - `=== HITL ===` header appears with the worktree's `git status -s`.
  - Streamed initial plan (3 bullets).
  - Operator types a follow-up question; sees agent's reply.
  - Within 2–4 turns, agent ends a response with `/done` on its trailing line. Loop exits.
  - Summary writer phase runs (one additional Claude call).
  - "PASS" banner; `gitWorktreeSandbox().teardown("pass", ...)` squash-merges to main.
  - `.munchkins/runs/manual-hitl-test-<ts>-<uuid>/` directory exists with `step-01-hitl-turn-NN.{user,response}` files.
  - `CHANGELOG.md` gets an auto-generated entry.

- **Forbidden:**
  - Loop never terminates (agent doesn't emit `/done`).
  - Stdin reads block forever despite a real terminal.
  - Operator's input ignored or echoed without going through `spawnClaude`.

- **Inspect:**
  - Stdout for banner sequence and conversation flow.
  - Process exit code.
  - Filesystem under the worktree path.
  - `.munchkins/runs/<agent>-<ts>-<uuid>/summary.json` for accumulated tokens and cost (each conversation turn counts as a Claude call).
  - `CHANGELOG.md` top entry.

- **Additional checks during the same session (covers S2/S3/S4/S5/S6 manually):**
  - **S2 (operator-/done):** rerun, but instead of letting the agent terminate, type `/done` after one turn. Confirm loop exits. Pipeline continues.
  - **S3 (no inheritance):** add a second `add()` step after the addHitl in the ad-hoc script. Confirm the second step's spawn argv (printable via runner debug log) does NOT include `--resume`.
  - **S4 (non-TTY):** rerun with `bun run packages/munchkins/src/index.ts manual-hitl-test < /dev/null`. Confirm `HitlError` thrown immediately.
  - **S5 (mid-conv error):** harder to trigger naturally. Optional. If exercised: temporarily edit `spawnClaude` to throw on the second call, confirm runner re-prompts rather than aborts.
  - **S6 (piped stdin):** rerun with `echo -e "What about edge case X?\n/done\n" | bun run packages/munchkins/src/index.ts manual-hitl-test`. Confirm the conversation runs deterministically.

## Ambiguities And Walkthrough Questions

Non-blocking for `plan.md` creation:

1. **Where in the harness's `scenarios/index.ts` should the addHitl mini-builder run go?** Recommended: after the bugfix-agent run AND after the addSkill mini-builder (if addSkill ships first). Resolved in `plan.md`.
2. **`io.ts` API exact shape.** `readLine(): Promise<string | null>` + `isStdinAvailable(): boolean` is the recommended split. Resolved in `plan.md`.
3. **Filename sort-order for the new mock-claude-responses files.** Recommended: `99h-hitl-turn-N.json` so they sort after addSkill's `99-noop-skill-fixture.json`. Resolved in `plan.md`.
4. **Inline fixture system-prompt content.** A single line is sufficient; can be written to a tmp file by the harness if Prompt.resolve insists on a real file path. Resolved in `plan.md`.
