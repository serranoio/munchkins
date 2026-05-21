#!/usr/bin/env bun
/**
 * Regression net for issue #1: the runner must produce a real commit on main
 * when the agent leaves its edits uncommitted in the worktree.
 *
 * Uses the existing AgentBuilder pipeline against a mock that:
 *  - writes edits via the fixture's `writeFiles` field (matching real-agent
 *    behavior — edits sit in the working tree),
 *  - does NOT auto-commit (matching real-agent behavior — the agent contract
 *    is "don't commit, the summary-writer does it"),
 *  - does NOT write the harness marker file (those markers exist only to
 *    audit mock invocations in other scenarios and would pollute this one).
 *
 * Without the issue #1 fix in `sandbox.ts:diff()`, the runner reads an empty
 * diff (because nothing is committed), the summary-writer is skipped, no
 * commit lands, and integration fails on a dirty rebase. This scenario fails
 * loudly in that state.
 */
import { mock } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
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

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "agent-uncommitted-smoke-e2e";
const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
// Reuse the bugfix scenario's seed-repo — same shape (bug.md + src/math.ts),
// just exercised end-to-end against the uncommitted-work codepath.
const seedRepoDir = join(harnessDir, "fixtures", "bugfix-agent-e2e", "seed-repo");
const responsesDir = join(harnessDir, "fixtures", SCENARIO_ID, "mock-claude-responses");
const spawnClaudeAbsPath = join(
  harnessDir,
  "..",
  "packages",
  "munchkins-core",
  "src",
  "builder",
  "spawn-claude.ts",
);
const artifactDir = join(repoRoot, ".scenario-artifacts", `${SCENARIO_ID}-${HARNESS_TS}`);

setupAuditGuard();
configureMock(responsesDir, { noMockCommit: true });

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;

async function readMainFile(sandboxPath: string, relPath: string): Promise<string | undefined> {
  const r = await $`git show main:${relPath}`.cwd(sandboxPath).quiet().nothrow();
  if (r.exitCode !== 0) return undefined;
  return r.text();
}

async function assertRealCommitLanded(sandboxPath: string): Promise<string | undefined> {
  // 1. main must have advanced beyond the seed commit.
  const commitCount = (await $`git rev-list --count main`.cwd(sandboxPath).quiet()).text().trim();
  if (parseInt(commitCount, 10) < 2) {
    return `main has only ${commitCount} commit(s) — agent's work did not produce a real commit on main`;
  }

  // 2. The agent's edits (from writeFiles) must be tracked on main.
  const mathContent = await readMainFile(sandboxPath, "src/math.ts");
  if (mathContent === undefined) {
    return "src/math.ts missing from main after run";
  }
  if (!mathContent.includes("a + b")) {
    return `src/math.ts on main does not contain the agent's edit ("a + b"); got:\n${mathContent}`;
  }

  const testContent = await readMainFile(sandboxPath, "src/math.test.ts");
  if (testContent === undefined) {
    return "src/math.test.ts missing from main — second agent step's writeFiles did not land";
  }
  if (!testContent.includes("regression: expected 5")) {
    return `src/math.test.ts on main does not contain the agent's regression test`;
  }

  // 3. The summary-writer's commit message must have been used. Look it up via the
  // last commit message on main (the docs(changelog) commit).
  const headMsg = (await $`git log -1 --pretty=%s main`.cwd(sandboxPath).quiet()).text().trim();
  if (!headMsg.includes("fix(math): return a + b instead of a - b")) {
    return `latest main commit message did not come from summary-writer fixture; got:\n${headMsg}`;
  }

  // 4. Working tree must be clean and the agent worktree/branch fully cleaned.
  const wtList = (await $`git worktree list --porcelain`.cwd(sandboxPath).quiet()).text();
  if (wtList.includes(".worktrees/")) {
    return `worktree not removed; git worktree list:\n${wtList}`;
  }
  const branches = (await $`git branch --list 'agent/*'`.cwd(sandboxPath).quiet()).text().trim();
  if (branches) {
    return `agent branches leaked: ${branches}`;
  }

  return undefined;
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;

  type FailPhase = "setup" | "execution" | "assertion" | "cleanup";
  const failResult = (phase: FailPhase, message: string): ScenarioResult => ({
    scenarioId: SCENARIO_ID,
    result: "fail",
    durationMs: Date.now() - start,
    sandboxPath,
    mockCallLog: getMockCallLog(),
    failure: { phase, message },
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
    const skillBody = readFileSync(skillSrc, "utf-8");
    writeFileSync(join(skillDestDir, "SKILL.md"), skillBody);

    const userMessagePath = join(sandbox.path, "bug.md");
    process.env.__MUNCHKINS_OPT_userMessage = userMessagePath;
    process.chdir(sandbox.path);

    await import("@serranolabs.io/serrano-munchkins");
    const { registry } = await import("@serranolabs.io/munchkins-core");

    const agent = registry.get("bug-fix");
    if (!agent) {
      return failResult("setup", 'registry.get("bug-fix") returned undefined');
    }

    const agentResult = await agent.run();

    if (!agentResult.succeeded) {
      return failResult("execution", agentResult.failureReason ?? "agent pipeline did not succeed");
    }

    const log = getMockCallLog();
    const expected = getExpectedMockCallCount();
    if (log.length !== expected) {
      return failResult(
        "assertion",
        `mock-call audit: expected ${expected} invocations, got ${log.length}`,
      );
    }

    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return failResult(
        "assertion",
        `audit guard: ${claudeAttempts.length} real \`claude\` spawn attempt(s) occurred`,
      );
    }

    const err = await assertRealCommitLanded(sandbox.path);
    if (err) return failResult("assertion", err);

    cleanup();
    return {
      scenarioId: SCENARIO_ID,
      result: "pass",
      durationMs: Date.now() - start,
      mockCallLog: log,
      harnessVersion: HARNESS_VERSION,
    };
  } catch (err) {
    return failResult("setup", err instanceof Error ? err.message : String(err));
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
} else {
  process.stderr.write(`scenario artifacts preserved at: ${artifactDir}\n`);
}

process.exit(result.result === "pass" ? 0 : 1);
