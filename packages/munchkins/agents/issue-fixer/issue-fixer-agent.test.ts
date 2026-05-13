import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registry } from "@serranolabs.io/munchkins-core";
import "./issue-fixer-agent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

describe("issue-fixer registration", () => {
  test("issue-fixer is registered under name 'issue-fixer' after side-effect import", () => {
    expect(registry.get("issue-fixer")).toBeDefined();
    expect(registry.get("issue-fixer")?.name).toBe("issue-fixer");
  });

  test("cron config is every 15 minutes, thinking verbosity, userMessage 'tick'", () => {
    const builder = registry.get("issue-fixer");
    expect(builder?.getCron()).toEqual({
      spec: "*/15 * * * *",
      userMessage: "tick",
      verbosity: "thinking",
    });
  });

  test("step count is 3: survey (deterministic) + triage (agent) + dispatch (deterministic)", () => {
    expect(registry.get("issue-fixer")?.getStepCount()).toBe(3);
  });

  test("issue-fixer opts out of the framework's --dry-run short-circuit", () => {
    expect(registry.get("issue-fixer")?.getHandlesDryRun()).toBe(true);
  });
});

describe("issue-fixer skill availability", () => {
  test(".claude/skills/munchkins-issue-fixer points at packages/munchkins/skills/munchkins-issue-fixer", async () => {
    const skillPath = join(REPO_ROOT, ".claude/skills/munchkins-issue-fixer/SKILL.md");
    const content = await Bun.file(skillPath).text();
    expect(content).toContain("name: munchkins:issue-fixer");
    expect(content).toContain("bot:fix-me");
  });
});
