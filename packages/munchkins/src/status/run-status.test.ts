import { describe, expect, test } from "bun:test";
import { makeResumableRun, makeRunState } from "../resume/test-fixtures.js";
import { runStatus } from "./run-status.js";

describe("runStatus", () => {
  test("no running munchkins prints sentinel and exits 0", async () => {
    const lines: string[] = [];
    const result = await runStatus([], {
      repoRoot: "/tmp/repo",
      listRuns: () => [],
      stdout: (l) => lines.push(l),
      stderr: () => {},
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(lines).toContain("no running munchkins");
  });

  test("table output includes runId, agent, slug, phase, steps, age", async () => {
    const a = makeResumableRun(
      makeRunState({
        runId: "demo-aaaaaaaa",
        slug: "demo",
        agentName: "feat-small",
        phase: "steps",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:05:00.000Z",
        steps: [
          { index: 0, kind: "agent", status: "completed" },
          { index: 1, kind: "agent", status: "in-progress" },
          { index: 2, kind: "deterministic", status: "pending" },
        ],
      }),
    );
    const lines: string[] = [];
    const result = await runStatus([], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      stdout: (l) => lines.push(l),
      stderr: () => {},
      now: () => Date.parse("2026-01-01T01:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    const blob = lines.join("\n");
    expect(blob).toContain("demo-aaaaaaaa");
    expect(blob).toContain("feat-small");
    expect(blob).toContain("demo");
    expect(blob).toContain("steps");
    expect(blob).toContain("1/3");
    expect(blob).toContain("agent#2");
    // started 1h ago
    expect(blob).toContain("1h00m");
    // updated 55m ago
    expect(blob).toContain("55m00s ago");
  });

  test("rows are sorted with most recently started first", async () => {
    const older = makeResumableRun(
      makeRunState({ runId: "old-aaaaaaaa", slug: "old", startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const newer = makeResumableRun(
      makeRunState({ runId: "new-bbbbbbbb", slug: "new", startedAt: "2026-02-01T00:00:00.000Z" }),
    );
    const lines: string[] = [];
    await runStatus([], {
      repoRoot: "/tmp/repo",
      listRuns: () => [older, newer],
      stdout: (l) => lines.push(l),
      stderr: () => {},
      now: () => Date.parse("2026-03-01T00:00:00.000Z"),
    });
    const newerIdx = lines.findIndex((l) => l.includes("new-bbbbbbbb"));
    const olderIdx = lines.findIndex((l) => l.includes("old-aaaaaaaa"));
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  test("--json emits parseable JSON with the expected fields", async () => {
    const a = makeResumableRun(
      makeRunState({
        runId: "demo-aaaaaaaa",
        slug: "demo",
        agentName: "bug-fix",
        phase: "integrating",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:10:00.000Z",
        sandboxState: {
          kind: "git-worktree",
          path: "/tmp/wt",
          branch: "agent/demo-aaaaaaaa",
        },
        steps: [
          { index: 0, kind: "agent", status: "completed" },
          { index: 1, kind: "deterministic", status: "in-progress" },
        ],
      }),
    );
    const lines: string[] = [];
    const result = await runStatus(["--json"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      stdout: (l) => lines.push(l),
      stderr: () => {},
      now: () => Date.parse("2026-01-01T00:30:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(lines.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const row = parsed[0];
    expect(row.runId).toBe("demo-aaaaaaaa");
    expect(row.agent).toBe("bug-fix");
    expect(row.phase).toBe("integrating");
    expect(row.stepsCompleted).toBe(1);
    expect(row.stepsTotal).toBe(2);
    expect(row.currentStep).toBe("deterministic#2");
    expect(row.worktreePath).toBe("/tmp/wt");
    expect(row.branch).toBe("agent/demo-aaaaaaaa");
    expect(row.ageMs).toBe(30 * 60 * 1000);
    expect(row.updatedAgoMs).toBe(20 * 60 * 1000);
  });

  test("not inside a git repository errors with exit code 1", async () => {
    const errs: string[] = [];
    const result = await runStatus([], {
      repoRoot: "",
      listRuns: () => [],
      stdout: () => {},
      stderr: (l) => errs.push(l),
      now: () => 0,
    });
    expect(result.exitCode).toBe(1);
    expect(errs.join("\n")).toMatch(/not inside a git repository/i);
  });
});
