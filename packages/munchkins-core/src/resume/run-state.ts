import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { SandboxState } from "../sandbox/sandbox.js";

export type RunPhase = "steps" | "integrating" | "done" | "failed";

export type StepKind = "agent" | "deterministic" | "summary";

export type StepStatus = "pending" | "in-progress" | "completed";

export interface RunStateStep {
  index: number;
  kind: StepKind;
  status: StepStatus;
  sessionId?: string;
  cliBackend?: "claude" | "codex";
  commitMessage?: string;
  markdown?: string;
}

export interface RunState {
  schemaVersion: 1;
  runId: string;
  agentName: string;
  slug: string;
  startedAt: string;
  updatedAt: string;
  phase: RunPhase;
  repoRoot: string;
  baseBranch: string;
  userMessageSnapshot: string;
  optsEnv: Record<string, string>;
  sandboxState: SandboxState;
  steps: RunStateStep[];
  failureReason?: string;
}

const STATE_FILE = "state.json";

export function stateFilePath(runLogDir: string): string {
  return join(runLogDir, STATE_FILE);
}

export function saveState(runLogDir: string, state: RunState): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(stateFilePath(runLogDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function loadState(runLogDir: string): RunState | undefined {
  const path = stateFilePath(runLogDir);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf-8");
  try {
    return JSON.parse(text) as RunState;
  } catch (err) {
    throw new Error(
      `state.json corrupt; manual recovery from worktree at ${runLogDir} (${(err as Error).message})`,
    );
  }
}

export interface ResumableRun {
  runLogDir: string;
  state: RunState;
}

function resolveRunsDir(repoRoot: string): string {
  const env = process.env.MUNCHKINS_RUN_LOG_DIR;
  if (env) return isAbsolute(env) ? env : join(repoRoot, env);
  return join(repoRoot, ".munchkins", "runs");
}

export function listResumableRuns(repoRoot: string): ResumableRun[] {
  const runsDir = resolveRunsDir(repoRoot);
  if (!existsSync(runsDir)) return [];
  const out: ResumableRun[] = [];
  for (const name of readdirSync(runsDir)) {
    const dir = join(runsDir, name);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const path = stateFilePath(dir);
    if (!existsSync(path)) continue;
    let state: RunState | undefined;
    try {
      state = loadState(dir);
    } catch {
      continue;
    }
    if (!state) continue;
    if (state.phase === "done" || state.phase === "failed") continue;
    out.push({ runLogDir: dir, state });
  }
  return out;
}
