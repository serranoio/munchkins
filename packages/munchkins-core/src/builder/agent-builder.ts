import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { $ } from "bun";
import { RunLog } from "../run-log.js";
import type { IntegrateContext, SandboxFactory, SandboxHandle } from "../sandbox/sandbox.js";
import { renameBranch } from "../worktree.js";
import { AgentCLI } from "./agent-cli.js";
import { Prompt } from "./prompt.js";
import { banner, C, printInvocation, RunLogger } from "./run-logger.js";
import { deriveSlugDeterministic, getSlugWithRetry, type SlugResult } from "./slug.js";
import { spawnClaude } from "./spawn-claude.js";

export interface OptionSchema {
  type: "string" | "boolean" | "number" | "string[]";
  required?: boolean;
  description: string;
  default?: string | boolean | number | string[];
}

export type Verbosity = "default" | "thinking" | "verbose";

export interface CronConfig {
  spec: string;
  userMessage: string;
  verbosity: Verbosity;
}

type AgentStep = { kind: "agent"; prompt: Prompt };
type DeterministicStep = {
  kind: "deterministic";
  commands: string[];
  loop?: { maxIterations: number; fixer: Prompt };
};
type Step = AgentStep | DeterministicStep;

export interface RunResult {
  worktreePath: string;
  branch: string;
  succeeded: boolean;
  failureReason?: string;
}

export class AgentBuilder {
  readonly name: string;
  readonly description?: string;
  readonly sandbox?: SandboxFactory;
  readonly options = new Map<string, OptionSchema>();

  private steps: Step[] = [];
  private summaryWriterPrompt?: Prompt;
  private cronConfig?: CronConfig;

  constructor(name: string, description?: string, sandbox?: SandboxFactory) {
    this.name = name;
    this.description = description;
    this.sandbox = sandbox;
  }

  option(name: string, schema: OptionSchema): this {
    if (this.options.has(name)) {
      throw new Error(`Option "${name}" already declared on agent "${this.name}"`);
    }
    this.options.set(name, schema);
    return this;
  }

  add(prompt: Prompt): this {
    this.steps.push({ kind: "agent", prompt });
    for (const f of prompt.fragments) {
      if (f.kind !== "input-from-option" || !f.declaration) continue;
      if (this.options.has(f.optionName)) continue;
      this.options.set(f.optionName, {
        type: "string",
        required: f.declaration.required ?? false,
        description: f.declaration.description,
        default: f.declaration.default,
      });
    }
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

  summaryWriter(prompt: Prompt): this {
    this.summaryWriterPrompt = prompt;
    return this;
  }

  cron(spec: string, opts: { userMessage: string; verbosity?: Verbosity }): this {
    if (this.cronConfig) {
      throw new Error(
        `cron() already configured on agent "${this.name}" (existing spec: "${this.cronConfig.spec}")`,
      );
    }
    this.cronConfig = {
      spec,
      userMessage: opts.userMessage,
      verbosity: opts.verbosity ?? "default",
    };
    return this;
  }

  getCron(): CronConfig | undefined {
    return this.cronConfig;
  }

  async run(): Promise<RunResult> {
    const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();

    if (process.env.__MUNCHKINS_OPT_dryRun === "true") {
      this.describe(repoRoot);
      return { worktreePath: "", branch: "", succeeded: true };
    }

    const verbose = process.env.__MUNCHKINS_OPT_verbose === "true";
    const thinking = process.env.__MUNCHKINS_OPT_thinking === "true";
    const streamOutput = verbose || thinking;
    const logger = new RunLogger(this.name, verbose);

    let sandboxHandle: SandboxHandle | undefined;
    let cwd: string;
    let env: Record<string, string | undefined>;

    const userMessageText = readUserMessage(repoRoot);

    const sandboxPromise = this.sandbox
      ? this.sandbox(this.name, repoRoot)
      : Promise.resolve(undefined);
    const slugPromise: Promise<SlugResult> = userMessageText
      ? getSlugWithRetry(userMessageText)
      : Promise.resolve({ slug: deriveSlugDeterministic(this.name) || this.name });

    const [slugResult, sandboxResult] = await Promise.all([slugPromise, sandboxPromise]);
    sandboxHandle = sandboxResult;

    if (sandboxHandle) {
      const finalBranch = `agent/${slugResult.slug}-${crypto.randomUUID().slice(0, 8)}`;
      await renameBranch(sandboxHandle.env.BRANCH, finalBranch, repoRoot);
      sandboxHandle.env.BRANCH = finalBranch;
      cwd = sandboxHandle.cwd;
      env = { ...process.env, ...sandboxHandle.env };
    } else {
      cwd = repoRoot;
      env = { ...process.env, REPO_ROOT: repoRoot };
    }

    const runLog = new RunLog(repoRoot, this.name, { slug: slugResult.slug });
    if (slugResult.fallback) {
      runLog.recordEvent({
        type: "slug-fallback",
        attempts: slugResult.fallback.attempts,
        lastError: slugResult.fallback.lastError,
        slug: slugResult.slug,
      });
    }
    const runStart = Date.now();

    logger.starting(cwd, this.steps.length);

    let failureReason: string | undefined;

    try {
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        logger.stepBanner(i, this.steps.length, step.kind);
        if (step.kind === "agent") {
          await this.runAgent(step, cwd, repoRoot, runLog, i, logger, streamOutput);
        } else {
          await this.runDeterministic(step, cwd, repoRoot, env, runLog, i, logger, streamOutput);
        }
      }
    } catch (err) {
      failureReason = (err as Error).message;
    }

    // Summary writer phase — runs after main steps succeed, before teardown
    let commitMessage: string | undefined;
    if (!failureReason && this.summaryWriterPrompt && sandboxHandle?.diff) {
      const writerResult = await this.runSummaryWriter(
        sandboxHandle,
        cwd,
        repoRoot,
        runLog,
        logger,
        streamOutput,
      );
      if (writerResult.failureReason) {
        failureReason = writerResult.failureReason;
      } else {
        commitMessage = writerResult.commitMessage;
      }
    }

    // Hand integration off to the sandbox via teardown. Integration is the
    // default for any sandboxed, non-failed run — agents without a summary
    // writer still get their commits rebased and ff-merged onto the parent.
    // teardown resolves conflicts via the merge-fixer loop and preserves the
    // worktree on failure; a failed integration flips the run's outcome to
    // "fail" here so the on-fail commands and run-log reflect reality.
    if (sandboxHandle) {
      const integrateCtx: IntegrateContext | undefined = !failureReason
        ? {
            originalGoal: userMessageText ?? "",
            postFixChecks: collectPostFixChecks(this.steps),
            cli: AgentCLI.fromEnv(),
            onFixerInvocation: (info) =>
              runLog.fixerInvocation(
                this.steps.length,
                info.iter,
                info.systemPrompt,
                info.userPrompt,
                info.response,
                info.exitCode,
                info.durationMs,
              ),
            log: (line) => logger.integrationLine(line),
          }
        : undefined;
      const initialOutcome = failureReason ? "fail" : "pass";
      const teardownResult = await sandboxHandle.teardown(initialOutcome, {
        failureReason,
        integrate: integrateCtx,
      });
      if (!teardownResult.ok) {
        failureReason = teardownResult.reason;
      }
    }

    const totalDurationS = ((Date.now() - runStart) / 1000).toFixed(1);

    if (!failureReason) {
      logger.pass({
        totalDurationS,
        cost: runLog.getCostUsd(),
        tokensIn: runLog.getTokensIn(),
        tokensOut: runLog.getTokensOut(),
        commitMessage,
      });
    } else {
      logger.fail(failureReason, sandboxHandle);
    }

    const worktreePath = sandboxHandle?.cwd ?? "";
    const branch = sandboxHandle?.env.BRANCH ?? "";

    const summary = runLog.finish({
      worktreePath,
      branch,
      succeeded: !failureReason,
      failureReason,
    });

    logger.logDir(summary.logDir);

    if (!failureReason) {
      return { worktreePath, branch, succeeded: true };
    }
    return { worktreePath, branch, succeeded: false, failureReason };
  }

  private async runSummaryWriter(
    sandboxHandle: SandboxHandle,
    cwd: string,
    repoRoot: string,
    runLog: RunLog,
    logger: RunLogger,
    streamOutput: boolean,
  ): Promise<{ failureReason?: string; commitMessage?: string }> {
    const diff = await sandboxHandle.diff?.();
    if (!diff?.trim()) {
      logger.summaryWriterEmptyDiff();
      return {};
    }

    const originalGoal = resolveOriginalGoal(repoRoot);
    const userPrompt = buildSummaryWriterUserPrompt(originalGoal, ["```", diff, "```"]);

    const resolved = this.summaryWriterPrompt?.resolve(repoRoot);
    if (!resolved) return {};
    const { systemPrompt } = resolved;

    logger.summaryWriterStart(systemPrompt, userPrompt);

    const startTime = Date.now();
    const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: streamOutput });
    const durationMs = Date.now() - startTime;

    logger.stepResultOk(durationMs, r.usage);

    runLog.accumulateUsage(r.usage);
    runLog.summaryStep(systemPrompt, userPrompt, r.output, r.exitCode, durationMs);

    // Parse the last JSON object containing commitMessage from the output.
    // Tolerate a trailing ``` fence — the prompt forbids it but models still wrap occasionally.
    let cleaned = r.output.trimEnd();
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3).trimEnd();
    const jsonMatch = cleaned.match(/\{[\s\S]*"commitMessage"[\s\S]*\}\s*$/);
    if (!jsonMatch) {
      return {
        failureReason: `summary writer JSON unparseable: no JSON object with "commitMessage" found in output`,
      };
    }

    let parsed: { commitMessage?: unknown; markdown?: unknown };
    try {
      parsed = JSON.parse(jsonMatch[0]) as { commitMessage?: unknown; markdown?: unknown };
    } catch (err) {
      return {
        failureReason: `summary writer JSON unparseable: ${(err as Error).message}`,
      };
    }

    if (typeof parsed.commitMessage !== "string" || typeof parsed.markdown !== "string") {
      return {
        failureReason: `summary writer JSON unparseable: commitMessage and markdown must both be strings`,
      };
    }

    runLog.setAgentSummary(parsed.commitMessage, parsed.markdown);

    // Prepend the changelog inside the worktree and commit it on the agent
    // branch so the rebase carries it atomically with the rest of the run's
    // commits. For non-sandboxed runs the file is written but left uncommitted.
    const changelogPath = runLog.prependChangelogIn(cwd);
    if (changelogPath && sandboxHandle) {
      await $`git add ${changelogPath}`.cwd(cwd).quiet();
      await $`git commit -m ${`docs(changelog): ${parsed.commitMessage}`}`.cwd(cwd).quiet();
    }

    return { commitMessage: parsed.commitMessage };
  }

  private describe(repoRoot: string): void {
    banner("agent", `Dry run — ${this.name}`);
    if (this.description) console.log(`${C.dim}description: ${this.description}${C.reset}`);
    console.log(`${C.dim}repoRoot:    ${repoRoot}${C.reset}`);
    console.log(
      `${C.dim}sandbox:     ${this.sandbox !== undefined ? "configured" : "none — runs in repoRoot, no isolation"}${C.reset}`,
    );
    if (this.options.size > 0) {
      console.log(`${C.dim}options:${C.reset}`);
      for (const [name, schema] of this.options) {
        const envKey = `__MUNCHKINS_OPT_${name}`;
        const raw = process.env[envKey];
        const display = raw === undefined ? "(unset)" : raw;
        const flag = name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        console.log(
          `${C.dim}  --${flag}${schema.required ? " (required)" : ""}: ${display}${C.reset}`,
        );
      }
    }
    console.log(`${C.dim}steps:       ${this.steps.length}${C.reset}`);

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (step.kind === "agent") {
        banner("agent", `Step ${i + 1}/${this.steps.length} — agent (resolved)`);
        const { systemPrompt, userPrompt } = step.prompt.resolve(repoRoot);
        printInvocation(systemPrompt, userPrompt);
      } else {
        banner("deterministic", `Step ${i + 1}/${this.steps.length} — deterministic`);
        for (const cmd of step.commands) {
          console.log(`${C.deterministic}  $ ${cmd}${C.reset}`);
        }
        if (step.loop) {
          console.log(
            `${C.dim}  loop: max ${step.loop.maxIterations} iterations; on failure invokes the fixer subagent below.${C.reset}`,
          );
          const { systemPrompt } = step.loop.fixer.resolve(repoRoot);
          console.log(`${C.dim}┌─ fixer system prompt ───────────────────────${C.reset}`);
          console.log(
            systemPrompt
              .split("\n")
              .map((l) => `${C.dim}│${C.reset} ${l}`)
              .join("\n"),
          );
          console.log(`${C.dim}└─────────────────────────────────────────────${C.reset}`);
          console.log(
            `${C.dim}  fixer user prompt: <constructed at run time from the failing command's output>${C.reset}`,
          );
        }
      }
    }

    // Summary writer section
    if (this.summaryWriterPrompt) {
      banner("agent", "Summary writer phase (resolved)");

      const originalGoal = resolveOriginalGoal(repoRoot);
      const userPromptPreview = buildSummaryWriterUserPrompt(originalGoal, [
        "<constructed at run time from sandbox.diff()>",
      ]);

      const { systemPrompt } = this.summaryWriterPrompt.resolve(repoRoot);

      console.log(`${C.dim}  user prompt template:${C.reset}`);
      console.log(
        userPromptPreview
          .split("\n")
          .map((l) => `${C.dim}    ${l}${C.reset}`)
          .join("\n"),
      );
      console.log();
      console.log(`${C.dim}┌─ system prompt ─────────────────────────────${C.reset}`);
      console.log(
        systemPrompt
          .split("\n")
          .map((l) => `${C.dim}│${C.reset} ${l}`)
          .join("\n"),
      );
      console.log(`${C.dim}└─────────────────────────────────────────────${C.reset}`);
    } else {
      console.log(
        `${C.dim}Summary writer: (none — no .summaryWriter() declared on this agent)${C.reset}`,
      );
    }

    banner(
      "pass",
      "DRY RUN COMPLETE — no Claude invoked, no worktree created, no summary writer invoked, no merge",
    );
  }

  private async runAgent(
    step: AgentStep,
    cwd: string,
    repoRoot: string,
    runLog: RunLog,
    stepIndex: number,
    logger: RunLogger,
    streamOutput: boolean,
  ): Promise<void> {
    const { systemPrompt, userPrompt } = step.prompt.resolve(repoRoot);
    logger.agentStepStart(stepIndex, this.steps.length, systemPrompt, userPrompt);
    const startTime = Date.now();
    const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: streamOutput });
    const durationMs = Date.now() - startTime;
    logger.stepResultOk(durationMs, r.usage);
    runLog.agentStep(stepIndex, systemPrompt, userPrompt, r.output, r.exitCode, durationMs);
    runLog.accumulateUsage(r.usage);
    if (r.exitCode !== 0) {
      throw new Error(`agent step failed (exit ${r.exitCode})`);
    }
  }

  private async runDeterministic(
    step: DeterministicStep,
    cwd: string,
    repoRoot: string,
    env: Record<string, string | undefined>,
    runLog: RunLog,
    stepIndex: number,
    logger: RunLogger,
    streamOutput: boolean,
  ): Promise<void> {
    const max = step.loop?.maxIterations ?? 1;
    let lastOutput = "";
    for (let i = 1; i <= max; i++) {
      logger.deterministicIterationHeader(i, max);
      let allPassed = true;
      const entries: { command: string; exitCode: number; output: string }[] = [];
      for (const cmd of step.commands) {
        logger.deterministicCommand(cmd);
        const r = await $`${{ raw: cmd }}`.cwd(cwd).env(env).nothrow().quiet();
        const output = r.stdout.toString() + r.stderr.toString();
        logger.deterministicCommandOutput(output);
        lastOutput = output;
        entries.push({ command: cmd, exitCode: r.exitCode ?? 0, output });
        if (r.exitCode !== 0) {
          allPassed = false;
          break;
        }
      }
      runLog.deterministicIteration(stepIndex, i, entries);

      logger.deterministicQuietSummary(stepIndex, this.steps.length, i, max, entries);

      if (allPassed) return;
      if (step.loop && i < max) {
        const fixer = step.loop.fixer.withUserMessage(
          `Commands failed (iteration ${i}/${max}):\n\n${lastOutput.slice(-4000)}`,
        );
        const { systemPrompt, userPrompt } = fixer.resolve(repoRoot);
        logger.fixerStart(i, systemPrompt, userPrompt);
        const startTime = Date.now();
        const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: streamOutput });
        const durationMs = Date.now() - startTime;
        logger.fixerResult(durationMs, r.usage, r.exitCode);
        runLog.fixerInvocation(
          stepIndex,
          i,
          systemPrompt,
          userPrompt,
          r.output,
          r.exitCode,
          durationMs,
        );
        runLog.accumulateUsage(r.usage);
      }
    }
    throw new Error(
      `deterministic step failed after ${max} iteration(s):\n${lastOutput.slice(-2000)}`,
    );
  }
}

function readUserMessage(repoRoot: string): string | undefined {
  const raw = process.env.__MUNCHKINS_OPT_userMessage;
  if (!raw) return undefined;
  const candidate = isAbsolute(raw) ? raw : join(repoRoot, raw);
  if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
  return raw;
}

function resolveOriginalGoal(repoRoot: string): string {
  return readUserMessage(repoRoot) ?? "(no user message)";
}

function buildSummaryWriterUserPrompt(originalGoal: string, diffSection: string[]): string {
  return [
    "## Original goal",
    originalGoal,
    "",
    "## Staged diff",
    ...diffSection,
    "",
    "Output the JSON envelope.",
  ].join("\n");
}

function collectPostFixChecks(steps: Step[]): string[] {
  // Re-run the most recent deterministic step's commands after a merge fixer.
  // Those are the same gates the agent had to pass — if the fixer's edits break
  // anything they'll fail here too.
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind === "deterministic") return [...s.commands];
  }
  return [];
}
