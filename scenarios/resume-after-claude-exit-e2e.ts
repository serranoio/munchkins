#!/usr/bin/env bun
/**
 * Resume-after-Claude-exit scenario.
 *
 * Phase 1 (in-process): drive the bug-fix agent with a mocked spawnClaude
 *   whose step-2 fixture exits non-zero ("usage cap" shape). The framework
 *   must mark the run `phase: "interrupted"`, preserve the worktree + branch,
 *   and surface the run via `listResumableRuns`.
 *
 * Phase 2 (subprocess): invoke `bun .../munchkins/src/index.ts resume <runId>`
 *   with a fake-claude shim on PATH driving the remaining steps. The framework
 *   must resume mid-pipeline, complete the run, and tear down the worktree on
 *   success.
 */
import { mock } from "bun:test";
import {
  copyFileSync,
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
  getMockCallLog,
  setupAuditGuard,
  spawnClaudeMock,
} from "./lib/mock-spawn-claude.js";
import { printResult, type ScenarioResult } from "./lib/result.js";
import { createSandbox } from "./lib/sandbox.js";

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "resume-after-claude-exit-e2e";

const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
const fixtureDir = join(harnessDir, "fixtures", SCENARIO_ID);
const seedRepoDir = join(fixtureDir, "seed-repo");
const phase1ResponsesDir = join(fixtureDir, "mock-claude-responses-phase1");
const phase2ResponsesDir = join(fixtureDir, "mock-claude-responses-phase2");
const shimDir = join(harnessDir, "lib", "fake-claude-bin");
const munchkinsBin = join(repoRoot, "packages", "munchkins", "src", "index.ts");
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
configureMock(phase1ResponsesDir);

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

// The framework reads MUNCHKINS_RUN_LOG_DIR at RunLog construction time; set
// it before importing the bundle so the artifact dir is consistent across the
// in-process phase and the subprocess phase below.
process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;

type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";

interface FullCleanupCheck {
  ok: boolean;
  reason?: string;
}

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runMunchkinsCli(
  argv: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<CliRunResult> {
  const proc = Bun.spawn(["bun", munchkinsBin, ...argv], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

async function assertResumeCompletedCleanup(
  sandboxPath: string,
  expectedMarkers: readonly string[],
): Promise<FullCleanupCheck> {
  const wtList = (await $`git worktree list --porcelain`.cwd(sandboxPath).quiet()).text();
  if (wtList.includes(".worktrees/")) {
    return { ok: false, reason: `worktree not removed; git worktree list:\n${wtList}` };
  }

  const wtRoot = join(sandboxPath, ".worktrees");
  if (existsSync(wtRoot)) {
    const entries = (await $`ls -A ${wtRoot}`.quiet().nothrow()).stdout.toString().trim();
    if (entries) {
      return { ok: false, reason: `.worktrees/ not empty after teardown:\n${entries}` };
    }
  }

  const branches = (await $`git branch --list 'agent/*'`.cwd(sandboxPath).quiet()).text().trim();
  if (branches) {
    return { ok: false, reason: `agent branches leaked: ${branches}` };
  }

  for (const marker of expectedMarkers) {
    const tracked = (await $`git ls-files ${marker}`.cwd(sandboxPath).quiet()).text().trim();
    if (!tracked) {
      return { ok: false, reason: `marker file ${marker} missing on main` };
    }
  }

  return { ok: true };
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;

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
      "munchkins",
      "skills",
      "munchkins-bug-fix",
      "SKILL.md",
    );
    const skillDestDir = join(sandbox.path, ".claude", "skills", "munchkins-bug-fix");
    mkdirSync(skillDestDir, { recursive: true });
    copyFileSync(skillSrc, join(skillDestDir, "SKILL.md"));

    const userMessagePath = join(sandbox.path, "bug.md");
    process.env.__MUNCHKINS_OPT_userMessage = userMessagePath;
    process.chdir(sandbox.path);

    await import("@serranolabs.io/munchkins");
    const { registry } = await import("@serranolabs.io/munchkins-core");

    const agent = registry.get("bug-fix");
    if (!agent) {
      return failResult("setup", 'registry.get("bug-fix") returned undefined');
    }

    // ── Phase 1: in-process run that must fail at step 2 (refactorer). ────────
    const phase1Result = await agent.run();
    if (phase1Result.succeeded) {
      return failResult(
        "execution",
        "phase 1 succeeded; expected failure at step 2 (refactorer usage-cap fixture)",
      );
    }

    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return failResult(
        "assertion",
        `audit guard: ${claudeAttempts.length} real \`claude\` spawn attempt(s) occurred in phase 1`,
      );
    }

    // Locate the run dir produced by the failing phase 1.
    const runDirs = readdirSync(artifactDir).filter((name) => {
      const p = join(artifactDir, name);
      try {
        return statSync(p).isDirectory() && existsSync(join(p, "state.json"));
      } catch {
        return false;
      }
    });
    if (runDirs.length !== 1) {
      return failResult(
        "assertion",
        `expected exactly one run dir under artifactDir; found ${runDirs.length}: ${runDirs.join(", ")}`,
      );
    }
    const runLogDir = join(artifactDir, runDirs[0]);
    const stateAfterPhase1 = JSON.parse(readFileSync(join(runLogDir, "state.json"), "utf-8")) as {
      runId: string;
      phase: string;
      steps: Array<{ index: number; kind: string; status: string }>;
      failureReason?: string;
      sandboxState: { kind: string; path?: string; branch?: string };
    };

    // Assertions 1-9.
    if (stateAfterPhase1.phase !== "interrupted") {
      return failResult(
        "assertion",
        `expected state.phase === "interrupted" after phase 1; got "${stateAfterPhase1.phase}"`,
      );
    }
    if (stateAfterPhase1.steps[0]?.status !== "completed") {
      return failResult(
        "assertion",
        `expected step[0].status === "completed"; got "${stateAfterPhase1.steps[0]?.status}"`,
      );
    }
    if (stateAfterPhase1.steps[1]?.status !== "in-progress") {
      return failResult(
        "assertion",
        `expected step[1].status === "in-progress"; got "${stateAfterPhase1.steps[1]?.status}"`,
      );
    }
    if (!stateAfterPhase1.failureReason?.includes("agent step failed (exit 1)")) {
      return failResult(
        "assertion",
        `expected failureReason to include "agent step failed (exit 1)"; got "${stateAfterPhase1.failureReason ?? "<unset>"}"`,
      );
    }
    if (stateAfterPhase1.sandboxState.kind !== "git-worktree") {
      return failResult(
        "assertion",
        `expected sandboxState.kind === "git-worktree"; got "${stateAfterPhase1.sandboxState.kind}"`,
      );
    }
    const worktreePath = stateAfterPhase1.sandboxState.path ?? "";
    const agentBranch = stateAfterPhase1.sandboxState.branch ?? "";
    if (!existsSync(worktreePath)) {
      return failResult(
        "assertion",
        `expected worktree dir ${worktreePath} to still exist after failure; it does not`,
      );
    }
    const branchExists =
      (
        await $`git rev-parse --verify --quiet ${`refs/heads/${agentBranch}`}`
          .cwd(sandbox.path)
          .nothrow()
          .quiet()
      ).exitCode === 0;
    if (!branchExists) {
      return failResult(
        "assertion",
        `expected agent branch ${agentBranch} to still exist after failure; it does not`,
      );
    }
    const step0Marker = "__mock_0_01-bug-fix-success.txt";
    const trackedOnBranch = (
      await $`git ls-tree --name-only ${agentBranch} -- ${step0Marker}`
        .cwd(sandbox.path)
        .nothrow()
        .quiet()
    )
      .text()
      .trim();
    if (!trackedOnBranch) {
      return failResult(
        "assertion",
        `expected step 1's marker (${step0Marker}) on agent branch ${agentBranch}; not found`,
      );
    }
    if (phase1Result.succeeded !== false) {
      return failResult("assertion", "phase 1 RunResult.succeeded was not false");
    }

    // Assertion 10: listResumableRuns surfaces the interrupted run.
    const { listResumableRuns } = await import("@serranolabs.io/munchkins-core");
    const resumable = listResumableRuns(sandbox.path).filter(
      (r) => r.state.runId === stateAfterPhase1.runId,
    );
    if (resumable.length !== 1) {
      return failResult(
        "assertion",
        `expected listResumableRuns to surface runId ${stateAfterPhase1.runId}; found ${resumable.length} match(es)`,
      );
    }

    // Assertion 10b: the `munchkins resume --list` CLI surface also reports the run.
    const listRun = await runMunchkinsCli(["resume", "--list"], sandbox.path, {
      ...process.env,
      MUNCHKINS_RUN_LOG_DIR: artifactDir,
    });
    if (listRun.exitCode !== 0) {
      return failResult(
        "execution",
        `resume --list subprocess exited ${listRun.exitCode}\n--- stdout ---\n${listRun.stdout}\n--- stderr ---\n${listRun.stderr}`,
      );
    }
    if (!listRun.stdout.includes(stateAfterPhase1.runId)) {
      return failResult(
        "assertion",
        `expected \`resume --list\` stdout to include runId ${stateAfterPhase1.runId}; got:\n${listRun.stdout}`,
      );
    }

    // ── Phase 2: subprocess `munchkins resume <runId>` via fake-claude shim. ──
    const counterFile = join(artifactDir, "phase2-counter");
    if (existsSync(counterFile)) rmSync(counterFile);
    const env = {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_FIXTURE_DIR: phase2ResponsesDir,
      FAKE_CLAUDE_COUNTER_FILE: counterFile,
      MUNCHKINS_RUN_LOG_DIR: artifactDir,
    };
    const resumeRun = await runMunchkinsCli(["resume", stateAfterPhase1.runId], sandbox.path, env);

    if (resumeRun.exitCode !== 0) {
      return failResult(
        "execution",
        `resume subprocess exited ${resumeRun.exitCode}\n--- stdout ---\n${resumeRun.stdout}\n--- stderr ---\n${resumeRun.stderr}`,
      );
    }

    // Assertions 12-13: state after resume.
    const stateAfterPhase2 = JSON.parse(readFileSync(join(runLogDir, "state.json"), "utf-8")) as {
      phase: string;
      steps: Array<{ status: string }>;
    };
    if (stateAfterPhase2.phase !== "done") {
      return failResult(
        "assertion",
        `expected state.phase === "done" after resume; got "${stateAfterPhase2.phase}"`,
      );
    }
    if (stateAfterPhase2.steps[1]?.status !== "completed") {
      return failResult(
        "assertion",
        `expected step[1].status === "completed" after resume; got "${stateAfterPhase2.steps[1]?.status}"`,
      );
    }

    // Assertions 14-17: cleanup + marker preservation on main.
    if (existsSync(worktreePath)) {
      return failResult(
        "assertion",
        `expected worktree dir ${worktreePath} to be removed after successful resume; it still exists`,
      );
    }
    const branchStillExists =
      (
        await $`git rev-parse --verify --quiet ${`refs/heads/${agentBranch}`}`
          .cwd(sandbox.path)
          .nothrow()
          .quiet()
      ).exitCode === 0;
    if (branchStillExists) {
      return failResult(
        "assertion",
        `expected agent branch ${agentBranch} to be deleted after successful resume; it still exists`,
      );
    }

    const cleanupCheck = await assertResumeCompletedCleanup(sandbox.path, [
      step0Marker,
      "__resume_step2.txt",
      "__resume_summary.txt",
    ]);
    if (!cleanupCheck.ok) {
      return failResult("assertion", cleanupCheck.reason ?? "cleanup check failed");
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
