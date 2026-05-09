---
stage: technology-decisions
artifact_root: docs/pages/internal/hitl/
status: draft
upstream:
  - docs/pages/internal/hitl/prd.md
  - docs/pages/internal/hitl/scenario-testing-strategy.md
  - docs/pages/internal/hitl/diagnosis.md
---

# Technology Decisions — hitl

This stage resolves implementation-shaping forks before plan creation. Most architectural decisions were already locked in grill-me; this artifact records them as constraints + the few remaining mechanical forks.

---

## D1 — Builder method name

**Decision:** `addHitl(prompt: Prompt)`. Matches the `addX` chain idiom (`add`, `addDeterministic`, `addSkill`, `finalize`).

**Constrained — locked in PRD.**

---

## D2 — Step kind in the `Step` union

**Decision:** new variant `kind: "hitl"` carrying `{ prompt: Prompt }`. Peer of existing `agent`, `deterministic`, `skill` (post-addSkill), and `finalize` variants.

**Constrained — locked in PRD.**

---

## D3 — Spawn invocation strategy

**Decision:** reuse `spawnClaude` with two additions in `packages/munchkins-core/src/builder/spawn-claude.ts`:
- `SpawnClaudeResult` includes `sessionId?: string`, parsed from the `session_id` field in Claude's stream-json `result` event.
- `SpawnClaudeOptions` accepts `resumeSessionId?: string` translating to `--resume <id>` argv.

**Chosen:** keeps the spawn surface minimal; the additions are forward-compatible with future features that need session-id chaining. No new spawn helper.

**Rejected:**
- New `spawnClaudeWithResume` function — pure indirection.
- Forking the conversation into a separate interactive `claude` subprocess — explicitly rejected during grill-me (constraint: single process).

---

## D4 — Conversation terminator

**Decision:** both sides terminate via `/done`.
- Agent's response: scan the **trailing line** of streamed output (whitespace-trimmed, exact match against `/done`).
- Operator's stdin: when a line equals `/done` (whitespace-trimmed), exit the loop.

**Constrained — locked in grill-me D7.**

---

## D5 — Non-TTY behavior

**Decision:** `addHitl` throws `new HitlError("non-tty", "hitl step requires interactive stdin or piped conversation; got non-TTY closed stdin")` before entering the loop when neither `process.stdin.isTTY === true` nor piped data is buffered.

The check happens inside `runHitl` (production code), via the new `isStdinAvailable()` function in `io.ts`. The harness mocks `isStdinAvailable` (returns `true`) alongside `readLine` to bypass the check inside scenarios.

**Constrained — locked in grill-me D5.**

---

## D6 — Session inheritance to subsequent steps

**Decision:** none. After the addHitl step exits its loop, the runner does NOT propagate `sessionId`. Subsequent `add()` / `addSkill()` / `addDeterministic()` steps run as fresh Claude invocations.

**Constrained — locked in grill-me D6.**

---

## D7 — Stdin reading abstraction (for harness mockability)

**Decision:** **separate `io.ts` module.** A new file at `packages/munchkins-core/src/builder/io.ts` exports:

```ts
export function isStdinAvailable(): boolean {
  return Boolean(process.stdin.isTTY) || /* piped-input detection */
}

export async function readLine(): Promise<string | null> {
  // Bun stdin read line, returns null on EOF
}
```

The harness mocks this entire module via `mock.module()` — the same pattern used for `spawn-claude.ts`.

**Chosen:** matches the existing mock-pattern exactly. New module is small and focused. No DI plumbing.

**Rejected:**
- DI on AgentBuilder constructor — leaks DI surface to all consumers; not used elsewhere in the codebase.
- Global `process.stdin` replacement — magic; harder to reason about.

---

## D8 — TTY-detection placement

**Decision:** the TTY/piped-stdin check happens inside `runHitl`, before any spawn or `readLine` call. Production code calls `isStdinAvailable()` from `io.ts`. Throws `HitlError("non-tty", ...)` if false.

**Chosen:** keeps the check visible at the runner branch where the conversation is initiated. Fail-fast.

**Rejected:**
- Inside `io.readLine` — would make the failure mode of `readLine()` ambiguous.
- At builder-construction time — premature; the check must run at execution time.

---

## D9 — Slash-command detection in agent output

**Decision:** the runner scans the **final non-empty trailing line** of the agent's full streamed output for `/done` (whitespace-trimmed, exact match). Anywhere else in the response, `/done` is treated as content.

**Chosen:** reduces false positives. Trailing-line convention matches what the planning subagent system prompt teaches.

**Rejected:**
- Substring search anywhere in the response — false-positive risk.
- Tool-use detection — v1 has no MCP tool wiring.
- Stop-reason inspection from Claude's `stop_reason` field — `"end_turn"` doesn't carry hitl semantics.

---

## D10 — Error class shape

**Decision:** `class HitlError extends StepError` with fields:
- `exitCode: number` (defaults to 1)
- `reason: "non-tty" | "turn-failed" | "spawn-failed"`
- `message: string` (human-readable, set by reason)

Re-exported from `packages/munchkins-core/src/builder/index.ts` and `packages/munchkins-core/src/index.ts` alongside `StepError` / `AgentStepError` / `SkillStepError` (the addSkill error classes — which must ship first).

**Chosen:** matches the typed-error pattern locked in addSkill D5. Operators can branch on `instanceof HitlError` or on `reason`.

**Rejected:**
- Reuse `AgentStepError` — loses the `reason` discriminator.
- Multiple distinct error classes (`HitlNonTtyError`, etc.) — premature class proliferation.

---

## D11 — `git status` invocation for the pre-conversation header

**Decision:** call `git status -s` (short form) via Bun's `$` shell builder, capturing stdout, in the sandbox `cwd`. Print the captured string between the `=== HITL ===` header and the operator's first prompt. If the call fails (cwd is not a git repo), fall back to `[hitl] (no git status available — cwd is not a git repo)`.

**Chosen:** short form is compact; `gitWorktreeSandbox()` produces a git repo by construction.

**Rejected:**
- `git status` (long form) — verbose.
- `git diff --stat` — different info; doesn't show untracked files.
- No status display — operator loses pre-conversation context they explicitly asked for.

---

## D12 — Re-export strategy

**Decision:** `addHitl` is a method on `AgentBuilder` only. No new top-level export added for the method itself. The `HitlError` class IS re-exported (per D10).

**Chosen:** matches `add` / `addDeterministic` / `addSkill` pattern. Public API stays minimal.

**Rejected:** top-level `hitlStep(prompt)` factory — no caller benefit.

---

## D13 — CI command extension

**Decision:** **no CI command changes.** The existing `test` job runs `bun run scenario`. The harness scenario's behavior changes (gains a third mini-builder run for hitl), but the command itself is unchanged.

**Constrained — matches addSkill D13.**

---

## D14 — RunLog participation

**Decision:** `RunLog` gains:

```ts
hitlTurn(stepIndex: number, turnIndex: number, userPrompt: string, response: string, exitCode: number, durationMs: number): void
```

Per-turn files written as:
- `step-NN-hitl-turn-MM.user.md`
- `step-NN-hitl-turn-MM.response.txt`

Events.jsonl entry: `{ type: "hitl", stepIndex, turnIndex, exitCode, durationMs, userBytes, responseBytes }`.

`claudeCallCount` increments per turn. Claude usage accumulates via the existing `accumulateUsage` method.

**Chosen:** parallel structure to `agentStep` and the addSkill plan's `skillStep`. Preserves run-log fidelity for summary-writer + CHANGELOG output.

**Rejected:** treat the entire conversation as a single record — loses per-turn debugging info.

---

## D15 — Plan-funnel boundary review

Reviewed: no decision above leaks harness-specific identifiers into the production contract.

- `addHitl` carries only a `Prompt`. No `scenario_id`, `run_id`, harness query params.
- The `io.ts` module lives in production code (`packages/munchkins-core/src/builder/`) but exposes generic `readLine` / `isStdinAvailable` functions — no harness-aware behavior.
- The `git status -s` invocation is a side effect inside `runHitl` — no harness coupling.

**Boundary clean.**

---

## D16 — Ordering with addSkill

**Decision:** **hitl ships AFTER addSkill.** The hitl plan depends on:
- The `StepError` base class introduced by addSkill (D5).
- The `MockCallEntry` enrichment (`systemPrompt`, `userPrompt`, `cwd`) introduced by the addSkill harness work.
- The pattern of "second mini-builder run inside the harness scenario" established by addSkill.

If addSkill is not yet merged, hitl's plan must include the relevant subset of addSkill's prerequisites (`StepError` base class, `MockCallEntry` enrichment) inline. Recommended sequence: ship addSkill first, then hitl as a follow-up.

---

## Open Questions Deferred to `plan.md`

- **Q1.** Exact `io.ts` API shape — single `readLine()` function vs. a `ReadLineSource` interface. Recommended: single function for v1.
- **Q2.** Filename convention for the addHitl mock-claude-response fixtures. Recommended: `99h-hitl-turn-N.json`.
- **Q3.** Where the addHitl mini-builder run lives in `scenarios/index.ts` (after bugfix-agent + addSkill mini-builder). Recommended: after both, sequentially.
- **Q4.** Inline fixture system-prompt content for the harness — single-line vs file-on-disk. Recommended: write to a tmp file at harness setup time so `Prompt.resolve` can read it.
- **Q5.** `isStdinAvailable()` exact piped-input detection logic — `process.stdin.isTTY === true` is straightforward, but detecting "piped data is buffered" requires a non-blocking peek. Recommended: trust `!process.stdin.isTTY === false` is enough in v1; if false alarms surface, revisit.
