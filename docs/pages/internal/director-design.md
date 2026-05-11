# Director — internal design pointer

The full design rationale for the `director` munchkin lives in `docs/pages/internal/plans/director-and-performance.md`. That document is the source of truth for:

- The cron-vs-loop decision and why the daemon is portable to Codex.
- The vertical-slice rule and the parallel-slices-without-lockfile policy.
- The per-iteration pipeline (1 inflight-survey → 2 repo-survey → 3 triage → 4 spec → 5 plan → 6 dispatch).
- The `PURPOSE.md` contract.
- The work-type → munchkin dispatch mapping.
- The eight design decisions recorded during the planning conversation.
- The manual test plan.

## Phase scope

Phase 1 (this slice) ships the director itself plus the `--branch-prefix` dependency on the three existing default agents. Phase 2 (deferred) introduces a dedicated `performance` munchkin; until then, the director's `performance` work-type dispatches to `refactor`.

## Files added in Phase 1

- `packages/munchkins/skills/director/SKILL.md` — shared director context loaded via `Prompt.withSkill("director")`.
- `packages/munchkins/agents/director/director-agent.ts` — the multi-step builder.
- `packages/munchkins/agents/director/prompts/{triage,spec,plan}.md` — role-specific system prompts for the three agent steps.
- `packages/munchkins/agents/director/scripts/{inflight-survey,repo-survey,dispatch}.sh` — the three deterministic steps.
- `PURPOSE.md` at the repo root.
- The `.claude/skills/director` symlink.

## Framework changes in Phase 1

Two small additions to `packages/munchkins-core/src/builder/agent-builder.ts`:

1. `--branch-prefix` plumbing — read from `__MUNCHKINS_OPT_branchPrefix`, default `agent`, validate against `/^[A-Za-z0-9_-]+$/`. Used by the director's dispatch to scope child runs under `director/*` branches.
2. `.handlesDryRun()` builder flag — opts an agent out of the framework's default `--dry-run` short-circuit. The director sets this so all reasoning steps run and `scripts/dispatch.sh` honors the env var locally.

Both changes are additive and gated; the existing three default agents behave identically when no flags are passed.

## Reading order

1. `docs/pages/internal/plans/director-and-performance.md` — the design.
2. `docs/pages/agents/director.md` — the user-facing surface.
3. `packages/munchkins/skills/director/SKILL.md` — what each agent step sees as shared context.
4. `packages/munchkins/agents/director/director-agent.ts` — the builder wire-up.
