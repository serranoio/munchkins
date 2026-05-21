import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentBuilder } from "../builder/agent-builder.js";
import { AgentRegistry } from "./registry.js";

const ENV_KEYS = [
  "__MUNCHKINS_OPT_dryRun",
  "__MUNCHKINS_OPT_thinking",
  "__MUNCHKINS_OPT_verbose",
  "__MUNCHKINS_OPT_cli",
];

describe("AgentRegistry.cli()", () => {
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

  test("registers --thinking, --verbose, --dry-run, and --cli on each subcommand", () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("alpha", "first"));
    reg.register(new AgentBuilder("beta", "second"));

    const program = reg.cli();
    expect(program.commands.map((c) => c.name())).toEqual(["alpha", "beta"]);

    for (const sub of program.commands) {
      const longs = sub.options.map((o) => o.long);
      expect(longs).toContain("--thinking");
      expect(longs).toContain("--verbose");
      expect(longs).toContain("--dry-run");
      expect(longs).toContain("--cli");
    }
  });

  test("--thinking option carries a description", () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("alpha"));

    const sub = reg.cli().commands[0];
    const thinking = sub.options.find((o) => o.long === "--thinking");
    expect(thinking).toBeDefined();
    expect(thinking?.description).toMatch(/stream/i);
  });

  test("parsing --thinking sets __MUNCHKINS_OPT_thinking before invoking run()", async () => {
    const reg = new AgentRegistry();
    const builder = new AgentBuilder("alpha");

    let observedThinking: string | undefined;
    let observedVerbose: string | undefined;
    const originalExit = process.exit;
    // Prevent the action handler from terminating the test runner.
    (process as { exit: (code?: number) => never }).exit = ((_code?: number) => {
      throw new Error("__exit__");
    }) as never;

    // Stub run() to capture env-var state set by the action handler.
    (builder as unknown as { run: () => Promise<unknown> }).run = async () => {
      observedThinking = process.env.__MUNCHKINS_OPT_thinking;
      observedVerbose = process.env.__MUNCHKINS_OPT_verbose;
      return { worktreePath: "", branch: "", succeeded: true };
    };

    reg.register(builder);

    try {
      await reg.cli().parseAsync(["node", "munchkins", "alpha", "--thinking"]);
    } catch (err) {
      if ((err as Error).message !== "__exit__") throw err;
    } finally {
      process.exit = originalExit;
    }

    expect(observedThinking).toBe("true");
    expect(observedVerbose).toBeUndefined();
  });

  test("parsing --cli=codex sets __MUNCHKINS_OPT_cli before invoking run()", async () => {
    const reg = new AgentRegistry();
    const builder = new AgentBuilder("alpha");

    let observed: string | undefined;
    const originalExit = process.exit;
    (process as { exit: (code?: number) => never }).exit = ((_code?: number) => {
      throw new Error("__exit__");
    }) as never;

    (builder as unknown as { run: () => Promise<unknown> }).run = async () => {
      observed = process.env.__MUNCHKINS_OPT_cli;
      return { worktreePath: "", branch: "", succeeded: true };
    };

    reg.register(builder);

    try {
      await reg.cli().parseAsync(["node", "munchkins", "alpha", "--cli", "codex"]);
    } catch (err) {
      if ((err as Error).message !== "__exit__") throw err;
    } finally {
      process.exit = originalExit;
    }

    expect(observed).toBe("codex");
  });

  test("registerCommand() adds a top-level subcommand visible in cli().commands", () => {
    const reg = new AgentRegistry();
    reg.registerCommand({
      name: "status",
      description: "Show running munchkins.",
      configure: (cmd) => {
        cmd.option("--json", "json mode");
      },
    });

    const program = reg.cli();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("status");

    const status = program.commands.find((c) => c.name() === "status");
    expect(status?.description()).toBe("Show running munchkins.");
    expect(status?.options.map((o) => o.long)).toContain("--json");
  });

  test("registerCommand() throws on duplicate name", () => {
    const reg = new AgentRegistry();
    reg.registerCommand({ name: "status", description: "first", configure: () => {} });
    expect(() =>
      reg.registerCommand({ name: "status", description: "second", configure: () => {} }),
    ).toThrow(/already registered/);
  });

  test("cli() does NOT attach agent flags to registered commands", () => {
    const reg = new AgentRegistry();
    reg.registerCommand({
      name: "daemon",
      description: "Run cron-armed builders.",
      configure: () => {},
    });

    const sub = reg.cli().commands.find((c) => c.name() === "daemon");
    const longs = sub?.options.map((o) => o.long) ?? [];
    expect(longs).not.toContain("--dry-run");
    expect(longs).not.toContain("--thinking");
    expect(longs).not.toContain("--verbose");
    expect(longs).not.toContain("--cli");
    expect(longs).not.toContain("--integrate");
  });

  test("an agent and a registered command can coexist with different names", () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("alpha"));
    reg.registerCommand({
      name: "status",
      description: "Show running munchkins.",
      configure: () => {},
    });

    const program = reg.cli();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(["alpha", "status"]);

    const agent = program.commands.find((c) => c.name() === "alpha");
    const agentLongs = agent?.options.map((o) => o.long) ?? [];
    expect(agentLongs).toContain("--thinking");

    const status = program.commands.find((c) => c.name() === "status");
    const statusLongs = status?.options.map((o) => o.long) ?? [];
    expect(statusLongs).not.toContain("--thinking");
  });

  test("absence of --thinking leaves __MUNCHKINS_OPT_thinking unset", async () => {
    const reg = new AgentRegistry();
    const builder = new AgentBuilder("alpha");

    let observed: string | undefined;
    const originalExit = process.exit;
    (process as { exit: (code?: number) => never }).exit = ((_code?: number) => {
      throw new Error("__exit__");
    }) as never;

    (builder as unknown as { run: () => Promise<unknown> }).run = async () => {
      observed = process.env.__MUNCHKINS_OPT_thinking;
      return { worktreePath: "", branch: "", succeeded: true };
    };

    reg.register(builder);

    try {
      await reg.cli().parseAsync(["node", "munchkins", "alpha"]);
    } catch (err) {
      if ((err as Error).message !== "__exit__") throw err;
    } finally {
      process.exit = originalExit;
    }

    expect(observed).toBeUndefined();
  });
});
