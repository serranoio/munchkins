import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInit } from "./bin.js";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

let tmp: string;
let templatePath: string;
let packageRoot: string;
const stdout: string[] = [];
const stderr: string[] = [];
const originalLog = console.log;
const originalError = console.error;
const originalExit = process.exit;

const TEMPLATE_BODY =
  '#!/usr/bin/env bun\nimport { runCli } from "@serranolabs.io/munchkins";\nif (import.meta.main) await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });\n';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "munchkins-init-test-"));

  // Synthesize a packageRoot that ships at least one skill so _runSkillsInstall
  // doesn't exit(1) during the test.
  packageRoot = join(tmp, "fake-package-root");
  mkdirSync(join(packageRoot, "skills", "munchkins-test-skill"), { recursive: true });
  writeFileSync(join(packageRoot, "skills", "munchkins-test-skill", "SKILL.md"), "# test skill");

  templatePath = join(tmp, "agentRegistry.template.ts");
  writeFileSync(templatePath, TEMPLATE_BODY);

  stdout.length = 0;
  stderr.length = 0;
  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  process.exit = ((code?: number): never => {
    throw new ProcessExitError(code ?? 0);
  }) as typeof process.exit;
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exit = originalExit;
  rmSync(tmp, { recursive: true, force: true });
});

function repoDir(): string {
  const dir = join(tmp, "repo");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir: string, body: Record<string, unknown>): string {
  const path = join(dir, "package.json");
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  return path;
}

function findLine(needle: string): string {
  return stdout.find((l) => l.includes(needle)) ?? "";
}

describe("runInit", () => {
  test("exits 1 with a clear error when cwd has no package.json", async () => {
    const cwd = repoDir();

    let caught: ProcessExitError | null = null;
    try {
      await runInit({ cwd, packageRoot, templatePath });
    } catch (err) {
      if (err instanceof ProcessExitError) caught = err;
      else throw err;
    }

    expect(caught).not.toBeNull();
    expect(caught?.code).toBe(1);
    expect(stderr.join("\n")).toContain("no package.json");
  });

  test("writes agentRegistry.ts from the template when missing", async () => {
    const cwd = repoDir();
    writePackageJson(cwd, { name: "consumer-repo" });

    await runInit({ cwd, packageRoot, templatePath });

    const written = readFileSync(join(cwd, "agentRegistry.ts"), "utf8");
    expect(written).toBe(TEMPLATE_BODY);
    expect(findLine("agentRegistry.ts: wrote")).toContain(resolve(cwd, "agentRegistry.ts"));
  });

  test("keeps a pre-existing agentRegistry.ts without overwriting it", async () => {
    const cwd = repoDir();
    writePackageJson(cwd, { name: "consumer-repo" });
    const userRegistry = join(cwd, "agentRegistry.ts");
    writeFileSync(userRegistry, "// user-authored content");

    await runInit({ cwd, packageRoot, templatePath });

    expect(readFileSync(userRegistry, "utf8")).toBe("// user-authored content");
    expect(findLine("agentRegistry.ts: kept")).toContain("already present");
  });

  test("adds scripts.munchkins when missing and preserves other scripts", async () => {
    const cwd = repoDir();
    const pkgPath = writePackageJson(cwd, {
      name: "consumer-repo",
      scripts: { test: "bun test" },
    });

    await runInit({ cwd, packageRoot, templatePath });

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.munchkins).toBe("bun run ./agentRegistry.ts");
    expect(pkg.scripts.test).toBe("bun test");
    expect(findLine("scripts.munchkins: added")).toContain("bun run ./agentRegistry.ts");
  });

  test("adds a scripts section when package.json has none at all", async () => {
    const cwd = repoDir();
    const pkgPath = writePackageJson(cwd, { name: "no-scripts" });

    await runInit({ cwd, packageRoot, templatePath });

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.munchkins).toBe("bun run ./agentRegistry.ts");
  });

  test("does not clobber a user-set scripts.munchkins value", async () => {
    const cwd = repoDir();
    const pkgPath = writePackageJson(cwd, {
      name: "consumer-repo",
      scripts: { munchkins: "custom-runner" },
    });

    await runInit({ cwd, packageRoot, templatePath });

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.munchkins).toBe("custom-runner");
    expect(findLine("scripts.munchkins: kept")).toContain("user-set value");
  });

  test("logs an 'already set' note when scripts.munchkins already matches the desired value", async () => {
    const cwd = repoDir();
    writePackageJson(cwd, {
      name: "consumer-repo",
      scripts: { munchkins: "bun run ./agentRegistry.ts" },
    });

    await runInit({ cwd, packageRoot, templatePath });

    expect(findLine("scripts.munchkins: kept")).toContain("already set");
  });

  test("delegates to the skills installer (installs bundled skills under .claude/skills)", async () => {
    const cwd = repoDir();
    writePackageJson(cwd, { name: "consumer-repo" });

    await runInit({ cwd, packageRoot, templatePath });

    expect(existsSync(join(cwd, ".claude", "skills", "munchkins-test-skill", "SKILL.md"))).toBe(
      true,
    );
  });

  test("prints the post-init next-step hint pointing at /munchkins:new-munchkin", async () => {
    const cwd = repoDir();
    writePackageJson(cwd, { name: "consumer-repo" });

    await runInit({ cwd, packageRoot, templatePath });

    expect(stdout.some((l) => l.includes("munchkins ready"))).toBe(true);
    expect(stdout.some((l) => l.includes("/munchkins:new-munchkin"))).toBe(true);
  });
});
