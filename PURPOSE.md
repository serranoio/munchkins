# Purpose

## Who it's for

Engineers working in `@serranolabs.io/munchkins` who want to spawn a coding agent against a repo and get back a reviewable diff gated by `lint` / `typecheck` / `scenario`. The default agents (`bug-fix`, `feat-small`, `refactor`, `director`) ship as a deterministic surface that runs identically from a developer's terminal and from CI. Customizations live in the consumer's `.claude/skills/` and survive package upgrades.

## Success looks like

- A consumer can `bun add -D @serranolabs.io/munchkins`, run `bun run munchkins skills install`, and produce a merge-ready PR from a markdown brief without writing framework glue.
- Every default agent runs against both `claude` and `codex` from the same builder code, with no Claude-Code-harness-only features in the production CLI.
- The deterministic gate (`lint` + `typecheck` + `scenario` + `test`) is the single quality contract: green gate → merge or PR; red gate → preserved worktree for inspection.
- The framework is small enough that a new default agent fits in one `<name>-agent.ts` plus a SKILL.md and a few prompts — no boilerplate beyond what the builder demands.
- The plan-funnel artifacts under `docs/pages/internal/` stay synchronized with the framework's actual shape, so a returning engineer can re-derive the design from the durable record.

## Out of scope

- Driving multiple repos from one framework process.
- A packaged GitHub Action. CI integration is wired by the consumer's workflow files; the framework's contribution is the run lifecycle, not the trigger surface.
- Cross-tick learning beyond what `git log` and the open-PR list already provide.
- Per-run cost reporting beyond what the CLI's JSONL stream emits.
- Human-in-the-loop approval gates inside the agent pipeline. Approval lives in the PR review flow.
- A separate plugin / extension system. New agents are TypeScript files; the abstraction floor is the existing `AgentBuilder`.

## Current bets

- 2026-05-10 — `director` munchkin Phase 1: ships the cron-driven orchestrator that selects vertical slices and dispatches to the existing three agents. Phase 2 (a dedicated `performance` munchkin) is deferred until the director picks `performance` work-types often enough to justify the new surface.
- The `--branch-prefix` flag on the default agents exists so the director's inflight-survey can identify director-spawned work via `gh pr list --head 'director/*'` and `git branch --list 'director/*'`. Operators using the agents directly never need to touch this flag.
