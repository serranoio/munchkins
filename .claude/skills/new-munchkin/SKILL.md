---
name: new-munchkin
description: Author or revise a default agent inside a repo that consumes @serranolabs.io/munchkins. Use when the user wants to scaffold a NEW munchkin agent OR edit an existing one — signaled by phrases like "new munchkin", "add a default agent", "scaffold a munchkin agent", "design an agent for this repo", "edit the X munchkin", "tweak the X agent's prompt", "change X's archetype", "demote X to a single-step agent". Do NOT use to run an existing agent (use launch-munchkin) or to create a Claude Code skill (use skill-creator).
---

# New Munchkin

Walks the user through designing a new default agent — or revising an existing one — for a host repo that consumes `@serranolabs.io/munchkins`.

- **Create mode** outputs: a fully wired `agent.ts`, a drafted `prompts/<name>.md`, the side-effect import, and an updated AGENTS.md row.
- **Edit mode** outputs: an updated `agent.ts` (if archetype changes), an updated `prompts/<name>.md` (if prompt changes), and a refreshed AGENTS.md row (if description changes).

## Operating principles

1. **Concise > more prose.** Drafts are short. This skill md is short. Generated files mirror existing terse voice.
2. **Discover, never hardcode.** Paths, languages, gate commands, existing agents — all introspected from the host repo at runtime. Never assume `packages/munchkins/agents/`, never assume Bun/TS, never assume agent names like `bug-fix`/`feat-small`/`refactor` exist.
3. **Reuse over invention.** Generated files lean on the host repo's existing shared presets and shared prompt paths. The new or revised agent should look like a sibling of what's already there.

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

- **Slug** — the first arg to `new AgentBuilder(...)`.
- **Description** — the second arg to `new AgentBuilder(...)`.
- **Step composition** — the chain of `.add(...)` calls and which shared prompt paths they reuse (e.g., `REFACTORER_PATH`, `TEST_WRITER_PATH`).
- **CLI options** — any `withUserMessageFromOption(...)` schemas declared.
- **Prompt path** — the per-agent prompt md (typically `prompts/<name>.md` under the agent dir).

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
         │                     │ description tweak
agenda   │ N1–N7 (7 forks)     │ E0–E3 (4 forks)

**My pick:** infer from the user's trigger phrase. "edit", "tweak", "change", "demote", "promote", or naming an existing slug → B. Otherwise → A.

**Your call?**
```

Branch on the answer:
- **A → Create workflow** (§3)
- **B → Edit workflow** (§4)

### 3. Create workflow (M0=A)

Run forks N1–N7 in order. Wait for user reply between each.

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

If the host repo has agents that don't fit these three, append additional archetypes from observed compositions. Present in a tradeoff table; user picks by number.

#### N4 — Name

Propose a kebab-case slug derived from the purpose (short, verb-noun where possible: `release-cut`, `dep-bump`, `doc-update`).

Collision check: if the proposed slug matches any slug from 1b, propose alternatives. Validate kebab-case: `^[a-z][a-z0-9-]*[a-z0-9]$`.

Light tradeoff: show the proposed slug + 1–2 alternatives. User confirms or overrides.

#### N5 — CLI options (conditional — usually skipped)

**Skip by default.** The agent uses `--user-message` (path to markdown OR inline text), matching the existing pattern.

**Fire N5 only if** (a) the purpose statement implied a per-target flag, or (b) the user explicitly asks for custom flags.

When fired:
- Propose flag names + descriptions.
- Conflict-check each proposed flag against (i) every option declared by agents in 1b, (ii) framework-reserved names (`--cli`, `--user-message`, `--verbose`, `--thinking`, `--dry-run`).
- If any conflict, surface it and ask for a non-colliding name.

#### N6 — Prompt content (one-shot draft)

Draft the **full** `prompts/<name>.md` body in one shot. The user accepts with `y` or pastes edits.

Template:

```md
# <name> subagent

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
description: <description from AgentBuilder>
archetype: <inferred from step composition — "single-step" / "main + refactor" / "main + refactor + tests" / "custom: <description>">
CLI options: <list from withUserMessageFromOption schemas>
prompt md: <agents-dir>/<slug>/prompts/<slug>.md
   <inline preview, first ~10 lines if short, else file size>
```

This frames every downstream fork.

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

If `keep`, this fork is a no-op — proceed to E2.

If demote/promote/change: rewrite agent.ts's `.add(...)` chain. Preserve existing custom step (the one that uses `prompts/<slug>.md`). Add or remove shared steps (`REFACTORER_PATH`, `TEST_WRITER_PATH`) at their conventional positions (refactor between main and tests; tests last).

#### E2 — Prompt content

Show the existing `prompts/<slug>.md` body. Draft a revised version honoring whatever the user said they wanted to change (if anything). Present in the same one-shot format as N6 — user `y` to accept the draft, or paste an edited version.

If the user only wanted an archetype change (no prompt edit), this fork is a no-op — confirm with the user and skip.

The style-guideline rules from N6 apply identically when revising. Do not lengthen the prompt body beyond its current size unless the user explicitly asks.

#### E3 — Verify

Same as N7. Write the changes, run the discovered gate commands locally, surface failures.

### 5. Output (after N7 / E3 confirms)

All paths come from discovery, not hardcoded.

#### Create-mode files

1. **`<agents-dir>/<name>/<name>-agent.ts`** — fully wired:
   - Imports from `@serranolabs.io/munchkins-core`: `AgentBuilder`, `Prompt`, `gitWorktreeSandbox`, `registry`.
   - Imports from the discovered shared presets module: `DEFAULT_CHECKS`, `defaultFixer`, `defaultSummaryWriter`, `GUIDELINES_PATH`, `getAgentPromptsDir`, plus the archetype-appropriate `REFACTORER_PATH` / `TEST_WRITER_PATH`.
   - Constructs `new AgentBuilder(name, description, gitWorktreeSandbox())`, chains `.add(new Prompt(GUIDELINES_PATH).withSystem(...).withUserMessageFromOption(...))` per archetype step, ends with `.addDeterministic([...DEFAULT_CHECKS], { loop: { maxIterations: 3, fixer: defaultFixer() } })` and `.summaryWriter(defaultSummaryWriter())`.
   - Calls `registry.register(builder)`. Exports `{ builder }`.

2. **`<agents-dir>/<name>/prompts/<name>.md`** — content from N6.

3. **`<bundle-package>/src/index.ts`** — append a side-effect import line:
   ```ts
   import "../agents/<name>/<name>-agent.js";
   ```
   Insert in alphabetical order with the existing side-effect imports if they're already alphabetized; otherwise append at the bottom of the import block.

4. **`AGENTS.md`** at host repo root (if present) — append a row to the `Running default agents` table:
   ```
   | <name> | <description string from AgentBuilder> |
   ```

5. **Stdout note**: `Mirror this row in README.md if it has an agent table.`

#### Edit-mode files

Edit-mode never adds files, never changes the slug, never edits `<bundle-package>/src/index.ts` (the side-effect import already exists).

1. **`<agents-dir>/<slug>/<slug>-agent.ts`** — only if E1 changed the archetype. Rewrite the `.add(...)` chain in place; leave imports, the `AgentBuilder(...)` constructor args, and the `.addDeterministic` / `.summaryWriter` tail as-is unless they need to change.
2. **`<agents-dir>/<slug>/prompts/<slug>.md`** — only if E2 produced a revised prompt.
3. **`AGENTS.md`** — update the existing row if the description changed; otherwise leave it.

If the description changed, surface a one-line note: `Mirror this row update in README.md if it has an agent table.`

### 6. Hard rules

- Never hardcode munchkins-monorepo paths or agent names. Always derive from discovery.
- Cross-package imports go through `@serranolabs.io/*` package names. No relative paths across workspace boundaries.
- A new agent.ts MUST `registry.register(builder)` AND be side-effect-imported from the bundle's entry — both are required for the agent to appear in the CLI.
- Use the package manager detected in 1f. Do not switch package managers (no `npm install` in a Bun repo, no `pnpm` in a Bun repo).
- Never skip pre-grill discovery. Every fork depends on it.
- Do not draft a prompt body that exceeds the existing prompt md files in length. Match their terseness.
- **Edit-mode never deletes an agent, never renames it, and never modifies `_shared/presets.ts`.** Those are out of scope for this skill — the user does them by hand.

## What this skill does NOT do

- Does not create or modify shared prompt files (e.g., a new `REFACTORER_PATH` analog). The skill consumes existing shared prompts.
- Does not modify `_shared/presets.ts`. Adding new presets is out of scope.
- Does not run the agent end-to-end. Verify only runs the lint/typecheck/test gate. After create-mode, suggest a smoke test:
  ```
  Try it: <pm> run munchkins <name> --user-message="<short test brief>"
  ```
- Does not update README.md. Surface the manual follow-up in the stdout note.
- Does not commit changes. The user reviews the diff and commits on their own.
- Does not delete or rename existing agents. Edit-mode is additive/revisionary only.
