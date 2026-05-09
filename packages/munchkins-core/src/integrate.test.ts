import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { AgentCLI, type SpawnOptions, type SpawnResult } from "./builder/agent-cli.js";
import { integrateBranch } from "./integrate.js";
import { createWorktree } from "./worktree.js";

const TEST_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
} as const;

function gitEnv(): Record<string, string | undefined> {
  return { ...process.env, ...TEST_GIT_IDENTITY };
}

interface Repo {
  path: string;
  cleanup: () => void;
}

async function createRepo(): Promise<Repo> {
  const path = mkdtempSync(join(tmpdir(), "munchkins-integrate-test-"));
  const env = gitEnv();
  await $`git init -b main`.cwd(path).env(env).quiet();
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

async function commitFile(cwd: string, file: string, content: string, msg: string): Promise<void> {
  await Bun.write(join(cwd, file), content);
  const env = gitEnv();
  await $`git add -A`.cwd(cwd).env(env).quiet();
  await $`git commit -m ${msg}`.cwd(cwd).env(env).quiet();
}

type FixerHandler = (opts: SpawnOptions, iter: number) => Promise<SpawnResult> | SpawnResult;

class StubFixerCLI extends AgentCLI {
  readonly name = "claude" as const;
  invocations = 0;
  constructor(private readonly handler: FixerHandler) {
    super();
  }
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    this.invocations++;
    return this.handler(opts, this.invocations);
  }
}

class FailIfSpawnedCLI extends AgentCLI {
  readonly name = "claude" as const;
  invocations = 0;
  spawn(_opts: SpawnOptions): Promise<SpawnResult> {
    this.invocations++;
    throw new Error("merge-fixer must not be spawned for a clean rebase");
  }
}

/**
 * Set up a single conflicting file: base on main, then divergent edits on the
 * agent worktree's branch and on main. After this returns, integrating `branch`
 * back into main will produce a conflict on `file`.
 */
async function setupSingleFileConflict(repoPath: string): Promise<{
  workdir: string;
  branch: string;
  file: string;
}> {
  const env = gitEnv();
  const file = "conflict.ts";

  // Base version of `file` on main.
  await commitFile(repoPath, file, "export const x = 0;\n", "base");

  // Branch off at this point.
  const { path: workdir, branch } = await createWorktree("bug-fix", repoPath);

  // Branch-side edit.
  await commitFile(workdir, file, "export const x = 1; // branch\n", "branch edit");

  // Main-side edit.
  await commitFile(repoPath, file, "export const x = 2; // main\n", "main edit");
  // Just to be explicit; createRepo init'd with -b main.
  await $`git checkout main`.cwd(repoPath).env(env).quiet().nothrow();

  return { workdir, branch, file };
}

async function setupTwoFileConflict(repoPath: string): Promise<{
  workdir: string;
  branch: string;
  fileA: string;
  fileB: string;
}> {
  const env = gitEnv();
  const fileA = "a.ts";
  const fileB = "b.ts";

  await Bun.write(join(repoPath, fileA), "export const a = 0;\n");
  await Bun.write(join(repoPath, fileB), "export const b = 0;\n");
  await $`git add -A`.cwd(repoPath).env(env).quiet();
  await $`git commit -m base`.cwd(repoPath).env(env).quiet();

  const { path: workdir, branch } = await createWorktree("bug-fix", repoPath);

  await Bun.write(join(workdir, fileA), "export const a = 1; // branch\n");
  await Bun.write(join(workdir, fileB), "export const b = 1; // branch\n");
  await $`git add -A`.cwd(workdir).env(env).quiet();
  await $`git commit -m "branch edits"`.cwd(workdir).env(env).quiet();

  await Bun.write(join(repoPath, fileA), "export const a = 2; // main\n");
  await Bun.write(join(repoPath, fileB), "export const b = 2; // main\n");
  await $`git add -A`.cwd(repoPath).env(env).quiet();
  await $`git commit -m "main edits"`.cwd(repoPath).env(env).quiet();

  return { workdir, branch, fileA, fileB };
}

describe("integrateBranch", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  test("fixer resolves a single-file conflict and integration succeeds", async () => {
    const { workdir, branch, file } = await setupSingleFileConflict(repo.path);

    const cli = new StubFixerCLI(async (opts) => {
      // Write valid merged content (no markers) and exit cleanly.
      await Bun.write(join(opts.cwd, file), "export const x = 1; // merged\n");
      return { exitCode: 0, output: "merged", durationMs: 1 };
    });

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "fix it",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(1);
    expect(cli.invocations).toBe(1);

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("branch edit");
    expect(log).toContain("main edit");

    const finalContent = await Bun.file(join(repo.path, file)).text();
    expect(finalContent).toContain("merged");
    expect(finalContent).not.toContain("<<<<<<<");
  });

  test("fixer that leaves markers in every file fails with no-progress reason", async () => {
    const { workdir, branch } = await setupSingleFileConflict(repo.path);

    const cli = new StubFixerCLI(() => {
      // Don't touch anything. Markers remain in the working tree.
      return { exitCode: 0, output: "", durationMs: 1 };
    });

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "fix it",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/left markers in every/);
      expect(result.fixerIters).toBe(1);
    }

    // main should not have advanced.
    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).not.toContain("branch edit");
  });

  test("partial progress: outer loop re-prompts fixer on remaining unresolved file", async () => {
    const { workdir, branch, fileA, fileB } = await setupTwoFileConflict(repo.path);

    const cli = new StubFixerCLI(async (opts, iter) => {
      if (iter === 1) {
        // Resolve only A; leave B with its conflict markers untouched.
        await Bun.write(join(opts.cwd, fileA), "export const a = 1; // merged\n");
      } else if (iter === 2) {
        // Resolve B on the second invocation.
        await Bun.write(join(opts.cwd, fileB), "export const b = 1; // merged\n");
      }
      return { exitCode: 0, output: "", durationMs: 1 };
    });

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "fix it",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(2);
    expect(cli.invocations).toBe(2);

    const finalA = await Bun.file(join(repo.path, fileA)).text();
    const finalB = await Bun.file(join(repo.path, fileB)).text();
    expect(finalA).toContain("merged");
    expect(finalB).toContain("merged");
    expect(finalA).not.toContain("<<<<<<<");
    expect(finalB).not.toContain("<<<<<<<");
  });

  test("fixer CLI non-zero exit aborts with a CLI-exited reason", async () => {
    const { workdir, branch } = await setupSingleFileConflict(repo.path);

    const cli = new StubFixerCLI(() => ({ exitCode: 1, output: "boom", durationMs: 1 }));

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "fix it",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/CLI exited/);
      expect(result.fixerIters).toBe(1);
    }
  });

  test("clean rebase does not invoke the fixer", async () => {
    // Branch adds a brand-new file; main has no further commits. Rebase is a
    // no-op and the fixer must never be spawned.
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "no conflict",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);
    expect(cli.invocations).toBe(0);

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("fresh feature");
  });
});
