# Diagnosis — hitl: AgentBuilder cannot run a conversational plan step

**Problem:** The munchkins `AgentBuilder` runner has no primitive that combines an agent invocation with a multi-turn conversation between operator and Claude about the agent's output. Today its runner is a strict for-loop over `Step` objects (`agent`, `deterministic`, `finalize`) — each step runs to completion (success or thrown failure), the runner streams output but never reads operator input, and the operator's only intervention surface is "let it finish" or "kill the process."

The intended use case is conversational planning: a step where Claude generates a plan, then the operator and Claude discuss the plan back-and-forth (potentially many turns) — refining, debating, asking clarifying questions — before the pipeline proceeds to act on it. Today this is impossible.

**Scope of this diagnosis:**
- In: `packages/munchkins-core/src/builder/agent-builder.ts` (the `Step` union, the `run()` method's loop, the failure-throw path), `packages/munchkins-core/src/builder/spawn-claude.ts` (only insofar as the streaming-output behavior is the operator's only current visibility), `scenarios/index.ts` (the harness's mock-everything contract that hitl must accommodate).
- Out:
  - Adding a UI / web frontend for hitl. Treated as a separate diagnosis ("hitl-ui") if the operator decides terminal interaction is insufficient.
  - Multi-operator approval policies. Separate diagnosis ("hitl-policy") if needed.
  - Persistent / durable workflow state across runs (resume after process death). Separate diagnosis ("hitl-durability"); explicitly rejected for v1 in favor of single-process operation.
  - External notification channels (Slack, email, Discord). Separate diagnosis ("hitl-notify") — purely additive plumbing on top of whatever core hitl ships.
  - addSkill — separate diagnosis at `docs/pages/internal/add-skill/`.

**Codebase state (post-refactor, current as of writing):**
- The repo has been split into `packages/munchkins-core/` (framework: `AgentBuilder`, `AgentRegistry`, `Prompt`, `spawnClaude`, `gitWorktreeSandbox`, `RunLog`) and `packages/munchkins/` (bundle that imports core and registers default agents at module load).
- Default agents live under `packages/munchkins/agents/<name>/`. Today: `bugfix/` and `refactor/`. Each defines a single exported `builder` constant via `new AgentBuilder(name, description, gitWorktreeSandbox())…` and calls `registry.register(builder)` at module top-level.
- `Prompt`'s API: `withSystem(path)`, `withUserMessage(text)`, `withUserMessageFromOption(name, declaration)`. The first user-prompt fragment is the operator's initial message to Claude.
- `AgentBuilder.run()` resolves the worktree via the constructor-provided `SandboxFactory`; runs steps; runs an optional summary-writer phase that consumes the sandbox's `diff()` to emit a commit message + CHANGELOG markdown; calls `sandboxHandle.teardown(outcome, ctx)` which squash-merges to main on pass or preserves on fail.
- Every run records into `.munchkins/runs/<agent>-<ts>-<uuid>/` via `RunLog`: per-step prompt/user/response files, events.jsonl, summary.json, and (on success) a CHANGELOG entry prepended to the repo's `CHANGELOG.md`.
- The single scenario harness (`scenarios/index.ts`) mocks `spawnClaude` via `mock.module()` against the absolute path `packages/munchkins-core/src/builder/spawn-claude.ts`, accesses agents via `registry.get("bug-fix")`, and asserts post-run cleanup (no leaked worktrees, no leaked agent branches, marker files in main from squash-merge).

**Assumptions:**
- About users: an operator running a munchkins pipeline today is sitting at a terminal watching streamed Claude output. The "human" of "human in the loop" is that same terminal-attended operator in v1, not a remote stakeholder. The operator wants to discuss a plan that Claude generated — multi-turn — before letting the pipeline continue.
- About workflows: a hitl step is a **logical unit** in the pipeline (a conversational plan step), declared at builder-construction time. The operator does not need to inject runtime hitl steps dynamically. Each hitl step is independent — no cross-step state.
- About technical feasibility: Bun's stdin facilities support line-blocking reads. The runner's existing synchronous-await loop accommodates the conversation-loop shape. **Insufficient evidence** about how stdin reads interleave visually with the `spawnClaude` stream-json output that already prints to stdout — the operator may need a clearly-bordered prompt UI above the stream.
- About backwards compatibility: existing default agents (`bugfix`, `refactor`) continue to work unchanged. hitl is additive — a new step kind plus a new builder method.
- About performance/security/accuracy: a hitl conversation blocks the runner indefinitely (no timeout in v1). In CI / non-interactive contexts (the scenario harness, any future GitHub Actions usage), a real conversation is a deadlock. The hitl primitive must surface a clear error in non-TTY contexts (decision: fail loudly, see resolutions below).

**Constraints:**
- **No relative cross-package imports.** Anything new lives in `@serranolabs.io/munchkins` and is consumed via the package name (CLAUDE.md hard rule).
- **Bun only.** No Node-only stdin libraries (e.g. `inquirer`).
- **No harness leakage.** The hitl primitive must not depend on `scenario_id`, `run_id`, or any harness-only identifier (AGENTS.md hard-rule #4). The harness must be able to mock the conversation loop without touching production code paths.
- **Single process.** The runner stays alive throughout the conversation. No fork-and-resume model. The conversation happens via stdin/stdout (or piped equivalents in CI) inside the same Bun process.
- **Builder-level primitive.** Composes with the existing `add()` / `addDeterministic()` / `addSkill()` (post-add-skill plan-funnel) / `finalize()` / `summaryWriter()` chain.
- **Failure semantics must compose.** A hitl error (non-TTY context, mid-conversation spawn failure not recovered) integrates with the existing finalize-on-fail + sandbox `teardown(fail, ...)` worktree-preservation path.
- **Single-seam mockability.** The harness mocks `spawnClaude` at one boundary today. The new stdin-reading abstraction must be similarly mockable at one boundary.
- **RunLog participation.** Each conversation turn (a `spawnClaude -p` call) is a Claude call and must be recorded into the RunLog so the summary-writer phase and the CHANGELOG entry capture the work.

## Resolutions (post-grill-me)

The grill-me stage substantially **reframed** the feature from "approval gate" to "conversational plan step." Key resolutions:

**Feature reframe.** `addHitl` is **its own pipeline step**, not a pause attached to another step. It combines:
1. An agent invocation (loads system prompt, sends operator's initial message via `Prompt.withUserMessage`, streams the planning output).
2. A conversation loop on the same Claude session (chained via `--resume <session-id>`).
3. Termination by either side: agent emits `/done` at the end of its response, or operator types `/done`.

The Prompt API uses the existing methods: `new Prompt(systemPath).withUserMessage(text)`. No Prompt API change required.

**Decisions:**
- **D1 — Execution model:** Synchronous, in-process (Option A). Blocks the runner on stdin until conversation completes. Async / persistent / resume-after-exit deferred to a future feature ("hitl-async") if real demand surfaces.
- **D2 — API shape:** Explicit builder method `addHitl(prompt: Prompt)` (Option A). Peer of `add()` / `addDeterministic()` / `finalize()`. Per-step options (Option B from the original frame) and hooks (Option C) rejected — addHitl as a first-class step kind models the conversation correctly.
- **D3 — State surfaced at pause:** Prompt + `git status` of the worktree (Option B). Operator sees what files have changed since the worktree was created. Last-N-lines and full diff rejected as overkill for v1.
- **D4 — Conversation execution model:** Inline conversation loop in the runner (Option I). The runner reads operator stdin → calls `spawnClaude -p` with `--resume <session-id>` → prints reply → repeats. Single process, works in CI by piping stdin, no interactive subprocess. The earlier-considered "approval gate" and "single text injection" framings were both rejected once the user clarified the use case is multi-turn conversation about a generated plan.
- **D4-extension — Prompt API:** `addHitl(new Prompt(systemPath).withUserMessage(text))`. The Prompt's resolved user-prompt becomes the operator's *opening* message; the conversation continues from there. No new Prompt method required — `withUserMessage` already exists.
- **D5 — Non-TTY behavior:** Fail loudly. When `process.stdin.isTTY === false` and no piped input is available, `addHitl` throws a typed `HitlError` with a clear message. Auto-skip rejected (silent skip risks bypassing review). Real CI-driven hitl (Slack channels, async approval) is acknowledged as the right answer for production CI flows but explicitly out of scope for v1.
- **D6 — Session inheritance to subsequent steps:** None. Each pipeline step that follows `addHitl` gets a fresh Claude session. Inside `addHitl`, the conversation chains via `--resume`; outside, no inheritance. If subsequent steps need information from the conversation, the planning subagent's job during the conversation is to write artifacts (a plan file, source edits) to the worktree — subsequent steps read from the worktree state, not from session memory.
- **D7 — Conversation terminator:** Both sides can terminate, slash-command vocabulary. Agent's system prompt teaches it to end its response with `/done` on its own line when it has nothing more to add. Runner scans agent output for `/done`. Operator's stdin is also scanned for `/done`. Either signal exits the loop.

**Auto-decisions for v1 (kept small per operator preference):**
- **Timeout:** none. Loop blocks indefinitely until terminator.
- **Mid-conversation error:** if a turn's `spawnClaude` exits non-zero, print the error, stay in the loop, re-prompt operator.
- **`addHitl` inside `loop.fixer`:** out of scope. Fixer stays `Prompt`-based; no nested conversational steps.
- **Multi-`addHitl` state sharing:** moot. No session inheritance means each `addHitl` is independent by construction.

**Critical implementation prerequisites:**
- `spawnClaude` must capture and return `session_id` from Claude's stream-json output (currently it captures `usage` but discards `session_id`). The `SpawnClaudeResult` interface gains `sessionId?: string`.
- `spawnClaude` must accept `resumeSessionId?: string` in its options and translate it to `--resume <id>` argv.
- A new `readLine` abstraction lives in `packages/munchkins-core/src/builder/io.ts` (or similar) so the harness can mock stdin reads via the same `mock.module()` pattern used for `spawnClaude`.
- `RunLog` gains a `hitlTurn(stepIndex, turnIndex, userPrompt, response, exitCode, durationMs)` method to record each conversation turn.
