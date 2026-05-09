import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RunLog } from "./run-log.js";

describe("RunLog", () => {
  let tmpRepo: string;
  const originalEnv = process.env.MUNCHKINS_RUN_LOG_DIR;

  beforeEach(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), "munchkins-runlog-test-"));
    process.env.MUNCHKINS_RUN_LOG_DIR = join(tmpRepo, "runs");
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MUNCHKINS_RUN_LOG_DIR;
    else process.env.MUNCHKINS_RUN_LOG_DIR = originalEnv;
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  describe("constructor", () => {
    test("uses <slug>-<uuid> dir name when slug is provided", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "fix-login-redirect-bug" });
      const name = basename(log.dir);
      expect(name).toMatch(/^fix-login-redirect-bug-[0-9a-f]{8}$/);
      expect(name.startsWith("bug-fix-")).toBe(false);
    });

    test("falls back to <agent>-<ts>-<uuid> when no slug is provided", () => {
      const log = new RunLog(tmpRepo, "bug-fix");
      const name = basename(log.dir);
      expect(name).toMatch(/^bug-fix-\d+-[0-9a-f]{8}$/);
    });

    test("falls back to <agent>-<ts>-<uuid> when slug is empty/whitespace", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "   " });
      const name = basename(log.dir);
      expect(name).toMatch(/^bug-fix-\d+-[0-9a-f]{8}$/);
    });
  });

  describe("recordEvent", () => {
    test("appends a JSON line to events.jsonl", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo-task" });
      log.recordEvent({ type: "slug-fallback", attempts: 5, lastError: "boom" });
      log.recordEvent({ type: "custom", n: 1 });

      const eventsPath = join(log.dir, "events.jsonl");
      const lines = readFileSync(eventsPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({
        type: "slug-fallback",
        attempts: 5,
        lastError: "boom",
      });
      expect(JSON.parse(lines[1])).toEqual({ type: "custom", n: 1 });
    });
  });
});
