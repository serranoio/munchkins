import { describe, expect, test } from "bun:test";
import { deriveSlugDeterministic, getSlugWithRetry, SLUG_MAX, sanitize } from "./slug.js";

describe("sanitize", () => {
  test("prefers the first H1 heading over body content", () => {
    const input = "Some preamble.\n\n# Fix login redirect bug\n\nMore details.";
    expect(sanitize(input)).toBe("fix-login-redirect-bug");
  });

  test("falls back to first non-empty trimmed line when no H1 is present", () => {
    const input = "\n\n   Add user export CSV\nbody body body\n";
    expect(sanitize(input)).toBe("add-user-export-csv");
  });

  test("returns empty string for empty input", () => {
    expect(sanitize("")).toBe("");
    expect(sanitize("   \n\n  ")).toBe("");
  });

  test("returns empty string for non-Latin / unsupported character input", () => {
    expect(sanitize("日本語のタスク")).toBe("");
    expect(sanitize("# 日本語")).toBe("");
  });

  test("returns empty string for punctuation-only input", () => {
    expect(sanitize("!!! ??? ...")).toBe("");
    expect(sanitize("# ---")).toBe("");
  });

  test("truncates oversize input at the last hyphen boundary", () => {
    const longSlug = "this-is-a-very-long-task-description-that-keeps-going-and-going-forever";
    const result = sanitize(longSlug);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(result.endsWith("-")).toBe(false);
    expect(longSlug.startsWith(result)).toBe(true);
  });

  test("hard-cuts when no hyphen boundary lies in the safe range", () => {
    // No early hyphen: only one massive word, then later hyphens.
    const input = "abcdefghijklmnopqrstuvwxyz1234567890-tail";
    const result = sanitize(input);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(result.endsWith("-")).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("deriveSlugDeterministic", () => {
  test("matches sanitize() semantics for clean H1 input", () => {
    const input = "# Fix login redirect bug";
    expect(deriveSlugDeterministic(input)).toBe(sanitize(input));
  });

  test("matches sanitize() semantics for first-line input", () => {
    const input = "Refactor billing service\nmore lines";
    expect(deriveSlugDeterministic(input)).toBe(sanitize(input));
  });
});

describe("getSlugWithRetry", () => {
  test("returns slug from spawnClaude on first success", async () => {
    let calls = 0;
    const result = await getSlugWithRetry("anything", {
      cwd: "/tmp",
      sleep: async () => {},
      spawn: async () => {
        calls += 1;
        return { exitCode: 0, output: "fix-the-thing", durationMs: 0 };
      },
    });
    expect(calls).toBe(1);
    expect(result.slug).toBe("fix-the-thing");
    expect(result.fallback).toBeUndefined();
  });

  test("falls back to deterministic slug after 5 rejections", async () => {
    let calls = 0;
    const result = await getSlugWithRetry("# Fallback path here\n\nbody", {
      cwd: "/tmp",
      sleep: async () => {},
      spawn: async () => {
        calls += 1;
        throw new Error("boom");
      },
    });
    expect(calls).toBe(5);
    expect(result.slug).toBe("fallback-path-here");
    expect(result.fallback?.attempts).toBe(5);
    expect(result.fallback?.lastError).toContain("boom");
  });

  test("treats non-zero exit codes as failures and falls back", async () => {
    const result = await getSlugWithRetry("Plain task description", {
      cwd: "/tmp",
      sleep: async () => {},
      spawn: async () => ({ exitCode: 2, output: "ignored", durationMs: 0 }),
    });
    expect(result.slug).toBe("plain-task-description");
    expect(result.fallback?.attempts).toBe(5);
    expect(result.fallback?.lastError).toContain("exit 2");
  });

  test("retries until a non-empty sanitized slug is produced", async () => {
    const outputs = ["", "   ", "# 日本語", "actually-good"];
    let i = 0;
    const result = await getSlugWithRetry("ignored", {
      cwd: "/tmp",
      sleep: async () => {},
      spawn: async () => ({ exitCode: 0, output: outputs[i++] ?? "", durationMs: 0 }),
    });
    expect(result.slug).toBe("actually-good");
    expect(result.fallback).toBeUndefined();
  });
});
