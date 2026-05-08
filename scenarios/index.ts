#!/usr/bin/env bun
import { mock } from "bun:test";
import { join } from "node:path";
import {
  configureMock,
  getClaudeAttempts,
  getExpectedMockCallCount,
  getMockCallLog,
  setupAuditGuard,
  spawnClaudeMock,
} from "./lib/mock-spawn-claude.js";
import { printResult, type ScenarioResult } from "./lib/result.js";
import { createSandbox } from "./lib/sandbox.js";

const HARNESS_VERSION = "0.1.0";
const SCENARIO_ID = "bugfix-agent-e2e";

const harnessDir = new URL(".", import.meta.url).pathname;
const fixtureDir = join(harnessDir, "fixtures", "bugfix-agent-e2e");
const seedRepoDir = join(fixtureDir, "seed-repo");
const responsesDir = join(fixtureDir, "mock-claude-responses");
const spawnClaudeAbsPath = join(
  harnessDir,
  "..",
  "packages",
  "munchkins",
  "src",
  "builder",
  "spawn-claude.ts",
);

setupAuditGuard();
configureMock(responsesDir);

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;

  try {
    const sandbox = await createSandbox(seedRepoDir);
    sandboxPath = sandbox.path;
    cleanup = sandbox.cleanup;

    const focusPath = join(sandbox.path, "bug.md");
    process.env.FOCUS_PATH = focusPath;
    process.env.AGENT_NAME = "bug-fix";
    process.chdir(sandbox.path);

    const { createBugfixAgent } = await import("@serranolabs.io/munchkins");

    const builder = createBugfixAgent({
      focus: focusPath,
      finalize: { onPass: [], onFail: [] },
    });
    const agentResult = await builder.run();

    if (!agentResult.succeeded) {
      return {
        scenarioId: SCENARIO_ID,
        result: "fail",
        durationMs: Date.now() - start,
        sandboxPath,
        mockCallLog: getMockCallLog(),
        failure: {
          phase: "execution",
          message: agentResult.failureReason ?? "agent pipeline did not succeed",
        },
        harnessVersion: HARNESS_VERSION,
      };
    }

    const log = getMockCallLog();
    const expected = getExpectedMockCallCount();
    if (log.length !== expected) {
      return {
        scenarioId: SCENARIO_ID,
        result: "fail",
        durationMs: Date.now() - start,
        sandboxPath,
        mockCallLog: log,
        failure: {
          phase: "assertion",
          message: `mock-call audit: expected ${expected} invocations, got ${log.length}`,
        },
        harnessVersion: HARNESS_VERSION,
      };
    }

    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return {
        scenarioId: SCENARIO_ID,
        result: "fail",
        durationMs: Date.now() - start,
        sandboxPath,
        mockCallLog: log,
        failure: {
          phase: "assertion",
          message: `audit guard: ${claudeAttempts.length} real \`claude\` spawn attempt(s) occurred`,
        },
        harnessVersion: HARNESS_VERSION,
      };
    }

    cleanup();
    return {
      scenarioId: SCENARIO_ID,
      result: "pass",
      durationMs: Date.now() - start,
      mockCallLog: log,
      harnessVersion: HARNESS_VERSION,
    };
  } catch (err) {
    return {
      scenarioId: SCENARIO_ID,
      result: "fail",
      durationMs: Date.now() - start,
      sandboxPath,
      mockCallLog: getMockCallLog(),
      failure: {
        phase: "setup",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      harnessVersion: HARNESS_VERSION,
    };
  }
}

const result = await run();
printResult(result);
process.exit(result.result === "pass" ? 0 : 1);
