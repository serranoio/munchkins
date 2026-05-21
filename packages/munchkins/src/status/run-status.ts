import { $ } from "bun";
import { listResumableRuns, type ResumableRun, type RunStateStep } from "../resume/run-state.js";

export interface RunStatusDeps {
  /** Inject for tests; defaults to listResumableRuns(). */
  listRuns?: (repoRoot: string) => ResumableRun[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Override; defaults to deriving via `git rev-parse --show-toplevel`. */
  repoRoot?: string;
  /** Inject for tests; defaults to Date.now(). */
  now?: () => number;
}

export interface RunStatusResult {
  exitCode: number;
}

function formatDuration(ms: number): string {
  if (ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function describeCurrentStep(steps: RunStateStep[]): string {
  const inProgress = steps.find((s) => s.status === "in-progress");
  if (inProgress) return `${inProgress.kind}#${inProgress.index + 1}`;
  const nextPending = steps.find((s) => s.status === "pending");
  if (nextPending) return `${nextPending.kind}#${nextPending.index + 1} (pending)`;
  return "—";
}

function printTable(rows: ResumableRun[], now: number, stdout: (line: string) => void): void {
  if (rows.length === 0) {
    stdout("no running munchkins");
    return;
  }
  const header = ["runId", "agent", "slug", "phase", "steps", "current", "age", "updated"];
  const data = rows.map(({ state }) => {
    const completed = state.steps.filter((s) => s.status === "completed").length;
    const ageMs = now - new Date(state.startedAt).getTime();
    const updatedAgoMs = now - new Date(state.updatedAt).getTime();
    return [
      state.runId,
      state.agentName,
      state.slug,
      state.phase,
      `${completed}/${state.steps.length}`,
      describeCurrentStep(state.steps),
      formatDuration(ageMs),
      `${formatDuration(updatedAgoMs)} ago`,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((r) => r[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  stdout(fmt(header));
  stdout(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of data) stdout(fmt(r));
}

function printJson(rows: ResumableRun[], now: number, stdout: (line: string) => void): void {
  const payload = rows.map(({ runLogDir, state }) => {
    const completed = state.steps.filter((s) => s.status === "completed").length;
    return {
      runId: state.runId,
      agent: state.agentName,
      slug: state.slug,
      phase: state.phase,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      ageMs: now - new Date(state.startedAt).getTime(),
      updatedAgoMs: now - new Date(state.updatedAt).getTime(),
      stepsCompleted: completed,
      stepsTotal: state.steps.length,
      currentStep: describeCurrentStep(state.steps),
      worktreePath:
        state.sandboxState.kind === "git-worktree" ? state.sandboxState.path : undefined,
      branch: state.sandboxState.kind === "git-worktree" ? state.sandboxState.branch : undefined,
      runLogDir,
    };
  });
  stdout(JSON.stringify(payload, null, 2));
}

export async function runStatus(
  argv: string[],
  deps: RunStatusDeps = {},
): Promise<RunStatusResult> {
  const stdout = deps.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const lister = deps.listRuns ?? listResumableRuns;
  const now = deps.now ? deps.now() : Date.now();
  const repoRoot =
    deps.repoRoot ?? (await $`git rev-parse --show-toplevel`.quiet().nothrow().text()).trim();
  if (!repoRoot) {
    stderr("munchkins status: not inside a git repository");
    return { exitCode: 1 };
  }

  const rows = [...lister(repoRoot)].sort((a, b) =>
    b.state.startedAt.localeCompare(a.state.startedAt),
  );

  if (argv.includes("--json")) {
    printJson(rows, now, stdout);
  } else {
    printTable(rows, now, stdout);
  }
  return { exitCode: 0 };
}
