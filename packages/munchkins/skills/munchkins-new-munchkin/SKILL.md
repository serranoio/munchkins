---
name: munchkins:new-munchkin
description: Author or revise a default agent inside a repo that consumes @serranolabs.io/munchkins. Each munchkin is co-authored as a Claude Code skill (the workflow prose) plus a thin agent .ts (composition + deterministic scaffolding). Use when the user wants to scaffold a NEW munchkin agent OR edit an existing one — signaled by phrases like "new munchkin", "add a default agent", "scaffold a munchkin agent", "design an agent for this repo", "edit the X munchkin", "tweak the X agent's prompt", "change X's archetype", "demote X to a single-step agent". Do NOT use to run an existing agent (use launch-munchkin) or to create a generic standalone Claude Code skill (use skill-creator).
---

# New Munchkin

Walks the user through designing a new default agent — or revising an existing one — for a host repo that consumes `@serranolabs.io/munchkins`. A munchkin has two co-authored artifacts:

- **Skill** (`<skills-dir>/<name>/SKILL.md`) — the user-facing workflow prose with Claude Code skill frontmatter. This is the source of truth for what the agent does. Independently invokable in any Claude Code session via `/<name>`.
- **Agent** (`<agents-dir>/<name>/<name>-agent.ts`) — a thin TS file that loads the skill body as its main prompt and wraps it with deterministic scaffolding (worktree, gate, integration, summary writer).

Outputs:

- **Create mode**: a new `<skills-dir>/<name>/SKILL.md`, a thin `<agents-dir>/<name>/<name>-agent.ts`, the side-effect import, and an updated AGENTS.md row.
- **Edit mode**: an updated SKILL.md (if workflow prose or description changes), an updated agent.ts (if archetype / integration / cron changes), and a refreshed AGENTS.md row (if description changes).

## Operating principles

1. **Concise > more prose.** Drafts are short. This skill md is short. Generated files mirror existing terse voice.
2. **Discover, never hardcode.** Paths, languages, gate commands, existing agents — all introspected from the host repo at runtime. Never assume `packages/munchkins/agents/` or `packages/munchkins/skills/`, never assume Bun/TS, never assume agent names like `bug-fix`/`feat-small`/`refactor` exist.
3. **Reuse over invention.** Generated files lean on the host repo's existing shared presets and shared prompt paths. The new or revised agent should look like a sibling of what's already there.
4. **Skill is the source of truth for primary prose.** Each agent's user-facing workflow lives in `<skills-dir>/<namespaced-dir>/SKILL.md`. The agent .ts loads it via `withSkill('<namespace>:<name>')` and wraps it with scaffolding. Framework-internal prompts (`agent-guidelines`, `refactorer`, `test-writer`, `summary-writer`, `deterministic-fixer`) stay in `<agents-dir>/_shared/prompts/` — they are NOT skills, because they are not standalone-usable workflows.

   **Namespace convention.** Default skills shipped by `@serranolabs.io/munchkins` are namespaced as `munchkins:<name>` (frontmatter `name: munchkins:bug-fix`, directory `<skills-dir>/munchkins-bug-fix/`, Claude Code invocation `/munchkins:bug-fix`). Project-local skills authored by the consumer SHOULD use a different namespace specific to the consumer's repo or org (`<org-or-repo>:<name>` — e.g., `lumen:incident-postmortem`, directory `<skills-dir>/lumen-incident-postmortem/`, frontmatter `name: lumen:incident-postmortem`). Bare names (no colon, e.g., `name: foo` at directory `foo/`) are reserved for the consumer's general-purpose Claude Code skills that have nothing to do with munchkins. The `:` to `-` conversion is the path-resolution rule used by `Prompt.withSkill()`.
5. **Runtime location of skills is project-local, not package-local.** In a consumer repo, the only runtime source of truth for skills is `<repo-root>/.claude/skills/<name>/SKILL.md`. The npm package (`@serranolabs.io/munchkins`) ships *templates* under its own `skills/` directory; those templates are scaffolded into `.claude/skills/` by `bun run munchkins install-skills`, then committed to the consumer's repo. After scaffold, the package's bundled templates are never read — edits to `.claude/skills/<name>/SKILL.md` change BOTH `/<name>` discovery in Claude Code AND the agent's behavior on `bun run munchkins <name>`. One file, two surfaces, no override layer, no drift.

## Posture

This is a **grill-me-style sequential interview**. Walk the user through the agenda one fork at a time, in this exact format per fork:

```
## <fork-id> — <fork title>

**Summary.** <one short paragraph: why this decision exists, in plain language>

<fixed-width tradeoff table: columns = options, rows = consequences, 4–7 rows>

<one minimal code block per option>

**My pick: <option>.** <one-sentence reason.>

**Your call?**
```

One fork per message. Wait for the user's reply before moving on. Do not batch.

## Workflow

### 0. Pre-flight

Confirm the cwd is a host repo that consumes munchkins. Quick checks (any positive signal is enough):

- `@serranolabs.io/munchkins` in `package.json` deps, OR
- An existing `<name>-agent.ts` file using `AgentBuilder` somewhere under the repo, OR
- The user explicitly invoked `/new-munchkin` from inside what they say is a munchkins-using repo.

If none of these hold, tell the user "new-munchkin runs inside a repo that consumes @serranolabs.io/munchkins" and stop.

### 1. Pre-grill discovery

Do all of the following **before** asking the first fork. Every downstream step depends on this state. Both create-mode and edit-mode use this discovery.

#### 1a. Locate the agents directory

Scan for the convention: a directory containing one or more `<name>-agent.ts` files plus a `prompts/` subdirectory, with a sibling `_shared/` (or analogous shared module exporting things like `DEFAULT_CHECKS`, `defaultFixer`, `GUIDELINES_PATH`).

```bash
# Typical search; adapt as needed
find . -path ./node_modules -prune -o -type f -name '*-agent.ts' -print
```

If exactly one such directory exists, use it. If multiple exist, ask the user which to target. If none exist, ask the user for the path. **Never default to `packages/munchkins/agents/` without confirming it exists.**

#### 1b. Enumerate existing agents

For each `<name>-agent.ts` in the agents directory, read the file and extract:

- **Slug** — the first arg to `new AgentBuilder(...)`, or the arg to a chained `.rename(...)`.
- **Description** — the second arg to `new AgentBuilder(...)`, or the arg to a chained `.describe(...)`.
- **Step composition** — the chain of `.add(...)` calls AND any `.thenRun(other)` composition (which concatenates two builders' steps). Note which shared prompt paths each step reuses (e.g., `REFACTORER_PATH`, `TEST_WRITER_PATH`).
- **CLI options** — any `withUserMessageFromOption(...)` schemas declared.
- **Primary-prompt source** — one of: (a) `withSkill('<name>')` → skill-backed at `<skills-dir>/<name>/SKILL.md` (Way 1, current convention); (b) `withSystem(join(PROMPTS, '<name>.md'))` → legacy prompt md at `<agents-dir>/<name>/prompts/<name>.md`. Record which form the agent uses; edit-mode preserves whichever is in place unless the user explicitly migrates.
- **Integration strategy** — any `.integrate(...)` call (no arg or `integrateMerge()` → merge; `integratePR(...)` → PR). Absence means run-layer default (merge).
- **Cron schedule** — any `.cron(spec, { userMessage, verbosity? })` call. Records the spec, the canned userMessage, and the verbosity (`"default" | "thinking" | "verbose"`). Absence means the agent is invoked manually only.

This list drives create-mode (distinctness, archetype menu, slug collision check) and edit-mode (target picker, current-state display, conflict checks).

#### 1c. Discover gate commands from CI

Look for CI workflow files in this order; stop at the first match:

1. `.github/workflows/*.yml`
2. `.gitlab-ci.yml`
3. `.circleci/config.yml`
4. `Jenkinsfile`

Parse the jobs that run on PR/push triggers. Extract the actual lint / typecheck / test commands (`run:` lines under steps for GitHub Actions; `script:` for GitLab; etc.). These commands are what the agent's deterministic gate will run, and what verify (N7/E3) runs locally.

If no CI workflow exists, fall back to inspecting the host repo's package manifest (`package.json` `scripts`, `Makefile`, `pyproject.toml` `[tool.poetry.scripts]`, `tox.ini`, etc.) and ask the user to confirm.

#### 1d. Read lint / format / typecheck configs

Read whichever apply so generated files comply on first try:

- TS: `biome.json`, `.eslintrc*`, `tsconfig.json`
- Python: `pyproject.toml` `[tool.ruff]` / `[tool.black]`, `ruff.toml`, `mypy.ini`
- Go: `.golangci.yml`, `go.mod`

#### 1e. Identify primary language

Determined by which manifest exists (`package.json` → TS/JS, `pyproject.toml` → Python, `go.mod` → Go). Used to tailor mandate style guidelines. Polyglot repos: pick the language of the agents directory (likely TS — munchkins-core is TS).

#### 1f. Detect package manager

From lockfile presence: `bun.lock` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm, `poetry.lock` → poetry, `uv.lock` → uv. Use this PM in any commands surfaced to the user.

#### 1g. Detect daemon wiring

Read the bundle's entry file (`<bundle-package>/src/index.ts` — the same file that holds the side-effect imports). Look for a daemon dispatch: a branch on `argv[2] === "daemon"` (or analogous) that calls `runDaemon()` from `@serranolabs.io/munchkins-core`.

Record one of three states:
- **wired** — the daemon branch is present.
- **unwired** — entry file exists but has no daemon branch.
- **unknown** — no clear bundle entry file found.

Drives N5c / E1c: if the user picks cron and daemon wiring is unwired/unknown, the skill must surface a one-time bundle-wiring task (it does NOT auto-edit the entry's dispatch logic — that's shared infrastructure, owner-managed).

#### 1h. Locate the skills directory + detect mode

The runtime location of `SKILL.md` files differs by context. The skill MUST detect which it is in before writing anything.

**Mode detection:**

- **Source-repo mode** — cwd is the `@serranolabs.io/munchkins` framework's own monorepo. Signal: `packages/munchkins-core/` workspace exists, OR `packages/munchkins/package.json` declares `name: "@serranolabs.io/munchkins"`. In this mode, you're authoring a *default* skill that ships as a template inside the npm package. Skills live at `packages/munchkins/skills/<name>/SKILL.md` (the template location).
- **Consumer-repo mode** — cwd consumes `@serranolabs.io/munchkins` via npm. Signal: `@serranolabs.io/munchkins` in `package.json` deps AND `packages/munchkins-core/` does NOT exist. In this mode, you're authoring a *project-specific* skill that lives inside the consumer's repo. Skills live at `<repo-root>/.claude/skills/<name>/SKILL.md` (the project-local location). This is the runtime source of truth that BOTH the agent (`withSkill('<name>')`) AND Claude Code (`/<name>` discovery) read from.

Set `<skills-dir>` accordingly:

- Source-repo mode → `<skills-dir> = packages/munchkins/skills/`
- Consumer-repo mode → `<skills-dir> = .claude/skills/`

If neither signal applies, ask the user; do not assume.

**Why these two locations diverge:**

In source-repo mode, `packages/munchkins/skills/` ships inside the npm package as a *template directory*. Consumers run `bun run munchkins install-skills` to copy templates into their own `.claude/skills/`. The package directory is never read at runtime in a consumer; it is only the source for the scaffold copy.

In consumer-repo mode, `.claude/skills/` is the runtime source of truth: the agent's `withSkill('<name>')` resolves there, and Claude Code's `/<name>` discovery reads from there. There is no fallback to the package — if the consumer hasn't scaffolded, the agent throws with `"Skill '<name>' not found at .claude/skills/<name>/SKILL.md. Run 'bun run munchkins install-skills' to scaffold default skills."`

**Source-repo mode requires a `.claude/skills/<name>` symlink.** `packages/munchkins/skills/` is NOT in Claude Code's discovery path; only `.claude/skills/` is. The established convention in this monorepo (used by `launch-munchkin`, `new-munchkin`, `bug-fix`, `refactor`, `feat-small`) is a relative symlink:

```sh
ln -s ../../packages/munchkins/skills/<name> .claude/skills/<name>
```

This is NOT optional and NOT a follow-up — it is one of the deliverables of create-mode in source-repo mode (see §5). Without it, the skill exists on disk but is invisible to Claude Code in this dev environment. Edit-mode never touches symlinks (they continue to resolve through to the updated `packages/munchkins/skills/<name>/SKILL.md`).

This drives N6 (where the new `SKILL.md` is written), E2 (where the existing `SKILL.md` is read from), and the symlink output line in source-repo create-mode (§5).

#### 1i. Detect first-run-consumer scaffold need

After 1a, 1g, and 1h, check the composite signal for a **fresh consumer repo** that has NEVER authored a project-local agent before:

- 1a found no `<name>-agent.ts` files in the host repo (no agents directory exists), AND
- 1g recorded daemon wiring as `unknown` (no bundle entry file found), AND
- 1h identified consumer-repo mode (this is NOT the framework's own monorepo).

If all three hold, set `fresh_consumer = true`. This drives a one-time scaffold fork (N0) at the top of create-mode that builds the consumer's bundle entry + package.json `munchkins` script before proceeding to the agent design forks. Without this scaffold, a consumer-authored agent has no bundle to register from, and `bun run munchkins <new-name>` would not find it.

If any of the three fail (an agents dir already exists, OR a bundle entry already exists), `fresh_consumer = false` — the bundle is already wired and N0 is skipped.

**Default scaffold convention** (consumer-repo mode, applied in N0 when `fresh_consumer = true`):

- Bundle entry: `<repo-root>/munchkins/index.ts`
- Agents directory: `<repo-root>/munchkins/agents/`
- Per-agent file: `<repo-root>/munchkins/agents/<name>/<name>-agent.ts`
- Skills directory: `<repo-root>/.claude/skills/` (unchanged from 1h)
- `package.json` script: `"munchkins": "bun munchkins/index.ts"`

The consumer can override the bundle directory inside N0 (e.g., `scripts/munchkins.ts` instead of `munchkins/index.ts`) — but the default is `munchkins/` because it's a self-contained module that doesn't pollute `scripts/` or `src/`. The skills directory is NOT configurable — it MUST stay at `.claude/skills/` for Claude Code discovery to work.

### 2. Mode pick (M0)

Open the grill with a **mode** fork. This is always the first fork:

```
## M0 — Mode

**Summary.** Are we creating a new munchkin or editing an existing one?

         │ A: Create new       │ B: Edit existing
─────────┼─────────────────────┼─────────────────────────
output   │ new agent files +   │ updated agent.ts and/or
         │ index.ts edit +     │ prompts/<name>.md +
         │ AGENTS.md row       │ refreshed AGENTS.md row
covers   │ first time scaffold │ archetype demote/promote,
         │                     │ prompt revision,
         │                     │ description tweak,
         │                     │ integration toggle,
         │                     │ cron schedule toggle
agenda   │ N1–N7 (+ N5b, N5c)  │ E0–E3 (+ E1b, E1c)

**My pick:** infer from the user's trigger phrase. "edit", "tweak", "change", "demote", "promote", or naming an existing slug → B. Otherwise → A.

**Your call?**
```

Branch on the answer:
- **A → Create workflow** (§3)
- **B → Edit workflow** (§4)

### 3. Create workflow (M0=A)

Run forks N0 (only if `fresh_consumer` from 1i), then N1–N7 in order. Wait for user reply between each. N5/N5b/N5c are conditional and usually skipped.

#### N0 — Bundle scaffold (conditional — only fires when `fresh_consumer = true` from 1i)

**Skip entirely if** `fresh_consumer = false` (a bundle entry and/or agents directory already exists in this repo).

When fired, this fork sets up the one-time consumer-repo scaffolding so a project-local agent has a bundle to register from. After N0, the consumer's repo gains:

- `<bundle-dir>/index.ts` — a 5-line bundle entry that side-effect-imports installed munchkins packages and dispatches the registry CLI.
- `package.json` `scripts.munchkins` pointing at the bundle entry.

The agent itself (and its SKILL.md) is created by N1–N7 and §5 as usual.

Tradeoff:

```
                  │ default location              │ custom location
──────────────────┼───────────────────────────────┼────────────────────────────────
bundle path       │ <repo>/munchkins/index.ts     │ <user-supplied path>
agents path       │ <repo>/munchkins/agents/      │ <bundle-parent>/agents/
package.json      │ "munchkins":                  │ "munchkins":
script            │   "bun munchkins/index.ts"    │   "bun <user-path>"
self-contained    │ yes — one new top-level dir   │ depends on chosen path
```

**My pick: default location.** A self-contained `munchkins/` directory at the repo root keeps everything related to the consumer's project-local agents in one place, separate from `src/`, `scripts/`, and other conventions. Most consumers should accept the default. Only override if the repo already has a strong convention that puts ad-hoc Bun scripts elsewhere (e.g., a monorepo where bun scripts live under `tooling/`).

**Bundle entry template** (write this exact shape to `<bundle-dir>/index.ts`):

```ts
#!/usr/bin/env bun
// Project bundle for munchkins. Side-effect-imports register agents into the
// shared registry; the dispatch at the bottom hands argv to the CLI.

import "@serranolabs.io/munchkins"; // registers bug-fix, refactor, feat-small

// Add additional munchkins packages here as you install them, e.g.:
// import "@your-org/internal-munchkins";

// Project-local agents (added by /new-munchkin runs) appear below:
// import "./agents/<name>/<name>-agent.js";

import { registry } from "@serranolabs.io/munchkins-core";

if (import.meta.main) {
  await registry.cli().parseAsync(process.argv);
}
```

**`package.json` edit:** add (or update) `scripts.munchkins` to:

```json
{
  "scripts": {
    "munchkins": "bun <bundle-dir>/index.ts"
  }
}
```

Use the chosen `<bundle-dir>` from the tradeoff above (default `munchkins`, so the script value becomes `"bun munchkins/index.ts"`).

**Detection of additional installed bundles:** before writing the bundle template, scan the consumer's `package.json` `dependencies` and `devDependencies` for any other package whose name suggests a munchkins bundle (heuristic: contains `munchkins` in the package name AND is not `@serranolabs.io/munchkins-core`). For each match, append a side-effect import line to the template. Examples:

- `@serranolabs.io/munchkins` → already in template.
- `@my-org/internal-munchkins` → append `import "@my-org/internal-munchkins";`
- `munchkins-extras` → append `import "munchkins-extras";`

If unsure, ask the user before adding speculative imports — don't side-effect-import a package whose registration behavior is unverified.

**Reminder to the user after N0 lands:** print a one-liner pointing at `bun run munchkins skills install` so they scaffold the default skills (which becomes possible now that the bundle exists). Subsequent forks (N1–N7) proceed against the freshly-scaffolded bundle as if it had always existed.

After N0 completes, the rest of the create workflow treats this repo identically to one that already had a bundle — `<agents-dir>` is now `<bundle-dir>/agents/`, `<bundle-package>` is the directory containing the new `index.ts`.

#### N1 — Purpose

Open question, no tradeoff table:

> In one sentence, what does the new agent do?

After the user answers, restate it back: `Restating: <one sentence>. Confirm or refine.` Wait for confirmation before proceeding.

#### N2 — Distinctness

Pressure-test the proposed agent against each existing agent enumerated in 1b. Build a table dynamically:

```
                        │ existing-agent-A │ existing-agent-B │ ... │ NEW
────────────────────────┼──────────────────┼──────────────────┼─────┼──────
What it does            │ <desc-A>         │ <desc-B>         │ ... │ <new>
How NEW differs         │ <delta-A>        │ <delta-B>        │ ... │ —
```

Verdict line: `build` (genuinely distinct), `refine` (overlaps with X — narrow purpose first), or `abandon` (already covered by X). State My pick. Wait.

If verdict is `refine` or `abandon`, loop back to N1.

#### N3 — Archetype

Derive the menu from patterns observed in 1b. In a typical munchkins consumer:

1. **Single-step** — one custom prompt step + deterministic gate. (e.g., `refactor`-style)
2. **Main + refactor pass** — custom step + reuses shared `REFACTORER_PATH` step + gate. (e.g., `bug-fix`-style)
3. **Main + refactor + tests** — custom + `REFACTORER_PATH` + `TEST_WRITER_PATH` + gate. (e.g., `feat-small`-style)
4. **Composed (`.thenRun(...)`)** — chains two existing default agents end-to-end. The composed builder's steps are `a.steps ++ b.steps`. Sandbox, summary writer, and integration are STRIPPED on the composed result and must be re-declared explicitly. Use when the user describes a pipeline like "fix a bug then refactor the touched files" and both halves already exist as agents.

If the host repo has agents that don't fit these, append additional archetypes from observed compositions. Present in a tradeoff table; user picks by number.

If the user picks **4 (Composed)**, immediately ask which two existing slugs to chain (from 1b) — `<a>.thenRun(<b>)` — and skip N6 (the composed agent inherits its prompts from the children; no per-agent prompt md exists).

#### N4 — Name

Propose a kebab-case slug derived from the purpose (short, verb-noun where possible: `release-cut`, `dep-bump`, `doc-update`).

Collision check: if the proposed slug matches any slug from 1b, propose alternatives. Validate kebab-case: `^[a-z][a-z0-9-]*[a-z0-9]$`.

Light tradeoff: show the proposed slug + 1–2 alternatives. User confirms or overrides.

#### N5 — CLI options (conditional — usually skipped)

**Skip by default.** The agent uses `--user-message` (path to markdown OR inline text), matching the existing pattern.

**Fire N5 only if** (a) the purpose statement implied a per-target flag, or (b) the user explicitly asks for custom flags.

When fired:
- Propose flag names + descriptions.
- Conflict-check each proposed flag against (i) every option declared by agents in 1b, (ii) framework-reserved names (`--cli`, `--user-message`, `--verbose`, `--thinking`, `--dry-run`, `--integrate`).
- If any conflict, surface it and ask for a non-colliding name.

#### N5b — Integration strategy (conditional — usually skipped)

**Skip by default.** Agents inherit the run-layer default (`integrateMerge` — rebase + ff-merge onto the parent branch). Operators can override at run time via `--integrate <merge|pr>`; that flag beats any author declaration.

**Fire N5b only if** the purpose mentions opening a PR, GitHub/GitLab handoff, review-required workflows, or the user explicitly asks. Tradeoff:

```
                     │ merge (default)        │ pr (integratePR())
─────────────────────┼────────────────────────┼─────────────────────────────
landing shape        │ rebase + ff onto base  │ push branch, open PR via gh/glab
external CLI needed  │ none                   │ gh (GitHub) or glab (GitLab)
operator can switch  │ yes (--integrate pr)   │ yes (--integrate merge)
agent.ts surface     │ omit .integrate(...)   │ .integrate(integratePR())
```

If user picks **pr**, the template gets `.integrate(integratePR())` and an extra import; otherwise omit `.integrate(...)` entirely.

#### N5c — Cron schedule (conditional — usually skipped)

**Skip by default.** Most agents are invoked manually with `<pm> run munchkins <name> --user-message=...`.

**Fire N5c only if** the purpose mentions a recurring cadence — "nightly", "every Monday", "scheduled", "cron", "every N hours", "weekly cleanup", etc. Tradeoff:

```
                 │ no schedule (default)    │ scheduled (.cron(...))
─────────────────┼──────────────────────────┼─────────────────────────────────────────
invocation       │ operator runs by hand    │ runDaemon() arms a timer per cron spec
agent.ts surface │ omit .cron(...)          │ .cron("<spec>", { userMessage, verbosity? })
userMessage      │ supplied at run time     │ baked into agent.ts (canned brief)
runner needed    │ none                     │ host bundle must dispatch to runDaemon()
```

If chosen:
- Ask for the cron spec (5-field standard cron, e.g., `"0 3 * * *"` for 3am daily). Validate it parses as a sane spec (5 whitespace-separated fields).
- Ask for the canned `userMessage` — a short string the daemon will pass on every tick. Must be concrete enough to run unattended.
- Ask for verbosity. Default is `"default"`. Offer `"thinking"` and `"verbose"` only if the user signals they want extra logging.
- **Overlap warning**: each cronned agent gets one timer; if a tick fires while the previous run is still in flight, both run concurrently. Pick a spec loose enough that one tick reliably finishes before the next.
- **Daemon wiring check** (from 1g):
  - **wired** → proceed.
  - **unwired / unknown** → surface a one-time bundle-wiring task to the user (template in §5). Do NOT auto-edit the entry's dispatch logic.

#### N6 — Skill content (one-shot draft)

**Skip if N3 = Composed.** A composed agent has no per-agent skill — its behavior is the concatenation of the children's skills. Confirm with the user and proceed to N7.

Otherwise, draft the **full** `<skills-dir>/<name>/SKILL.md` body in one shot. The file is BOTH the agent's main prompt (loaded via `withSkill('<name>')` from the agent .ts) AND a standalone Claude Code skill (invokable as `/<name>` in any Claude Code session inside this repo). The user accepts with `y` or pastes edits.

**Namespacing decision (before drafting the body):**

- **Source-repo mode** (authoring a default that ships in `@serranolabs.io/munchkins`): namespace is `munchkins`. Frontmatter `name: munchkins:<slug>`. Directory `<skills-dir>/munchkins-<slug>/SKILL.md`.
- **Consumer-repo mode** (authoring a project-local agent): the consumer picks a namespace specific to their repo or org (e.g., `lumen`, `acme`, the consumer's GitHub org slug). Ask the user once per session. Default suggestion: derive from `<repo-root>/package.json`'s `name` field, taking the part after the scope (e.g., `@lumen/api` → `lumen`). Frontmatter `name: <namespace>:<slug>`. Directory `<skills-dir>/<namespace>-<slug>/SKILL.md`.

The path conversion is `:` → `-` for the directory segment, applied by `Prompt.withSkill()` when the agent loads the skill at runtime. Never write a directory name with a `:` in it.

Template:

```md
---
name: <namespace>:<slug>
description: <one-sentence description suitable for Claude Code skill auto-discovery — restate what the agent does, when it applies, and what differentiates it from inline editing. Mirror the agent.ts `describe` text, then add a trigger-phrase sentence: "Use when the user wants to <do X> via the <namespace>:<slug> munchkin agent rather than inline.">
---

# <slug> subagent

You are the <name> subagent. The user prompt contains <purpose-tail>.

## Mandate

1. <read step>
2. <locate / inspect step — with style guideline woven in if relevant>
3. <act step — with style guideline woven in if relevant>
4. Commit on `$BRANCH` with a message that names <what>.
5. Stop.

## Out of scope for this step

- <bullet 1, drafted>
- <bullet 2, drafted>
- <bullet 3, drafted>

## Output

Code changes committed to `$BRANCH`. No JSON, no summary block — the deterministic loop and the human reviewer read the diff directly.
```

The body below the frontmatter is what the agent loads as its main prompt. Frontmatter is stripped before injection into the LLM (the framework's `withSkill('<name>')` helper does this), so the `name` / `description` fields exist solely for Claude Code skill discovery.

**Frontmatter rules:**
- `name` MUST be the colon-namespaced form `<namespace>:<slug>` where `<slug>` equals the agent slug from N4. The CLI invocation stays bare (`bun run munchkins <slug>`); only the SKILL surface is namespaced.
- The directory containing this `SKILL.md` MUST be `<skills-dir>/<namespace>-<slug>/` (colon converted to hyphen for filesystem safety).
- The agent .ts MUST call `withSkill('<namespace>:<slug>')` (colon form, matches the frontmatter).
- `description` MUST be specific enough that Claude Code can auto-load it on a matching user request. Generic descriptions like "fixes bugs" lose to more specific competing skills. Lead with what the agent does, then qualify with the deterministic-skill differentiator (gates, worktree, merge/PR).

**Style guidelines woven INLINE into mandate bullets (not a separate section).** Tailor to purpose AND the host repo's primary language (from 1e):

- TS refactor agent: "respecting tsconfig strict mode and existing DRY conventions"
- Python refactor agent: "respecting type hints and PEP 8 layout"
- Go refactor agent: "respecting gofmt and idiomatic error handling"
- Architect agent (any language): "favoring concrete over speculative abstraction; the simplest viable shape wins"
- Docs agent: "matching the existing voice and section structure of nearby pages"

Out-of-scope bullets follow the typical pattern: "no scope creep into adjacent files", "no test changes unless directly required", "no documentation or planning artifact updates".

#### N7 — Verify

After the user accepts N6, write all files (see §5), then run the gate commands discovered in 1c locally. Surface failures with the specific rule that fired.

### 4. Edit workflow (M0=B)

Run forks E0–E3. The fork format is the same; some forks are no-ops if the user wants to keep current state.

#### E0 — Target

If the user named the agent in their trigger phrase, skip the menu and use that target. Otherwise present a menu of slugs from 1b. Validate the chosen slug exists.

After picking, **show the current state** of the agent in a single block:

```
agent: <slug>
description: <description from AgentBuilder, or .describe() if chained>
archetype: <inferred — "single-step" / "main + refactor" / "main + refactor + tests" / "composed: <a>.thenRun(<b>)" / "custom: <description>">
CLI options: <list from withUserMessageFromOption schemas>
integration: <"merge (default)" / "merge (.integrate(integrateMerge()))" / "pr (.integrate(integratePR()))">
cron: <"none (manual only)" / "<spec> · verbosity=<v> · userMessage=\"<truncated>\"">
prompt source: <one of:
   "skill: <skills-dir>/<slug>/SKILL.md  (loaded via .withSkill('<slug>'))"
   "legacy md: <agents-dir>/<slug>/prompts/<slug>.md  (loaded via .withSystem(...))"
   "n/a (composed)"
>
   <inline preview of the body — for skill, strip frontmatter first; show first ~10 lines if short, else file size>
```

This frames every downstream fork. If the prompt source is "legacy md," edit-mode preserves it (does not auto-migrate to skill form). Migration is a separate, user-initiated action — never silent.

#### E1 — Archetype change

Tradeoff table comparing current archetype against feasible alternatives:

```
                  │ keep              │ demote               │ promote               │ change
──────────────────┼───────────────────┼──────────────────────┼───────────────────────┼─────────
new shape         │ same step chain   │ drop refactor or     │ add refactor or       │ rewrite
                  │                   │ test step            │ test step             │ from
                                                                                      │ scratch
agent.ts touched  │ no                │ yes — remove .add()  │ yes — add .add()      │ yes
prompt md touched │ no                │ no                   │ no                    │ no
```

If `keep`, this fork is a no-op — proceed to E1b.

If demote/promote/change: rewrite agent.ts's `.add(...)` chain. Preserve existing custom step (the one that uses `prompts/<slug>.md`). Add or remove shared steps (`REFACTORER_PATH`, `TEST_WRITER_PATH`) at their conventional positions (refactor between main and tests; tests last).

Converting **to or from a Composed (`.thenRun()`) archetype** is out of scope for E1 — the slug, prompt md, and step provenance change too much to be a safe in-place rewrite. Tell the user to delete and re-create instead.

#### E1b — Integration strategy change (conditional)

**Skip if the user did not mention integration / PR / merge.** Otherwise, present the same merge/pr tradeoff as N5b and apply the change in agent.ts:

- Add or update `.integrate(integrateMerge())` / `.integrate(integratePR())` on the builder chain.
- Add or remove the corresponding import (`integrateMerge` / `integratePR`) from `@serranolabs.io/munchkins-core`.
- Remind the user the operator `--integrate <mode>` flag still wins at run time.

#### E1c — Cron schedule change (conditional)

**Skip if the user did not mention schedule / cron / cadence / nightly / etc.** Otherwise, branch on the current state from E0:

- **none → scheduled** — run the same questions as N5c (spec, userMessage, verbosity) and add the `.cron(...)` call. Daemon wiring check from 1g applies — if unwired, surface the one-time bundle-wiring task.
- **scheduled → none** — remove the `.cron(...)` call. Note: this does NOT delete the agent or affect manual invocation; it just stops the daemon from arming a timer for it.
- **scheduled → scheduled (revise)** — show the current spec/userMessage/verbosity, ask which to change, rewrite the call. Re-validate the spec (5 fields).

`AgentBuilder.cron()` throws if called twice — never produce an agent.ts with two `.cron(...)` calls.

#### E2 — Prompt content

Operate on whichever source the agent uses (from E0):

- **Skill source** — show the existing `<skills-dir>/<slug>/SKILL.md` (frontmatter + body). Draft a revised version honoring whatever the user said they wanted to change. Preserve frontmatter unless the description changed (in which case update `description:` and mirror the change to the AGENTS.md row). Present in the same one-shot format as N6.
- **Legacy md source** — show the existing `<agents-dir>/<slug>/prompts/<slug>.md`. Draft revisions in place. Do NOT auto-promote to a skill; if the user wants to migrate, they ask explicitly.

If the user only wanted an archetype change (no prompt edit), this fork is a no-op — confirm with the user and skip.

The style-guideline rules from N6 apply identically when revising. Do not lengthen the body beyond its current size unless the user explicitly asks. Frontmatter stays terse — `description:` is one sentence.

#### E3 — Verify

Same as N7. Write the changes, run the discovered gate commands locally, surface failures.

### 5. Output (after N7 / E3 confirms)

All paths come from discovery, not hardcoded.

#### Create-mode files

**0. (Conditional — only if `fresh_consumer = true` from 1i.) Bundle scaffold from N0** — write these BEFORE any agent or skill files:

- **`<bundle-dir>/index.ts`** — the bundle template from N0, including any detected sibling munchkins package imports. Default `<bundle-dir>` is `<repo-root>/munchkins/`.
- **`package.json` `scripts.munchkins`** — add or update to `"bun <bundle-dir>/index.ts"`.
- **Stdout note**: `Bundle scaffolded at <bundle-dir>/. Run "bun run munchkins skills install" once before authoring more agents.`

If `fresh_consumer = false`, skip this entire item — the bundle is already wired and N0 was skipped.

1. **`<skills-dir>/<name>/SKILL.md`** — content from N6 (frontmatter + body). **Skip for Archetype 4** (composed agents have no own skill — their behavior is the concatenation of the children's skills). Write this file FIRST so the agent .ts has something to reference.

2. **`<agents-dir>/<name>/<name>-agent.ts`** — fully wired:
   - Imports from `@serranolabs.io/munchkins-core`: `AgentBuilder`, `Prompt`, `gitWorktreeSandbox`, `registry`. Add `integratePR` only if N5b chose pr.
   - Imports from the discovered shared presets module: `DEFAULT_CHECKS`, `defaultFixer`, `defaultSummaryWriter`, `GUIDELINES_PATH`, plus the archetype-appropriate `REFACTORER_PATH` / `TEST_WRITER_PATH`. Note: `getAgentPromptsDir` is no longer imported for Archetype 1–3 because the primary prompt comes from the skill, not from a per-agent `prompts/` directory.
   - **Archetype 1–3 shape:** `new AgentBuilder(name, description, gitWorktreeSandbox())`, chains the main step as `.add(new Prompt(GUIDELINES_PATH).withSkill("<name>").withUserMessageFromOption(...))` (the `withSkill('<name>')` helper resolves to `<skills-dir>/<name>/SKILL.md`, strips frontmatter, and uses the body as the system prompt). Auxiliary archetype steps reuse shared paths exactly as before: `.add(new Prompt(GUIDELINES_PATH).withSystem(REFACTORER_PATH).withUserMessage("..."))` for the refactor step, etc. Ends with `.addDeterministic([...DEFAULT_CHECKS], { loop: { maxIterations: 3, fixer: defaultFixer() } })` and `.summaryWriter(defaultSummaryWriter())`. Append `.integrate(integratePR())` only if N5b chose pr. Append `.cron("<spec>", { userMessage: "<canned>", verbosity: "<v>" })` only if N5c chose scheduled (omit `verbosity` when default).
   - **Archetype 4 (Composed) shape:** import the two child builders from their sibling agent files (relative paths within the agents dir), then:
     ```ts
     const builder = childA
       .thenRun(childB)
       .rename("<name>")
       .describe("<description>")
       .setSandbox(gitWorktreeSandbox())
       .summaryWriter(defaultSummaryWriter())
       .integrate(<integrateMerge() | integratePR() | nothing>)
       .cron("<spec>", { userMessage: "<canned>", verbosity: "<v>" }); // only if N5c
     ```
     `.thenRun()` strips sandbox/summaryWriter/integration — the four chained calls re-attach them. `.integrate()` with no arg = explicit merge; omit entirely if you want to fall through to the run-layer default. `.cron()` is preserved through `.thenRun()` only on the left-hand input — if either input had a cron, re-declare it explicitly on the composed builder.
   - Calls `registry.register(builder)`. Exports `{ builder }`.

3. **`<bundle-package>/src/index.ts`** — append a side-effect import line:
   ```ts
   import "../agents/<name>/<name>-agent.js";
   ```
   Insert in alphabetical order with the existing side-effect imports if they're already alphabetized; otherwise append at the bottom of the import block.

3a. **Symlink `.claude/skills/<name> → ../../packages/munchkins/skills/<name>`** — **source-repo mode only**. After the SKILL.md is written, create the relative symlink so Claude Code in this dev environment discovers it. Match the form already used by sibling skills (e.g., `readlink .claude/skills/launch-munchkin` returns `../../packages/munchkins/skills/launch-munchkin`). In **consumer-repo mode**, skip — the SKILL.md already lives at `.claude/skills/<name>/SKILL.md` directly, no symlink is needed or wanted.

4. **`AGENTS.md`** at host repo root (if present) — append a row to the `Running default agents` table:
   ```
   | <name> | <description string from AgentBuilder> |
   ```
   The description string in `AGENTS.md` MUST match the `description:` line in the skill frontmatter (and the `AgentBuilder` constructor's second arg). All three are the same sentence.

5. **Stdout note**: `Mirror this row in README.md if it has an agent table. The new skill is invokable in any Claude Code session inside this repo as /<name>.`

6. **Bundle daemon-wiring task** (only if N5c chose scheduled AND 1g found wiring **unwired** or **unknown**) — surface as a one-time task to the user, do not auto-edit:
   ```
   Add a daemon dispatch to <bundle-package>/src/index.ts before registry.cli():

       if (process.argv[2] === "daemon") {
         const { runDaemon } = await import("@serranolabs.io/munchkins-core");
         await runDaemon();
       } else {
         await registry.cli().parseAsync(process.argv);
       }

   Then start the daemon with: <pm> run munchkins daemon
   ```

#### Edit-mode files

Edit-mode never adds files, never changes the slug, never edits `<bundle-package>/src/index.ts` (the side-effect import already exists).

1. **`<agents-dir>/<slug>/<slug>-agent.ts`** — only if E1 changed the archetype OR E1b changed the integration strategy OR E1c changed the cron schedule. For E1: rewrite the `.add(...)` chain in place; leave imports, the `AgentBuilder(...)` constructor args, and the `.addDeterministic` / `.summaryWriter` tail as-is unless they need to change. For E1b: add/update/remove the `.integrate(...)` call and adjust the `integrateMerge` / `integratePR` import accordingly. For E1c: add/update/remove the `.cron(...)` call. If E1c moved from "none → scheduled" and 1g found daemon wiring unwired/unknown, also surface the bundle-wiring task from the create-mode list.
2. **Primary-prompt source** — only if E2 produced a revised body. Edit whichever source the agent currently uses (from E0):
   - **Skill source**: `<skills-dir>/<slug>/SKILL.md`. If E2 changed the description, also update the `description:` frontmatter line and mirror it to AGENTS.md (file 3 below) AND the `AgentBuilder` constructor's second arg / `.describe(...)` call in agent.ts (file 1).
   - **Legacy md source**: `<agents-dir>/<slug>/prompts/<slug>.md`. Edit in place. Do NOT auto-promote to a skill.
3. **`AGENTS.md`** — update the existing row if the description changed; otherwise leave it. If the agent uses a skill source, the AGENTS.md description, the skill frontmatter `description:`, and the `AgentBuilder` description must all match.

If the description changed, surface a one-line note: `Mirror this row update in README.md if it has an agent table.`

### 6. Hard rules

- **Never create `.sh` (or any shell-script) files.** All executable artifacts this skill produces — bundle entries, agent files, runners, smoke tests, scaffolds — are TypeScript (`.ts`) executed via Bun (e.g., `#!/usr/bin/env bun`). If a step would have produced a shell script (wrapper, install helper, smoke runner), produce a `.ts` file instead and invoke it through `bun <path>` or a `package.json` script. Shell-only commands (e.g., `ln -s ...` for the source-repo symlink) are run by the user/operator from the terminal, never written to a `.sh` file by this skill.
- **Never create `<agent>-agent.test.ts` files for agents.** Agent files are pure configuration (builder declaration, step composition, cron config) — asserting "name === 'foo'" or "step count === 7" against the registered singleton re-states the source. Exercise agents end-to-end via the scenario harness (`scenarios/*.ts`), where real failure modes surface. Framework code under `packages/munchkins-core/src/` is the exception: it has a consumer-facing API surface and keeps its colocated `.test.ts` files.
- Never hardcode munchkins-monorepo paths or agent names. Always derive from discovery.
- Cross-package imports go through `@serranolabs.io/*` package names. No relative paths across workspace boundaries.
- A new agent.ts MUST `registry.register(builder)` AND be side-effect-imported from the bundle's entry — both are required for the agent to appear in the CLI.
- Use the package manager detected in 1f. Do not switch package managers (no `npm install` in a Bun repo, no `pnpm` in a Bun repo).
- Never skip pre-grill discovery. Every fork depends on it.
- Do not draft a skill body that exceeds the existing skill bodies in length. Match their terseness. Frontmatter stays minimal — `name` and `description` only.
- **Skill is colon-namespaced; agent slug is bare.** The `AgentBuilder(...)` first arg and `<agents-dir>/<name>/<name>-agent.ts` use the bare kebab-case slug (e.g., `bug-fix`). The SKILL.md frontmatter `name` is `<namespace>:<slug>` (e.g., `munchkins:bug-fix`). The skill directory is `<skills-dir>/<namespace>-<slug>/` (e.g., `munchkins-bug-fix/`). The agent .ts calls `withSkill('<namespace>:<slug>')`. The CLI invocation is `bun run munchkins <slug>` (bare); the Claude Code invocation is `/<namespace>:<slug>` (namespaced). All five reference points must agree on the slug; the namespace is consistent within a single agent.
- **Description must match across three places** for skill-backed agents: SKILL.md `description:`, `AgentBuilder(...)` second arg (or `.describe(...)`), and the AGENTS.md row. Drift here breaks Claude Code skill discovery and the `--help` surface.
- **Do not author skills for framework-internal prompts.** `agent-guidelines.md`, `refactorer.md`, `test-writer.md`, `summary-writer.md`, `deterministic-fixer.md` are pipeline machinery, not standalone workflows. They live in `<agents-dir>/_shared/prompts/` as plain markdown referenced by shared presets — never as `SKILL.md` files. Exposing them as skills would pollute Claude Code's skill discovery with non-invokable scaffolding.
- **Runtime skill location is dictated by mode (1h).** Source-repo mode writes to `packages/munchkins/skills/<name>/SKILL.md` (template, ships in npm). Consumer-repo mode writes to `<repo-root>/.claude/skills/<name>/SKILL.md` (project-local, runtime source of truth). NEVER write to both in the same run; NEVER write a consumer-mode skill into `node_modules/`; NEVER write a source-repo template into `.claude/skills/` directly (use a symlink — see 1h).
- **The agent's `withSkill('<name>')` resolves project-local in consumer mode.** It reads ONLY from `<repo-root>/.claude/skills/<name>/SKILL.md`. There is NO fallback to `node_modules/@serranolabs.io/munchkins/skills/`. If the file is absent, the agent throws and the user must run `bun run munchkins install-skills` to scaffold defaults from package templates. This is intentional — silent fallbacks would hide drift between the consumer's committed skill state and the package's shipped templates.
- **Default skills are scaffolded once, then owned by the consumer.** `install-skills` copies templates from `node_modules/@serranolabs.io/munchkins/skills/` to `.claude/skills/` only if the target file does not already exist. It NEVER overwrites consumer edits. New defaults added in a later package version require the consumer to re-run `install-skills` (with a one-line `# munchkins: N new agents detected` warning emitted by every `bun run munchkins` invocation when drift is detected).
- **First-run consumer scaffold (N0) fires ONCE.** It runs only when 1i sets `fresh_consumer = true` (no agents directory AND no bundle entry AND consumer-repo mode). The scaffold writes `<bundle-dir>/index.ts` and `package.json` `scripts.munchkins`, then proceeds to N1. Subsequent `/new-munchkin` invocations on the same repo see the existing bundle, set `fresh_consumer = false`, and skip N0 entirely. Edit-mode (M0=B) NEVER fires N0 — by definition the consumer already has at least one agent, so a bundle exists.
- **Project-local agent paths in consumer-repo mode are derived from N0's `<bundle-dir>`.** After N0 (or after detecting an existing bundle in 1a/1g), `<agents-dir>` becomes `<bundle-dir>/agents/` and per-agent files live at `<bundle-dir>/agents/<name>/<name>-agent.ts`. The skill at `.claude/skills/<name>/SKILL.md` is always referenced via `withSkill('<name>')` regardless of where the agent .ts lives — the skill resolution is project-root-relative, not bundle-relative.
- **`.thenRun(other)` strips sandbox / summaryWriter / integration from the composed builder.** A composed agent.ts MUST re-attach all three explicitly via `.setSandbox(...)`, `.summaryWriter(...)`, and (optionally) `.integrate(...)` — otherwise the run has no worktree, no commit message, and no integration phase.
- **Integration strategy is optional.** Omitting `.integrate(...)` falls through to the run-layer default (`integrateMerge`). Only add `.integrate(integratePR())` when the agent should default to PR mode and the host repo has `gh` (or `glab`) available. The operator `--integrate <merge|pr>` flag overrides the author declaration regardless.
- **`.cron(...)` is dormant unless the host bundle dispatches to `runDaemon()`.** Adding a cron to an unwired bundle silently does nothing — always check 1g and surface the bundle-wiring task when needed. The skill never auto-edits the bundle entry's dispatch logic; only its side-effect import block.
- **Cron specs must leave room for one tick to finish before the next.** The daemon arms one timer per cronned builder with no overlap protection — concurrent runs of the same agent are undefined behavior. Refuse specs tighter than the agent could plausibly complete in (e.g., `* * * * *` for a multi-step agent).
- **`AgentBuilder.cron()` throws if called twice.** Edit-mode must rewrite the existing call in place, never append a second one.
- **Edit-mode never deletes an agent, never renames it, and never modifies `_shared/presets.ts`.** Those are out of scope for this skill — the user does them by hand. (Note: `.rename()` and `.describe()` exist as builder methods, but the skill only uses them inside the Composed archetype shape — never to rename an existing default agent.)

## What this skill does NOT do

- Does not create or modify shared prompt files (e.g., a new `REFACTORER_PATH` analog). The skill consumes existing shared prompts.
- Does not modify `_shared/presets.ts`. Adding new presets is out of scope.
- Does not migrate legacy `prompts/<name>.md` agents to skill-backed form. Edit-mode preserves the existing source. Migration happens by explicit user request, in a separate session.
- Does not promote framework-internal `_shared/prompts/*.md` files to skills. Those stay as plain markdown — they are not standalone workflows.
- Does not edit the bundle entry's dispatch logic (e.g., the `argv[2] === "daemon"` branch). When N5c/E1c lands a cron on a host with unwired daemon, the skill surfaces a one-time wiring task for the user to apply by hand.
- Does not start, stop, or smoke-test the daemon. After create-mode with cron, suggest:
  ```
  Start the daemon: <pm> run munchkins daemon
  ```
- Does not run the agent end-to-end. Verify only runs the lint/typecheck/test gate. After create-mode, suggest a smoke test:
  ```
  Try it: <pm> run munchkins <name> --user-message="<short test brief>"
  ```
- Does not update README.md. Surface the manual follow-up in the stdout note.
- Does not commit changes. The user reviews the diff and commits on their own.
- Does not delete or rename existing agents. Edit-mode is additive/revisionary only.
