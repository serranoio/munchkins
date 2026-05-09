import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentBuilder } from "../builder/agent-builder.js";
import { applyTickEnv } from "./daemon.js";

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
