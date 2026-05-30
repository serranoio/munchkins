#!/usr/bin/env bun
/**
 * Bug-fix agent against a sandbox whose `repoRoot` has uncommitted operator
 * content at integration time. Reuses the `bugfix-agent-e2e` mocked pipeline;
 * the only delta is the dirty pre-integrate state.
 *
 * Assertions:
 *   - agent.run() succeeded (dirty repoRoot did NOT block integration)
 *   - HEAD of main is the agent's squash subject
 *   - main^ subject matches `wip(operator): changes captured before bug-fix/<slug>`
 *   - the previously-untracked operator file is tracked on main after integration
 *   - zero real `claude` spawn attempts
 */
import { mock } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import {
  configureMock,
  getClaudeAttempts,
  getMockCallLog,
  setupAuditGuard,
  spawnClaudeMock,
} from "./lib/mock-spawn-claude.js";
import { printResult, type ScenarioResult } from "./lib/result.js";
import { createSandbox } from "./lib/sandbox.js";

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "dirty-main-commit-e2e";

const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
// Reuse the bugfix-agent-e2e fixtures verbatim — pipeline is identical;
// only the operator's pre-integration repoRoot state differs.
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

const artifactDir = join(repoRoot, ".scenario-artifacts", `${SCENARIO_ID}-${HARNESS_TS}`);

setupAuditGuard();
configureMock(responsesDir);

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;

const OPERATOR_WIP_PATTERN = /^wip\(operator\): changes captured before bug-fix\/.+/;
const DIRTY_TRACKED_PATH = "src/math.ts";
const DIRTY_TRACKED_CONTENT = "// operator edit before integration\n";
const DIRTY_UNTRACKED_PATH = "operator-notes.txt";
const DIRTY_UNTRACKED_CONTENT = "operator scratch — must survive integration\n";

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;

  type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";
  const failResult = (
    phase: FailPhase,
    message: string,
    opts?: { stack?: string },
  ): ScenarioResult => ({
    scenarioId: SCENARIO_ID,
    result: "fail",
    durationMs: Date.now() - start,
    sandboxPath,
    mockCallLog: getMockCallLog(),
    failure: { phase, message, ...(opts?.stack ? { stack: opts.stack } : {}) },
    harnessVersion: HARNESS_VERSION,
  });

  mkdirSync(artifactDir, { recursive: true });

  try {
    const sandbox = await createSandbox(seedRepoDir);
    sandboxPath = sandbox.path;
    cleanup = sandbox.cleanup;

    const skillSrc = join(
      repoRoot,
      "packages",
      "serrano-munchkins",
      "skills",
      "munchkins-bug-fix",
      "SKILL.md",
    );
    const skillDestDir = join(sandbox.path, ".claude", "skills", "munchkins-bug-fix");
    mkdirSync(skillDestDir, { recursive: true });
    copyFileSync(skillSrc, join(skillDestDir, "SKILL.md"));

    // Seed dirty operator state BEFORE the agent runs: a tracked modification
    // and an untracked file. Both must land on main as a single WIP commit.
    await Bun.write(join(sandbox.path, DIRTY_TRACKED_PATH), DIRTY_TRACKED_CONTENT);
    await Bun.write(join(sandbox.path, DIRTY_UNTRACKED_PATH), DIRTY_UNTRACKED_CONTENT);

    process.env.__MUNCHKINS_OPT_userMessage = join(sandbox.path, "bug.md");
    process.chdir(sandbox.path);

    await import("@serranolabs.io/serrano-munchkins");
    const { registry } = await import("@serranolabs.io/munchkins");

    const agent = registry.get("bug-fix");
    if (!agent) {
      return failResult("setup", 'registry.get("bug-fix") returned undefined');
    }

    const agentResult = await agent.run();
    if (!agentResult.succeeded) {
      return failResult("execution", agentResult.failureReason ?? "agent pipeline did not succeed");
    }

    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return failResult(
        "assertion",
        `audit guard: ${claudeAttempts.length} real \`claude\` spawn attempt(s) occurred`,
      );
    }

    const log = (await $`git log --format=%s main`.cwd(sandbox.path).quiet()).text();
    const subjects = log.trim().split("\n").filter(Boolean);
    // History on main: [<agent squash>, <operator wip>, <seed>] (newest first).
    if (subjects.length < 3) {
      return failResult(
        "assertion",
        `expected at least 3 commits on main (squash, operator wip, seed); got:\n${log}`,
      );
    }

    const squashSubject = subjects[0];
    if (!squashSubject) {
      return failResult("assertion", "HEAD subject on main was empty");
    }

    const wipSubject = subjects[1];
    if (!OPERATOR_WIP_PATTERN.test(wipSubject)) {
      return failResult(
        "assertion",
        `expected main^ subject to match ${OPERATOR_WIP_PATTERN}; got: ${JSON.stringify(wipSubject)}`,
      );
    }

    // The previously-untracked operator file is tracked on main after integration.
    const trackedOnMain = (await $`git ls-files ${DIRTY_UNTRACKED_PATH}`.cwd(sandbox.path).quiet())
      .text()
      .trim();
    if (!trackedOnMain) {
      return failResult(
        "assertion",
        `expected ${DIRTY_UNTRACKED_PATH} to be tracked on main after integration`,
      );
    }

    const wipFileContent = (
      await $`git show main^:${DIRTY_UNTRACKED_PATH}`.cwd(sandbox.path).quiet()
    ).text();
    if (wipFileContent !== DIRTY_UNTRACKED_CONTENT) {
      return failResult(
        "assertion",
        `expected operator WIP commit to carry ${DIRTY_UNTRACKED_PATH}; got: ${JSON.stringify(wipFileContent)}`,
      );
    }

    cleanup();
    return {
      scenarioId: SCENARIO_ID,
      result: "pass",
      durationMs: Date.now() - start,
      mockCallLog: getMockCallLog(),
      harnessVersion: HARNESS_VERSION,
    };
  } catch (err) {
    return failResult("setup", err instanceof Error ? err.message : String(err), {
      stack: err instanceof Error ? err.stack : undefined,
    });
  } finally {
    delete process.env.__MUNCHKINS_OPT_userMessage;
  }
}

const result = await run();

try {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
} catch {
  // best-effort
}

printResult(result);

if (result.result === "pass" && !PRESERVE) {
  try {
    rmSync(artifactDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
} else if (existsSync(artifactDir)) {
  process.stderr.write(`scenario artifacts preserved at: ${artifactDir}\n`);
}

process.exit(result.result === "pass" ? 0 : 1);
