import { $ } from "bun";
import type { AgentCLI } from "../builder/agent-cli.js";
import { integrateBranch } from "../integrate.js";
import { cleanupWorktree, createWorktree, deleteBranch } from "../worktree.js";

export interface IntegrateContext {
  /** Original goal text from the user-message; surfaces in the fixer's user prompt. */
  originalGoal: string;
  /** Deterministic checks to re-run inside the worktree after a fixer iteration. */
  postFixChecks: string[];
  /** CLI used to spawn the merge fixer when conflicts arise. */
  cli: AgentCLI;
  /** Hook for the run-log to capture each fixer invocation. */
  onFixerInvocation?: (info: {
    iter: number;
    systemPrompt: string;
    userPrompt: string;
    response: string;
    exitCode: number;
    durationMs: number;
  }) => void;
  /** Hook for narrating progress to the operator. */
  log?: (line: string) => void;
}

export interface TeardownContext {
  failureReason?: string;
  /**
   * If supplied (and outcome is "pass"), teardown integrates the agent's branch
   * into the parent before cleanup. On integration failure the worktree and
   * branch are preserved and `{ ok: false, reason }` is returned.
   */
  integrate?: IntegrateContext;
}

export type TeardownResult = { ok: true } | { ok: false; reason: string };

export interface SandboxHandle {
  cwd: string;
  env: Record<string, string>;
  diff?: () => Promise<string>;
  /**
   * On "pass": when `ctx.integrate` is provided, runs rebase + ff-merge before
   * cleanup; on integration failure the worktree and branch are preserved and
   * `{ ok: false }` is returned. On "fail": preserves the worktree and branch
   * for the operator and returns `{ ok: true }`. Throws only on caller errors
   * (e.g. uncommitted changes left in the worktree on a "pass" run).
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
        if (ctx?.integrate) {
          const baseBranch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(repoRoot).quiet())
            .text()
            .trim();
          const result = await integrateBranch({
            workdir: path,
            branch: currentBranch,
            repoRoot,
            baseBranch,
            originalGoal: ctx.integrate.originalGoal,
            cli: ctx.integrate.cli,
            postFixChecks: ctx.integrate.postFixChecks,
            onFixerInvocation: ctx.integrate.onFixerInvocation,
            log: ctx.integrate.log,
          });
          if (!result.ok) {
            console.error(`worktree preserved at ${path} (branch: ${currentBranch})`);
            console.error(`reason: ${result.reason}`);
            return { ok: false, reason: result.reason };
          }
        }
        await cleanupWorktree(path, repoRoot);
        await deleteBranch(currentBranch, repoRoot);
        return { ok: true };
      },
    };
  };
}
