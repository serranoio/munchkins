import { $ } from "bun";
import { registry } from "../registry/registry.js";
import { listResumableRuns, type ResumableRun } from "./run-state.js";

export interface RunResumeDeps {
  /** Inject for tests; defaults to the global registry. */
  registry?: { get(name: string): { runFromState?: unknown; sandbox?: unknown } | undefined };
  /** Inject for tests; defaults to listResumableRuns(). */
  listRuns?: (repoRoot: string) => ResumableRun[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Override; defaults to deriving via `git rev-parse --show-toplevel`. */
  repoRoot?: string;
}

const USER_MESSAGE_SNAPSHOT_ENV = "__MUNCHKINS_RESUME_USER_MESSAGE_SNAPSHOT";

export interface RunResumeResult {
  exitCode: number;
}

function printResumableTable(rows: ResumableRun[], stdout: (line: string) => void): void {
  if (rows.length === 0) {
    stdout("no resumable runs");
    return;
  }
  const header = ["runId", "agent", "slug", "started-at", "phase", "steps"];
  const data = rows.map(({ state }) => {
    const completed = state.steps.filter((s) => s.status === "completed").length;
    return [
      state.runId,
      state.agentName,
      state.slug,
      state.startedAt,
      state.phase,
      `${completed}/${state.steps.length}`,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((r) => r[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  stdout(fmt(header));
  stdout(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of data) stdout(fmt(r));
}

function resolveByRunId(needle: string, rows: ResumableRun[]): ResumableRun | { error: string } {
  const exact = rows.filter(({ state }) => state.runId === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return {
      error: `Multiple runs match runId "${needle}": ${exact.map((r) => r.state.runId).join(", ")}`,
    };
  }
  const slugMatches = rows.filter(({ state }) => state.slug === needle);
  if (slugMatches.length === 1) return slugMatches[0];
  if (slugMatches.length > 1) {
    return {
      error: `Slug "${needle}" is ambiguous; matches: ${slugMatches
        .map((r) => r.state.runId)
        .join(", ")}`,
    };
  }
  return { error: `No resumable run matches "${needle}"` };
}

export async function runResume(
  argv: string[],
  deps: RunResumeDeps = {},
): Promise<RunResumeResult> {
  const stdout = deps.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const reg = deps.registry ?? registry;
  const lister = deps.listRuns ?? listResumableRuns;
  const repoRoot =
    deps.repoRoot ?? (await $`git rev-parse --show-toplevel`.quiet().nothrow().text()).trim();
  if (!repoRoot) {
    stderr("munchkins resume: not inside a git repository");
    return { exitCode: 1 };
  }

  const runs = lister(repoRoot);

  if (argv.length === 0 || argv[0] === "--list") {
    printResumableTable(runs, stdout);
    return { exitCode: 0 };
  }

  let target: ResumableRun;
  if (argv[0] === "--latest") {
    if (runs.length === 0) {
      stderr("no resumable runs");
      return { exitCode: 1 };
    }
    const sorted = [...runs].sort((a, b) => b.state.startedAt.localeCompare(a.state.startedAt));
    target = sorted[0];
  } else {
    const resolved = resolveByRunId(argv[0], runs);
    if ("error" in resolved) {
      stderr(resolved.error);
      return { exitCode: 1 };
    }
    target = resolved;
  }

  const { state, runLogDir } = target;

  // Restore env recorded at the original run's start so the agent reads the
  // same options it ran with originally.
  for (const [k, v] of Object.entries(state.optsEnv)) {
    process.env[k] = v;
  }
  // Surface the snapshotted user message via a dedicated env var so
  // readUserMessage prefers it over re-reading the (possibly edited) file.
  process.env[USER_MESSAGE_SNAPSHOT_ENV] = state.userMessageSnapshot;

  const agent = reg.get(state.agentName) as
    | (import("../builder/agent-builder.js").AgentBuilder & {
        runFromState?: (
          s: typeof state,
          sandboxHandle: unknown,
          opts: { runLogDir: string },
        ) => Promise<{ succeeded: boolean; failureReason?: string }>;
      })
    | undefined;
  if (!agent) {
    stderr(`Agent "${state.agentName}" is not registered. Cannot resume run ${state.runId}.`);
    return { exitCode: 1 };
  }
  if (!agent.sandbox?.rehydrate) {
    stderr(
      `Agent "${state.agentName}" sandbox does not support rehydrate(). Run ${state.runId} cannot be resumed.`,
    );
    return { exitCode: 1 };
  }

  let sandboxHandle: import("../sandbox/sandbox.js").SandboxHandle;
  try {
    sandboxHandle = await agent.sandbox.rehydrate(state.sandboxState, state.repoRoot);
  } catch (err) {
    stderr(`munchkins resume: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  if (!agent.runFromState) {
    stderr(`Agent "${state.agentName}" does not implement runFromState(). Cannot resume.`);
    return { exitCode: 1 };
  }

  const result = await agent.runFromState(state, sandboxHandle, { runLogDir });
  return { exitCode: result.succeeded ? 0 : 1 };
}
