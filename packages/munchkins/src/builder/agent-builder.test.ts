import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  type IntegrationContext,
  type IntegrationResult,
  type IntegrationStrategy,
  integrateMerge,
  integratePR,
} from "../integrate.js";
import { gitWorktreeSandbox } from "../sandbox/sandbox.js";
import { AgentBuilder, resolveBranchPrefix } from "./agent-builder.js";
import { Prompt } from "./prompt.js";

const TEST_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

interface Repo {
  path: string;
  cleanup: () => void;
}

async function createRepo(): Promise<Repo> {
  const path = mkdtempSync(join(tmpdir(), "munchkins-ab-test-"));
  const env = { ...process.env, ...TEST_GIT_IDENTITY };
  await $`git init -b main`.cwd(path).env(env).quiet();
  await $`git config user.email t@t`.cwd(path).env(env).quiet();
  await $`git config user.name t`.cwd(path).env(env).quiet();
  await Bun.write(join(path, "seed.ts"), "export const seed = 1;\n");
  await $`git add -A`.cwd(path).env(env).quiet();
  await $`git commit -m seed`.cwd(path).env(env).quiet();
  return {
    path,
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

/**
 * Spy strategy — records what it was called with. Tests use it to verify
 * which strategy AgentBuilder picked at the dispatch site without exercising
 * real git/PR integration.
 */
function makeSpyStrategy(
  kind: "merge" | "pr",
  result: IntegrationResult = { ok: true, fixerIters: 0 },
): IntegrationStrategy & { calls: IntegrationContext[] } {
  const calls: IntegrationContext[] = [];
  return {
    kind,
    calls,
    async run(ctx) {
      calls.push(ctx);
      return result;
    },
  };
}

describe("AgentBuilder builder methods", () => {
  test("B1: .integrate() is a fluent setter and stores the strategy", () => {
    const builder = new AgentBuilder("a", "desc");
    const strategy = integrateMerge();
    const returned = builder.integrate(strategy);
    expect(returned).toBe(builder);
    expect(builder.getIntegration()).toBe(strategy);
    expect(builder.getIntegration()?.kind).toBe("merge");
  });

  test("B8: .setSandbox(), .rename(), .describe() are fluent setters", () => {
    const builder = new AgentBuilder("original-name", "original");
    const factory = gitWorktreeSandbox();

    expect(builder.setSandbox(factory)).toBe(builder);
    expect(builder.getSandbox()).toBe(factory);

    expect(builder.rename("new-name")).toBe(builder);
    expect(builder.name).toBe("new-name");

    expect(builder.describe("new desc")).toBe(builder);
    expect(builder.description).toBe("new desc");
  });
});

describe("AgentBuilder.thenRun composition", () => {
  test("B2: returns a new builder and does not mutate the receiver", () => {
    const a = new AgentBuilder("a").add(new Prompt());
    const b = new AgentBuilder("b").add(new Prompt());

    const aStepsBefore = a.getStepCount();
    const bStepsBefore = b.getStepCount();

    const composed = a.thenRun(b);

    expect(composed).not.toBe(a);
    expect(composed).not.toBe(b);
    expect(a.getStepCount()).toBe(aStepsBefore);
    expect(b.getStepCount()).toBe(bStepsBefore);
  });

  test("B3: strips sandbox even when both inputs had one", () => {
    const factory = gitWorktreeSandbox();
    const a = new AgentBuilder("a", "", factory);
    const b = new AgentBuilder("b", "", factory);
    const composed = a.thenRun(b);
    expect(composed.getSandbox()).toBeUndefined();
  });

  test("B4: strips summaryWriter", () => {
    const writer = new Prompt();
    const a = new AgentBuilder("a").summaryWriter(writer);
    const b = new AgentBuilder("b").summaryWriter(writer);
    const composed = a.thenRun(b);
    expect(composed.getSummaryWriter()).toBeUndefined();
  });

  test("B5: strips integration", () => {
    const a = new AgentBuilder("a").integrate(integrateMerge());
    const b = new AgentBuilder("b").integrate(integratePR());
    const composed = a.thenRun(b);
    expect(composed.getIntegration()).toBeUndefined();
  });

  test("B6: concatenates steps in order", () => {
    const a = new AgentBuilder("a").add(new Prompt()).add(new Prompt());
    const b = new AgentBuilder("b").add(new Prompt());
    const composed = a.thenRun(b);
    expect(composed.getStepCount()).toBe(a.getStepCount() + b.getStepCount());
    expect(composed.getStepCount()).toBe(3);
  });

  test("B7: unions options by name (single entry per name)", () => {
    const a = new AgentBuilder("a").add(
      new Prompt().withUserMessageFromOption("userMessage", {
        required: true,
        description: "shared option",
      }),
    );
    const b = new AgentBuilder("b").add(
      new Prompt().withUserMessageFromOption("userMessage", {
        required: true,
        description: "shared option",
      }),
    );

    expect(a.options.has("userMessage")).toBe(true);
    expect(b.options.has("userMessage")).toBe(true);

    const composed = a.thenRun(b);
    expect(composed.options.has("userMessage")).toBe(true);
    expect(composed.options.size).toBe(1);
  });
});

describe("AgentBuilder._selectIntegrationStrategy precedence", () => {
  test("B9: no flag, no .integrate() → integrateMerge default", () => {
    const builder = new AgentBuilder("a");
    const sel = builder._selectIntegrationStrategy(undefined);
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.strategy.kind).toBe("merge");
  });

  test("B10: .integrate(integratePR()), no flag → author's pr strategy", () => {
    const builder = new AgentBuilder("a").integrate(integratePR());
    const sel = builder._selectIntegrationStrategy(undefined);
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.strategy.kind).toBe("pr");
  });

  test("B11: --integrate=pr without .integrate() → pr from flag", () => {
    const builder = new AgentBuilder("a");
    const sel = builder._selectIntegrationStrategy("pr");
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.strategy.kind).toBe("pr");
  });

  test("B12: .integrate(integrateMerge()) + --integrate=pr → operator wins", () => {
    const builder = new AgentBuilder("a").integrate(integrateMerge());
    const sel = builder._selectIntegrationStrategy("pr");
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.strategy.kind).toBe("pr");
  });

  test("B12b: .integrate(integratePR()) + --integrate=merge → operator wins (merge)", () => {
    const builder = new AgentBuilder("a").integrate(integratePR());
    const sel = builder._selectIntegrationStrategy("merge");
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.strategy.kind).toBe("merge");
  });

  test("B13: --integrate=garbage → unknown integration mode error", () => {
    const builder = new AgentBuilder("a");
    const sel = builder._selectIntegrationStrategy("garbage");
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toMatch(/unknown integration mode: garbage/);
  });
});

describe("resolveBranchPrefix", () => {
  test("undefined → default 'agent' prefix", () => {
    const r = resolveBranchPrefix(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prefix).toBe("agent");
  });

  test("empty string → default 'agent' prefix", () => {
    const r = resolveBranchPrefix("");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prefix).toBe("agent");
  });

  test("'director' → 'director'", () => {
    const r = resolveBranchPrefix("director");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prefix).toBe("director");
  });

  test("'my_team-2' (alphanumeric + dash + underscore) → accepted", () => {
    const r = resolveBranchPrefix("my_team-2");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prefix).toBe("my_team-2");
  });

  test("'foo/bar' (contains slash) → rejected with clear error", () => {
    const r = resolveBranchPrefix("foo/bar");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/invalid --branch-prefix/);
      expect(r.reason).toMatch(/foo\/bar/);
      expect(r.reason).toMatch(/no slashes/);
    }
  });

  test("'has space' → rejected", () => {
    const r = resolveBranchPrefix("has space");
    expect(r.ok).toBe(false);
  });

  test("'dot.allowed?' → rejected (dot not in slug set)", () => {
    const r = resolveBranchPrefix("dot.x");
    expect(r.ok).toBe(false);
  });
});

describe("AgentBuilder.handlesDryRun opt-out", () => {
  test("fresh builder defaults to handlesDryRun=false", () => {
    const builder = new AgentBuilder("a");
    expect(builder.getHandlesDryRun()).toBe(false);
  });

  test("handlesDryRun() with no arg toggles to true (matches director usage)", () => {
    const builder = new AgentBuilder("a");
    builder.handlesDryRun();
    expect(builder.getHandlesDryRun()).toBe(true);
  });

  test("handlesDryRun(false) explicitly resets to false", () => {
    const builder = new AgentBuilder("a");
    builder.handlesDryRun(true);
    builder.handlesDryRun(false);
    expect(builder.getHandlesDryRun()).toBe(false);
  });

  test("handlesDryRun() returns the builder for chaining", () => {
    const builder = new AgentBuilder("a");
    expect(builder.handlesDryRun()).toBe(builder);
  });
});

describe("AgentBuilder.run integration dispatch end-to-end", () => {
  let repo: Repo;
  const originalCwd = process.cwd();
  const envKeysToScrub = [
    "__MUNCHKINS_OPT_integrate",
    "__MUNCHKINS_OPT_userMessage",
    "__MUNCHKINS_OPT_branchPrefix",
  ];

  beforeEach(async () => {
    repo = await createRepo();
    process.chdir(repo.path);
    for (const k of envKeysToScrub) delete process.env[k];
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const k of envKeysToScrub) delete process.env[k];
    // Best-effort: clean up any leftover worktrees/branches the run may have left.
    await $`git worktree prune`.cwd(repo.path).nothrow().quiet();
    repo.cleanup();
  });

  /**
   * Wrap a sandbox factory so the agent step's commit happens automatically.
   * Lets us run an empty-step pipeline without dirty-worktree teardown errors.
   */
  function autoCommitSandbox() {
    const inner = gitWorktreeSandbox();
    return {
      async create(name: string, repoRoot: string) {
        const handle = await inner.create(name, repoRoot);
        await Bun.write(join(handle.cwd, "marker.ts"), "export const m = 1;\n");
        const env = { ...process.env, ...TEST_GIT_IDENTITY };
        await $`git add -A`.cwd(handle.cwd).env(env).quiet();
        await $`git commit -m agent-step`.cwd(handle.cwd).env(env).quiet();
        return handle;
      },
    };
  }

  // Each end-to-end run drives ~10 git subprocess invocations (init, worktree
  // add, add/commit pairs, rebase --abort, status, worktree remove, branch -D).
  // Local runs finish in <500ms, but CI / loaded dev machines (e.g. running
  // these tests alongside an active agent process) can stretch the same work
  // 5–10×, so the budget needs to absorb that worst-case I/O contention rather
  // than the typical fast path.
  const E2E_TIMEOUT_MS = 60_000;

  test(
    "end-to-end: spy strategy is invoked with the expected context",
    async () => {
      const spy = makeSpyStrategy("merge");
      const builder = new AgentBuilder("test-agent", "test", autoCommitSandbox()).integrate(spy);
      const result = await builder.run();
      expect(result.succeeded).toBe(true);
      expect(spy.calls.length).toBe(1);
      // macOS symlinks /var → /private/var; compare via realpath.
      const observed = spy.calls[0]?.repoRoot ?? "";
      expect(observed.endsWith(repo.path) || repo.path.endsWith(observed)).toBe(true);
      expect(spy.calls[0]?.baseBranch).toBe("main");
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "--integrate=garbage at run time → run fails with clear error",
    async () => {
      process.env.__MUNCHKINS_OPT_integrate = "garbage";
      const spy = makeSpyStrategy("merge");
      const builder = new AgentBuilder("test-agent", "test", autoCommitSandbox()).integrate(spy);

      const result = await builder.run();
      expect(result.succeeded).toBe(false);
      expect(result.failureReason).toMatch(/unknown integration mode/);
      expect(spy.calls.length).toBe(0);
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "default --branch-prefix → final branch is agent/<slug>-<uuid> (regression guard)",
    async () => {
      const spy = makeSpyStrategy("merge");
      const builder = new AgentBuilder("test-agent", "test", autoCommitSandbox()).integrate(spy);
      const result = await builder.run();
      expect(result.succeeded).toBe(true);
      expect(result.branch).toMatch(/^agent\/[a-z0-9-]+-[0-9a-f]{8}$/);
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "--branch-prefix=director → final branch is director/<slug>-<uuid>",
    async () => {
      process.env.__MUNCHKINS_OPT_branchPrefix = "director";
      const spy = makeSpyStrategy("merge");
      const builder = new AgentBuilder("test-agent", "test", autoCommitSandbox()).integrate(spy);
      const result = await builder.run();
      expect(result.succeeded).toBe(true);
      expect(result.branch).toMatch(/^director\/[a-z0-9-]+-[0-9a-f]{8}$/);
    },
    E2E_TIMEOUT_MS,
  );

  test(
    "--branch-prefix=foo/bar (contains slash) → run fails with clear error",
    async () => {
      process.env.__MUNCHKINS_OPT_branchPrefix = "foo/bar";
      const builder = new AgentBuilder("test-agent", "test", autoCommitSandbox());
      await expect(builder.run()).rejects.toThrow(/invalid --branch-prefix/);
    },
    E2E_TIMEOUT_MS,
  );
});
