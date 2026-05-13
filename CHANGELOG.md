# Changelog

Autonomously-generated entries from agent runs. Most recent first.

---

## feat(issue-fixer): add cron-driven GitHub-issue triager + fixer munchkin

**Goal:** Ship `issue-fixer` — a cron-driven munchkin that scans open GitHub issues labeled `bot:fix-me`, classifies each as `bug-fix` / `refactor` / `feature`, and dispatches the matching child munchkin with `--integrate=pr` so the result lands as a reviewable PR that auto-closes the issue.

**Outcome:** New `issue-fixer` agent (1 survey deterministic step + 1 triage agent step + 1 dispatch deterministic step) armed on `*/15 * * * *` with `.handlesDryRun()`. Skill at `packages/munchkins/skills/munchkins-issue-fixer/SKILL.md` (symlinked into `.claude/skills/`). Triage prompt at `packages/munchkins/agents/issue-fixer/prompts/triage.md`. Shell scripts at `packages/munchkins/agents/issue-fixer/scripts/{survey.sh,dispatch.sh}`. New GitHub Actions workflow `.github/workflows/issue-fixer.yml` runs the same agent on a 15-minute schedule with `contents/issues/pull-requests: write` permissions. Side-effect import added to `packages/munchkins/src/index.ts`. Bumped `@serranolabs.io/munchkins` to `0.1.4`.

**Labels used:** `bot:fix-me` (operator opt-in), `bot:in-progress` (soft lock added at dispatch, removed at terminal outcome), `bot:fixed` (success), `bot:fix-failed` (failure — operator clears to re-arm).

**How to test manually:**

1. `bun install && bun run build`.
2. `bun run munchkins --help` — confirm `issue-fixer` appears alongside the other agents.
3. With no issues labeled `bot:fix-me`: `bun run munchkins issue-fixer --dry-run`. Expect survey + triage steps to write `.issue-fixer/<run>/{issues.md,dispatch.json}` and dispatch to log `idle — no eligible issues`. No labels mutated.
4. Label one open issue with `bot:fix-me`. Re-run `bun run munchkins issue-fixer --dry-run`. Expect dispatch to log `dispatch (dry-run): issue #<N> → <target>: bun run munchkins <target> --user-message=... --branch-prefix=issue-<N> --integrate=pr`. No labels mutated.
5. Drop `--dry-run` for a real run against a test issue and confirm `bot:in-progress` is added, the child munchkin runs, and on success the PR body includes `Closes #<N>`.
6. From the Actions tab, run `issue-fixer` via `workflow_dispatch` — same behavior, authored by `github-actions[bot]`.

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
