---
stage: plan
artifact_root: docs/pages/internal/add-skill/
status: draft
upstream:
  - docs/pages/internal/add-skill/prd.md
  - docs/pages/internal/add-skill/scenario-testing-strategy.md
  - docs/pages/internal/add-skill/technology-decisions.md
  - docs/pages/internal/add-skill/diagnosis.md
---

# Plan — addSkill: compose Claude Code skills as munchkins pipeline steps

## Problem Summary

Operators building munchkins agents have three pipeline-step primitives — `add()`, `addDeterministic()`, `finalize()` — plus a `summaryWriter()` phase. None composes Claude Code skills as steps. Skills already live at `~/.claude/skills/<name>/SKILL.md` (global) and `<cwd>/.claude/skills/<name>/SKILL.md` (project-local) and are invoked from any Claude session via `/<name> <args>`.

This plan introduces **`addSkill(skill)`** and a new **`Skill`** primitive that mirrors `Prompt`'s shape: a chainable composable with `.withArgs(text)` and `.withArgsFromOption(name, decl?)`, late-bound via `.resolve(repoRoot)`. `addSkill` hands the resolved slash-command to a fresh headless `claude -p` in the sandbox's `cwd`. Claude Code itself resolves the skill — munchkins reads no SKILL.md files, parses no frontmatter, and validates no skill names. Operator-provided arguments piggy-back on the existing `--<flag>` auto-registration path that `add(prompt)` already uses, so a skill that takes runtime input requires no separate CLI wiring. A bare-string sugar form (`addSkill("noop-fixture")` / `addSkill("review-pr", "123")`) is preserved for the no-binding case. Failure semantics match existing agent steps via a new typed error hierarchy. Side-effects only — no return value exposed to downstream steps in v1. RunLog records each addSkill spawn with per-step files and accumulated usage, matching the existing `runAgent` recording.

## Goal And Non-Goals

**Goal:** ship `addSkill(skill)` and a Prompt-symmetric `Skill` class (in `packages/munchkins-core/src/builder/skill.ts`) as a stable public API on `AgentBuilder` (in `packages/munchkins-core/src/builder/agent-builder.ts`), with happy-path coverage in the existing scenario harness and a documented manual-verification procedure for non-happy-path behaviors. The bare-string call form `addSkill(name, args?)` is supported as sugar over the `Skill` constructor.

**Non-goals (v1):**

- Skill output capture / structured return value
- Structured (object-shaped) arguments — `Skill` arguments are flat strings, optionally bound to CLI options. Multi-key object arguments are deferred.
- Skill discovery / `listSkills()`
- Skill-aware fixers in deterministic loops
- Per-skill-step `--model`, `--max-budget-usd`, `--allowed-tools` overrides
- Build-time skill-name validation
- Distinct banner kind for skill steps (reuses "agent" banner)
- Automated regression coverage for S2–S7
- Hitl integration (separate plan-funnel artifact set)

## Scenario Harness Contract

**Single harness scenario, unchanged top-level CLI:** `bun run scenario` continues to invoke `scenarios/index.ts` and runs `bugfix-agent-e2e`. AGENTS.md hard-rule #3 is preserved.

**Behavior delta:** the harness adds a **second builder run** inside the same scenario, after the existing bugfix-agent run completes:

- The mini-builder is constructed inline in `scenarios/index.ts`: `new AgentBuilder("addskill-coverage", "Harness addSkill coverage", gitWorktreeSandbox()).addSkill("noop-fixture").summaryWriter(defaultSummaryWriter())`.
- The fixture name `noop-fixture` lives only inside `scenarios/index.ts`. Production code (`packages/munchkins/agents/...`) is **not** modified.
- The fixture's `mock-claude-responses/` directory grows by **exactly one** new canned response file. It is named to sort after all bugfix-agent responses (e.g. `99-noop-skill-fixture.json`).
- The harness's expected mock-call count grows by exactly one (plus one for the addSkill mini-builder's summary writer phase, if a summary writer is included — see slice scope below).
- The audit assertion in `scenarios/index.ts` is extended: among the recorded `mockCallLog` entries, **at least one must have `userPrompt === "/noop-fixture"` (exact string equality) AND an empty `systemPrompt`**.

**Audit-log enrichment** (lives entirely in `scenarios/lib/`):
- `MockCallEntry` gains three inline fields: `systemPrompt: string`, `userPrompt: string`, `cwd: string`.
- `spawnClaudeMock` accepts `opts: SpawnClaudeOptions` and records those fields per call.
- `result.ts` JSON schema gains the three new fields per `mockCallLog` entry. Additive — out-of-harness consumers unaffected.

**Cleanup audit extension:** the existing `assertHappyPathCleanup` checks for leaked worktrees, leaked `agent/*` branches, and marker files in main's tree. The mini-builder also creates a worktree, branch, and (via canned response) a marker file. The cleanup audit needs to know how many builder runs produced markers; existing logic walks `getResponseFileNames()` and verifies each marker file is in main — this works automatically because the new fixture file declares its own marker.

**Boundary:** the harness adapts to addSkill (adds a second builder run inside the scenario, enriches its own mock). Production code in `packages/munchkins-core/` and `packages/munchkins/` does not gain any harness-aware identifier, route, or query param. The fixture name `noop-fixture` lives only inside `scenarios/`.

## Resolved Technology Decisions

Carried verbatim from `technology-decisions.md`:

| ID  | Decision                                                                                                                              |
|-----|---------------------------------------------------------------------------------------------------------------------------------------|
| D1  | Method signature: `addSkill(skill: string \| Skill, args?: string): this`. Bare-string form is sugar that constructs a `Skill` internally. |
| D2  | New `Step` variant `kind: "skill"` carrying `{ skill: Skill }`. The `Skill` instance owns the name and the late-bound argument fragments. |
| D3  | Reuse `spawnClaude` directly. `Skill.resolve(repoRoot)` returns `{ userPrompt }`; pass with `systemPrompt = ""`, `cwd = sandbox.cwd`, `stream = true`. |
| D4  | No munchkins-side escaping or validation of resolved arguments. Operator owns the string content.                                     |
| D5  | New typed error hierarchy: `StepError`, `AgentStepError`, `SkillStepError`. Existing `runAgent` failure path retro-fitted to throw `AgentStepError`. addSkill throws `SkillStepError`. |
| D6  | Reuse existing `"agent"` banner kind. No distinct `"skill"` banner.                                                                   |
| D7  | Mock-log enrichment = inline flat fields `{ systemPrompt, userPrompt, cwd }` on `MockCallEntry`.                                      |
| D8  | Moot — no second test runner introduced.                                                                                              |
| D9  | No automated coverage for S2–S7. Code review + manual verification only.                                                              |
| D10 | Moot — no unit tests.                                                                                                                 |
| D11 | `Skill` mirrors `Prompt`'s shape: chainable `.withArgs(text)` and `.withArgsFromOption(optionName, declaration?)`; `resolve(repoRoot)` returns `{ userPrompt }`. Multiple fragments concatenate space-separated to form the final args string. CLI-option-bound fragments auto-register on `AgentBuilder` via the same path `add(prompt)` already uses. |
| D12 | `addSkill` is a method on `AgentBuilder`. `Skill` class plus error classes re-exported from `src/builder/index.ts` and `src/index.ts`. |
| D13 | No CI command changes.                                                                                                                |
| D14 | RunLog participation via new `runLog.skillStep(stepIndex, name, userPrompt, response, exitCode, durationMs)` method.                  |
| D15 | Boundary clean — no harness leakage into production contract.                                                                         |
| D16 | Option auto-registration is shared between `add(prompt)` and `addSkill(skill)`. Extract the loop in `add()` into a private helper `autoDeclareOptions(fragments)` and call it from both sites. |

## Vertical Slices

Two slices. Slice 1 ships the addSkill primitive AND its harness verification together as one vertical unit. Slice 2 is the manual live verification recorded in the PR description.

---

### Slice 1 — `addSkill` primitive + typed errors + RunLog participation + harness coverage

This slice ships everything needed to verify S1 in CI on merge.

**Scope (production code in `packages/munchkins-core/src/`):**

1. **New file `builder/skill.ts`** — mirrors `builder/prompt.ts`:
   ```ts
   import { existsSync, readFileSync } from "node:fs";
   import { isAbsolute, join } from "node:path";
   import { type Fragment, OPTION_ENV_PREFIX, type OptionDeclaration } from "./prompt.js";

   export class Skill {
     readonly name: string;
     private _fragments: Fragment[] = [];

     constructor(name: string) { this.name = name; }

     withArgs(text: string): this {
       this._fragments.push({ kind: "text", text });
       return this;
     }
     withArgsFromOption(optionName: string, declaration?: OptionDeclaration): this {
       this._fragments.push({ kind: "input-from-option", optionName, declaration });
       return this;
     }
     get fragments(): readonly Fragment[] { return this._fragments; }

     resolve(repoRoot: string): { userPrompt: string } {
       const abs = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));
       const args = this._fragments
         .map((f) => {
           if (f.kind === "text") return f.text;
           const value = process.env[`${OPTION_ENV_PREFIX}${f.optionName}`];
           if (!value) {
             throw new Error(
               `Skill: option "${f.optionName}" not provided (env var ${OPTION_ENV_PREFIX}${f.optionName} not set)`,
             );
           }
           const candidate = abs(value);
           if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
           return value;
         })
         .join(" ")
         .trim();
       return { userPrompt: args ? `/${this.name} ${args}` : `/${this.name}` };
     }
   }
   ```
   Note: `Fragment`, `OptionDeclaration`, and `OPTION_ENV_PREFIX` are reused from `prompt.ts` — `Skill` does NOT redeclare them. This is the symmetry: a `Skill` is a `Prompt` minus system prompts plus a slash-command-prefix.

2. In `builder/agent-builder.ts`:
   - Add the typed error classes at module scope:
     ```ts
     export class StepError extends Error {
       constructor(public exitCode: number, message: string) { super(message) }
     }
     export class AgentStepError extends StepError {
       constructor(exitCode: number) { super(exitCode, `agent step failed (exit ${exitCode})`) }
     }
     export class SkillStepError extends StepError {
       constructor(public skillName: string, exitCode: number) {
         super(exitCode, `skill step "${skillName}" failed (exit ${exitCode})`)
       }
     }
     ```
   - Add `SkillStep` type variant: `{ kind: "skill"; skill: Skill }`.
   - Extend the `Step` union: `Step = AgentStep | DeterministicStep | SkillStep | FinalizeStep`.
   - Extract the option auto-registration loop from `add(prompt)` into a private helper:
     ```ts
     private autoDeclareOptions(fragments: readonly Fragment[]): void {
       for (const f of fragments) {
         if (f.kind !== "input-from-option" || !f.declaration) continue;
         if (this.options.has(f.optionName)) continue;
         this.options.set(f.optionName, {
           type: "string",
           required: f.declaration.required ?? false,
           description: f.declaration.description,
           default: f.declaration.default,
         });
       }
     }
     ```
     Update `add(prompt)` to call `this.autoDeclareOptions(prompt.fragments)`.
   - Add the `addSkill(skill: string | Skill, args?: string): this` method (peer of `add` / `addDeterministic`):
     ```ts
     addSkill(skill: string | Skill, args?: string): this {
       const skillObj = typeof skill === "string"
         ? (args !== undefined ? new Skill(skill).withArgs(args) : new Skill(skill))
         : skill;
       this.steps.push({ kind: "skill", skill: skillObj });
       this.autoDeclareOptions(skillObj.fragments);
       return this;
     }
     ```
   - Add a `runSkill(step, cwd, repoRoot, runLog, stepIndex)` private method:
     ```ts
     private async runSkill(
       step: SkillStep, cwd: string, repoRoot: string, runLog: RunLog, stepIndex: number,
     ): Promise<void> {
       const { userPrompt } = step.skill.resolve(repoRoot)
       printInvocation("", userPrompt)
       const startTime = Date.now()
       const r = await spawnClaude({ systemPrompt: "", userPrompt, cwd, stream: true })
       const durationMs = Date.now() - startTime
       runLog.accumulateUsage(r.usage)
       runLog.skillStep(stepIndex, step.skill.name, userPrompt, r.output, r.exitCode, durationMs)
       if (r.exitCode !== 0) throw new SkillStepError(step.skill.name, r.exitCode)
     }
     ```
   - Extend the runner's switch in `run()`:
     ```ts
     } else if (step.kind === "skill") {
       banner("agent", `Step ${i + 1}/${this.steps.length} — agent`)
       await this.runSkill(step, cwd, repoRoot, runLog, i)
     }
     ```
   - Retro-fit `runAgent`'s failure path: replace `throw new Error(\`agent step failed (exit ${r.exitCode})\`)` with `throw new AgentStepError(r.exitCode)`. The message string is preserved verbatim.
   - Extend the `describe()` dry-run path with a `kind: "skill"` branch that prints the constructed slash-command user prompt (use `step.skill.resolve(repoRoot)` so option-bound fragments are reflected in the dry-run preview).

3. In `run-log.ts`:
   - Add `skillStep(stepIndex: number, name: string, userPrompt: string, response: string, exitCode: number, durationMs: number)` method. Writes `step-NN-skill.user.md` and `step-NN-skill.response.txt`. Records an events.jsonl entry of `{ type: "skill", stepIndex, name, exitCode, durationMs, userBytes, responseBytes }`. Increments `claudeCallCount`.

4. In `builder/index.ts`:
   - Export `Skill` (from `./skill.js`).
   - Export `StepError`, `AgentStepError`, `SkillStepError`.

5. In `index.ts` (the package's top-level barrel):
   - Re-export `Skill` and the three error classes.

6. **No changes** to `packages/munchkins/agents/...`, the Prompt API, `spawn-claude.ts`, sandbox code, registry, CLI, or any default agent. The production bugfix-agent and refactor-agent are deliberately untouched to keep the harness boundary clean.

**Scope (harness code in `scenarios/`):**

6. In `scenarios/lib/mock-spawn-claude.ts`:
   - Extend the `MockCallEntry` interface with three inline fields: `systemPrompt: string`, `userPrompt: string`, `cwd: string`.
   - Update `spawnClaudeMock` to accept `opts: SpawnClaudeOptions` and record those three fields onto each `callLog` entry.

7. In `scenarios/lib/result.ts`:
   - JSON schema's `mockCallLog` entry type gains the three fields.

8. In `scenarios/index.ts`:
   - After the existing `agentResult.succeeded` check, add a second builder run that exercises **both** call forms — bare-string sugar AND the explicit `Skill` object — so D1 and D11 are both covered by the scenario:
     ```ts
     const { AgentBuilder, gitWorktreeSandbox, Skill } = await import("@serranolabs.io/munchkins-core")
     // Bare-string form (D1 sugar):
     const skillBuilder = new AgentBuilder("addskill-coverage", "Harness addSkill coverage", gitWorktreeSandbox())
       .addSkill("noop-fixture")
     const skillResult = await skillBuilder.run()
     if (!skillResult.succeeded) {
       return { /* fail with phase: "execution" */ }
     }
     // Skill-object form with literal args (D11 — proves resolve() shapes the prompt correctly):
     const skillObjBuilder = new AgentBuilder("addskill-coverage-obj", "Harness addSkill object form", gitWorktreeSandbox())
       .addSkill(new Skill("noop-fixture").withArgs("hello"))
     const skillObjResult = await skillObjBuilder.run()
     if (!skillObjResult.succeeded) {
       return { /* fail with phase: "execution" */ }
     }
     ```
   - Extend the audit assertions: walk `mockCallLog`, find one entry whose `userPrompt === "/noop-fixture"` and `systemPrompt === ""` (bare-string form), AND one whose `userPrompt === "/noop-fixture hello"` and `systemPrompt === ""` (Skill-object form). Fail the scenario otherwise.
   - The fixture `mock-claude-responses/` directory grows by **two** files (one per builder run). Naming: `99-noop-skill-fixture.json` and `9a-noop-skill-fixture-args.json` — both sort after bugfix-agent responses; the second sorts after the first.
   - Option-bound args are exercised in Slice 2 (manual), not the harness — the scenario harness has no CLI invocation surface to set the env var, so option-binding is verified by manual run instead of by mock.
   - The cleanup audit (`assertHappyPathCleanup`) automatically extends because it walks `getResponseFileNames()` to verify markers — adding the new response file picks up its marker check.

9. In `scenarios/fixtures/bugfix-agent-e2e/mock-claude-responses/`:
   - Add `99-noop-skill-fixture.json`. Content matches the existing fixture format (consult an existing fixture file for exact schema): `exitCode: 0`, `output` text, `durationMs`, optional `usage`, and a `markerFile` declaration that the mock consumes to write `__mock_<n>_99-noop-skill-fixture.txt` to the worktree.

**Boundary check:** the harness uses `noop-fixture` only inside `scenarios/index.ts`. Production code does not reference any harness-only identifier. ✓

**PRD scenarios delivered:** S1 (fully — both via the primitive being callable AND via harness verification of the slash-command shape). S5/S6/S7 indirectly exercised: S5 by typed-error retro-fit being type-checked; S6 by absence of validation code; S7 by runner switch treating `kind: "skill"` as a peer.

**Acceptance criteria:**
- `bun run typecheck` passes (no new TS errors in either package).
- `bun run lint` passes (Biome).
- `bun run scenario` exits 0 with `result: "pass"`. The result includes the addSkill mini-pipeline's spawn call in `mockCallLog`. The new audit assertion finds the `/noop-fixture` user prompt with an empty system prompt. Zero real-claude attempts logged. Cleanup audit shows no leaked worktrees, no leaked agent branches, marker files for both bugfix-agent and addSkill mini-pipeline present in main.

**Out-of-harness manual verification for this slice:** none — Slice 2 covers manual.

---

### Slice 2 — Manual live verification + PR record

**Scope:** operator-driven, recorded in the PR description per AGENTS.md convention. This is not a code-producing slice; it is the gating verification that ships with the PR.

**Procedure** (mirrors `scenario-testing-strategy.md` Manual Verification Subsections):

1. Author a project-local skill at `<repo-root>/.claude/skills/manual-test-noop/SKILL.md` whose body says: "Reply with the exact string `MANUAL_TEST_NOOP_OK` and do nothing else, then echo any args you received."

2. Build an ad-hoc agent registered into the registry (script under `examples/manual-addskill-test.ts` or a temporary registration file). Cover **all three** call surfaces — bare-string, `Skill`-object with literal args, `Skill`-object with option-bound args — so D1 + D11 + D16 are all live-verified:
   ```ts
   import { AgentBuilder, gitWorktreeSandbox, registry, Skill } from "@serranolabs.io/munchkins-core"
   const builder = new AgentBuilder("manual-addskill-test", "Manual addSkill verification", gitWorktreeSandbox())
     // bare-string form
     .addSkill("manual-test-noop")
     // Skill-object with literal args
     .addSkill(new Skill("manual-test-noop").withArgs("literal-args-hello"))
     // Skill-object with CLI-option-bound args (auto-registers --pr on the agent)
     .addSkill(new Skill("manual-test-noop").withArgsFromOption("pr", { required: true, description: "PR number" }))
   registry.register(builder)
   ```
   Run via `bun run packages/munchkins/src/index.ts manual-addskill-test --pr 123`. Confirm `--pr` appears in the help text — that proves option auto-registration via `addSkill` is working.

3. Confirm:
   - Banner sequence renders.
   - Streamed output contains `MANUAL_TEST_NOOP_OK`.
   - Summary writer phase runs (only if a summaryWriter was attached; optional in this manual test).
   - "PASS" banner; sandbox `teardown("pass", ...)` squash-merges to main.
   - `.munchkins/runs/manual-addskill-test-<ts>-<uuid>/` directory exists with `step-01-skill.user.md`, `step-01-skill.response.txt`, `events.jsonl`, `summary.json`.
   - `CHANGELOG.md` gets an auto-generated entry (only if summaryWriter was attached).

4. Repeat with extra checks (covers S2/S3/S4/S5 manually):
   - **S2 multi-word args:** `addSkill("manual-test-noop", "first arg with spaces and a 'quoted phrase'")`. Update the noop skill body to echo the args back, verify args arrive intact.
   - **S2-symmetry option-bound args:** verify the third call form above resolves at run-time — the resolved user prompt for that step should be `/manual-test-noop 123` (the value of `--pr`), and missing the flag should fail loudly with a clear "option not provided" error. This is the new symmetry-relevant check.
   - **S3 project-local resolution:** confirm step 1's skill resolved without falling through to a global skill.
   - **S4 plugin-namespaced (skip if no plugin available):** `addSkill("plugin-name:skill-name")`.
   - **S5 failure path:** author a deliberately-failing skill body that causes `claude -p` to exit non-zero; confirm `SkillStepError` thrown, sandbox preserved at the printed path.

5. Record outcomes in the PR description in a fenced block:
   ````
   ### Manual addSkill verification
   - S1-live: PASS — output included `MANUAL_TEST_NOOP_OK`, exit 0
   - Bare-string form: PASS — `/manual-test-noop` resolved
   - Skill-object literal args: PASS — `/manual-test-noop literal-args-hello` resolved
   - Skill-object option-bound args: PASS — `--pr 123` auto-registered, resolved to `/manual-test-noop 123`
   - Missing required option: PASS — clear "option not provided" error
   - S2 multi-arg: PASS — args echoed verbatim
   - S3 project-local: PASS — resolved without global fallback
   - S4 plugin-namespaced: SKIPPED — no plugin available
   - S5 failure: PASS — SkillStepError thrown, worktree preserved at /tmp/...
   ````

**Acceptance criteria for this slice:**
- The PR description contains the manual-verification block.
- All performed checks pass; any skipped check is justified.
- No code changes (this slice is procedural).

## Slice Order And Dependencies

```
Slice 1 (primitive + errors + RunLog + harness coverage)  ──>  Slice 2 (manual verification + PR record)
```

- **Slice 1 must land before Slice 2.** Slice 2 is a manual gating action against merged code.
- **No parallelism** within this plan.

## Parallelizable Work

None within this plan. addSkill is small enough that splitting Slice 1 between agents would create more coordination cost than time saved.

Within Slice 1, the production-code work splits into two disjoint pieces that could ship in independent commits before the harness work:

1. `builder/skill.ts` is a brand-new file. Its only dependency is `prompt.ts`'s `Fragment`, `OptionDeclaration`, and `OPTION_ENV_PREFIX` exports — already present.
2. The `agent-builder.ts` + `run-log.ts` changes (typed errors, `addSkill` method, `autoDeclareOptions` extraction, runner switch, `runLog.skillStep`) depend on `skill.ts` existing.

The harness work (`scenarios/`) depends on both production pieces. Even a parallel split has to land in commit order: `skill.ts` → `agent-builder.ts`/`run-log.ts` → `scenarios/`.

**Adjacent parallelism (out of scope for this plan):** the companion plan-funnel artifact set for the `hitl` feature at `docs/pages/internal/hitl/` is independent of addSkill and can be executed in parallel by a separate agent.

## Risks And Failure Modes

1. **Headless skill execution regresses in a future Claude Code release.** addSkill depends on `claude -p "/<name> <args>"` resolving and invoking the skill. If a future Claude Code version changes how `-p` parses slash-prefixed input, the harness-mocked S1 will still pass (the mock doesn't care) but live execution will silently break. **Mitigation:** the manual verification in Slice 2 catches this each time addSkill ships in a new release. If the regression surfaces, escalate to either (a) re-running the empirical tests recorded in `diagnosis.md` to confirm the new behavior, or (b) revisiting the diagnosis's Option A fallback.

2. **Audit assertion accidentally matches a non-addSkill spawn call.** The fix in Slice 1 uses **exact string equality** (`userPrompt === "/noop-fixture"`) plus empty `systemPrompt`, not a regex. This avoids accidental matches against unrelated user prompts. The exact-match approach is brittle in a different direction: if the slice-1 implementation produces `/noop-fixture` with a trailing newline or different casing, the assertion fails. Tightness is intentional — the failure points unambiguously at the implementation.

3. **`SkillStepError` retro-fit could break downstream consumers.** Operators who already catch errors by message-string from `add()` steps continue to work because `AgentStepError extends Error` preserves the message verbatim. Operators who want structured branching can use `instanceof`. The error classes are re-exported from `src/builder/index.ts` and `src/index.ts`.

4. **Skill-args injection is a non-risk.** `Bun.spawn` receives args as an array; no shell expansion. Operator-supplied `args` content is delivered to the `claude -p` argument verbatim. No process-level injection vector.

5. **Banner text confusion.** A reader of pipeline output sees "Step N/M — agent" for an addSkill step. Documented in PRD Out Of Scope. Defer a distinct `"skill"` banner kind to a follow-up.

6. **Forgetting the manual-verification block on the PR.** The completion gate depends on Slice 2 being executed and recorded. **Mitigation:** the reviewer is instructed to require the `### Manual addSkill verification` heading in the PR description before approving.

7. **Second-builder run inside the scenario shares mock state with the bugfix-agent run.** This is intentional — the mock-call log accumulates across both runs. The fixture's expected mock-call count grows by exactly one. If a future change to the bugfix-agent fixture inadvertently shifts spawn-call indices, the addSkill mini-pipeline's canned response could be consumed by the wrong call. **Mitigation:** the canned response file is named `99-noop-skill-fixture.json` so it sorts after all bugfix-agent responses (which use lower numeric prefixes).

8. **RunLog summary changes.** Adding `skillStep` recording means `RunSummary` may show `agentSteps` separately from skill calls. Existing consumers of `summary.json` should be re-read; if any external tooling counts `totalClaudeCalls`, that count now includes skill calls (which is correct — they ARE Claude calls). Document this in the slice's commit message.

9. **Skill ↔ Prompt symmetry drift.** `Skill` reuses `Fragment`, `OptionDeclaration`, and `OPTION_ENV_PREFIX` from `prompt.ts`. If a future refactor changes the fragment shape or option-binding semantics in `Prompt`, `Skill` must move with it — the two are intentionally coupled. **Mitigation:** the symmetry is enforced by reusing `prompt.ts`'s exports verbatim, not by duplicating the types. Any future divergence (e.g. typed-fragment kinds for tool calls or structured args) should be considered for both classes simultaneously, or fork them deliberately with a recorded technology decision.

10. **Argument fragment join semantics.** `Skill.resolve()` joins multiple fragments with a single space. Operators chaining `.withArgs("a").withArgs("b")` get `/foo a b`. If a fragment's resolved value contains spaces, those spaces are preserved verbatim (e.g. `withArgs("hello world")` → `/foo hello world`). This matches how operators write slash commands by hand and matches how `Prompt` joins user-message fragments (with `\n\n`). Document this in the public surface jsdoc.

## Execution Notes

- **Slice 1 commit messages** (recommend three commits inside the same PR — easier review than a single mega-commit):
  - `feat(core): add Skill builder primitive — Prompt-symmetric, slash-command-shaped` — `builder/skill.ts` only.
  - `feat(core): add addSkill + typed error hierarchy + RunLog skillStep` — `agent-builder.ts`, `run-log.ts`, barrel re-exports.
  - `feat(scenarios): extend bugfix-agent-e2e with addSkill mini-pipeline (bare-string + Skill-object) — satisfies S1` — harness only.

- **Slice 2 is not a commit** — it is a PR-description block.

- **Bun-only.** Per AGENTS.md hard-rule #1.

- **No relative cross-package imports.** Per CLAUDE.md, the harness consumes `@serranolabs.io/munchkins-core` via the package name, not by relative path.

- **No new prompt files.** The addSkill primitive's behavior is a slash-command construction, not a system-prompt-loaded subagent.

- **No new CLI subcommand.** Per D12, `addSkill` is a method on `AgentBuilder`. Operators expose skills via their own agents registered into the registry.

- **Re-export checklist:**
  - In `packages/munchkins-core/src/builder/index.ts`: add `Skill`, `StepError`, `AgentStepError`, `SkillStepError`.
  - In `packages/munchkins-core/src/index.ts`: re-export the same.
  - Do NOT add `addSkill` (it's a method); do NOT add `SkillStep` (internal type); do NOT add `runSkill` (private); do NOT re-export `Fragment`/`OptionDeclaration`/`OPTION_ENV_PREFIX` from `skill.ts` (they live in `prompt.ts` and are already exported from there).

- **No effort sizing in this plan** per CLAUDE.md "no effort estimates" rule.
