import { $ } from "bun";
import { cleanupWorktree, createWorktree, deleteBranch } from "../worktree.js";

export interface SandboxHandle {
  cwd: string;
  env: Record<string, string>;
  diff?: () => Promise<string>;
  // Integration (rebase + ff-merge) is performed by the caller before teardown.
  // teardown is responsible for cleanup only: on "pass" it removes the worktree
  // and the agent branch; on "fail" it preserves both for the operator.
  teardown(outcome: "pass" | "fail", ctx?: { failureReason?: string }): Promise<void>;
}

export type SandboxFactory = (agentName: string, repoRoot: string) => Promise<SandboxHandle>;

export function gitWorktreeSandbox(): SandboxFactory {
  return async (agentName, repoRoot) => {
    const { path, branch } = await createWorktree(agentName, repoRoot);
    const env: Record<string, string> = { WORKTREE: path, BRANCH: branch, REPO_ROOT: repoRoot };
    return {
      cwd: path,
      env,
      diff: async () => (await $`git diff main...${env.BRANCH}`.cwd(path).quiet()).text(),
      teardown: async (outcome, ctx) => {
        const currentBranch = env.BRANCH;
        if (outcome !== "pass") {
          console.error(`worktree preserved at ${path} (branch: ${currentBranch})`);
          if (ctx?.failureReason) console.error(`reason: ${ctx.failureReason}`);
          return;
        }
        const status = (await $`git status --porcelain`.cwd(path).quiet()).text().trim();
        if (status) {
          throw new Error(
            `worktree ${path} has uncommitted changes; agent must commit before teardown:\n${status}`,
          );
        }
        // Integration (rebase + ff-merge into the parent branch) happens before
        // teardown is called — this method only cleans up the worktree dir and
        // the agent branch once the work has been integrated.
        await cleanupWorktree(path, repoRoot);
        await deleteBranch(currentBranch, repoRoot);
      },
    };
  };
}
