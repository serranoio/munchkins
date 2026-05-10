import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listResumableRuns, loadState, saveState, stateFilePath } from "./run-state.js";
import { makeRunState } from "./test-fixtures.js";

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
    const state = makeRunState();
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
      saveState(a, makeRunState({ runId: "a-12345678", phase: "steps", slug: "a" }));
      saveState(b, makeRunState({ runId: "b-12345678", phase: "integrating", slug: "b" }));
      saveState(c, makeRunState({ runId: "c-12345678", phase: "done", slug: "c" }));

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
      saveState(a, makeRunState({ runId: "a-12345678" }));

      const ids = listResumableRuns(tmp).map((r) => r.state.runId);
      expect(ids).toEqual(["a-12345678"]);
    } finally {
      delete process.env.MUNCHKINS_RUN_LOG_DIR;
    }
  });
});
