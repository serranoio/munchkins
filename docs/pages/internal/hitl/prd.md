---
stage: prd
artifact_root: docs/pages/internal/hitl/
status: draft
upstream:
  - docs/pages/internal/hitl/diagnosis.md
---

# PRD — hitl: conversational plan step in munchkins pipelines

## Problem Statement

Operators building munchkins agents have no way to compose a step where Claude generates a plan and the operator then converses with the same Claude session about that plan before the pipeline continues. Today, `AgentBuilder` exposes `add()` (a one-shot agent step), `addDeterministic()` (shell commands with optional auto-repair), `finalize()`, and `summaryWriter()` — none of which yield control to a human for back-and-forth dialogue.

The use case is: a pipeline whose first step asks Claude to design something (a refactor plan, a migration plan, a feature design); the operator wants to read that plan, discuss it, push back, request changes, ask clarifying questions — possibly across many turns — before the pipeline proceeds to act on it. Today this is impossible. The operator can only watch the streamed plan and either let the pipeline barrel forward unchanged, or kill the process.

**Current implementation status: missing.** No conversational step kind exists. No `addHitl` method. No runner branch yields stdin to the operator. The `spawnClaude` helper does not capture or chain `session_id`.

**Codebase state.** The framework lives in `packages/munchkins-core/`, with `packages/munchkins/` as the bundle of default agents (`bugfix`, `refactor`). The `Prompt` class exposes `withSystem`, `withUserMessage`, and `withUserMessageFromOption`. `AgentBuilder` accepts a `SandboxFactory`, declares CLI options via `option(name, schema)`, runs steps via `runAgent` / `runDeterministic`, optionally runs a `summaryWriter` phase, and tears down via `sandboxHandle.teardown(outcome, ctx)` (squash-merges to main on pass, preserves on fail). `RunLog` records every Claude call.

All hitl code will land in:
- `packages/munchkins-core/src/builder/agent-builder.ts` — new step variant + runner branch + new method.
- `packages/munchkins-core/src/builder/spawn-claude.ts` — capture `session_id` in result; accept `resumeSessionId` in options.
- `packages/munchkins-core/src/builder/io.ts` — **new file** exposing the `readLine` abstraction (mockable seam).
- `packages/munchkins-core/src/run-log.ts` — new `hitlTurn(...)` method.

## Solution

A new pipeline-step primitive — `addHitl(prompt: Prompt)` — that runs the agent step and then enters an in-process conversation loop with the operator. The loop streams the agent's planning output, then alternates between reading operator input from stdin (via the new `readLine` seam in `io.ts`) and calling `spawnClaude -p` with `--resume <session-id>` to chain turns onto the same Claude session.

The conversation loop terminates when either side signals completion: the agent emits `/done` on its own trailing line at the end of a response, or the operator types `/done` on stdin. After the loop exits, the pipeline moves to the next step with a **fresh Claude session** — no inheritance. If subsequent steps need information from the conversation, the planning subagent's job during the conversation is to write artifacts (plan file, edits) to the worktree; subsequent steps read from the worktree state, not from session memory.

Failure semantics: in a non-TTY context (CI without piped stdin), `addHitl` throws a typed `HitlError` before entering the loop — fails loudly rather than silently bypassing review. If a turn's `spawnClaude` exits non-zero, the runner prints the error and stays in the loop, letting the operator retry or `/done`. Mid-conversation errors do not bubble; only construction-time errors (non-TTY) and post-`/done` finalization issues do.

This solution honors AGENTS.md hard-rule #4 (no harness identifiers in production surfaces): `addHitl` carries only a `Prompt` — no `scenario_id`, `run_id`, harness query params.

## User Scenarios

Each scenario describes one observable behavior. Each maps 1:1 to a verification mechanism in Stage 4.

---

### S1 — Operator runs a planning conversation; agent terminates with `/done`

**Pre-state:** A munchkins agent under construction. A planning subagent system prompt at `packages/munchkins/agents/<name>/prompts/planner.md` whose body teaches the agent to (a) produce a plan when asked, (b) end each response with either a question for the operator or `/done` on its own line when nothing more remains.

**Action:** Operator constructs:

```ts
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core"
import { GUIDELINES_PATH, defaultSummaryWriter } from "../_shared/presets.js"

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts")

const builder = new AgentBuilder(
  "planner-feature",
  "Plan a feature collaboratively with the operator.",
  gitWorktreeSandbox(),
)
  .addHitl(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, "planner.md"))
      .withUserMessage("Plan a refactor of the auth module"),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, "implement.md"))
      .withUserMessage("Implement the plan written by the previous step into the worktree."),
  )
  .summaryWriter(defaultSummaryWriter())
registry.register(builder)
```

…runs the pipeline with stdin attached to a real terminal.

**Expected:**
1. Banner "Step 1/N — agent" prints (addHitl uses the same banner kind as agent steps).
2. The `=== HITL ===` header prints, followed by `git status -s` of the sandbox cwd.
3. The planning subagent streams its plan to stdout.
4. After the agent's first turn completes, operator sees `> ` and types a follow-up question.
5. Runner calls `spawnClaude` with `--resume <session-id>`, agent streams reply, the cycle repeats.
6. At some point, agent ends a response with `/done` on its own trailing line.
7. Runner detects `/done`, prints `[hitl] agent signaled completion; conversation closed.`, exits the loop.
8. Step 2 runs as a fresh Claude session (no `--resume`). Pipeline reaches summary writer + sandbox teardown. On pass, the worktree is squash-merged to main. The run log under `.munchkins/runs/<agent>-<ts>-<uuid>/` contains per-turn files for the hitl step.

**Current status:** missing.

---

### S2 — Operator terminates the conversation with `/done`

**Pre-state:** Same as S1.

**Action:** During the conversation, operator types `/done` on its own line.

**Expected:** Runner detects `/done` on stdin, prints `[hitl] operator signaled completion; conversation closed.`, exits the loop. Pipeline continues identically to S1's post-loop behavior.

**Current status:** missing.

---

### S3 — Subsequent step runs with a fresh Claude session

**Pre-state:** Pipeline ran through S1 or S2. The conversation discussed specific decisions ("don't refactor the OAuth flow, it's frozen"). The operator did not write the conversation to the worktree.

**Action:** Step 2 (an `add()` running an implementation subagent) executes.

**Expected:** Step 2 spawns a fresh `claude -p` invocation with **no `--resume`** — it has no memory of the conversation. The implementation subagent only sees its own system prompt + user message + the worktree's current state. If the operator wanted the OAuth-frozen decision to inform Step 2, the planning subagent during the conversation should have written it to a file in the worktree (e.g. `<worktree>/PLAN.md`) and Step 2's prompt should reference it.

**Current status:** missing. (When implemented, the v1 contract is "no inheritance" — verified by inspecting that no `--resume` is passed to subsequent step's spawn.)

---

### S4 — Pipeline runs in non-TTY context — `addHitl` fails loudly

**Pre-state:** Pipeline contains an `addHitl(...)` step. Pipeline is invoked from a CI job (no piped stdin) or from a script that closed stdin.

**Action:** Operator runs the pipeline.

**Expected:** When the runner reaches the addHitl step, before entering the conversation loop, it checks `process.stdin.isTTY` and the presence of piped data. With neither available, the runner throws `new HitlError("non-tty", "hitl step requires interactive stdin or piped conversation; got non-TTY closed stdin")`. The pipeline's existing error path runs: `failureReason` set, finalize-on-fail commands execute, sandbox `teardown("fail", ...)` preserves the worktree, exit code 1. CI sees a clear red failure with an actionable error message.

**Current status:** missing.

---

### S5 — Mid-conversation, a turn's `spawnClaude` exits non-zero

**Pre-state:** Operator is mid-conversation. A turn's `spawnClaude` call fails (exit code 1) — possibly due to a model error, network blip, or claude CLI issue.

**Action:** Operator was waiting for the agent's reply.

**Expected:** Runner prints `[hitl] turn failed (exit 1); operator may retry or type /done`. Loop does NOT exit. Operator's `> ` prompt re-appears. Operator can retry the same message (which will start a new turn from the same session-id, since `--resume` is sticky), or type `/done` to exit. The pipeline continues if the operator subsequently types `/done`.

**Current status:** missing.

---

### S6 — Conversation driven by piped stdin (deterministic)

**Pre-state:** Pipeline contains an `addHitl(...)` step. Operator pipes a scripted conversation:

```bash
echo -e "Add tests for the auth refactor\n/done\n" | bun run packages/munchkins/src/index.ts planner-feature
```

**Action:** Pipeline runs.

**Expected:** Stdin is read line-by-line. First line ("Add tests for the auth refactor") is sent as the first conversation turn. Agent replies (streamed to stdout). Next line is `/done` — operator-side terminator detected, loop exits. This enables both deterministic CI-style scripted interactions and the harness's auto-`/done` mock for verification of the addHitl runner branch.

**Current status:** missing.

---

### S7 — addHitl interleaves freely with `add()` and `addDeterministic()`

**Pre-state:** A pipeline mixes step kinds:

```ts
new AgentBuilder("complex", "...", gitWorktreeSandbox())
  .add(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "initial.md")).withUserMessageFromOption("spec", {...}))
  .addHitl(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "planner.md")).withUserMessage("..."))
  .add(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "implement.md")))
  .addDeterministic([...DEFAULT_CHECKS], { loop: { maxIterations: 3, fixer: defaultFixer() } })
  .summaryWriter(defaultSummaryWriter())
```

**Action:** Operator runs the pipeline.

**Expected:** Steps execute in declared order. Banner sequence renders. Auto-repair loop on the deterministic step continues to use `Prompt`-based fixers (no addHitl inside). The pipeline reaches summary writer + teardown. The worktree is squash-merged to main on pass.

**Current status:** missing.

---

## Implementation Decisions

These decisions are inherited from the diagnosis (post-grill-me resolutions). They constrain Stage 6 (`plan.md`).

1. **A new step kind `kind: "hitl"`** is introduced in `AgentBuilder`'s `Step` discriminated union. It carries `{ prompt: Prompt }` only.
2. **A new builder method `addHitl(prompt)`** appends the step. Returns `this` for chain composition.
3. **A new `runHitl(step, cwd, repoRoot, runLog, stepIndex)` private method** mirrors the shape of `runAgent` / `runDeterministic`. It:
   - Resolves the prompt via `step.prompt.resolve(repoRoot)`.
   - Verifies stdin availability (TTY or piped) and throws `HitlError` if neither.
   - Prints the `=== HITL ===` header + the worktree's `git status -s` output.
   - Calls `spawnClaude` with the resolved system prompt + user message; captures the returned `sessionId`. Records the turn via `runLog.hitlTurn(...)`.
   - Enters the conversation loop: read stdin line via `readLine()` from `io.ts`, call `spawnClaude -p` with `--resume <sessionId>`, capture new sessionId, record turn, repeat. Termination on either-side `/done`.
4. **Two additions to `spawnClaude`** (in `packages/munchkins-core/src/builder/spawn-claude.ts`):
   - `SpawnClaudeResult` gains a `sessionId?: string` field, parsed from the `session_id` in Claude's stream-json output (the existing `result` event handler is extended).
   - `SpawnClaudeOptions` gains an optional `resumeSessionId?: string` field that translates to `--resume <id>` in the constructed argv.
5. **A new `io.ts` module** at `packages/munchkins-core/src/builder/io.ts` exporting `readLine(): Promise<string | null>`. This is the single mockable seam for stdin reads (parallel to `spawn-claude.ts` for spawns). The harness mocks this via `mock.module()`.
6. **Typed error class:** `HitlError extends StepError`. Reuses the `StepError` base introduced by the addSkill feature. Carries an `exitCode` (defaulting to 1) and a `reason: "non-tty" | "turn-failed" | "spawn-failed"` field.
7. **Slash-command terminator vocabulary:** v1 recognizes only `/done`. Both agent-side (scanned at the trailing line of streamed output) and operator-side (read from stdin). Future verbs (`/abort`, `/escalate`) are out of scope.
8. **No session inheritance to subsequent steps.** The runner does not propagate `sessionId` past the addHitl step.
9. **No production-agent modification for the harness.** Following the pattern locked in the addSkill plan, the harness exercises addHitl via a second mini-builder run inside the existing scenario.
10. **RunLog participation.** `RunLog` gains `hitlTurn(stepIndex, turnIndex, userPrompt, response, exitCode, durationMs)`. Per-turn files are written as `step-NN-hitl-turn-MM.{user,response}`. Each turn's Claude usage accumulates into the run summary.
11. **Re-export `HitlError`** from `packages/munchkins-core/src/builder/index.ts` and `packages/munchkins-core/src/index.ts`.

## Testing Decisions

**Coverage split (matching addSkill's pattern):** the happy path (S1) is the only addHitl behavior covered by automation. S2–S7 are not covered by automated tests; they are verified by code review at PR time and by an operator's manual ad-hoc check during a live S1 verification. AGENTS.md hard-rule #3 (harness owns exactly one scenario) is preserved.

1. **Scenario-harness coverage (S1 only).** The existing `scenarios/index.ts` is extended to add a **second mini-builder run** after the bugfix-agent run (and after the addSkill mini-builder if that ships first), exercising `addHitl(...)`. The harness mocks both `spawnClaude` and `readLine` (the new io.ts seam). The mock conversation has 2 canned spawn responses (initial plan + final reply ending with `/done`) and 1 canned stdin line (a follow-up question; the agent's `/done` ends the loop). The mock-call audit asserts: at least one spawn call had `resumeSessionId` set; the conversation terminated; the addHitl turn-files appeared in the run log; the marker files for both spawn calls landed in main via squash-merge.

2. **No automated coverage for S2–S7.** Per technology-decisions.md D9. Justification: implementation surface is moderate (~80–120 LOC across `runHitl`, `io.ts`, two `spawnClaude` additions, one `RunLog` method). Risk of silent regression accepted; if a regression surfaces, automated coverage is reintroduced.

3. **Manual live verification.** Operator-driven, recorded in the PR description. Steps:
   - Author a small planning subagent at `packages/munchkins/agents/manual-test/prompts/planner.md` whose body teaches the slash-command terminator convention.
   - Build an ad-hoc agent registered into the registry, run it against real `claude` in a real worktree.
   - Confirm: banner sequence renders, `git status` prints before the conversation, conversation flows turn-by-turn, agent emits `/done`, pipeline completes, summary writer runs, teardown squash-merges to main on pass.
   - Repeat with operator-side `/done` (S2 manually).
   - Repeat with `< /dev/null` to verify `HitlError` (S4 manually).
   - Repeat with piped stdin to verify scripted conversation (S6 manually).
   - Record outcomes in the PR description.

4. **No fixture system-prompt files in production.** The harness's mock seam catches all `spawnClaude` calls; the fixture's system prompt content can be inline in `scenarios/index.ts` (or pulled from a tmp file) as long as the Prompt resolves successfully.

## Out Of Scope

- **Async / persistent state across processes.** No serialization of pipeline state to disk. No `munchkins resume <run-id>` CLI command. Sync-only v1.
- **External notification channels.** No Slack / Discord / email integration. The "human" of "human in the loop" is the operator at the terminal in v1.
- **Per-`addHitl` timeout configuration.** No timeout — the loop blocks until terminator.
- **`addHitl` inside `loop.fixer`.** The deterministic-loop fixer remains `Prompt`-based.
- **Slash-command vocabulary beyond `/done`.** No `/abort`, `/escalate`, `/retry`, etc. in v1.
- **Multi-`addHitl` state sharing.** Each addHitl is independent.
- **Session inheritance into subsequent steps.** Each step after `addHitl` gets a fresh Claude session.
- **Agent-driven termination via tool-use.** v1 detects `/done` via streaming text scan only.
- **Conversation transcript capture as a structured artifact.** v1 captures per-turn files via RunLog. A consolidated `conversation.md` file is a follow-up if operator demand surfaces.
- **Multi-line operator messages.** v1 reads one line per turn.
- **Web UI / IDE plugin / structured client protocol.** The single inline-loop model intentionally forecloses these for v1.

## Further Notes

- **Empirical evidence backing the design.** The session-id chain via `--resume` works in headless `claude -p` (verified during the addSkill grill-me; `--resume` is documented in `claude --help`). No new empirical test required; if a future Claude Code version changes `--resume` semantics, the manual verification will catch it.
- **Failure-mode parity with existing step kinds.** A non-TTY `HitlError` triggers the same finalize-on-fail / sandbox-teardown(fail) path as any other step's exception.
- **The `withUserMessage` opening message is the operator's first turn.** The Prompt's resolved user-prompt content is the operator's role for that initial turn. Document this clearly in the README so subagent authors don't confuse it with an instruction-style prompt fragment.
- **`/done` is intentionally a string scan, not a parser.** False positives are theoretically possible if an agent's response legitimately contains `/done` mid-text — mitigation: scan only the trailing line. Document the convention in the planning-subagent prompt template.
- **The `git status -s` display before the conversation depends on the worktree being a git repo.** `gitWorktreeSandbox()` produces a git worktree. If a future `SandboxFactory` produces a non-git cwd, addHitl falls back to printing `[hitl] (no git status available — cwd is not a git repo)` rather than failing.
- **Summary-writer integration.** Because the conversation may modify worktree files (the agent edits files during the discussion), the summary writer's `sandboxHandle.diff()` automatically captures any changes. No special wiring needed.
