import { describe, expect, test } from "bun:test";
import { buildCmuxCommand, shouldDelegateToCmux } from "./cmux-launcher.js";

const NORMAL_ARGV = ["bun", "/abs/index.ts", "bug-fix", "--user-message=./bug.md"];

describe("shouldDelegateToCmux", () => {
  test("returns false when hasCmux is false even with otherwise valid inputs", () => {
    expect(
      shouldDelegateToCmux({
        argv: NORMAL_ARGV,
        env: {},
        hasCmux: false,
      }),
    ).toBe(false);
  });

  test("returns false when MUNCHKINS_NO_CMUX=1", () => {
    expect(
      shouldDelegateToCmux({
        argv: NORMAL_ARGV,
        env: { MUNCHKINS_NO_CMUX: "1" },
        hasCmux: true,
      }),
    ).toBe(false);
  });

  test("returns false when --no-cmux is in argv", () => {
    expect(
      shouldDelegateToCmux({
        argv: [...NORMAL_ARGV, "--no-cmux"],
        env: {},
        hasCmux: true,
      }),
    ).toBe(false);
  });

  test.each([
    ["--help"],
    ["-h"],
    ["--version"],
    ["-v"],
    ["--dry-run"],
  ])("returns false when %s is in argv", (flag) => {
    expect(
      shouldDelegateToCmux({
        argv: ["bun", "/abs/index.ts", "bug-fix", flag],
        env: {},
        hasCmux: true,
      }),
    ).toBe(false);
  });

  test("returns false when argv[2] is missing", () => {
    expect(
      shouldDelegateToCmux({
        argv: ["bun", "/abs/index.ts"],
        env: {},
        hasCmux: true,
      }),
    ).toBe(false);
  });

  test("returns false when argv[2] starts with '-'", () => {
    expect(
      shouldDelegateToCmux({
        argv: ["bun", "/abs/index.ts", "--something"],
        env: {},
        hasCmux: true,
      }),
    ).toBe(false);
  });

  test.each([
    ["daemon"],
    ["resume"],
    ["status"],
    ["skills"],
    ["list-launchable"],
  ])("returns false when argv[2] is meta-subcommand %s", (sub) => {
    expect(
      shouldDelegateToCmux({
        argv: ["bun", "/abs/index.ts", sub],
        env: {},
        hasCmux: true,
      }),
    ).toBe(false);
  });

  test("returns true for normal agent invocation with cmux installed and clean env", () => {
    expect(
      shouldDelegateToCmux({
        argv: NORMAL_ARGV,
        env: {},
        hasCmux: true,
      }),
    ).toBe(true);
  });
});

function getInnerCommand(command: string[]): string {
  return command[command.indexOf("--command") + 1];
}

describe("buildCmuxCommand", () => {
  test("formats workspace name as <agent>-<now>", () => {
    const { workspaceName } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/repo",
      now: 1700000000000,
      env: {},
    });
    expect(workspaceName).toBe("bug-fix-1700000000000");
  });

  test("includes --cwd from input", () => {
    const { command } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/some/where",
      now: 1,
      env: {},
    });
    const cwdIdx = command.indexOf("--cwd");
    expect(cwdIdx).toBeGreaterThan(-1);
    expect(command[cwdIdx + 1]).toBe("/some/where");
  });

  test("--command starts with MUNCHKINS_NO_CMUX=1, single-quotes every argv element, uses argv[1] absolute script path, and auto-injects --verbose", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "bug-fix", "--user-message=./bug.md"],
      cwd: "/repo",
      now: 42,
      env: {},
    });
    const inner = getInnerCommand(command);
    expect(inner.startsWith("MUNCHKINS_NO_CMUX=1 ")).toBe(true);
    expect(inner).toBe(
      "MUNCHKINS_NO_CMUX=1 'bun' 'run' '/abs/index.ts' 'bug-fix' '--user-message=./bug.md' '--verbose'",
    );
  });

  test("auto-injects --verbose when no verbosity flag is present", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "feat-small", "--user-message=./brief.md"],
      cwd: "/repo",
      now: 1,
      env: {},
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("'--verbose'");
  });

  test("does NOT auto-inject --verbose when --verbose is already present", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "feat-small", "--verbose", "--user-message=./brief.md"],
      cwd: "/repo",
      now: 1,
      env: {},
    });
    const inner = getInnerCommand(command);
    // Single occurrence — no duplicate appended.
    expect(inner.match(/'--verbose'/g)?.length).toBe(1);
  });

  test("does NOT auto-inject --verbose when --thinking is already present", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "feat-small", "--thinking", "--user-message=./brief.md"],
      cwd: "/repo",
      now: 1,
      env: {},
    });
    const inner = getInnerCommand(command);
    expect(inner).not.toContain("'--verbose'");
    expect(inner).toContain("'--thinking'");
  });

  test("does NOT auto-inject --verbose when --dry-run is already present", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "feat-small", "--dry-run"],
      cwd: "/repo",
      now: 1,
      env: {},
    });
    const inner = getInnerCommand(command);
    expect(inner).not.toContain("'--verbose'");
    expect(inner).toContain("'--dry-run'");
  });

  test("strips --no-cmux from inner command", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "bug-fix", "--no-cmux", "--user-message=./bug.md"],
      cwd: "/repo",
      now: 1,
      env: {},
    });
    const inner = getInnerCommand(command);
    expect(inner).not.toContain("--no-cmux");
    expect(inner).toContain("'bug-fix'");
    expect(inner).toContain("'--user-message=./bug.md'");
  });

  test("escapes literal single quotes using POSIX '\\'' wrap", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "bug-fix", "--user-message=can't stop"],
      cwd: "/repo",
      now: 1,
      env: {},
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("'--user-message=can'\\''t stop'");
  });

  test("propagates MUNCHKINS_CHANGELOG_PATH so the agent's changelog lands in the canonical location", () => {
    const { command } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/repo",
      now: 1,
      env: { MUNCHKINS_CHANGELOG_PATH: "docs/pages/changelog.md" },
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("MUNCHKINS_CHANGELOG_PATH='docs/pages/changelog.md'");
    // The munchkins-loop-break flag must still be set unconditionally.
    expect(inner).toContain("MUNCHKINS_NO_CMUX=1");
  });

  test("propagates any MUNCHKINS_* env var, sorted for deterministic output", () => {
    const { command } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/repo",
      now: 1,
      env: {
        MUNCHKINS_RUN_LOG_DIR: "/tmp/run-log",
        MUNCHKINS_CHANGELOG_PATH: "docs/pages/changelog.md",
        __MUNCHKINS_OPT_userMessage: "/abs/bug.md",
        UNRELATED: "nope",
      },
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("MUNCHKINS_CHANGELOG_PATH='docs/pages/changelog.md'");
    expect(inner).toContain("MUNCHKINS_RUN_LOG_DIR='/tmp/run-log'");
    expect(inner).toContain("__MUNCHKINS_OPT_userMessage='/abs/bug.md'");
    expect(inner).not.toContain("UNRELATED");
    // Sorted assignments: CHANGELOG comes before RUN_LOG_DIR comes before __MUNCHKINS.
    const changelogPos = inner.indexOf("MUNCHKINS_CHANGELOG_PATH");
    const runLogPos = inner.indexOf("MUNCHKINS_RUN_LOG_DIR");
    expect(changelogPos).toBeLessThan(runLogPos);
  });

  test("does NOT propagate MUNCHKINS_NO_CMUX from the parent env (set explicitly)", () => {
    const { command } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/repo",
      now: 1,
      env: { MUNCHKINS_NO_CMUX: "0" },
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("MUNCHKINS_NO_CMUX=1");
    expect(inner).not.toContain("MUNCHKINS_NO_CMUX=0");
  });

  test("shell-escapes propagated env var values containing single quotes", () => {
    const { command } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/repo",
      now: 1,
      env: { MUNCHKINS_CHANGELOG_PATH: "path with 'quote'.md" },
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("MUNCHKINS_CHANGELOG_PATH='path with '\\''quote'\\''.md'");
  });
});
