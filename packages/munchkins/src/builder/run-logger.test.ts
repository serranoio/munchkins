import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RunLogger } from "./run-logger.js";

/**
 * Capture stdout writes for the duration of a test. Bun's `console.log` and
 * `process.stdout.write` both go through the same stream, so wrapping `.write`
 * is sufficient to assert on PASS-line output.
 */
function captureStdout(): { output: () => string; restore: () => void } {
  const original = process.stdout.write.bind(process.stdout);
  let buf = "";
  // biome-ignore lint/suspicious/noExplicitAny: stdout.write has many overloads
  process.stdout.write = ((chunk: any) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return {
    output: () => buf,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

describe("RunLogger.pass", () => {
  let cap: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    cap = captureStdout();
  });

  afterEach(() => {
    cap.restore();
  });

  test("quiet mode appends prUrl after the duration/cost suffix", () => {
    const logger = new RunLogger("test-agent", false);
    logger.pass({
      totalDurationS: "1.2",
      cost: 0.01,
      tokensIn: 10,
      tokensOut: 20,
      commitMessage: "feat: thing",
      prUrl: "https://github.com/foo/bar/pull/1",
    });
    const out = cap.output();
    expect(out).toContain("PASS — feat: thing");
    expect(out).toContain("(1.2s, $0.0100)");
    expect(out).toContain("https://github.com/foo/bar/pull/1");
  });

  test("quiet mode omits prUrl when not provided", () => {
    const logger = new RunLogger("test-agent", false);
    logger.pass({
      totalDurationS: "1.2",
      cost: 0.01,
      tokensIn: 10,
      tokensOut: 20,
      commitMessage: "feat: thing",
    });
    const out = cap.output();
    expect(out).toContain("PASS — feat: thing (1.2s, $0.0100)");
    expect(out).not.toContain("http");
  });

  test("quiet mode without commitMessage still appends prUrl", () => {
    const logger = new RunLogger("test-agent", false);
    logger.pass({
      totalDurationS: "0.3",
      tokensIn: 5,
      tokensOut: 7,
      prUrl: "https://gitlab.com/foo/bar/-/merge_requests/2",
    });
    const out = cap.output();
    expect(out).toContain("PASS — (0.3s, —, 5→7)");
    expect(out).toContain("https://gitlab.com/foo/bar/-/merge_requests/2");
  });
});
