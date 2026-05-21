import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runResume } from "./run-resume.js";
import type { RunState } from "./run-state.js";
import { makeResumableRun, makeRunState } from "./test-fixtures.js";

describe("runResume", () => {
  const optsEnvKeys = ["__MUNCHKINS_OPT_userMessage", "__MUNCHKINS_RESUME_USER_MESSAGE_SNAPSHOT"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of optsEnvKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of optsEnvKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("no args + no resumable runs prints 'no resumable runs' and exits 0", async () => {
    const lines: string[] = [];
    const result = await runResume([], {
      repoRoot: "/tmp/repo",
      listRuns: () => [],
      stdout: (line) => lines.push(line),
      stderr: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(lines).toContain("no resumable runs");
  });

  test("--list is identical to no-args (zero runs)", async () => {
    const lines: string[] = [];
    const result = await runResume(["--list"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [],
      stdout: (line) => lines.push(line),
      stderr: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(lines).toContain("no resumable runs");
  });

  test("--list with runs prints a table including each runId", async () => {
    const a = makeResumableRun(makeRunState({ runId: "demo-aaaaaaaa", slug: "demo" }));
    const b = makeResumableRun(makeRunState({ runId: "other-bbbbbbbb", slug: "other" }));
    const lines: string[] = [];
    await runResume(["--list"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a, b],
      stdout: (line) => lines.push(line),
      stderr: () => {},
    });
    const blob = lines.join("\n");
    expect(blob).toContain("demo-aaaaaaaa");
    expect(blob).toContain("other-bbbbbbbb");
  });

  test("ambiguous slug fails with both runIds in the error", async () => {
    const a = makeResumableRun(makeRunState({ runId: "demo-aaaaaaaa", slug: "demo" }));
    const b = makeResumableRun(makeRunState({ runId: "demo-bbbbbbbb", slug: "demo" }));
    const errs: string[] = [];
    const result = await runResume(["demo"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a, b],
      stdout: () => {},
      stderr: (line) => errs.push(line),
    });
    expect(result.exitCode).toBe(1);
    const blob = errs.join("\n");
    expect(blob).toContain("demo-aaaaaaaa");
    expect(blob).toContain("demo-bbbbbbbb");
    expect(blob).toMatch(/ambiguous/i);
  });

  test("unique slug resolves to that run and invokes the agent", async () => {
    const a = makeResumableRun(makeRunState({ runId: "demo-aaaaaaaa", slug: "demo" }));
    let called = false;
    const fakeAgent = {
      sandbox: {
        rehydrate: async () => ({
          cwd: "/tmp/wt",
          env: { BRANCH: "agent/x" },
          teardown: async () => ({ ok: true as const }),
        }),
      },
      runFromState: async () => {
        called = true;
        return { worktreePath: "", branch: "", succeeded: true };
      },
    };
    const result = await runResume(["demo"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      registry: { get: () => fakeAgent },
      stdout: () => {},
      stderr: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(called).toBe(true);
  });

  test("--latest picks the most recent by startedAt", async () => {
    const older = makeResumableRun(
      makeRunState({ runId: "old-aaaaaaaa", slug: "old", startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const newer = makeResumableRun(
      makeRunState({ runId: "new-bbbbbbbb", slug: "new", startedAt: "2026-02-01T00:00:00.000Z" }),
    );
    let observedRunId: string | undefined;
    const fakeAgent = {
      sandbox: {
        rehydrate: async () => ({
          cwd: "/tmp/wt",
          env: { BRANCH: "agent/x" },
          teardown: async () => ({ ok: true as const }),
        }),
      },
      runFromState: async (s: RunState) => {
        observedRunId = s.runId;
        return { worktreePath: "", branch: "", succeeded: true };
      },
    };
    const result = await runResume(["--latest"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [older, newer],
      registry: { get: () => fakeAgent },
      stdout: () => {},
      stderr: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(observedRunId).toBe("new-bbbbbbbb");
  });

  test("unknown id errors clearly", async () => {
    const a = makeResumableRun(makeRunState({ runId: "demo-aaaaaaaa", slug: "demo" }));
    const errs: string[] = [];
    const result = await runResume(["nope"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      stdout: () => {},
      stderr: (line) => errs.push(line),
    });
    expect(result.exitCode).toBe(1);
    expect(errs.join("\n")).toMatch(/no resumable run matches/i);
  });

  test("resuming restores opts env and the user-message snapshot env", async () => {
    const a = makeResumableRun(
      makeRunState({
        runId: "demo-aaaaaaaa",
        slug: "demo",
        userMessageSnapshot: "the original goal",
        optsEnv: { __MUNCHKINS_OPT_userMessage: "/snapshot/path.md" },
      }),
    );
    const fakeAgent = {
      sandbox: {
        rehydrate: async () => ({
          cwd: "/tmp/wt",
          env: { BRANCH: "agent/x" },
          teardown: async () => ({ ok: true as const }),
        }),
      },
      runFromState: async () => ({ worktreePath: "", branch: "", succeeded: true }),
    };
    const result = await runResume(["demo-aaaaaaaa"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      registry: { get: () => fakeAgent },
      stdout: () => {},
      stderr: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(process.env.__MUNCHKINS_OPT_userMessage).toBe("/snapshot/path.md");
    expect(process.env.__MUNCHKINS_RESUME_USER_MESSAGE_SNAPSHOT).toBe("the original goal");
  });

  test("agent missing from registry errors clearly", async () => {
    const a = makeResumableRun(makeRunState({ runId: "demo-aaaaaaaa", slug: "demo" }));
    const errs: string[] = [];
    const result = await runResume(["demo-aaaaaaaa"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      registry: { get: () => undefined },
      stdout: () => {},
      stderr: (line) => errs.push(line),
    });
    expect(result.exitCode).toBe(1);
    expect(errs.join("\n")).toMatch(/not registered/i);
  });

  test("agent without sandbox.rehydrate errors clearly", async () => {
    const a = makeResumableRun(makeRunState({ runId: "demo-aaaaaaaa", slug: "demo" }));
    const errs: string[] = [];
    const fakeAgent = {
      sandbox: {},
      runFromState: async () => ({ worktreePath: "", branch: "", succeeded: true }),
    };
    const result = await runResume(["demo-aaaaaaaa"], {
      repoRoot: "/tmp/repo",
      listRuns: () => [a],
      registry: { get: () => fakeAgent },
      stdout: () => {},
      stderr: (line) => errs.push(line),
    });
    expect(result.exitCode).toBe(1);
    expect(errs.join("\n")).toMatch(/does not support rehydrate/i);
  });
});
