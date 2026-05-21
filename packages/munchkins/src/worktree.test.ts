import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { cleanupWorktree, createWorktree, deleteBranch } from "./worktree.js";

interface Repo {
  path: string;
  cleanup: () => void;
}

async function createRepo(): Promise<Repo> {
  const path = mkdtempSync(join(tmpdir(), "munchkins-wt-test-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
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

describe("createWorktree", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  test("uses the provided branchName instead of auto-generating one", async () => {
    const explicitBranch = "agent/fix-login-redirect-bug-deadbeef";
    const info = await createWorktree("bug-fix", repo.path, explicitBranch);
    try {
      expect(info.branch).toBe(explicitBranch);

      const branches = (await $`git branch --list ${explicitBranch}`.cwd(repo.path).quiet())
        .text()
        .trim();
      expect(branches).toContain(explicitBranch);
    } finally {
      await cleanupWorktree(info.path, repo.path);
      await deleteBranch(info.branch, repo.path);
    }
  });

  test("auto-generates an agent/<name>-<suffix> branch when branchName is omitted", async () => {
    const info = await createWorktree("bug-fix", repo.path);
    try {
      expect(info.branch).toMatch(/^agent\/bug-fix-\d+-[0-9a-f]{8}$/);
    } finally {
      await cleanupWorktree(info.path, repo.path);
      await deleteBranch(info.branch, repo.path);
    }
  });

  test("rejects relative repoRoot", async () => {
    await expect(createWorktree("bug-fix", "relative/path")).rejects.toThrow(/absolute/);
  });
});

describe("deleteBranch namespaced safety guard", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  test("deletes a non-'agent/' namespaced branch (e.g. director/foo)", async () => {
    const branch = "director/foo-deadbeef";
    await $`git branch ${branch}`.cwd(repo.path).quiet();
    await deleteBranch(branch, repo.path);
    const remaining = (await $`git branch --list ${branch}`.cwd(repo.path).quiet()).text().trim();
    expect(remaining).toBe("");
  });

  test("refuses to delete a bare branch name like 'main'", async () => {
    // 'main' exists from createRepo seed; if the guard slips, this would
    // detach HEAD and corrupt the fixture — so we verify it still exists.
    await deleteBranch("main", repo.path);
    const remaining = (await $`git branch --list main`.cwd(repo.path).quiet()).text().trim();
    expect(remaining).toContain("main");
  });

  test("empty string is a no-op", async () => {
    await expect(deleteBranch("", repo.path)).resolves.toBeUndefined();
  });

  test("refuses a name with trailing slash only (no second segment)", async () => {
    // Regex requires `[^/]` after the slash; a dangling prefix shouldn't match.
    // Branch doesn't exist; we just verify deleteBranch doesn't throw (no-op).
    await expect(deleteBranch("agent/", repo.path)).resolves.toBeUndefined();
  });
});
