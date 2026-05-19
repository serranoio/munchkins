# Changelog

Autonomously-generated entries from agent runs. Most recent first.

---

## feat(integrate): tolerate dirty repoRoot on ff-merge via snapshot commit (ffa8d58)
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
## test(scenarios): add director multi-dispatch e2e + cron callback coverage (a9d43a2)
**2026-05-15 07:57 PDT · feat-small · 1771.6s · $16.0794**

**Goal:** prove the cron → director → multi-child-dispatch chain works end-to-end inside the scenario harness, and close unit-test gaps in director scripts plus the cron daemon callback path.

**Outcome:** added a new `director-multi-dispatch-e2e` harness scenario that drives two ticks through the cron daemon and asserts the director routes to two distinct child agents (bug-fix then refactor) via a fake-bun shim that intercepts `bun run munchkins <child>` calls from `dispatch.sh`. Extended `mock-spawn-claude.ts` with tick-aware fixture buckets and a child-dispatch log reader. Added unit tests covering `repo-survey.sh` happy path, inflight detection of `director/*` branches, `dispatch.sh` argv construction across work_types (plus the idle short-circuit), and one new daemon test that exercises the armed timer callback path. Wired the new scenario into `bun run scenario`.

**How to test manually:**

1. From the repo root, run the new scenario in isolation: `bun run scenarios/director-multi-dispatch-e2e.ts`. Expect exit 0 with stdout JSON containing `"scenarioId": "director-multi-dispatch-e2e"` and `"result": "pass"`. On pass, the artifact dir under `.scenario-artifacts/director-multi-dispatch-e2e-*` is cleaned up automatically.
2. Run the director script unit tests directly: `bun test packages/munchkins/agents/director/director-agent.test.ts`. All tests should pass, including the new `repo-survey.sh happy path…`, `inflight-survey.sh detects existing director/* branches…`, `dispatch.sh constructs the correct child argv…`, and `dispatch.sh short-circuits when triage.json reports idle` cases.
3. Run the daemon test file: `bun test packages/munchkins-core/src/scheduler/daemon.test.ts`. The new test `invoking the armed timer's callback fires builder.run() exactly once and re-arms the next tick` should pass alongside the existing 14.
4. Confirm the older scenarios still pass after the tick-bucket refactor of `mock-spawn-claude.ts`: `bun run scenarios/index.ts && bun run scenarios/composition.ts && bun run scenarios/resume-after-claude-exit-e2e.ts`. Each should exit 0.
5. Run the full chain: `bun run scenario`. Expect all four scenarios PASS sequentially and the command to exit 0.
6. Failure-preservation smoke test: temporarily change `scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-2/02-spec.json` `exitCode` from `0` to `1`. Rerun `bun run scenarios/director-multi-dispatch-e2e.ts`. Expect exit code 1, `"result": "fail"`, `failure.phase` set, and the artifact path printed to stderr (the dir should NOT be cleaned up). Revert the edit afterward.
7. Inspect the JSON output of the passing run for `mockCallLog` — entries should be tagged with `bucket: "tick-1"` for the first half and `bucket: "tick-2"` for the second half, confirming the tick-aware fixture seam fired correctly across both ticks.
8. Lint + typecheck: `bun run lint && bun run typecheck`. Both should exit 0.

**Files changed:**

- package.json
- packages/munchkins-core/src/scheduler/daemon.test.ts
- packages/munchkins/agents/director/director-agent.test.ts
- scenarios/director-multi-dispatch-e2e.ts
- scenarios/fixtures/director-multi-dispatch-e2e/seed-repo/.gitignore
- scenarios/fixtures/director-multi-dispatch-e2e/seed-repo/PURPOSE.md
- scenarios/fixtures/director-multi-dispatch-e2e/seed-repo/package.json
- scenarios/fixtures/director-multi-dispatch-e2e/seed-repo/src/example.ts
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-1/01-triage.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-1/02-spec.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-1/03-plan.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-1/04-summary.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-2/01-triage.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-2/02-spec.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-2/03-plan.json
- scenarios/fixtures/director-multi-dispatch-e2e/mock-claude-responses/tick-2/04-summary.json
- scenarios/lib/fake-bun-bin/bun
- scenarios/lib/mock-spawn-claude.ts

---
## feat(director): add cron-driven director munchkin + --branch-prefix plumbing (2b62c5d)
**2026-05-10 21:59 PDT · feat-small · 1219.3s · $14.5252**

**Goal:** Ship Phase 1 of the `director` munchkin — a cron-driven, six-step orchestrator that picks vertical slices and dispatches to `feat-small` / `bug-fix` / `refactor` — and add the `--branch-prefix` flag the dispatch depends on.

**Outcome:** Added a new `director` agent (3 deterministic + 3 agent + 1 post-checks step, armed on `*/10 * * * *`) with its SKILL.md, three role prompts, and three bash scripts under `packages/munchkins/agents/director/`. Threaded a validated `--branch-prefix` option through `AgentBuilder.run()` so the final branch is `${prefix}/${slug}-${uuid}` (default `agent`, regression-safe). Added a `.handlesDryRun()` opt-out so the director's reasoning steps still run under `--dry-run` while `scripts/dispatch.sh` short-circuits dispatch. Wrote `PURPOSE.md` at the repo root, registered the agent + skill symlink, and documented the surface in `docs/pages/agents/director.md` plus the internal pointer.

**How to test manually:**

1. From the repo root: `bun install && bun run build` (so the `.js` side-effect imports resolve).
2. Confirm the subcommand surface: `bun run munchkins --help` — `director` should appear alongside `bug-fix`, `feat-small`, `refactor`.
3. Daemon table check: `bun run munchkins daemon` and verify the startup table shows a `director` row with schedule `*/10 * * * *` and verbosity `thinking`. Ctrl-C to stop.
4. Dry-run happy path: with `PURPOSE.md` present at repo root, run `bun run munchkins director --user-message=/dev/null --dry-run`. Expect steps 1–5 to execute, intermediate artifacts to appear under `.director/<run>/` in the worktree (`inflight.json`, `survey.md`, `triage.json`, `spec.md`, `plan.md`), and step 6 to print `[director] dispatch (dry-run): bun run munchkins <target> --user-message=.director/<run>/plan.md --branch-prefix=director` without invoking the child. Inspect each artifact to confirm it's well-formed.
5. Missing-PURPOSE fast fail: in a scratch repo without `PURPOSE.md` (`cd /tmp && git init r && cd r && git commit --allow-empty -m seed`), run `bun run --cwd <this-repo> munchkins director --user-message=/dev/null` from inside `/tmp/r`. Expect non-zero exit and stderr `PURPOSE.md not found at repo root. The director requires a written north star. See docs/pages/agents/director.md.`
6. Branch-prefix happy path: `bun run munchkins feat-small --user-message=./scratch/anything.md --branch-prefix=director --dry-run`. The describe output should preview a `director/<slug>-<uuid>` branch. Re-run without the flag and confirm the branch reverts to `agent/<slug>-<uuid>` (byte-identical to today).
7. Branch-prefix rejection: `__MUNCHKINS_OPT_branchPrefix=foo/bar bun run munchkins refactor --user-message=./scratch/anything.md`. Expect immediate failure with `invalid --branch-prefix: "foo/bar". Allowed: alphanumeric characters, dashes, and underscores (no slashes).`
8. Skill symlink: `cat .claude/skills/director/SKILL.md | head -3` resolves to the package source with the `name: director` frontmatter.
9. Out-of-band check (automated tests do not cover this): run `bun run munchkins daemon` in the background, wait one cron tick, then `ls .director/` in the daemon's worktree to see a real run directory populated end-to-end. Kill the daemon when done.

**Files changed:**

- .claude/skills/director (symlink)
- .gitignore
- AGENTS.md
- PURPOSE.md
- README.md
- docs/pages/agents/_meta.json
- docs/pages/agents/director.md
- docs/pages/internal/director-design.md
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/agent-builder.test.ts
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/worktree.ts
- packages/munchkins-core/src/worktree.test.ts
- packages/munchkins/agents/_shared/presets.ts
- packages/munchkins/agents/bugfix/bugfix-agent.ts
- packages/munchkins/agents/feat-small/feat-small-agent.ts
- packages/munchkins/agents/refactor/refactor-agent.ts
- packages/munchkins/agents/director/director-agent.ts
- packages/munchkins/agents/director/director-agent.test.ts
- packages/munchkins/agents/director/prompts/triage.md
- packages/munchkins/agents/director/prompts/spec.md
- packages/munchkins/agents/director/prompts/plan.md
- packages/munchkins/agents/director/scripts/inflight-survey.sh
- packages/munchkins/agents/director/scripts/repo-survey.sh
- packages/munchkins/agents/director/scripts/dispatch.sh
- packages/munchkins/skills/director/SKILL.md
- packages/munchkins/src/index.ts
- packages/munchkins/package.json

---
## refactor(munchkins): namespace default skills under munchkins: (536305f)
**2026-05-10 20:52 PDT · refactor · 457.0s · $4.4814**

**Goal:** Namespace every default skill that ships with `@serranolabs.io/munchkins` under the `munchkins:` colon-namespace, so consumer-authored skills can never collide with framework-managed ones.

**Outcome:** Renamed the five default skill directories from `<slug>/` to `munchkins-<slug>/`, updated each `SKILL.md` frontmatter `name` to the colon-namespaced form (`munchkins:<slug>`), and rewrote the three default agents (`bugfix`, `feat-small`, `refactor`) to call `.withSkill("munchkins:<slug>")`. Extended `Prompt.withSkill()` with a single-line colon→hyphen path conversion (`name.replaceAll(":", "-")`) so namespaced names resolve to `.claude/skills/<vendor>-<slug>/SKILL.md`, with bare-name behavior preserved. Replaced the five `.claude/skills/<slug>` symlinks with `.claude/skills/munchkins-<slug>` symlinks pointing at the renamed sources, and updated the scenario harness to install the bug-fix skill under its new path. Also corrected the not-found error message from `install-skills` to `skills install`. Added four new tests in `prompt.test.ts` covering colon→hyphen conversion, bare-name regression, multi-segment namespaces, and resolved-path in the error message.

**Refactor type:** other

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/builder/prompt.test.ts | 89 | 124 | +35 |
| packages/munchkins-core/src/builder/prompt.ts | 105 | 106 | +1 |
| packages/munchkins/agents/bugfix/bugfix-agent.ts | 33 | 35 | +2 |
| packages/munchkins/agents/feat-small/feat-small-agent.ts | 44 | 46 | +2 |
| packages/munchkins/agents/refactor/refactor-agent.ts | 30 | 32 | +2 |
| packages/munchkins/skills/{bug-fix → munchkins-bug-fix}/SKILL.md | 27 | 27 | 0 |
| packages/munchkins/skills/{feat-small → munchkins-feat-small}/SKILL.md | 27 | 27 | 0 |
| packages/munchkins/skills/{launch-munchkin → munchkins-launch-munchkin}/SKILL.md | 133 | 133 | 0 |
| packages/munchkins/skills/{new-munchkin → munchkins-new-munchkin}/SKILL.md | 343 | 343 | 0 |
| packages/munchkins/skills/{refactor → munchkins-refactor}/SKILL.md | 28 | 28 | 0 |
| scenarios/index.ts | 322 | 329 | +7 |
| .claude/skills/* (5 symlinks renamed) | 5 | 5 | 0 |

**Total:** 1186 → 1235 (Δ +49)

**Files changed:**
- .claude/skills/bug-fix → .claude/skills/munchkins-bug-fix (symlink)
- .claude/skills/feat-small → .claude/skills/munchkins-feat-small (symlink)
- .claude/skills/launch-munchkin → .claude/skills/munchkins-launch-munchkin (symlink)
- .claude/skills/new-munchkin → .claude/skills/munchkins-new-munchkin (symlink)
- .claude/skills/refactor → .claude/skills/munchkins-refactor (symlink)
- packages/munchkins-core/src/builder/prompt.ts
- packages/munchkins-core/src/builder/prompt.test.ts
- packages/munchkins/agents/bugfix/bugfix-agent.ts
- packages/munchkins/agents/feat-small/feat-small-agent.ts
- packages/munchkins/agents/refactor/refactor-agent.ts
- packages/munchkins/skills/munchkins-bug-fix/SKILL.md (renamed)
- packages/munchkins/skills/munchkins-feat-small/SKILL.md (renamed)
- packages/munchkins/skills/munchkins-launch-munchkin/SKILL.md (renamed)
- packages/munchkins/skills/munchkins-new-munchkin/SKILL.md (renamed)
- packages/munchkins/skills/munchkins-refactor/SKILL.md (renamed)
- scenarios/index.ts

---
## refactor(skills-install): walk all node_modules packages, never overwrite existing files (735871c)
**2026-05-10 20:48 PDT · refactor · 631.1s · $3.5204**

**Goal:** Rewrite `runSkillsInstall` so it discovers skills from every `node_modules/` package (not just `@serranolabs.io/munchkins`) and never clobbers an existing target file.

**Outcome:** Replaced the single bundled-source loop with a decomposed pipeline: `_discoverSources` walks the cwd-anchored `node_modules/` (handling scoped `@scope/pkg` entries), preserves source-repo mode via the injected `packageRoot`, and orders `@serranolabs.io/munchkins` first then alphabetically. `_buildInstallPlan` deduplicates by slug, emits `⚠ slug collision` warnings before any writes, and `_runSkillsInstall` uses `existsSync` as the lock against overwrite — `cpSync` no longer carries `force: true`. Public surface (`runSkillsInstall(argv)`) is unchanged; testable helpers (`_resolveTarget`, `_discoverSources`, `_runSkillsInstall`) are exported with an underscore prefix. Added `skills-install.test.ts` covering all nine required cases (multi-package walk, kept-vs-installed, no-silent-overwrite, collision warning ordering, empty `skills/` ignored, exit 1 on empty, `--dest`, source-repo mode, summary structure).

**Refactor type:** other

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins/src/skills-install.ts | 36 | 207 | +171 |
| packages/munchkins/src/skills-install.test.ts | 0 | 186 | +186 |

**Total:** 36 → 393 (Δ +357)

**Files changed:**
- packages/munchkins/src/skills-install.ts
- packages/munchkins/src/skills-install.test.ts

---
## refactor(munchkins): migrate default agents to withSkill() resolver (6870687)
**2026-05-10 20:01 PDT · refactor · 436.7s · $3.3554**

**Goal:** Migrate the three default agents (`bug-fix`, `refactor`, `feat-small`) from `.withSystem(join(PROMPTS, '<name>.md'))` to `.withSkill('<name>')`, deleting the now-redundant per-agent prompt files.

**Outcome:** Replaced the per-agent `.withSystem(...)` call in `bugfix-agent.ts`, `refactor-agent.ts`, and `feat-small-agent.ts` with `.withSkill('<name>')`, which resolves to the shared `packages/munchkins/skills/<name>/SKILL.md` at runtime. Deleted the three orphaned `agents/<name>/prompts/<name>.md` files so `SKILL.md` is the single source of truth. Dropped the now-unused `join` and `getAgentPromptsDir` imports plus the `PROMPTS` const from `bugfix-agent.ts`; kept them in `refactor-agent.ts` and `feat-small-agent.ts` because those agents still load an agent-local `summary-writer.md`. Patched `scenarios/index.ts` to copy the bug-fix SKILL.md into the sandboxed `.claude/skills/bug-fix/` tree so the `bugfix-agent-e2e` scenario can resolve the skill, mirroring `install-skills`.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins/agents/bugfix/bugfix-agent.ts | 39 | 33 | −6 |
| packages/munchkins/agents/bugfix/prompts/bug-fix.md | 22 | 0 | −22 |
| packages/munchkins/agents/feat-small/feat-small-agent.ts | 46 | 44 | −2 |
| packages/munchkins/agents/feat-small/prompts/feat-small.md | 22 | 0 | −22 |
| packages/munchkins/agents/refactor/refactor-agent.ts | 32 | 30 | −2 |
| packages/munchkins/agents/refactor/prompts/refactor.md | 23 | 0 | −23 |
| scenarios/index.ts | 313 | 322 | +9 |

**Total:** 497 → 429 (Δ −68)

**Files changed:**
- packages/munchkins/agents/bugfix/bugfix-agent.ts
- packages/munchkins/agents/bugfix/prompts/bug-fix.md (deleted)
- packages/munchkins/agents/feat-small/feat-small-agent.ts
- packages/munchkins/agents/feat-small/prompts/feat-small.md (deleted)
- packages/munchkins/agents/refactor/refactor-agent.ts
- packages/munchkins/agents/refactor/prompts/refactor.md (deleted)
- scenarios/index.ts

**Extraction call sites** — three agents now share the canonical `packages/munchkins/skills/<name>/SKILL.md` prose via the `withSkill()` resolver:
- `packages/munchkins/agents/bugfix/bugfix-agent.ts` → `.withSkill("bug-fix")` → `packages/munchkins/skills/bug-fix/SKILL.md`
- `packages/munchkins/agents/refactor/refactor-agent.ts` → `.withSkill("refactor")` → `packages/munchkins/skills/refactor/SKILL.md`
- `packages/munchkins/agents/feat-small/feat-small-agent.ts` → `.withSkill("feat-small")` → `packages/munchkins/skills/feat-small/SKILL.md`


---
