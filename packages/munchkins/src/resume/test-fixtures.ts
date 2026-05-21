import type { ResumableRun, RunState } from "./run-state.js";

export function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    schemaVersion: 1,
    runId: "demo-12345678",
    agentName: "bug-fix",
    slug: "demo",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    phase: "steps",
    repoRoot: "/tmp/repo",
    baseBranch: "main",
    userMessageSnapshot: "fix the bug",
    optsEnv: { __MUNCHKINS_OPT_userMessage: "/path/to/file.md" },
    sandboxState: { kind: "git-worktree", path: "/tmp/wt", branch: "agent/demo-12345678" },
    steps: [{ index: 0, kind: "agent", status: "pending" }],
    ...overrides,
  };
}

export function makeResumableRun(state: RunState): ResumableRun {
  return { runLogDir: `/tmp/${state.runId}`, state };
}
