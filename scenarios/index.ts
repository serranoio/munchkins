#!/usr/bin/env bun
import { mock } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import {
  configureMock,
  getClaudeAttempts,
  getExpectedMockCallCount,
  getMockCallLog,
  getResponseFileNames,
  getSlugOutput,
  setupAuditGuard,
  spawnClaudeMock,
} from "./lib/mock-spawn-claude.js";
import { printResult, type ScenarioResult } from "./lib/result.js";
import { createSandbox } from "./lib/sandbox.js";

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "bugfix-agent-e2e";

// Timestamp for this harness invocation — used to build a stable, unique artifact dir.
const HARNESS_TS = Date.now();

const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
// munchkins repo root is one level above the scenarios/ directory.
const repoRoot = join(harnessDir, "..");
const fixtureDir = join(harnessDir, "fixtures", "bugfix-agent-e2e");
const seedRepoDir = join(fixtureDir, "seed-repo");
const responsesDir = join(fixtureDir, "mock-claude-responses");
const spawnClaudeAbsPath = join(
  harnessDir,
  "..",
  "packages",
  "munchkins-core",
  "src",
  "builder",
  "spawn-claude.ts",
);

// Stable artifact directory for this scenario run, under the munchkins repo root.
const artifactDir = join(repoRoot, ".scenario-artifacts", `${SCENARIO_ID}-${HARNESS_TS}`);

setupAuditGuard();
configureMock(responsesDir);

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

// Direct the framework's RunLog to write run artifacts into artifactDir.
// This must be set before the bundle is imported so RunLog picks it up at construction time.
process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;

async function assertHappyPathCleanup(repoRoot: string): Promise<string | undefined> {
  const wtList = (await $`git worktree list --porcelain`.cwd(repoRoot).quiet()).text();
  if (wtList.includes(".worktrees/")) {
    return `worktree not removed; git worktree list:\n${wtList}`;
  }

  const wtRoot = join(repoRoot, ".worktrees");
  if (existsSync(wtRoot)) {
    const entries = (await $`ls -A ${wtRoot}`.quiet().nothrow()).stdout.toString().trim();
    if (entries) {
      return `.worktrees/ not empty after teardown:\n${entries}`;
    }
  }

  const branches = (await $`git branch --list 'agent/*'`.cwd(repoRoot).quiet()).text().trim();
  if (branches) {
    return `agent branches leaked: ${branches}`;
  }

  const log = (await $`git log --oneline main`.cwd(repoRoot).quiet()).text();
  const logLines = log.trim().split("\n").filter(Boolean);
  // With squash merge, all worktree commits are collapsed into one squash commit on main.
  // Verify at least one commit exists beyond the seed commit.
  if (logLines.length < 2) {
    return `squash commit missing on main; log:\n${log}`;
  }
  // Verify that each mock invocation's marker file is present on main (squash preserves tree).
  for (const file of getResponseFileNames()) {
    const stem = file.replace(/\.json$/, "");
    const marker = `__mock_${getResponseFileNames().indexOf(file)}_${stem}.txt`;
    const tracked = (await $`git ls-files ${marker}`.cwd(repoRoot).quiet()).text().trim();
    if (!tracked) {
      return `marker file ${marker} missing on main`;
    }
  }

  return undefined;
}

/**
 * Assert that run-log artifacts were written into artifactDir by the framework.
 *
 * Expected layout (relative to artifactDir):
 *   bug-fix-<ts>-<uuid>/          ← exactly one subdir matching "bug-fix-*"
 *     summary.json                ← parseable; agent === "bug-fix"
 *     events.jsonl                ← non-empty
 *     step-01-agent.system.md
 *     step-01-agent.user.md
 *     step-01-agent.response.txt
 *     step-02-agent.system.md
 *     step-02-agent.user.md
 *     step-02-agent.response.txt
 *     step-03-summary.system.md
 *     step-03-summary.user.md
 *     step-03-summary.response.txt
 *
 * Returns undefined on success, or an error string describing the first missing/malformed artifact.
 */
function assertArtifacts(): string | undefined {
  if (!existsSync(artifactDir)) {
    return `artifact dir does not exist: ${artifactDir}`;
  }

  // Find subdirs matching the slug-prefixed name produced by the slug pipeline.
  const slugPrefix = `${getSlugOutput()}-`;
  let entries: string[];
  try {
    entries = readdirSync(artifactDir).filter((name) => {
      return name.startsWith(slugPrefix) && statSync(join(artifactDir, name)).isDirectory();
    });
  } catch (err) {
    return `failed to read artifact dir: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (entries.length === 0) {
    return `no ${slugPrefix}* run-log subdir found in artifact dir`;
  }

  // If somehow more than one, take the first lexicographically.
  entries.sort();
  const runLogDir = join(artifactDir, entries[0]);

  const requiredFiles = [
    "summary.json",
    "events.jsonl",
    "step-01-agent.system.md",
    "step-01-agent.user.md",
    "step-01-agent.response.txt",
    "step-02-agent.system.md",
    "step-02-agent.user.md",
    "step-02-agent.response.txt",
    "step-03-summary.system.md",
    "step-03-summary.user.md",
    "step-03-summary.response.txt",
  ];

  for (const file of requiredFiles) {
    const filePath = join(runLogDir, file);
    if (!existsSync(filePath)) {
      return `required artifact missing: ${file} (expected at ${filePath})`;
    }
  }

  // events.jsonl must be non-empty
  const eventsPath = join(runLogDir, "events.jsonl");
  const eventsStat = statSync(eventsPath);
  if (eventsStat.size === 0) {
    return "events.jsonl exists but is empty";
  }

  // summary.json must parse and have agent === "bug-fix"
  const summaryPath = join(runLogDir, "summary.json");
  let summary: unknown;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
  } catch (err) {
    return `summary.json failed to parse: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (
    typeof summary !== "object" ||
    summary === null ||
    (summary as Record<string, unknown>).agent !== "bug-fix"
  ) {
    return `summary.json has wrong shape or wrong agent value (expected agent === "bug-fix")`;
  }

  return undefined;
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;

  // Ensure the artifact dir exists before the agent runs.
  mkdirSync(artifactDir, { recursive: true });

  try {
    const sandbox = await createSandbox(seedRepoDir);
    sandboxPath = sandbox.path;
    cleanup = sandbox.cleanup;

    const userMessagePath = join(sandbox.path, "bug.md");
    process.env.__MUNCHKINS_OPT_userMessage = userMessagePath;
    process.chdir(sandbox.path);

    await import("@serranolabs.io/munchkins");
    const { registry } = await import("@serranolabs.io/munchkins-core");

    const agent = registry.get("bug-fix");
    if (!agent) {
      return {
        scenarioId: SCENARIO_ID,
        result: "fail",
        durationMs: Date.now() - start,
        sandboxPath,
        mockCallLog: getMockCallLog(),
        failure: {
          phase: "setup",
          message:
            'registry.get("bug-fix") returned undefined — bundle import did not register the agent',
        },
        harnessVersion: HARNESS_VERSION,
      };
    }

    const agentResult = await agent.run();

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

    const cleanupErr = await assertHappyPathCleanup(sandbox.path);
    if (cleanupErr) {
      return {
        scenarioId: SCENARIO_ID,
        result: "fail",
        durationMs: Date.now() - start,
        sandboxPath,
        mockCallLog: log,
        failure: { phase: "assertion", message: cleanupErr },
        harnessVersion: HARNESS_VERSION,
      };
    }

    // Assert that the framework deposited run-log artifacts at the configured location.
    const artifactErr = assertArtifacts();
    if (artifactErr) {
      return {
        scenarioId: SCENARIO_ID,
        result: "fail",
        durationMs: Date.now() - start,
        sandboxPath,
        mockCallLog: log,
        failure: { phase: "artifact", message: artifactErr },
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

// Save the harness's overall result alongside the agent's run-log artifacts.
try {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
} catch {
  // best-effort — don't mask the real result
}

printResult(result);

// Conditional artifact dir cleanup:
//   pass + no --preserve  → remove (ephemeral)
//   pass + --preserve     → keep, print path
//   fail (any phase)      → keep, print path
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
