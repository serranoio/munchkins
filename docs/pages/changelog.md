# Changelog

Autonomously-generated entries from agent runs. Most recent first.

---

## feat(integrate): tolerate dirty repoRoot on ff-merge via snapshot commit (7fa9c95)
**2026-05-19 15:40 PDT · feat-small · 1640.6s · $12.4510**

**Goal:** Make the agent's isolated branch always land on `main` even when the operator's `repoRoot` working tree is dirty, preserving pre-existing dirty work as a recoverable snapshot commit.

**Outcome:** `integrateBranch` now runs a pre-flight check (`snapshotDirtyRepoRoot`) that stages everything (`git add -A`) and commits it on `main` as `munchkins: pre-merge snapshot of dirty repoRoot @ <unix-ms>` under a forced `munchkins <munchkins@local>` identity when the working tree is non-empty. The rebase invocation in `rebaseAndResolve` now uses `git rebase -X theirs main`, so the agent's commits win every content conflict against the snapshot, then the existing ff-merge path succeeds unchanged. A parameterized scenario harness at `scenarios/dirty-main-e2e.ts` exercises five dirty-tree variants end-to-end, and `integrate.test.ts` pins the same matrix at the unit level.

**How to test manually:**

1. From the repo root, run `bun run scenario` and confirm `dirty-main-e2e` is in the script output and exits 0. The harness covers D1–D5 in-process; expect a single `pass` line for `dirty-main-e2e`.
2. Run only the unit matrix: `bun test packages/munchkins-core/src/integrate.test.ts`. Look for the `integrateBranch dirty-repoRoot matrix` describe block — D1 through D5 should all pass, plus the existing single/two-file conflict tests now resolving without a fixer.
3. Real-agent smoke test of the clean-tree regression path: in a clean checkout of this repo, run `bun run munchkins bug-fix --userMessage="trivial: append a blank line to docs/pages/index.mdx"` and confirm the agent merges to `main` with no snapshot commit. Verify with `git log --grep="munchkins: pre-merge snapshot" main` — should return empty.
4. Real-agent smoke test of the dirty-tree path with no overlap: from a clean main, run `echo 'dirty' >> README.md` (do NOT stage), then `bun run munchkins bug-fix --userMessage="trivial: add a comment to docs/pages/index.mdx"`. Expect agent success, then `git log --grep="munchkins: pre-merge snapshot" main` returns one commit. Recover the dirty README via `git show <sha>:README.md` and confirm it ends with the `dirty` line.
5. Real-agent smoke test of the overlap path: from a clean main, stage a conflicting edit to a file you know the agent will touch (e.g. `echo 'export const x = 99' > some-file.ts && git add some-file.ts`) then run the same agent. Expect agent success; `cat some-file.ts` shows the agent's version (not `99`); `git show <snapshot-sha>:some-file.ts` shows `export const x = 99`.
6. Run `git log --author=munchkins main` after step 4 or 5 — the snapshot commit should appear with author `munchkins <munchkins@local>`, confirming it is filterable and doesn't impersonate the operator.

**Files changed:**

- AGENTS.md
- docs/pages/internal/scenario-testing-strategy.md
- package.json
- packages/munchkins-core/src/integrate.ts
- packages/munchkins-core/src/integrate.test.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- scenarios/dirty-main-e2e.ts

---
## feat(core): preserve worktree on agent failure for resume (0c1d9cc)
**2026-05-14 18:11 PDT · feat-small · 1231.9s · $12.2061**

**Goal:** When a Claude subprocess exits non-zero mid-run, preserve the worktree on disk and surface the run via `munchkins resume --list` so the operator can recover with `bun run munchkins resume <runId>`.

**Outcome:** Replaced the `failed` phase with `interrupted` in `RunPhase`, gated sandbox teardown so it only runs on success, and persisted `phase: "interrupted"` eagerly at every spawnClaude-bearing failure site. `listResumableRuns` no longer filters `failed` (forward-compat for legacy state files) and now surfaces interrupted runs. A new end-to-end scenario `resume-after-claude-exit-e2e` drives the bug-fix agent through a phase-1 in-process failure at step 2, then resumes via a fake-claude shim subprocess and asserts all 17 acceptance invariants.

**How to test manually:**

1. From the repo root, run the new scenario in isolation:
   ```
   bun run scenarios/resume-after-claude-exit-e2e.ts
   ```
   Expect `result: pass` and exit code 0. The harness internally exercises phase 1 (in-process mock fails at step 2 with the "usage cap" fixture) and phase 2 (subprocess `bun .../munchkins resume <runId>` driven by the fake-claude shim on PATH).
2. Run the full scenario gate to confirm the existing scenarios still pass alongside the new one:
   ```
   bun run scenario
   ```
   Expect all three scenarios (`scenarios/index.ts`, `scenarios/composition.ts`, `scenarios/resume-after-claude-exit-e2e.ts`) to pass.
3. Run the unit suite to confirm `run-state` filter changes and forward-compat are covered:
   ```
   bun test packages/munchkins-core/src/resume/run-state.test.ts
   ```
   Expect green; the new cases assert `interrupted` is included, `done` is excluded, and legacy `failed` state files are surfaced rather than purged.
4. Out-of-band manual check (failure-preservation invariant): preserve a failing run's artifacts and inspect them by hand:
   ```
   bun run scenarios/resume-after-claude-exit-e2e.ts --preserve
   ls .scenario-artifacts/resume-after-claude-exit-e2e-*/
   cat .scenario-artifacts/resume-after-claude-exit-e2e-*/*/state.json
   ```
   On a pass run, you'll see `result.json` in the artifact dir; on a failure run, inspect `state.json` to confirm `phase: "interrupted"`, `failureReason` set, and the step statuses (`completed`, `in-progress`). This also confirms the audit guard (no real `claude` spawns were attempted — the harness records `claudeAttempts` and fails if any are seen).
5. Edge case — legacy state file forward-compat: write a state.json containing `"phase": "failed"` into a fresh run-log dir under `MUNCHKINS_RUN_LOG_DIR`, then run `bun run munchkins resume --list` and confirm the legacy run appears (operators don't lose recovery options across the rename).

**Files changed:**

- package.json
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/resume/run-state.ts
- packages/munchkins-core/src/resume/run-state.test.ts
- scenarios/lib/fake-claude-bin/claude
- scenarios/lib/mock-spawn-claude.ts
- scenarios/fixtures/resume-after-claude-exit-e2e/seed-repo/bug.md
- scenarios/fixtures/resume-after-claude-exit-e2e/seed-repo/package.json
- scenarios/fixtures/resume-after-claude-exit-e2e/seed-repo/src/math.ts
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase1/01-bug-fix-success.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase1/02-refactorer-usage-cap.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase2/01-refactorer-retry.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase2/02-summary-writer.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase2/03-integration-fixer.json
- scenarios/resume-after-claude-exit-e2e.ts

---

## refactor(registry): self-register daemon/resume/status/skills as commander commands (215a7de)
**2026-05-14 17:17 PDT · refactor · 398.6s · $2.3238**

**Goal:** Stop the hardcoded `if/else` dispatch for `daemon`, `resume`, `status`, and `skills install` in `packages/munchkins/src/index.ts` and let the registry expose every system command in `munchkins --help` alongside the agents.

**Outcome:** Added `AgentRegistry.registerCommand({ name, description, configure })` plus a parallel `commands` map; `cli()` now appends a commander subcommand per registered command without leaking agent-only flags (`--dry-run`, `--thinking`, `--verbose`, `--cli`, `--integrate`) onto them. Each core subsystem ships a dedicated `command.ts` (`packages/munchkins-core/src/{resume,status,scheduler}/command.ts`) that wraps the existing `runResume` / `runStatus` / `runDaemon` in a commander `action`, and the CLI package adds `packages/munchkins/src/register-skills-command.ts` for the `skills install` subcommand (kept in-package because it depends on `PACKAGE_ROOT`). All four are wired at module-load: core's `index.ts` calls the three `register*Command(registry)` helpers as a side effect, so any consumer of `@serranolabs.io/munchkins-core` gets them for free, and the CLI's `index.ts` calls `registerSkillsCommand(registry)` once at the top before `registry.cli().parseAsync(argv)`. The cmux delegation block and `--no-cmux` argv filter are preserved verbatim.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/index.ts | 79 | 88 | +9 |
| packages/munchkins-core/src/registry/index.ts | 1 | 1 | 0 |
| packages/munchkins-core/src/registry/registry.test.ts | 144 | 210 | +66 |
| packages/munchkins-core/src/registry/registry.ts | 100 | 118 | +18 |
| packages/munchkins-core/src/resume/command.ts | 0 | 22 | +22 |
| packages/munchkins-core/src/scheduler/command.ts | 0 | 14 | +14 |
| packages/munchkins-core/src/status/command.ts | 0 | 16 | +16 |
| packages/munchkins/src/index.ts | 42 | 29 | −13 |
| packages/munchkins/src/register-skills-command.ts | 0 | 19 | +19 |

**Total:** 366 → 517 (Δ +151)

The net line growth reflects four new dedicated command modules + extended test coverage. The extracted abstraction is `AgentRegistry.registerCommand()`: system commands now share one registration mechanism instead of four hand-rolled `if/else` branches in the CLI entrypoint, and the agent flag block stays scoped to `AgentBuilder` subcommands only.

**Files changed:**
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/registry/index.ts
- packages/munchkins-core/src/registry/registry.test.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/resume/command.ts
- packages/munchkins-core/src/scheduler/command.ts
- packages/munchkins-core/src/status/command.ts
- packages/munchkins/src/index.ts
- packages/munchkins/src/register-skills-command.ts

**Recovery note:** The originating refactor agent run (`.munchkins/runs/self-register-system-commands-2c7cdac2`) hit a Claude usage cap immediately after producing the diff — its agent step exited 1 with the rate-limit string as its response, so the deterministic loop skipped the summary writer phase even though the integration commit had already landed via tool-call. This entry was hand-written from the diff to close out the run.

---

## feat(munchkins): launch agent runs inside cmux workspace when available (86ddc5a)
**2026-05-10 19:35 PDT · feat-small · 604.6s · $4.0926**

**Goal:** When `cmux` is on PATH, `bun run munchkins <agent> ...` should re-launch the same invocation inside a fresh `cmux new-workspace` and exit immediately; otherwise behavior is unchanged.

**Outcome:** Added `packages/munchkins/src/cmux-launcher.ts` exporting two pure helpers (`shouldDelegateToCmux`, `buildCmuxCommand`) plus a Bun-test suite covering delegation gating and POSIX-safe command construction. Wired the pre-check into `packages/munchkins/src/index.ts` ahead of the existing registry dispatch, strips `--no-cmux` from argv before commander sees it, and extended the scenario harness audit guard to also reject real `cmux` invocations.

**How to test manually:**

1. From the repo root run `bun run lint && bun run typecheck && bun test packages/munchkins/src` — all three should pass; the new `cmux-launcher.test.ts` suite must be green.
2. Run `bun run scenario` — should pass; the audit guard now also bans `cmux` invocations, but no scenario invokes one so there is no regression.
3. With `cmux` NOT on PATH (verify via `which cmux` → empty), run `bun run munchkins bug-fix --user-message=./scratch/example.md` (create a tiny scratch file first). It should execute inline exactly as before — same stdout, same worktree behavior.
4. With `cmux` installed and the cmux app running, run the same `bun run munchkins bug-fix --user-message=./scratch/example.md`. Expect a single stdout line of the form `Launching bug-fix in cmux workspace: bug-fix-<timestamp>` and the outer shell to return promptly. Open the cmux app and confirm a new workspace named `bug-fix-<timestamp>` exists with the agent running inside it.
5. Opt-out via env: with cmux installed, run `MUNCHKINS_NO_CMUX=1 bun run munchkins bug-fix --user-message=./scratch/example.md`. It should run inline (no `Launching ...` line, no new workspace).
6. Opt-out via flag: with cmux installed, run `bun run munchkins bug-fix --user-message=./scratch/example.md --no-cmux`. It should run inline, and commander must NOT error on the unknown flag (the flag is stripped before parsing). Also verify `bun run munchkins bug-fix --help` does not list `--no-cmux`.
7. Meta/help paths stay inline with cmux installed — verify each prints normally without opening a workspace: `bun run munchkins --help`, `bun run munchkins`, `bun run munchkins daemon` (cancel with Ctrl-C), `bun run munchkins resume`, `bun run munchkins status`, `bun run munchkins skills install`, `bun run munchkins bug-fix --dry-run`, `bun run munchkins bug-fix --help`.
8. Edge case for shell escaping: with cmux installed, run `bun run munchkins bug-fix --user-message="can't stop"` and confirm the workspace launches successfully (the single quote in the value is POSIX-escaped via `'\''` inside the `--command` payload, covered by `cmux-launcher.test.ts` as well).

**Files changed:**

- packages/munchkins/package.json
- packages/munchkins/src/cmux-launcher.ts
- packages/munchkins/src/cmux-launcher.test.ts
- packages/munchkins/src/index.ts
- scenarios/lib/mock-spawn-claude.ts

---
## feat(munchkins-core): add Prompt.withSkill() helper (07441da)
**2026-05-10 19:34 PDT · feat-small · 385.0s · $2.3356**

**Goal:** Add a `Prompt.withSkill(name)` helper that reads `<repoRoot>/.claude/skills/<name>/SKILL.md`, strips YAML frontmatter, and contributes the body to the system prompt — same slot as `withSystem(path)`.

**Outcome:** Refactored `Prompt`'s internal `systemPaths: string[]` into a tagged `systemSources` array supporting both `path` and `skill` source kinds. `withSystem(path)` semantics are unchanged; the new `withSkill(name)` queues a skill source that resolves to `.claude/skills/<name>/SKILL.md` at `resolve()` time, with a textual frontmatter strip (including one trailing blank line). Missing-skill and malformed-frontmatter errors carry actionable messages pointing at `bun run munchkins install-skills` and the offending path. Eight test cases in the new `prompt.test.ts` cover stripping, chaining, errors, composition with `withSystem`, and preservation of pre-change `withSystem` behavior.

**How to test manually:**

1. From the repo root, run the new test file directly: `bun test packages/munchkins-core/src/builder/prompt.test.ts` — expect all 8 cases to pass.
2. Run the broader gate: `bun run lint && bun run typecheck && bun run test` — expect green; existing tests must still pass since `withSystem(path)` behavior is preserved.
3. Verify the skill happy path against a real on-disk file. Create a fixture and a one-liner script:
   ```
   mkdir -p /tmp/wskill-demo/.claude/skills/demo
   printf -- '---\nname: demo\ndescription: x\n---\n\n# Demo body\n' > /tmp/wskill-demo/.claude/skills/demo/SKILL.md
   bun -e 'import {Prompt} from "./packages/munchkins-core/src/builder/prompt.ts"; console.log(JSON.stringify(new Prompt().withSkill("demo").resolve("/tmp/wskill-demo")))'
   ```
   Expected: `systemPrompt` equals `"# Demo body\n"` (no frontmatter, no leading blank line).
4. Edge: missing skill. Run the same one-liner but with `withSkill("missing")` — expect a thrown error whose message contains `Skill 'missing' not found` and `install-skills`.
5. Edge: malformed frontmatter. Overwrite the file with `printf -- '---\nname: demo\nno close here' > /tmp/wskill-demo/.claude/skills/demo/SKILL.md` and re-run the one-liner — expect an error containing `malformed frontmatter (no closing '---' delimiter)` and the absolute path to the file.
6. Edge: composition order. Create `/tmp/wskill-demo/a.md` (`AAA`) and `/tmp/wskill-demo/b.md` (`BBB`), then chain `new Prompt().withSystem("/tmp/wskill-demo/a.md").withSkill("demo").withSystem("/tmp/wskill-demo/b.md").resolve("/tmp/wskill-demo")` — expect `systemPrompt` to be `AAA\n\n# Demo body\n\n\nBBB` (sources joined with `\n\n` in call order).
7. Sanity: confirm existing agents still work without changes — `bun run scenario` should pass, exercising `withSystem(path)` callers in `bugfix-agent.ts`, `refactor-agent.ts`, `feat-small-agent.ts`, and `bugfix-then-refactor-agent.ts`.

**Files changed:**

- packages/munchkins-core/src/builder/prompt.ts
- packages/munchkins-core/src/builder/prompt.test.ts

---
## feat(munchkins): add SKILL.md discovery surface for default agents (bd12fe3)
**2026-05-10 19:20 PDT · feat-small · 265.9s · $2.0450**

**Goal:** Add Claude Code `SKILL.md` files for the three default munchkins agents (`bug-fix`, `refactor`, `feat-small`) and symlink them into `.claude/skills/` so Claude Code discovers them as `/<name>`.

**Outcome:** Created three new `SKILL.md` files under `packages/munchkins/skills/<name>/` with YAML frontmatter (`name`, `description`) followed by the body copied byte-for-byte from each agent's source prompt md. Added three relative symlinks under `.claude/skills/` pointing at the corresponding skill directories. No agent `.ts` files were modified — content is duplicated with `agents/<name>/prompts/<name>.md` for this MVP; the later migration will collapse the duplication.

**How to test manually:**

1. From the repo root, confirm the three new SKILL.md files exist:
   ```sh
   ls packages/munchkins/skills/bug-fix/SKILL.md packages/munchkins/skills/refactor/SKILL.md packages/munchkins/skills/feat-small/SKILL.md
   ```
   Expected: all three paths print with no error.
2. Verify the frontmatter is well-formed and only contains `name` and `description`:
   ```sh
   head -5 packages/munchkins/skills/bug-fix/SKILL.md
   head -5 packages/munchkins/skills/refactor/SKILL.md
   head -5 packages/munchkins/skills/feat-small/SKILL.md
   ```
   Expected: each starts with `---`, has `name: <slug>` matching the directory, `description: ...` (one sentence), and closes with `---`.
3. Verify the body of each SKILL.md is byte-identical to the source prompt md (skipping the 4-line frontmatter + blank line):
   ```sh
   diff <(tail -n +6 packages/munchkins/skills/bug-fix/SKILL.md) packages/munchkins/agents/bugfix/prompts/bug-fix.md
   diff <(tail -n +6 packages/munchkins/skills/refactor/SKILL.md) packages/munchkins/agents/refactor/prompts/refactor.md
   diff <(tail -n +6 packages/munchkins/skills/feat-small/SKILL.md) packages/munchkins/agents/feat-small/prompts/feat-small.md
   ```
   Expected: all three diffs produce no output.
4. Verify each symlink resolves to the expected relative target:
   ```sh
   readlink .claude/skills/bug-fix
   readlink .claude/skills/refactor
   readlink .claude/skills/feat-small
   ```
   Expected: each prints `../../packages/munchkins/skills/<name>`.
5. Verify the existing agents still register and run:
   ```sh
   bun run munchkins --help
   ```
   Expected: usage lists `bug-fix`, `refactor`, and `feat-small` subcommands (no regression).
6. Verify the source prompt files were not modified by the change:
   ```sh
   git diff HEAD~1 -- packages/munchkins/agents/bugfix/prompts/bug-fix.md packages/munchkins/agents/refactor/prompts/refactor.md packages/munchkins/agents/feat-small/prompts/feat-small.md
   ```
   Expected: no output (files unchanged in this commit).
7. Out-of-band Claude Code discovery check: open this repo in Claude Code and confirm that typing `/bug-fix`, `/refactor`, and `/feat-small` each surface the new skills with their full descriptions (matches the strings in `packages/munchkins/skills/<name>/SKILL.md`).

**Files changed:**

- packages/munchkins/skills/bug-fix/SKILL.md
- packages/munchkins/skills/refactor/SKILL.md
- packages/munchkins/skills/feat-small/SKILL.md
- .claude/skills/bug-fix (symlink)
- .claude/skills/refactor (symlink)
- .claude/skills/feat-small (symlink)

---
## feat(docs): re-orient onboarding around the new-munchkin skill (deb5605)
**2026-05-10 14:10 PDT · feat-small · 458.8s · $3.2744**

**Goal:** Re-orient the docs onboarding so the `new-munchkin` skill is the destination, with the bug-fix run demoted to a proof-of-life smoke test.

**Outcome:** Restructured `docs/pages/getting-started.md` into six sections (Prerequisites, Install, Proof of life, Scaffold your first agent, Next steps), added a fifth Claude Code prerequisite, surfaced `bun run munchkins skills install`, and compressed the artifact tree and failure recovery to one-liners. Updated `docs/pages/index.mdx` to drop the working-guide line, split the CTA row into Defaults vs. Build-your-own, and rewrite the Get-started gloss. Reordered `docs/pages/agents/custom.md` so the `new-munchkin` skill section leads (now 3 paragraphs covering trigger phrases, repo introspection, and create-mode outputs) and the manual path follows. Reordered `docs/pages/agents/_meta.json` so `custom` is first.

**How to test manually:**

1. From the repo root, run `bun run docs:dev` and open the docs site in a browser.
2. Land on `/` and confirm the lede now reads "The default agents are working examples…"; verify the CTA row shows three lines: `Get started`, `Defaults (reference): …`, and `Build your own: /new-munchkin skill · AgentBuilder API`. The headline and proof-tail should be unchanged.
3. Click `Get started`. Confirm the page has six top-level `##` headings in this exact order: Prerequisites, Install, Proof of life: run the bug-fix agent, Scaffold your first agent for this repo, Next steps. (Plus the `# Getting started` title.) The old "Where the artifacts go" tree and "If it fails" subsection should be gone.
4. In Prerequisites, confirm there are five items and the fifth names Claude Code as optional.
5. In Install, confirm `"munchkins": "munchkins"` is the only script line shown, the `bunx` alternative is mentioned in one sentence, and `bun run munchkins skills install` appears exactly once.
6. In the new "Scaffold your first agent" section, confirm `/new-munchkin` (with the slash) is shown in a fenced block and the three create-mode bullets are present.
7. Click into Agents from the sidebar. Confirm the order is `Build your own`, `Bug fix`, `Small feature`, `Refactor`.
8. Open `Build your own`. Confirm the first `##` after the title is "Scaffold with the `new-munchkin` skill" and contains 3 paragraphs; the second `##` is "What you're building" and starts with the bridging sentence about the manual path.
9. Edge case: grep the rendered docs for the deleted line `This site is a working guide to the framework` — it should return zero hits. Also grep `getting-started.md` to confirm `/new-munchkin` appears at least once and `bun run munchkins skills install` appears exactly once.
10. Run `bun run munchkins skills install --dest /tmp/munchkins-skills-test` and confirm the bundled skills land at the override path — this validates that the new Install step works as documented.

**Files changed:**

- docs/pages/getting-started.md
- docs/pages/index.mdx
- docs/pages/agents/custom.md
- docs/pages/agents/_meta.json

---
## docs(pages): add user-facing agent guide organized by agent (a01c8fb)
**2026-05-10 13:31 PDT · feat-small · 445.7s · $7.0202**

**Goal:** Replace the thin Rspress site with a full user-facing guide where each default agent has its own self-contained page, plus getting-started and custom-agent pages.

**Outcome:** Added `getting-started.md`, `agents/{bug-fix,feat-small,refactor,custom}.md`, and `agents/_meta.json`; rewrote `index.mdx` as a real landing page; updated root `_meta.json` to surface the new sections. The three default-agent pages each follow the 14-section skeleton (substantive content, intentional repetition for self-containment); `custom.md` covers every public method on `AgentBuilder` and `Prompt`. Also bumped two `agent-builder.test.ts` integration tests to a 30s timeout so the real-git E2E cases don't graze the default 5s limit under parallel load.

**How to test manually:**

1. From the repo root, run `PUBLIC_DOCS=true bun run docs:build` and confirm it exits 0. Verify the four agent pages and `getting-started` are emitted under `docs/doc_build/` (or wherever Rspress writes output) and that `internal/**` is excluded.
2. Run `bun --cwd docs run dev` and open the site in a browser. Confirm the sidebar order: `Home`, `Getting started`, `Agents` (expandable to `Bug fix`, `Small feature`, `Refactor`, `Build your own`), `Changelog`. The `Internal` section should still render in dev mode.
3. From the home page, click **Get started** — expect to land on `/getting-started`. Click **Bug fix** — expect `/agents/bug-fix`. Each default-agent page should scroll through all 14 sections in order (What it does → Worked example).
4. On `/agents/bug-fix`, ctrl-F for `--user-message`, `--cli`, `--integrate`, `--dry-run`, `--thinking`, `--verbose` — all six must appear in the Flags table. Repeat on `feat-small.md` and `refactor.md`.
5. On `/agents/custom`, ctrl-F for each `AgentBuilder` method (`option`, `add`, `addDeterministic`, `summaryWriter`, `integrate`, `setSandbox`, `rename`, `describe`, `thenRun`, `cron`, `run`, `runFromState`) and each `Prompt` method (`withSystem`, `withUserMessage`, `withUserMessageFromOption`). All must be present. Confirm `launch-munchkin` and `new-munchkin` are both referenced.
6. Search across all four new pages for `MUNCHKINS_CLI`, `MUNCHKINS_RUN_LOG_DIR`, and `MUNCHKINS_CHANGELOG_PATH` — each env var should appear at least once across the set.
7. Confirm `bun run munchkins resume --list | --latest | <id>` syntax appears in each of the three default-agent pages, and `bun run munchkins daemon` + `.cron()` appear in all three default-agent pages and in `custom.md`. `bun run munchkins skills install [--dest <path>]` should appear in `custom.md`.
8. Run `bun run lint`, `bun run typecheck`, and `bun run scenario` from the repo root — all should pass. (The deterministic gate in CI does this automatically.)
9. Edge case: open `docs/pages/changelog.md` and `docs/pages/internal/**` in git — confirm they are unchanged by this commit (`git diff HEAD~1 -- docs/pages/changelog.md docs/pages/internal/`).
10. Edge case: run `bun test packages/munchkins-core/src/builder/agent-builder.test.ts` and confirm the two integration tests in `AgentBuilder.run integration dispatch end-to-end` pass without timeout warnings.

**Files changed:**

- docs/pages/_meta.json
- docs/pages/index.mdx
- docs/pages/getting-started.md
- docs/pages/agents/_meta.json
- docs/pages/agents/bug-fix.md
- docs/pages/agents/feat-small.md
- docs/pages/agents/refactor.md
- docs/pages/agents/custom.md

---

## fix(munchkins): make package bunx-executable via bin entry (b630027)
**2026-05-10 13:29 PDT · bug-fix · 377.0s · $3.1778**

**Goal:** Fix `bunx @serranolabs.io/munchkins skills install` failing with "could not determine executable to run for package" because the package declared no `bin` field.

**Outcome:** Added a `bin` entry mapping `munchkins` to `./src/index.ts` in `packages/munchkins/package.json`, bumped the version from `0.1.1` to `0.1.2`, and prepended a `#!/usr/bin/env bun` shebang to `packages/munchkins/src/index.ts` so the entrypoint is directly runnable. The existing `if (import.meta.main)` dispatch in `src/index.ts` remains the single source of truth — no wrapper file was introduced and no dispatch logic changed. Also extended the timeout on two integration-dispatch end-to-end tests in `agent-builder.test.ts` to 30s to accommodate the ~10 git subprocess invocations per run on slower/concurrent CI environments. Publishing was intentionally not performed; the user can run that as a separate manual step. Consider a follow-up to document `bunx @serranolabs.io/munchkins …` usage in the README.

**Files changed:**
- packages/munchkins/package.json
- packages/munchkins/src/index.ts
- packages/munchkins-core/src/builder/agent-builder.test.ts

---

## feat(agent-cli): wait for Claude rate-limit reset and retry once (c7e4fa8)
**2026-05-10 13:00 PDT · feat-small · 742.8s · $4.0512**

**Goal:** When the Claude CLI exits because the user's usage limit was hit, sleep until the reported reset time and retry the spawn exactly once instead of failing the whole pipeline.

**Outcome:** Switched the base `AgentCLI.runJsonStream` from `stderr: "inherit"` to `stderr: "pipe"` while forwarding bytes to `process.stderr` in real time, and added captured stderr to `SpawnResult`. Introduced file-local `isLimitHit`, `parseResetTimestamp`, and `sleepUntil` helpers in `agent-cli.ts`. `ClaudeCLI.spawn()` now inspects the result, sleeps until the parsed reset (unix-seconds or HH:MM, today/tomorrow), logs a single `⏳ Claude limit hit, waiting until <HH:MM:SS local>` line to stderr, and retries the same spawn exactly once. `CodexCLI.spawn` is untouched.

**How to test manually:**

1. From the repo root, run the new unit tests to exercise all branches (unix-seconds retry, HH:MM, parse failure, abort mid-wait, double-limit no-third-spawn, stderr-only detection, out-of-range HH:MM):
   ```
   bun test packages/munchkins-core/src/builder/agent-cli.test.ts
   ```
   Expect every test in the `ClaudeCLI rate-limit retry` describe block to pass in well under a second.
2. Verify the repo-wide gates the deterministic loop runs:
   ```
   bun run typecheck
   bun run lint
   bun run scenario
   ```
   All three should be green.
3. Out-of-band manual check that the unit tests don't cover — confirm stderr is still forwarded live (the change from `inherit` to `pipe` is the riskiest part). In a throwaway script, drive a Claude spawn that prints to stderr and watch it appear in your terminal in real time:
   ```
   bun -e "import { ClaudeCLI } from './packages/munchkins-core/src/builder/agent-cli.ts'; await new ClaudeCLI().spawn({ systemPrompt: '', userPrompt: 'say hi then exit', cwd: process.cwd() });"
   ```
   You should see Claude's stderr stream appear as it's produced (not buffered until exit). If you have a real rate-limited account handy, trigger a limit and confirm you see the single `⏳ Claude limit hit, waiting until …` line followed by exactly one retry after the reset.
4. Edge case — abort during wait. In a REPL, kick off a spawn with a fake limit message in stderr that points ~60s into the future via a stub of `runJsonStream`, then abort the controller after 50ms; `spawn()` should reject promptly with the abort reason and not fire a second spawn. (This is exactly what the `aborted abortSignal during the wait` test asserts; rerun that single test in watch mode if you want to poke at it: `bun test packages/munchkins-core/src/builder/agent-cli.test.ts -t "aborted abortSignal"`.)

**Files changed:**

- packages/munchkins-core/src/builder/agent-cli.ts
- packages/munchkins-core/src/builder/agent-cli.test.ts

---
## feat(munchkins-core): add resume subcommand for interrupted runs
**2026-05-09 20:11 PDT · feat-small · 1532.9s · $15.7377**

**Goal:** Add `bun run munchkins resume [runId]` so an interrupted run (rate limit, Ctrl-C, OOM) can pick up from the last completed step, including resuming the underlying Claude/Codex session.

**Outcome:** Each run now writes an incremental `state.json` to its `.munchkins/runs/<slug>-<uuid>/` directory tracking phase, per-step status, and captured CLI session ids. `SandboxFactory` was reshaped into an object with `create()` + `rehydrate()`; `gitWorktreeSandbox` implements `rehydrate()` against an existing worktree with hard-fail preconditions for missing worktree/branch and a logged warning for dirty/advanced state. `AgentBuilder` exposes `runFromState()` (called by both fresh runs and the new resume orchestrator); `ClaudeCLI`/`CodexCLI` capture `session_id` from their JSONL streams and emit `--resume <id>` (Claude) or `codex resume <id> exec` (Codex) with a continue message when given a `resumeSessionId`. A new `runResume(argv)` orchestrator wired into `packages/munchkins/src/index.ts` handles `--list`, `--latest`, full runId, and unique-slug resolution; `RunLog.resume(dir)` replays `events.jsonl` so token/cost totals survive across the resume boundary.

**How to test manually:**

1. From the repo root, build/install once: `bun install`.
2. Confirm the new subcommand surfaces with no resumable runs: `bun run munchkins resume --list` — should print `no resumable runs` and exit 0. Same with no args: `bun run munchkins resume`.
3. Kick off a real bug-fix run against a throwaway change so it produces a `state.json`: `bun run munchkins bug-fix --user-message="add a no-op comment to packages/munchkins-core/src/index.ts"`. Once you see the first agent step actually start (the banner prints `[step 1/N agent]`), interrupt with Ctrl-C.
4. Inspect the preserved run dir: `ls .munchkins/runs/` then `cat .munchkins/runs/<slug>-<uuid>/state.json` — verify `phase` is still `"steps"` (not `"done"` / `"failed"`), step 0 has `status: "in-progress"`, and (if Claude got far enough to emit its init event) `sessionId` is populated.
5. List resumables: `bun run munchkins resume --list` — should print a table row for that run with `runId`, `agent`, `slug`, `started-at`, `phase`, and `completed/total` step counts.
6. Resume by full id: `bun run munchkins resume <slug>-<uuid>`. Confirm in output that the worktree path is reused (no new `agent/...` branch is created), and that step 0 is re-attempted via `claude --resume <id>` (look for the continue message in verbose output by re-running with `--verbose`). When it finishes, `state.json.phase` should be `"done"`.
7. Slug resolution edge case — happy path: with one resumable, run `bun run munchkins resume <slug>` (no uuid). Should resolve and run.
8. Slug resolution edge case — ambiguous: leave two interrupted runs with the same slug, run `bun run munchkins resume <slug>` — should exit 1 and print both full runIds in the error.
9. `--latest`: with multiple resumables, run `bun run munchkins resume --latest` and confirm it picks the most recent by `startedAt`.
10. Rehydrate hard-fail: from another resumable run dir, `rm -rf` the worktree it points at, then `bun run munchkins resume <runId>` — should exit 1 with `Worktree at <path> no longer exists`. Likewise delete its branch (`git branch -D agent/...`) for the deleted-branch failure.
11. Session-not-found fallback: edit a `state.json`'s `steps[0].sessionId` to `"definitely-bogus-id"`, then resume — Claude returns a session-not-found error and the builder should log `[resume] session ... no longer available; restarting step with worktree-state hint.` and re-spawn fresh with a `git status` / `git diff --stat HEAD` preamble baked into the system prompt.
12. Token accounting: after a resumed run completes, open `.munchkins/runs/<slug>-<uuid>/summary.json` and confirm tokens-in/out and cost reflect both the original run's events AND the resumed CLI calls (i.e. greater than what a fresh run alone would have produced).
13. Regression check on the unchanged path: run a fresh `bun run munchkins bug-fix --user-message="..."` to completion and confirm it still works end-to-end with no prompts about resume, no extra args, and produces the same shape of summary as before.
14. Automated tests cover the unit-level behavior — `bun run test packages/munchkins-core/src/resume` and `bun run test packages/munchkins-core/src/sandbox/sandbox.test.ts` — but step 11 above (real session-not-found against the live `claude` CLI) is the one out-of-band check the tests don't perform.

**Files changed:**

- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/agent-builder.test.ts
- packages/munchkins-core/src/builder/agent-cli.ts
- packages/munchkins-core/src/builder/agent-cli.test.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/resume/index.ts
- packages/munchkins-core/src/resume/run-resume.ts
- packages/munchkins-core/src/resume/run-resume.test.ts
- packages/munchkins-core/src/resume/run-state.ts
- packages/munchkins-core/src/resume/run-state.test.ts
- packages/munchkins-core/src/resume/test-fixtures.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/run-log.test.ts
- packages/munchkins-core/src/sandbox/index.ts
- packages/munchkins-core/src/sandbox/sandbox.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- packages/munchkins/src/index.ts

---

## fix(feat-small): swap new-surface section for manual-test recipe
**2026-05-09 19:49 PDT · bug-fix · 261.2s · $1.6490**

**Goal:** Replace the feat-small summary writer's `New surface` catalog with a `How to test manually` section so changelog entries give operators a concrete smoke-test recipe.

**Outcome:** Rewrote `packages/munchkins/agents/feat-small/prompts/summary-writer.md`. Deleted the `What "new surface" means` section and its category bullets, retargeted the framing paragraph at giving operators a manual smoke-test recipe, swapped the template's `New surface` block (and the now-redundant `Lines added` line) for a required `How to test manually` block with guidance on covering happy path plus an edge case and a fallback string for non-runtime features, and kept the `Files changed` block. Output contract, JSON envelope, no-headings-in-body rule, and `feat(<scope>): <subject>` commit format are unchanged. Default and refactor summary writers were not touched.

**Files changed:**
- packages/munchkins/agents/feat-small/prompts/summary-writer.md

---
## fix(builder): tolerate duplicate JSON envelope from summary writer
**2026-05-09 19:17 PDT · bug-fix · 477.2s · $3.4697**

**Goal:** Fix the summary writer JSON parser so it survives the model emitting the envelope twice in one response — a production failure mode (run `agent-composition-integration-df872018`) where the greedy regex spans both objects and `JSON.parse` chokes on the gap.

**Outcome:** Replaced the regex-based extraction in `runSummaryWriter` with a string-aware balanced-brace forward scan extracted into a new `parseSummaryWriterJson` helper. The scan enumerates every top-level `{...}` object in the response, then iterates them last-to-first and returns the first one that parses and has both `commitMessage` and `markdown` as strings. Trailing ` ``` ` fence handling and existing type checks are preserved; backward-compatible for the single-envelope case. Added 12 unit tests covering the duplicate-emit regression, prose preambles, fenced output, braces inside string literals, escaped quotes, missing/wrong-typed fields, and a realistic fixture.

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/parse-summary-writer-json.ts
- packages/munchkins-core/src/builder/parse-summary-writer-json.test.ts

**Notes for future debuggers:** The brace scanner is intentionally string-aware (tracks `inString` + `isEscaped`) so a JSON string value like `"see {a, b, c}"` or `"escaped \"quote\""` doesn't desync the depth counter. If the scanner ever encounters an unbalanced `{`, it stops scanning rather than emitting a partial candidate. Failure reason distinguishes "no JSON object found" from "N candidate object(s) inspected" so harness logs point at the right diagnosis.

---
## feat(core): pluggable integration strategies + agent composition
**2026-05-09 16:00 PDT · feat-small · 1264.1s · $13.0129**

**Goal:** Add pluggable integration strategies (`integrateMerge` / `integratePR`) and `AgentBuilder` composition (`.thenRun()`), wiring operator > author > default precedence and moving integration out of sandbox teardown into the run layer.

**Outcome:** Introduced `IntegrationStrategy` with `integrateMerge` (delegates to existing `integrateBranch`) and `integratePR` (rebase + push + open PR via `gh`/`glab`, with auto provider detection). Added `.integrate()`, `.thenRun()`, `.setSandbox()`, `.rename()`, `.describe()` builder methods; `.thenRun()` returns a new builder with steps concatenated and sandbox/summaryWriter/integration stripped per the S3 contract. Run-layer dispatch enforces precedence and surfaces a clear error for unknown modes; `gitWorktreeSandbox.teardown` is now cleanup-only. Added `--integrate <mode>` CLI flag, an example `bugfix-then-refactor` agent, and a composition scenario.

**Note on this entry:** the run's summary writer emitted the JSON envelope twice and the harness's greedy regex parser failed to parse it, so this entry is hand-authored from the summary writer's first emitted block (verbatim). The agent's actual work — the diff, the tests, and the deterministic checks — completed cleanly before the parser tripped. A follow-up bug-fix to the harness regex will harden the parser against duplicate-emit hiccups.

**New surface:**

- Export: `integrateMerge()` (in `packages/munchkins-core/src/integrate.ts`)
- Export: `integratePR(opts?)` (in `packages/munchkins-core/src/integrate.ts`)
- Export: `detectProvider(repoRoot, remote)` (in `packages/munchkins-core/src/integrate.ts`)
- Export: `IntegrationStrategy`, `IntegrationContext`, `IntegrationResult`, `IntegratePROptions` types (in `packages/munchkins-core/src/integrate.ts`)
- Export: `AgentBuilder.integrate(strategy)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.thenRun(other)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.setSandbox(factory)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.rename(name)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.describe(description)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `RunLog.getAgentSummaryMarkdown()`, `RunLog.getAgentSummaryCommitMessage()` (in `packages/munchkins-core/src/run-log.ts`)
- Example agent: `bugfix-then-refactor` (in `packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts`)
- CLI flag: `--integrate <mode>` on every registered agent (registered in `packages/munchkins-core/src/registry/registry.ts`)
- Env var: `__MUNCHKINS_OPT_integrate`
- New scenario: `scenarios/composition.ts`
- Other: `PassOpts.prUrl` field on `RunLogger.pass()` surfaces the PR URL in quiet and verbose output (in `packages/munchkins-core/src/builder/run-logger.ts`)
- Removed: `IntegrateContext` export and `TeardownContext.integrate` field (sandbox teardown is now cleanup-only)

**Files changed:**

- package.json
- packages/munchkins-core/src/builder/agent-builder.test.ts (new)
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/run-logger.test.ts (new)
- packages/munchkins-core/src/builder/run-logger.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/integrate.test.ts
- packages/munchkins-core/src/integrate.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/run-log.test.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/sandbox/index.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- packages/munchkins-core/src/sandbox/sandbox.ts
- packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts (new)
- scenarios/composition.ts (new)

---

## feat(scheduler): add cron support for AgentBuilder + daemon subcommand
**2026-05-09 15:25 PDT · feat-small · 642.2s · $6.0585**

**Goal:** Add per-agent cron scheduling via a new `.cron()` builder method and a `bun run munchkins daemon` entrypoint that arms timers per cronned builder and fires `builder.run()` at each tick.

**Outcome:** `AgentBuilder` now carries an optional `CronConfig` set via `.cron(spec, { userMessage, verbosity })` and exposed via `getCron()`; calling `.cron()` twice throws naming the agent. A new `scheduler/daemon.ts` module collects cronned builders from a registry, renders a column-aligned startup table with ISO + humanized next-tick offsets via `cron-parser`, and arms one `setTimeout` per builder that resets per-tick env (`__MUNCHKINS_OPT_verbose` / `__MUNCHKINS_OPT_thinking` / `__MUNCHKINS_OPT_userMessage`) before each run, re-arming in `finally`. The `munchkins` entrypoint branches on `process.argv[2] === "daemon"` to invoke `runDaemon()` ahead of `registry.cli()`. No default agent is cronned; the API ships dormant.

**New surface:**

- Export: `AgentBuilder.prototype.cron(spec, opts)` (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.prototype.getCron()` (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: type `Verbosity` (in `packages/munchkins-core/src/builder/agent-builder.ts`, re-exported from `builder/index.ts` and `src/index.ts`)
- Export: interface `CronConfig` (in `packages/munchkins-core/src/builder/agent-builder.ts`, re-exported from `builder/index.ts` and `src/index.ts`)
- Export: `runDaemon(opts?)` (in `packages/munchkins-core/src/scheduler/daemon.ts`, re-exported from `scheduler/index.ts` and `src/index.ts`)
- Export: `applyTickEnv(cfg)` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- Export: `collectCronnedBuilders(registry)` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- Export: interface `CronnedBuilder` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- Export: interface `RunDaemonOptions` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- CLI flag: `daemon` subcommand on the `munchkins` entrypoint (registered in `packages/munchkins/src/index.ts` as a pre-`registry.cli()` argv branch)
- Env var: `__MUNCHKINS_OPT_userMessage` (set per tick by `applyTickEnv`)
- Env var: `__MUNCHKINS_OPT_verbose` (set per tick when verbosity is `"verbose"`)
- Env var: `__MUNCHKINS_OPT_thinking` (set per tick when verbosity is `"thinking"`)
- New file: `packages/munchkins-core/src/scheduler/daemon.ts`
- New file: `packages/munchkins-core/src/scheduler/index.ts`
- New file: `packages/munchkins-core/src/scheduler/daemon.test.ts`
- New package export path: `@serranolabs.io/munchkins-core/scheduler` (added in `packages/munchkins-core/package.json`)
- Other: `cron-parser@^5.5.0` added as a dependency of `@serranolabs.io/munchkins-core`

**Lines added:** +407 (across 8 files)

**Files changed:**
- bun.lock
- packages/munchkins-core/package.json
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/scheduler/daemon.ts
- packages/munchkins-core/src/scheduler/index.ts
- packages/munchkins-core/src/scheduler/daemon.test.ts
- packages/munchkins/src/index.ts

---

## docs(summary-writer): forbid markdown headings in changelog body
**2026-05-09 15:15 PDT · bug-fix · 321.1s · $2.0794**

**Goal:** Stop the default summary-writer prompt from producing `##` headings inside changelog entry bodies, which collide with the harness-emitted entry title and break the document hierarchy.

**Outcome:** Updated the Output contract section of `packages/munchkins/agents/_shared/prompts/summary-writer.md` to explicitly prohibit any Markdown headings (`#`, `##`, `###`, etc.) inside the `markdown` field. Promoted the bold inline labels (`**Goal:**`, `**Outcome:**`, `**Files changed:**`) from a suggested skeleton to a required body shape, and added a side-by-side correct/wrong example so the contrast is visual. The JSON output contract (`commitMessage` + `markdown` keys, no code fences) is unchanged, and the harness-side assembly in `RunLog.prependChangelogIn` was not touched. Per-agent summary-writer prompts under `feat-small` and `refactor` were left alone per the task constraints (they were out of scope unless they shared the defect).

**Files changed:**
- packages/munchkins/agents/_shared/prompts/summary-writer.md

Future changelog entries produced by agents using this default prompt should contain zero `#`-prefixed lines in the body while still carrying the bold inline labels for Goal / Outcome / Files changed.

---
## fix(munchkins-core): detect merge-fixer progress via working-tree content
**2026-05-09 15:04 PDT · bug-fix · 451.4s · $2.6168**

## Goal
Fix the merge-fixer harness in `integrate.ts` so it stops misclassifying every real conflict resolution as "no progress."

## Outcome
Replaced the index-based post-fixer progress check with a content-based check using `git diff --check`. The new logic detects leftover conflict markers in the working tree, bails out if the fixer wrote markers to files outside the conflict set, fails with a no-progress reason only when every conflicted file still has markers, and stages only files verified clean (per-file `git add`, never `git add -A`). Added a small `abortAndFail` helper to deduplicate the bail-out paths in `rebaseAndResolve`. Introduced `packages/munchkins-core/src/integrate.test.ts` with five real-`integrateBranch` tests covering the happy path, no-progress, partial-progress (regression test that proves the outer loop re-prompts the fixer), CLI failure, and the clean-rebase no-spawn case.

## Files changed
- `packages/munchkins-core/src/integrate.ts` — swap index-based stillConflicted check for `filesWithLeftoverMarkers` (new helper using `git diff --check`); add stray-file guard; switch staging to per-file `git add`; extract repeated `abortRebase` + return into a local `abortAndFail` helper.
- `packages/munchkins-core/src/integrate.test.ts` — new file. mkdtemp + `git init -b main` repos, `gitEnv()` helper with `TEST_GIT_IDENTITY`, `StubFixerCLI` with constructor-injected handler and `FailIfSpawnedCLI`, plus shared `setupSingleFileConflict` / `setupTwoFileConflict` setup helpers driving the five required scenarios.

## Notes for future readers
- The partial-progress test (#3) is the load-bearing regression: it asserts `cli.invocations === 2` and `fixerIters === 2`, which is only achievable if the harness correctly recognizes per-file forward progress and re-enters the fixer for the remaining unresolved file.
- `listConflictedFiles` is intentionally retained for the *initial* per-iteration enumeration before the fixer runs; only the post-fixer check moved to a content-based detector.

---
## refactor(agent-builder): extract RunLogger to centralize verbose/quiet formatting
**2026-05-09 14:25 PDT · refactor · 590.3s · $3.3619**

**Goal:** Extract every verbose/quiet branch site in `AgentBuilder.run()` (and its `runAgent` / `runDeterministic` / `runSummaryWriter` helpers) into a single `RunLogger` class so `run()` orchestrates and `RunLogger` formats — byte-identical output in both modes.

**Outcome:** Created `packages/munchkins-core/src/builder/run-logger.ts` housing the new `RunLogger` class plus the `C` color table, `banner()`, and `printInvocation()` helpers (moved out of `agent-builder.ts` so there's a single home for terminal formatting). `AgentBuilder` imports them back, drops the inline `if (verbose) … else …` blocks at all twelve call sites, and threads a single `RunLogger` instance into the helpers in place of the bare `verbose: boolean` parameter. `streamOutput` stays where it was — it's a separate concern (Claude streaming) — and the env reads at the top of `run()` are untouched.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/builder/agent-builder.ts | 642 | 525 | −117 |
| packages/munchkins-core/src/builder/run-logger.ts | 0 | 200 | +200 |
| packages/munchkins-core/src/index.ts | 46 | 46 | 0 |

**Total:** 688 → 771 (Δ +83)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/run-logger.ts
- packages/munchkins-core/src/index.ts

**Call sites that now share the extracted helpers:**
- `RunLogger.stepResultOk()` — called by both `runAgent` and `runSummaryWriter`, replacing the duplicated quiet-mode " ok (Xs, in→out)\n" line that previously existed inline in each.
- `RunLogger.starting()` / `stepBanner()` / `pass()` / `fail()` / `logDir()` / `integrationLine()` — collapse the six verbose-vs-quiet branch pairs in `AgentBuilder.run()` into single calls.
- `RunLogger.summaryWriterEmptyDiff()` / `summaryWriterStart()` — collapse the two branch pairs in `runSummaryWriter`.
- `RunLogger.agentStepStart()` — collapses the single branch pair in `runAgent`.
- `RunLogger.deterministicIterationHeader()` / `deterministicCommand()` / `deterministicCommandOutput()` / `deterministicQuietSummary()` / `fixerStart()` / `fixerResult()` — collapse the six branch pairs in `runDeterministic`.
- `banner()` and `printInvocation()` — now defined once in `run-logger.ts` and re-imported by `agent-builder.ts` instead of being module-local helpers.

---
## refactor(munchkins/agents): extract getAgentPromptsDir helper
**2026-05-09 14:12 PDT · refactor · 243.6s · $1.6386**

**Goal:** Eliminate the 4× duplicated `dirname(fileURLToPath(import.meta.url)) + join("prompts")` incantation across `bugfix-agent.ts`, `refactor-agent.ts`, `feat-small-agent.ts`, and `presets.ts` by adding a single `getAgentPromptsDir(importUrl)` helper to `presets.ts`.

**Outcome:** Added `getAgentPromptsDir(importUrl: string)` to `packages/munchkins/agents/_shared/presets.ts` and re-exported it. The shared `SHARED_PROMPTS` constant and all three agent files (`bugfix`, `feat-small`, `refactor`) now call the helper instead of recomputing `dirname(fileURLToPath(import.meta.url))` inline. The `node:url` import was dropped from the three agent files; only `join` is still pulled from `node:path` where needed alongside the helper. The trailing import-order delta in `packages/munchkins-core/src/index.ts` is incidental cleanup from the biome lint pass that ran with this refactor.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/index.ts | 43 | 43 | 0 |
| packages/munchkins/agents/_shared/presets.ts | 26 | 30 | +4 |
| packages/munchkins/agents/bugfix/bugfix-agent.ts | 39 | 39 | 0 |
| packages/munchkins/agents/feat-small/feat-small-agent.ts | 46 | 46 | 0 |
| packages/munchkins/agents/refactor/refactor-agent.ts | 28 | 32 | +4 |

**Total:** 182 → 190 (Δ +8)

**Files changed:**
- packages/munchkins-core/src/index.ts
- packages/munchkins/agents/_shared/presets.ts
- packages/munchkins/agents/bugfix/bugfix-agent.ts
- packages/munchkins/agents/feat-small/feat-small-agent.ts
- packages/munchkins/agents/refactor/refactor-agent.ts

**Call sites now sharing `getAgentPromptsDir`:**
- `packages/munchkins/agents/_shared/presets.ts` — defines and consumes it for `SHARED_PROMPTS`
- `packages/munchkins/agents/bugfix/bugfix-agent.ts` — `const PROMPTS = getAgentPromptsDir(import.meta.url)`
- `packages/munchkins/agents/feat-small/feat-small-agent.ts` — `const PROMPTS = getAgentPromptsDir(import.meta.url)`
- `packages/munchkins/agents/refactor/refactor-agent.ts` — `const PROMPTS = getAgentPromptsDir(import.meta.url)`

Net line count grew by 8 because the helper is defined once and each agent still needs an import line for it; the win is that the `dirname(fileURLToPath(...))` pattern is no longer repeated and there is now a single place to change how agent prompt directories are resolved.

---
## docs: add README with concise repo intro and usage
**2026-05-08 21:21 PDT · feat-small · 300.9s · $1.7630**

**Goal:** Add a concise, compelling README with Usage upfront, then push.

**Outcome:** Created a new top-level `README.md` that opens with a one-paragraph pitch, then leads with `Usage` (install + invocation + examples), followed by default agents, backend selection, per-run lifecycle, repo layout, a build-your-own-agent snippet, requirements, and a pointer to `AGENTS.md`. Also tightened `docs/tsconfig.json` to use `@types/bun` instead of `node`.

**New surface:**

- New file: `README.md`

**Lines added:** +87 (across 2 files)

**Files changed:**
- README.md
- docs/tsconfig.json

---
## feat(core): add switchable agent CLI backend (claude/codex)
**2026-05-08 20:59 PDT · feat-small · 671.0s · $6.1088**

**Goal:** Add a process-wide backend switch so operators can run any agent against either the `claude` CLI (default) or the `codex` CLI, selected by `--cli` flag or `MUNCHKINS_CLI` env var.

**Outcome:** Introduced an abstract `AgentCLI` base class with `ClaudeCLI` and `CodexCLI` subclasses behind a single `AgentCLI.fromEnv()` seam. The existing `spawnClaude` export collapses to a one-liner that delegates to `AgentCLI.fromEnv().spawn()`, preserving the harness mock seam and all 3 internal call sites unchanged. Cost tracking becomes optional end-to-end (`AgentUsage.costUsd?`, `RunSummary.costUsd?`, `RunLog.getCostUsd()` returns `number | undefined`) so Codex's missing cost data renders as `—` honestly instead of being faked as `$0.0000`. Codex's missing system-prompt flag is handled by prepending `## System\n…\n\n## Task\n…` as a single positional argument.

**New surface:**

- Export: `AgentCLI` abstract class (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: `ClaudeCLI` class with `buildArgs()` and `spawn()` (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: `CodexCLI` class with `buildArgs()` and `spawn()` (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: `AgentCLI.fromEnv()` static factory (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: types `SpawnOptions`, `SpawnResult`, `AgentUsage`, `AgentCLIName` (in `packages/munchkins-core/src/builder/agent-cli.ts`, re-exported from `packages/munchkins-core/src/builder/index.ts`)
- CLI flag: `--cli <cli>` on every registered agent subcommand (registered in `packages/munchkins-core/src/registry/registry.ts`)
- Env var: `MUNCHKINS_CLI` (public; read by `AgentCLI.fromEnv()`)
- Env var: `__MUNCHKINS_OPT_cli` (internal flag-bridge set by the registry; takes priority over `MUNCHKINS_CLI`)
- New file: `packages/munchkins-core/src/builder/agent-cli.ts`
- New file: `packages/munchkins-core/src/builder/agent-cli.test.ts`

**Lines added:** +484 (across 8 files)

**Files changed:**
- AGENTS.md
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/agent-cli.ts (new)
- packages/munchkins-core/src/builder/agent-cli.test.ts (new)
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/builder/spawn-claude.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/registry/registry.test.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/run-log.test.ts

---
## feat(core): human-readable run names from LLM slug
**2026-05-08 20:29 PDT · feat-small · 1077.4s · $9.3383**

**Goal:** Replace timestamp-based run-log directory names and worktree branch names with LLM-generated, human-readable slugs derived from the user's task description.

**Outcome:** Added a slug-derivation pipeline (Haiku LLM call with retry + deterministic kebab fallback) that feeds both `RunLog` directory names and worktree branch names. Run dirs are now `<slug>-<uuid8>` and branches are `agent/<slug>-<uuid8>`, with the slug capped at 30 chars. Slug derivation runs in parallel with sandbox creation and the worktree branch is renamed once the slug resolves; fallbacks are recorded as `slug-fallback` events in `events.jsonl`. The scenario harness recognizes the new naming via a Haiku-aware mock branch.

**New surface:**

- Export: `sanitize(raw)` (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `deriveSlugDeterministic(text)` (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `getSlugWithRetry(userMessage, opts?)` (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `SLUG_MAX` constant (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `SlugResult` type (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `SlugFallback` type (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `renameBranch(oldBranch, newBranch, repoRoot)` (in `packages/munchkins-core/src/worktree.ts`)
- Export: `RunLog.recordEvent(event)` public method (in `packages/munchkins-core/src/run-log.ts`)
- Export: `getSlugOutput()` (in `scenarios/lib/mock-spawn-claude.ts`)
- Export: New `slug?: string` option on `RunLog` constructor (in `packages/munchkins-core/src/run-log.ts`)
- Export: New optional `branchName` parameter on `createWorktree` (in `packages/munchkins-core/src/worktree.ts`)
- Export: New `model`, `disallowedTools`, `abortSignal` fields on `SpawnClaudeOptions` (in `packages/munchkins-core/src/builder/spawn-claude.ts`)
- New file: `packages/munchkins-core/src/builder/slug.ts`
- New file: `packages/munchkins-core/src/builder/slug.test.ts`
- New file: `packages/munchkins-core/src/run-log.test.ts`
- New file: `packages/munchkins-core/src/worktree.test.ts`
- Other: New `slug-fallback` event type written to `events.jsonl` (recorded from `agent-builder.ts`)
- Other: `claude` CLI now invoked with `--model` and `--disallowedTools` flags when those options are set (in `packages/munchkins-core/src/builder/spawn-claude.ts`)

**Lines added:** +362 (across 12 files)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/builder/slug.ts
- packages/munchkins-core/src/builder/slug.test.ts
- packages/munchkins-core/src/builder/spawn-claude.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/run-log.test.ts
- packages/munchkins-core/src/sandbox/sandbox.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- packages/munchkins-core/src/worktree.ts
- packages/munchkins-core/src/worktree.test.ts
- scenarios/index.ts
- scenarios/lib/mock-spawn-claude.ts

---

## refactor: extract duplicated helpers across builder, run-log, scenarios
**2026-05-08 20:11 PDT · refactor · 408.3s · $3.3636**

**Goal:** Fix any refactoring opportunities found across the codebase.

**Outcome:** Pulled four sets of duplicated inline logic into named helpers/constants. In `agent-builder.ts`, the user-message resolution and summary-writer prompt construction were duplicated across `_buildSummaryWriterUserPrompt`-equivalent call sites; these are now `resolveOriginalGoal()` and `buildSummaryWriterUserPrompt()`. In `run-log.ts`, the command-entry log formatter and env-path resolution logic were each duplicated; extracted as `formatCommandEntries()` and `resolveEnvPath()`. In `sandbox.test.ts`, the git identity env block was inlined twice; extracted to `TEST_GIT_IDENTITY` constant and `gitEnv()` helper. In `scenarios/index.ts`, six near-identical fail-result objects were collapsed into a single `failResult()` factory closure. Net line count drops, but the primary value is single source of truth for each pattern.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/builder/agent-builder.ts | 656 | 637 | −19 |
| packages/munchkins-core/src/run-log.ts | 331 | 332 | +1 |
| packages/munchkins-core/src/sandbox/sandbox.test.ts | 182 | 181 | −1 |
| scenarios/index.ts | 358 | 311 | −47 |

**Total:** 1527 → 1461 (Δ −66)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- scenarios/index.ts

**Extracted helpers and their call sites:**
- `resolveOriginalGoal(repoRoot)` in `agent-builder.ts` — called from the runtime summary-writer phase (~line 317) and the resolved-prompt preview phase (~line 442).
- `buildSummaryWriterUserPrompt(originalGoal, diffSection)` in `agent-builder.ts` — called from the same two phases as above.
- `formatCommandEntries(entries)` in `run-log.ts` — called from `recordDeterministic` (~line 206) and `recordFinalize` (~line 244).
- `resolveEnvPath(envValue, fallback, repoRoot)` in `run-log.ts` — called from the `RunLog` constructor (run-log dir) and `_prependChangelog` (changelog path).
- `TEST_GIT_IDENTITY` constant + `gitEnv()` helper in `sandbox.test.ts` — used by `createRepo()` and `commit()`.
- `failResult(phase, message, opts?)` closure in `scenarios/index.ts` — replaces six inline fail-shaped returns covering registry-miss, agent failure, mock-call audit, claude-spawn audit, cleanup assertion, artifact assertion, and the catch-all setup error.

---
## feat(cli): add --thinking flag for mid verbosity level
**2026-05-08 19:58 PDT · feat-small · 582.6s · $4.0524**

**Goal:** Add a middle verbosity level called `--thinking` that sits between the default (terse) and `--verbose` (full), streaming Claude output without the boxed prompt prefaces.

**Outcome:** Registered a new `--thinking` Commander option on every agent subcommand that sets `__MUNCHKINS_OPT_thinking=true`. `AgentBuilder.run()` now reads both `verbose` and `thinking` env vars and computes a `streamOutput` flag (`verbose || thinking`) that is threaded through `runAgent`, `runDeterministic`, and the writer phase to control whether `spawnClaude` streams. Boxed `printInvocation` output, phase banners, and per-command stdout remain gated on the existing `verbose` flag, so `--thinking` only unlocks streaming. Updated `--verbose` help text to mention the three levels and added registry tests covering option registration and env-var wiring.

**New surface:**

- CLI flag: `--thinking` on every registered agent subcommand (registered in `packages/munchkins-core/src/registry/registry.ts`)
- Env var: `__MUNCHKINS_OPT_thinking`
- New file: `packages/munchkins-core/src/registry/registry.test.ts`

**Lines added:** +124 (across 4 files)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/registry/registry.test.ts
- packages/munchkins-core/src/sandbox/sandbox.ts


---
## refactor(run-log): extract _writeClaudeCall helper
**2026-05-08 19:02 PDT · refactor · 267.4s · $1.6061**

**Goal:** Deduplicate three near-identical Claude-call writers in `RunLog` (`agentStep`, `summaryStep`, `fixerInvocation`) by extracting a private helper.

**Outcome:** Added `_writeClaudeCall(prefix, kind, systemPrompt, userPrompt, response, exitCode, durationMs, extra)` that writes the `*.system.md` / `*.user.md` / `*.response.txt` artifacts, increments `claudeCallCount`, and emits the corresponding event with `systemBytes` / `userBytes` / `responseBytes`. Each public method now computes only its own prefix and per-kind `extra` fields (`stepIndex`, `iteration`) and delegates to the helper, while preserving its own counter bumps (`agentStepCount`, `fixerInvocationCount`). Behavior, file names, and event payload shapes are unchanged.

**Files changed:**
- `packages/munchkins-core/src/run-log.ts` — introduced `_writeClaudeCall` helper; rewrote `agentStep`, `summaryStep`, and `fixerInvocation` to delegate to it; consolidated the `claudeCallCount` increment into the helper.

---
_No agent runs have been recorded yet. The first successful run of `bun run munchkins <agent>` will prepend an entry above._
