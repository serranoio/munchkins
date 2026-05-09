import { $ } from "bun";
import { cleanupWorktree, createWorktree, deleteBranch } from "../worktree.js";

export interface SandboxHandle {
  cwd: string;
  env: Record<string, string>;
  diff?: () => Promise<string>;
  teardown(
    outcome: "pass" | "fail",
    ctx?: { commitMessage?: string; failureReason?: string },
  ): Promise<void>;
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
        const msg = ctx?.commitMessage ?? `Merge ${currentBranch}`;
        await $`git merge --no-ff -m ${msg} ${currentBranch}`.cwd(repoRoot).quiet();
        await cleanupWorktree(path, repoRoot);
        await deleteBranch(currentBranch, repoRoot);
      },
    };
  };
}
