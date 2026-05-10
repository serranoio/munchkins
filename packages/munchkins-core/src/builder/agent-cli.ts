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

interface CodexStreamEventMsg {
  type?: string;
  message?: string;
  text?: string;
  delta?: string;
  name?: string;
  last_agent_message?: string;
  session_id?: string;
  info?: {
    total_token_usage?: {
      input_tokens?: number;
      cached_input_tokens?: number;
      output_tokens?: number;
    };
    last_token_usage?: {
      input_tokens?: number;
      cached_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

interface CodexStreamEvent {
  id?: string;
  session_id?: string;
  msg?: CodexStreamEventMsg;
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

  // Spawns `args`, decodes stdout as JSONL, and dispatches each parsed event to `handle`.
  // Subclasses only differ in arg shape and event handling — the spawn/decode/exit/error
  // scaffolding lives here.
  protected async runJsonStream<E>(
    opts: SpawnOptions,
    args: string[],
    handle: (event: E, ctx: StreamContext) => void,
  ): Promise<SpawnResult> {
    const startTime = Date.now();
    let usage: AgentUsage | undefined;
    let finalResult = "";
    let sessionId: string | undefined;
    const chunks: string[] = [];

    try {
      const proc = Bun.spawn(args, {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "pipe",
        signal: opts.abortSignal,
      });

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

function isLimitHit(result: SpawnResult): boolean {
  if (result.exitCode === 0) return false;
  const stderr = result.stderr ?? "";
  return (
    LIMIT_RE_UNIX.test(stderr) ||
    LIMIT_RE_UNIX.test(result.output) ||
    LIMIT_RE_HHMM.test(stderr) ||
    LIMIT_RE_HHMM.test(result.output)
  );
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

    const result = await this.runJsonStream<ClaudeStreamEvent>(opts, args, handler);
    if (!isLimitHit(result)) return result;
    const resetAt = parseResetTimestamp(result);
    if (!resetAt) return result;
    process.stderr.write(`⏳ Claude limit hit, waiting until ${formatLocalTime(resetAt)}\n`);
    await sleepUntil(resetAt, opts.abortSignal);
    return this.runJsonStream<ClaudeStreamEvent>(opts, args, handler);
  }
}

export class CodexCLI extends AgentCLI {
  readonly name = "codex" as const;

  buildArgs(opts: SpawnOptions): string[] {
    // Codex `exec` has no --system-prompt flag. Prepending the system prompt to the
    // user prompt under labeled sections is the lowest-coupling delivery: no config
    // override, no AGENTS.md collision (this repo's AGENTS.md is load-bearing).
    const promptText = opts.resumeSessionId ? RESUME_CONTINUE_MESSAGE : opts.userPrompt;
    const fullPrompt = opts.systemPrompt
      ? `## System\n${opts.systemPrompt}\n\n## Task\n${promptText}`
      : promptText;
    // `codex resume <session-id> exec ...` is the resume form; `codex exec ...` is the
    // fresh form. The exact resume flag shape is verified at runtime — if Codex
    // changes it, the fallback path in agent-builder restarts the step from scratch.
    const args: string[] = ["codex"];
    if (opts.resumeSessionId) {
      args.push("resume", opts.resumeSessionId);
    }
    args.push("exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "-C", opts.cwd);
    if (opts.model) {
      args.push("--model", opts.model);
    }
    args.push(fullPrompt);
    return args;
  }

  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    return this.runJsonStream<CodexStreamEvent>(opts, this.buildArgs(opts), (event, ctx) => {
      const msg = event.msg;
      // session_id may appear at the top level or inside msg, depending on
      // Codex CLI version. Capture either form.
      const sid = event.session_id ?? msg?.session_id;
      if (sid) ctx.setSessionId(sid);
      if (!msg) return;

      if (msg.type === "agent_message" && typeof msg.message === "string") {
        ctx.setFinalResult(msg.message);
      } else if (msg.type === "task_complete" && typeof msg.last_agent_message === "string") {
        ctx.setFinalResult(msg.last_agent_message);
      } else if (msg.type === "token_count" && msg.info) {
        const totals = msg.info.total_token_usage ?? msg.info.last_token_usage;
        if (totals) {
          ctx.setUsage({
            inputTokens: totals.input_tokens ?? 0,
            outputTokens: totals.output_tokens ?? 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: totals.cached_input_tokens ?? 0,
            // costUsd intentionally omitted — Codex JSONL does not emit cost.
          });
        }
      }

      if (!opts.stream) return;

      if (msg.type === "agent_message" && typeof msg.message === "string") {
        process.stdout.write(`\n${msg.message}\n`);
      } else if (msg.type === "agent_message_delta" && typeof msg.delta === "string") {
        process.stdout.write(msg.delta);
      } else if (msg.type === "exec_command_begin" && typeof msg.name === "string") {
        process.stdout.write(`\n[Tool: ${msg.name}]\n`);
      }
    });
  }
}
