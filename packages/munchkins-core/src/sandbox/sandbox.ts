import { $ } from "bun";
import { cleanupWorktree, createWorktree, deleteBranch } from "../worktree.js";

export interface TeardownContext {
  failureReason?: string;
}

export type TeardownResult = { ok: true } | { ok: false; reason: string };

export interface SandboxHandle {
  cwd: string;
  env: Record<string, string>;
  diff?: () => Promise<string>;
  /**
   * Cleanup-only contract. On "pass": asserts no uncommitted changes left in
   * the sandbox, then removes the worktree and branch. On "fail": preserves
   * the worktree and branch for the operator and returns `{ ok: true }`.
   * Throws only on caller errors (e.g. uncommitted changes left on a "pass"
   * run). Integration is the run layer's responsibility — callers must have
   * already integrated (or chosen not to) before invoking teardown.
   */
  teardown(outcome: "pass" | "fail", ctx?: TeardownContext): Promise<TeardownResult>;
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
          return { ok: true };
        }
        const status = (await $`git status --porcelain`.cwd(path).quiet()).text().trim();
        if (status) {
          throw new Error(
            `worktree ${path} has uncommitted changes; agent must commit before teardown:\n${status}`,
          );
        }
        await cleanupWorktree(path, repoRoot);
        await deleteBranch(currentBranch, repoRoot);
        return { ok: true };
      },
    };
  };
}
