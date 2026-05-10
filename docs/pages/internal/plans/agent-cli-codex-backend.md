# Plan — Switchable agent CLI backend (Claude / Codex)

Add a process-wide backend switch so operators can run any agent against either the `claude` CLI (today's default) or the `codex` CLI, selected by flag or env var. The framework's call-site shape stays compatible with future per-step backend selection without implementing it now.

## Problem

Today, every agent step shells out to the `claude` CLI via `spawnClaude` (`packages/munchkins-core/src/builder/spawn-claude.ts:38`). The function name and the integration are 1:1 with one CLI, with no way for an operator to swap in a different agent runtime. Two consequences:

1. Operators who prefer Codex (or want to A/B-compare backends on the same prompt) cannot, short of forking the framework.
2. The harness mock seam (T1) and every internal call site are written assuming a single backend, so any future per-step or per-agent backend choice would require an architectural change.

## Goal

Land a process-wide backend switch driven by a `--cli` flag (or `MUNCHKINS_CLI` env var) that maps to one of `claude` (default) or `codex`. The selection happens behind a single seam — `spawn-claude.ts` keeps its export name and module path so T1 and the existing 3 callers in `agent-builder.ts` are unchanged. Codex's missing system-prompt and missing cost-reporting are handled honestly rather than papered over.

Final shape:

- `bun run munchkins bug-fix --cli=codex --user-message=./bug.md` runs against Codex.
- `MUNCHKINS_CLI=codex bun run munchkins bug-fix --user-message=./bug.md` does the same; flag wins on conflict.
- Default behavior (no flag, no env) is unchanged: `claude` CLI.
- Per-step backend mixing is **not** implemented. The class shape leaves the door open: a future `Step.cli?: AgentCLI` field plus one fallback line in `agent-builder.ts`.

## Decisions

The decision tree was resolved interactively. Each row records the chosen option and the constraint that drove it.

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Switch granularity | **Process-wide only.** One backend per run. Per-step deferred but not foreclosed. |
| D2 | Abstraction shape | **Abstract `AgentCLI` base class + `ClaudeCLI` / `CodexCLI` subclasses + `AgentCLI.fromEnv()` static factory.** Shared parsing/normalization helpers live on the base class. |
| D3 | Codex system-prompt delivery | **Prepend.** `CodexCLI.spawn` sends `## System\n<systemPrompt>\n\n## Task\n<userPrompt>` as a single positional argument. No `--system-prompt` flag exists on `codex exec`; the alternatives (`-c instructions=…` config override or temp `AGENTS.md`) either depend on an unverified config key or collide with this repo's load-bearing `AGENTS.md`. |
| D4 | Cost normalization | **`costUsd` becomes optional** on `AgentUsage` and on `RunSummary`. PASS line renders `$X.XXXX` when present, `—` when absent. Codex JSONL does not emit cost; we never lie about a number we don't have. |
| D5 | Operator selection | **`--cli <cli>` flag** (registered as a global flag alongside `--verbose` / `--thinking`, bridged via `__MUNCHKINS_OPT_cli` per the existing T13 convention) **+ public `MUNCHKINS_CLI` env var**. Flag wins. |
| D6 | Codex sandbox / approval flag | **`--dangerously-bypass-approvals-and-sandbox`** — mirrors Claude's `--dangerously-skip-permissions` trust model. Backend swap must not silently change which commands the agent can execute (e.g., `--full-auto` would block network access and break `bun run scenario` paths). |
| D7 | Test strategy | **Harness unchanged** (T1 mock at `spawn-claude.ts` module level intercepts before any `AgentCLI` instance runs). **New unit tests** in `packages/munchkins-core/src/builder/agent-cli.test.ts` cover `fromEnv()` priority order, per-backend arg construction, and Codex JSONL usage parsing. |

## Defaults baked in

- **Default backend:** `claude` (no behavior change for existing operators).
- **Selection priority:** `__MUNCHKINS_OPT_cli` (set by the `--cli` flag) → `MUNCHKINS_CLI` (public env var) → `"claude"`.
- **Unknown value handling:** `AgentCLI.fromEnv()` throws immediately at startup with a message naming the valid options. No silent fallthrough.
- **`AgentUsage.costUsd` optional**, with `RunSummary.costUsd` also optional. Existing Claude flow always populates it; only Codex omits it.
- **`AgentUsage` is the canonical name.** `SpawnClaudeUsage` is preserved as a `type` re-export for back-compat — `RunLog`'s import (`run-log.ts:3`) keeps working unchanged.
- **No T1 amendment.** The mock seam is the function `spawnClaude` exported from `spawn-claude.ts`; `spawnClaude(opts)` becomes a one-liner that calls `AgentCLI.fromEnv().spawn(opts)`. The harness intercepts before that line ever runs.
- **No new dependencies.** Both backends are CLI subprocesses spawned with `Bun.spawn`. No SDK install.
- **Codex prerequisite documented** in `AGENTS.md`: `codex` must be on PATH and authenticated (`codex login`) for `--cli=codex` to work. Not validated at runtime — failing `Bun.spawn` will surface naturally.

## Implementation

### Files touched

| File | Change |
|------|--------|
| `packages/munchkins-core/src/builder/agent-cli.ts` (new) | `AgentCLI` abstract class, `ClaudeCLI` + `CodexCLI` subclasses, `AgentCLI.fromEnv()` static factory. Holds the canonical `SpawnOptions`, `SpawnResult`, `AgentUsage` types. |
| `packages/munchkins-core/src/builder/agent-cli.test.ts` (new) | Unit tests: `fromEnv()` priority order + unknown-value error; `ClaudeCLI` arg construction (regression-locks current behavior); `CodexCLI` arg construction including `## System\n…\n\n## Task\n…` prepend; `CodexCLI` JSONL usage-event parsing from a captured fixture. |
| `packages/munchkins-core/src/builder/spawn-claude.ts` | Body becomes `return AgentCLI.fromEnv().spawn(opts)`. Re-exports `AgentUsage as SpawnClaudeUsage`, `SpawnOptions as SpawnClaudeOptions`, `SpawnResult as SpawnClaudeResult` for back-compat. `costUsd` typed optional. The current Claude-specific body moves into `ClaudeCLI.spawn()` in `agent-cli.ts`. |
| `packages/munchkins-core/src/builder/index.ts` | Re-export `AgentCLI`, `ClaudeCLI`, `CodexCLI`, `AgentUsage`. Keep existing `spawnClaude` exports. |
| `packages/munchkins-core/src/registry/registry.ts` | Add `sub.option("--cli <cli>", "Backend CLI: claude (default) or codex")` alongside `--verbose` / `--thinking` (`registry.ts:47-58`); in the action callback, set `process.env.__MUNCHKINS_OPT_cli` from `rawOpts.cli` when defined. |
| `packages/munchkins-core/src/registry/registry.test.ts` | New cases: `--cli=codex` sets `__MUNCHKINS_OPT_cli`; `--cli` flag is registered on every agent subcommand. |
| `packages/munchkins-core/src/run-log.ts` | `RunSummary.costUsd?: number`; `accumulateUsage` only adds when `usage.costUsd !== undefined` and tracks a `costUsdHasUnknownContributions` flag so the final `summary.costUsd` is undefined when any contributing call lacked cost data. `getCostUsd()` returns `number | undefined` accordingly. Changelog markdown formatter (currently `run-log.ts:309`) renders `—` instead of `$X.XXXX` when undefined. |
| `packages/munchkins-core/src/builder/agent-builder.ts` | PASS-line cost formatting (lines `~231` / `~239`) handles `undefined`: `const costStr = cost === undefined ? "—" : `$${cost.toFixed(4)}``. No call-site signature changes. |
| `AGENTS.md` | New subsection under "Running default agents": document the `--cli` flag, `MUNCHKINS_CLI` env var, priority rule (flag wins), default (`claude`), Codex prerequisite (`codex` on PATH + `codex login`), and the cost-tracking caveat (Codex runs render `—`). |
| `docs/pages/internal/plans/_meta.json` (new, optional) | Sidebar order for the plans dir if Rspress requires it; otherwise filename order is fine and this can be skipped. |

### `AgentCLI` shape

```ts
// packages/munchkins-core/src/builder/agent-cli.ts
export interface SpawnOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  stream?: boolean;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;                              // optional — Codex never reports
}

export interface SpawnResult {
  exitCode: number;
  output: string;
  durationMs: number;
  usage?: AgentUsage;
}

export abstract class AgentCLI {
  abstract readonly name: "claude" | "codex";
  abstract spawn(opts: SpawnOptions): Promise<SpawnResult>;

  static fromEnv(): AgentCLI {
    const choice =
      process.env.__MUNCHKINS_OPT_cli ??
      process.env.MUNCHKINS_CLI ??
      "claude";
    switch (choice) {
      case "claude": return new ClaudeCLI();
      case "codex":  return new CodexCLI();
      default:
        throw new Error(
          `Unknown CLI backend "${choice}". Expected "claude" or "codex". ` +
          `Set via --cli=<name> or MUNCHKINS_CLI=<name>.`,
        );
    }
  }
}

export class ClaudeCLI extends AgentCLI {
  readonly name = "claude" as const;
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    // Body: today's spawnClaude implementation, verbatim.
  }
}

export class CodexCLI extends AgentCLI {
  readonly name = "codex" as const;

  buildArgs(opts: SpawnOptions): string[] {
    const fullPrompt = `## System\n${opts.systemPrompt}\n\n## Task\n${opts.userPrompt}`;
    return [
      "codex", "exec", "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C", opts.cwd,
      fullPrompt,
    ];
  }

  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    // Bun.spawn(this.buildArgs(opts), { stderr: "inherit", stdout: "pipe" });
    // Parse Codex JSONL line-by-line. Final result text + usage object map to AgentUsage.
    // costUsd intentionally omitted.
    // If opts.stream: render assistant-message events to stdout (parity with ClaudeCLI's stream mode).
  }
}
```

### `spawn-claude.ts` after the change

```ts
import { AgentCLI, type SpawnOptions, type SpawnResult, type AgentUsage } from "./agent-cli.js";

export type SpawnClaudeOptions = SpawnOptions;
export type SpawnClaudeResult = SpawnResult;
export type SpawnClaudeUsage = AgentUsage;

export async function spawnClaude(opts: SpawnClaudeOptions): Promise<SpawnClaudeResult> {
  return AgentCLI.fromEnv().spawn(opts);
}
```

### Registry flag wiring

```ts
// registry.ts — add alongside existing --verbose / --thinking flags
sub.option(
  "--cli <cli>",
  "Backend CLI: claude (default) or codex. Equivalent to env MUNCHKINS_CLI; flag wins on conflict.",
);

// in sub.action:
if (rawOpts.cli) process.env[`${OPTION_ENV_PREFIX}cli`] = String(rawOpts.cli);
```

### `RunLog` cost handling

```ts
private costUsd = 0;
private costUsdHasUnknownContributions = false;

accumulateUsage(usage: AgentUsage | undefined): void {
  if (!usage) return;
  this.tokensIn += usage.inputTokens;
  this.tokensOut += usage.outputTokens;
  this.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  this.cacheReadInputTokens += usage.cacheReadInputTokens;
  if (usage.costUsd === undefined) this.costUsdHasUnknownContributions = true;
  else this.costUsd += usage.costUsd;
}

getCostUsd(): number | undefined {
  return this.costUsdHasUnknownContributions ? undefined : this.costUsd;
}
```

### `agent-builder.ts` PASS-line formatter

```ts
const cost = runLog.getCostUsd();
const costStr = cost === undefined ? "—" : `$${cost.toFixed(4)}`;
```

No other changes in `agent-builder.ts`. The 3 `spawnClaude({...})` call sites stay byte-identical.

## Tests

- **Unit:** `AgentCLI.fromEnv()` returns `ClaudeCLI` when both env vars are unset; returns `CodexCLI` when only `MUNCHKINS_CLI=codex`; returns `CodexCLI` when only `__MUNCHKINS_OPT_cli=codex`; `__MUNCHKINS_OPT_cli` wins when both are set with conflicting values; throws on unknown value with a message naming the valid options.
- **Unit:** `ClaudeCLI` arg construction matches the exact arg array `spawnClaude` produces today (regression lock).
- **Unit:** `CodexCLI.buildArgs(opts)` produces the expected array including the `## System\n…\n\n## Task\n…` prepended single positional argument and `--dangerously-bypass-approvals-and-sandbox`.
- **Unit:** `CodexCLI` JSONL parsing — feed a captured `codex exec --json` event stream fixture; assert `SpawnResult.output`, `usage.inputTokens`, `usage.outputTokens` are populated and `usage.costUsd` is `undefined`.
- **Unit:** `RunLog` — `accumulateUsage` with one `costUsd: 0.01` then one `costUsd: undefined` returns `getCostUsd() === undefined` and the markdown changelog row renders `—`.
- **Unit:** `registry.test.ts` — `--cli=codex` sets `process.env.__MUNCHKINS_OPT_cli === "codex"`; `--cli` is registered on every agent subcommand.
- **Integration (existing):** the bugfix-agent-e2e scenario harness passes unchanged. T1's mock at `spawn-claude.ts` module level intercepts before `AgentCLI.fromEnv()` runs.

## Out of scope (intentionally deferred)

- **Per-step backend selection.** Shape is ready: a `Step.cli?: AgentCLI` field on `AgentStep` plus a `step.cli ?? AgentCLI.fromEnv()` line at each `spawn` call site in `agent-builder.ts`. T1 would need amendment if scenarios ever assert "step N used backend X" — not needed today.
- **Real cost tracking for Codex.** Either wait for upstream JSONL `total_cost_usd`, or add a maintained price table behind a `MUNCHKINS_CODEX_PRICING=table` opt-in. Today's "render `—`" is the honest baseline.
- **Codex defense-in-depth sandbox mode.** A future `MUNCHKINS_CODEX_SANDBOX=full-auto` env opt-in could swap `--dangerously-bypass-approvals-and-sandbox` for `--full-auto`. Not added now to keep one trust model across backends.
- **Backend-parametrized harness runs.** Running every scenario twice (once per backend) is rejected as fixture maintenance overhead with no real coverage gain — backend-specific behavior is unit-testable directly.
- **Streaming-output rendering parity for Codex.** The `stream: true` path in `ClaudeCLI` prints assistant text + tool labels from `assistant`-type events. `CodexCLI` should do the equivalent from its JSONL `agent_message` / `tool_call` events; if the JSONL event shape is non-trivial, ship a minimal "print the final result text" stream renderer first and iterate.
