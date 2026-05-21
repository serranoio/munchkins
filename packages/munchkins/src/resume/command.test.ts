import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../registry/registry.js";
import { registerResumeCommand } from "./command.js";

describe("registerResumeCommand", () => {
  test("registers a 'resume' subcommand with the right description", () => {
    const reg = new AgentRegistry();
    registerResumeCommand(reg);

    const resume = reg.cli().commands.find((c) => c.name() === "resume");
    expect(resume).toBeDefined();
    expect(resume?.description()).toBe("Resume a previously interrupted agent run.");
  });

  test("declares --list and --latest as options", () => {
    const reg = new AgentRegistry();
    registerResumeCommand(reg);

    const resume = reg.cli().commands.find((c) => c.name() === "resume");
    const longs = resume?.options.map((o) => o.long) ?? [];
    expect(longs).toContain("--list");
    expect(longs).toContain("--latest");
  });

  test("accepts an optional [runId] positional argument", () => {
    const reg = new AgentRegistry();
    registerResumeCommand(reg);

    const resume = reg.cli().commands.find((c) => c.name() === "resume");
    // Commander stores positional args under `_args` (private but stable for tests).
    const args = (resume as unknown as { _args: Array<{ _name: string; required: boolean }> })
      ._args;
    expect(args.length).toBe(1);
    expect(args[0]._name).toBe("runId");
    expect(args[0].required).toBe(false);
  });

  test("does not attach agent flags (--dry-run, --thinking, etc.)", () => {
    const reg = new AgentRegistry();
    registerResumeCommand(reg);

    const resume = reg.cli().commands.find((c) => c.name() === "resume");
    const longs = resume?.options.map((o) => o.long) ?? [];
    expect(longs).not.toContain("--dry-run");
    expect(longs).not.toContain("--thinking");
    expect(longs).not.toContain("--verbose");
  });

  test("throws when registered twice", () => {
    const reg = new AgentRegistry();
    registerResumeCommand(reg);
    expect(() => registerResumeCommand(reg)).toThrow(/already registered/);
  });
});
