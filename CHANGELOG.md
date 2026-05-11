# Changelog

Autonomously-generated entries from agent runs. Most recent first.

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
