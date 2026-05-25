# Purpose

> This file is the director's north star. It is re-read every tick. Edit it to steer.

**Bootstrap any repository into a software factory — at the autonomy level you choose.**

The director's job is to find what's still untrue about that promise and close the gap.

The three Autonomous Modes (defined in full in [README.md](https://github.com/serranoio/munchkins/blob/main/README.md)): **Autopilot** = cron-driven, 0 touches per slice (director reads this file, picks work, ships); **Lights out** = operator-brief → merged main, 1 touch (`--integrate=merge`); **Foreman** = operator-brief → reviewable PR, 2 touches (`--integrate=pr`).

## Success looks like

Score these every tick by executing each `Required:` check against the repo. An unmet check is a candidate slice. **Do not cache state in this file** — the repo is the source of truth. (Previous versions of this file embedded `Today:` snapshots; those drift and lie. Derive, don't cache.)

1. **Every default agent has both integration paths covered by a scenario.**
   - Required (Lights out, `--integrate=merge`): a `scenarios/<agent>-agent-e2e.ts` (or equivalent — the bug-fix one lives at `scenarios/index.ts`) asserts a merged diff.
   - Required (Foreman, `--integrate=pr`): a `scenarios/<agent>-pr-integrate-e2e.ts` asserts an opened PR.

2. **Autopilot has end-to-end coverage.**
   - Required: `scenarios/director-multi-dispatch-e2e.ts` drives ≥2 ticks through the director and asserts dispatch to ≥2 distinct child agents.

3. **Consumer bootstrap is gated.**
   - Required: `scenarios/consumer-bootstrap-e2e.ts` runs `bunx munchkins-init` on a fresh repo and asserts `bun run munchkins --help` lists registered agents.

4. **Backend parity is gated.**
   - Required: a scenario that runs the same fixture agent under `--cli=claude` and `--cli=codex` and asserts identical JSONL stream shape (or explicitly documents known Codex divergences — currently per-call cost).

5. **The gate is uncircumventable.**
   - Required: a scenario that runs a failing `lint` / `typecheck` / `scenario` and asserts the worktree is preserved (no merge, no PR) after the fixer subagent exhausts its 3-iteration cap.

6. **The framework actually ships.**
   - Required: `npm view @serranolabs.io/munchkins version` matches `packages/munchkins/package.json` version, AND `bun publint packages/munchkins` (or equivalent published-package lint) is clean. If publishing breaks, every other criterion is moot — consumers can't install the framework that wires Lights out, Foreman, or Autopilot in their repos.

## Out of scope

- **Default agents shipped from the framework package.** `@serranolabs.io/munchkins` ships zero default agents. The four dogfood agents live in `packages/serrano-munchkins/` and consume the framework like any consumer.
- **A packaged GitHub Action, a plugin system, or any third surface.** Agents are TypeScript files. CI is the consumer's workflow file. There is no extension point below `AgentBuilder`.
- **Multi-repo orchestration.** The director and daemon act on the repo they were invoked in.
- **Cross-tick memory beyond `git log` and the open-PR list.** No state file, no run history, no learned weights. Each tick reasons from the repo as it stands.
- **Per-run cost reporting beyond what the backend CLI's JSONL stream emits.** If the backend doesn't report it, the framework doesn't fabricate it.
- **Human-in-the-loop approval inside the agent pipeline.** Review lives in the PR flow, not in a prompt step.
- **Asserting agent judgment in the scenario harness.** Scenarios prove deterministic plumbing on fixed input. Evaluating whether an LLM picked "the right" triage outcome belongs in an evaluator artifact, never in `scenarios/`.

## Current bets (as of 2026-05-24)

Active steering. Each bet maps to one or more unmet criteria above.

- **Close the Foreman coverage gap.** `feat-small`, `refactor`, and `director` need `--integrate=pr` scenarios alongside the existing `bugfix-pr-integrate-e2e.ts`. Closes Success #1 for those agents. Slice candidates: `feat-small`.
- **Close the Lights out coverage gap.** `feat-small` and `refactor` need their own `*-agent-e2e.ts` scenarios (the bug-fix one is at `scenarios/index.ts`). Closes the other half of Success #1. Slice candidates: `feat-small`.
- **Ship a backend-parity scenario.** Run the same fixture agent under `--cli=claude` and `--cli=codex` and assert JSONL stream parity. Closes Success #4. Slice candidates: `feat-small`.
- **Ship an explicit fixer-cap scenario.** Force three fixer retries, then assert worktree-preserved-no-merge. Closes Success #5. Slice candidates: `feat-small`.
- **Polish Autopilot.** Director shipped 2026-05-10 with the six-step pipeline + cron. Outstanding: tighter dispatch error handling, clearer idle reasoning in `triage.json`, visible feedback in the daemon's startup table. Slice candidates: `bug-fix`, `feat-small`.

## Don't pick

Anti-slices the director should never propose, even when the bet list looks thin.

- **A dedicated `performance` munchkin.** Phase 1 routes `performance` triage outcomes to `refactor`. Re-evaluate only when there is a quantified backlog of `performance` dispatches that `refactor` handled awkwardly.
- **Exposing `--branch-prefix` to direct-call operators.** It exists for the director's inflight-survey (`director/*`) only. If a docs or default change leaks it into operator flow, that's a `bug-fix` slice — not a feature.
- **Privileged access from `serrano-munchkins` into `munchkins`'s internals.** Design smell. Fix by widening the public surface (via `refactor`) or reshaping the agent — never by reaching in.
- **A unit test where a scenario would prove the same behavior.** Deep verification lives in `scenarios/`. If you can write the scenario, write the scenario.
