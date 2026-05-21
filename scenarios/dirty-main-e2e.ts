#!/usr/bin/env bun
/**
 * Dirty-main-tolerant integration scenario.
 *
 * The bug-fix agent must land its branch on `main` even when the operator's
 * repoRoot is dirty (unstaged tracked edits, staged-but-not-committed changes,
 * or untracked files that would otherwise collide with the agent's diff).
 * Pre-existing dirty work is captured in a single recoverable snapshot commit
 * on main; the agent always wins on overlap via `git rebase -X theirs`.
 *
 * Parameterized matrix (one sandbox per variant, all share the bugfix-agent-e2e
 * fixtures verbatim):
 *
 *   D1: unstaged tracked modification, no overlap with the agent's diff
 *   D2: unstaged tracked modification, overlapping a path the agent creates
 *   D3: staged-but-not-committed change, no overlap
 *   D4: untracked file name-colliding with an agent-created path
 *   D5: mix of D1 + D3 + D4
 *
 * For each variant the harness asserts: agent succeeded, exactly one snapshot
 * commit on main with the expected prefix, the snapshot reproduces the
 * operator's original dirty content for affected files, the agent's marker
 * files are present on main, and the working tree contains the agent's
 * version of any overlapping paths.
 */
import { mock } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
const SCENARIO_ID = "dirty-main-e2e";
// Must stay in sync with `SNAPSHOT_MSG_PREFIX` in
// `packages/munchkins-core/src/integrate.ts`. Kept local to avoid a static
// import of internals from the scenario harness.
const SNAPSHOT_MSG_PREFIX = "munchkins: pre-merge snapshot of dirty repoRoot @";
// Path the bug-fix agent's mock writes during step 1; used both as an overlap
// target for variants D2/D4 and as the post-integration marker assertion.
const AGENT_MARKER_FILE = "__mock_0_01-bug-fix.txt";

const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
// Reuse the bugfix-agent-e2e fixtures verbatim — the dirty-tree variants don't
// need new agent behavior, just a different starting state in repoRoot.
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

const artifactDir = join(repoRoot, ".scenario-artifacts", `${SCENARIO_ID}-${HARNESS_TS}`);

setupAuditGuard();
configureMock(responsesDir);

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;
mkdirSync(artifactDir, { recursive: true });

interface DirtySetup {
  /**
   * Mutate the sandbox repoRoot so it is dirty in the variant's specific way.
   * Returns a list of `(path, expectedContentInSnapshot)` pairs the assertion
   * phase will verify via `git show <snapshot-sha>:<path>`.
   */
  apply(sandboxPath: string): Promise<Array<{ path: string; expectInSnapshot: string }>>;
  /** Paths the agent creates that should win against the operator's overlap. */
  overlapAgentPaths?: string[];
}

interface Variant {
  id: string;
  description: string;
  setup: DirtySetup;
}

const harnessGitEnv = {
  GIT_AUTHOR_NAME: "harness",
  GIT_AUTHOR_EMAIL: "harness@local",
  GIT_COMMITTER_NAME: "harness",
  GIT_COMMITTER_EMAIL: "harness@local",
} as const;

function gitEnv(): Record<string, string | undefined> {
  return { ...process.env, ...harnessGitEnv };
}

async function commitSeedFile(sandboxPath: string, path: string, content: string): Promise<void> {
  const abs = join(sandboxPath, path);
  mkdirSync(dirname(abs), { recursive: true });
  await Bun.write(abs, content);
  await $`git add ${path}`.cwd(sandboxPath).env(gitEnv()).quiet();
  await $`git commit -m ${`seed ${path}`}`.cwd(sandboxPath).env(gitEnv()).quiet();
}

const VARIANTS: Variant[] = [
  {
    id: "D1",
    description: "unstaged tracked modification, no overlap",
    setup: {
      async apply(sandboxPath) {
        await commitSeedFile(sandboxPath, "README.md", "# original\n");
        await Bun.write(join(sandboxPath, "README.md"), "# dirty edit\n");
        return [{ path: "README.md", expectInSnapshot: "# dirty edit\n" }];
      },
    },
  },
  {
    id: "D2",
    description: "unstaged tracked modification overlapping an agent-created file",
    setup: {
      // Seeding `AGENT_MARKER_FILE` with different content forces the
      // snapshot-commit's version to lose to the agent during rebase.
      async apply(sandboxPath) {
        await commitSeedFile(sandboxPath, AGENT_MARKER_FILE, "seed content\n");
        await Bun.write(join(sandboxPath, AGENT_MARKER_FILE), "user DIRTY content\n");
        return [{ path: AGENT_MARKER_FILE, expectInSnapshot: "user DIRTY content\n" }];
      },
      overlapAgentPaths: [AGENT_MARKER_FILE],
    },
  },
  {
    id: "D3",
    description: "staged-but-not-committed change, no overlap",
    setup: {
      async apply(sandboxPath) {
        await commitSeedFile(sandboxPath, "notes.md", "# notes\n");
        await Bun.write(join(sandboxPath, "notes.md"), "# notes (staged dirty)\n");
        await $`git add notes.md`.cwd(sandboxPath).env(gitEnv()).quiet();
        return [{ path: "notes.md", expectInSnapshot: "# notes (staged dirty)\n" }];
      },
    },
  },
  {
    id: "D4",
    description: "untracked file name-colliding with an agent-created file",
    setup: {
      async apply(sandboxPath) {
        await Bun.write(join(sandboxPath, AGENT_MARKER_FILE), "untracked user content\n");
        return [{ path: AGENT_MARKER_FILE, expectInSnapshot: "untracked user content\n" }];
      },
      overlapAgentPaths: [AGENT_MARKER_FILE],
    },
  },
  {
    id: "D5",
    description: "mix of unstaged + staged + untracked",
    setup: {
      async apply(sandboxPath) {
        await commitSeedFile(sandboxPath, "unstaged.md", "# unstaged base\n");
        await commitSeedFile(sandboxPath, "staged.md", "# staged base\n");

        await Bun.write(join(sandboxPath, "unstaged.md"), "# unstaged DIRTY\n");
        await Bun.write(join(sandboxPath, "staged.md"), "# staged DIRTY\n");
        await $`git add staged.md`.cwd(sandboxPath).env(gitEnv()).quiet();
        await Bun.write(join(sandboxPath, "scratch.txt"), "untracked scratch\n");

        return [
          { path: "unstaged.md", expectInSnapshot: "# unstaged DIRTY\n" },
          { path: "staged.md", expectInSnapshot: "# staged DIRTY\n" },
          { path: "scratch.txt", expectInSnapshot: "untracked scratch\n" },
        ];
      },
    },
  },
];

type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";

interface VariantOutcome {
  id: string;
  result: "pass" | "fail";
  failure?: { phase: FailPhase; message: string };
  sandboxPath?: string;
}

async function findSnapshotShas(sandboxPath: string): Promise<string[]> {
  const log = (await $`git log --pretty=%H%x09%s main`.cwd(sandboxPath).quiet()).text();
  return log
    .split("\n")
    .filter(Boolean)
    .filter((line) => line.split("\t")[1]?.startsWith(SNAPSHOT_MSG_PREFIX))
    .map((line) => line.split("\t")[0]);
}

async function readFileAtCommit(sandboxPath: string, sha: string, path: string): Promise<string> {
  return (await $`git show ${`${sha}:${path}`}`.cwd(sandboxPath).quiet()).text();
}

async function runVariant(
  variant: Variant,
  bugFixAgent: { run: () => Promise<{ succeeded: boolean; failureReason?: string }> },
): Promise<VariantOutcome> {
  // Reset mock state for this variant — keeps the call queue at index 0 and
  // the call log empty so the audit phase observes only this variant's calls.
  configureMock(responsesDir);

  // Restore cwd to the repo root before creating a new sandbox. The previous
  // variant chdir'd into its sandbox and then deleted it; any subsequent
  // cwd-relative Bun call would inherit the now-missing directory and fail.
  process.chdir(repoRoot);

  const sandbox = await createSandbox(seedRepoDir);
  try {
    // Install the bug-fix skill into the sandbox, mirroring index.ts.
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

    // Apply the variant's dirty-tree setup BEFORE running the agent.
    const dirtyFiles = await variant.setup.apply(sandbox.path);

    process.env.__MUNCHKINS_OPT_userMessage = join(sandbox.path, "bug.md");
    process.chdir(sandbox.path);

    const agentResult = await bugFixAgent.run();
    if (!agentResult.succeeded) {
      return {
        id: variant.id,
        result: "fail",
        sandboxPath: sandbox.path,
        failure: {
          phase: "execution",
          message: agentResult.failureReason ?? "agent pipeline did not succeed",
        },
      };
    }

    // Audit: no real claude invocations.
    const attempts = getClaudeAttempts();
    if (attempts.length > 0) {
      return {
        id: variant.id,
        result: "fail",
        sandboxPath: sandbox.path,
        failure: {
          phase: "assertion",
          message: `audit guard: ${attempts.length} real claude spawn attempt(s)`,
        },
      };
    }

    // Snapshot commit assertions.
    const snapshots = await findSnapshotShas(sandbox.path);
    if (snapshots.length !== 1) {
      return {
        id: variant.id,
        result: "fail",
        sandboxPath: sandbox.path,
        failure: {
          phase: "assertion",
          message: `expected exactly 1 snapshot commit on main; found ${snapshots.length}`,
        },
      };
    }
    const snapshotSha = snapshots[0];

    const snapshotAuthor = (
      await $`git log -1 --format=%an ${snapshotSha}`.cwd(sandbox.path).quiet()
    )
      .text()
      .trim();
    if (snapshotAuthor !== "munchkins") {
      return {
        id: variant.id,
        result: "fail",
        sandboxPath: sandbox.path,
        failure: {
          phase: "assertion",
          message: `snapshot commit author expected "munchkins"; got "${snapshotAuthor}"`,
        },
      };
    }

    for (const { path, expectInSnapshot } of dirtyFiles) {
      const actual = await readFileAtCommit(sandbox.path, snapshotSha, path);
      if (actual !== expectInSnapshot) {
        return {
          id: variant.id,
          result: "fail",
          sandboxPath: sandbox.path,
          failure: {
            phase: "assertion",
            message: `snapshot commit content mismatch for ${path}: expected ${JSON.stringify(expectInSnapshot)}, got ${JSON.stringify(actual)}`,
          },
        };
      }
    }

    // Overlap assertion: agent's content wins in the working tree.
    for (const path of variant.setup.overlapAgentPaths ?? []) {
      const actual = await Bun.file(join(sandbox.path, path)).text();
      if (!actual.startsWith("mock invocation")) {
        return {
          id: variant.id,
          result: "fail",
          sandboxPath: sandbox.path,
          failure: {
            phase: "assertion",
            message: `agent did not win on overlap path ${path}; working tree has: ${JSON.stringify(actual)}`,
          },
        };
      }
      if (actual.includes("<<<<<<<")) {
        return {
          id: variant.id,
          result: "fail",
          sandboxPath: sandbox.path,
          failure: {
            phase: "assertion",
            message: `conflict markers remain in working tree at ${path}`,
          },
        };
      }
    }

    // Agent's primary marker file is on main.
    const tracked = (await $`git ls-files ${AGENT_MARKER_FILE}`.cwd(sandbox.path).quiet())
      .text()
      .trim();
    if (!tracked) {
      return {
        id: variant.id,
        result: "fail",
        sandboxPath: sandbox.path,
        failure: {
          phase: "assertion",
          message: `agent marker file ${AGENT_MARKER_FILE} missing on main after integration`,
        },
      };
    }

    // Worktree teardown.
    const wtList = (await $`git worktree list --porcelain`.cwd(sandbox.path).quiet()).text();
    if (wtList.includes(".worktrees/")) {
      return {
        id: variant.id,
        result: "fail",
        sandboxPath: sandbox.path,
        failure: {
          phase: "assertion",
          message: `worktree not removed; git worktree list:\n${wtList}`,
        },
      };
    }

    sandbox.cleanup();
    return { id: variant.id, result: "pass" };
  } catch (err) {
    return {
      id: variant.id,
      result: "fail",
      sandboxPath: sandbox.path,
      failure: {
        phase: "setup",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();

  // Import the bundle once — registration is a one-time side effect; subsequent
  // imports are cache hits. The registry is process-wide.
  await import("@serranolabs.io/serrano-munchkins");
  const { registry } = await import("@serranolabs.io/munchkins-core");
  const agent = registry.get("bug-fix");
  if (!agent) {
    return {
      scenarioId: SCENARIO_ID,
      result: "fail",
      durationMs: Date.now() - start,
      failure: {
        phase: "setup",
        message: 'registry.get("bug-fix") returned undefined',
      },
      harnessVersion: HARNESS_VERSION,
    };
  }

  const outcomes: VariantOutcome[] = [];
  for (const variant of VARIANTS) {
    outcomes.push(await runVariant(variant, agent));
  }

  const failed = outcomes.filter((o) => o.result === "fail");
  if (failed.length > 0) {
    const summary = failed
      .map((o) => `  ${o.id}: ${o.failure?.phase ?? "?"} — ${o.failure?.message ?? ""}`)
      .join("\n");
    return {
      scenarioId: SCENARIO_ID,
      result: "fail",
      durationMs: Date.now() - start,
      sandboxPath: failed[0]?.sandboxPath,
      mockCallLog: getMockCallLog(),
      failure: {
        phase: failed[0]?.failure?.phase ?? "assertion",
        message: `${failed.length}/${outcomes.length} variant(s) failed:\n${summary}`,
      },
      harnessVersion: HARNESS_VERSION,
    };
  }

  return {
    scenarioId: SCENARIO_ID,
    result: "pass",
    durationMs: Date.now() - start,
    mockCallLog: getMockCallLog(),
    harnessVersion: HARNESS_VERSION,
  };
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
    const { rmSync } = await import("node:fs");
    rmSync(artifactDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
} else {
  process.stderr.write(`scenario artifacts preserved at: ${artifactDir}\n`);
}

process.exit(result.result === "pass" ? 0 : 1);
