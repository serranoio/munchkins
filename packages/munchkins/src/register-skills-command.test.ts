import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "@serranolabs.io/munchkins-core";
import { registerSkillsCommand } from "./register-skills-command.js";

describe("registerSkillsCommand", () => {
  test("registers a 'skills' subcommand with the right description", () => {
    const reg = new AgentRegistry();
    registerSkillsCommand(reg);

    const skills = reg.cli().commands.find((c) => c.name() === "skills");
    expect(skills).toBeDefined();
    expect(skills?.description()).toBe("Manage munchkin skills.");
  });

  test("exposes a nested 'install' subcommand with an optional [target] arg", () => {
    const reg = new AgentRegistry();
    registerSkillsCommand(reg);

    const skills = reg.cli().commands.find((c) => c.name() === "skills");
    const install = skills?.commands.find((c) => c.name() === "install");
    expect(install).toBeDefined();
    expect(install?.description()).toBe(
      "Install bundled skills into the target directory (defaults to .claude/skills).",
    );

    const args = (install as unknown as { _args: Array<{ _name: string; required: boolean }> })
      ._args;
    expect(args.length).toBe(1);
    expect(args[0]._name).toBe("target");
    expect(args[0].required).toBe(false);
  });

  test("does not attach agent flags to 'skills' (--dry-run, --thinking, etc.)", () => {
    const reg = new AgentRegistry();
    registerSkillsCommand(reg);

    const skills = reg.cli().commands.find((c) => c.name() === "skills");
    const longs = skills?.options.map((o) => o.long) ?? [];
    expect(longs).not.toContain("--dry-run");
    expect(longs).not.toContain("--thinking");
    expect(longs).not.toContain("--verbose");
  });

  test("throws when registered twice", () => {
    const reg = new AgentRegistry();
    registerSkillsCommand(reg);
    expect(() => registerSkillsCommand(reg)).toThrow(/already registered/);
  });
});
