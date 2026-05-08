import { join } from "node:path";
import { $ } from "bun";

const WORKTREE_DIR = ".worktrees";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

/**
 * Create a new git worktree for an agent.
 *
 * @param agentName Name used for the branch and worktree directory.
 * @param instanceIndex Optional disambiguator for parallel runs. When set, the
 *        index is appended to the branch and path so multiple worktrees with
 *        the same `agentName` started in the same millisecond do not collide.
 */
export async function createWorktree(
  agentName: string,
  instanceIndex?: number,
): Promise<WorktreeInfo> {
  const timestamp = Date.now();
  const suffix = instanceIndex !== undefined ? `${timestamp}-${instanceIndex}` : `${timestamp}`;
  const branch = `agent/${agentName}-${suffix}`;
  const worktreePath = join(WORKTREE_DIR, `${agentName}-${suffix}`);

  // Ensure worktree directory exists
  await $`mkdir -p ${WORKTREE_DIR}`.quiet();

  // Create the worktree with a new branch
  await $`git worktree add ${worktreePath} -b ${branch}`.quiet();

  return {
    path: worktreePath,
    branch,
  };
}

/**
 * Clean up a worktree (but keep the branch for merging)
 */
export async function cleanupWorktree(worktreePath: string): Promise<void> {
  // Remove the worktree only - keep the branch for merging
  await $`git worktree remove ${worktreePath} --force`.quiet().nothrow();
}

/**
 * Delete an agent branch (call after successful merge or when branch is no longer needed)
 */
export async function deleteBranch(branch: string): Promise<void> {
  if (branch?.startsWith("agent/")) {
    await $`git branch -D ${branch}`.quiet().nothrow();
  }
}

/**
 * List all agent worktrees
 */
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

/**
 * Check if a worktree exists at the given path
 */
export async function worktreeExists(worktreePath: string): Promise<boolean> {
  const worktrees = await listWorktrees();
  return worktrees.some((w) => w.includes(worktreePath));
}
