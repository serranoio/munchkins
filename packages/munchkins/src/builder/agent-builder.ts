import { $ } from "bun";
import { cleanupWorktree, createWorktree } from "../worktree.js";
import { Prompt } from "./prompt.js";
import { spawnClaude } from "./spawn-claude.js";

const C = {
  agent: "\x1b[36m",
  deterministic: "\x1b[33m",
  finalize: "\x1b[35m",
  pass: "\x1b[32m",
  fail: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
} as const;

type AgentStep = { kind: "agent"; prompt: Prompt };
type DeterministicStep = {
  kind: "deterministic";
  commands: string[];
  loop?: { maxIterations: number; fixer: Prompt };
};
type FinalizeStep = {
  kind: "finalize";
  commands: string[];
  onPass: string[];
  onFail: string[];
};
type Step = AgentStep | DeterministicStep | FinalizeStep;

export interface RunResult {
  worktreePath: string;
  branch: string;
  succeeded: boolean;
  failureReason?: string;
}

export class AgentBuilder {
  private steps: Step[] = [];
  private agentName: string;

  constructor(agentName = "builder") {
    this.agentName = agentName;
  }

  add(prompt: Prompt): this {
    this.steps.push({ kind: "agent", prompt });
    return this;
  }

  addDeterministic(
    commands: string[],
    opts?: { loop?: { maxIterations?: number; fixer?: Prompt } },
  ): this {
    const loop = opts?.loop
      ? {
          maxIterations: opts.loop.maxIterations ?? 3,
          fixer: opts.loop.fixer ?? new Prompt("docs/subagents/deterministic-fixer.md"),
        }
      : undefined;
    this.steps.push({ kind: "deterministic", commands, loop });
    return this;
  }

  finalize(commands: string[], opts?: { onPass?: string[]; onFail?: string[] }): this {
    this.steps.push({
      kind: "finalize",
      commands,
      onPass: opts?.onPass ?? [],
      onFail: opts?.onFail ?? [],
    });
    return this;
  }

  async run(): Promise<RunResult> {
    const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
    const { path: worktreePath, branch } = await createWorktree(this.agentName);
    const env = {
      ...process.env,
      WORKTREE: worktreePath,
      BRANCH: branch,
      REPO_ROOT: repoRoot,
    };

    banner("agent", `AgentBuilder.run() — ${this.agentName}`);
    console.log(`${C.dim}worktree:  ${worktreePath}${C.reset}`);
    console.log(`${C.dim}branch:    ${branch}${C.reset}`);
    console.log(`${C.dim}steps:     ${this.steps.length}${C.reset}`);

    let failureReason: string | undefined;
    let finalizeStep: FinalizeStep | undefined;

    try {
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        if (step.kind === "agent") {
          banner("agent", `Step ${i + 1}/${this.steps.length} — agent`);
          await this.runAgent(step, worktreePath, repoRoot);
        } else if (step.kind === "deterministic") {
          banner("deterministic", `Step ${i + 1}/${this.steps.length} — deterministic`);
          await this.runDeterministic(step, worktreePath, repoRoot, env);
        } else {
          banner("finalize", `Step ${i + 1}/${this.steps.length} — finalize`);
          finalizeStep = step;
          for (const cmd of step.commands) {
            console.log(`${C.deterministic}  $ ${cmd}${C.reset}`);
            const r = await $`${{ raw: cmd }}`.cwd(worktreePath).env(env).nothrow();
            if (r.exitCode !== 0) {
              throw new Error(
                `finalize command failed: ${cmd}\n${r.stderr.toString().slice(-2000)}`,
              );
            }
          }
        }
      }
    } catch (err) {
      failureReason = (err as Error).message;
    }

    if (!failureReason) {
      banner("pass", "PASS");
      for (const cmd of finalizeStep?.onPass ?? []) {
        console.log(`${C.pass}  $ ${cmd}${C.reset}`);
        await $`${{ raw: cmd }}`.cwd(repoRoot).env(env);
      }
      await cleanupWorktree(worktreePath).catch(() => {});
      return { worktreePath, branch, succeeded: true };
    }

    banner("fail", "FAIL");
    console.error(`${C.dim}reason:   ${failureReason}${C.reset}`);
    console.error(`${C.dim}worktree: ${worktreePath} (preserved)${C.reset}`);
    console.error(`${C.dim}branch:   ${branch} (preserved)${C.reset}`);
    for (const cmd of finalizeStep?.onFail ?? []) {
      console.log(`${C.fail}  $ ${cmd}${C.reset}`);
      await $`${{ raw: cmd }}`
        .cwd(repoRoot)
        .env({ ...env, FAILURE_REASON: failureReason })
        .nothrow();
    }
    return { worktreePath, branch, succeeded: false, failureReason };
  }

  private async runAgent(step: AgentStep, cwd: string, repoRoot: string): Promise<void> {
    const { systemPrompt, userPrompt } = step.prompt.resolve(repoRoot);
    printInvocation(systemPrompt, userPrompt);
    const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: true });
    if (r.exitCode !== 0) {
      throw new Error(`agent step failed (exit ${r.exitCode})`);
    }
  }

  private async runDeterministic(
    step: DeterministicStep,
    cwd: string,
    repoRoot: string,
    env: Record<string, string | undefined>,
  ): Promise<void> {
    const max = step.loop?.maxIterations ?? 1;
    let lastOutput = "";
    for (let i = 1; i <= max; i++) {
      console.log(`${C.deterministic}  iteration ${i}/${max}${C.reset}`);
      let allPassed = true;
      for (const cmd of step.commands) {
        console.log(`${C.deterministic}  $ ${cmd}${C.reset}`);
        const r = await $`${{ raw: cmd }}`.cwd(cwd).env(env).nothrow();
        lastOutput = r.stdout.toString() + r.stderr.toString();
        if (r.exitCode !== 0) {
          allPassed = false;
          break;
        }
      }
      if (allPassed) return;
      if (step.loop && i < max) {
        const fixer = step.loop.fixer.withText(
          `Commands failed (iteration ${i}/${max}):\n\n${lastOutput.slice(-4000)}`,
        );
        const { systemPrompt, userPrompt } = fixer.resolve(repoRoot);
        printInvocation(systemPrompt, userPrompt);
        await spawnClaude({ systemPrompt, userPrompt, cwd, stream: true });
      }
    }
    throw new Error(
      `deterministic step failed after ${max} iteration(s):\n${lastOutput.slice(-2000)}`,
    );
  }
}

function banner(kind: keyof typeof C, text: string): void {
  console.log(`\n${C[kind]}━━━ ${text} ━━━${C.reset}`);
}

function printInvocation(systemPrompt: string, userPrompt: string): void {
  console.log(`${C.dim}┌─ system prompt ─────────────────────────────${C.reset}`);
  console.log(
    systemPrompt
      .split("\n")
      .map((l) => `${C.dim}│${C.reset} ${l}`)
      .join("\n"),
  );
  console.log(`${C.dim}└─────────────────────────────────────────────${C.reset}`);
  console.log(`${C.dim}┌─ user prompt ───────────────────────────────${C.reset}`);
  console.log(
    userPrompt
      .split("\n")
      .map((l) => `${C.dim}│${C.reset} ${l}`)
      .join("\n"),
  );
  console.log(`${C.dim}└─────────────────────────────────────────────${C.reset}`);
}
