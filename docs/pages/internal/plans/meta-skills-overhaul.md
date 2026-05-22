# Meta-skills overhaul (launch-munchkin + new-munchkin + init)

Captures the code follow-ups from the grilling sessions that produced the revised `munchkins-launch-munchkin/SKILL.md`, the revised `munchkins-new-munchkin/SKILL.md`, and the new `munchkins-init/SKILL.md`. The SKILL.md edits are already done. This doc tracks the framework + repo changes the SKILL.md edits depend on.

## Background

Three skills compose the meta surface of `@serranolabs.io/munchkins`:

- `munchkins:init` (new) — one-time bootstrap of a host repo.
- `munchkins:new-munchkin` (rewritten) — author or revise an agent.
- `munchkins:launch-munchkin` (rewritten) — delegate a coding task to a registered agent.

Grilling resolved several design decisions that move logic out of SKILL.md prose and into framework code, replace hardcoded conventions with config-driven values, and consolidate fragile heuristics.

## Code follow-ups

### 1. Auto-discovery helper

**Module:** `packages/munchkins-core/src/registry/` (or a new `discovery/` module).

**Surface:**

```ts
export async function discoverAgents(path: string): Promise<void>;
```

Globs `<path>/**/*-agent.ts`, dynamic-imports each match. Each file's top-level `registry.register(builder)` fires as a side effect.

**Why:** eliminates per-agent side-effect imports in bundle entries. new-munchkin no longer edits the bundle. Adding an agent = drop the file, done.

**Touches:** `packages/munchkins/src/index.ts` — convert from explicit import block to `await discoverAgents("../agents")`.

### 2. `.munchkins/config.json` reader

**Module:** `packages/munchkins-core/src/config/` (new).

**Surface:**

```ts
export interface MunchkinsConfig {
  mode: "source-repo" | "consumer-repo";
  agentsDir: string;
  skillsDir: string;
  bundleEntry: string;
  integrate: "merge" | "pr";
  agentIndexFile?: string;
  branchPrefix?: string;  // future
}

export function readConfig(repoRoot?: string): MunchkinsConfig | null;
export function writeConfig(config: MunchkinsConfig, repoRoot?: string): void;
```

**Consumed by:**

- `launch-munchkin` skill — reads `integrate` for default integration mode.
- `new-munchkin` skill — reads `agentsDir`, `skillsDir`, `bundleEntry`, `mode`, `agentIndexFile`.
- `init` skill — writes the file.

**This repo:** commit `.munchkins/config.json` with `{"mode":"source-repo", "integrate":"merge", "agentsDir":"packages/munchkins/agents", "skillsDir":"packages/munchkins/skills", "bundleEntry":"packages/munchkins/src/index.ts", "agentIndexFile":"AGENTS.md"}`.

### 3. Framework templates

**Path:** `packages/munchkins/templates/`.

**Files to ship:**

- `agent.ts.single-step` — single-step archetype scaffold
- `agent.ts.main-refactor` — main + refactor archetype scaffold
- `agent.ts.main-refactor-tests` — main + refactor + tests archetype scaffold
- `agent.ts.cron-overlay` — optional `.cron(...)` chain appended when N5c fires
- `skill-body.single-step.md` — functional default skill body for single-step
- `skill-body.main-refactor.md` — functional default skill body for main+refactor
- `skill-body.main-refactor-tests.md` — functional default skill body for main+refactor+tests
- `spec-template.refactor.md` — refactor-style spec template (scope boundary)
- `spec-template.bug.md` — bug-style spec template (Current/Expected behavior)
- `spec-template.feature.md` — feature-style spec template (user-facing change)

Templates use `{{slot}}` placeholders. `new-munchkin` reads + fills + writes via Write tool.

**Archetype → spec-template mapping:**

```
single-step              → spec-template.refactor.md
main + refactor          → spec-template.bug.md
main + refactor + tests  → spec-template.feature.md
```

### 4. Shipped agents get `spec-template.md` alongside `.ts`

For each existing default agent, add a `spec-template.md` next to the `.ts`:

- `packages/munchkins/agents/bugfix/spec-template.md` — bug-style (Current/Expected behavior)
- `packages/munchkins/agents/feat-small/spec-template.md` — feature-style (user-facing change)
- `packages/munchkins/agents/refactor/spec-template.md` — refactor-style (scope boundary)
- `packages/munchkins/agents/director/spec-template.md` — likely none; director is cron-driven and not a launch-munchkin target

**Why:** launch-munchkin Q9 — each agent owns its own template.

### 5. cmux verbosity auto-injection

**Module:** `packages/munchkins/src/cmux-launcher.ts`.

When `buildCmuxCommand` constructs the inner command, auto-inject `--verbose` (or equivalent) so the cmux session has visible output. Today, launch-munchkin's SKILL.md is responsible for passing `--verbose`; the revised SKILL.md drops that rule because the framework handles it.

**Touches:** `buildCmuxCommand` adds `--verbose` to `innerArgs` if not already present and the subcommand is an agent (not `daemon`/`status`/`resume`/`skills`).

### 6. Launchable agents only — exclude cron-only agents from launch-munchkin's `--help` surface

**Modules:** `packages/munchkins-core/src/builder/agent-builder.ts` and `packages/munchkins-core/src/registry/registry.ts`.

**Surface change:**

```ts
class AgentBuilder {
  kind(k: "launchable" | "cron-only"): this;
}
```

Default kind is `launchable`. `director` (and any future cron-only agent) calls `.kind("cron-only")`.

A new CLI command `munchkins list-launchable` returns only launchable agents, used by launch-munchkin step 2. `--help` still shows all (consistent with current CLI behavior).

### 7. `discoverAgents` over explicit imports — convert existing bundle

Once #1 lands, replace explicit imports in `packages/munchkins/src/index.ts` with `await discoverAgents("../agents")`. Verify existing agents still register correctly.

## SKILL.md changes already made

- `packages/munchkins/skills/munchkins-launch-munchkin/SKILL.md` — full rewrite.
- `packages/munchkins/skills/munchkins-new-munchkin/SKILL.md` — full rewrite (50KB → ~9KB).
- `packages/munchkins/skills/munchkins-init/SKILL.md` — new file.

## Open follow-ups (not from grilling)

- README.md: update default-agents table and skill discovery section to reflect the three-skill meta surface (`init`, `new-munchkin`, `launch-munchkin`).
- AGENTS.md: add row for `init` if it's tracked as an agent (it isn't today — it's a skill).
- Scenario harness: add coverage for `init` on a fresh repo, `new-munchkin` write-and-verify, `launch-munchkin` dry-run validation.
- Test agent registration via `discoverAgents` against a fixture agents directory.

## Sequencing

1. Land #1 (`discoverAgents`) + #7 (convert existing bundle). Test the existing four agents still register.
2. Land #2 (config reader) + commit this repo's `.munchkins/config.json`.
3. Land #3 (templates) + #4 (shipped agent spec-templates).
4. Land #5 (cmux verbosity).
5. Land #6 (kind flag) — required for launch-munchkin's `list-launchable` step.
6. Implement `init` skill's file-writing behavior (the SKILL.md prose is done; the skill orchestrates via Write/Edit tools — no code change in the framework needed beyond #2 and the templates).
7. Implement `new-munchkin` skill's file-writing behavior (same — the SKILL.md prose is done; orchestrates via tools).

Each step is independently shippable. Existing default agents keep working through every step.
