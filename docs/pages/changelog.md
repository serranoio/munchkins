# Changelog

Autonomously-generated entries from agent runs. Most recent first.

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
