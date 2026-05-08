export interface SpawnClaudeOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  stream?: boolean;
}

export interface SpawnClaudeResult {
  exitCode: number;
  output: string;
  durationMs: number;
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

      if (!opts.stream) continue;

      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                process.stdout.write(block.text);
              } else if (block.type === "tool_use") {
                process.stdout.write(`\n[Tool: ${block.name}]\n`);
              }
            }
          } else if (event.type === "result" && event.result) {
            finalResult = event.result;
            process.stdout.write(`\n${event.result}\n`);
          }
        } catch {
          // Non-JSON line, skip
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
  };
}
