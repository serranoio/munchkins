import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { SpawnClaudeUsage } from "./builder/spawn-claude.js";

export interface RunSummary {
  agent: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  worktreePath: string;
  branch: string;
  succeeded: boolean;
  failureReason?: string;
  agentSteps: number;
  deterministicCommands: number;
  fixerInvocations: number;
  totalClaudeCalls: number;
  logDir: string;
  commitMessage?: string;
  markdown?: string;
  tokensIn: number;
  tokensOut: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatCommandEntries(
  entries: { command: string; exitCode: number; output: string }[],
): string {
  return entries
    .map(
      (e) => `$ ${e.command}\n[exit ${e.exitCode}]\n${e.output.length > 0 ? `${e.output}\n` : ""}`,
    )
    .join("\n");
}

function resolveEnvPath(envValue: string | undefined, fallback: string, repoRoot: string): string {
  if (!envValue) return fallback;
  return isAbsolute(envValue) ? envValue : join(repoRoot, envValue);
}

function formatChangelogDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const tz =
    Intl.DateTimeFormat("en", { timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "UTC";
  return `${yyyy}-${mm}-${dd} ${hh}:${min} ${tz}`;
}

const CHANGELOG_HEADER = `# Changelog

Autonomously-generated entries from agent runs. Most recent first.

---

`;

export class RunLog {
  readonly dir: string;
  readonly agent: string;
  private startedAt: number;
  private agentStepCount = 0;
  private deterministicCommandCount = 0;
  private fixerInvocationCount = 0;
  private claudeCallCount = 0;
  private eventsPath: string;
  private tokensIn = 0;
  private tokensOut = 0;
  private cacheCreationInputTokens = 0;
  private cacheReadInputTokens = 0;
  private costUsd = 0;
  private costUsdHasUnknownContributions = false;
  private commitMessage: string | undefined;
  private markdown: string | undefined;

  constructor(repoRoot: string, agentName: string, opts?: { slug?: string }) {
    this.agent = agentName;
    this.startedAt = Date.now();
    const uuid = crypto.randomUUID().slice(0, 8);
    const slug = opts?.slug?.trim();
    const dirName = slug ? `${slug}-${uuid}` : `${agentName}-${this.startedAt}-${uuid}`;
    const baseDir = resolveEnvPath(
      process.env.MUNCHKINS_RUN_LOG_DIR,
      join(repoRoot, ".munchkins", "runs"),
      repoRoot,
    );
    this.dir = join(baseDir, dirName);
    mkdirSync(this.dir, { recursive: true });
    this.eventsPath = join(this.dir, "events.jsonl");
  }

  private writeEvent(event: Record<string, unknown>): void {
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`);
  }

  recordEvent(event: Record<string, unknown>): void {
    this.writeEvent(event);
  }

  accumulateUsage(usage: SpawnClaudeUsage | undefined): void {
    if (!usage) return;
    this.tokensIn += usage.inputTokens;
    this.tokensOut += usage.outputTokens;
    this.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    this.cacheReadInputTokens += usage.cacheReadInputTokens;
    if (usage.costUsd === undefined) {
      this.costUsdHasUnknownContributions = true;
    } else {
      this.costUsd += usage.costUsd;
    }
  }

  getCostUsd(): number | undefined {
    return this.costUsdHasUnknownContributions ? undefined : this.costUsd;
  }

  getTokensIn(): number {
    return this.tokensIn;
  }

  getTokensOut(): number {
    return this.tokensOut;
  }

  setAgentSummary(commitMessage: string, markdown: string): void {
    this.commitMessage = commitMessage;
    this.markdown = markdown;
  }

  getAgentSummaryMarkdown(): string | undefined {
    return this.markdown;
  }

  getAgentSummaryCommitMessage(): string | undefined {
    return this.commitMessage;
  }

  private _writeClaudeCall(
    prefix: string,
    kind: "agent" | "summary" | "fixer",
    systemPrompt: string,
    userPrompt: string,
    response: string,
    exitCode: number,
    durationMs: number,
    extra: Record<string, unknown>,
  ): void {
    this.claudeCallCount += 1;
    writeFileSync(join(this.dir, `${prefix}.system.md`), systemPrompt);
    writeFileSync(join(this.dir, `${prefix}.user.md`), userPrompt);
    writeFileSync(join(this.dir, `${prefix}.response.txt`), response);
    this.writeEvent({
      type: kind,
      ...extra,
      exitCode,
      durationMs,
      systemBytes: systemPrompt.length,
      userBytes: userPrompt.length,
      responseBytes: response.length,
    });
  }

  agentStep(
    stepIndex: number,
    systemPrompt: string,
    userPrompt: string,
    response: string,
    exitCode: number,
    durationMs: number,
  ): void {
    this.agentStepCount += 1;
    this._writeClaudeCall(
      `step-${pad(stepIndex + 1)}-agent`,
      "agent",
      systemPrompt,
      userPrompt,
      response,
      exitCode,
      durationMs,
      { stepIndex },
    );
  }

  summaryStep(
    systemPrompt: string,
    userPrompt: string,
    response: string,
    exitCode: number,
    durationMs: number,
  ): void {
    // Use agentStepCount as the step index for the summary (it runs after all agent steps)
    const stepIndex = this.agentStepCount;
    this._writeClaudeCall(
      `step-${pad(stepIndex + 1)}-summary`,
      "summary",
      systemPrompt,
      userPrompt,
      response,
      exitCode,
      durationMs,
      { stepIndex },
    );
  }

  deterministicIteration(
    stepIndex: number,
    iteration: number,
    entries: { command: string; exitCode: number; output: string }[],
  ): void {
    this.deterministicCommandCount += entries.length;
    const prefix = `step-${pad(stepIndex + 1)}-det-iter-${pad(iteration)}`;
    writeFileSync(join(this.dir, `${prefix}.log`), formatCommandEntries(entries));
    this.writeEvent({
      type: "deterministic",
      stepIndex,
      iteration,
      commandCount: entries.length,
      exitCodes: entries.map((e) => e.exitCode),
    });
  }

  fixerInvocation(
    stepIndex: number,
    iteration: number,
    systemPrompt: string,
    userPrompt: string,
    response: string,
    exitCode: number,
    durationMs: number,
  ): void {
    this.fixerInvocationCount += 1;
    this._writeClaudeCall(
      `step-${pad(stepIndex + 1)}-fixer-iter-${pad(iteration)}`,
      "fixer",
      systemPrompt,
      userPrompt,
      response,
      exitCode,
      durationMs,
      { stepIndex, iteration },
    );
  }

  finish(args: {
    worktreePath: string;
    branch: string;
    succeeded: boolean;
    failureReason?: string;
  }): RunSummary {
    const endedAt = Date.now();
    const summary: RunSummary = {
      agent: this.agent,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - this.startedAt,
      worktreePath: args.worktreePath,
      branch: args.branch,
      succeeded: args.succeeded,
      failureReason: args.failureReason,
      agentSteps: this.agentStepCount,
      deterministicCommands: this.deterministicCommandCount,
      fixerInvocations: this.fixerInvocationCount,
      totalClaudeCalls: this.claudeCallCount,
      logDir: this.dir,
      commitMessage: this.commitMessage,
      markdown: this.markdown,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      cacheCreationInputTokens: this.cacheCreationInputTokens,
      cacheReadInputTokens: this.cacheReadInputTokens,
      costUsd: this.getCostUsd(),
    };
    writeFileSync(join(this.dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

    return summary;
  }

  // Prepend the run's changelog entry under `targetDir`. Returns the absolute path
  // that was written, or undefined if there is no entry to record (no commitMessage
  // / markdown set by a summary writer).
  //
  // Caller controls timing — for sandboxed runs the agent-builder calls this before
  // teardown so the merge carries the changelog change atomically with the rest of
  // the worktree's commits. Concurrent runs may interleave; not handled.
  prependChangelogIn(targetDir: string): string | undefined {
    if (!this.commitMessage || !this.markdown) return undefined;
    const endedAt = Date.now();
    const durationMs = endedAt - this.startedAt;
    const changelogPath = resolveEnvPath(
      process.env.MUNCHKINS_CHANGELOG_PATH,
      join(targetDir, "CHANGELOG.md"),
      targetDir,
    );
    const durationSeconds = (durationMs / 1000).toFixed(1);
    const dateStr = formatChangelogDate(endedAt);
    const cost = this.getCostUsd();
    const costStr = cost === undefined ? "—" : `$${cost.toFixed(4)}`;
    const entry = [
      `## ${this.commitMessage}`,
      `**${dateStr} · ${this.agent} · ${durationSeconds}s · ${costStr}**`,
      "",
      this.markdown,
      "",
      "---",
      "",
    ].join("\n");

    if (!existsSync(changelogPath)) {
      mkdirSync(dirname(changelogPath), { recursive: true });
      writeFileSync(changelogPath, `${CHANGELOG_HEADER}${entry}`);
      return changelogPath;
    }

    const existing = readFileSync(changelogPath, "utf-8");
    // Insert the entry after the static header block (everything up to and including the first `---\n\n`)
    const headerEndMarker = "---\n\n";
    const markerIdx = existing.indexOf(headerEndMarker);
    if (markerIdx === -1) {
      writeFileSync(changelogPath, `${entry}${existing}`);
    } else {
      const afterHeader = existing.slice(markerIdx + headerEndMarker.length);
      writeFileSync(
        changelogPath,
        `${existing.slice(0, markerIdx + headerEndMarker.length)}${entry}${afterHeader}`,
      );
    }
    return changelogPath;
  }
}
