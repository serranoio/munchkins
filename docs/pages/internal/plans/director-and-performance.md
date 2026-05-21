# Plan — `director` munchkin + `performance` munchkin

Design proposal for two new default agents in `@serranolabs.io/munchkins`:

1. **`director`** — a cron-driven orchestrator that decides *what* to work on, scopes it ruthlessly, resolves design ambiguities, then dispatches to an existing munchkin. Runs forever via the existing `.cron()` daemon, throttled by both its cron spec and the dispatched munchkin's runtime. Codex-compatible (no Claude-specific harness).
2. **`performance`** — a new behavior-preserving munchkin focused on perf wins. Added in Phase 2, so the director eventually has a dedicated optimization target instead of overloading `refactor`.

No code has been written. This document is the source of truth for the design; await explicit approval before implementation.

---

## 1 — Mental model

The `director` is a **product-director** munchkin. It is *ambitious about what to build, ruthless about how much to build per iteration*. Each iteration:

- Reads `PURPOSE.md` as its north star.
- Surveys repo state (git log, open PRs, failing tests, code smells).
- Triages the highest-leverage work type (`feature` / `bug-fix` / `refactor` / `performance`).
- Generates an ambitious candidate, then cuts it down (less-is-more).
- Enumerates the design tree (decision points / ambiguities).
- Resolves each ambiguity with an opinionated architect pass.
- Dispatches the locked plan to the matching munchkin and waits for it to finish.

No human-in-the-loop. No state files. Memory is git history + open PRs.

---

## 2 — Runtime model

### Cron daemon, not `/loop`

The director uses the existing `.cron(spec, opts)` builder API + `bun run munchkins daemon`. This:

- Works under both `claude` and `codex` CLI backends (the harness construct `/loop` is Claude-only).
- Reuses the daemon code already shipped in `packages/munchkins-core/src/scheduler/daemon.ts`.
- Survives a Claude Code session restart — the daemon is just a long-lived Node process.

### Cron spec recommendation

```ts
.cron("*/10 * * * *", { userMessage: "tick", verbosity: "thinking" })
```

Every 10 minutes, the daemon fires `director.run()`. Each tick runs the full pipeline: Inflight-survey gathers context on parallel work already in flight, Triage picks a slice that's independent of all of it (or idles if none is), and Dispatch hands the slice to a child munchkin. 10 minutes is short enough to feel "always on" and long enough that the daemon log isn't noisy.

Operators who want a different cadence can override (`*/30 * * * *` for hourly-ish, `0 * * * *` for top-of-hour, etc.) without changing any other logic.

### Concurrency — parallel slices allowed, with a vertical-slice rule

The director **allows parallel slices to stack**, on one condition: each slice must be a true *vertical slice* — independent of any currently in-flight work. Sequential work stays sequential because the director refuses to pick a slice that depends on something not yet merged.

This means concurrency is governed by **work-selection logic**, not by gatekeeping. The daemon's "undefined behavior" warning about overlapping runs is acknowledged but not honored as a blocker — in practice each `builder.run()` gets a UUID-suffixed worktree dir and a unique branch, so two pipelines running concurrently don't collide on filesystem state. The only real cost is doubled API spend and rate-limit pressure, which we accept in exchange for throughput.

Concretely, instead of a Preflight fast-exit:

- **Inflight-survey** (renamed from Preflight) collects all `director/*` work currently in flight — open PRs, branches without PRs yet, recently-created `.worktrees/<director>-*` directories. Each entry's *goal* (read from the run-log's `user-message.md` or the PR title/branch slug) becomes context for triage.
- **Triage** then picks a candidate that is **demonstrably independent** of every in-flight goal. Touches different files, different layers, different feature areas. If no independent candidate exists this tick, idle and sleep until the next cron firing.
- **There is no lockfile.** Two pipelines running simultaneously in the same daemon process is allowed.

### Rate-limit handling

No explicit `ScheduleWakeup`. If the model hits a 429 / quota / rate-limit during a tick:

- The tick throws.
- The daemon catches the throw, logs it (`[daemon] director run threw: …`), and re-arms the next tick on schedule.
- The next tick eventually succeeds once the rate window resets.

This is strictly worse than `ScheduleWakeup` (we may waste a few cycles failing fast against a still-locked rate window), but it's good enough and it's portable.

### Stop condition

The director **never self-terminates**. The operator stops it by:

- Killing the daemon process (Ctrl-C in the foreground session, or `kill <pid>` for a backgrounded one), or
- Editing `packages/munchkins/agents/director/director-agent.ts` to remove the `.cron(...)` call and restarting the daemon.

No `STOP` sentinel file, no `purpose: archived` flag. Adding a sentinel would invite forgotten kill flags.

---

## 3 — Per-iteration pipeline

The director-agent is a **multi-step** agent — three deterministic Bash steps and three agent steps, threaded together with shared worktree files. This is the same pattern `feat-small` uses (main + refactor + test-writer) and is intentionally backend-agnostic: every step is a plain CLI invocation, so both `claude` and `codex` execute the agent steps identically. No Claude-Code-harness-only features (no Task tool subagents) are used.

State between steps flows via files in the worktree at `.director/<run-id>/`. Each agent step has its own role-specific system prompt under `packages/munchkins/agents/director/prompts/`, plus the shared director context loaded via `Prompt.withSkill("director")`.

| # | Step | Kind | Purpose | Reads | Writes |
|---|------|------|---------|-------|--------|
| 1 | **Inflight-survey** | deterministic | Inventory all in-flight director-spawned work: open `director/*` PRs (title + diff scope), `director/*` branches without PRs, `.worktrees/director-*` directories with their `user-message.md`. | git, gh | `.director/<run>/inflight.json` |
| 2 | **Repo-survey** | deterministic | Run `git log --oneline -30`, `gh pr list` (all), `bun run lint` and `bun run typecheck` exit codes, recent failing CI summary. | git, gh, lint, tsc | `.director/<run>/survey.md` |
| 3 | **Triage** | agent | Read `PURPOSE.md` + the two artifacts above. Apply the vertical-slice rule. Pick `work_type` + a single candidate goal that is independent of every `inflight[]` entry. If no candidate qualifies, write `{idle: true, reason: "…"}`. | `PURPOSE.md`, `inflight.json`, `survey.md` | `.director/<run>/triage.json` |
| 4 | **Spec** | agent | If triage is not idle: do the ambitious pass, then immediately the less-is-more pass in the same conversation (both passes need to see each other). Produce the thinnest viable slice spec. | `triage.json`, `PURPOSE.md` | `.director/<run>/spec.md` |
| 5 | **Plan** | agent | Build the design tree (enumerate ambiguities) and resolve each with an opinionated architect call, in the same conversation. If unresolvable ambiguity remains after one retry, write `{idle: true}`. | `spec.md` | `.director/<run>/plan.md` |
| 6 | **Dispatch** | deterministic | If `plan.md` is present and not idle: invoke `bun run munchkins <work_type-munchkin> --user-message=.director/<run>/plan.md --branch-prefix=director`. Blocks until the child munchkin completes. | `plan.md`, `triage.json` | child PR (side effect) |

A short bash guard at the top of step 2 short-circuits the rest of the pipeline if step 1 detects nothing in flight but `PURPOSE.md` is missing — the run exits cleanly with `PURPOSE.md not found at repo root` and no further steps execute. Likewise, steps 4–6 each early-exit when an upstream artifact says `idle: true`.

### Why "ambitious + less-is-more" merged, and "design-tree + architect" merged

Both merges are because the two passes inside each step need to *see* each other's working state in the same conversation:

- Less-is-more reads the ambitious draft and trims it. If we split them, the framework would write the ambitious version to disk and the less-is-more step would re-read it — fine, but it loses the "fresh in working memory" advantage of doing the cut while the ambition is still warm.
- Architect reads the design tree and makes calls on each item. Same logic.

Splitting these in the future is cheap (just turn one step into two). Start merged.

### Idempotency / resume

Each `.director/<run>/*.json` file is written atomically. If a step fails partway, the framework's resume-from-state logic kicks in (`agent-builder.ts:runFromState`) — completed steps are skipped, the failing step restarts with the previous artifacts on disk.

### Work-type → munchkin mapping

| Work type | Dispatched munchkin |
|-----------|---------------------|
| `feature` | `feat-small` |
| `bug-fix` | `bug-fix` |
| `refactor` | `refactor` |
| `performance` | `performance` *(phase 2; until then map to `refactor`)* |

### "Less is more" tiebreaker rules (codified in SKILL.md)

- Between two same-impact options, prefer the cheaper work type. Bugfix beats feature beats refactor beats performance, all else equal.
- Between two same-type options, prefer fewer files touched, fewer concepts introduced, fewer dependencies added.
- **Never optimize first.** If a feature is two iterations old and shipped, don't refactor it yet — let it earn its complexity first.

### Vertical-slice rule (codified in SKILL.md)

A candidate is **parallelizable** with currently in-flight work only if it satisfies all three:

1. **Disjoint file scope.** The slice does not edit any file currently being edited by an in-flight `director/*` branch. (Estimated from PR diff, branch diff vs main, or worktree diff.)
2. **No upstream dependency.** The slice's correctness does not require code that exists only on an in-flight branch. If you'd need to import from / reference something not yet on `main`, it's sequential, not parallelizable.
3. **No downstream coupling.** A reviewer landing this slice and an in-flight slice in either order produces a green tree. If order matters, it's sequential.

If none of the available candidates pass all three against the current `inflight[]`, **idle the tick.** The next cron firing will reassess once at least one in-flight slice has merged.

The "independence argument" emitted by Triage must explicitly cite which in-flight goals were considered and why each criterion passes. This is the auditable trail.

---

## 4 — `PURPOSE.md` contract

Every repo the director runs against MUST have a `PURPOSE.md` at the root. The director throws and idles if absent.

Minimum required sections:

```markdown
# Purpose

## Who it's for
<one paragraph: the user / audience>

## Success looks like
<bulleted list: 3–5 concrete outcomes that mean the project succeeded>

## Out of scope
<bulleted list: things that are explicitly NOT for this project>

## Current bets
<optional, dated bullets: what the operator is currently steering toward>
```

The director re-reads `PURPOSE.md` every tick. Editing the file is the operator's only steering mechanism between manual daemon restarts.

---

## 5 — Files to add / modify (Phase 1: `director`)

| Path | Action | Notes |
|------|--------|-------|
| `packages/munchkins/skills/director/SKILL.md` | **create** | Shared director context: mandate, vertical-slice rule, "less is more" tiebreakers, work-type → munchkin mapping. Loaded by every agent step via `withSkill("director")` so all three see the same overall framing. Frontmatter `name: director`, `description: <one-sentence>`. |
| `packages/munchkins/agents/director/director-agent.ts` | **create** | Multi-step builder. See "director-agent.ts shape" below for the exact wire-up. |
| `packages/munchkins/agents/director/prompts/triage.md` | **create** | Step 3 role prompt: triage + vertical-slice gating; produces `triage.json`. |
| `packages/munchkins/agents/director/prompts/spec.md` | **create** | Step 4 role prompt: ambitious pass + less-is-more pass; produces `spec.md`. |
| `packages/munchkins/agents/director/prompts/plan.md` | **create** | Step 5 role prompt: design-tree + architect resolution; produces `plan.md`. |
| `packages/munchkins/agents/director/scripts/inflight-survey.sh` | **create** | Step 1 bash: emit `.director/<run>/inflight.json` from `gh pr list --head 'director/*' --json …` + `git branch --list 'director/*'` + a scan of `.worktrees/director-*`. |
| `packages/munchkins/agents/director/scripts/repo-survey.sh` | **create** | Step 2 bash: emit `.director/<run>/survey.md` with `git log --oneline -30`, recent `gh pr list`, lint/typecheck status. Short-circuits the run with a clear error if `PURPOSE.md` is absent. |
| `packages/munchkins/agents/director/scripts/dispatch.sh` | **create** | Step 6 bash: read `triage.json` + `plan.md`, invoke the matching munchkin, block on completion, propagate exit code. |
| `packages/munchkins/src/index.ts` | **modify** | Add `import "../agents/director/director-agent.js";` alphabetically (after `bugfix-then-refactor`, before `feat-small`). |
| `.claude/skills/director` | **create symlink** | → `../../packages/munchkins/skills/director` (source-repo mode only). |
| `AGENTS.md` | **modify** | Append row to "Running default agents" table (line ~83): `\| director \| Cron-driven orchestrator that triages, plans, and dispatches work via other munchkins. \|`. |
| `docs/pages/agents/director.md` | **create** | Public user-facing doc, mirroring SKILL.md description + how to start the daemon. |
| `docs/pages/internal/director-design.md` | **create** | Internal design rationale (mostly a copy of this plan). |
| `README.md` | **modify** | Mention `director` in the agents list. Already has uncommitted changes — coordinate. |
| `PURPOSE.md` | **create** | This repo's own purpose statement, so the director can run against this repo if desired. |
| `packages/munchkins/agents/feat-small/feat-small-agent.ts` `packages/munchkins/agents/bugfix/bugfix-agent.ts` `packages/munchkins/agents/refactor/refactor-agent.ts` | **modify** | Add `--branch-prefix` flag passthrough so the director can scope branches to `director/*`. Implementation: `.option("branchPrefix", { type: "string", required: false, description: "Branch namespace prefix; defaults to 'agent'" })` + thread it through the slug → branch path. |
| `.gitignore` | **modify** | Add `.director/` so the director's intermediate artifacts don't accidentally land in commits. |

### `director-agent.ts` shape

```ts
import { AgentBuilder, Prompt, registry } from "@serranolabs.io/munchkins";
import { gitWorktreeSandbox } from "@serranolabs.io/munchkins";
import { DEFAULT_CHECKS, defaultFixer, defaultSummaryWriter } from "../_shared/presets.js";

const builder = new AgentBuilder(
  "director",
  "Cron-driven orchestrator that triages, plans, and dispatches work via other munchkins.",
  gitWorktreeSandbox(),
)
  // 1. Inflight survey (deterministic)
  .addDeterministic([
    "bash packages/munchkins/agents/director/scripts/inflight-survey.sh",
  ])
  // 2. Repo survey (deterministic; also gates PURPOSE.md)
  .addDeterministic([
    "bash packages/munchkins/agents/director/scripts/repo-survey.sh",
  ])
  // 3. Triage (agent)
  .add(
    new Prompt()
      .withSkill("director")
      .withSystem("packages/munchkins/agents/director/prompts/triage.md"),
  )
  // 4. Spec — ambitious + less-is-more (agent)
  .add(
    new Prompt()
      .withSkill("director")
      .withSystem("packages/munchkins/agents/director/prompts/spec.md"),
  )
  // 5. Plan — design-tree + architect (agent)
  .add(
    new Prompt()
      .withSkill("director")
      .withSystem("packages/munchkins/agents/director/prompts/plan.md"),
  )
  // 6. Dispatch (deterministic — invokes a child munchkin)
  .addDeterministic([
    "bash packages/munchkins/agents/director/scripts/dispatch.sh",
  ])
  .addDeterministic(DEFAULT_CHECKS, defaultFixer)
  .summaryWriter(defaultSummaryWriter)
  .cron("*/10 * * * *", { userMessage: "tick", verbosity: "thinking" });

registry.register(builder);
```

Note: the trailing `.addDeterministic(DEFAULT_CHECKS, defaultFixer)` runs lint/typecheck/scenario on the director's own worktree. Since the director only writes to `.director/<run>/` (gitignored), the gate passes trivially — no diff means no broken builds. It's kept for parity with other munchkins so the framework's merge/teardown logic doesn't need a special case.

### Dispatch mechanic

The dispatch in step 6 calls another munchkin **as a child subprocess** (the script invokes `bun run munchkins …` synchronously), not as a chained `.thenRun()` agent. Reasoning:

- `.thenRun()` chains agents within the *same* worktree. The director's worktree is throwaway — the real work needs to land via the spawned munchkin's own worktree → branch → PR lifecycle.
- The spawned munchkin opens its own PR. The director's job is done once the dispatch returns.
- The director's deterministic gate (`lint` / `typecheck` / `scenario`) runs on the director's empty worktree and passes trivially. The dispatched munchkin's deterministic gate is what actually protects the codebase.

### Branch prefix flag

The director passes `--branch-prefix=director` so the spawned munchkin creates a branch like `director/bug-fix-add-export-2026-05-10T17-22-00`. The Inflight-survey's `gh pr list --head 'director/*'` (plus `git branch --list 'director/*'` for branches without PRs yet) then reliably enumerates director-spawned work regardless of which munchkin was dispatched.

This is a small additive change to the three existing munchkins (Phase 1 dependency, not Phase 2).

---

## 6 — Files to add (Phase 2: `performance` munchkin)

After director ships and we have evidence it would benefit from a dedicated perf agent. Until then, the director routes `performance` work to `refactor`.

| Path | Action | Notes |
|------|--------|-------|
| `packages/munchkins/skills/performance/SKILL.md` | **create** | Mandate: behavior-preserving performance improvements (allocation, indexing, query shape, bundle size, render cost). Out-of-scope: feature changes, API changes. |
| `packages/munchkins/agents/performance/performance-agent.ts` | **create** | Same shape as `refactor-agent.ts` but with a perf-focused system prompt and step prompt. No `.cron()` — it's dispatch-only. |
| `packages/munchkins/agents/performance/prompts/summary-writer.md` | **create** | Mirror `refactor`'s summary writer. |
| `packages/munchkins/src/index.ts` | **modify** | Side-effect import. |
| `.claude/skills/performance` | **create symlink** | Source-repo only. |
| `AGENTS.md` | **modify** | Append table row. |
| `packages/munchkins/agents/director/director-agent.ts` | **modify** | Update dispatch mapping: `performance` → `performance` (not `refactor`). |
| `docs/pages/agents/performance.md` | **create** | Public docs. |

---

## 7 — Design decisions log

These are the calls made during this design conversation. Recorded here so they don't have to be re-litigated during implementation.

1. **Cron, not `/loop`.** Cron daemon is CLI-backend-portable; `/loop` is Claude-Code-harness only. Codex must be able to run the director.
2. **`*/10 * * * *` default cron spec.** Short enough to feel "always on," long enough that the daemon log doesn't fill with thinking-mode chatter. Override per-deployment if a different cadence fits.
3. **Single tick = full pipeline.** No state persists between ticks. Simpler, debuggable, idempotent. Git history is the only memory.
4. **No `STOP` sentinel.** Operator kills the daemon manually. Adding a sentinel would invite forgotten kill flags.
5. **`PURPOSE.md` required.** Without a written north star, "most effective feature" collapses into "whatever sounds cool today." Refusing to run without it is a feature, not a bug.
6. **Director never auto-merges.** It dispatches to other munchkins. The dispatched munchkin's existing deterministic gate decides whether to merge.
7. **Parallel slices allowed; sequential work stays sequential.** No lockfile, no open-PR fast-exit. Instead, Triage rejects candidates that depend on in-flight work (the vertical-slice rule). The director can run alongside its own prior dispatches as long as the work is genuinely independent.
8. **Performance munchkin deferred to Phase 2.** Map to `refactor` initially. Build it only after we see the director actually pick `performance` enough to justify the surface area.
9. **Ambiguity floor.** Architect pass fails → discard candidate, retry once with a less ambiguous one → idle the tick. Never ship a half-resolved plan.
10. **Multi-step composition for Codex portability.** Three deterministic Bash steps (survey, repo-survey, dispatch) + three agent steps (triage, spec, plan). State passes between steps via files in `.director/<run>/`. Rejected: single-step with Task-tool subagents — would lock the director to Claude. Each agent step loads the shared `director` skill plus a role-specific prompt. Same pattern as `feat-small`.
11. **Branch prefix is a Phase 1 dependency.** The three existing munchkins gain a `--branch-prefix` flag so the director's Inflight-survey can reliably identify director-spawned work.
12. **Vertical-slice rule.** Triage must produce an "independence argument" against every in-flight goal: disjoint file scope, no upstream dependency, no downstream coupling. If no candidate qualifies, idle the tick.

---

## 8 — Manual test plan

The director runs forever in the wild, but we can verify each phase deterministically before letting it loose.

### Test 1: Director refuses to run without `PURPOSE.md`

**Setup**

1. In a scratch worktree, delete or rename any existing `PURPOSE.md`.
2. Run `bun run munchkins director --user-message="run a tick"` (one-shot, no daemon).

**Expected**

- Step 2 (Repo-survey, deterministic) detects the missing `PURPOSE.md` and exits non-zero with: `PURPOSE.md not found at repo root. The director requires a written north star. See docs/pages/agents/director.md.`
- The agent run fails fast; later steps don't execute.
- The worktree is preserved at the printed path for inspection.
- No PR is opened.

### Test 2: Director reads `PURPOSE.md` and produces a triage decision (dry-run)

**Setup**

1. Create a minimal `PURPOSE.md` with one bullet under "Success looks like": `Users can export their workspace as JSON.`
2. Run `bun run munchkins director --user-message="run a tick" --dry-run`.

**Expected**

- The director prints (without dispatching):
  - A survey brief mentioning the export goal.
  - A triage decision with `work_type` and justification.
  - An ambitious candidate.
  - A less-is-more slimmed version.
  - An enumerated design tree.
  - An architect resolution per ambiguity.
  - The planned dispatch command (`bun run munchkins <type> --user-message=<…> --branch-prefix=director`).
- No subprocess actually runs.

### Test 3: Director picks an independent slice alongside an in-flight PR

**Setup**

1. Open a draft PR whose head branch is `director/add-csv-export`, with diff touching only `src/export/csv.ts`.
2. `PURPOSE.md` has two unmet success criteria: (a) "users can export as CSV" and (b) "users can rename workspaces."
3. Run `bun run munchkins director --user-message="run a tick" --dry-run`.

**Expected**

- Step 1 (Inflight-survey, deterministic) writes `inflight.json` containing the CSV export PR with its file scope (`src/export/csv.ts`).
- Step 3 (Triage) picks the "rename workspaces" feature, citing the independence argument: disjoint files, no upstream dep, no downstream coupling. Writes `triage.json`.
- Steps 4 (Spec) and 5 (Plan) produce a slimmed plan for workspace rename in `spec.md` / `plan.md`.
- Step 6 (Dispatch) prints the planned command (dry-run, not executed).

### Test 4: Director idles when every candidate depends on in-flight work

**Setup**

1. Open a draft PR `director/scaffold-export-system` that introduces `src/export/index.ts` (a new export module).
2. `PURPOSE.md`'s only unmet success criterion is "users can export as JSON, CSV, and XML" — all formats that would `import` from the new export module.
3. Run the director.

**Expected**

- Step 1 inventories the scaffold PR into `inflight.json`.
- Step 3 (Triage) generates candidate(s); each would depend on the in-flight scaffold module.
- Triage's independence-argument check rejects each → writes `{idle: true, reason: "all candidates depend on PR #NNN"}` to `triage.json`.
- Steps 4–6 each early-exit on `idle: true`. Tick exits 0. No dispatch.

### Test 5: Architect fails → retry → idle

**Setup**

1. Craft a `PURPOSE.md` whose "Success looks like" bullets are intentionally vague and require human product calls ("be the best in class"; "users feel delighted").
2. Run the director.

**Expected**

- Steps 3–5 produce a candidate, then the Plan step's architect resolution flags unresolvable ambiguity.
- Inside the Plan step, the agent generates one alternative candidate and re-attempts the architect resolution within the same conversation.
- If still ambiguous, `plan.md` is written with `{idle: true}` and both attempts logged. Dispatch step early-exits. Tick exits 0.

### Test 6: Happy path — director dispatches to `bug-fix`

**Setup**

1. Repo with `PURPOSE.md` whose success criteria include a measurable behavior.
2. Introduce a small obvious bug in a file (e.g., `add(a, b) { return a - b; }`) and commit it.
3. Run the director one-shot (not daemon yet).

**Expected**

- Triage picks `bug-fix`.
- Less-is-more keeps the slice to that single function.
- Architect resolves any remaining ambiguity (probably none for a one-line bug).
- Dispatch invokes `bun run munchkins bug-fix --user-message=<spec> --branch-prefix=director` and the bug-fix munchkin opens a PR on a branch `director/*`.
- Director exits 0 after the dispatched run completes.

### Test 7: Daemon integration — parallel slices stack, dependent ones idle

**Setup**

1. Repo with `PURPOSE.md` listing three unmet success criteria that touch *different* files (e.g., "export JSON" in `src/export.ts`, "rename workspace" in `src/workspace.ts`, "dark theme" in `src/theme.ts`).
2. Override the director's cron to `*/2 * * * *` for a faster test.
3. Start `bun run munchkins daemon` in one terminal.

**Expected**

- Daemon startup table shows `director` armed with the cron spec.
- Tick 1: picks one of the three (say, export) → dispatches `feat-small` → PR 1 opens on `director/*`.
- Tick 2 (fires while PR 1 still open): Inflight-survey sees PR 1. Triage picks rename (independent of export) → dispatches → PR 2 opens.
- Tick 3 (both PRs open): Inflight-survey sees both. Triage picks dark theme (independent of both) → PR 3 opens.
- Tick 4 (three PRs open, all success criteria covered): every candidate depends on the in-flight scaffolds → tick idles with the "no parallelizable candidate" message.
- Daemon prints `[daemon] director tick (thinking)` per fire; `[daemon] director run threw: …` on any rate-limit error.

### Test 8 (Phase 2): performance munchkin dispatch

**Setup** (after Phase 2 lands)

1. `PURPOSE.md` includes a perf-leaning success criterion (e.g., "API p95 < 200ms").
2. Plant a slow loop in a hot path.
3. Run the director.

**Expected**

- Triage selects `performance`.
- Dispatch invokes `bun run munchkins performance` instead of `refactor`.
- Performance munchkin opens a PR with a perf-only diff.

---

## 9 — Out of scope for this proposal

- **Multi-repo direction.** This director runs against the repo it's invoked in. Driving multiple repos from one daemon is a future concern.
- **Cross-tick learning.** The director has no episodic memory beyond git history. Adding "what worked / what didn't" learning is future work.
- **Cost reporting.** Token / dollar accounting per tick is not built in. Use `rtk gain` externally.
- **Human-in-the-loop review gates.** All output goes through the dispatched munchkin's normal PR flow. There is no extra approval step injected by the director.
- **A standalone `optimize` archetype distinct from `performance`.** "Performance" is the umbrella; bundle size, runtime cost, query cost all live under it.
- **Detecting rate-limit responses specifically.** The director treats any throw the same — log and let the next tick retry. Smart 429-aware backoff is a future enhancement if cycle waste becomes measurable.

---

## 10 — Open questions for operator before implementation

These are the only remaining items where a reasonable default exists but the operator may have a preference. **None block this plan; all block coding.**

1. **`--dry-run` flag scope.** Does the director's `--dry-run` short-circuit at the dispatch step only, or at every phase? *Recommend: dispatch only — let all reasoning phases execute so the operator can inspect the chain.*
2. **PURPOSE.md for this repo.** The plan adds a `PURPOSE.md` for `munchkins` itself (so the director can dogfood). Do you want to write that paragraph, or should I draft one for your review as part of Phase 1?
3. **Branch-prefix flag scope.** The plan adds `--branch-prefix` to all three existing munchkins. Is that acceptable scope creep for the director PR, or do you want it landed as a separate prep PR first? *Recommend: prep PR first — keeps the director PR focused on the new agent.*

Awaiting explicit `start coding` / `implement` instruction before any file beyond this plan is written.
