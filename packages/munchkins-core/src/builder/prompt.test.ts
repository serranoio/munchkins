import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prompt } from "./prompt.js";

let tmpDir: string;

function writeSkill(name: string, body: string): string {
  const dir = join(tmpDir, ".claude", "skills", name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(file, body, "utf-8");
  return file;
}

function writeFile(relPath: string, body: string): string {
  const file = join(tmpDir, relPath);
  writeFileSync(file, body, "utf-8");
  return file;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "prompt-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Prompt.withSkill", () => {
  test("1: strips frontmatter cleanly", () => {
    writeSkill("foo", "---\nname: foo\ndescription: bar\n---\n\n# Body\n\nLine.\n");
    const { systemPrompt } = new Prompt().withSkill("foo").resolve(tmpDir);
    expect(systemPrompt).toBe("# Body\n\nLine.\n");
  });

  test("2: returns this for chaining", () => {
    writeSkill("foo", "---\nname: foo\n---\n\nbody");
    const p = new Prompt();
    const chained = p.withSkill("foo").withUserMessage("x");
    expect(chained).toBe(p);
  });

  test("3: throws clear error when SKILL.md missing", () => {
    expect(() => new Prompt().withSkill("missing").resolve(tmpDir)).toThrow(
      /Skill 'missing' not found.*install-skills/s,
    );
  });

  test("4: strips trailing blank line after closing ---", () => {
    writeSkill("foo", "---\nname: foo\n---\n\nbody");
    const { systemPrompt } = new Prompt().withSkill("foo").resolve(tmpDir);
    expect(systemPrompt).toBe("body");
  });

  test("5: no-strip when no frontmatter", () => {
    const body = "# Just a body\n";
    writeSkill("foo", body);
    const { systemPrompt } = new Prompt().withSkill("foo").resolve(tmpDir);
    expect(systemPrompt).toBe(body);
  });

  test("6: throws on malformed frontmatter", () => {
    writeSkill("foo", "---\nname: foo\nbody without close");
    expect(() => new Prompt().withSkill("foo").resolve(tmpDir)).toThrow(
      /malformed frontmatter.*no closing '---' delimiter/s,
    );
  });

  test("7: composes with withSystem(path) in call order", () => {
    const a = writeFile("a.md", "AAA");
    const b = writeFile("b.md", "BBB");
    writeSkill("s1", "---\nname: s1\n---\n\nS1BODY");
    const { systemPrompt } = new Prompt()
      .withSystem(a)
      .withSkill("s1")
      .withSystem(b)
      .resolve(tmpDir);
    expect(systemPrompt).toBe("AAA\n\nS1BODY\n\nBBB");
  });

  test("8: withSystem(path) semantics unchanged", () => {
    const a = writeFile("a.md", "AAA");
    const b = writeFile("b.md", "BBB");
    const { systemPrompt } = new Prompt(a).withSystem(b).resolve(tmpDir);
    expect(systemPrompt).toBe("AAA\n\nBBB");
  });
});
