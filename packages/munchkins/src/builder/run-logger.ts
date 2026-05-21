import type { SandboxHandle } from "../sandbox/sandbox.js";
import type { SpawnClaudeUsage } from "./spawn-claude.js";

export const C = {
  agent: "\x1b[36m",
  deterministic: "\x1b[33m",
  pass: "\x1b[32m",
  fail: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
} as const;

export function banner(kind: keyof typeof C, text: string): void {
  console.log(`\n${C[kind]}━━━ ${text} ━━━${C.reset}`);
}

export function printInvocation(systemPrompt: string, userPrompt: string): void {
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

export interface PassOpts {
  totalDurationS: string;
  cost?: number;
  tokensIn: number;
  tokensOut: number;
  commitMessage?: string;
  prUrl?: string;
}

interface DeterministicEntry {
  command: string;
  exitCode: number;
}

export class RunLogger {
  constructor(
    private readonly name: string,
    private readonly verbose: boolean,
  ) {}

  // --- Lifecycle ---

  starting(cwd: string, stepCount: number): void {
    if (this.verbose) {
      banner("agent", `AgentBuilder.run() — ${this.name}`);
      console.log(`${C.dim}cwd:       ${cwd}${C.reset}`);
      console.log(`${C.dim}steps:     ${stepCount}${C.reset}`);
    } else {
      process.stdout.write(`[${this.name}] starting\n`);
    }
  }

  stepBanner(i: number, total: number, kind: "agent" | "deterministic"): void {
    if (!this.verbose) return;
    banner(kind, `Step ${i + 1}/${total} — ${kind}`);
  }

  integrationLine(line: string): void {
    if (this.verbose) console.log(`${C.dim}${line}${C.reset}`);
    else process.stdout.write(`[${this.name}] ${line}\n`);
  }

  pass(opts: PassOpts): void {
    if (this.verbose) {
      banner("pass", "PASS");
      if (opts.prUrl) console.log(`${C.dim}pr: ${opts.prUrl}${C.reset}`);
      return;
    }
    const costStr = opts.cost === undefined ? "—" : `$${opts.cost.toFixed(4)}`;
    const tokenStr = `${opts.tokensIn}→${opts.tokensOut}`;
    const prSuffix = opts.prUrl ? ` ${opts.prUrl}` : "";
    if (opts.commitMessage) {
      process.stdout.write(
        `[${this.name}] PASS — ${opts.commitMessage} (${opts.totalDurationS}s, ${costStr})${prSuffix}\n`,
      );
    } else {
      process.stdout.write(
        `[${this.name}] PASS — (${opts.totalDurationS}s, ${costStr}, ${tokenStr})${prSuffix}\n`,
      );
    }
  }

  fail(failureReason: string, sandboxHandle?: SandboxHandle): void {
    if (this.verbose) {
      banner("fail", "FAIL");
      console.error(`${C.dim}reason:   ${failureReason}${C.reset}`);
      return;
    }
    process.stderr.write(`[${this.name}] FAIL — ${failureReason}\n`);
    if (sandboxHandle) {
      process.stderr.write(`  worktree: ${sandboxHandle.cwd}\n`);
      process.stderr.write(`  branch: ${sandboxHandle.env.BRANCH ?? ""}\n`);
    }
  }

  logDir(path: string): void {
    if (this.verbose) {
      console.log(`${C.dim}log: ${path}${C.reset}`);
    } else {
      process.stdout.write(`  log: ${path}\n`);
    }
  }

  // --- Sub-method helpers ---

  agentStepStart(stepIndex: number, total: number, systemPrompt: string, userPrompt: string): void {
    if (this.verbose) {
      printInvocation(systemPrompt, userPrompt);
    } else {
      process.stdout.write(`[${this.name}] step ${stepIndex + 1}/${total} (agent)`);
    }
  }

  /** Common quiet-mode "ok" line shared by runAgent and runSummaryWriter. */
  stepResultOk(durationMs: number, usage: SpawnClaudeUsage | undefined): void {
    if (this.verbose) return;
    const durationS = (durationMs / 1000).toFixed(1);
    const tokIn = usage?.inputTokens ?? 0;
    const tokOut = usage?.outputTokens ?? 0;
    process.stdout.write(` ok (${durationS}s, ${tokIn}→${tokOut})\n`);
  }

  summaryWriterEmptyDiff(): void {
    if (this.verbose) {
      console.log("no diff — skipping summary writer");
    } else {
      process.stdout.write(`[${this.name}] summary writer skipped (empty diff)\n`);
    }
  }

  summaryWriterStart(systemPrompt: string, userPrompt: string): void {
    if (this.verbose) {
      banner("agent", "Summary writer phase");
      printInvocation(systemPrompt, userPrompt);
    } else {
      process.stdout.write(`[${this.name}] summary writer`);
    }
  }

  deterministicIterationHeader(i: number, max: number): void {
    if (!this.verbose) return;
    console.log(`${C.deterministic}  iteration ${i}/${max}${C.reset}`);
  }

  deterministicCommand(cmd: string): void {
    if (!this.verbose) return;
    console.log(`${C.deterministic}  $ ${cmd}${C.reset}`);
  }

  deterministicCommandOutput(text: string): void {
    if (this.verbose && text.trim()) process.stdout.write(text);
  }

  deterministicQuietSummary(
    stepIndex: number,
    total: number,
    iter: number,
    max: number,
    entries: DeterministicEntry[],
  ): void {
    if (this.verbose) return;
    const cmdSummary = entries
      .map((e) => {
        const label = e.command.trim().split(/\s+/)[0].replace(/.*\//, "");
        return `${label}=${e.exitCode}`;
      })
      .join(" ");
    process.stdout.write(`[${this.name}] step ${stepIndex + 1}/${total} (deterministic)\n`);
    process.stdout.write(`[${this.name}]   iter ${iter}/${max}: ${cmdSummary}\n`);
  }

  fixerStart(iter: number, systemPrompt: string, userPrompt: string): void {
    if (this.verbose) {
      printInvocation(systemPrompt, userPrompt);
    } else {
      process.stdout.write(`[${this.name}]   fixer iter ${iter}`);
    }
  }

  fixerResult(durationMs: number, usage: SpawnClaudeUsage | undefined, exitCode: number): void {
    if (this.verbose) return;
    const durationS = (durationMs / 1000).toFixed(1);
    const tokIn = usage?.inputTokens ?? 0;
    const tokOut = usage?.outputTokens ?? 0;
    const status = exitCode === 0 ? "ok" : "fail";
    process.stdout.write(` (${status}, ${durationS}s, ${tokIn}→${tokOut})\n`);
  }
}
