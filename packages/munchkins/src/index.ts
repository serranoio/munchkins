#!/usr/bin/env bun
export {
  AgentBuilder,
  type BranchPrefixResult,
  type CronConfig,
  deriveSlugDeterministic,
  type Fragment,
  getSlugWithRetry,
  OPTION_ENV_PREFIX,
  type OptionDeclaration,
  type OptionSchema,
  Prompt,
  type RunResult,
  resolveBranchPrefix,
  SLUG_MAX,
  type SlugFallback,
  type SlugResult,
  type SpawnClaudeOptions,
  type SpawnClaudeResult,
  type SpawnClaudeUsage,
  sanitize,
  spawnClaude,
  type Verbosity,
} from "./builder/index.js";
export {
  detectProvider,
  type IntegrateOptions,
  type IntegratePROptions,
  type IntegrateResult,
  type IntegrationContext,
  type IntegrationResult,
  type IntegrationStrategy,
  integrateBranch,
  integrateMerge,
  integratePR,
  type RebaseAndResolveOptions,
  type RebaseAndResolveResult,
  rebaseAndResolve,
} from "./integrate.js";
export { AgentRegistry, registry } from "./registry/index.js";
export {
  listResumableRuns,
  loadState,
  type ResumableRun,
  type RunPhase,
  type RunResumeDeps,
  type RunResumeResult,
  type RunState,
  type RunStateStep,
  runResume,
  type StepKind,
  type StepStatus,
  saveState,
} from "./resume/index.js";
export { RunLog, type RunSummary } from "./run-log.js";
export {
  gitWorktreeSandbox,
  type SandboxFactory,
  type SandboxHandle,
  type SandboxState,
  type TeardownContext,
  type TeardownResult,
} from "./sandbox/index.js";
export {
  applyTickEnv,
  type CronnedBuilder,
  collectCronnedBuilders,
  type RunDaemonOptions,
  runDaemon,
} from "./scheduler/index.js";
export { type RunStatusDeps, type RunStatusResult, runStatus } from "./status/index.js";
export {
  cleanupWorktree,
  createWorktree,
  deleteBranch,
  listWorktrees,
  renameBranch,
  type WorktreeInfo,
  worktreeExists,
} from "./worktree.js";

import { registry } from "./registry/index.js";
import { registerResumeCommand } from "./resume/command.js";
import { registerDaemonCommand } from "./scheduler/command.js";
import { registerStatusCommand } from "./status/command.js";
import { buildCmuxCommand, shouldDelegateToCmux } from "./cmux-launcher.js";
import { registerSkillsCommand } from "./register-skills-command.js";

registerResumeCommand(registry);
registerStatusCommand(registry);
registerDaemonCommand(registry);
registerSkillsCommand(registry);

export interface RunCliOptions {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export async function runCli(opts: RunCliOptions): Promise<void> {
  const hasCmux = Bun.which("cmux") !== null;
  if (shouldDelegateToCmux({ argv: opts.argv, env: opts.env, hasCmux })) {
    const { command, workspaceName } = buildCmuxCommand({
      argv: opts.argv,
      cwd: opts.cwd,
      now: Date.now(),
      env: opts.env,
    });
    const agentName = opts.argv[2];
    process.stdout.write(`Launching ${agentName} in cmux workspace: ${workspaceName}\n`);
    const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    process.exit(await proc.exited);
  }

  const argv = opts.argv.filter((a) => a !== "--no-cmux");
  await registry.cli().parseAsync(argv);
}

if (import.meta.main) {
  await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });
}
