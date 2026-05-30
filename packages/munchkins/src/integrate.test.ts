import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    // "main edit" is a direct commit on main and always visible in the log.
    // "branch edit" is squashed into the single squash commit — verify via
    // working-tree content rather than commit subject.
    const log = (await $`git log --oneline main`.cwd(repo.path).quiet()).text();
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

    // Squash produces a single commit on main (message: "agent: <branch>").
    // Verify the branch's content landed in the working tree.
    expect(await Bun.file(join(repo.path, "fresh.ts")).text()).toContain("fresh = 1");
  });
});

describe("integrateBranch commits dirty repoRoot as operator WIP", () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await createRepo();
  });
  afterEach(() => repo.cleanup());

  const OPERATOR_WIP = { agent: "bug-fix", slug: "fix-it" };
  const EXPECTED_WIP_SUBJECT = `wip(operator): changes captured before ${OPERATOR_WIP.agent}/${OPERATOR_WIP.slug}`;

  test("D1: dirty tracked file lands as operator WIP under agent squash", async () => {
    await commitFile(repo.path, "README.md", "# original\n", "add readme");
    await Bun.write(join(repo.path, "README.md"), "# dirty edit\n");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const cli = new FailIfSpawnedCLI();
    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D1",
      cli,
      postFixChecks: [],
      commitMessage: "feat: fresh module",
      operatorWipContext: OPERATOR_WIP,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixerIters).toBe(0);
    expect(cli.invocations).toBe(0);

    const headSubject = (await $`git log -1 --format=%s main`.cwd(repo.path).quiet()).text().trim();
    expect(headSubject).toBe("feat: fresh module");

    const parentSubject = (await $`git log -1 --format=%s main^`.cwd(repo.path).quiet())
      .text()
      .trim();
    expect(parentSubject).toBe(EXPECTED_WIP_SUBJECT);

    // The dirty edit is preserved in the WIP commit's tree.
    const wipContent = (await $`git show main^:README.md`.cwd(repo.path).quiet()).text();
    expect(wipContent).toBe("# dirty edit\n");
  });

  test("D2: untracked file is committed into operator WIP and reaches main", async () => {
    await commitFile(repo.path, "seed.md", "seed\n", "seed");
    await Bun.write(join(repo.path, "scratch.txt"), "scratch content\n");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D2",
      cli: new FailIfSpawnedCLI(),
      postFixChecks: [],
      commitMessage: "feat: fresh module",
      operatorWipContext: OPERATOR_WIP,
    });

    expect(result.ok).toBe(true);

    const parentSubject = (await $`git log -1 --format=%s main^`.cwd(repo.path).quiet())
      .text()
      .trim();
    expect(parentSubject).toBe(EXPECTED_WIP_SUBJECT);

    // The previously-untracked file is now tracked at the operator WIP commit
    // and survives onto main's working tree.
    const wipTracked = (await $`git show main^:scratch.txt`.cwd(repo.path).quiet()).text();
    expect(wipTracked).toBe("scratch content\n");
    expect(await Bun.file(join(repo.path, "scratch.txt")).text()).toBe("scratch content\n");
  });

  test("D3: dirty content under .worktrees/ is ignored — no operator WIP commit", async () => {
    const mainShaBefore = (await $`git rev-parse main`.cwd(repo.path).quiet()).text().trim();

    // Set up an agent branch first so the `.worktrees/` directory exists.
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    // Drop a stray file under `.worktrees/` directly in repoRoot — the pathspec
    // exclusion must skip it so integration proceeds as if clean.
    await Bun.write(join(repo.path, ".worktrees", "stray.txt"), "ignored\n");

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D3",
      cli: new FailIfSpawnedCLI(),
      postFixChecks: [],
      commitMessage: "feat: fresh module",
      operatorWipContext: OPERATOR_WIP,
    });

    expect(result.ok).toBe(true);

    const headSubject = (await $`git log -1 --format=%s main`.cwd(repo.path).quiet()).text().trim();
    expect(headSubject).toBe("feat: fresh module");

    // No operator WIP between main^ and the pre-integration tip — main advanced
    // by exactly one commit (the squash).
    const parentSha = (await $`git rev-parse main^`.cwd(repo.path).quiet()).text().trim();
    expect(parentSha).toBe(mainShaBefore);
  });

  test("D4: omitting operatorWipContext falls back to branch-named WIP subject", async () => {
    await commitFile(repo.path, "README.md", "# original\n", "add readme");
    await Bun.write(join(repo.path, "README.md"), "# dirty edit\n");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const result = await integrateBranch({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "D4",
      cli: new FailIfSpawnedCLI(),
      postFixChecks: [],
      commitMessage: "feat: fresh module",
      // operatorWipContext intentionally omitted — exercise the fallback.
    });

    expect(result.ok).toBe(true);

    const parentSubject = (await $`git log -1 --format=%s main^`.cwd(repo.path).quiet())
      .text()
      .trim();
    expect(parentSubject).toBe(`wip(operator): changes captured before ${branch}`);
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

    // Squash lands agent's content in a single commit; verify via working tree.
    expect(await Bun.file(join(repo.path, "fresh.ts")).text()).toContain("fresh = 1");
  });

  test("integrateMerge threads operatorWipContext through to the WIP commit subject", async () => {
    await commitFile(repo.path, "README.md", "# original\n", "add readme");
    await Bun.write(join(repo.path, "README.md"), "# dirty edit\n");

    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "fresh feature");

    const result = await integrateMerge().run({
      workdir,
      branch,
      repoRoot: repo.path,
      baseBranch: "main",
      originalGoal: "thread context",
      cli: new FailIfSpawnedCLI(),
      postFixChecks: [],
      commitMessage: "feat: fresh module",
      operatorWipContext: { agent: "feat-small", slug: "thread-it" },
    });

    expect(result.ok).toBe(true);

    const parentSubject = (await $`git log -1 --format=%s main^`.cwd(repo.path).quiet())
      .text()
      .trim();
    expect(parentSubject).toBe("wip(operator): changes captured before feat-small/thread-it");
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

interface GhStub {
  dir: string;
  invocationsDir: string;
  cleanup: () => void;
}

// Stand up a fake `gh` on PATH that records its argv to one file per arg
// (preserving newlines in `--body`) and prints `prUrl` to stdout. Returns
// handles so the test can read the recorded args and tear the stub down.
function makeGhStub(prUrl: string, cliName: "gh" | "glab" = "gh"): GhStub {
  const dir = mkdtempSync(join(tmpdir(), `munchkins-${cliName}-stub-`));
  const invocationsDir = join(dir, "invocations");
  const script = `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "${invocationsDir}"
i=0
for a in "$@"; do
  printf '%s' "$a" > "${invocationsDir}/arg-$(printf '%03d' $i)"
  i=$((i+1))
done
printf '%s\\n' "${prUrl}"
`;
  const stubPath = join(dir, cliName);
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);
  return {
    dir,
    invocationsDir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

function readStubArgs(invocationsDir: string): string[] {
  const files = readdirSync(invocationsDir).sort();
  return files.map((f) => readFileSync(join(invocationsDir, f), "utf-8"));
}

// Bare-repo origin so `git push -u origin <branch>` succeeds against a real
// remote without touching the network. `main` is seeded onto the bare repo so
// the agent branch has somewhere to push from.
async function attachBareOrigin(
  repoRoot: string,
): Promise<{ barePath: string; cleanup: () => void }> {
  const barePath = mkdtempSync(join(tmpdir(), "munchkins-bare-origin-"));
  await $`git init --bare -b main`.cwd(barePath).quiet();
  await $`git remote add origin ${barePath}`.cwd(repoRoot).env(gitEnv()).quiet();
  await $`git push -u origin main`.cwd(repoRoot).env(gitEnv()).quiet();
  return {
    barePath,
    cleanup: () => {
      try {
        rmSync(barePath, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

describe("integratePR happy path", () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await createRepo();
  });
  afterEach(() => repo.cleanup());

  test("clean branch: pushes to origin, opens PR with summary, main unchanged (I7)", async () => {
    const origin = await attachBareOrigin(repo.path);
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "fresh.ts", "export const fresh = 1;\n", "feat: add fresh");

    // Acceptance: branch follows `agent/<slug>-<hash>`.
    expect(branch).toMatch(/^agent\/bug-fix-/);

    const tipSha = (await $`git rev-parse HEAD`.cwd(workdir).quiet()).text().trim();
    const mainShaBefore = (await $`git rev-parse main`.cwd(repo.path).quiet()).text().trim();

    const stub = makeGhStub("https://github.com/foo/bar/pull/42");
    const originalPath = process.env.PATH;
    process.env.PATH = `${stub.dir}:${originalPath ?? ""}`;
    try {
      const result = await integratePR({ provider: "github" }).run({
        workdir,
        branch,
        repoRoot: repo.path,
        baseBranch: "main",
        originalGoal: "add a tiny module",
        cli: new FailIfSpawnedCLI(),
        postFixChecks: [],
        commitMessage: "feat: add fresh",
        markdownSummary: "## Summary\n\nAdded a small module that exports a constant.\n",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fixerIters).toBe(0);
        expect(result.prUrl).toBe("https://github.com/foo/bar/pull/42");
      }

      // Acceptance: gh invoked with the right title/body/base.
      const args = readStubArgs(stub.invocationsDir);
      expect(args[0]).toBe("pr");
      expect(args[1]).toBe("create");
      expect(args).toContain("--title");
      expect(args).toContain("--body");
      expect(args).toContain("--base");
      expect(args[args.indexOf("--title") + 1]).toBe("feat: add fresh");
      expect(args[args.indexOf("--body") + 1]).toBe(
        "## Summary\n\nAdded a small module that exports a constant.\n",
      );
      expect(args[args.indexOf("--base") + 1]).toBe("main");

      // Acceptance: branch reached origin (push happened, not force).
      const remoteSha = (
        await $`git ls-remote ${origin.barePath} refs/heads/${branch}`.cwd(repo.path).quiet()
      )
        .text()
        .trim()
        .split(/\s+/)[0];
      expect(remoteSha).toBe(tipSha);

      // Acceptance: local main does NOT advance under PR strategy.
      const mainShaAfter = (await $`git rev-parse main`.cwd(repo.path).quiet()).text().trim();
      expect(mainShaAfter).toBe(mainShaBefore);

      // Acceptance: SHAs match local — no force-push surprises.
      const branchShaLocal = (await $`git rev-parse ${branch}`.cwd(repo.path).quiet())
        .text()
        .trim();
      expect(branchShaLocal).toBe(tipSha);
    } finally {
      process.env.PATH = originalPath;
      stub.cleanup();
      origin.cleanup();
    }
  });

  test("director-prefixed branch pushes + opens PR under director/<...> (I8)", async () => {
    const origin = await attachBareOrigin(repo.path);
    // Caller-supplied branch — mirrors AgentBuilder's branch-prefix rename
    // landing the worktree on `director/<slug>-<hash>` before integration.
    const directorBranch = "director/feat-thing-deadbeef";
    const { path: workdir, branch } = await createWorktree("feat-small", repo.path, directorBranch);
    expect(branch).toBe(directorBranch);
    await commitFile(workdir, "thing.ts", "export const t = 1;\n", "feat: thing");
    const tipSha = (await $`git rev-parse HEAD`.cwd(workdir).quiet()).text().trim();

    const stub = makeGhStub("https://github.com/foo/bar/pull/99");
    const originalPath = process.env.PATH;
    process.env.PATH = `${stub.dir}:${originalPath ?? ""}`;
    try {
      const result = await integratePR({ provider: "github" }).run({
        workdir,
        branch,
        repoRoot: repo.path,
        baseBranch: "main",
        originalGoal: "director-dispatched work",
        cli: new FailIfSpawnedCLI(),
        postFixChecks: [],
        commitMessage: "feat: thing",
        markdownSummary: "director run",
      });

      expect(result.ok).toBe(true);

      // Acceptance: branch on origin matches `director/*` pattern that the
      // director's inflight survey grep depends on.
      const remoteRefs = (
        await $`git ls-remote ${origin.barePath} 'refs/heads/director/*'`.cwd(repo.path).quiet()
      )
        .text()
        .trim();
      expect(remoteRefs).toContain(`refs/heads/${directorBranch}`);
      expect(remoteRefs.split(/\s+/)[0]).toBe(tipSha);
    } finally {
      process.env.PATH = originalPath;
      stub.cleanup();
      origin.cleanup();
    }
  });

  test("missing commitMessage + summary → safe fallback title and body (I9)", async () => {
    const origin = await attachBareOrigin(repo.path);
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "x.ts", "export const x = 1;\n", "commit");

    const stub = makeGhStub("https://github.com/foo/bar/pull/1");
    const originalPath = process.env.PATH;
    process.env.PATH = `${stub.dir}:${originalPath ?? ""}`;
    try {
      const result = await integratePR({ provider: "github" }).run({
        workdir,
        branch,
        repoRoot: repo.path,
        baseBranch: "main",
        originalGoal: "no summary writer ran",
        cli: new FailIfSpawnedCLI(),
        postFixChecks: [],
        // commitMessage and markdownSummary intentionally omitted.
      });
      expect(result.ok).toBe(true);

      const args = readStubArgs(stub.invocationsDir);
      expect(args[args.indexOf("--title") + 1]).toBe(`agent: ${branch}`);
      expect(args[args.indexOf("--body") + 1]).toBe("(no summary writer ran)");
    } finally {
      process.env.PATH = originalPath;
      stub.cleanup();
      origin.cleanup();
    }
  });

  test("gh pr create failure surfaces as IntegrationResult error (I10)", async () => {
    const origin = await attachBareOrigin(repo.path);
    const { path: workdir, branch } = await createWorktree("bug-fix", repo.path);
    await commitFile(workdir, "x.ts", "export const x = 1;\n", "commit");

    // Stub that exits non-zero.
    const dir = mkdtempSync(join(tmpdir(), "munchkins-gh-fail-stub-"));
    const stubPath = join(dir, "gh");
    writeFileSync(
      stubPath,
      "#!/usr/bin/env bash\necho 'gh: API rate limit exceeded' 1>&2\nexit 1\n",
    );
    chmodSync(stubPath, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${dir}:${originalPath ?? ""}`;
    try {
      const result = await integratePR({ provider: "github" }).run({
        workdir,
        branch,
        repoRoot: repo.path,
        baseBranch: "main",
        originalGoal: "x",
        cli: new FailIfSpawnedCLI(),
        postFixChecks: [],
        commitMessage: "x",
        markdownSummary: "x",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/gh pr create failed/);
        expect(result.reason).toMatch(/rate limit/);
      }
      // Push happened before gh create, so the branch is still on origin —
      // confirm we don't claim success when the PR step fails.
      const remoteSha = (
        await $`git ls-remote ${origin.barePath} refs/heads/${branch}`.cwd(repo.path).quiet()
      )
        .text()
        .trim();
      expect(remoteSha.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
      origin.cleanup();
    }
  });
});
