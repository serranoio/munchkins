import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentCLI, ClaudeCLI, CodexCLI, type SpawnResult } from "./agent-cli.js";

const ENV_KEYS = ["__MUNCHKINS_OPT_cli", "MUNCHKINS_CLI"] as const;

describe("AgentCLI.fromEnv()", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("returns ClaudeCLI when both env vars are unset (default)", () => {
    const cli = AgentCLI.fromEnv();
    expect(cli).toBeInstanceOf(ClaudeCLI);
    expect(cli.name).toBe("claude");
  });

  test("returns CodexCLI when MUNCHKINS_CLI=codex", () => {
    process.env.MUNCHKINS_CLI = "codex";
    const cli = AgentCLI.fromEnv();
    expect(cli).toBeInstanceOf(CodexCLI);
    expect(cli.name).toBe("codex");
  });

  test("returns CodexCLI when only __MUNCHKINS_OPT_cli=codex (flag-only)", () => {
    process.env.__MUNCHKINS_OPT_cli = "codex";
    const cli = AgentCLI.fromEnv();
    expect(cli).toBeInstanceOf(CodexCLI);
  });

  test("__MUNCHKINS_OPT_cli wins when both are set with conflicting values (flag wins)", () => {
    process.env.MUNCHKINS_CLI = "claude";
    process.env.__MUNCHKINS_OPT_cli = "codex";
    expect(AgentCLI.fromEnv()).toBeInstanceOf(CodexCLI);

    process.env.MUNCHKINS_CLI = "codex";
    process.env.__MUNCHKINS_OPT_cli = "claude";
    expect(AgentCLI.fromEnv()).toBeInstanceOf(ClaudeCLI);
  });

  test("throws on unknown value with a message naming the valid options", () => {
    process.env.__MUNCHKINS_OPT_cli = "gemini";
    expect(() => AgentCLI.fromEnv()).toThrow(/Unknown CLI backend "gemini"/);
    expect(() => AgentCLI.fromEnv()).toThrow(/claude.*codex/);
  });
});

describe("ClaudeCLI.buildArgs", () => {
  test("matches the existing spawnClaude arg shape (regression lock)", () => {
    const cli = new ClaudeCLI();
    const args = cli.buildArgs({
      systemPrompt: "SYS",
      userPrompt: "USER",
      cwd: "/tmp",
    });
    expect(args).toEqual([
      "claude",
      "--dangerously-skip-permissions",
      "-p",
      "USER",
      "--system-prompt",
      "SYS",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  test("omits --system-prompt when systemPrompt is empty", () => {
    const args = new ClaudeCLI().buildArgs({
      systemPrompt: "",
      userPrompt: "U",
      cwd: "/tmp",
    });
    expect(args).not.toContain("--system-prompt");
  });

  test("includes --model and --disallowedTools when provided", () => {
    const args = new ClaudeCLI().buildArgs({
      systemPrompt: "S",
      userPrompt: "U",
      cwd: "/tmp",
      model: "sonnet",
      disallowedTools: ["Bash", "Edit"],
    });
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("Bash,Edit");
  });
});

describe("ClaudeCLI resume mechanics", () => {
  test("includes --resume <id> and replaces the user prompt with the continue message", () => {
    const args = new ClaudeCLI().buildArgs({
      systemPrompt: "SYS",
      userPrompt: "ORIGINAL USER",
      cwd: "/tmp",
      resumeSessionId: "abc-123",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("abc-123");
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toMatch(/Continue from where you left off/);
    // The original user prompt is suppressed in resume mode.
    expect(args).not.toContain("ORIGINAL USER");
  });

  test("does NOT pass --resume when resumeSessionId is absent (regression lock)", () => {
    const args = new ClaudeCLI().buildArgs({
      systemPrompt: "SYS",
      userPrompt: "ORIGINAL USER",
      cwd: "/tmp",
    });
    expect(args).not.toContain("--resume");
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe("ORIGINAL USER");
  });
});

describe("CodexCLI resume mechanics", () => {
  test("uses 'codex exec resume <id>' (the non-interactive resume form) and the continue message", () => {
    const cli = new CodexCLI();
    const opts = {
      systemPrompt: "SYS",
      userPrompt: "ORIGINAL USER",
      cwd: "/tmp",
      resumeSessionId: "xyz-789",
    };
    const args = cli.buildArgs(opts);
    expect(args[0]).toBe("codex");
    expect(args[1]).toBe("exec");
    expect(args[2]).toBe("resume");
    expect(args[3]).toBe("xyz-789");
    expect(args).not.toContain("ORIGINAL USER");
    // The composed prompt is supplied through stdin, not argv.
    expect(cli.buildPrompt(opts)).toMatch(/Continue from where you left off/);
    expect(cli.buildPrompt(opts)).not.toMatch(/ORIGINAL USER/);
  });

  test("does NOT include 'resume' when resumeSessionId is absent (regression lock)", () => {
    const args = new CodexCLI().buildArgs({
      systemPrompt: "SYS",
      userPrompt: "ORIGINAL USER",
      cwd: "/tmp",
    });
    expect(args[0]).toBe("codex");
    expect(args[1]).toBe("exec");
    expect(args).not.toContain("resume");
  });
});

describe("ClaudeCLI rate-limit retry", () => {
  type RunJsonStreamFn = (opts: unknown, args: string[], handle: unknown) => Promise<SpawnResult>;

  function patchRunJsonStream(cli: ClaudeCLI, impl: RunJsonStreamFn): void {
    // Replace the protected runJsonStream seam on the instance for the test.
    (cli as unknown as { runJsonStream: RunJsonStreamFn }).runJsonStream = impl;
  }

  function makeOpts() {
    return { systemPrompt: "", userPrompt: "u", cwd: "/tmp" };
  }

  test("retries once when output reports a future unix-seconds limit", async () => {
    const cli = new ClaudeCLI();
    const futureSec = Math.ceil(Date.now() / 1000) + 1; // ~0–1s in the future
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      if (calls === 1) {
        return {
          exitCode: 1,
          output: `Claude AI usage limit reached|${futureSec}`,
          durationMs: 10,
        };
      }
      return { exitCode: 0, output: "second-result", durationMs: 5 };
    });

    const start = Date.now();
    const result = await cli.spawn(makeOpts());
    const elapsed = Date.now() - start;

    expect(calls).toBe(2);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("second-result");
    // Sanity: actually slept until the reset (within one second of `futureSec`).
    expect(elapsed).toBeLessThan(2000);
  });

  test("does not retry on success even if output looks like a limit message", async () => {
    const cli = new ClaudeCLI();
    const futureSec = Math.ceil(Date.now() / 1000) + 60;
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 0,
        output: `Claude AI usage limit reached|${futureSec}`,
        durationMs: 10,
      };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  test("does not retry when reset timestamp fails to parse", async () => {
    const cli = new ClaudeCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      // 5-digit number — does not match \d{10,} so the regex doesn't fire,
      // making this a parse-failure / no-match case.
      return {
        exitCode: 1,
        output: "Claude AI usage limit reached|notanumber",
        durationMs: 10,
      };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  test("returns the second result verbatim and does not spawn a third time on consecutive limit-hits", async () => {
    const cli = new ClaudeCLI();
    const futureSec = Math.ceil(Date.now() / 1000) + 1;
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: `Claude AI usage limit reached|${futureSec}`,
        durationMs: 10,
      };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(2);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Claude AI usage limit reached");
  });

  test("aborted abortSignal during the wait rejects without retrying", async () => {
    const cli = new ClaudeCLI();
    const futureSec = Math.ceil(Date.now() / 1000) + 60; // 60s — long enough to abort mid-wait
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: `Claude AI usage limit reached|${futureSec}`,
        durationMs: 10,
      };
    });

    const ac = new AbortController();
    const promise = cli.spawn({ ...makeOpts(), abortSignal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await expect(promise).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("retries when limit message appears only in stderr (not output)", async () => {
    const cli = new ClaudeCLI();
    const futureSec = Math.ceil(Date.now() / 1000) + 1;
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      if (calls === 1) {
        return {
          exitCode: 1,
          output: "",
          stderr: `Claude AI usage limit reached|${futureSec}\n`,
          durationMs: 10,
        };
      }
      return { exitCode: 0, output: "ok", durationMs: 5 };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(2);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("ok");
  });

  test("triggers a retry-wait on HHMM-format reset time (proven via mid-wait abort)", async () => {
    const cli = new ClaudeCLI();
    // ~5 minutes ahead, well outside Bun's default test timeout. Abort short-circuits
    // the wait — reaching the wait at all proves HHMM was parsed and treated as a hit.
    const target = new Date(Date.now() + 5 * 60_000);
    const hhmm = `${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`;
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: `Claude AI usage limit reached at ${hhmm}`,
        durationMs: 10,
      };
    });

    const ac = new AbortController();
    const promise = cli.spawn({ ...makeOpts(), abortSignal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await expect(promise).rejects.toBeDefined();
    // Exactly one spawn — the abort fired during the post-spawn sleep, before retry.
    expect(calls).toBe(1);
  });

  test("does not retry when HHMM is out of range (e.g. 25:99)", async () => {
    const cli = new ClaudeCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: "Claude AI usage limit reached at 25:99",
        durationMs: 10,
      };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  test("retries on generic 'rate limit' substring (no timestamp) using fallback wait", async () => {
    const cli = new ClaudeCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      if (calls === 1) {
        return {
          exitCode: 1,
          output: "Error: you have exceeded your rate limit, try again later",
          durationMs: 10,
        };
      }
      return { exitCode: 0, output: "post-retry-result", durationMs: 5 };
    });

    const ac = new AbortController();
    const promise = cli.spawn({ ...makeOpts(), abortSignal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    // The fallback wait is ~60s; aborting mid-wait proves the retry path was
    // entered (without this branch the result would have returned immediately
    // on call 1 with exit code 1).
    await expect(promise).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("'rate limit' matcher is case-insensitive (e.g. 'Rate Limit' in stderr)", async () => {
    const cli = new ClaudeCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: "",
        stderr: "Anthropic API Rate Limit exceeded — retry in a moment\n",
        durationMs: 10,
      };
    });

    const ac = new AbortController();
    const promise = cli.spawn({ ...makeOpts(), abortSignal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await expect(promise).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("HHMM-out-of-range still returns without retry (specific match preserves no-retry semantics)", async () => {
    // Regression lock for the previous "25:99" test — adding the generic
    // 'rate limit' matcher must NOT change behavior when a specific format
    // matched but failed to parse a usable reset time.
    const cli = new ClaudeCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: "Claude AI usage limit reached at 25:99",
        durationMs: 10,
      };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(1);
  });
});

describe("CodexCLI.buildArgs", () => {
  test("prepends system prompt under labeled sections and includes the bypass flag", () => {
    const cli = new CodexCLI();
    const opts = {
      systemPrompt: "SYS",
      userPrompt: "USER",
      cwd: "/tmp",
    };
    const args = cli.buildArgs(opts);
    expect(args[0]).toBe("codex");
    expect(args[1]).toBe("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain("-C");
    expect(args).toContain("/tmp");
    expect(args).not.toContain("USER");
    expect(cli.buildPrompt(opts)).toBe("## System\nSYS\n\n## Task\nUSER");
  });

  test("falls back to plain user prompt when systemPrompt is empty", () => {
    const cli = new CodexCLI();
    const opts = {
      systemPrompt: "",
      userPrompt: "USER",
      cwd: "/tmp",
    };
    expect(cli.buildArgs(opts)).not.toContain("USER");
    expect(cli.buildPrompt(opts)).toBe("USER");
  });

  test("includes --model when provided", () => {
    const args = new CodexCLI().buildArgs({
      systemPrompt: "S",
      userPrompt: "U",
      cwd: "/tmp",
      model: "gpt-5-codex",
    });
    expect(args).toContain("--model");
    expect(args).toContain("gpt-5-codex");
  });
});

describe("CodexCLI JSONL stream parsing", () => {
  type RunJsonStreamFn = (opts: unknown, args: string[], handle: unknown) => Promise<SpawnResult>;
  type Handler = (
    event: unknown,
    ctx: {
      setFinalResult: (s: string) => void;
      setUsage: (u: unknown) => void;
      setSessionId: (s: string) => void;
    },
  ) => void;

  // Drives the handler the way `runJsonStream` does in production: parse JSONL
  // line by line and dispatch each event. Then call `CodexCLI.spawn` with a
  // patched `runJsonStream` so the parser path the handler lives in actually runs.
  function runHandlerAgainstStream(jsonl: string): {
    sessionId: string | undefined;
    finalResult: string;
    usage: unknown;
  } {
    let sessionId: string | undefined;
    let finalResult = "";
    let usage: unknown;
    const ctx = {
      setFinalResult: (s: string) => {
        finalResult = s;
      },
      setUsage: (u: unknown) => {
        usage = u;
      },
      setSessionId: (s: string) => {
        sessionId = s;
      },
    };

    let captured: Handler | undefined;
    const cli = new CodexCLI();
    (cli as unknown as { runJsonStream: RunJsonStreamFn }).runJsonStream = async (_o, _a, h) => {
      captured = h as Handler;
      return { exitCode: 0, output: "", durationMs: 1 };
    };
    // Trigger spawn so CodexCLI registers its handler with runJsonStream.
    void cli.spawn({ systemPrompt: "", userPrompt: "u", cwd: "/tmp" });

    if (!captured) throw new Error("handler not captured");
    for (const line of jsonl.split("\n")) {
      if (!line.trim()) continue;
      captured(JSON.parse(line), ctx);
    }
    return { sessionId, finalResult, usage };
  }

  test("parses codex 0.139 flat-event stream (thread.started + item.completed + turn.completed)", () => {
    const stream = [
      `{"type":"thread.started","thread_id":"019ecde2-68a2-7d20-b5e4-8029d5dc149e"}`,
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"codex-ok"}}`,
      `{"type":"turn.completed","usage":{"input_tokens":17376,"cached_input_tokens":9600,"output_tokens":7,"reasoning_output_tokens":0}}`,
    ].join("\n");

    const { sessionId, finalResult, usage } = runHandlerAgainstStream(stream);
    expect(sessionId).toBe("019ecde2-68a2-7d20-b5e4-8029d5dc149e");
    expect(finalResult).toBe("codex-ok");
    expect(usage).toEqual({
      inputTokens: 17376,
      outputTokens: 7,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 9600,
    });
  });

  test("parses older codex nested-msg stream (session_id + agent_message + token_count)", () => {
    const stream = [
      `{"session_id":"abc-123","msg":{"type":"session_configured"}}`,
      `{"msg":{"type":"agent_message","message":"old-shape-ok"}}`,
      `{"msg":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20}}}}`,
    ].join("\n");

    const { sessionId, finalResult, usage } = runHandlerAgainstStream(stream);
    expect(sessionId).toBe("abc-123");
    expect(finalResult).toBe("old-shape-ok");
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 50,
    });
  });

  test("does not emit costUsd (Codex JSONL never reports cost)", () => {
    const stream = `{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"cached_input_tokens":0}}`;
    const { usage } = runHandlerAgainstStream(stream);
    expect(usage).toBeDefined();
    expect((usage as { costUsd?: number }).costUsd).toBeUndefined();
  });
});

describe("AgentCLI subprocess stdin handling", () => {
  class TestCLI extends AgentCLI {
    readonly name = "codex" as const;

    async spawn(): Promise<SpawnResult> {
      return this.runJsonStream(
        { systemPrompt: "", userPrompt: "u", cwd: "/tmp/munchkins-test" },
        ["codex", "exec", "--json", "prompt"],
        () => {},
      );
    }
  }

  test("ignores parent stdin when spawning model CLIs", async () => {
    const originalSpawn = Bun.spawn;
    let capturedOptions: { stdin?: unknown } | undefined;
    const emptyBody = (): ReadableStream<Uint8Array> => {
      const body = new Response("").body;
      if (!body) throw new Error("expected response body");
      return body;
    };

    Bun.spawn = ((_args: string[], options: { stdin?: unknown }) => {
      capturedOptions = options;
      return {
        stdout: emptyBody(),
        stderr: emptyBody(),
        exited: Promise.resolve(0),
      };
    }) as typeof Bun.spawn;

    try {
      await new TestCLI().spawn();
    } finally {
      Bun.spawn = originalSpawn;
    }

    expect(capturedOptions?.stdin).toBe("ignore");
  });

  test("passes Codex prompts through stdin instead of argv", async () => {
    type RunJsonStreamFn = (
      opts: unknown,
      args: string[],
      handle: unknown,
      stdinText?: string,
    ) => Promise<SpawnResult>;

    const cli = new CodexCLI();
    let capturedArgs: string[] = [];
    let capturedStdin: string | undefined;
    (cli as unknown as { runJsonStream: RunJsonStreamFn }).runJsonStream = async (
      _opts,
      args,
      _handle,
      stdinText,
    ) => {
      capturedArgs = args;
      capturedStdin = stdinText;
      return { exitCode: 0, output: "ok", durationMs: 1 };
    };

    await cli.spawn({ systemPrompt: "SYS", userPrompt: "USER", cwd: "/tmp" });

    expect(capturedArgs).not.toContain("USER");
    expect(capturedStdin).toBe("## System\nSYS\n\n## Task\nUSER");
  });
});

describe("CodexCLI rate-limit retry", () => {
  type RunJsonStreamFn = (opts: unknown, args: string[], handle: unknown) => Promise<SpawnResult>;

  function patchRunJsonStream(cli: CodexCLI, impl: RunJsonStreamFn): void {
    (cli as unknown as { runJsonStream: RunJsonStreamFn }).runJsonStream = impl;
  }

  function makeOpts() {
    return { systemPrompt: "", userPrompt: "u", cwd: "/tmp" };
  }

  test("retries once after fallback wait when output mentions 'rate limit'", async () => {
    const cli = new CodexCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      if (calls === 1) {
        return {
          exitCode: 1,
          output: "Error: you have exceeded your rate limit, retry later",
          durationMs: 10,
        };
      }
      return { exitCode: 0, output: "post-retry", durationMs: 5 };
    });

    const ac = new AbortController();
    const promise = cli.spawn({ ...makeOpts(), abortSignal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    // ~60s fallback wait; aborting mid-wait proves the retry path was entered
    // on the Codex backend without requiring an actual 60-second sleep.
    await expect(promise).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("retries when 'rate limit' appears only in stderr", async () => {
    const cli = new CodexCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: "",
        stderr: "Rate Limit exceeded\n",
        durationMs: 10,
      };
    });

    const ac = new AbortController();
    const promise = cli.spawn({ ...makeOpts(), abortSignal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await expect(promise).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("does not retry when output contains no rate-limit phrase", async () => {
    const cli = new CodexCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return {
        exitCode: 1,
        output: "syntax error in prompt",
        durationMs: 10,
      };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  test("does not retry on success (exitCode 0)", async () => {
    const cli = new CodexCLI();
    let calls = 0;
    patchRunJsonStream(cli, async () => {
      calls += 1;
      return { exitCode: 0, output: "fine", durationMs: 5 };
    });

    const result = await cli.spawn(makeOpts());
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(0);
  });
});
