# Purpose

> This file is the director's north star. It is re-read every tick. Edit it to steer.

**Bootstrap any repository into a software factory — at the autonomy level you choose.**

| Software factory type | Prompt arc | Autonomous Modes (↓ touches per slice = ↑ autonomy) | Ships to | When to use |
|---|---|---|---|---|
| **Autopilot** | `purpose → production` | **0 touches** — `PURPOSE.md` is the only input; runs unattended | Merged main | Fully autonomous software factory. You write the vision; the factory does the work, on its own cadence. |
| **Lights out** | `prompt → production` | **1 touch** — operator writes the brief, walks away | Merged main | Local dev / solo / personal repo. You trust the gate. `--integrate=merge`. |
| **Foreman** | `prompt → review` | **2 touches** — operator writes the brief AND signs off the PR | Merged main *after* human review | Product / team / branch-protected repo. Gate is necessary, not sufficient. `--integrate=pr`. |

## Munchkins are composable agents

Each munchkin is a short TypeScript file built from one primitive: `AgentBuilder`. Compose prompt steps, deterministic checks (`lint` + `typecheck` + `scenario`), a fixer loop, a sandbox (fresh git worktree by default), a summary writer, an integration strategy (`merge` or `pr`), and optionally a cron schedule. The same building blocks scale from a 5-line single-step agent to the 6-step `director`.

`@serranolabs.io/munchkins` ships zero default agents — you author yours via `/munchkins:new-munchkin`. They live in *your* repo at `.claude/skills/<namespace>:<slug>/SKILL.md` plus a `<name>-agent.ts`, get committed to git, and survive package upgrades. The reference agents in `packages/serrano-munchkins/` (`bug-fix`, `feat-small`, `refactor`, `director`) consume the framework the same way you do — no privileged hooks.

## Success looks like

1. **All three modes work as advertised.** Lights out is fully wired today. Autopilot shipped Phase 1 (director + cron daemon, `*/10 * * * *`); polish gaps remain. Foreman is wired at the integration seam (`--integrate=pr` with `gh`/`glab` auto-detection); the operator scenarios that justify it over Lights out are next.
2. **The gate is the contract.** Every run either lands a diff that passed `lint` + `typecheck` + `scenario` (with up to 3 fixer retries) or preserves a worktree at a printed path. No third outcome — no half-merged state, no silent skip, no "warning" the operator has to interpret.
3. **One-command bootstrap, backend-agnostic.** `bun add -D @serranolabs.io/munchkins && bunx munchkins-init` produces a working `bun run munchkins`, an `agentRegistry.ts`, and the two meta-skills. First agent authored via `/munchkins:new-munchkin` without opening framework source. Backend choice is `--cli=claude` or `--cli=codex` — a flag, not a fork.

## Out of scope

- **Default agents shipped from the framework package.** `@serranolabs.io/munchkins` ships zero default agents. The four dogfood agents live in `packages/serrano-munchkins/` and consume the framework like any consumer.
- **A packaged GitHub Action, a plugin system, or any third surface.** Agents are TypeScript files. CI is the consumer's workflow file. There is no extension point below `AgentBuilder`.
- **Multi-repo orchestration.** The director and daemon act on the repo they were invoked in.
- **Cross-tick memory beyond `git log` and the open-PR list.** No state file, no run history, no learned weights. Each tick reasons from the repo as it stands.
- **Per-run cost reporting beyond what the backend CLI's JSONL stream emits.** If the backend doesn't report it, the framework doesn't fabricate it.
- **Human-in-the-loop approval inside the agent pipeline.** Review lives in the PR flow, not in a prompt step.
- **Asserting agent judgment in the scenario harness.** Scenarios prove deterministic plumbing on fixed input. Evaluating whether an LLM picked "the right" triage outcome belongs in an evaluator artifact, never in `scenarios/`.
- **Skill bodies hidden inside the package.** `.claude/skills/` is the consumer's file, in their repo, reviewed in their PRs. `bunx munchkins-init` is skip-if-exists; consumer edits are sacred.

## Current bets (as of 2026-05-24)

Pick work that pushes one of these forward. If a candidate slice doesn't, prefer to idle the tick.

- **Polish Autopilot.** Director shipped 2026-05-10 with the six-step pipeline + cron. Next: tighter dispatch error handling, clearer idle reasoning in `triage.json`, visible feedback in the daemon's startup table. Slice candidates: `bug-fix`, `feat-small`.
- **Wire Foreman properly.** `--integrate=pr` exists with `gh`/`glab` auto-detection, but the operator scenarios that justify Foreman over Lights out — semantic gate (S2 Cautious in `use-cases.md`), conflict handling against the PR target (S4 Team/PR), self-mod harness escalation (S5) — are unwritten. The wins compose on Lights out's primitives, not by redesigning the lifecycle. Slice candidates: `feat-small`.
- **Tighten the consumer-onboarding seam.** `consumer-bootstrap-e2e` exists; the gaps are clearer errors from `bunx munchkins-init`, smoother first-agent authoring via `/munchkins:new-munchkin`, and a happy-path README that doesn't require reading `AGENTS.md`. Mix of `feat-small` and `bug-fix`.
- **Grow the scenario harness, not the unit-test surface.** Deep verification lives in `scenarios/`. When a behavior is worth proving, write the scenario; don't paper it over with a `test` file. `director-multi-dispatch-e2e`, `resume-after-claude-exit-e2e`, and `agent-uncommitted-smoke-e2e` are the templates.
- **Defer a dedicated `performance` munchkin** until the director picks `performance`-typed work often enough to justify the new surface. Phase 1 routes `performance` triage outcomes to `refactor`.
- **Keep `--branch-prefix` invisible to direct-call operators.** It exists for the director's inflight-survey (`director/*`). Operators invoking `bug-fix` / `feat-small` / `refactor` directly should never need to touch it; if a docs or default change leaks it into their flow, that's a `bug-fix`.
- **Hold the framework / dogfood split.** Anything that needs privileged access from `serrano-munchkins` into `munchkins`'s internals is a design smell. Fix it by widening the public surface (carefully, via `refactor`) or by reshaping the agent — never by reaching in.
