---
stage: technology-decisions
artifact_root: docs/pages/internal/add-skill/
status: draft
upstream:
  - docs/pages/internal/add-skill/prd.md
  - docs/pages/internal/add-skill/scenario-testing-strategy.md
  - docs/pages/internal/add-skill/diagnosis.md
---

# Technology Decisions — addSkill

This stage resolves implementation-shaping forks before plan creation. Decisions are scoped to architecture, integration, and verification surfaces — not product behavior. Product decisions stay in `prd.md`; per-slice mechanical detail stays in `plan.md`.

---

## D1 — Builder method name

**Decision:** `addSkill(name, args?)`

Matches the user's vocabulary and aligns with the existing `addX` chain idiom (`add`, `addDeterministic`, `finalize`, `summaryWriter`).

**Rejected:** `addSlashCommand` (obscures intent), `useSkill` (breaks `addX` idiom), `runSkill` (implies eager execution).

---

## D2 — Step kind in the `Step` union

**Decision:** new variant `kind: "skill"` carrying `{ name: string; args?: string }`. Added as a peer to the existing `agent`, `deterministic`, and `finalize` variants in `packages/munchkins-core/src/builder/agent-builder.ts`.

**Rejected:** reuse `kind: "agent"` and embed skill metadata in `Prompt` (couples skill semantics to `Prompt`); a separate parallel runtime outside `AgentBuilder` (violates compose-with-builder constraint).

---

## D3 — Spawn invocation strategy

**Decision:** reuse `spawnClaude` unchanged. The skill step constructs `userPrompt = args ? \`/${name} ${args}\` : \`/${name}\``, passes empty string as `systemPrompt`, sets `cwd` to the sandbox `cwd`, and `stream: true` matching `runAgent`.

**Constrained.** Locked by PRD Implementation Decision #3 and verified empirically. A new `spawnSkill` helper would add code without behavior — CLAUDE.md "Wrapper Functions" red flag.

---

## D4 — Argument escaping / validation

**Decision:** **trust the operator. No munchkins-side escaping or validation of `args`.** The string is concatenated verbatim after `/<name> ` and handed to `spawnClaude`, which passes it as the `-p` argument to `Bun.spawn`.

**Reasons:**
- Slash-command syntax accepts any string after the command name; Claude Code parses on the first whitespace.
- `Bun.spawn` receives args as an array → no shell-injection.
- Operator owns content (multi-line, JSON, embedded quotes).

**Rejected:** strip newlines (would break legitimate multi-line skills), regex-validate the name (parallel to Claude Code's resolver), JSON-encode (translation layer for no benefit).

---

## D5 — Failure-error class hierarchy

**Decision:** introduce a typed error hierarchy in `packages/munchkins-core/src/builder/agent-builder.ts`:

```ts
class StepError extends Error { constructor(public exitCode: number, message: string) { super(message) } }
class AgentStepError extends StepError { constructor(exitCode: number) { super(exitCode, `agent step failed (exit ${exitCode})`) } }
class SkillStepError extends StepError { constructor(public skillName: string, exitCode: number) { super(exitCode, `skill step "${skillName}" failed (exit ${exitCode})`) } }
```

The existing `runAgent` failure path is **retro-fitted** to throw `AgentStepError` instead of `new Error("agent step failed (exit <code>)")`. The new skill runner throws `SkillStepError`. Consumers can `catch (err) { if (err instanceof SkillStepError) ... }` for structured handling.

The error message text is preserved verbatim inside `AgentStepError`, so any string-matching consumer continues to work.

**Re-export:** `StepError`, `AgentStepError`, `SkillStepError` exported from `packages/munchkins-core/src/builder/index.ts` and re-exported from `packages/munchkins-core/src/index.ts`.

---

## D6 — Banner kind in the runner output

**Decision:** reuse the existing `"agent"` banner kind. The visible header for an addSkill step reads `Step N/M — agent`, identical to a `Prompt`-driven agent step.

**Rejected:** add a `"skill"` banner kind (cosmetic; defer until operator feedback shows confusion); annotate the banner with `(via addSkill)` (pollutes runner output).

---

## D7 — Audit-log enrichment in the harness

**Decision:** extend `MockCallEntry` in `scenarios/lib/mock-spawn-claude.ts` with three new **inline** fields alongside existing `{ index, bytesRead }`:

```ts
interface MockCallEntry {
  index: number
  bytesRead: number
  systemPrompt: string
  userPrompt: string
  cwd: string
}
```

`spawnClaudeMock` accepts `opts: SpawnClaudeOptions` (which the production runner already passes through `spawnClaude`) and records those fields per call.

**Rejected:** nested `args` sub-object (no payoff); parallel `argsLog` array (splits concept); capture entire `SpawnClaudeOptions` (future fields would leak unintentionally).

**Migration impact:** `result.ts` JSON schema gains the three additional fields per `mockCallLog` entry. Out-of-harness consumers (CI parsing) unaffected — additive change.

---

## D8 — Unit-test runner (MOOT — superseded by D9)

Moot. D9 dropped unit tests entirely; no second test runner is introduced.

---

## D9 — Where do S2–S7 verifications live?

**Decision:** **drop S2–S7 from automated coverage.** S1 (happy path) is covered by extending the existing `bugfix-agent-e2e` harness scenario. S2–S7 are verified by:

1. **Code review at PR time.** The slash-command construction is a one-liner; the args pass-through, plugin-namespace handling, and error-shape parity are all small enough to eyeball.
2. **Manual ad-hoc check** during the operator's manual S1-live verification (see `scenario-testing-strategy.md`). The operator can deliberately mis-name a skill, deliberately pass a multi-line arg, etc., during the same session.
3. **No CI-enforced regression coverage** for S2–S7 specifically.

**Rejected:** parallel `bun test` runner inside `packages/munchkins-core/`; `scenarios/unit/*` files reusing harness infrastructure; folding S2–S7 assertions into `bugfix-agent-e2e`.

**Risk accepted:** a future refactor could silently regress slash-command construction (S2), plugin-namespace pass-through (S4), error-shape parity (S5), or step ordering (S7) without CI catching it. Mitigation: the addSkill implementation is small (~30 LOC); reviewer is expected to read the diff carefully.

---

## D10 — Unit-test worktree fixture (MOOT — superseded by D9)

Moot.

---

## D11 — `args` parameter type signature

**Decision:** `args?: string` — a single optional string. Matches PRD Implementation Decision and grill-me Q3.

**Rejected:** `Record<string, string>` (object), `unknown` with internal JSON.stringify, variadic `...args: string[]`.

---

## D12 — Re-export strategy

**Decision:** `addSkill` is a method on `AgentBuilder`, not a top-level export. The new `Step` variant is internal. The error classes (`StepError` / `AgentStepError` / `SkillStepError`) ARE re-exported from `src/builder/index.ts` and `src/index.ts` so consumers have a stable import path for `instanceof` checks.

**Rejected:** export top-level `skillStep(name, args?)` factory function (no caller benefit; leaks internal `Step` shape).

---

## D13 — CI command extension

**Decision:** **no CI changes for this slice.** The existing `test` job runs `bun run scenario` (which expands to `turbo run test` running `bun test src` in workspaces — see root `package.json`). The audit-log enrichment in D7 happens inside the harness's existing run path. `lint` (Biome) and `typecheck` (turbo) continue to run as their existing separate jobs.

**Rejected (moot):** two test jobs (`test-scenario` + `test-unit`); compound `&&` command in the existing `test` job.

---

## D14 — RunLog participation

**Decision:** addSkill spawns are recorded in the RunLog via a new `runLog.skillStep(stepIndex, name, userPrompt, response, exitCode, durationMs)` method that mirrors `runLog.agentStep(...)`.

The recording produces:
- `step-NN-skill.user.md` containing the constructed slash-command user prompt.
- `step-NN-skill.response.txt` containing the spawn output.
- An events.jsonl entry of `{ type: "skill", stepIndex, name, exitCode, durationMs, userBytes, responseBytes }`.

Claude usage from the spawn (tokens, cost) is accumulated via `runLog.accumulateUsage(r.usage)` matching agent steps.

**Rejected:** reuse `runLog.agentStep` (loses the skill-specific "name" field that's useful for debugging which skill failed); skip RunLog entirely (loses run summaries and CHANGELOG accuracy).

---

## D15 — Plan-funnel boundary review

Reviewed: no decision above leaks harness-specific identifiers into the production contract.

- `addSkill` carries only `name` and `args`. No `scenario_id`, `run_id`, harness query params.
- The runner accepts `cwd` as a generic sandbox path — same as today.
- The audit-log enrichment lives in `scenarios/lib/`, not in `packages/munchkins-core/`. Production code does not change shape because the harness now captures additional fields.
- The mock seam stays at the existing `mock.module(spawnClaudeAbsPath, ...)` boundary. No new seam.

**Boundary clean.**

---

## Open Questions Deferred to `plan.md`

These are non-blocking for plan creation; they are slice-level mechanical details:

- **Q1.** Where in the harness's `scenarios/index.ts` should the addSkill mini-builder run go? (Recommended: after the bugfix-agent run.)
- **Q2.** Which fixture skill name does the harness use? (Recommended: `noop-fixture` — never resolves; mock catches it before resolution.)
- **Q3.** Whether the canned response file declares a marker file (matching existing fixture pattern). (Recommended: yes; matches the cleanup audit's expectations.)
- **Q4.** Filename sort-order for the new fixture file. (Recommended: `99-noop-skill-fixture.json` so it sorts after all bugfix-agent responses.)
