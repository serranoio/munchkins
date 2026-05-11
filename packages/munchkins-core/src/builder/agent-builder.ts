import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { $ } from "bun";
import { type IntegrationStrategy, integrateMerge, integratePR } from "../integrate.js";
import {
  RESUME_USER_MESSAGE_SNAPSHOT_ENV,
  type RunState,
  type RunStateStep,
  type StepKind,
  saveState,
} from "../resume/run-state.js";
import { RunLog } from "../run-log.js";
import type { SandboxFactory, SandboxHandle, SandboxState } from "../sandbox/sandbox.js";
import { renameBranch } from "../worktree.js";
import { AgentCLI } from "./agent-cli.js";
import { parseSummaryWriterJson } from "./parse-summary-writer-json.js";
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
  // Internally writable so .rename() / .describe() / .sandbox() can update them.
  // Public reads still see the latest value via the standard field access.
  name: string;
  description?: string;
  sandbox?: SandboxFactory;
  readonly options = new Map<string, OptionSchema>();

  // Exposed (non-public) so .thenRun() can copy state into a fresh builder.
  private steps: Step[] = [];
  private summaryWriterPrompt?: Prompt;
  private cronConfig?: CronConfig;
  private integration?: IntegrationStrategy;
  private _handlesDryRun = false;

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

  summaryWriter(prompt?: Prompt): this {
    this.summaryWriterPrompt = prompt;
    return this;
  }

  integrate(strategy?: IntegrationStrategy): this {
    if (!strategy) {
      this.integration = integrateMerge();

      return this;
    }

    this.integration = strategy;
    return this;
  }

  setSandbox(factory: SandboxFactory): this {
    this.sandbox = factory;
    return this;
  }

  rename(name: string): this {
    this.name = name;
    return this;
  }

  describe(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Returns a NEW AgentBuilder whose steps are this.steps concatenated with
   * other.steps. Sandbox, summaryWriter, and integration are STRIPPED — the
   * caller must set them on the returned builder via .setSandbox() /
   * .summaryWriter() / .integrate(). Does not mutate either input.
   */
  thenRun(other: AgentBuilder): AgentBuilder {
    const composed = new AgentBuilder(this.name, this.description);
    for (const [k, v] of this.options) composed.options.set(k, v);
    for (const [k, v] of other.options) composed.options.set(k, v);
    composed.steps = [...this.steps, ...other.steps];
    if (this.cronConfig) composed.cronConfig = this.cronConfig;
    return composed;
  }

  /** Read-only access to the configured integration strategy. */
  getIntegration(): IntegrationStrategy | undefined {
    return this.integration;
  }

  /** Step count — used by composition tests to assert non-mutation. */
  getStepCount(): number {
    return this.steps.length;
  }

  /** Read-only access to the configured summary writer prompt, if any. */
  getSummaryWriter(): Prompt | undefined {
    return this.summaryWriterPrompt;
  }

  /** Read-only access to the resolved sandbox factory, if any. */
  getSandbox(): SandboxFactory | undefined {
    return this.sandbox;
  }

  /**
   * Resolve which integration strategy to use, applying precedence:
   * operator flag > author declaration > run-layer default (`integrateMerge`).
   * Exposed (with underscore) so tests can verify selection without running
   * the full pipeline.
   */
  _selectIntegrationStrategy(
    flag: string | undefined,
  ): { ok: true; strategy: IntegrationStrategy } | { ok: false; reason: string } {
    if (flag !== undefined && flag !== "merge" && flag !== "pr") {
      return {
        ok: false,
        reason: `unknown integration mode: ${flag}; expected "merge" or "pr"`,
      };
    }
    if (flag === "pr") return { ok: true, strategy: integratePR() };
    if (flag === "merge") return { ok: true, strategy: integrateMerge() };
    return { ok: true, strategy: this.integration ?? integrateMerge() };
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

  /**
   * Opt out of the framework's default `--dry-run` short-circuit. When set,
   * `run()` executes the full pipeline even with `__MUNCHKINS_OPT_dryRun=true`
   * and the agent's own deterministic steps are expected to honor the flag.
   * Used by the director, whose dry-run scope is "skip dispatch only".
   */
  handlesDryRun(value = true): this {
    this._handlesDryRun = value;
    return this;
  }

  getHandlesDryRun(): boolean {
    return this._handlesDryRun;
  }

  async run(): Promise<RunResult> {
    const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();

    if (process.env.__MUNCHKINS_OPT_dryRun === "true" && !this._handlesDryRun) {
      this._printDescribe(repoRoot);
      return { worktreePath: "", branch: "", succeeded: true };
    }

    const prefixResult = resolveBranchPrefix(process.env.__MUNCHKINS_OPT_branchPrefix);
    if (!prefixResult.ok) {
      throw new Error(prefixResult.reason);
    }
    const branchPrefix = prefixResult.prefix;

    const verbose = process.env.__MUNCHKINS_OPT_verbose === "true";
    const logger = new RunLogger(this.name, verbose);

    const userMessageText = readUserMessage(repoRoot);

    const sandboxPromise = this.sandbox
      ? this.sandbox.create(this.name, repoRoot)
      : Promise.resolve(undefined);
    const slugPromise: Promise<SlugResult> = userMessageText
      ? getSlugWithRetry(userMessageText)
      : Promise.resolve({
          slug: deriveSlugDeterministic(this.name) || this.name,
        });

    const [slugResult, sandboxResult] = await Promise.all([slugPromise, sandboxPromise]);
    const sandboxHandle: SandboxHandle | undefined = sandboxResult;

    if (sandboxHandle) {
      const finalBranch = `${branchPrefix}/${slugResult.slug}-${crypto.randomUUID().slice(0, 8)}`;
      await renameBranch(sandboxHandle.env.BRANCH, finalBranch, repoRoot);
      sandboxHandle.env.BRANCH = finalBranch;
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

    const baseBranch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(repoRoot).quiet())
      .text()
      .trim();
    const state: RunState = {
      schemaVersion: 1,
      runId: runLog.dir.split("/").pop() ?? `${this.name}-${Date.now()}`,
      agentName: this.name,
      slug: slugResult.slug,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phase: "steps",
      repoRoot,
      baseBranch,
      userMessageSnapshot: userMessageText ?? "",
      optsEnv: snapshotOptsEnv(),
      sandboxState: sandboxHandleToState(sandboxHandle),
      steps: this.buildInitialSteps(),
    };
    saveState(runLog.dir, state);

    return this.runFromState(state, sandboxHandle, { runLogDir: runLog.dir, runLog, logger });
  }

  /**
   * Execute (or resume) the run pipeline from a serialized RunState. Skips
   * steps already marked completed; for in-progress steps, attempts CLI
   * session resume when the state holds a session id, falling back to a
   * fresh restart with a worktree-state preamble on session-not-found.
   */
  async runFromState(
    state: RunState,
    sandboxHandle: SandboxHandle | undefined,
    deps?: { runLogDir?: string; runLog?: RunLog; logger?: RunLogger },
  ): Promise<RunResult> {
    const verbose = process.env.__MUNCHKINS_OPT_verbose === "true";
    const thinking = process.env.__MUNCHKINS_OPT_thinking === "true";
    const streamOutput = verbose || thinking;
    const logger = deps?.logger ?? new RunLogger(this.name, verbose);
    const runLogDir = deps?.runLogDir ?? "";
    const runLog =
      deps?.runLog ??
      (runLogDir ? RunLog.resume(runLogDir, this.name) : new RunLog(state.repoRoot, this.name));
    const runStart = Date.now();

    const cwd = sandboxHandle?.cwd ?? state.repoRoot;
    const env: Record<string, string | undefined> = sandboxHandle
      ? { ...process.env, ...sandboxHandle.env }
      : { ...process.env, REPO_ROOT: state.repoRoot };

    logger.starting(cwd, state.steps.filter((s) => s.kind !== "summary").length);

    let failureReason: string | undefined;

    try {
      for (let i = 0; i < state.steps.length; i++) {
        const stepState = state.steps[i];
        if (stepState.kind === "summary") continue;
        if (stepState.status === "completed") continue;

        const step = this.steps[stepState.index];
        if (!step) {
          throw new Error(
            `runFromState: step index ${stepState.index} no longer exists on agent "${this.name}" (agent code changed since run started)`,
          );
        }

        logger.stepBanner(stepState.index, this.steps.length, step.kind);
        markStepInProgress(state, runLogDir, stepState);

        if (step.kind === "agent" && stepState.kind === "agent") {
          await this.runAgent(
            step,
            cwd,
            state.repoRoot,
            runLog,
            stepState.index,
            logger,
            streamOutput,
            stepState,
            state,
            runLogDir,
          );
        } else if (step.kind === "deterministic" && stepState.kind === "deterministic") {
          await this.runDeterministic(
            step,
            cwd,
            state.repoRoot,
            env,
            runLog,
            stepState.index,
            logger,
            streamOutput,
          );
        } else {
          throw new Error(
            `runFromState: step kind mismatch at index ${stepState.index} (state=${stepState.kind}, agent=${step.kind})`,
          );
        }

        markStepCompleted(state, runLogDir, stepState);
      }
    } catch (err) {
      failureReason = (err as Error).message;
    }

    // Summary writer phase — runs after main steps succeed, before integration.
    let commitMessage: string | undefined;
    let summaryStep = state.steps.find((s) => s.kind === "summary");
    if (!failureReason && this.summaryWriterPrompt && sandboxHandle?.diff) {
      if (!summaryStep) {
        summaryStep = {
          index: this.steps.length,
          kind: "summary",
          status: "pending",
        };
        state.steps.push(summaryStep);
        saveState(runLogDir, state);
      }
      if (summaryStep.status !== "completed") {
        markStepInProgress(state, runLogDir, summaryStep);
        const writerResult = await this.runSummaryWriter(
          sandboxHandle,
          cwd,
          state.repoRoot,
          runLog,
          logger,
          streamOutput,
          summaryStep,
          state,
          runLogDir,
        );
        if (writerResult.failureReason) {
          failureReason = writerResult.failureReason;
        } else {
          commitMessage = writerResult.commitMessage;
          summaryStep.commitMessage = commitMessage;
          summaryStep.markdown = writerResult.markdown;
          markStepCompleted(state, runLogDir, summaryStep);
        }
      } else {
        commitMessage = summaryStep.commitMessage;
      }
    }

    // Integration phase — strategy precedence: operator flag > author > default.
    let prUrl: string | undefined;
    if (sandboxHandle && !failureReason) {
      state.phase = "integrating";
      saveState(runLogDir, state);
      // No-op if no rebase active; tolerates resume mid-rebase.
      await $`git rebase --abort`.cwd(sandboxHandle.cwd).quiet().nothrow();

      const selection = this._selectIntegrationStrategy(process.env.__MUNCHKINS_OPT_integrate);
      if (!selection.ok) {
        failureReason = selection.reason;
      } else {
        const strategy = selection.strategy;
        const result = await strategy.run({
          workdir: sandboxHandle.cwd,
          branch: sandboxHandle.env.BRANCH,
          repoRoot: state.repoRoot,
          baseBranch: state.baseBranch,
          cli: AgentCLI.fromEnv(),
          postFixChecks: collectPostFixChecks(this.steps),
          originalGoal: state.userMessageSnapshot,
          commitMessage: runLog.getAgentSummaryCommitMessage() ?? commitMessage,
          markdownSummary: runLog.getAgentSummaryMarkdown(),
          log: (line) => logger.integrationLine(line),
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
        });

        if (!result.ok) {
          failureReason = result.reason;
        } else if (result.prUrl) {
          prUrl = result.prUrl;
        }
      }
    }

    // Teardown is now cleanup-only.
    if (sandboxHandle) {
      const initialOutcome = failureReason ? "fail" : "pass";
      const teardownResult = await sandboxHandle.teardown(initialOutcome, {
        failureReason,
      });
      if (!teardownResult.ok) {
        failureReason = teardownResult.reason;
      }
    }

    state.phase = failureReason ? "failed" : "done";
    if (failureReason) state.failureReason = failureReason;
    saveState(runLogDir, state);

    const totalDurationS = ((Date.now() - runStart) / 1000).toFixed(1);

    if (!failureReason) {
      logger.pass({
        totalDurationS,
        cost: runLog.getCostUsd(),
        tokensIn: runLog.getTokensIn(),
        tokensOut: runLog.getTokensOut(),
        commitMessage,
        prUrl,
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

  private buildInitialSteps(): RunStateStep[] {
    const out: RunStateStep[] = [];
    for (let i = 0; i < this.steps.length; i++) {
      const s = this.steps[i];
      const kind: StepKind = s.kind === "agent" ? "agent" : "deterministic";
      out.push({ index: i, kind, status: "pending" });
    }
    return out;
  }

  private async runSummaryWriter(
    sandboxHandle: SandboxHandle,
    cwd: string,
    repoRoot: string,
    runLog: RunLog,
    logger: RunLogger,
    streamOutput: boolean,
    summaryStep: RunStateStep,
    state: RunState,
    runLogDir: string,
  ): Promise<{ failureReason?: string; commitMessage?: string; markdown?: string }> {
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
    const r = await spawnClaude({
      systemPrompt,
      userPrompt,
      cwd,
      stream: streamOutput,
      resumeSessionId: summaryStep.sessionId,
      onSessionId: (sid) => {
        summaryStep.sessionId = sid;
        saveState(runLogDir, state);
      },
    });
    const durationMs = Date.now() - startTime;

    logger.stepResultOk(durationMs, r.usage);

    runLog.accumulateUsage(r.usage);
    runLog.summaryStep(systemPrompt, userPrompt, r.output, r.exitCode, durationMs);

    const parsed = parseSummaryWriterJson(r.output);
    if (!parsed.ok) {
      return {
        failureReason: `summary writer JSON unparseable: ${parsed.reason}`,
      };
    }

    runLog.setAgentSummary(parsed.commitMessage, parsed.markdown);

    // HEAD here points at the agent's last work commit (the docs(changelog)
    // commit hasn't landed yet), so the title's SHA references the actual change.
    const shaResult = await $`git rev-parse --short HEAD`.cwd(cwd).quiet().nothrow();
    const commitSha = shaResult.exitCode === 0 ? shaResult.text().trim() || undefined : undefined;

    const changelogPath = runLog.prependChangelogIn(cwd, commitSha);
    if (changelogPath && sandboxHandle) {
      await $`git add ${changelogPath}`.cwd(cwd).quiet();
      await $`git commit -m ${`docs(changelog): ${parsed.commitMessage}`}`.cwd(cwd).quiet();
    }

    return { commitMessage: parsed.commitMessage, markdown: parsed.markdown };
  }

  private _printDescribe(repoRoot: string): void {
    banner("agent", `Dry run — ${this.name}`);
    if (this.description) console.log(`${C.dim}description: ${this.description}${C.reset}`);
    console.log(`${C.dim}repoRoot:    ${repoRoot}${C.reset}`);
    console.log(
      `${C.dim}sandbox:     ${
        this.sandbox !== undefined ? "configured" : "none — runs in repoRoot, no isolation"
      }${C.reset}`,
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

    const integrationKind =
      process.env.__MUNCHKINS_OPT_integrate ?? this.integration?.kind ?? "merge";
    console.log(`${C.dim}integration: ${integrationKind}${C.reset}`);

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
    stepState: RunStateStep,
    state: RunState,
    runLogDir: string,
  ): Promise<void> {
    const { systemPrompt, userPrompt } = step.prompt.resolve(repoRoot);
    logger.agentStepStart(stepIndex, this.steps.length, systemPrompt, userPrompt);
    const startTime = Date.now();

    const persistSessionId = (sid: string) => {
      stepState.sessionId = sid;
      saveState(runLogDir, state);
    };

    const resumeSessionId = stepState.sessionId;
    let r = await spawnClaude({
      systemPrompt,
      userPrompt,
      cwd,
      stream: streamOutput,
      resumeSessionId,
      onSessionId: persistSessionId,
    });

    if (resumeSessionId && isSessionNotFound(r)) {
      // Session expired or not found — restart fresh with a worktree-state preamble.
      logger.integrationLine(
        `[resume] session ${resumeSessionId} for step ${stepIndex + 1} no longer available; restarting step with worktree-state hint.`,
      );
      stepState.sessionId = undefined;
      saveState(runLogDir, state);
      const preamble = await buildWorktreeStatePreamble(cwd);
      r = await spawnClaude({
        systemPrompt: `${systemPrompt}\n\n${preamble}`,
        userPrompt,
        cwd,
        stream: streamOutput,
        onSessionId: persistSessionId,
      });
    }

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
        const r = await spawnClaude({
          systemPrompt,
          userPrompt,
          cwd,
          stream: streamOutput,
        });
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

// Slashes in a prefix would create nested ref paths and break `gh pr list
// --head` glob matching, so we reject anything outside the slug character set.
const BRANCH_PREFIX_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_BRANCH_PREFIX = "agent";

export type BranchPrefixResult = { ok: true; prefix: string } | { ok: false; reason: string };

export function resolveBranchPrefix(raw: string | undefined): BranchPrefixResult {
  if (raw === undefined || raw === "") return { ok: true, prefix: DEFAULT_BRANCH_PREFIX };
  if (!BRANCH_PREFIX_RE.test(raw)) {
    return {
      ok: false,
      reason: `invalid --branch-prefix: "${raw}". Allowed: alphanumeric characters, dashes, and underscores (no slashes).`,
    };
  }
  return { ok: true, prefix: raw };
}

function readUserMessage(repoRoot: string): string | undefined {
  const snapshot = process.env[RESUME_USER_MESSAGE_SNAPSHOT_ENV];
  if (snapshot !== undefined) return snapshot;
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

function snapshotOptsEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("__MUNCHKINS_OPT_") && typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function sandboxHandleToState(handle: SandboxHandle | undefined): SandboxState {
  if (!handle) return { kind: "none" };
  return { kind: "git-worktree", path: handle.cwd, branch: handle.env.BRANCH ?? "" };
}

function markStepInProgress(state: RunState, runLogDir: string, step: RunStateStep): void {
  step.status = "in-progress";
  if (runLogDir) saveState(runLogDir, state);
}

function markStepCompleted(state: RunState, runLogDir: string, step: RunStateStep): void {
  step.status = "completed";
  if (runLogDir) saveState(runLogDir, state);
}

function isSessionNotFound(r: { exitCode: number; output: string }): boolean {
  if (r.exitCode === 0) return false;
  return /session not found|session.*does not exist|invalid session/i.test(r.output);
}

async function buildWorktreeStatePreamble(cwd: string): Promise<string> {
  const status = (await $`git status --short`.cwd(cwd).quiet().nothrow()).text();
  const diffStat = (await $`git diff --stat HEAD`.cwd(cwd).quiet().nothrow()).text();
  return [
    "NOTE: prior session was lost. Worktree state may already contain partial work — inspect git status before acting.",
    "",
    "## git status --short",
    status.trim() || "(clean)",
    "",
    "## git diff --stat HEAD",
    diffStat.trim() || "(no diff)",
  ].join("\n");
}
