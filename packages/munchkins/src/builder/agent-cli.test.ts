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
  test("prepends 'resume <id>' before exec and uses the continue message", () => {
    const args = new CodexCLI().buildArgs({
      systemPrompt: "SYS",
      userPrompt: "ORIGINAL USER",
      cwd: "/tmp",
      resumeSessionId: "xyz-789",
    });
    expect(args[0]).toBe("codex");
    expect(args[1]).toBe("resume");
    expect(args[2]).toBe("xyz-789");
    expect(args[3]).toBe("exec");
    // The composed prompt embeds the continue message, not the original.
    expect(args[args.length - 1]).toMatch(/Continue from where you left off/);
    expect(args[args.length - 1]).not.toMatch(/ORIGINAL USER/);
  });

  test("does NOT prepend 'resume' when resumeSessionId is absent (regression lock)", () => {
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
});

describe("CodexCLI.buildArgs", () => {
  test("prepends system prompt under labeled sections and includes the bypass flag", () => {
    const args = new CodexCLI().buildArgs({
      systemPrompt: "SYS",
      userPrompt: "USER",
      cwd: "/tmp",
    });
    expect(args[0]).toBe("codex");
    expect(args[1]).toBe("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain("-C");
    expect(args).toContain("/tmp");
    // The composed prompt is the final positional argument.
    expect(args[args.length - 1]).toBe("## System\nSYS\n\n## Task\nUSER");
  });

  test("falls back to plain user prompt when systemPrompt is empty", () => {
    const args = new CodexCLI().buildArgs({
      systemPrompt: "",
      userPrompt: "USER",
      cwd: "/tmp",
    });
    expect(args[args.length - 1]).toBe("USER");
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
