export interface SpawnClaudeOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  stream?: boolean;
}

export interface SpawnClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
}

export interface SpawnClaudeResult {
  exitCode: number;
  output: string;
  durationMs: number;
  usage?: SpawnClaudeUsage;
}

interface StreamEvent {
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

export async function spawnClaude(opts: SpawnClaudeOptions): Promise<SpawnClaudeResult> {
  const startTime = Date.now();

  const args = ["claude", "--dangerously-skip-permissions", "-p", opts.userPrompt];
  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  args.push("--output-format", "stream-json", "--verbose");

  let output = "";
  let exitCode = 0;
  let usage: SpawnClaudeUsage | undefined;

  try {
    const proc = Bun.spawn(args, {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "inherit",
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let finalResult = "";

    for await (const chunk of proc.stdout) {
      const text = decoder.decode(chunk);
      chunks.push(text);

      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(line) as StreamEvent;
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
