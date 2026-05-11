import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resolveTarget, _runSkillsInstall } from "./skills-install.js";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

let tmp: string;
const stdout: string[] = [];
const stderr: string[] = [];
const originalLog = console.log;
const originalError = console.error;
const originalExit = process.exit;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skills-install-test-"));
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

function writeSkill(root: string, pkg: string, slug: string, body = `# ${slug}`): string {
  const skillDir = join(root, "node_modules", ...pkg.split("/"), "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  const file = join(skillDir, "SKILL.md");
  writeFileSync(file, body);
  return file;
}

function targetDir(): string {
  return join(tmp, ".claude", "skills");
}

function findLine(prefix: string): string {
  return stdout.find((l) => l.startsWith(prefix)) ?? "";
}

describe("_runSkillsInstall — multi-package discovery", () => {
  test("walks every node_modules package that ships a skills/ dir", () => {
    writeSkill(tmp, "@scope/a", "foo");
    writeSkill(tmp, "pkg-b", "bar");

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });

    expect(existsSync(join(targetDir(), "foo", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir(), "bar", "SKILL.md"))).toBe(true);

    const installedLine = findLine("installed:");
    expect(installedLine).toContain("foo");
    expect(installedLine).toContain("bar");
  });

  test("skips existing target files (records as kept, not installed)", () => {
    writeSkill(tmp, "@scope/a", "foo", "from-package");
    mkdirSync(join(targetDir(), "foo"), { recursive: true });
    writeFileSync(join(targetDir(), "foo", "SKILL.md"), "existing");

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });

    expect(readFileSync(join(targetDir(), "foo", "SKILL.md"), "utf8")).toBe("existing");
    expect(findLine("installed:")).not.toContain("foo");
    expect(findLine("kept")).toContain("foo");
  });

  test("never silently overwrites a consumer-edited file", () => {
    writeSkill(tmp, "@scope/a", "foo", "shipped-version");
    mkdirSync(join(targetDir(), "foo"), { recursive: true });
    const userFile = join(targetDir(), "foo", "SKILL.md");
    writeFileSync(userFile, "user-edit");
    const before = readFileSync(userFile, "utf8");

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });

    expect(readFileSync(userFile, "utf8")).toBe(before);
  });

  test("warns about slug collisions before the copy phase, first wins", () => {
    writeSkill(tmp, "@scope/a", "bar", "from-a");
    writeSkill(tmp, "pkg-b", "bar", "from-b");

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });

    const warning = findLine("⚠ slug collision");
    expect(warning).toContain("bar");
    expect(warning).toContain("@scope/a");
    expect(warning).toContain("pkg-b");
    expect(warning).toContain("first wins");

    const warningIdx = stdout.indexOf(warning);
    const installedIdx = stdout.indexOf(findLine("installed:"));
    expect(warningIdx).toBeLessThan(installedIdx);

    expect(readFileSync(join(targetDir(), "bar", "SKILL.md"), "utf8")).toBe("from-a");
  });

  test("ignores a skills/ directory that contains no SKILL.md subdirs", () => {
    mkdirSync(join(tmp, "node_modules", "noisy-pkg", "skills"), { recursive: true });
    writeSkill(tmp, "@scope/a", "foo");

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });

    expect(existsSync(join(targetDir(), "foo", "SKILL.md"))).toBe(true);
    expect(findLine("installed:")).toContain("foo");
  });

  test("exits 1 with a clear error when no skills exist anywhere", () => {
    mkdirSync(join(tmp, "node_modules"), { recursive: true });

    let caught: ProcessExitError | null = null;
    try {
      _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });
    } catch (err) {
      if (err instanceof ProcessExitError) caught = err;
      else throw err;
    }

    expect(caught).not.toBeNull();
    expect(caught?.code).toBe(1);
    expect(stderr.join("\n")).toContain("no skills found in any installed package");
  });

  test("respects a custom target dir (--dest)", () => {
    writeSkill(tmp, "@scope/a", "foo");
    const customTarget = join(tmp, "custom-dest");

    _runSkillsInstall({ cwd: tmp, target: customTarget, packageRoot: null });

    expect(existsSync(join(customTarget, "foo", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir(), "foo", "SKILL.md"))).toBe(false);
  });

  test("source-repo mode discovers <packageRoot>/skills/", () => {
    const fakePackageRoot = join(tmp, "fake-package");
    mkdirSync(join(fakePackageRoot, "skills", "src-only"), { recursive: true });
    writeFileSync(join(fakePackageRoot, "skills", "src-only", "SKILL.md"), "src-bundled");
    mkdirSync(join(tmp, "node_modules"), { recursive: true });

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: fakePackageRoot });

    expect(existsSync(join(targetDir(), "src-only", "SKILL.md"))).toBe(true);
    expect(findLine("installed:")).toContain("src-only");
  });

  test("summary always emits 'installed:' and omits 'kept' when zero kept", () => {
    writeSkill(tmp, "@scope/a", "foo");

    _runSkillsInstall({ cwd: tmp, target: targetDir(), packageRoot: null });

    expect(stdout.some((l) => l.startsWith("installed:"))).toBe(true);
    expect(stdout.some((l) => l.startsWith("kept"))).toBe(false);
  });
});

describe("_resolveTarget", () => {
  test("returns <cwd>/.claude/skills by default", () => {
    expect(_resolveTarget([], "/repo")).toBe("/repo/.claude/skills");
  });

  test("honors --dest <dir>", () => {
    expect(_resolveTarget(["--dest", "/elsewhere"], "/repo")).toBe("/elsewhere");
  });

  test("honors -d <dir>", () => {
    expect(_resolveTarget(["-d", "/elsewhere"], "/repo")).toBe("/elsewhere");
  });
});
