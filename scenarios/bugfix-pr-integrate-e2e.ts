#!/usr/bin/env bun
/**
 * Bug-fix `--integrate=pr` end-to-end scenario.
 *
 * Drives the bug-fix agent with the `pr` integration strategy. A captured-
 * invocation `gh` shim on PATH avoids any GitHub network call, and a bare
 * git repo serves as the `origin` remote so `git push -u origin <branch>`
 * succeeds against the local filesystem.
 *
 * Asserts:
 *   - agent.run() succeeded
 *   - `gh pr create` was invoked once with `--base main`, `--title`, `--body`
 *   - PR body contains the markdown summary from the summary-writer phase
 *   - the agent branch was pushed (visible via `git ls-remote` on the bare)
 *   - local `main` did NOT advance (PR strategy never ff-merges)
 *   - the agent's branch carries a `docs(changelog):` commit at HEAD
 *   - worktree teardown ran cleanly
 */
import { mock } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
const SCENARIO_ID = "bugfix-pr-integrate-e2e";

const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
// Reuse bugfix-agent-e2e's fixtures verbatim — same agent, same mocked
// pipeline; only the integration strategy differs.
const fixtureDir = join(harnessDir, "fixtures", "bugfix-agent-e2e");
const seedRepoDir = join(fixtureDir, "seed-repo");
const responsesDir = join(fixtureDir, "mock-claude-responses");
const ghShimDir = join(harnessDir, "lib", "fake-gh-bin");
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

function readGhLog(path: string): GhInvocation[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GhInvocation);
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;

  // Save PATH so we can restore it on teardown; otherwise the shim leaks into
  // any subsequent scenario that imports the bundle in the same process.
  const originalPath = process.env.PATH;
  const originalIntegrate = process.env.__MUNCHKINS_OPT_integrate;

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
    // Ensure the shim is executable even after a fresh clone where the +x bit
    // may not have been preserved.
    chmodSync(join(ghShimDir, "gh"), 0o755);

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

    // Stand up a bare repo to serve as `origin`. The PR strategy's
    // `git push -u origin <branch>` lands here; we assert against the bare's
    // refs after the run.
    const bareRemoteDir = join(sandbox.path, ".fake-remote.git");
    await $`git init --bare ${bareRemoteDir}`.quiet();
    await $`git remote add origin ${bareRemoteDir}`.cwd(sandbox.path).quiet();

    // Capture pre-run main SHA so we can verify it doesn't advance under PR mode.
    const mainBefore = (await $`git rev-parse main`.cwd(sandbox.path).quiet()).text().trim();

    // Wire the gh shim onto PATH and point it at a per-run log.
    const ghLogFile = join(artifactDir, "gh.log");
    process.env.PATH = `${ghShimDir}:${originalPath ?? ""}`;
    process.env.FAKE_GH_LOG_FILE = ghLogFile;
    process.env.__MUNCHKINS_OPT_integrate = "pr";
    process.env.__MUNCHKINS_OPT_userMessage = join(sandbox.path, "bug.md");
    process.chdir(sandbox.path);

    await import("@serranolabs.io/munchkins");
    const { registry } = await import("@serranolabs.io/munchkins-core");

    const agent = registry.get("bug-fix");
    if (!agent) {
      return failResult("setup", 'registry.get("bug-fix") returned undefined');
    }

    const agentResult = await agent.run();
    if (!agentResult.succeeded) {
      return failResult(
        "execution",
        agentResult.failureReason ?? "agent pipeline did not succeed",
      );
    }

    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return failResult(
        "assertion",
        `audit guard: ${claudeAttempts.length} real \`claude\` spawn attempt(s)`,
      );
    }

    // ── Assertions ──
    const ghLog = readGhLog(ghLogFile);
    const prCreate = ghLog.find((e) => e.argv[0] === "pr" && e.argv[1] === "create");
    if (!prCreate) {
      return failResult(
        "assertion",
        `expected a \`gh pr create\` invocation; captured ${ghLog.length} call(s): ${JSON.stringify(ghLog)}`,
      );
    }
    if (prCreate.flags.base !== "main") {
      return failResult(
        "assertion",
        `expected \`gh pr create --base main\`; got --base=${JSON.stringify(prCreate.flags.base)}`,
      );
    }
    if (!prCreate.flags.title) {
      return failResult("assertion", "`gh pr create` missing --title");
    }
    if (!prCreate.flags.body) {
      return failResult("assertion", "`gh pr create` missing --body");
    }
    // The summary-writer fixture's markdown begins with **Goal:** — the body
    // must carry that intact so reviewers see the agent's summary.
    if (!prCreate.flags.body.includes("**Goal:**")) {
      return failResult(
        "assertion",
        `\`gh pr create --body\` did not include the summary-writer markdown; got: ${JSON.stringify(prCreate.flags.body.slice(0, 200))}`,
      );
    }

    // Local main must not have advanced under PR mode.
    const mainAfter = (await $`git rev-parse main`.cwd(sandbox.path).quiet()).text().trim();
    if (mainAfter !== mainBefore) {
      return failResult(
        "assertion",
        `local main advanced under PR strategy: before=${mainBefore} after=${mainAfter}`,
      );
    }

    // The bare remote must carry an `agent/*` branch — the one PR was opened from.
    const lsRemote = (
      await $`git ls-remote ${bareRemoteDir} refs/heads/agent/*`.cwd(sandbox.path).quiet()
    )
      .text()
      .trim();
    if (!lsRemote) {
      return failResult(
        "assertion",
        `expected an agent/* branch in the bare remote; ls-remote was empty`,
      );
    }
    const pushedBranch = lsRemote.split("\n")[0]?.split("\t")[1]?.replace(/^refs\/heads\//, "");
    if (!pushedBranch) {
      return failResult("assertion", `could not parse pushed branch from ls-remote: ${lsRemote}`);
    }

    // The pushed branch must carry a `docs(changelog):` commit at its tip.
    const tipSubject = (
      await $`git -C ${bareRemoteDir} log -1 --format=%s ${`refs/heads/${pushedBranch}`}`.quiet()
    )
      .text()
      .trim();
    if (!tipSubject.startsWith("docs(changelog):")) {
      return failResult(
        "assertion",
        `expected pushed branch tip to be docs(changelog) commit; got: ${JSON.stringify(tipSubject)}`,
      );
    }

    // Worktree teardown.
    const wtList = (await $`git worktree list --porcelain`.cwd(sandbox.path).quiet()).text();
    if (wtList.includes(".worktrees/")) {
      return failResult("assertion", `worktree not removed; git worktree list:\n${wtList}`);
    }
    const localAgentBranches = (
      await $`git branch --list 'agent/*'`.cwd(sandbox.path).quiet()
    )
      .text()
      .trim();
    if (localAgentBranches) {
      return failResult("assertion", `agent branches leaked locally: ${localAgentBranches}`);
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
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    delete process.env.FAKE_GH_LOG_FILE;
    if (originalIntegrate === undefined) delete process.env.__MUNCHKINS_OPT_integrate;
    else process.env.__MUNCHKINS_OPT_integrate = originalIntegrate;
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
