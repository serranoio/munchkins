import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { $ } from "bun";
import { RunLog } from "../run-log.js";
import type { SandboxFactory, SandboxHandle } from "../sandbox/sandbox.js";
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

export interface OptionSchema {
  type: "string" | "boolean" | "number" | "string[]";
  required?: boolean;
  description: string;
  default?: string | boolean | number | string[];
}

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
  readonly name: string;
  readonly description?: string;
  readonly sandbox?: SandboxFactory;
  readonly options = new Map<string, OptionSchema>();

  private steps: Step[] = [];
  private summaryWriterPrompt?: Prompt;

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

  finalize(commands: string[], opts?: { onPass?: string[]; onFail?: string[] }): this {
    this.steps.push({
      kind: "finalize",
      commands,
      onPass: opts?.onPass ?? [],
      onFail: opts?.onFail ?? [],
    });
    return this;
  }

  summaryWriter(prompt: Prompt): this {
    this.summaryWriterPrompt = prompt;
    return this;
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

    let sandboxHandle: SandboxHandle | undefined;
    let cwd: string;
    let env: Record<string, string | undefined>;

    if (this.sandbox) {
      sandboxHandle = await this.sandbox(this.name, repoRoot);
      cwd = sandboxHandle.cwd;
      env = { ...process.env, ...sandboxHandle.env };
    } else {
      cwd = repoRoot;
      env = { ...process.env, REPO_ROOT: repoRoot };
    }

    const runLog = new RunLog(repoRoot, this.name);
    const runStart = Date.now();

    if (verbose) {
      banner("agent", `AgentBuilder.run() — ${this.name}`);
      console.log(`${C.dim}cwd:       ${cwd}${C.reset}`);
      console.log(`${C.dim}steps:     ${this.steps.length}${C.reset}`);
    } else {
      process.stdout.write(`[${this.name}] starting\n`);
    }

    let failureReason: string | undefined;
    let finalizeStep: FinalizeStep | undefined;

    try {
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        if (step.kind === "agent") {
          if (verbose) {
            banner("agent", `Step ${i + 1}/${this.steps.length} — agent`);
          }
          await this.runAgent(step, cwd, repoRoot, runLog, i, verbose, streamOutput);
        } else if (step.kind === "deterministic") {
          if (verbose) {
            banner("deterministic", `Step ${i + 1}/${this.steps.length} — deterministic`);
          }
          await this.runDeterministic(step, cwd, repoRoot, env, runLog, i, verbose, streamOutput);
        } else {
          if (verbose) {
            banner("finalize", `Step ${i + 1}/${this.steps.length} — finalize`);
          }
          finalizeStep = step;
          const entries: { command: string; exitCode: number; output: string }[] = [];
          for (const cmd of step.commands) {
            if (verbose) console.log(`${C.deterministic}  $ ${cmd}${C.reset}`);
            const r = await $`${{ raw: cmd }}`.cwd(cwd).env(env).nothrow().quiet();
            const output = r.stdout.toString() + r.stderr.toString();
            if (verbose && output.trim()) process.stdout.write(output);
            entries.push({ command: cmd, exitCode: r.exitCode ?? 0, output });
            if (r.exitCode !== 0) {
              runLog.finalize(i, "fail", entries);
              throw new Error(
                `finalize command failed: ${cmd}\n${r.stderr.toString().slice(-2000)}`,
              );
            }
          }
          if (entries.length > 0) {
            runLog.finalize(i, "pass", entries);
            if (!verbose) {
              process.stdout.write(
                `[${this.name}] step ${i + 1}/${this.steps.length} (finalize): pass\n`,
              );
            }
          }
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
        verbose,
        streamOutput,
      );
      if (writerResult.failureReason) {
        failureReason = writerResult.failureReason;
      } else {
        commitMessage = writerResult.commitMessage;
      }
    }

    const outcome = failureReason ? "fail" : "pass";
    const totalDurationS = ((Date.now() - runStart) / 1000).toFixed(1);

    if (!failureReason) {
      if (verbose) {
        banner("pass", "PASS");
        for (const cmd of finalizeStep?.onPass ?? []) {
          console.log(`${C.pass}  $ ${cmd}${C.reset}`);
          await $`${{ raw: cmd }}`.cwd(repoRoot).env(env);
        }
      } else {
        for (const cmd of finalizeStep?.onPass ?? []) {
          await $`${{ raw: cmd }}`.cwd(repoRoot).env(env).quiet();
        }
        const costStr = `$${runLog.getCostUsd().toFixed(4)}`;
        const tokenStr = `${runLog.getTokensIn()}→${runLog.getTokensOut()}`;
        if (commitMessage) {
          process.stdout.write(
            `[${this.name}] PASS — ${commitMessage} (${totalDurationS}s, ${costStr})\n`,
          );
        } else {
          process.stdout.write(
            `[${this.name}] PASS — (${totalDurationS}s, ${costStr}, ${tokenStr})\n`,
          );
        }
      }
    } else {
      if (verbose) {
        banner("fail", "FAIL");
        console.error(`${C.dim}reason:   ${failureReason}${C.reset}`);
        for (const cmd of finalizeStep?.onFail ?? []) {
          console.log(`${C.fail}  $ ${cmd}${C.reset}`);
          await $`${{ raw: cmd }}`
            .cwd(repoRoot)
            .env({ ...env, FAILURE_REASON: failureReason })
            .nothrow();
        }
      } else {
        for (const cmd of finalizeStep?.onFail ?? []) {
          await $`${{ raw: cmd }}`
            .cwd(repoRoot)
            .env({ ...env, FAILURE_REASON: failureReason })
            .nothrow()
            .quiet();
        }
        process.stderr.write(`[${this.name}] FAIL — ${failureReason}\n`);
        if (sandboxHandle) {
          process.stderr.write(`  worktree: ${sandboxHandle.cwd}\n`);
          process.stderr.write(`  branch: ${sandboxHandle.env.BRANCH ?? ""}\n`);
        }
      }
    }

    if (sandboxHandle) {
      await sandboxHandle.teardown(outcome, { failureReason, commitMessage });
    }

    const worktreePath = sandboxHandle?.cwd ?? "";
    const branch = sandboxHandle?.env.BRANCH ?? "";

    const summary = runLog.finish({
      worktreePath,
      branch,
      succeeded: !failureReason,
      failureReason,
    });

    // Always print log dir so operator can drill in
    const logPath = summary.logDir;
    if (verbose) {
      // In verbose mode the log dir is part of the standard dim output
      console.log(`${C.dim}log: ${logPath}${C.reset}`);
    } else {
      process.stdout.write(`  log: ${logPath}\n`);
    }

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
    verbose: boolean,
    streamOutput: boolean,
  ): Promise<{ failureReason?: string; commitMessage?: string }> {
    const diff = await sandboxHandle.diff?.();
    if (!diff?.trim()) {
      if (verbose) {
        console.log("no diff — skipping summary writer");
      } else {
        process.stdout.write(`[${this.name}] summary writer skipped (empty diff)\n`);
      }
      return {};
    }

    const originalGoal = resolveOriginalGoal(repoRoot);
    const userPrompt = buildSummaryWriterUserPrompt(originalGoal, ["```", diff, "```"]);

    const resolved = this.summaryWriterPrompt?.resolve(repoRoot);
    if (!resolved) return {};
    const { systemPrompt } = resolved;

    if (verbose) {
      banner("agent", "Summary writer phase");
      printInvocation(systemPrompt, userPrompt);
    } else {
      process.stdout.write(`[${this.name}] summary writer`);
    }

    const startTime = Date.now();
    const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: streamOutput });
    const durationMs = Date.now() - startTime;

    if (!verbose) {
      const durationS = (durationMs / 1000).toFixed(1);
      const tokIn = r.usage?.inputTokens ?? 0;
      const tokOut = r.usage?.outputTokens ?? 0;
      process.stdout.write(` ok (${durationS}s, ${tokIn}→${tokOut})\n`);
    }

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
      } else if (step.kind === "deterministic") {
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
      } else {
        banner("finalize", `Step ${i + 1}/${this.steps.length} — finalize`);
        if (step.commands.length > 0) {
          console.log(`${C.dim}  body:${C.reset}`);
          for (const cmd of step.commands) console.log(`${C.deterministic}    $ ${cmd}${C.reset}`);
        }
        console.log(`${C.dim}  on pass:${C.reset}`);
        for (const cmd of step.onPass) console.log(`${C.pass}    $ ${cmd}${C.reset}`);
        console.log(`${C.dim}  on fail:${C.reset}`);
        for (const cmd of step.onFail) console.log(`${C.fail}    $ ${cmd}${C.reset}`);
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
    verbose: boolean,
    streamOutput: boolean,
  ): Promise<void> {
    const { systemPrompt, userPrompt } = step.prompt.resolve(repoRoot);
    if (verbose) {
      printInvocation(systemPrompt, userPrompt);
    } else {
      process.stdout.write(`[${this.name}] step ${stepIndex + 1}/${this.steps.length} (agent)`);
    }
    const startTime = Date.now();
    const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: streamOutput });
    const durationMs = Date.now() - startTime;
    if (!verbose) {
      const durationS = (durationMs / 1000).toFixed(1);
      const tokIn = r.usage?.inputTokens ?? 0;
      const tokOut = r.usage?.outputTokens ?? 0;
      process.stdout.write(` ok (${durationS}s, ${tokIn}→${tokOut})\n`);
    }
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
    verbose: boolean,
    streamOutput: boolean,
  ): Promise<void> {
    const max = step.loop?.maxIterations ?? 1;
    let lastOutput = "";
    for (let i = 1; i <= max; i++) {
      if (verbose) {
        console.log(`${C.deterministic}  iteration ${i}/${max}${C.reset}`);
      }
      let allPassed = true;
      const entries: { command: string; exitCode: number; output: string }[] = [];
      for (const cmd of step.commands) {
        if (verbose) console.log(`${C.deterministic}  $ ${cmd}${C.reset}`);
        const r = await $`${{ raw: cmd }}`.cwd(cwd).env(env).nothrow().quiet();
        const output = r.stdout.toString() + r.stderr.toString();
        if (verbose && output.trim()) process.stdout.write(output);
        lastOutput = output;
        entries.push({ command: cmd, exitCode: r.exitCode ?? 0, output });
        if (r.exitCode !== 0) {
          allPassed = false;
          break;
        }
      }
      runLog.deterministicIteration(stepIndex, i, entries);

      if (!verbose) {
        // Build summary line: cmdName=exitCode ...
        const cmdSummary = entries
          .map((e) => {
            // Use a short label derived from the command name
            const label = e.command.trim().split(/\s+/)[0].replace(/.*\//, "");
            return `${label}=${e.exitCode}`;
          })
          .join(" ");
        process.stdout.write(
          `[${this.name}] step ${stepIndex + 1}/${this.steps.length} (deterministic)\n`,
        );
        process.stdout.write(`[${this.name}]   iter ${i}/${max}: ${cmdSummary}\n`);
      }

      if (allPassed) return;
      if (step.loop && i < max) {
        const fixer = step.loop.fixer.withUserMessage(
          `Commands failed (iteration ${i}/${max}):\n\n${lastOutput.slice(-4000)}`,
        );
        const { systemPrompt, userPrompt } = fixer.resolve(repoRoot);
        if (verbose) {
          printInvocation(systemPrompt, userPrompt);
        } else {
          process.stdout.write(`[${this.name}]   fixer iter ${i}`);
        }
        const startTime = Date.now();
        const r = await spawnClaude({ systemPrompt, userPrompt, cwd, stream: streamOutput });
        const durationMs = Date.now() - startTime;
        if (!verbose) {
          const durationS = (durationMs / 1000).toFixed(1);
          const tokIn = r.usage?.inputTokens ?? 0;
          const tokOut = r.usage?.outputTokens ?? 0;
          const status = r.exitCode === 0 ? "ok" : "fail";
          process.stdout.write(` (${status}, ${durationS}s, ${tokIn}→${tokOut})\n`);
        }
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

function resolveOriginalGoal(repoRoot: string): string {
  const rawUserMessage = process.env.__MUNCHKINS_OPT_userMessage;
  if (!rawUserMessage) return "(no user message)";
  const candidate = isAbsolute(rawUserMessage) ? rawUserMessage : join(repoRoot, rawUserMessage);
  if (existsSync(candidate)) {
    return readFileSync(candidate, "utf-8");
  }
  return rawUserMessage;
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
