#!/usr/bin/env bun
/**
 * Bug-fix agent with `--integrate=pr` end-to-end.
 *
 * Reuses the `bugfix-agent-e2e` fixtures verbatim — same mocked pipeline,
 * only the integration strategy differs. The fake `gh` shim plus a bare-repo
 * `origin` cover the push + PR-create surface so no real GitHub call is made
 * and no real `claude` invocation occurs.
 *
 * Assertions:
 *   - agent.run() succeeded
 *   - zero real `claude` spawn attempts
 *   - `gh pr create` invoked exactly once with `--base main`, `--title`, `--body`
 *   - the body contains the `**Goal:**` marker emitted by the summary-writer fixture
 *   - local main did NOT advance (PR strategy never ff-merges)
 *   - the bare remote received an `agent/*` branch whose tip subject starts with
 *     `docs(changelog):` (the summary-writer phase's terminal commit)
 *   - no `.worktrees/` entries, no `agent/*` local branches survive teardown
 */
import { mock } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const SCENARIO_ID = "bugfix-pr-integrate-e2e";

const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
// Reuse bugfix-agent-e2e fixtures — the PR variant doesn't change agent
// behavior, only the integration strategy at the run boundary.
const fixtureDir = join(harnessDir, "fixtures", "bugfix-agent-e2e");
const seedRepoDir = join(fixtureDir, "seed-repo");
const responsesDir = join(fixtureDir, "mock-claude-responses");
const shimDir = join(harnessDir, "lib", "fake-gh-bin");
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
configureMock(responsesDir);

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;
mkdirSync(artifactDir, { recursive: true });

type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";

interface GhInvocation {
  argv: string[];
  flags: Record<string, string>;
}

async function readGhLog(path: string): Promise<GhInvocation[]> {
  if (!existsSync(path)) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GhInvocation);
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;
  let bareRemoteDir: string | undefined;
  const originalPath = process.env.PATH;
  let pathOverridden = false;

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

  try {
    // Preserve +x across fresh-clone runs where the file's mode bit may have
    // been dropped by tooling. The shim is invoked by `gh` on PATH.
    chmodSync(join(shimDir, "gh"), 0o755);

    const sandbox = await createSandbox(seedRepoDir);
    sandboxPath = sandbox.path;
    cleanup = sandbox.cleanup;

    // Install the bug-fix skill into the sandbox.
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

    // Stand up a bare-repo origin so the agent's `git push -u origin <branch>`
    // succeeds locally without touching the network.
    bareRemoteDir = mkdtempSync(join(tmpdir(), "munchkins-bare-origin-"));
    const harnessGitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "harness",
      GIT_AUTHOR_EMAIL: "harness@local",
      GIT_COMMITTER_NAME: "harness",
      GIT_COMMITTER_EMAIL: "harness@local",
    };
    await $`git init --bare -b main`.cwd(bareRemoteDir).quiet();
    await $`git remote add origin ${bareRemoteDir}`.cwd(sandbox.path).env(harnessGitEnv).quiet();
    await $`git push -u origin main`.cwd(sandbox.path).env(harnessGitEnv).quiet();

    const mainShaBefore = (await $`git rev-parse main`.cwd(sandbox.path).quiet()).text().trim();

    const ghLogFile = join(artifactDir, "gh.log");

    // Prepend the shim dir to PATH so `gh` resolves to our fake. `integrate.ts`
    // uses `Bun.spawnSync` with an explicit `env: { ...process.env }`, so the
    // PATH mutation here is observed by the child.
    process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
    pathOverridden = true;
    process.env.FAKE_GH_LOG_FILE = ghLogFile;
    process.env.__MUNCHKINS_OPT_integrate = "pr";
    process.env.__MUNCHKINS_OPT_userMessage = join(sandbox.path, "bug.md");
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

    // Audit guard: zero real claude invocations.
    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return failResult(
        "assertion",
        `audit guard: ${claudeAttempts.length} real \`claude\` spawn attempt(s) occurred`,
      );
    }

    // `gh pr create` was invoked once with the right flags.
    const ghInvocations = await readGhLog(ghLogFile);
    const prCreates = ghInvocations.filter(
      (inv) => inv.argv[0] === "pr" && inv.argv[1] === "create",
    );
    if (prCreates.length !== 1) {
      return failResult(
        "assertion",
        `expected exactly 1 \`gh pr create\` invocation; got ${prCreates.length}`,
      );
    }
    const prCreate = prCreates[0];
    if (prCreate.flags.base !== "main") {
      return failResult(
        "assertion",
        `expected \`gh pr create --base main\`; got --base=${JSON.stringify(prCreate.flags.base)}`,
      );
    }
    if (!prCreate.flags.title) {
      return failResult("assertion", "expected `gh pr create` to receive --title; was empty");
    }
    if (!prCreate.flags.body) {
      return failResult("assertion", "expected `gh pr create` to receive --body; was empty");
    }
    if (!prCreate.flags.body.includes("**Goal:**")) {
      return failResult(
        "assertion",
        `expected PR body to contain "**Goal:**" (summary-writer fixture marker); got:\n${prCreate.flags.body}`,
      );
    }

    // Local main did not advance.
    const mainShaAfter = (await $`git rev-parse main`.cwd(sandbox.path).quiet()).text().trim();
    if (mainShaAfter !== mainShaBefore) {
      return failResult(
        "assertion",
        `expected local main to remain at ${mainShaBefore}; got ${mainShaAfter}`,
      );
    }

    // Bare remote received an `agent/*` branch whose tip is a `docs(changelog):` commit.
    const remoteRefs = (
      await $`git ls-remote ${bareRemoteDir} 'refs/heads/agent/*'`.cwd(sandbox.path).quiet()
    )
      .text()
      .trim();
    if (!remoteRefs) {
      return failResult(
        "assertion",
        "expected bare remote to have at least one refs/heads/agent/* branch after PR push",
      );
    }
    const remoteBranchLine = remoteRefs.split("\n")[0];
    const remoteBranchRef = remoteBranchLine.split(/\s+/)[1];
    if (!remoteBranchRef?.startsWith("refs/heads/agent/")) {
      return failResult(
        "assertion",
        `expected first remote ref to be under refs/heads/agent/*; got ${JSON.stringify(remoteBranchRef)}`,
      );
    }

    const remoteTipSubject = (
      await $`git log -1 --format=%s ${remoteBranchRef}`.cwd(bareRemoteDir).quiet()
    )
      .text()
      .trim();
    if (!remoteTipSubject.startsWith("docs(changelog):")) {
      return failResult(
        "assertion",
        `expected remote agent-branch tip subject to start with "docs(changelog):"; got: ${JSON.stringify(remoteTipSubject)}`,
      );
    }

    // Worktree teardown.
    const wtList = (await $`git worktree list --porcelain`.cwd(sandbox.path).quiet()).text();
    if (wtList.includes(".worktrees/")) {
      return failResult("assertion", `worktree not removed; git worktree list:\n${wtList}`);
    }
    const wtRoot = join(sandbox.path, ".worktrees");
    if (existsSync(wtRoot)) {
      const entries = (await $`ls -A ${wtRoot}`.quiet().nothrow()).stdout.toString().trim();
      if (entries) {
        return failResult("assertion", `.worktrees/ not empty after teardown:\n${entries}`);
      }
    }
    const localAgentBranches = (await $`git branch --list 'agent/*'`.cwd(sandbox.path).quiet())
      .text()
      .trim();
    if (localAgentBranches) {
      return failResult("assertion", `local agent branches leaked: ${localAgentBranches}`);
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
    if (pathOverridden) process.env.PATH = originalPath;
    delete process.env.FAKE_GH_LOG_FILE;
    delete process.env.__MUNCHKINS_OPT_integrate;
    delete process.env.__MUNCHKINS_OPT_userMessage;
    if (bareRemoteDir) {
      try {
        rmSync(bareRemoteDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
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
