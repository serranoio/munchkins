import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { $ } from "bun";

const WORKTREE_DIR = ".worktrees";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export async function createWorktree(
  agentName: string,
  repoRoot: string,
  branchName?: string,
): Promise<WorktreeInfo> {
  if (!isAbsolute(repoRoot)) {
    throw new Error(`createWorktree: repoRoot must be absolute, got ${repoRoot}`);
  }
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const branch = branchName ?? `agent/${agentName}-${suffix}`;
  const path = join(repoRoot, WORKTREE_DIR, `${agentName}-${suffix}`);

  await $`mkdir -p ${join(repoRoot, WORKTREE_DIR)}`.quiet();
  await $`git worktree add ${path} -b ${branch}`.cwd(repoRoot).quiet();

  // Fresh git worktrees never include node_modules (gitignored), so DEFAULT_CHECKS
  // like `bun run typecheck` would fail on missing per-workspace deps. Run `bun
  // install` once in the new worktree to populate them. Skip when there's no
  // package.json (test fixtures, non-bun trees).
  if (existsSync(join(path, "package.json"))) {
    const install = await $`bun install`.cwd(path).nothrow().quiet();
    if (install.exitCode !== 0) {
      throw new Error(
        `createWorktree: bun install failed in ${path}:\n${install.stderr.toString().slice(-1000)}`,
      );
    }
  }

  return { path, branch };
}

export async function renameBranch(
  oldBranch: string,
  newBranch: string,
  repoRoot: string,
): Promise<void> {
  if (oldBranch === newBranch) return;
  await $`git branch -m ${oldBranch} ${newBranch}`.cwd(repoRoot).quiet();
}

export async function cleanupWorktree(worktreePath: string, repoRoot: string): Promise<void> {
  await $`git worktree remove ${worktreePath} --force`.cwd(repoRoot).quiet();
}

// Safety guard: only delete branches that carry a single-segment slug prefix
// (e.g. `agent/...`, `director/...`). Bare names like `main` / `master` /
// `develop` never match — the slash is required.
const NAMESPACED_BRANCH_RE = /^[A-Za-z0-9_-]+\/[^/]/;

export async function deleteBranch(branch: string, repoRoot: string): Promise<void> {
  if (!branch || !NAMESPACED_BRANCH_RE.test(branch)) return;
  await $`git branch -D ${branch}`.cwd(repoRoot).quiet();
}

export async function listWorktrees(repoRoot: string): Promise<string[]> {
  const result = await $`git worktree list --porcelain`.cwd(repoRoot).quiet();
  const lines = result.text().split("\n");

  const worktrees: string[] = [];
  for (const line of lines) {
    if (line.startsWith("worktree ") && line.includes(WORKTREE_DIR)) {
      worktrees.push(line.replace("worktree ", ""));
    }
  }

  return worktrees;
}

export async function worktreeExists(worktreePath: string, repoRoot: string): Promise<boolean> {
  const worktrees = await listWorktrees(repoRoot);
  return worktrees.some((w) => w === worktreePath);
}
