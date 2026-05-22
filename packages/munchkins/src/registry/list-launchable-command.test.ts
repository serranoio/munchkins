import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentBuilder } from "../builder/agent-builder.js";
import { registerListLaunchableCommand } from "./list-launchable-command.js";
import { AgentRegistry } from "./registry.js";

describe("list-launchable command", () => {
  let stdoutChunks: string[];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalExit = process.exit;

  beforeEach(() => {
    stdoutChunks = [];
    (process.stdout as { write: (s: string) => boolean }).write = ((s: string | Uint8Array) => {
      stdoutChunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as never;
    (process as { exit: (code?: number) => never }).exit = ((_code?: number) => {
      throw new Error("__exit__");
    }) as never;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  });

  function makeRegistry(): AgentRegistry {
    const reg = new AgentRegistry();
    reg.register(new AgentBuilder("alpha"));
    reg.register(new AgentBuilder("beta").kind("cron-only"));
    reg.register(new AgentBuilder("gamma"));
    registerListLaunchableCommand(reg);
    return reg;
  }

  test("prints launchable agents one per line by default", async () => {
    const reg = makeRegistry();
    try {
      await reg.cli().parseAsync(["node", "munchkins", "list-launchable"]);
    } catch (err) {
      if ((err as Error).message !== "__exit__") throw err;
    }
    expect(stdoutChunks.join("")).toBe("alpha\ngamma\n");
  });

  test("emits JSON when --json is passed", async () => {
    const reg = makeRegistry();
    try {
      await reg.cli().parseAsync(["node", "munchkins", "list-launchable", "--json"]);
    } catch (err) {
      if ((err as Error).message !== "__exit__") throw err;
    }
    expect(stdoutChunks.join("").trim()).toBe('["alpha","gamma"]');
  });
});
