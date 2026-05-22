import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  agentTemplatePath,
  cronOverlayPath,
  fillTemplate,
  skillBodyTemplatePath,
  specKindForArchetype,
  specTemplatePath,
  templatesDir,
} from "./templates.js";

describe("template path resolution", () => {
  test("templatesDir() points at an existing directory", () => {
    expect(existsSync(templatesDir())).toBe(true);
  });

  test.each([
    "single-step",
    "main-refactor",
    "main-refactor-tests",
  ] as const)("agentTemplatePath(%s) resolves to an existing file", (archetype) => {
    expect(existsSync(agentTemplatePath(archetype))).toBe(true);
  });

  test.each([
    "single-step",
    "main-refactor",
    "main-refactor-tests",
  ] as const)("skillBodyTemplatePath(%s) resolves to an existing file", (archetype) => {
    expect(existsSync(skillBodyTemplatePath(archetype))).toBe(true);
  });

  test.each([
    "refactor",
    "bug",
    "feature",
  ] as const)("specTemplatePath(%s) resolves to an existing file", (kind) => {
    expect(existsSync(specTemplatePath(kind))).toBe(true);
  });

  test("cronOverlayPath() resolves to an existing file", () => {
    expect(existsSync(cronOverlayPath())).toBe(true);
  });
});

describe("archetype → spec kind mapping", () => {
  test("single-step → refactor", () => {
    expect(specKindForArchetype("single-step")).toBe("refactor");
  });
  test("main-refactor → bug", () => {
    expect(specKindForArchetype("main-refactor")).toBe("bug");
  });
  test("main-refactor-tests → feature", () => {
    expect(specKindForArchetype("main-refactor-tests")).toBe("feature");
  });
});

describe("fillTemplate", () => {
  test("replaces {{slot}} placeholders with provided values", () => {
    const out = fillTemplate(specTemplatePath("refactor"), {
      oneLineGoal: "extract duplicated config",
      problemStatement: "Three callers build the same config object.",
      targetPath: "src/foo.ts",
      scope: "src/foo.ts",
      instruction1: "extract _buildConfig helper",
      constraint1: "no public API change",
      acceptance1: "all three sites call the helper",
      outOfScope1: "renaming the function",
    });
    expect(out).toContain("Refactor: extract duplicated config");
    expect(out).toContain("`src/foo.ts`");
    expect(out).not.toContain("{{oneLineGoal}}");
  });

  test("leaves unmatched slots intact so missing substitutions are visible", () => {
    const out = fillTemplate(specTemplatePath("refactor"), {
      oneLineGoal: "only fill the title",
    });
    expect(out).toContain("Refactor: only fill the title");
    // Other slots remain.
    expect(out).toContain("{{problemStatement}}");
  });
});
