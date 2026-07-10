export interface SpawnOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  stream?: boolean;
  model?: string;
  disallowedTools?: string[];
  abortSignal?: AbortSignal;
  /**
   * If set, the CLI is invoked in resume mode against this session id and
   * `userPrompt` is replaced with a "continue" message. The original
   * conversation context is restored by the underlying CLI.
   */
  resumeSessionId?: string;
  /**
   * Notified the moment the CLI's init event yields a session id. Lets the
   * caller persist the id mid-step (so an interrupted run can be resumed).
   */
  onSessionId?: (sessionId: string) => void;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;
}

export interface SpawnResult {
  exitCode: number;
  output: string;
  durationMs: number;
  usage?: AgentUsage;
  /** Session id captured from the CLI's JSONL stream, if it emitted one. */
  sessionId?: string;
  /** Captured stderr (also forwarded to the terminal in real time). */
  stderr?: string;
}

export type AgentCLIName = "claude" | "codex";

const RESUME_CONTINUE_MESSAGE =
  "Continue from where you left off. The previous run was interrupted mid-task; pick up from your last action.";

interface ClaudeStreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  message?: {
    content?: Array<{ type: string; text?: string; name?: string }>;
  };
}

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexStreamEventMsg {
  type?: string;
  message?: string;
  text?: string;
  delta?: string;
  name?: string;
  last_agent_message?: string;
  session_id?: string;
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
  };
}

interface CodexStreamEventItem {
  id?: string;
  type?: string;
  text?: string;
  delta?: string;
  name?: string;
}

interface CodexStreamEvent {
  id?: string;
  session_id?: string;
  // Older codex versions nest event data under `msg`.
  msg?: CodexStreamEventMsg;
  // Codex 0.139+ emits a flat event shape with top-level `type` plus
  // `thread_id` / `item` / `usage` siblings depending on the event kind.
  type?: string;
  thread_id?: string;
  item?: CodexStreamEventItem;
  usage?: CodexTokenUsage;
}

interface StreamContext {
  setFinalResult: (s: string) => void;
  setUsage: (u: AgentUsage) => void;
  setSessionId: (s: string) => void;
}

export abstract class AgentCLI {
  abstract readonly name: AgentCLIName;
  abstract spawn(opts: SpawnOptions): Promise<SpawnResult>;

  static fromEnv(): AgentCLI {
    const choice = process.env.__MUNCHKINS_OPT_cli ?? process.env.MUNCHKINS_CLI ?? "claude";
    switch (choice) {
      case "claude":
        return new ClaudeCLI();
      case "codex":
        return new CodexCLI();
      default:
        throw new Error(
          `Unknown CLI backend "${choice}". Expected "claude" or "codex". ` +
            `Set via --cli=<name> or MUNCHKINS_CLI=<name>.`,
        );
    }
  }

  // Runs the given args under `runJsonStream`, then detects rate-limit hits
  // and retries once after sleeping until the parsed reset (or the generic
  // fallback wait when only a non-timestamped "rate limit" substring matched).
  // Shared by both backends — Claude-specific timestamp formats only fire on
  // Claude output; Codex naturally degenerates to the generic fallback wait.
  protected async runWithRateLimitRetry<E>(
    opts: SpawnOptions,
    args: string[],
    handle: (event: E, ctx: StreamContext) => void,
    stdinText?: string,
  ): Promise<SpawnResult> {
    const result = await this.runJsonStream<E>(opts, args, handle, stdinText);
    if (!isLimitHit(result)) return result;
    let resetAt = parseResetTimestamp(result);
    if (!resetAt) {
      const onlyGeneric = isGenericLimitOnly(result);
      if (!onlyGeneric) return result;
      resetAt = new Date(Date.now() + GENERIC_LIMIT_WAIT_MS);
    }
    process.stderr.write(`⏳ ${this.name} limit hit, waiting until ${formatLocalTime(resetAt)}\n`);
    await sleepUntil(resetAt, opts.abortSignal);
    return this.runJsonStream<E>(opts, args, handle, stdinText);
  }

  // Spawns `args`, decodes stdout as JSONL, and dispatches each parsed event to `handle`.
  // Subclasses only differ in arg shape and event handling — the spawn/decode/exit/error
  // scaffolding lives here.
  protected async runJsonStream<E>(
    opts: SpawnOptions,
    args: string[],
    handle: (event: E, ctx: StreamContext) => void,
    stdinText?: string,
  ): Promise<SpawnResult> {
    const startTime = Date.now();
    let usage: AgentUsage | undefined;
    let finalResult = "";
    let sessionId: string | undefined;
    const chunks: string[] = [];

    try {
      const proc = Bun.spawn(args, {
        cwd: opts.cwd,
        stdin: stdinText === undefined ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
        signal: opts.abortSignal,
      });

      if (stdinText !== undefined) {
        const stdin = proc.stdin as unknown as {
          write(data: string): void;
          end(): void;
        };
        stdin.write(stdinText);
        stdin.end();
      }

      const decoder = new TextDecoder();
      const ctx: StreamContext = {
        setFinalResult: (s) => {
          finalResult = s;
        },
        setUsage: (u) => {
          usage = u;
        },
        setSessionId: (s) => {
          if (sessionId === s) return;
          sessionId = s;
          opts.onSessionId?.(s);
        },
      };

      // Read stderr concurrently, forwarding bytes to the user's terminal in
      // real time while also accumulating into a buffer so the limit-hit
      // detection in ClaudeCLI can scan it after exit.
      const stderrChunks: string[] = [];
      const stderrPromise = (async () => {
        const dec = new TextDecoder();
        for await (const chunk of proc.stderr) {
          const text = dec.decode(chunk);
          stderrChunks.push(text);
          process.stderr.write(text);
        }
      })();

      const stdoutPromise = (async () => {
        for await (const chunk of proc.stdout) {
          const text = decoder.decode(chunk);
          chunks.push(text);

          for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            let event: E;
            try {
              event = JSON.parse(line) as E;
            } catch {
              continue;
            }
            handle(event, ctx);
          }
        }
      })();

      const exitCode = await proc.exited;
      await stdoutPromise;
      await stderrPromise;
      return {
        exitCode,
        output: finalResult || chunks.join(""),
        durationMs: Date.now() - startTime,
        usage,
        sessionId,
        stderr: stderrChunks.join(""),
      };
    } catch (err) {
      return {
        exitCode: 1,
        output: `Error spawning ${this.name}: ${err}`,
        durationMs: Date.now() - startTime,
        usage,
        sessionId,
      };
    }
  }
}

const LIMIT_RE_UNIX = /Claude AI usage limit reached\|(\d{10,})/;
const LIMIT_RE_HHMM = /Claude AI usage limit reached.*?(\d{1,2}:\d{2})/;
const LIMIT_RE_GENERIC = /rate limit/i;
const GENERIC_LIMIT_WAIT_MS = 60_000;

function isLimitHit(result: SpawnResult): boolean {
  if (result.exitCode === 0) return false;
  const stderr = result.stderr ?? "";
  return (
    LIMIT_RE_UNIX.test(stderr) ||
    LIMIT_RE_UNIX.test(result.output) ||
    LIMIT_RE_HHMM.test(stderr) ||
    LIMIT_RE_HHMM.test(result.output) ||
    LIMIT_RE_GENERIC.test(stderr) ||
    LIMIT_RE_GENERIC.test(result.output)
  );
}

function isGenericLimitOnly(result: SpawnResult): boolean {
  const stderr = result.stderr ?? "";
  const matchedSpecific =
    LIMIT_RE_UNIX.test(stderr) ||
    LIMIT_RE_UNIX.test(result.output) ||
    LIMIT_RE_HHMM.test(stderr) ||
    LIMIT_RE_HHMM.test(result.output);
  if (matchedSpecific) return false;
  return LIMIT_RE_GENERIC.test(stderr) || LIMIT_RE_GENERIC.test(result.output);
}

function parseResetTimestamp(result: SpawnResult, now: Date = new Date()): Date | null {
  const sources = [result.stderr ?? "", result.output];
  for (const text of sources) {
    const unix = text.match(LIMIT_RE_UNIX);
    if (unix) {
      // Regex matches \d{10,}, so Number() is always finite and positive.
      return new Date(Number(unix[1]) * 1000);
    }
  }
  for (const text of sources) {
    const hhmm = text.match(LIMIT_RE_HHMM);
    if (hhmm) {
      const [hStr, mStr] = hhmm[1].split(":");
      const h = Number(hStr);
      const m = Number(mStr);
      if (h > 23 || m > 59) return null;
      const candidate = new Date(now);
      candidate.setHours(h, m, 0, 0);
      if (candidate.getTime() <= now.getTime()) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate;
    }
  }
  return null;
}

function sleepUntil(target: Date, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("aborted"));
  }
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function formatLocalTime(d: Date): string {
  return d.toLocaleTimeString([], { hour12: false });
}

export class ClaudeCLI extends AgentCLI {
  readonly name = "claude" as const;

  buildArgs(opts: SpawnOptions): string[] {
    const userPrompt = opts.resumeSessionId ? RESUME_CONTINUE_MESSAGE : opts.userPrompt;
    const args = ["claude", "--dangerously-skip-permissions"];
    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    }
    args.push("-p", userPrompt);
    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt);
    }
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.disallowedTools && opts.disallowedTools.length > 0) {
      args.push("--disallowedTools", opts.disallowedTools.join(","));
    }
    args.push("--output-format", "stream-json", "--verbose");
    return args;
  }

  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const args = this.buildArgs(opts);
    const handler = (event: ClaudeStreamEvent, ctx: StreamContext) => {
      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        ctx.setSessionId(event.session_id);
      }
      if (event.type === "result") {
        if (event.result) ctx.setFinalResult(event.result);
        if (event.usage || event.total_cost_usd !== undefined) {
          ctx.setUsage({
            inputTokens: event.usage?.input_tokens ?? 0,
            outputTokens: event.usage?.output_tokens ?? 0,
            cacheCreationInputTokens: event.usage?.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: event.usage?.cache_read_input_tokens ?? 0,
            costUsd: event.total_cost_usd ?? 0,
          });
        }
      }

      if (!opts.stream) return;

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            process.stdout.write(block.text);
          } else if (block.type === "tool_use" && block.name) {
            process.stdout.write(`\n[Tool: ${block.name}]\n`);
          }
        }
      } else if (event.type === "result" && event.result) {
        process.stdout.write(`\n${event.result}\n`);
      }
    };

    return this.runWithRateLimitRetry<ClaudeStreamEvent>(opts, args, handler);
  }
}

export class CodexCLI extends AgentCLI {
  readonly name = "codex" as const;

  buildPrompt(opts: SpawnOptions): string {
    // Codex `exec` has no --system-prompt flag. Prepending the system prompt to the
    // user prompt under labeled sections is the lowest-coupling delivery: no config
    // override, no AGENTS.md collision (this repo's AGENTS.md is load-bearing).
    const promptText = opts.resumeSessionId ? RESUME_CONTINUE_MESSAGE : opts.userPrompt;
    return opts.systemPrompt
      ? `## System\n${opts.systemPrompt}\n\n## Task\n${promptText}`
      : promptText;
  }

  buildArgs(opts: SpawnOptions): string[] {
    // Codex 0.139+: `codex exec resume <session-id> ...` is the non-interactive
    // resume form (top-level `codex resume` is the interactive picker, which
    // would treat `exec` as a prompt). Fresh runs use `codex exec ...`.
    const args: string[] = ["codex", "exec"];
    if (opts.resumeSessionId) {
      args.push("resume", opts.resumeSessionId);
    }
    args.push("--json", "--dangerously-bypass-approvals-and-sandbox", "-C", opts.cwd);
    if (opts.model) {
      args.push("--model", opts.model);
    }
    return args;
  }

  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    return this.runWithRateLimitRetry<CodexStreamEvent>(
      opts,
      this.buildArgs(opts),
      (event, ctx) => {
        // Codex emits two event shapes depending on CLI version:
        //   - Older: nested under `msg` with `session_id` either at top level or in `msg`.
        //   - 0.139+: flat with top-level `type` and shape-specific siblings
        //     (`thread.started.thread_id`, `item.completed.item`, `turn.completed.usage`).
        // We handle both so a parser update doesn't require lockstep CLI upgrades.

        const sid = event.session_id ?? event.msg?.session_id ?? event.thread_id;
        if (sid) ctx.setSessionId(sid);

        // Flat (0.139+) shape.
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          if (typeof event.item.text === "string") {
            ctx.setFinalResult(event.item.text);
            if (opts.stream) process.stdout.write(`\n${event.item.text}\n`);
          }
        } else if (event.type === "turn.completed" && event.usage) {
          ctx.setUsage(mapCodexUsage(event.usage));
        } else if (opts.stream && event.type === "item.started" && event.item?.name) {
          process.stdout.write(`\n[Tool: ${event.item.name}]\n`);
        }

        // Older nested-msg shape.
        const msg = event.msg;
        if (msg) {
          if (msg.type === "agent_message" && typeof msg.message === "string") {
            ctx.setFinalResult(msg.message);
            if (opts.stream) process.stdout.write(`\n${msg.message}\n`);
          } else if (msg.type === "task_complete" && typeof msg.last_agent_message === "string") {
            ctx.setFinalResult(msg.last_agent_message);
          } else if (msg.type === "token_count" && msg.info) {
            const totals = msg.info.total_token_usage ?? msg.info.last_token_usage;
            if (totals) ctx.setUsage(mapCodexUsage(totals));
          } else if (
            opts.stream &&
            msg.type === "agent_message_delta" &&
            typeof msg.delta === "string"
          ) {
            process.stdout.write(msg.delta);
          } else if (
            opts.stream &&
            msg.type === "exec_command_begin" &&
            typeof msg.name === "string"
          ) {
            process.stdout.write(`\n[Tool: ${msg.name}]\n`);
          }
        }
      },
      this.buildPrompt(opts),
    );
  }
}

function mapCodexUsage(u: CodexTokenUsage): AgentUsage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: u.cached_input_tokens ?? 0,
    // costUsd intentionally omitted — Codex JSONL does not emit cost.
  };
}
