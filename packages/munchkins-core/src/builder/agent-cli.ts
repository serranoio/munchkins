export interface SpawnOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  stream?: boolean;
  model?: string;
  disallowedTools?: string[];
  abortSignal?: AbortSignal;
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
}

export type AgentCLIName = "claude" | "codex";

interface ClaudeStreamEvent {
  type?: string;
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
  msg?: CodexStreamEventMsg;
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
}

export class ClaudeCLI extends AgentCLI {
  readonly name = "claude" as const;

  buildArgs(opts: SpawnOptions): string[] {
    const args = ["claude", "--dangerously-skip-permissions", "-p", opts.userPrompt];
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
    const startTime = Date.now();
    const args = this.buildArgs(opts);

    let output = "";
    let exitCode = 0;
    let usage: AgentUsage | undefined;

    try {
      const proc = Bun.spawn(args, {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "inherit",
        signal: opts.abortSignal,
      });

      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let finalResult = "";

      for await (const chunk of proc.stdout) {
        const text = decoder.decode(chunk);
        chunks.push(text);

        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          let event: ClaudeStreamEvent;
          try {
            event = JSON.parse(line) as ClaudeStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "result") {
            if (event.result) finalResult = event.result;
            if (event.usage || event.total_cost_usd !== undefined) {
              usage = {
                inputTokens: event.usage?.input_tokens ?? 0,
                outputTokens: event.usage?.output_tokens ?? 0,
                cacheCreationInputTokens: event.usage?.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: event.usage?.cache_read_input_tokens ?? 0,
                costUsd: event.total_cost_usd ?? 0,
              };
            }
          }

          if (!opts.stream) continue;

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
        }
      }

      exitCode = await proc.exited;
      output = finalResult || chunks.join("");
    } catch (err) {
      output = `Error spawning claude: ${err}`;
      exitCode = 1;
    }

    return {
      exitCode,
      output,
      durationMs: Date.now() - startTime,
      usage,
    };
  }
}

export class CodexCLI extends AgentCLI {
  readonly name = "codex" as const;

  buildArgs(opts: SpawnOptions): string[] {
    // Codex `exec` has no --system-prompt flag. Prepending the system prompt to the
    // user prompt under labeled sections is the lowest-coupling delivery: no config
    // override, no AGENTS.md collision (this repo's AGENTS.md is load-bearing).
    const fullPrompt = opts.systemPrompt
      ? `## System\n${opts.systemPrompt}\n\n## Task\n${opts.userPrompt}`
      : opts.userPrompt;
    const args = [
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      opts.cwd,
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    args.push(fullPrompt);
    return args;
  }

  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const startTime = Date.now();
    const args = this.buildArgs(opts);

    let output = "";
    let exitCode = 0;
    let usage: AgentUsage | undefined;

    try {
      const proc = Bun.spawn(args, {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "inherit",
        signal: opts.abortSignal,
      });

      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let finalResult = "";

      for await (const chunk of proc.stdout) {
        const text = decoder.decode(chunk);
        chunks.push(text);

        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          let event: CodexStreamEvent;
          try {
            event = JSON.parse(line) as CodexStreamEvent;
          } catch {
            continue;
          }

          const msg = event.msg;
          if (!msg) continue;

          if (msg.type === "agent_message" && typeof msg.message === "string") {
            finalResult = msg.message;
          } else if (msg.type === "task_complete" && typeof msg.last_agent_message === "string") {
            finalResult = msg.last_agent_message;
          } else if (msg.type === "token_count" && msg.info) {
            const totals = msg.info.total_token_usage ?? msg.info.last_token_usage;
            if (totals) {
              const inputTokens = totals.input_tokens ?? 0;
              const cached = totals.cached_input_tokens ?? 0;
              usage = {
                inputTokens,
                outputTokens: totals.output_tokens ?? 0,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: cached,
                // costUsd intentionally omitted — Codex JSONL does not emit cost.
              };
            }
          }

          if (!opts.stream) continue;

          if (msg.type === "agent_message" && typeof msg.message === "string") {
            process.stdout.write(`\n${msg.message}\n`);
          } else if (msg.type === "agent_message_delta" && typeof msg.delta === "string") {
            process.stdout.write(msg.delta);
          } else if (msg.type === "exec_command_begin" && typeof msg.name === "string") {
            process.stdout.write(`\n[Tool: ${msg.name}]\n`);
          }
        }
      }

      exitCode = await proc.exited;
      output = finalResult || chunks.join("");
    } catch (err) {
      output = `Error spawning codex: ${err}`;
      exitCode = 1;
    }

    return {
      exitCode,
      output,
      durationMs: Date.now() - startTime,
      usage,
    };
  }
}
