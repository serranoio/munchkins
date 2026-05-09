# Changelog

Autonomously-generated entries from agent runs. Most recent first.

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
