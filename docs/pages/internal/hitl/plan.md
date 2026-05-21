---
stage: plan
artifact_root: docs/pages/internal/hitl/
status: draft
upstream:
  - docs/pages/internal/hitl/prd.md
  - docs/pages/internal/hitl/scenario-testing-strategy.md
  - docs/pages/internal/hitl/technology-decisions.md
  - docs/pages/internal/hitl/diagnosis.md
---

# Plan — hitl: conversational plan step in munchkins pipelines

## Problem Summary

Operators building munchkins agents have no way to compose a step where Claude generates a plan and the operator then converses with the same Claude session about that plan before the pipeline continues. This plan introduces **`addHitl(prompt: Prompt)`**: a builder primitive that runs an agent step then enters an in-process conversation loop with the operator — single process, terminal stdin or piped input, session continuity via `--resume <session-id>`, terminator on either side via `/done`.

After the loop, the pipeline moves forward with a fresh Claude session (no inheritance). Non-TTY contexts fail loudly. Mid-conversation errors stay in the loop. The runner participates in the existing `RunLog` and `summaryWriter` machinery — every turn records per-turn files and accumulates Claude usage.

## Goal And Non-Goals

**Goal:** ship `addHitl(prompt)` as a stable public API on `AgentBuilder` (in `packages/munchkins-core/src/builder/agent-builder.ts`), with happy-path coverage in the existing scenario harness and a documented manual-verification procedure.

**Non-goals (v1):**

- Async / persistent state across processes
- External notification channels (Slack, Discord, email)
- Per-`addHitl` timeout configuration
- `addHitl` inside `loop.fixer`
- Slash-command vocabulary beyond `/done`
- Multi-`addHitl` state sharing
- Session inheritance into subsequent steps
- Agent-driven termination via tool-use (text-scan only in v1)
- Consolidated `conversation.md` artifact (per-turn files only)
- Multi-line operator messages (one line per turn)
- Web UI / IDE plugin / structured client protocol

## Scenario Harness Contract

**Single harness scenario, unchanged top-level CLI:** `bun run scenario` continues to invoke `scenarios/index.ts` and runs `bugfix-agent-e2e`. AGENTS.md hard-rule #3 is preserved.

**Behavior delta:** the harness adds a third builder run inside the same scenario, after the existing bugfix-agent run AND after the addSkill mini-builder run (assumes addSkill ships first per D16):

- The mini-builder is constructed inline in `scenarios/index.ts`: `new AgentBuilder("addhitl-coverage", "Harness addHitl coverage", gitWorktreeSandbox()).addHitl(new Prompt(fixtureSystemPath).withUserMessage("Fixture opening"))`.
- The fixture's system-prompt path is a tmp file written at harness setup time (one line of content is enough for `Prompt.resolve()` to succeed). The path lives only inside `scenarios/`; production code is untouched.
- The harness's `mock-claude-responses/` directory grows by **2 new canned response files** for the two conversation turns. Filenames: `99h-hitl-turn-01.json` and `99h-hitl-turn-02.json`. The second response's `output` ends with `/done` on a trailing line (terminator).
- A new `mock-stdin-lines.json` fixture file lists canned operator turns: `["What about edge case X?"]` (just one — the agent's `/done` exits the loop before a second stdin line is needed).
- The harness's expected mock-call count grows by 2.
- The audit assertion in `scenarios/index.ts` is extended with three new checks:
  1. At least one mock spawn entry has `resumeSessionId` set to a non-empty string (proves `--resume` chain).
  2. The conversation terminated (mock-call count is finite, equal to expected).
  3. The hitl mini-builder's worktree was torn down (cleanup audit covers it via the existing logic that walks all builder-produced worktrees).

**Audit-log enrichment** (lives in `scenarios/lib/`):
- `MockCallEntry` gains a fourth new field: `resumeSessionId?: string`. (Building on addSkill's `systemPrompt`, `userPrompt`, `cwd`.)
- `spawnClaudeMock` reads `opts.resumeSessionId` and records it.

**Stdin mock seam:** new `scenarios/lib/mock-read-line.ts` exporting `configureStdinMock(lines: string[])`, `readLineMock()`, `isStdinAvailableMock()`. The harness's `scenarios/index.ts` calls `mock.module()` against `packages/munchkins-core/src/builder/io.ts` to inject these.

**Boundary:** the harness adapts to addHitl. Production code in `packages/munchkins-core/` and `packages/munchkins/` does not gain any harness-aware identifier. The fixture system-prompt path lives only inside `scenarios/`.

## Resolved Technology Decisions

Carried verbatim from `technology-decisions.md`:

| ID  | Decision                                                                                                                                                  |
|-----|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| D1  | Method name: `addHitl(prompt: Prompt)`                                                                                                                    |
| D2  | New `Step` variant `kind: "hitl"` carrying `{ prompt: Prompt }`                                                                                            |
| D3  | Reuse `spawnClaude` with two additions: `SpawnClaudeResult.sessionId?: string`; `SpawnClaudeOptions.resumeSessionId?: string` translating to `--resume`.   |
| D4  | Terminator vocabulary = `/done` from either side.                                                                                                         |
| D5  | Non-TTY = `HitlError("non-tty", ...)` thrown before loop.                                                                                                 |
| D6  | No session inheritance to subsequent steps.                                                                                                               |
| D7  | New `io.ts` module with `readLine` + `isStdinAvailable`. Mocked via `mock.module()` in the harness.                                                       |
| D8  | TTY check happens inside `runHitl` via `isStdinAvailable()`.                                                                                              |
| D9  | Slash-command detection scans the trailing line of agent output for exact `/done` (whitespace-trimmed).                                                   |
| D10 | `class HitlError extends StepError` with `reason: "non-tty" \| "turn-failed" \| "spawn-failed"`. Re-exported.                                              |
| D11 | Pre-conversation header includes `git status -s` of the sandbox cwd.                                                                                      |
| D12 | `addHitl` is a method on `AgentBuilder` only. `HitlError` re-exported.                                                                                    |
| D13 | No CI command changes.                                                                                                                                    |
| D14 | `RunLog.hitlTurn(stepIndex, turnIndex, userPrompt, response, exitCode, durationMs)` for per-turn recording.                                               |
| D15 | Boundary clean.                                                                                                                                           |
| D16 | hitl ships AFTER addSkill (depends on `StepError` base class + `MockCallEntry` enrichment).                                                                |

## Vertical Slices

Two slices. Slice 1 ships the addHitl primitive AND its harness verification together. Slice 2 is the manual live verification recorded in the PR description.

**Prerequisite:** Slice 1 of `addSkill` (which introduces `StepError` / `AgentStepError` / `SkillStepError` and the `MockCallEntry` enrichment with `systemPrompt` / `userPrompt` / `cwd`) must have landed first. If it has not, this plan's Slice 1 must include those prerequisites inline before any addHitl-specific work — but this would significantly expand the slice and is not recommended; addSkill should ship first.

---

### Slice 1 — `addHitl` primitive + io.ts seam + spawn-claude additions + RunLog participation + harness coverage

This slice ships everything needed to verify S1 in CI on merge.

**Scope (production code in `packages/munchkins-core/src/`):**

1. New file `builder/io.ts`:
   ```ts
   export function isStdinAvailable(): boolean {
     return Boolean(process.stdin.isTTY)
     // (v1 trusts isTTY only; piped-input detection deferred per D5/Q5)
   }

   export async function readLine(): Promise<string | null> {
     // Bun-native stdin line read; returns null on EOF.
     // Implementation uses Bun.stdin or fs.readSync as appropriate.
   }
   ```
   Single export module. Both functions are mockable via `mock.module()`.

2. In `builder/spawn-claude.ts`:
   - Add `sessionId?: string` to `SpawnClaudeResult`.
   - Add `resumeSessionId?: string` to `SpawnClaudeOptions`.
   - Extend the argv constructor: if `opts.resumeSessionId`, push `["--resume", opts.resumeSessionId]` into `args`.
   - Extend the stream-json result handler: capture `event.session_id` (if present) and store on the result.

3. In `builder/agent-builder.ts`:
   - Import the new error class:
     ```ts
     export class HitlError extends StepError {
       constructor(public reason: "non-tty" | "turn-failed" | "spawn-failed", message: string, exitCode = 1) {
         super(exitCode, message)
       }
     }
     ```
   - Add `HitlStep` type variant: `{ kind: "hitl"; prompt: Prompt }`.
   - Extend the `Step` union: `Step = AgentStep | DeterministicStep | SkillStep | HitlStep | FinalizeStep`.
   - Add the `addHitl(prompt: Prompt): this` method on `AgentBuilder` (registers any auto-discovered options on the prompt's fragments — same pattern as `add()`).
   - Add a `runHitl(step, cwd, repoRoot, runLog, stepIndex)` private method:
     ```ts
     private async runHitl(
       step: HitlStep, cwd: string, repoRoot: string, runLog: RunLog, stepIndex: number,
     ): Promise<void> {
       const { isStdinAvailable, readLine } = await import("./io.js")
       if (!isStdinAvailable()) {
         throw new HitlError("non-tty", "hitl step requires interactive stdin or piped conversation; got non-TTY closed stdin")
       }
       const { systemPrompt, userPrompt: openingMessage } = step.prompt.resolve(repoRoot)
       printInvocation(systemPrompt, openingMessage)

       // Pre-conversation header
       console.log("=== HITL ===")
       try {
         const status = (await $`git status -s`.cwd(cwd).quiet()).text().trim()
         if (status) console.log(status)
       } catch {
         console.log("[hitl] (no git status available — cwd is not a git repo)")
       }

       // Initial turn (operator's opening message)
       let turnIndex = 1
       const startTime = Date.now()
       const r = await spawnClaude({ systemPrompt, userPrompt: openingMessage, cwd, stream: true })
       runLog.accumulateUsage(r.usage)
       runLog.hitlTurn(stepIndex, turnIndex, openingMessage, r.output, r.exitCode, Date.now() - startTime)
       if (this.outputEndsWithDone(r.output)) {
         console.log("[hitl] agent signaled completion; conversation closed.")
         return
       }
       let sessionId = r.sessionId

       // Conversation loop
       while (true) {
         turnIndex += 1
         process.stdout.write("> ")
         const line = await readLine()
         if (line === null || line.trim() === "/done") {
           console.log("[hitl] operator signaled completion; conversation closed.")
           return
         }
         const turnStart = Date.now()
         const r2 = await spawnClaude({
           systemPrompt: "",
           userPrompt: line,
           cwd,
           stream: true,
           resumeSessionId: sessionId,
         })
         runLog.accumulateUsage(r2.usage)
         runLog.hitlTurn(stepIndex, turnIndex, line, r2.output, r2.exitCode, Date.now() - turnStart)
         if (r2.exitCode !== 0) {
           console.error(`[hitl] turn failed (exit ${r2.exitCode}); operator may retry or type /done`)
           continue
         }
         sessionId = r2.sessionId ?? sessionId
         if (this.outputEndsWithDone(r2.output)) {
           console.log("[hitl] agent signaled completion; conversation closed.")
           return
         }
       }
     }

     private outputEndsWithDone(output: string): boolean {
       const lines = output.split("\n").filter((l) => l.trim().length > 0)
       const last = lines[lines.length - 1]?.trim()
       return last === "/done"
     }
     ```
   - Extend the runner's switch in `run()`:
     ```ts
     } else if (step.kind === "hitl") {
       banner("agent", `Step ${i + 1}/${this.steps.length} — agent`)
       await this.runHitl(step, cwd, repoRoot, runLog, i)
     }
     ```
   - Extend the `describe()` dry-run path with a `kind: "hitl"` branch that prints the resolved system prompt + opening user message + a note "[hitl] would enter conversation loop here".

4. In `run-log.ts`:
   - Add the `hitlTurn(stepIndex: number, turnIndex: number, userPrompt: string, response: string, exitCode: number, durationMs: number)` method. Writes `step-NN-hitl-turn-MM.user.md` and `step-NN-hitl-turn-MM.response.txt`. Writes an events.jsonl entry of `{ type: "hitl", stepIndex, turnIndex, exitCode, durationMs, userBytes, responseBytes }`. Increments `claudeCallCount`.

5. In `builder/index.ts`:
   - Export `HitlError`.

6. In `index.ts` (the package's top-level barrel):
   - Re-export `HitlError`.

7. **No changes** to `packages/munchkins/agents/...`, the Prompt API, sandbox code, registry, or any default agent.

**Scope (harness code in `scenarios/`):**

8. In `scenarios/lib/mock-spawn-claude.ts`:
   - Extend the `MockCallEntry` interface with one more inline field: `resumeSessionId?: string`. (Built on top of addSkill's `systemPrompt` / `userPrompt` / `cwd` enrichment.)
   - Update `spawnClaudeMock` to record `opts.resumeSessionId` per call.
   - Extend canned-response handling: if a response file declares a `sessionId`, return it on the result so the runner has something to feed forward as `resumeSessionId`.

9. New file `scenarios/lib/mock-read-line.ts`:
   ```ts
   let stdinLines: string[] = []
   let nextLineIndex = 0

   export function configureStdinMock(lines: string[]): void {
     stdinLines = lines
     nextLineIndex = 0
   }

   export async function readLineMock(): Promise<string | null> {
     if (nextLineIndex >= stdinLines.length) return null
     return stdinLines[nextLineIndex++] ?? null
   }

   export function isStdinAvailableMock(): boolean {
     return true
   }
   ```

10. In `scenarios/lib/result.ts`:
    - JSON schema's `mockCallLog` entry type gains the `resumeSessionId` field.

11. In `scenarios/index.ts`:
    - Add a `mock.module()` call for `packages/munchkins-core/src/builder/io.ts` that returns the mock module's `readLineMock` / `isStdinAvailableMock`.
    - Configure stdin mock with `["What about edge case X?"]` (one canned operator line).
    - After the addSkill mini-builder run (or the bugfix-agent run if addSkill has not shipped), add the hitl mini-builder run:
      ```ts
      const fixtureSystemPath = await writeTmpFixtureSystemPrompt()
      const hitlBuilder = new AgentBuilder("addhitl-coverage", "Harness addHitl coverage", gitWorktreeSandbox())
        .addHitl(new Prompt(fixtureSystemPath).withUserMessage("Fixture opening"))
      const hitlResult = await hitlBuilder.run()
      if (!hitlResult.succeeded) {
        return { /* fail with phase: "execution", message: "addHitl mini-pipeline failed" */ }
      }
      ```
    - Add the new audit assertions:
      1. At least one entry in `mockCallLog` has `resumeSessionId` set to a non-empty string.
      2. The recorded conversation terminated (loop exited; mock-call count is the expected value).
    - Existing cleanup audit automatically extends.

12. In `scenarios/fixtures/bugfix-agent-e2e/mock-claude-responses/`:
    - Add `99h-hitl-turn-01.json` (initial reply, does NOT end with `/done`, declares a `sessionId: "fixture-session-1"`).
    - Add `99h-hitl-turn-02.json` (second reply ending with `/done` on a trailing line).

13. In `scenarios/fixtures/bugfix-agent-e2e/`:
    - Add `mock-stdin-lines.json` containing `["What about edge case X?"]`. The harness's setup reads this and calls `configureStdinMock(...)`.

**Boundary check:** the harness uses fixture content only inside `scenarios/`. Production code does not reference any harness-only identifier. ✓

**PRD scenarios delivered:** S1 (fully — both the primitive being callable AND harness verification of the conversation loop). S5 indirectly exercised by code paths being type-checked. S6 indirectly exercised by the harness's piped-stdin model (mocked).

**Acceptance criteria:**
- `bun run typecheck` passes.
- `bun run lint` passes.
- `bun run scenario` exits 0 with `result: "pass"`. The result includes the addHitl mini-pipeline's two spawn calls in `mockCallLog`. Audit assertions all green: `--resume` chain present, conversation terminated, no real-claude attempts, cleanup clean.
- The `.munchkins/runs/addhitl-coverage-<ts>-<uuid>/` directory exists and contains `step-01-hitl-turn-01.{user,response}` and `step-01-hitl-turn-02.{user,response}` files plus events.jsonl entries.

**Out-of-harness manual verification for this slice:** none — Slice 2 covers manual.

---

### Slice 2 — Manual live verification + PR record

**Scope:** operator-driven, recorded in the PR description. Not a code-producing slice.

**Procedure** (mirrors `scenario-testing-strategy.md` Manual Verification Subsections):

1. Author a planning subagent at `packages/munchkins/agents/manual-test/prompts/planner.md`. Body teaches: produce a brief 3-bullet plan; on follow-up turns either ask one clarifying question or end with `/done`.

2. Build an ad-hoc agent registered into the registry (script under `examples/manual-hitl-test.ts`):
   ```ts
   import { dirname, join } from "node:path"
   import { fileURLToPath } from "node:url"
   import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins"
   import { GUIDELINES_PATH, defaultSummaryWriter } from "@serranolabs.io/munchkins/agents/_shared/presets"

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
   Run via `bun run packages/munchkins/src/index.ts manual-hitl-test`.

3. Confirm:
   - Banner sequence renders.
   - `=== HITL ===` header appears with the worktree's `git status -s`.
   - Streamed initial plan.
   - Operator types a follow-up; sees agent's reply.
   - Within a few turns, agent ends with `/done`; loop exits.
   - Summary writer phase runs; "PASS" banner; sandbox `teardown("pass", ...)` squash-merges to main.
   - `.munchkins/runs/manual-hitl-test-<ts>-<uuid>/` contains per-turn files.
   - `CHANGELOG.md` gets an auto-generated entry.

4. Repeat with extra checks (S2/S3/S4/S5/S6 manually):
   - **S2 operator-/done:** rerun, type `/done` after one turn.
   - **S3 no inheritance:** add a second `add()` step; confirm its spawn argv lacks `--resume`.
   - **S4 non-TTY:** rerun with `< /dev/null`; confirm `HitlError`.
   - **S5 mid-conv error:** optional; if exercised, temporarily edit `spawnClaude` to throw on the second call.
   - **S6 piped stdin:** rerun with `echo -e "What about edge case X?\n/done\n" | bun run ...`.

5. Record outcomes in the PR description:
   ````
   ### Manual hitl verification
   - S1-live (agent /done): PASS — conversation flowed, agent emitted /done, pipeline continued
   - S2 (operator /done): PASS — pipeline continued
   - S3 (no inheritance): PASS — next step's argv had no --resume
   - S4 (non-TTY): PASS — HitlError thrown on `< /dev/null`
   - S5 (mid-conv error): SKIPPED — no model error encountered
   - S6 (piped stdin): PASS — conversation ran deterministically
   ````

**Acceptance criteria:**
- The PR description contains the manual-verification block.
- All performed checks pass; any skipped check justified.
- No code changes (this slice is procedural).

## Slice Order And Dependencies

```
[addSkill Slice 1 must already be merged]
    │
    ▼
Slice 1 (primitive + io.ts + spawn-claude additions + RunLog + harness coverage)
    │
    ▼
Slice 2 (manual verification + PR record)
```

- **Prerequisite:** addSkill Slice 1 (introduces `StepError` base + `MockCallEntry` enrichment).
- **Slice 1 must land before Slice 2.**
- **No parallelism** within this plan.

## Parallelizable Work

None within this plan. Within Slice 1, production code (core builder + run-log + new io.ts) and harness code (mock-read-line + audit extensions) touch disjoint files but the harness work depends on production `addHitl` + `runLog.hitlTurn` + `io.ts` existing.

**Adjacent parallelism (out of scope):** addSkill is independent and ships first.

## Risks And Failure Modes

1. **`session_id` capture from stream-json may be missing or arrive late.** `spawnClaude` parses the `result` event for `session_id`. If Claude Code changes the stream format, this capture silently fails and `resumeSessionId` is undefined for subsequent turns — the conversation loses continuity. **Mitigation:** the manual S1-live verification catches this each release. Defensive: `runHitl` falls back to no-resume on undefined `sessionId` (passes empty argv flag) — the conversation continues as fresh sessions, which is degraded but functional.

2. **Trailing-line `/done` detection is brittle.** An agent that puts `/done` in markdown code blocks, embedded examples, or mid-text could trigger false positives if the code block happens to be the trailing content. **Mitigation:** v1 scans only the trailing non-empty line, exact match (whitespace-trimmed). The planning subagent's system prompt teaches the convention. If false positives surface in practice, evolve to a more structured marker (e.g. `<<<DONE>>>`) in v2.

3. **Non-TTY detection by `process.stdin.isTTY` may not reliably detect piped input.** v1 trusts `isTTY` only. A pipe with no input (e.g. `< /dev/null`) is correctly detected as non-TTY. A pipe with input (`echo "..." | ...`) — `isTTY` is also `false`, but the pipe has data. v1 fails loudly in both cases. **Mitigation:** S6 (piped stdin) is verified manually only; the harness uses the mock seam to inject canned stdin without going through real `process.stdin`. If real piped-stdin support is needed in production CI flows, evolve `isStdinAvailable` to peek at the pipe.

4. **`HitlError` retro-fit could break downstream consumers.** No retro-fit is introduced; `HitlError` is a fresh class extending `StepError`. Existing consumers are unaffected.

5. **Skill-args injection equivalent for hitl.** N/A — the operator's stdin lines are passed to `spawnClaude` as `userPrompt`, which goes through `Bun.spawn` array-mode. No shell-injection vector.

6. **Banner text confusion.** Same as addSkill: a reader sees "Step N/M — agent" for a hitl step. Documented; deferred follow-up.

7. **Forgetting the manual-verification block on the PR.** Same as addSkill. Reviewer enforces.

8. **Third-builder run inside the scenario shares mock state with prior runs.** The fixture's expected mock-call count grows by 2 (initial + final hitl turn). Filename ordering (`99h-...`) sorts these after addSkill's `99-...`. If a future change shifts indices, fixture filenames must rotate.

9. **`io.ts` module is new and has no existing test.** The harness mocks it; production code that depends on it has no production-side test (consistent with rest of munchkins). Manual verification is the regression safety net.

## Execution Notes

- **Slice 1 commit messages** (recommend split into three commits inside the same PR):
  - `feat(core): add session_id capture + resumeSessionId option to spawnClaude` — small, focused.
  - `feat(core): add addHitl primitive + io.ts seam + HitlError + RunLog hitlTurn` — production runner work.
  - `feat(scenarios): extend bugfix-agent-e2e with addHitl mini-pipeline + readLine mock — satisfies S1` — harness only.

- **Slice 2 is not a commit** — PR-description block.

- **Bun-only.** Per AGENTS.md hard-rule #1.

- **No relative cross-package imports.** Per CLAUDE.md.

- **No new prompt files in production.** The harness uses a tmp file written at scenario startup; production code adds nothing.

- **No new CLI subcommand.** Per D12, `addHitl` is a method.

- **Re-export checklist:**
  - In `packages/munchkins-core/src/builder/index.ts`: add `HitlError`.
  - In `packages/munchkins-core/src/index.ts`: re-export `HitlError`.
  - Do NOT add `addHitl` (it's a method); do NOT add `HitlStep` (internal type); do NOT add `runHitl` (private).

- **No effort sizing in this plan** per CLAUDE.md.

- **Dependency on addSkill:** explicit in D16. This plan assumes `StepError` / `AgentStepError` / `SkillStepError` and the `MockCallEntry` enrichment exist. If they don't, addSkill must ship first.
