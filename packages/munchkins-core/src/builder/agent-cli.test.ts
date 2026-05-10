import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentCLI, ClaudeCLI, CodexCLI } from "./agent-cli.js";

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
