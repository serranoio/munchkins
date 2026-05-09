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

  describe("accumulateUsage / getCostUsd", () => {
    test("sums costUsd when every contribution provides a value", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      log.accumulateUsage({
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.0125,
      });
      log.accumulateUsage({
        inputTokens: 4,
        outputTokens: 2,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.0075,
      });
      expect(log.getCostUsd()).toBeCloseTo(0.02, 6);
    });

    test("returns undefined when any contribution lacks costUsd", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      log.accumulateUsage({
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.01,
      });
      log.accumulateUsage({
        inputTokens: 4,
        outputTokens: 2,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        // costUsd intentionally omitted (Codex backend)
      });
      expect(log.getCostUsd()).toBeUndefined();
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

  describe("prependChangelogIn", () => {
    test("renders cost as — when any contribution lacked costUsd (Codex backend)", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      log.accumulateUsage({
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        // costUsd intentionally omitted (Codex backend)
      });
      log.setAgentSummary("feat: do a thing", "Did a thing.");

      const changelogPath = log.prependChangelogIn(tmpRepo);
      expect(changelogPath).toBeDefined();

      const text = readFileSync(changelogPath as string, "utf-8");
      expect(text).toContain("## feat: do a thing");
      // The cost field appears in the metadata line, e.g. "... · 0.0s · —"
      expect(text).toMatch(/· —\*\*/);
      expect(text).not.toMatch(/\$\d+\.\d+/);
    });

    test("renders cost as $X.XXXX when all contributions provided costUsd", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      log.accumulateUsage({
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0.0125,
      });
      log.setAgentSummary("feat: another thing", "Body.");

      const changelogPath = log.prependChangelogIn(tmpRepo);
      expect(changelogPath).toBeDefined();

      const text = readFileSync(changelogPath as string, "utf-8");
      expect(text).toContain("$0.0125");
      expect(text).not.toMatch(/· —\*\*/);
    });

    test("returns undefined when setAgentSummary was never called", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      expect(log.prependChangelogIn(tmpRepo)).toBeUndefined();
    });
  });

  describe("getAgentSummaryMarkdown / getAgentSummaryCommitMessage", () => {
    test("return undefined before setAgentSummary is called", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      expect(log.getAgentSummaryMarkdown()).toBeUndefined();
      expect(log.getAgentSummaryCommitMessage()).toBeUndefined();
    });

    test("return the values passed to setAgentSummary", () => {
      const log = new RunLog(tmpRepo, "bug-fix", { slug: "demo" });
      log.setAgentSummary("feat: do a thing", "Did a thing.");
      expect(log.getAgentSummaryCommitMessage()).toBe("feat: do a thing");
      expect(log.getAgentSummaryMarkdown()).toBe("Did a thing.");
    });
  });
});
