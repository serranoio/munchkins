# Diagnosis — addSkill: AgentBuilder cannot execute Claude Code skills as pipeline steps

**Problem:** The munchkins `AgentBuilder` cannot load and execute a named Claude Code skill (e.g. `diagnose`, `dry-refactor`, `simplify`) as a step in an agent pipeline. Today its only step kinds are an "agent" step (a `Prompt` → `spawnClaude`), a "deterministic" step (a list of shell commands optionally wrapped in an auto-repair loop), and a "finalize" step (commands + onPass/onFail).

**Scope of this diagnosis:**
- In: `packages/munchkins-core/src/builder/agent-builder.ts`, `packages/munchkins-core/src/builder/prompt.ts`, `packages/munchkins-core/src/builder/spawn-claude.ts`, the global skill registry at `~/.claude/skills/<name>/SKILL.md`.
- Out:
  - Project-local skills under `<repo>/.claude/skills/` (resolved automatically by Claude Code; see grill-me resolutions).
  - Passing structured arguments / typed inputs into a skill (treated as a follow-up enhancement).
  - HITL — separate diagnosis (`docs/pages/internal/hitl/`).
  - Skill authoring / new skill creation — out of scope; addSkill consumes existing skills.

**Codebase state (post-refactor, current as of writing):**
- The repo has been split into `packages/munchkins-core/` (framework: `AgentBuilder`, `AgentRegistry`, `Prompt`, `spawnClaude`, `gitWorktreeSandbox`, `RunLog`, worktree helpers) and `packages/munchkins/` (bundle that imports the core and registers default agents at module load).
- Default agents live under `packages/munchkins/agents/<name>/`. Today: `bugfix/` and `refactor/`. Each defines a single exported `builder` constant via `new AgentBuilder(name, description, gitWorktreeSandbox())…` and calls `registry.register(builder)` at module top-level.
- `Prompt`'s API is `withSystem(path)`, `withUserMessage(text)`, `withUserMessageFromOption(name, declaration)` (and a `fragments` getter exposed to `AgentBuilder` for option auto-registration). The old `withInput` / `withText` names from the pre-refactor code are gone.
- `AgentBuilder.run()` resolves the worktree via the constructor-provided `SandboxFactory`; runs steps; runs an optional summary-writer phase that consumes the sandbox's `diff()` to emit a commit message + CHANGELOG markdown; then calls `sandboxHandle.teardown(outcome, ctx)` which squash-merges to main on pass or preserves on fail.
- Every run is recorded into `.munchkins/runs/<agent>-<ts>-<uuid>/` via `RunLog`: per-step prompt / user / response files, an events.jsonl, a summary.json, and (on success) a CHANGELOG entry prepended to the repo's `CHANGELOG.md`.
- The single scenario harness lives at `scenarios/index.ts`. It mocks `spawnClaude` via `mock.module()` against the absolute path `packages/munchkins-core/src/builder/spawn-claude.ts`, accesses agents via `registry.get("bug-fix")` (not a factory), and asserts post-run that the worktree was cleaned up, no agent branches leaked, and marker files written by the mocked spawn calls were squash-merged onto main.

**Assumptions:**
- About users: an operator constructing a munchkins agent (e.g. via the `bugfix` or `refactor` patterns under `packages/munchkins/agents/`) wants to compose existing skills as pipeline steps without re-implementing each skill's body as an inline `Prompt`. The user is comfortable referring to a skill by its registry name (e.g. `dry-refactor`).
- About workflows: a "skill step" runs once, in the agent's sandbox cwd, like an "agent step" does today (synchronous, single Claude invocation, fail-fast on non-zero exit). It can be placed before, between, or after `add()` and `addDeterministic()` calls. It composes with the summary-writer phase identically to existing steps (its effects in the worktree are captured in the diff that the summary writer reads).
- About technical feasibility: the spawned Claude subprocess in `spawnClaude` (via `claude -p ... --system-prompt ...`) has access to the Skill tool and can resolve installed skills by name. **Verified empirically during grill-me** — recorded below.
- About backwards compatibility: existing default agents (`bugfix`, `refactor`) and any external consumers of `AgentBuilder` continue to work unchanged. addSkill is additive — a new step kind plus a new builder method.
- About performance/security/accuracy: skill resolution reads files from a user-controlled directory tree (`~/.claude/skills/` and `<cwd>/.claude/skills/`). Claude Code does the resolution; munchkins reads no SKILL.md files itself, so there is no parallel resolver to keep in sync.

**Constraints:**
- **No relative cross-package imports.** Anything new lives in `@serranolabs.io/munchkins-core` (or `@serranolabs.io/munchkins` for default-agent additions) and is consumed via the package name. CLAUDE.md hard rule.
- **Bun only.** No npm/pnpm.
- **No harness leakage.** addSkill must not depend on `scenario_id`, `run_id`, or any harness-only identifier (AGENTS.md hard-rule #4).
- **Builder-level primitive.** Must compose with the existing `add()` / `addDeterministic()` / `finalize()` / `summaryWriter()` chain — no parallel runtime.
- **Subagent prompt files stay externalized.** Existing pattern: prompts live alongside the agent in `packages/munchkins/agents/<name>/prompts/<file>.md` (or shared in `_shared/prompts/`), referenced by absolute path computed via `dirname(fileURLToPath(import.meta.url))`. addSkill adds no new prompt files because it does not load skill bodies.
- **Failure semantics match existing steps.** Non-zero exit from the underlying Claude invocation throws and aborts the pipeline; finalize-on-fail still runs; the sandbox `teardown(fail, ...)` preserves the worktree.
- **RunLog participation.** New step kinds must accumulate Claude usage (tokens, cost) into the RunLog and write per-step files so the summary-writer phase and the CHANGELOG entry capture the work.

**Unknowns (resolved in grill-me):**
- ~~**Skill execution semantics in headless `claude -p`.**~~ **Resolved.** Empirically verified: `claude --dangerously-skip-permissions -p "/<skill-name> <args>" --output-format json` does load and execute the named skill, identical to interactive behavior. Test: `cd /tmp && claude -p "/diagnose hello world test"` returned the diagnose skill's actual response (cache_creation = 37k tokens = skill body loaded). The `claude --help` output also confirms — `--bare`'s description states "Skills still resolve via /skill-name" and `--disable-slash-commands` is documented as "Disable all skills." **Implication: Option B is the chosen direction.**
- ~~**Skill resolution path.**~~ **Resolved.** Empirically verified: Claude Code itself resolves skills from both `~/.claude/skills/<name>/SKILL.md` (global) and `<cwd>/.claude/skills/<name>/SKILL.md` (project-local) automatically. Test: created `/tmp/skill-test/.claude/skills/echo-test/SKILL.md`, ran `claude -p "/echo-test"` from that cwd, got the project-local skill's response. **Implication: addSkill needs no resolver, no SKILL.md reading, no frontmatter parsing — it just spawns claude with the slash-command in the sandbox cwd.**
- ~~**Skill arguments contract.**~~ **Resolved.** Single free-form string appended after the slash command. `addSkill("dry-refactor", "focus on the builder/")` → user prompt `/dry-refactor focus on the builder/`. Operator is responsible for any structure they want (e.g. JSON-stringifying); zero translation layer in munchkins.
- ~~**What "executing a skill" returns.**~~ **Resolved.** Side-effects only, no return value, exit code = success/fail. Matches existing `add()` step semantics. A return-channel from any agent step (not just skills) is a separate, larger feature for a future diagnosis.
- ~~**Plugin-namespaced skills.**~~ **Resolved.** Supported in v1 at zero cost — Claude Code handles `/plugin:name` resolution itself; munchkins passes the string through unmodified.
- ~~**Skill discovery vs. skill listing.**~~ **Resolved.** No `listSkills()` in v1. Operators name the skill explicitly.

**Root cause:**
- `AgentBuilder` models pipeline steps as either (a) a `Prompt` resolved to two strings and fed to `spawnClaude`, (b) a sequence of shell commands, or (c) a finalize block. Skills are a third execution shape: instructions stored in the user's skill registry that are designed to be invoked from inside a Claude session via the harness's Skill tool. There is no step kind, no resolver, and no spawn variant that bridges "named skill in the registry" to "Claude session that runs that skill," so operators currently cannot compose skills into munchkins pipelines without re-implementing each skill's body as an inline `Prompt`.

**Solution options** (each is a different approach to the SAME root cause: bridging skill-registry names to AgentBuilder steps):

Surface-area metric: how much new public API + new prompt-file / new TS code is added, and how much skill semantics is preserved (sub-skill invocation, allowed-tools enforcement, frontmatter awareness). Lower surface + higher fidelity is better.

- **Option A — Resolve skill body as a `Prompt`.** Add a method that locates `~/.claude/skills/<name>/SKILL.md`, strips frontmatter, and uses the body as the system prompt for an existing "agent" step.
  - Tradeoff: loses skill semantics. The skill body becomes a static system prompt; the spawned Claude does not "invoke" the skill via the Skill tool.

- **Option B — `SkillStep` invokes skill via slash-command in a fresh Claude session.** New `Step` variant, new spawn pattern that constructs a user prompt of the form `/<skill-name> <args>` and runs `claude -p` exactly as today. Relies on the headless session's Skill tool resolving the slash-prefixed name.
  - Tradeoff: depends on the empirical fact that headless `claude -p` loads and executes the Skill tool when given `/<skill-name>` as input. **Verified during grill-me.**

- **Option C — Render skill to a deterministic shell wrapper.** Sugar over `addDeterministic(["claude --skill <name>"])` (or a wrapper). Reuses the existing deterministic step kind verbatim — no new step kind.
  - Tradeoff: no `claude --skill` flag exists; would degrade to Option A or duplicate Option B logic. Argument quoting adds shell-injection surface.

**Recommendation:** **Option B**, with simplifications enabled by grill-me findings.

The chosen design (post-grill-me):
- A new `Step` variant with `kind: "skill"` carrying `{ name: string; args?: string }`.
- A new builder method `addSkill(name, args?)` that appends this step.
- Execution: spawn `claude --dangerously-skip-permissions -p "/<name> <args>"` (with `--output-format stream-json --verbose` matching existing `spawnClaude` behavior) in the sandbox's `cwd`. Reuse `spawnClaude` directly — no `--system-prompt`, no SKILL.md reading. Claude Code itself resolves the skill from global or project-local registry and executes it.
- Failure semantics: non-zero exit code throws and aborts the pipeline, identical to existing agent steps.
- Side-effects only: no return value exposed to downstream steps in v1.
- RunLog participation: each addSkill spawn is recorded with per-step files (system / user / response) and accumulates Claude usage, mirroring how `runAgent` does it today.

**Confirmed scope:**
- v1 supports global skills, project-local skills, and plugin-namespaced skills (`plugin:name`) — all resolved by Claude Code, free.
- v1 does NOT include: skill output capture / return channel, structured arguments, skill discovery / listing, skill-aware fixers in deterministic loops, distinct "skill" banner.

**Remaining risks / explicit deferrals:**
- The spawned `claude -p` inherits whatever the operator's environment exposes (auth, model selection, token budget). munchkins does not currently surface `--max-budget-usd` or `--model` overrides on agent steps; addSkill inherits the same limitation. Acceptable for v1.
- A skill that requires interactive I/O (none observed in the registry today) would silently fail in `-p` mode. Document that addSkill is for non-interactive skills only.
- Skill registry is read at execution time, not at pipeline-construction time. A pipeline that names a non-existent skill will fail at runtime (or silently no-op — Claude Code accepts unknown slash strings as text input). Acceptable; matches existing `Prompt` behavior (lazy file reads).
