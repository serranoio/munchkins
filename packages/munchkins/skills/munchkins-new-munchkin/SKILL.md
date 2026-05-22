---
name: munchkins:new-munchkin
description: Author or revise a munchkin agent in a repo that consumes @serranolabs.io/munchkins. Use when the user wants to scaffold a NEW agent OR edit an existing one — signaled by phrases like "new munchkin", "add an agent", "scaffold a munchkin agent", "edit the X munchkin", "tweak the X agent's prompt", "demote X to a single-step agent". Do NOT use to bootstrap a fresh repo (use `/munchkins:init`) or to run an existing agent (use `/munchkins:launch-munchkin`).
---

# New Munchkin

Walks the user through designing a new agent — or revising an existing one — for a repo that consumes `@serranolabs.io/munchkins`. The skill resolves design decisions via the `grill-me` skill, then writes the agent files using framework templates.

## Architecture

- **Decision protocol** → `grill-me`. This skill defines the design tree; grill-me drives the conversation.
- **File writing** → this skill, via harness Write/Edit tools. Reads framework templates from `node_modules/@serranolabs.io/munchkins/templates/` (consumer mode) or `packages/munchkins/templates/` (source-repo mode), fills slots, writes to configured paths.
- **Functional defaults** → every scaffolded agent ships immediately runnable. Prompt refinement happens after, via this skill's edit mode (E2 loop).
- **Bootstrap is separate** → if `.munchkins/config.json` is missing, redirect to `/munchkins:init`.
- **No bundle-entry edits** → registration is handled by the framework's `discoverAgents` helper, which globs the configured agents directory at boot.

## Workflow

### 0. Pre-flight

Verify the repo is initialized:

1. `.munchkins/config.json` exists with `mode`, `agentsDir`, `skillsDir`, `bundleEntry` fields.
2. The configured `agentsDir` exists on disk.

If either fails, tell the user "run `/munchkins:init` first" and stop.

### 1. Pre-grill discovery

Read repo state. These doubles as verification that init was done properly. Any load-bearing failure → redirect to init.

- **1a** Agents directory: from `.munchkins/config.json` `agentsDir`. List existing `<name>-agent.ts` files.
- **1b** Existing agents: for each agent file, extract slug, description, archetype, options, integration, cron. Drives distinctness checks and edit targeting.
- **1c** Gate commands: from CI workflow at `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`. Fall back to `package.json` `scripts`.
- **1d** Lint/format/typecheck configs: `biome.json`, `.eslintrc*`, `tsconfig.json`, `pyproject.toml` `[tool.ruff]`/`[tool.black]`, `ruff.toml`, `mypy.ini`, `.golangci.yml`, `go.mod`.
- **1e** Primary language: from manifest (`package.json` → TS/JS, `pyproject.toml` → Python, `go.mod` → Go).
- **1f** Package manager: from lockfile (`bun.lock` → bun, `pnpm-lock.yaml` → pnpm, etc.).
- **1g** Daemon wiring: read the bundle entry from config. Detect whether `runDaemon` is dispatched. Record `wired` / `unwired` / `unknown`.
- **1h** Paths + mode: read `mode`, `agentsDir`, `skillsDir`, `bundleEntry`, `agentIndexFile` from `.munchkins/config.json`.

### 2. Mode pick

Invoke `grill-me` with one fork:

- **M0** — Create or edit?

Infer from trigger phrase if possible (verbs like "edit", "tweak", "demote", "promote", or a slug name → edit; otherwise create).

### 3. Create grill (M0 = create)

Invoke `grill-me` with this design tree:

- **N1 — Purpose.** Open question. Restate to confirm.
- **N2 — Distinctness.** Pressure-test against existing agents from 1b. Verdict: `build` / `refine` (loop to N1) / `abandon`.
- **N3 — Archetype.** Pick one:
  - `single-step` (example: `refactor`)
  - `main + refactor` (example: `bug-fix`)
  - `main + refactor + tests` (example: `feat-small`)

  **Composed (`.thenRun()`) is pointer-only.** If the user asks for chaining two existing agents, point them at `packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts` and tell them to copy the pattern by hand. Do NOT scaffold composed agents through this skill.
- **N4 — Name.** Propose a kebab-case slug. Collision-check against 1b. Validate `^[a-z][a-z0-9-]*[a-z0-9]$`.
- **N-gate — Non-default requirements?** Single checkbox-style fork. User picks zero or more of:
  - Custom CLI options → fires **N5**
  - PR integration mode → fires **N5b**
  - Cron schedule → fires **N5c**
- **N5** (conditional) — Custom CLI flag names + descriptions. Conflict-check against framework-reserved (`--cli`, `--user-message`, `--verbose`, `--thinking`, `--dry-run`, `--integrate`) and options from 1b.
- **N5b** (conditional) — Integration strategy: `merge` vs `pr`. If `pr`, verify `gh` or `glab` is on PATH.
- **N5c** (conditional) — 5-field cron spec, canned `userMessage`, verbosity (default / thinking / verbose). If 1g shows `unwired` or `unknown`, surface a one-time bundle-wiring task — do NOT auto-edit dispatch logic.

After grill-me resolves the tree, proceed to §5 (Output).

### 4. Edit grill (M0 = edit)

Invoke `grill-me` with this design tree:

- **E0 — Target.** From trigger phrase, or pick from 1b. Display current state: description, archetype, options, integration, cron, prompt body preview.
- **E1 — Archetype change.** Keep / demote / promote / change. Converting to or from Composed is out of scope — tell the user to delete and re-create instead.
- **E1b** (conditional) — Integration strategy change.
- **E1c** (conditional) — Cron schedule change. Same wiring check as N5c.
- **E2 — Prompt body refinement.** **Loops** until the user signals stop ("done", "looks good", "no more changes"). Each accepted iteration writes via Edit. Show current body → propose diff → accept → repeat.

After grill-me resolves: write each changed artifact via §5 (edit-mode subset).

### 5. Output (after grill resolves)

#### Create mode

Read templates from the framework, fill slots, write files.

1. **`<agentsDir>/<slug>/<slug>-agent.ts`** — from `templates/agent.ts.<archetype>` (or `templates/agent.ts.cron` overlay if N5c fired). Slots: `<slug>`, `<description>`, `<integrate>`, `<cron>`, `<options>`.
2. **`<skillsDir>/<namespace>-<slug>/SKILL.md`** — from `templates/skill-body.<archetype>.md`. Slots: `<namespace>`, `<slug>`, `<description>`, `<purpose>`. Body is functional, not a placeholder. Frontmatter `name: <namespace>:<slug>`.
3. **`<agentsDir>/<slug>/spec-template.md`** — from `templates/spec-template.<archetype>.md`. Archetype mapping: single-step → refactor-style (scope boundary); main+refactor → bug-style (Current/Expected behavior); main+refactor+tests → feature-style (user-facing change). Slots: `<slug>`, `<purpose>`.
4. **Source-repo mode only** — create relative symlink:
   ```
   .claude/skills/<namespace>-<slug> → ../../packages/munchkins/skills/<namespace>-<slug>
   ```
   so Claude Code discovers the skill in this dev environment. Consumer-repo mode skips — `.claude/skills/` is already the runtime location.
5. **Agent-index row.** From `.munchkins/config.json` `agentIndexFile`, or detect once (scan `AGENTS.md`, `SKILLS.md`, `docs/agents.md`, `docs/skills.md` for a markdown table listing agents; persist the chosen path back to config). Append:
   ```
   | <slug> | <description> |
   ```
   Skip silently if no candidate found.

No bundle-entry edit. Auto-discovery handles registration.

#### Edit mode

- **Agent .ts** — update only the chain that changed (`.add(...)`, `.integrate(...)`, `.cron(...)`). Leave constructor args and `.addDeterministic` tail untouched unless E0's E1 demanded.
- **SKILL.md body** — rewrite from the grill-resolved diff. Frontmatter `description:` updates only if changed; mirror the new description to agent .ts and the agent-index row.
- **Agent-index row** — update if description changed.
- **Symlink** — untouched.

### 6. Verify

Run gate commands from 1c. Surface failures with the rule that fired.

- Create mode: validates the scaffolded files compile + lint clean.
- Edit mode: validates the change didn't break anything.

If the gate fails, surface the rule and leave the files in place. Do NOT auto-revert.

## Namespacing convention

- **Default skills shipped by `@serranolabs.io/munchkins`** use namespace `munchkins`. Frontmatter `name: munchkins:<slug>`. Directory `<skillsDir>/munchkins-<slug>/`. Claude Code invocation `/munchkins:<slug>`.
- **Project-local agents in a consumer repo** use a namespace specific to the consumer (e.g., `lumen`, `acme`). Default suggestion: derive from `package.json` `name` (e.g., `@lumen/api` → `lumen`). Ask once per session.
- **Bare names** (no colon) are reserved for general-purpose Claude Code skills unrelated to munchkins.

The `:` → `-` directory mapping is the rule applied by `Prompt.withSkill()`.

## Hard rules

- **Init must have run.** Pre-flight redirects if `.munchkins/config.json` is missing.
- **Skill is the source of truth for prose.** Agent .ts loads it via `withSkill('<namespace>:<slug>')`.
- **CLI slug is bare; skill name is namespaced.** Agent slug = `bug-fix`. Skill name = `munchkins:bug-fix`. Directory = `munchkins-bug-fix/`.
- **Description must match across three places** when skill-backed: SKILL.md frontmatter, `AgentBuilder` second arg, agent-index row.
- **No shell scripts.** All executable artifacts are TypeScript run via Bun.
- **No agent.ts test files.** Agents are pure configuration; exercise via the scenario harness.
- **Composed is pointer-only.** Don't scaffold `.thenRun()` agents.
- **Functional defaults, not placeholders.** Scaffolded agents are runnable immediately.
- **Auto-discovery handles registration.** Never edit the bundle entry from this skill.
- **Edit mode never deletes or renames** — user-initiated by hand only.

## What this skill does NOT do

- Does not bootstrap a fresh repo (use `/munchkins:init`).
- Does not modify shared prompt files in `_shared/prompts/`.
- Does not run agents end-to-end (only the lint/typecheck/test gate via N7).
- Does not edit the bundle entry's dispatch logic.
- Does not start, stop, or smoke-test the daemon.
- Does not update README.md (manual follow-up).
- Does not commit changes.
- Does not delete, rename, or migrate existing agents.
- Does not promote framework-internal prompts (`agent-guidelines`, `refactorer`, `test-writer`, `summary-writer`, `deterministic-fixer`) to skills.
