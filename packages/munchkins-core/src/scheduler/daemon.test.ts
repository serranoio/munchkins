import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentBuilder } from "../builder/agent-builder.js";
import { AgentRegistry } from "../registry/registry.js";
import { applyTickEnv, collectCronnedBuilders, runDaemon } from "./daemon.js";

const ENV_KEYS = [
  "__MUNCHKINS_OPT_verbose",
  "__MUNCHKINS_OPT_thinking",
  "__MUNCHKINS_OPT_userMessage",
] as const;

describe("AgentBuilder.cron / getCron", () => {
  test("getCron() returns undefined when .cron() was never called", () => {
    const b = new AgentBuilder("a");
    expect(b.getCron()).toBeUndefined();
  });

  test("getCron() returns spec/userMessage and verbosity defaults to 'default'", () => {
    const b = new AgentBuilder("a").cron("0 2 * * *", { userMessage: "x" });
    expect(b.getCron()).toEqual({
      spec: "0 2 * * *",
      userMessage: "x",
      verbosity: "default",
    });
  });

  test("getCron() carries explicit verbosity 'thinking'", () => {
    const b = new AgentBuilder("a").cron("*/5 * * * *", {
      userMessage: "msg",
      verbosity: "thinking",
    });
    expect(b.getCron()).toEqual({
      spec: "*/5 * * * *",
      userMessage: "msg",
      verbosity: "thinking",
    });
  });

  test("calling .cron() twice on the same builder throws naming the agent", () => {
    const b = new AgentBuilder("rebellious-agent").cron("0 2 * * *", { userMessage: "x" });
    expect(() => b.cron("0 3 * * *", { userMessage: "y" })).toThrow(/rebellious-agent/);
  });
});

describe("applyTickEnv", () => {
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

  test("verbosity 'verbose' sets __MUNCHKINS_OPT_verbose=true and leaves thinking unset", () => {
    applyTickEnv({ verbosity: "verbose", userMessage: "hi" });
    expect(process.env.__MUNCHKINS_OPT_verbose).toBe("true");
    expect(process.env.__MUNCHKINS_OPT_thinking).toBeUndefined();
    expect(process.env.__MUNCHKINS_OPT_userMessage).toBe("hi");
  });

  test("verbosity 'thinking' sets __MUNCHKINS_OPT_thinking=true and leaves verbose unset", () => {
    applyTickEnv({ verbosity: "thinking", userMessage: "hi" });
    expect(process.env.__MUNCHKINS_OPT_thinking).toBe("true");
    expect(process.env.__MUNCHKINS_OPT_verbose).toBeUndefined();
  });

  test("verbosity 'default' clears both flags", () => {
    applyTickEnv({ verbosity: "default", userMessage: "hi" });
    expect(process.env.__MUNCHKINS_OPT_verbose).toBeUndefined();
    expect(process.env.__MUNCHKINS_OPT_thinking).toBeUndefined();
  });

  test("does not leak verbosity from a previous tick", () => {
    applyTickEnv({ verbosity: "verbose", userMessage: "first" });
    applyTickEnv({ verbosity: "thinking", userMessage: "second" });
    expect(process.env.__MUNCHKINS_OPT_verbose).toBeUndefined();
    expect(process.env.__MUNCHKINS_OPT_thinking).toBe("true");
    expect(process.env.__MUNCHKINS_OPT_userMessage).toBe("second");
  });
});

describe("collectCronnedBuilders", () => {
  test("returns [] when no registered agent is cronned", () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("plain"));
    expect(collectCronnedBuilders(reg)).toEqual([]);
  });

  test("filters non-cronned agents and pairs each cronned builder with its cfg", () => {
    const reg = new AgentRegistry();
    const cronned = new AgentBuilder("cronned").cron("0 2 * * *", {
      userMessage: "tick",
      verbosity: "thinking",
    });
    reg.register(new AgentBuilder("plain"));
    reg.register(cronned);

    const rows = collectCronnedBuilders(reg);
    expect(rows).toHaveLength(1);
    expect(rows[0].builder).toBe(cronned);
    expect(rows[0].cfg).toEqual({
      spec: "0 2 * * *",
      userMessage: "tick",
      verbosity: "thinking",
    });
  });

  test("skips registry entries whose get() returns undefined", () => {
    const stub = {
      list: () => ["ghost"],
      get: (_name: string) => undefined,
    };
    expect(collectCronnedBuilders(stub)).toEqual([]);
  });
});

describe("runDaemon", () => {
  test("exits 1 and warns when registry has no cronned builders", async () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("plain"));

    const stderrLines: string[] = [];
    const originalExit = process.exit;
    (process as { exit: (code?: number) => never }).exit = ((_code?: number) => {
      throw new Error("__exit__");
    }) as never;

    try {
      await runDaemon({
        registry: reg,
        stderr: (line) => stderrLines.push(line),
        stdout: () => {},
        setTimer: () => 0,
        arm: false,
      });
      throw new Error("runDaemon should have called process.exit");
    } catch (err) {
      if ((err as Error).message !== "__exit__") throw err;
    } finally {
      process.exit = originalExit;
    }

    expect(stderrLines.some((l) => /no cronned builders/i.test(l))).toBe(true);
  });

  test("with arm:false prints startup table and does not arm timers", async () => {
    const reg = new AgentRegistry();
    reg.register(
      new AgentBuilder("alpha").cron("0 2 * * *", {
        userMessage: "hi",
        verbosity: "verbose",
      }),
    );

    const stdoutLines: string[] = [];
    let timerCalls = 0;

    await runDaemon({
      registry: reg,
      now: () => new Date("2026-01-01T00:00:00Z"),
      stdout: (line) => stdoutLines.push(line),
      stderr: () => {},
      setTimer: () => {
        timerCalls += 1;
        return 0;
      },
      arm: false,
    });

    const out = stdoutLines.join("\n");
    expect(out).toContain("alpha");
    expect(out).toContain("0 2 * * *");
    expect(out).toContain("verbose");
    expect(out).toMatch(/1 cronned builder\(s\) armed/);
    expect(timerCalls).toBe(0);
  });

  test("with arm:true (default) arms one timer per cronned builder", async () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("alpha").cron("0 2 * * *", { userMessage: "a" }));
    reg.register(new AgentBuilder("beta").cron("0 3 * * *", { userMessage: "b" }));

    let timerCalls = 0;

    await runDaemon({
      registry: reg,
      now: () => new Date("2026-01-01T00:00:00Z"),
      stdout: () => {},
      stderr: () => {},
      // Capture but never invoke the callback so ticks don't fire.
      setTimer: () => {
        timerCalls += 1;
        return 0;
      },
    });

    expect(timerCalls).toBe(2);
  });

  test("invoking the armed timer's callback fires builder.run() exactly once and re-arms the next tick", async () => {
    const reg = new AgentRegistry();
    const cronned = new AgentBuilder("alpha").cron("*/10 * * * *", {
      userMessage: "tick",
      verbosity: "thinking",
    });
    reg.register(cronned);

    let runCalls = 0;
    // Stub out the real run() — we only care that the daemon's tick callback
    // reaches the builder. A real run() would spawn git/Claude and is covered
    // by the harness scenario, not by this unit test.
    (cronned as unknown as { run: () => Promise<unknown> }).run = async () => {
      runCalls += 1;
      return { worktreePath: "", branch: "", succeeded: true };
    };

    let armCount = 0;
    let fired = false;

    await runDaemon({
      registry: reg,
      now: () => new Date("2026-01-01T00:00:00Z"),
      stdout: () => {},
      stderr: () => {},
      setTimer: (cb: () => void) => {
        armCount += 1;
        // Fire the FIRST armed timer synchronously; ignore the re-arm after
        // fireTick completes so we don't loop forever.
        if (!fired) {
          fired = true;
          cb();
        }
        return 0;
      },
    });

    // fireTick is async and awaits builder.run() before re-arming; give it a
    // microtask + macrotask window to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runCalls).toBe(1);
    // First arm + the re-arm scheduled in fireTick's finally block.
    expect(armCount).toBeGreaterThanOrEqual(2);
  });
});
