import { describe, expect, test } from "bun:test";
import { AgentBuilder } from "../builder/agent-builder.js";
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

  test("nests a 'list' subcommand under daemon", () => {
    const reg = new AgentRegistry();
    registerDaemonCommand(reg);

    const daemon = reg.cli().commands.find((c) => c.name() === "daemon");
    const list = daemon?.commands.find((c) => c.name() === "list");
    expect(list).toBeDefined();
    expect(list?.description()).toBe("List cron-armed builders without arming the daemon.");
  });

  test("'daemon list' prints '<name>\\t<spec>' for each cron-armed builder", async () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("scheduled-alpha").cron("*/5 * * * *", { userMessage: "tick" }));
    reg.register(new AgentBuilder("not-scheduled"));
    reg.register(new AgentBuilder("scheduled-beta").cron("0 0 * * *", { userMessage: "daily" }));
    registerDaemonCommand(reg);

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await reg.cli().parseAsync(["node", "munchkins", "daemon", "list"]);
    } finally {
      process.stdout.write = origWrite;
    }

    const output = writes.join("");
    expect(output).toContain("scheduled-alpha\t*/5 * * * *");
    expect(output).toContain("scheduled-beta\t0 0 * * *");
    expect(output).not.toContain("not-scheduled");
  });

  test("'daemon list' prints idle hint when no builders are cron-armed", async () => {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("plain"));
    registerDaemonCommand(reg);

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await reg.cli().parseAsync(["node", "munchkins", "daemon", "list"]);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(writes.join("")).toContain("(no cron-armed builders registered)");
  });
});
