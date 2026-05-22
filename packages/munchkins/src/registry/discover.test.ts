import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents } from "./discover.js";

describe("discoverAgents", () => {
  test("globs *-agent.ts under the given dir and dynamic-imports each in sorted order", async () => {
    const root = mkdtempSync(join(tmpdir(), "discover-test-"));
    try {
      mkdirSync(join(root, "alpha"), { recursive: true });
      mkdirSync(join(root, "beta"), { recursive: true });
      // Capture import order via a side-effect file the test can read after.
      const log = join(root, "log.json");
      writeFileSync(log, "[]");
      const writeAgent = (path: string, label: string) => {
        writeFileSync(
          path,
          [
            "import { readFileSync, writeFileSync } from 'node:fs';",
            `const log = JSON.parse(readFileSync(${JSON.stringify(log)}, 'utf-8'));`,
            `log.push(${JSON.stringify(label)});`,
            `writeFileSync(${JSON.stringify(log)}, JSON.stringify(log));`,
            "",
          ].join("\n"),
        );
      };
      writeAgent(join(root, "alpha", "alpha-agent.ts"), "alpha");
      writeAgent(join(root, "beta", "beta-agent.ts"), "beta");
      // Distractor — should not be picked up.
      writeFileSync(join(root, "beta", "helper.ts"), "export const x = 1;\n");

      const loaded = await discoverAgents(root);
      expect(loaded.length).toBe(2);
      expect(loaded[0].endsWith("alpha-agent.ts")).toBe(true);
      expect(loaded[1].endsWith("beta-agent.ts")).toBe(true);

      const observed = JSON.parse((await Bun.file(log).text()) || "[]") as string[];
      expect(observed).toEqual(["alpha", "beta"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("relative dir resolves against fromImportUrl when provided", async () => {
    const root = mkdtempSync(join(tmpdir(), "discover-rel-"));
    try {
      mkdirSync(join(root, "agents", "foo"), { recursive: true });
      writeFileSync(join(root, "agents", "foo", "foo-agent.ts"), "export const x = 1;\n");
      const callerUrl = `file://${join(root, "bundle.ts")}`;
      const loaded = await discoverAgents("./agents", callerUrl);
      expect(loaded.length).toBe(1);
      expect(loaded[0].endsWith("foo-agent.ts")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns an empty list when no matches", async () => {
    const root = mkdtempSync(join(tmpdir(), "discover-empty-"));
    try {
      const loaded = await discoverAgents(root);
      expect(loaded).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
