import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, readConfig, writeConfig } from "./config.js";

function withTempRepo<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "munchkins-config-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("config read/write", () => {
  test("readConfig returns null when the file does not exist", () => {
    withTempRepo((root) => {
      expect(readConfig(root)).toBeNull();
    });
  });

  test("writeConfig + readConfig round-trips the full shape", () => {
    withTempRepo((root) => {
      writeConfig(
        {
          mode: "consumer-repo",
          agentsDir: "munchkins/agents",
          skillsDir: ".claude/skills",
          bundleEntry: "munchkins/index.ts",
          integrate: "pr",
          agentIndexFile: "AGENTS.md",
        },
        root,
      );
      const got = readConfig(root);
      expect(got).toEqual({
        mode: "consumer-repo",
        agentsDir: "munchkins/agents",
        skillsDir: ".claude/skills",
        bundleEntry: "munchkins/index.ts",
        integrate: "pr",
        agentIndexFile: "AGENTS.md",
      });
    });
  });

  test("readConfig throws on invalid mode", () => {
    withTempRepo((root) => {
      writeConfig(
        {
          mode: "consumer-repo",
          agentsDir: "x",
          skillsDir: "y",
          bundleEntry: "z",
          integrate: "merge",
        },
        root,
      );
      writeFileSync(
        configPath(root),
        JSON.stringify({
          mode: "weird",
          agentsDir: "x",
          skillsDir: "y",
          bundleEntry: "z",
          integrate: "merge",
        }),
      );
      expect(() => readConfig(root)).toThrow(/mode.*source-repo.*consumer-repo/);
    });
  });

  test("readConfig throws on invalid integrate", () => {
    withTempRepo((root) => {
      writeConfig(
        {
          mode: "consumer-repo",
          agentsDir: "x",
          skillsDir: "y",
          bundleEntry: "z",
          integrate: "merge",
        },
        root,
      );
      writeFileSync(
        configPath(root),
        JSON.stringify({
          mode: "consumer-repo",
          agentsDir: "x",
          skillsDir: "y",
          bundleEntry: "z",
          integrate: "rebase",
        }),
      );
      expect(() => readConfig(root)).toThrow(/integrate.*merge.*pr/);
    });
  });

  test("readConfig throws on missing required string field", () => {
    withTempRepo((root) => {
      writeConfig(
        {
          mode: "consumer-repo",
          agentsDir: "x",
          skillsDir: "y",
          bundleEntry: "z",
          integrate: "merge",
        },
        root,
      );
      writeFileSync(
        configPath(root),
        JSON.stringify({
          mode: "consumer-repo",
          agentsDir: "",
          skillsDir: "y",
          bundleEntry: "z",
          integrate: "merge",
        }),
      );
      expect(() => readConfig(root)).toThrow(/agentsDir/);
    });
  });
});
