import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listResumableRuns,
  loadState,
  type RunState,
  saveState,
  stateFilePath,
} from "./run-state.js";

function makeState(overrides: Partial<RunState> = {}): RunState {
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
    userMessageSnapshot: "fix it",
    optsEnv: { __MUNCHKINS_OPT_userMessage: "/path/to/file.md" },
    sandboxState: { kind: "git-worktree", path: "/tmp/wt", branch: "agent/demo-12345678" },
    steps: [{ index: 0, kind: "agent", status: "pending" }],
    ...overrides,
  };
}

describe("run-state", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "munchkins-runstate-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("saveState + loadState round-trip", () => {
    const dir = join(tmp, "demo-12345678");
    mkdirSync(dir, { recursive: true });
    const state = makeState();
    saveState(dir, state);
    const loaded = loadState(dir);
    expect(loaded?.runId).toBe(state.runId);
    expect(loaded?.steps[0]?.kind).toBe("agent");
    expect(loaded?.optsEnv.__MUNCHKINS_OPT_userMessage).toBe("/path/to/file.md");
  });

  test("loadState returns undefined when state.json is missing", () => {
    const dir = join(tmp, "no-state");
    mkdirSync(dir, { recursive: true });
    expect(loadState(dir)).toBeUndefined();
  });

  test("loadState throws a clear error on invalid JSON", () => {
    const dir = join(tmp, "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(stateFilePath(dir), "{ not-json", "utf-8");
    expect(() => loadState(dir)).toThrow(/state\.json corrupt/);
  });

  test("listResumableRuns returns runs whose phase is steps/integrating", () => {
    process.env.MUNCHKINS_RUN_LOG_DIR = tmp;
    try {
      const a = join(tmp, "a-12345678");
      const b = join(tmp, "b-12345678");
      const c = join(tmp, "c-12345678");
      mkdirSync(a, { recursive: true });
      mkdirSync(b, { recursive: true });
      mkdirSync(c, { recursive: true });
      saveState(a, makeState({ runId: "a-12345678", phase: "steps", slug: "a" }));
      saveState(b, makeState({ runId: "b-12345678", phase: "integrating", slug: "b" }));
      saveState(c, makeState({ runId: "c-12345678", phase: "done", slug: "c" }));

      const ids = listResumableRuns(tmp)
        .map((r) => r.state.runId)
        .sort();
      expect(ids).toEqual(["a-12345678", "b-12345678"]);
    } finally {
      delete process.env.MUNCHKINS_RUN_LOG_DIR;
    }
  });

  test("listResumableRuns ignores dirs without state.json", () => {
    process.env.MUNCHKINS_RUN_LOG_DIR = tmp;
    try {
      const a = join(tmp, "a-12345678");
      const empty = join(tmp, "empty-dir");
      mkdirSync(a, { recursive: true });
      mkdirSync(empty, { recursive: true });
      saveState(a, makeState({ runId: "a-12345678" }));

      const ids = listResumableRuns(tmp).map((r) => r.state.runId);
      expect(ids).toEqual(["a-12345678"]);
    } finally {
      delete process.env.MUNCHKINS_RUN_LOG_DIR;
    }
  });
});
