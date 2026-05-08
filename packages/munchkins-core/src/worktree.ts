import { join } from "node:path";
import { $ } from "bun";

const WORKTREE_DIR = ".worktrees";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export async function createWorktree(
  agentName: string,
  instanceIndex?: number,
): Promise<WorktreeInfo> {
  const timestamp = Date.now();
  const suffix = instanceIndex !== undefined ? `${timestamp}-${instanceIndex}` : `${timestamp}`;
  const branch = `agent/${agentName}-${suffix}`;
  const worktreePath = join(WORKTREE_DIR, `${agentName}-${suffix}`);

  await $`mkdir -p ${WORKTREE_DIR}`.quiet();
  await $`git worktree add ${worktreePath} -b ${branch}`.quiet();

  return {
    path: worktreePath,
    branch,
  };
}

export async function cleanupWorktree(worktreePath: string): Promise<void> {
  await $`git worktree remove ${worktreePath} --force`.quiet().nothrow();
}

export async function deleteBranch(branch: string): Promise<void> {
  if (branch?.startsWith("agent/")) {
    await $`git branch -D ${branch}`.quiet().nothrow();
  }
}

export async function listWorktrees(): Promise<string[]> {
  const result = await $`git worktree list --porcelain`.quiet();
  const lines = result.text().split("\n");

  const worktrees: string[] = [];
  for (const line of lines) {
    if (line.startsWith("worktree ") && line.includes(WORKTREE_DIR)) {
      worktrees.push(line.replace("worktree ", ""));
    }
  }

  return worktrees;
}

export async function worktreeExists(worktreePath: string): Promise<boolean> {
  const worktrees = await listWorktrees();
  return worktrees.some((w) => w.includes(worktreePath));
}
