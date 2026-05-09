import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { $ } from "bun";
import { AgentCLI, type SpawnOptions, type SpawnResult } from "../builder/agent-cli.js";
import { renameBranch } from "../worktree.js";
import { gitWorktreeSandbox } from "./sandbox.js";

// Used only by the teardown-integrates test; the merge-fixer should not be
// invoked when the rebase has no conflicts, so spawn() throwing is the assertion.
class FailIfSpawnedCLI extends AgentCLI {
  readonly name = "claude" as const;
  spawn(_opts: SpawnOptions): Promise<SpawnResult> {
    throw new Error("merge-fixer must not be spawned for a clean rebase");
  }
}

interface Repo {
  path: string;
  cleanup: () => void;
}

const TEST_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
} as const;

function gitEnv(): Record<string, string | undefined> {
  return { ...process.env, ...TEST_GIT_IDENTITY };
}

async function createRepo(branch: string): Promise<Repo> {
  const path = mkdtempSync(join(tmpdir(), "munchkins-sb-test-"));
  const env = gitEnv();
  await $`git init -b ${branch}`.cwd(path).env(env).quiet();
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

async function commit(cwd: string, file: string, content: string, msg: string): Promise<void> {
  await Bun.write(join(cwd, file), content);
  const env = gitEnv();
  await $`git add -A`.cwd(cwd).env(env).quiet();
  await $`git commit -m ${msg}`.cwd(cwd).env(env).quiet();
}

describe("gitWorktreeSandbox", () => {
  let repo: Repo;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    repo = await createRepo("main");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    repo.cleanup();
  });

  test("happy path: creates worktree and tears down cleanup-only on pass", async () => {
    const handle = await gitWorktreeSandbox()("bug-fix", repo.path);

    expect(isAbsolute(handle.cwd)).toBe(true);
    expect(handle.cwd.startsWith(repo.path)).toBe(true);
    expect(handle.env.BRANCH).toMatch(/^agent\/bug-fix-/);
    expect(handle.env.WORKTREE).toBe(handle.cwd);
    expect(handle.env.REPO_ROOT).toBe(repo.path);

    await commit(handle.cwd, "fix.ts", "export const x = 1;\n", "agent commit");

    // Without an integrate ctx the caller is still responsible for merging.
    await $`git merge --ff-only ${handle.env.BRANCH}`.cwd(repo.path).env(gitEnv()).quiet();

    const result = await handle.teardown("pass");
    expect(result.ok).toBe(true);

    const wtList = (await $`git worktree list --porcelain`.cwd(repo.path).quiet()).text();
    expect(wtList).not.toContain(".worktrees/");

    const branches = (await $`git branch --list 'agent/*'`.cwd(repo.path).quiet()).text().trim();
    expect(branches).toBe("");

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("agent commit");
  });

  test("teardown integrates on pass when ctx.integrate is supplied", async () => {
    const handle = await gitWorktreeSandbox()("bug-fix", repo.path);
    await commit(handle.cwd, "fix.ts", "export const x = 1;\n", "agent commit");

    const result = await handle.teardown("pass", {
      integrate: {
        originalGoal: "fix the bug",
        postFixChecks: [],
        cli: new FailIfSpawnedCLI(),
      },
    });

    expect(result.ok).toBe(true);

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("agent commit");

    const wtList = (await $`git worktree list --porcelain`.cwd(repo.path).quiet()).text();
    expect(wtList).not.toContain(handle.cwd);

    const branches = (await $`git branch --list 'agent/*'`.cwd(repo.path).quiet()).text().trim();
    expect(branches).toBe("");
  });

  test("dirty worktree on pass throws and does not silently merge or leak", async () => {
    const handle = await gitWorktreeSandbox()("bug-fix", repo.path);

    await Bun.write(join(handle.cwd, "wip.ts"), "uncommitted\n");

    await expect(handle.teardown("pass")).rejects.toThrow(/uncommitted changes/);

    const wtList = (await $`git worktree list --porcelain`.cwd(repo.path).quiet()).text();
    expect(wtList).toContain(handle.cwd);

    const branches = (await $`git branch --list 'agent/*'`.cwd(repo.path).quiet()).text().trim();
    expect(branches).not.toBe("");

    await $`git worktree remove --force ${handle.cwd}`.cwd(repo.path).quiet().nothrow();
    await $`git branch -D ${handle.env.BRANCH}`.cwd(repo.path).quiet().nothrow();
  });

  test("fail-teardown preserves worktree and branch", async () => {
    const handle = await gitWorktreeSandbox()("bug-fix", repo.path);
    await commit(handle.cwd, "wip.ts", "wip\n", "wip");

    await handle.teardown("fail", { failureReason: "lint failed" });

    const wtList = (await $`git worktree list --porcelain`.cwd(repo.path).quiet()).text();
    expect(wtList).toContain(handle.cwd);

    const branches = (await $`git branch --list 'agent/*'`.cwd(repo.path).quiet()).text();
    expect(branches).toContain(handle.env.BRANCH);

    await $`git worktree remove --force ${handle.cwd}`.cwd(repo.path).quiet();
    await $`git branch -D ${handle.env.BRANCH}`.cwd(repo.path).quiet();
  });

  test("works when process.cwd() is outside repoRoot", async () => {
    process.chdir(tmpdir());

    const handle = await gitWorktreeSandbox()("bug-fix", repo.path);
    expect(isAbsolute(handle.cwd)).toBe(true);

    await commit(handle.cwd, "fix.ts", "x\n", "fix");
    await $`git merge --ff-only ${handle.env.BRANCH}`.cwd(repo.path).env(gitEnv()).quiet();
    await handle.teardown("pass");

    const wtList = (await $`git worktree list --porcelain`.cwd(repo.path).quiet()).text();
    expect(wtList).not.toContain(".worktrees/");
  });

  test("works on a master-default repo", async () => {
    const masterRepo = await createRepo("master");
    try {
      const handle = await gitWorktreeSandbox()("bug-fix", masterRepo.path);
      await commit(handle.cwd, "fix.ts", "x\n", "fix");
      await $`git merge --ff-only ${handle.env.BRANCH}`.cwd(masterRepo.path).env(gitEnv()).quiet();
      await handle.teardown("pass");

      const log = (await $`git log --oneline master`.cwd(masterRepo.path).quiet()).text();
      expect(log).toContain("fix");
    } finally {
      masterRepo.cleanup();
    }
  });

  test("renameBranch updates env.BRANCH so teardown deletes the renamed branch", async () => {
    const handle = await gitWorktreeSandbox()("bug-fix", repo.path);
    const originalBranch = handle.env.BRANCH;
    const slugBranch = "agent/fix-login-redirect-bug-deadbeef";

    await renameBranch(originalBranch, slugBranch, repo.path);
    handle.env.BRANCH = slugBranch;

    expect(handle.env.BRANCH).toBe(slugBranch);

    await commit(handle.cwd, "fix.ts", "export const x = 1;\n", "agent commit");
    await $`git merge --ff-only ${slugBranch}`.cwd(repo.path).env(gitEnv()).quiet();
    await handle.teardown("pass");

    const branches = (await $`git branch --list 'agent/*'`.cwd(repo.path).quiet()).text().trim();
    expect(branches).toBe("");

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("agent commit");
  });

  test("concurrent sandboxes do not collide", async () => {
    const handles = await Promise.all([
      gitWorktreeSandbox()("bug-fix", repo.path),
      gitWorktreeSandbox()("bug-fix", repo.path),
      gitWorktreeSandbox()("bug-fix", repo.path),
    ]);

    const paths = new Set(handles.map((h) => h.cwd));
    const branches = new Set(handles.map((h) => h.env.BRANCH));
    expect(paths.size).toBe(3);
    expect(branches.size).toBe(3);

    for (const h of handles) {
      await commit(h.cwd, "f.ts", `${h.env.BRANCH}\n`, h.env.BRANCH);
    }
    for (const h of handles) {
      await handle_safe_teardown(h, repo.path);
    }
  });
});

async function handle_safe_teardown(
  h: {
    cwd: string;
    env: Record<string, string>;
    teardown: (o: "pass" | "fail") => Promise<{ ok: boolean }>;
  },
  repoRoot: string,
): Promise<void> {
  try {
    await h.teardown("pass");
  } catch {
    await $`git worktree remove --force ${h.cwd}`.cwd(repoRoot).quiet().nothrow();
    await $`git branch -D ${h.env.BRANCH}`.cwd(repoRoot).quiet().nothrow();
  }
}
