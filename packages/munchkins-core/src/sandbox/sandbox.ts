import { existsSync, realpathSync } from "node:fs";
import { $ } from "bun";
import { cleanupWorktree, createWorktree, deleteBranch } from "../worktree.js";

// macOS resolves /var → /private/var, so a path captured at run time may not
// match the canonical form `git worktree list` reports back. Compare against
// realpath when the literal form misses.
function worktreeRegistered(wtList: string, path: string): boolean {
  if (wtList.includes(`worktree ${path}`)) return true;
  try {
    return wtList.includes(`worktree ${realpathSync(path)}`);
  } catch {
    return false;
  }
}

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

export type SandboxState =
  | { kind: "git-worktree"; path: string; branch: string }
  | { kind: "none" };

export interface SandboxFactory {
  create(agentName: string, repoRoot: string): Promise<SandboxHandle>;
  rehydrate?(state: SandboxState, repoRoot: string): Promise<SandboxHandle>;
}

function buildHandle(path: string, branch: string, repoRoot: string): SandboxHandle {
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
}

export function gitWorktreeSandbox(): SandboxFactory {
  return {
    async create(agentName, repoRoot) {
      const { path, branch } = await createWorktree(agentName, repoRoot);
      return buildHandle(path, branch, repoRoot);
    },
    async rehydrate(state, repoRoot) {
      if (state.kind !== "git-worktree") {
        throw new Error(
          `gitWorktreeSandbox.rehydrate: expected sandbox state kind "git-worktree", got "${state.kind}"`,
        );
      }
      const { path, branch } = state;
      if (!existsSync(path)) {
        throw new Error(`Worktree at ${path} no longer exists. Run cannot be resumed.`);
      }
      const wtList = (await $`git worktree list --porcelain`.cwd(repoRoot).quiet()).text();
      if (!worktreeRegistered(wtList, path)) {
        throw new Error(`Worktree at ${path} not registered with git. Manual recovery required.`);
      }
      const branchExists =
        (
          await $`git rev-parse --verify --quiet ${`refs/heads/${branch}`}`
            .cwd(repoRoot)
            .nothrow()
            .quiet()
        ).exitCode === 0;
      if (!branchExists) {
        throw new Error(`Branch ${branch} no longer exists.`);
      }
      const status = (await $`git status --porcelain`.cwd(path).quiet()).text().trim();
      if (status) {
        console.error(
          `[resume] Resuming with uncommitted changes — model will see partial work via git status.`,
        );
      }
      return buildHandle(path, branch, repoRoot);
    },
  };
}
