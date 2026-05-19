import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { AgentCLI, type SpawnOptions, type SpawnResult } from "./builder/agent-cli.js";
import { detectProvider, integrateBranch, integrateMerge, integratePR } from "./integrate.js";
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

async function commitFiles(cwd: string, files: Record<string, string>, msg: string): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([path, content]) => Bun.write(join(cwd, path), content)),
  );
  const env = gitEnv();
  await $`git add -A`.cwd(cwd).env(env).quiet();
  await $`git commit -m ${msg}`.cwd(cwd).env(env).quiet();
}

async function commitFile(cwd: string, file: string, content: string, msg: string): Promise<void> {
  await commitFiles(cwd, { [file]: content }, msg);
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
  const fileA = "a.ts";
  const fileB = "b.ts";

  await commitFiles(
    repoPath,
    { [fileA]: "export const a = 0;\n", [fileB]: "export const b = 0;\n" },
    "base",
  );

  const { path: workdir, branch } = await createWorktree("bug-fix", repoPath);

  await commitFiles(
    workdir,
    {
      [fileA]: "export const a = 1; // branch\n",
      [fileB]: "export const b = 1; // branch\n",
    },
    "branch edits",
  );

  await commitFiles(
    repoPath,
    {
      [fileA]: "export const a = 2; // main\n",
      [fileB]: "export const b = 2; // main\n",
    },
    "main edits",
  );

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

  test("single-file content conflict auto-resolves via -X theirs (no fixer)", async () => {
    const { workdir, branch, file } = await setupSingleFileConflict(repo.path);

    // `rebaseAndResolve` uses `git rebase -X theirs` so simple content conflicts
    // resolve to the agent's commits (the side being replayed). The fixer must
    // not be spawned for this class of conflict.
    const cli = new FailIfSpawnedCLI();

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
    if (result.ok) expect(result.fixerIters).toBe(0);
    expect(cli.invocations).toBe(0);

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("branch edit");
    expect(log).toContain("main edit");

    // Agent wins on the overlapping line.
    const finalContent = await Bun.file(join(repo.path, file)).text();
    expect(finalContent).toContain("// branch");
    expect(finalContent).not.toContain("<<<<<<<");
  });

  test("two-file content conflicts both auto-resolve to agent via -X theirs", async () => {
    const { workdir, branch, fileA, fileB } = await setupTwoFileConflict(repo.path);

    const cli = new FailIfSpawnedCLI();

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
    if (result.ok) expect(result.fixerIters).toBe(0);
    expect(cli.invocations).toBe(0);

    const finalA = await Bun.file(join(repo.path, fileA)).text();
    const finalB = await Bun.file(join(repo.path, fileB)).text();
    expect(finalA).toContain("// branch");
    expect(finalB).toContain("// branch");
    expect(finalA).not.toContain("<<<<<<<");
    expect(finalB).not.toContain("<<<<<<<");
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

const SNAPSHOT_MSG_PREFIX = "munchkins: pre-merge snapshot of dirty repoRoot @";

async function snapshotCommits(repoPath: string): Promise<string[]> {
  const log = (await $`git log --pretty=%H%x09%s main`.cwd(repoPath).quiet())
    .text()
    .split("\n")
    .filter(Boolean);
  return log
    .filter((line) => line.split("\t")[1]?.startsWith(SNAPSHOT_MSG_PREFIX))
    .map((line) => line.split("\t")[0]);
}

async function fileAtCommit(repoPath: string, sha: string, path: string): Promise<string> {
  return (await $`git show ${`${sha}:${path}`}`.cwd(repoPath).quiet()).text();
}

describe("integrateBranch dirty-repoRoot matrix", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  test("D1: unstaged tracked modification, no overlap with agent diff", async () => {
    // Pre-commit a tracked file on main that the agent will NOT touch.
    await commitFile(repo.path, "README.md", "# original\n", "add readme");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    // Dirty the tracked file on repoRoot — unstaged.
    await Bun.write(join(repo.path, "README.md"), "# dirty edit\n");

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D1",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);

    const snapshots = await snapshotCommits(repo.path);
    expect(snapshots.length).toBe(1);
    expect(await fileAtCommit(repo.path, snapshots[0], "README.md")).toBe("# dirty edit\n");

    // Working tree: agent's commit landed; README carries the snapshot content.
    expect(await Bun.file(join(repo.path, "fresh.ts")).text()).toContain("fresh = 1");
    expect(await Bun.file(join(repo.path, "README.md")).text()).toBe("# dirty edit\n");

    // main HEAD descends from snapshot AND from branch tip.
    const isAncestor = await $`git merge-base --is-ancestor ${snapshots[0]} HEAD`
      .cwd(repo.path)
      .nothrow()
      .quiet();
    expect(isAncestor.exitCode).toBe(0);
    const branchAncestor = await $`git merge-base --is-ancestor ${branch} HEAD`
      .cwd(repo.path)
      .nothrow()
      .quiet();
    expect(branchAncestor.exitCode).toBe(0);
  });

  test("D2: unstaged tracked modification overlapping an agent-modified file", async () => {
    // Pre-commit a file that the AGENT will modify.
    await commitFile(repo.path, "src/math.ts", "export const v = 0;\n", "seed math");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "src/math.ts", "export const v = 1; // agent\n", "agent: bump v");

    // Dirty the SAME file on repoRoot — overlap forces the snapshot commit's
    // version to lose to the agent during rebase (-X theirs).
    await Bun.write(join(repo.path, "src/math.ts"), "export const v = 99; // user dirty\n");

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D2",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);

    // Working tree: agent wins on overlap.
    const finalMath = await Bun.file(join(repo.path, "src/math.ts")).text();
    expect(finalMath).toContain("// agent");
    expect(finalMath).not.toContain("user dirty");
    expect(finalMath).not.toContain("<<<<<<<");

    // Snapshot commit still records the operator's dirty content.
    const snapshots = await snapshotCommits(repo.path);
    expect(snapshots.length).toBe(1);
    expect(await fileAtCommit(repo.path, snapshots[0], "src/math.ts")).toContain("user dirty");
  });

  test("D3: staged-but-not-committed change, no overlap", async () => {
    await commitFile(repo.path, "notes.md", "# notes\n", "add notes");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    // Stage a change to a tracked file, but do not commit it.
    await Bun.write(join(repo.path, "notes.md"), "# notes (staged edit)\n");
    await $`git add notes.md`.cwd(repo.path).env(gitEnv()).quiet();

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D3",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);

    const snapshots = await snapshotCommits(repo.path);
    expect(snapshots.length).toBe(1);
    expect(await fileAtCommit(repo.path, snapshots[0], "notes.md")).toBe("# notes (staged edit)\n");

    // Working tree carries both the snapshot's notes and the agent's fresh file.
    expect(await Bun.file(join(repo.path, "fresh.ts")).text()).toContain("fresh = 1");
    expect(await Bun.file(join(repo.path, "notes.md")).text()).toBe("# notes (staged edit)\n");
  });

  test("D4: untracked file name-colliding with an agent-created file", async () => {
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(
      workdir,
      "fresh.ts",
      "export const fresh = 1; // agent\n",
      "agent creates fresh",
    );

    // Create an UNTRACKED file at the same path on repoRoot. Without the
    // snapshot pre-flight, `git merge --ff-only` would refuse to overwrite an
    // untracked file. The pre-flight stages and commits it, then -X theirs lets
    // the agent's version win during rebase.
    await Bun.write(join(repo.path, "fresh.ts"), "// user untracked\n");

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D4",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);

    // Agent wins in the working tree.
    const finalFresh = await Bun.file(join(repo.path, "fresh.ts")).text();
    expect(finalFresh).toContain("// agent");
    expect(finalFresh).not.toContain("user untracked");

    // Snapshot captured the original untracked content (because `git add -A`
    // stages untracked files).
    const snapshots = await snapshotCommits(repo.path);
    expect(snapshots.length).toBe(1);
    expect(await fileAtCommit(repo.path, snapshots[0], "fresh.ts")).toBe("// user untracked\n");
  });

  test("D5: mix of unstaged + staged + untracked all captured in one snapshot", async () => {
    // Two pre-existing files on main — one for the unstaged dirty edit, one for
    // the staged dirty edit. The untracked file is created fresh.
    await commitFiles(
      repo.path,
      {
        "unstaged.md": "# unstaged base\n",
        "staged.md": "# staged base\n",
      },
      "seed mixed",
    );

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "feature.ts", "export const f = 1;\n", "agent feature");

    // D1 piece: unstaged tracked modification.
    await Bun.write(join(repo.path, "unstaged.md"), "# unstaged DIRTY\n");
    // D3 piece: staged change.
    await Bun.write(join(repo.path, "staged.md"), "# staged DIRTY\n");
    await $`git add staged.md`.cwd(repo.path).env(gitEnv()).quiet();
    // D4 piece: untracked file (no name collision this time — just preserve it).
    await Bun.write(join(repo.path, "scratch.txt"), "scratch content\n");

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D5",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);

    const snapshots = await snapshotCommits(repo.path);
    expect(snapshots.length).toBe(1);
    const sha = snapshots[0];

    // All three dirty pieces recoverable from the single snapshot.
    expect(await fileAtCommit(repo.path, sha, "unstaged.md")).toBe("# unstaged DIRTY\n");
    expect(await fileAtCommit(repo.path, sha, "staged.md")).toBe("# staged DIRTY\n");
    expect(await fileAtCommit(repo.path, sha, "scratch.txt")).toBe("scratch content\n");

    // Agent's commit also landed on main.
    expect(await Bun.file(join(repo.path, "feature.ts")).text()).toContain("f = 1");
  });
});

describe("integrateMerge strategy", () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await createRepo();
  });
  afterEach(() => repo.cleanup());

  test("clean two-branch setup integrates without invoking fixer (I1)", async () => {
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const strategy = integrateMerge();
    expect(strategy.kind).toBe("merge");

    const cli = new FailIfSpawnedCLI();
    const result = await strategy.run({
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

    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
    expect(log).toContain("fresh feature");
  });

  test("integrateMerge auto-resolves content conflict to agent via -X theirs (I2)", async () => {
    const { workdir, branch, file } = await setupSingleFileConflict(repo.path);

    const cli = new FailIfSpawnedCLI();

    const result = await integrateMerge().run({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "fix it",
      cli,
      postFixChecks: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);

    const finalContent = await Bun.file(join(repo.path, file)).text();
    expect(finalContent).toContain("// branch");
    expect(finalContent).not.toContain("<<<<<<<");
  });
});

describe("integratePR strategy", () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await createRepo();
  });
  afterEach(() => repo.cleanup());

  test("github: missing gh fails fast at pre-flight, no rebase attempted (I3)", async () => {
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    // Empty PATH ensures `gh` cannot be found.
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      // Force github provider so we don't run `git remote get-url` in detection.
      const result = await integratePR({ provider: "github" }).run({
        workdir,
        branch,
        repoRoot: repo.path,
        baseBranch: "main",
        originalGoal: "no conflict",
        cli: new FailIfSpawnedCLI(),
        postFixChecks: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/gh not installed/);
        expect(result.fixerIters).toBe(0);
      }
    } finally {
      process.env.PATH = originalPath;
    }

    // Sanity-check: rebase was not attempted — workdir is still on its commit
    // with no rebase markers and the branch HEAD hasn't changed.
    const headInWorkdir = (await $`git rev-parse HEAD`.cwd(workdir).quiet()).text().trim();
    const branchHead = (await $`git rev-parse ${branch}`.cwd(repo.path).quiet()).text().trim();
    expect(headInWorkdir).toBe(branchHead);
  });

  test("gitlab: missing glab fails fast at pre-flight (I4)", async () => {
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await integratePR({ provider: "gitlab" }).run({
        workdir,
        branch,
        repoRoot: repo.path,
        baseBranch: "main",
        originalGoal: "no conflict",
        cli: new FailIfSpawnedCLI(),
        postFixChecks: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/glab not installed/);
        expect(result.fixerIters).toBe(0);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe("detectProvider", () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await createRepo();
  });
  afterEach(() => repo.cleanup());

  test("returns gitlab for a gitlab.com SSH URL (I5)", async () => {
    await $`git remote add origin git@gitlab.com:foo/bar.git`.cwd(repo.path).env(gitEnv()).quiet();
    const provider = await detectProvider(repo.path, "origin");
    expect(provider).toBe("gitlab");
  });

  test("returns github for a github.com HTTPS URL (I6)", async () => {
    await $`git remote add origin https://github.com/foo/bar.git`
      .cwd(repo.path)
      .env(gitEnv())
      .quiet();
    const provider = await detectProvider(repo.path, "origin");
    expect(provider).toBe("github");
  });
});
