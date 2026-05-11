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
    });
    expect(workspaceName).toBe("bug-fix-1700000000000");
  });

  test("includes --cwd from input", () => {
    const { command } = buildCmuxCommand({
      argv: NORMAL_ARGV,
      cwd: "/some/where",
      now: 1,
    });
    const cwdIdx = command.indexOf("--cwd");
    expect(cwdIdx).toBeGreaterThan(-1);
    expect(command[cwdIdx + 1]).toBe("/some/where");
  });

  test("--command starts with MUNCHKINS_NO_CMUX=1, single-quotes every argv element, uses argv[1] absolute script path", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "bug-fix", "--user-message=./bug.md"],
      cwd: "/repo",
      now: 42,
    });
    const inner = getInnerCommand(command);
    expect(inner.startsWith("MUNCHKINS_NO_CMUX=1 ")).toBe(true);
    expect(inner).toBe(
      "MUNCHKINS_NO_CMUX=1 'bun' 'run' '/abs/index.ts' 'bug-fix' '--user-message=./bug.md'",
    );
  });

  test("strips --no-cmux from inner command", () => {
    const { command } = buildCmuxCommand({
      argv: ["bun", "/abs/index.ts", "bug-fix", "--no-cmux", "--user-message=./bug.md"],
      cwd: "/repo",
      now: 1,
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
    });
    const inner = getInnerCommand(command);
    expect(inner).toContain("'--user-message=can'\\''t stop'");
  });
});
