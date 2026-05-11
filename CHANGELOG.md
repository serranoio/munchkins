# Changelog

Autonomously-generated entries from agent runs. Most recent first.

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
