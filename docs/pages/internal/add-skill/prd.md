---
stage: prd
artifact_root: docs/pages/internal/add-skill/
status: draft
upstream:
  - docs/pages/internal/add-skill/diagnosis.md
---

# PRD — addSkill: compose Claude Code skills as munchkins pipeline steps

## Problem Statement

Operators building munchkins agents today have three pipeline-step primitives: an "agent" step (a `Prompt` resolved to a system prompt + user prompt and fed to `spawnClaude`), a "deterministic" step (a list of shell commands optionally wrapped in an auto-repair loop), and a "finalize" step (commands + onPass/onFail). Plus a `summaryWriter(prompt)` phase that runs after main steps to emit a commit message + CHANGELOG markdown. None of these compose Claude Code skills as pipeline steps.

Skills are reusable, named instruction packs that already live in two well-known registries (`~/.claude/skills/<name>/SKILL.md` for global; `<cwd>/.claude/skills/<name>/SKILL.md` for project-local) and are invoked from any Claude Code session via the slash-command syntax `/<name> <args>`. Operators currently cannot reach them from a munchkins pipeline without re-implementing each skill body as an inline `Prompt` file under their agent's `prompts/` directory, which both duplicates content and drifts from the upstream skill on every update.

**Current implementation status: missing.** No skill-aware step kind exists in `AgentBuilder` (file: `packages/munchkins-core/src/builder/agent-builder.ts`). The default agents (`packages/munchkins/agents/bugfix/bugfix-agent.ts`, `packages/munchkins/agents/refactor/refactor-agent.ts`) compose only `Prompt`-driven agent steps and shell-driven deterministic steps. There is no `addSkill` method, no `kind: "skill"` step variant, and no spawn variant that hands a slash command to Claude.

## Solution

A new pipeline-step primitive — `addSkill(name, args?)` — that adds a step which spawns a headless `claude -p` invocation with a user prompt of exactly `/<name> <args>` (or `/<name>` when no args), in the sandbox's `cwd`. Claude Code itself resolves the skill from its global, project-local, or plugin-namespaced registry — munchkins reads no SKILL.md files, parses no frontmatter, and maintains no skill-name validator.

Failure semantics match existing agent steps: a non-zero exit from the spawned `claude` process throws and aborts the pipeline; finalize-on-fail still runs; the sandbox's `teardown(fail, ctx)` preserves the worktree for inspection. Side-effects only — the step does not expose stdout or any structured return value to downstream steps.

The primitive composes with the existing builder chain: `addSkill` calls can be interleaved freely between `add()` (agent prompt), `addDeterministic()` (shell commands, optionally auto-repaired), and `finalize()` calls. addSkill steps participate in the RunLog (per-step prompt/response files, accumulated Claude usage) and in the summary-writer phase (their effects on the worktree are captured in the diff that the summary writer reads).

This solution honors AGENTS.md hard-rule #4 (no harness identifiers in production surfaces): the addSkill primitive carries only `name` and `args` — no `scenario_id`, `run_id`, no harness query params.

## User Scenarios

Each scenario describes one observable behavior. Each maps 1:1 to an E2E scenario authored in Stage 4.

---

### S1 — Operator composes an existing global skill into a pipeline

**Pre-state:** A munchkins agent (e.g. a custom feature-builder under `packages/munchkins/agents/feature/`) is being constructed via `AgentBuilder`. The skill `dry-refactor` exists at `~/.claude/skills/dry-refactor/SKILL.md` (global registry). The operator wants to run `dry-refactor` as the second step of their pipeline, after an initial implementation step.

**Action:** The operator writes:

```ts
const builder = new AgentBuilder("feature", "Build a feature from a spec.", gitWorktreeSandbox())
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, "feature.md"))
      .withUserMessageFromOption("userMessage", { required: true, description: "Feature spec path" })
  )
  .addSkill("dry-refactor")
  .addDeterministic([...DEFAULT_CHECKS], { loop: { maxIterations: 3, fixer: defaultFixer() } })
  .summaryWriter(defaultSummaryWriter())
registry.register(builder)
```

**Expected:** Step 2 runs as a banner-headed agent invocation. The streamed output comes from the live `dry-refactor` skill executing inside a fresh `claude -p` session in the sandbox cwd. The skill performs its work (refactoring files in the worktree). The step exits 0. The pipeline continues. No SKILL.md is read by munchkins; no system-prompt argument is passed to the spawned `claude`. The composed pipeline reaches the summary writer; the diff captures the skill's effects.

**Current status:** missing.

---

### S2 — Operator passes a free-form string argument to a skill

**Pre-state:** Same as S1. The operator wants to scope the skill's work, e.g. tell `dry-refactor` to focus only on the builder directory.

**Action:** The operator writes `addSkill("dry-refactor", "focus on packages/munchkins-core/src/builder/ only — do not touch CLI surfaces or scenarios harness")`.

**Expected:** The spawned `claude` receives exactly `/dry-refactor focus on packages/munchkins-core/src/builder/ only — do not touch CLI surfaces or scenarios harness` as its user prompt (`-p` argument). The skill executes with that scoping. munchkins applies no quoting transformation, no JSON wrapping, no escaping beyond what is required for `Bun.spawn` to accept the string verbatim. Step exits 0.

**Current status:** missing.

---

### S3 — Operator uses a project-local skill

**Pre-state:** A repo using `@serranolabs.io/munchkins` has its own project-local skill at `<repo-root>/.claude/skills/repo-style-check/SKILL.md`. The agent's sandbox is a git worktree branched off the same repo root, so the sandbox cwd inherits the same `.claude/skills/` tree (the worktree is a checkout, so the directory's contents are present).

**Action:** The operator writes `addSkill("repo-style-check", "tighten naming in the touched files")`.

**Expected:** The spawned `claude -p` resolves `repo-style-check` from the project-local registry (which Claude Code searches first, before falling back to global). The project-local skill executes. Step exits 0. No special munchkins API is needed for the project-local case — it is identical to S1 from the operator's perspective.

**Current status:** missing.

---

### S4 — Operator uses a plugin-namespaced skill

**Pre-state:** A plugin is installed that exposes `claude-code-guide:something`. That namespaced skill is reachable via the slash command `/claude-code-guide:something` from an interactive Claude Code session.

**Action:** The operator writes `addSkill("claude-code-guide:something", "audit the worktree's plugin config")`.

**Expected:** The spawned `claude -p` receives `/claude-code-guide:something audit the worktree's plugin config` and Claude Code resolves the plugin-namespaced skill itself. munchkins passes the colon-bearing name through unchanged — no parsing, no splitting on `:`. Step exits 0.

**Current status:** missing.

---

### S5 — Skill execution fails (non-zero exit) → pipeline aborts and preserves worktree

**Pre-state:** A pipeline contains an agent step, an `addSkill("some-skill")` step, then a finalize step with onFail commands. The skill, when run, encounters an error that causes the spawned `claude` process to exit non-zero (e.g. an internal model error, a hard tool failure the skill cannot recover from, an explicit failure exit).

**Action:** The operator runs the pipeline.

**Expected:** Step 2 throws with a `SkillStepError` carrying the skill name and exit code. The pipeline records `failureReason`. Finalize-on-fail commands run. The sandbox `teardown("fail", { failureReason })` runs, which preserves the worktree (does NOT squash-merge to main, does NOT delete the agent branch). Process exits 1. The operator can inspect the worktree to debug.

**Current status:** missing.

---

### S6 — Operator names a non-existent skill → runtime no-op with documented contract

**Pre-state:** A pipeline contains `addSkill("this-skill-does-not-exist", "...")`. No skill by that name exists in any registry resolvable from the sandbox cwd.

**Action:** The operator runs the pipeline.

**Expected:** Pipeline construction succeeds (skill names are not validated at build time — see Implementation Decisions). At runtime, the spawned `claude -p "/this-skill-does-not-exist ..."` does not fail outright — Claude Code accepts unknown slash-prefixed strings as text input. The model receives the literal string, has no skill to dispatch to, and replies inline. The step exits 0 (no error from `claude`'s perspective), but the operator observes that no skill ran. **There is no munchkins-side guarantee of "skill exists" enforcement in v1.** This is documented behavior, not a defect.

**Current status:** missing (the entire feature is missing). When implemented, this scenario must surface a clear note in the README: "addSkill does not validate skill names; an unrecognized name is delivered to the model as text."

---

### S7 — addSkill steps interleave freely with `add()` and `addDeterministic()`

**Pre-state:** A pipeline mixes step kinds:

```ts
new AgentBuilder("complex", "...", gitWorktreeSandbox())
  .add(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "initial.md")).withUserMessageFromOption("spec", {...}))
  .addSkill("diagnose", "diagnose feasibility of the spec")
  .add(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "implement.md")).withUserMessage("…"))
  .addDeterministic([...DEFAULT_CHECKS], { loop: { maxIterations: 3, fixer: defaultFixer() } })
  .addSkill("dry-refactor")
  .summaryWriter(defaultSummaryWriter())
```

**Action:** Operator runs the pipeline.

**Expected:** Steps execute in declared order with their existing banner/streaming styles. The skill steps and agent steps are visually distinguishable only by the slash-command in the printed user prompt (the banner kind is "agent" for both today; this is acceptable for v1 — see Out Of Scope). Auto-repair loops on the deterministic step continue to use `Prompt`-based fixers, not skill fixers (out of scope for v1). The pipeline reaches summary writer + sandbox teardown. The worktree is squash-merged to main on pass; preserved on fail.

**Current status:** missing.

---

## Implementation Decisions

These decisions are inherited from the diagnosis and the grill-me empirical findings. They are stated here as constraints the plan stage must respect; file paths and code snippets are deliberately kept to type signatures (the plan covers the bodies).

1. **A new step kind `kind: "skill"` is introduced in `AgentBuilder`.** It is a peer of the existing `agent`, `deterministic`, and `finalize` step variants. Internally it carries `{ kind: "skill"; name: string; args?: string }`.
2. **A new builder method `addSkill(name, args?)` appends the step.** Returns `this` so it chains identically to `add()`, `addDeterministic()`, `finalize()`, and `summaryWriter()`.
3. **Execution reuses `spawnClaude` directly.** The skill step constructs a user prompt of `/<name>` (or `/<name> <args>` if args is provided), passes empty string as `systemPrompt`, and invokes `spawnClaude` with the sandbox's `cwd`. No new spawn helper is added.
4. **No SKILL.md reading. No resolver. No frontmatter parsing.** Skill resolution is delegated entirely to Claude Code, which already searches global and project-local registries and handles plugin namespaces.
5. **Typed error class:** addSkill's runner branch throws `SkillStepError` (extends a shared `StepError` base). The existing `runAgent` failure path is retro-fitted to throw `AgentStepError` (also extends `StepError`). Existing string-matching consumers continue to work because the error message text is preserved verbatim.
6. **Side-effects only.** No return value, no stdout capture, no structured output exposed to downstream steps in v1.
7. **Plugin-namespaced names are passed through untouched.** No parsing on `:`.
8. **No build-time validation of skill names.** Names are validated at execution time, by Claude Code, when the slash command is dispatched.
9. **Re-export the error classes** (`StepError`, `AgentStepError`, `SkillStepError`) from `packages/munchkins-core/src/builder/index.ts`. `addSkill` itself is reachable as a method on `AgentBuilder`; no top-level export needed.
10. **RunLog participation.** Each `addSkill` step records its system prompt (empty string), user prompt (`/<name>...`), the spawn output, exit code, and duration via a new `runLog.skillStep(...)` method (parallel to the existing `runLog.agentStep(...)`). Claude usage from the spawn (tokens, cost) accumulates into the run summary just like agent steps.
11. **Dry-run support.** `AgentBuilder.describe()` already prints resolved agent and deterministic steps for `--dry-run`. addSkill must add a corresponding branch that prints the constructed slash-command user prompt.

## Testing Decisions

**Coverage split (revised post-grill-me D9):** the happy path (S1) is the only addSkill behavior covered by automation. S2–S7 are not covered by automated tests; they are verified by code review at PR time and by an operator's manual ad-hoc check during the live S1 verification. AGENTS.md hard-rule #3 (harness owns exactly one scenario) is preserved.

1. **Scenario-harness coverage (S1 only).** The existing `scenarios/index.ts` is extended to add a **second mini-builder run** after the existing bugfix-agent run, exercising `addSkill(...)`. The mini-builder uses `gitWorktreeSandbox()` (so squash-merge cleanup behavior is exercised) and a single `addSkill("noop-fixture")` step. The harness's mocked `spawnClaude` returns a canned response that includes a marker file write (matching the existing harness pattern where mock responses cause marker files to land in main's tree via squash-merge). The harness's `assertHappyPathCleanup` is updated to also expect the addSkill mini-builder's marker. The new audit assertions verify that one of the spawned `claude` calls had a `userPrompt` matching exactly `/noop-fixture` and an empty `systemPrompt`.

2. **No automated coverage for S2–S7.** Per technology-decisions.md D9. Justification: the implementation surface is small (~30 LOC across one method, one `Step` variant, one runner branch); a careful PR review can verify args pass-through (S2), cwd correctness (S3), plugin-namespace pass-through (S4), error-class hierarchy (S5), no-validation contract (S6), and step ordering (S7). The risk of silent regression is accepted; if a regression surfaces in practice, automated coverage is reintroduced at that point.

3. **Manual live verification.** Operator-driven, recorded in the PR description per AGENTS.md convention. Steps: build a small ad-hoc pipeline that uses `addSkill("dry-refactor", "<scoped focus>")` against a real worktree, run it, confirm the skill performs visible work in the worktree (file edits), confirm pipeline completion + summary writer runs + sandbox teardown squash-merges to main on pass. AGENTS.md hard-rule #6 forbids real-claude from inside the harness, so this stays operator-driven. During this same session, the operator should also exercise:
   - a multi-line `args` string (covers S2 manually),
   - a project-local skill in `<repo>/.claude/skills/` (covers S3 manually),
   - a plugin-namespaced skill if available (covers S4 manually),
   - a deliberately-failing skill input that causes the spawned `claude` to exit non-zero (covers S5 manually).
   Pass/fail of each manual check is recorded in the PR description.

4. **No fixture skill files.** The harness's mock seam catches all `spawnClaude` calls before they reach Claude Code, so the fixture's referenced skill name (e.g. `noop-fixture`) does not need a real `SKILL.md` on disk. Manual verification uses real skills the operator chooses.

## Out Of Scope

- **Skill output capture / structured return value.** A skill that produces analysis text on stdout cannot feed a downstream step's input directly. Deferred to a future feature that introduces a return-channel for any agent step (not just skills).
- **Structured arguments.** No object-shaped arguments. Operators serialize as needed and pass a single string.
- **Skill discovery / `listSkills()`.** Operators name skills explicitly. No registry-introspection API in v1.
- **Skill-aware fixers in deterministic loops.** The `loop.fixer` field continues to accept `Prompt` only. A `SkillFixer` is a follow-up feature.
- **Per-skill-step overrides for `--model`, `--max-budget-usd`, `--allowed-tools`.** addSkill inherits whatever `spawnClaude` provides today (which is no overrides). A future enhancement may surface options uniformly across all step kinds.
- **Build-time skill-name validation.** No registry probe at builder-construction time.
- **Distinct banner kind for skill steps.** Today the banner reads "agent" for both `add()` and `addSkill()` invocations because they share the spawn path. A dedicated `skill` banner color/label is a small follow-up if desired.
- **Project-local-only filtering.** No `addSkill(name, { onlyLocal: true })` flag.
- **Hitl integration.** addSkill does not pause for human input. The companion feature `hitl` (separate plan-funnel artifact set at `docs/pages/internal/hitl/`) is the place for that.

## Further Notes

- **Empirical evidence backing the design.** Two tests were performed during grill-me to verify the headless skill-execution and project-local-resolution assumptions. Both tests succeeded. Concrete commands and outputs are recorded in `diagnosis.md`. The design explicitly relies on Claude Code's runtime behavior — if a future Claude Code release changes how `-p` resolves slash-prefixed input, addSkill must be revisited (mitigation: the manual S1-live verification catches this each time addSkill ships in a new release).
- **No new dependency on Claude Code internals beyond what `spawnClaude` already requires.** addSkill does not introspect the skill registry, does not read `~/.claude/`, and does not depend on any internal Claude Code file format.
- **Non-interactive skills only.** A skill that requires interactive input (none observed today) would deadlock under `-p`. Operators must not compose such skills via addSkill. Document this in the README.
- **Failure-mode parity with agent steps.** Anyone who already understands what happens when `add()` fails (sandbox preserved on fail, finalize-on-fail runs, exit 1) gets the same behavior from addSkill at no learning cost.
- **The single-string argument contract is a deliberate floor, not a ceiling.** It can later evolve into `(name, args | argsBuilder)` without breaking existing consumers, since the v1 type is a string.
- **Summary-writer integration is automatic.** Because addSkill runs in the sandbox `cwd` and modifies the worktree directly, the summary writer's diff-capture (`sandboxHandle.diff()`) naturally includes any file changes made by the skill. No special wiring needed.
