import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../registry/registry.js";
import { registerDaemonCommand } from "./command.js";

describe("registerDaemonCommand", () => {
  test("registers a 'daemon' subcommand with the right description", () => {
    const reg = new AgentRegistry();
    registerDaemonCommand(reg);

    const program = reg.cli();
    const daemon = program.commands.find((c) => c.name() === "daemon");
    expect(daemon).toBeDefined();
    expect(daemon?.description()).toBe("Run cron-armed builders on their schedules.");
  });

  test("declares no options or arguments (daemon takes no flags)", () => {
    const reg = new AgentRegistry();
    registerDaemonCommand(reg);

    const daemon = reg.cli().commands.find((c) => c.name() === "daemon");
    expect(daemon?.options.map((o) => o.long)).toEqual([]);
  });

  test("does not attach agent flags (--dry-run, --thinking, etc.)", () => {
    const reg = new AgentRegistry();
    registerDaemonCommand(reg);

    const daemon = reg.cli().commands.find((c) => c.name() === "daemon");
    const longs = daemon?.options.map((o) => o.long) ?? [];
    expect(longs).not.toContain("--dry-run");
    expect(longs).not.toContain("--thinking");
    expect(longs).not.toContain("--verbose");
  });

  test("throws when registered twice (delegates to registry's duplicate-name guard)", () => {
    const reg = new AgentRegistry();
    registerDaemonCommand(reg);
    expect(() => registerDaemonCommand(reg)).toThrow(/already registered/);
  });
});
