import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../registry/registry.js";
import { registerStatusCommand } from "./command.js";

describe("registerStatusCommand", () => {
  test("registers a 'status' subcommand with the right description", () => {
    const reg = new AgentRegistry();
    registerStatusCommand(reg);

    const status = reg.cli().commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
    expect(status?.description()).toBe("Show running munchkins.");
  });

  test("declares --json as the only option", () => {
    const reg = new AgentRegistry();
    registerStatusCommand(reg);

    const status = reg.cli().commands.find((c) => c.name() === "status");
    expect(status?.options.map((o) => o.long)).toEqual(["--json"]);
  });

  test("does not attach agent flags (--dry-run, --thinking, etc.)", () => {
    const reg = new AgentRegistry();
    registerStatusCommand(reg);

    const status = reg.cli().commands.find((c) => c.name() === "status");
    const longs = status?.options.map((o) => o.long) ?? [];
    expect(longs).not.toContain("--dry-run");
    expect(longs).not.toContain("--thinking");
    expect(longs).not.toContain("--verbose");
  });

  test("throws when registered twice", () => {
    const reg = new AgentRegistry();
    registerStatusCommand(reg);
    expect(() => registerStatusCommand(reg)).toThrow(/already registered/);
  });
});
