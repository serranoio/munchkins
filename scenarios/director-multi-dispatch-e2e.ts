#!/usr/bin/env bun
/**
 * Director multi-dispatch end-to-end scenario.
 *
 * Drives the cron daemon → director → dispatch chain twice against canned
 * LLM fixtures, asserting:
 *   1. Each tick walks the director's 7-step pipeline against tick-scoped
 *      mock LLM responses.
 *   2. Each tick's `bun run munchkins <child>` call (issued by dispatch.sh)
 *      is intercepted by a PATH-prepended shim (scenarios/lib/fake-bun-bin/bun)
 *      that records the attempt and synthesizes a real director/<child>-tick-N
 *      branch + ff-merge cycle in the sandbox.
 *   3. Across two ticks the director routes to TWO DIFFERENT child agents
 *      (bug-fix on tick 1, refactor on tick 2).
 *   4. All director worktrees and director/* branches clean up on pass.
 *   5. Zero real claude/codex/cmux invocations occur.
 *
 * The fake-bun shim sits in front of the real bun because Bun's `$` shell
 * template tag does not route external commands through `Bun.spawn`, so the
 * audit guard cannot see dispatch.sh's `exec bun run munchkins <child>` call.
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
  type ChildSpawnEntry,
  configureMock,
  getClaudeAttempts,
  getMockCallLog,
  readDispatchLog,
  setupAuditGuard,
  spawnClaudeMock,
  useTickBucket,
} from "./lib/mock-spawn-claude.js";
import { printResult, type ScenarioResult } from "./lib/result.js";
import { createSandbox } from "./lib/sandbox.js";

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "director-multi-dispatch-e2e";

const HARNESS_TS = Date.now();
const PRESERVE = process.argv.includes("--preserve");

const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
const fixtureDir = join(harnessDir, "fixtures", SCENARIO_ID);
const seedRepoDir = join(fixtureDir, "seed-repo");
const responsesDir = join(fixtureDir, "mock-claude-responses");
const fakeBunBinDir = join(harnessDir, "lib", "fake-bun-bin");
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
const dispatchLogPath = join(artifactDir, "dispatch.log");

const TICK_BUCKETS = ["tick-1", "tick-2"] as const;

setupAuditGuard();
configureMock(responsesDir, { buckets: [...TICK_BUCKETS] });

mock.module(spawnClaudeAbsPath, () => ({
  spawnClaude: spawnClaudeMock,
}));

process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;
process.env.MUNCHKINS_DISPATCH_LOG = dispatchLogPath;
// Prepend the fake-bun shim so dispatch.sh's `exec bun run munchkins <child>`
// hits our intercept instead of recursing into a real munchkins child run.
process.env.PATH = `${fakeBunBinDir}:${process.env.PATH ?? ""}`;

type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";

async function assertDirectorBranchesCleaned(sandbox: string): Promise<string | undefined> {
  const branches = (await $`git branch --list 'director/*'`.cwd(sandbox).quiet()).text().trim();
  if (branches) return `director/* branches leaked: ${branches}`;
  const agentBranches = (await $`git branch --list 'agent/*'`.cwd(sandbox).quiet()).text().trim();
  if (agentBranches) return `agent/* branches leaked: ${agentBranches}`;
  const wtList = (await $`git worktree list --porcelain`.cwd(sandbox).quiet()).text();
  if (wtList.includes(".worktrees/")) return `worktree not removed; list:\n${wtList}`;
  return undefined;
}

function assertTickArtifacts(): string | undefined {
  if (!existsSync(artifactDir)) return `artifact dir missing: ${artifactDir}`;
  const entries = readdirSync(artifactDir).filter((name) => {
    return statSync(join(artifactDir, name)).isDirectory();
  });
  if (entries.length < 2) {
    return `expected at least 2 run-log subdirs under ${artifactDir}; got ${entries.length}: ${entries.join(", ")}`;
  }
  for (const entry of entries) {
    const summaryPath = join(artifactDir, entry, "summary.json");
    if (!existsSync(summaryPath)) {
      return `run-log subdir ${entry} missing summary.json`;
    }
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as { agent?: string };
    if (summary.agent !== "director") {
      return `run-log subdir ${entry} summary.agent === ${summary.agent}; expected "director"`;
    }
  }
  return undefined;
}

async function run(): Promise<ScenarioResult> {
  const start = Date.now();
  let sandboxPath: string | undefined;
  let cleanup: (() => void) | undefined;
  const originalCwd = process.cwd();

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
  // Pre-create the dispatch log so the shim's `wc -l` count starts at 0.
  writeFileSync(dispatchLogPath, "");

  try {
    const sandbox = await createSandbox(seedRepoDir);
    sandboxPath = sandbox.path;
    cleanup = sandbox.cleanup;

    // Install the director skill into the sandbox so withSkill("munchkins:director")
    // resolves against the sandboxed repo root.
    const skillSrc = join(
      repoRoot,
      "packages",
      "munchkins",
      "skills",
      "munchkins-director",
      "SKILL.md",
    );
    const skillDestDir = join(sandbox.path, ".claude", "skills", "munchkins-director");
    mkdirSync(skillDestDir, { recursive: true });
    copyFileSync(skillSrc, join(skillDestDir, "SKILL.md"));

    process.chdir(sandbox.path);

    await import("@serranolabs.io/munchkins");
    const { registry, runDaemon } = await import("@serranolabs.io/munchkins-core");

    const builder = registry.get("director");
    if (!builder) {
      return failResult("setup", 'registry.get("director") returned undefined');
    }

    // Wrap builder.run() so the harness can await each tick's pipeline before
    // firing the next. runDaemon's fireTick is fire-and-forget under the hood.
    const origRun = builder.run.bind(builder);
    let resolveCurrentTick: ((value: unknown) => void) | undefined;
    let rejectCurrentTick: ((err: unknown) => void) | undefined;
    (builder as { run: () => Promise<unknown> }).run = async () => {
      try {
        const r = await origRun();
        resolveCurrentTick?.(r);
        return r;
      } catch (err) {
        rejectCurrentTick?.(err);
        throw err;
      }
    };

    // setTimer captures the most-recently-armed callback. The harness fires it
    // on demand. Re-arm calls after the second tick are still captured but the
    // harness ignores pendingCallback past tick 2.
    let pendingCallback: (() => void) | undefined;
    const setTimer = (cb: () => void, _ms: number) => {
      pendingCallback = cb;
      return 0;
    };

    await runDaemon({
      registry,
      now: () => new Date("2026-01-01T00:00:00Z"),
      stdout: () => {},
      stderr: () => {},
      setTimer,
    });

    if (!pendingCallback) {
      return failResult("execution", "runDaemon did not arm a timer for the director builder");
    }

    // Wires up the tick-completion promise, switches the mock fixture bucket,
    // fires the most-recently-armed timer callback, and waits for the wrapped
    // builder.run() to resolve.
    const awaitTick = async (cb: () => void, bucket: string): Promise<void> => {
      useTickBucket(bucket);
      const done = new Promise((resolve, reject) => {
        resolveCurrentTick = resolve;
        rejectCurrentTick = reject;
      });
      cb();
      await done;
    };

    // ── Tick 1 ───────────────────────────────────────────────────────────────
    await awaitTick(pendingCallback, "tick-1");

    const childLogAfterTick1 = readDispatchLog(dispatchLogPath);
    if (childLogAfterTick1.length !== 1) {
      return failResult(
        "assertion",
        `expected 1 child-spawn intercept after tick 1; got ${childLogAfterTick1.length} (log: ${JSON.stringify(childLogAfterTick1)})`,
      );
    }
    if (childLogAfterTick1[0].child !== "bug-fix") {
      return failResult(
        "assertion",
        `tick 1 routed to "${childLogAfterTick1[0].child}"; expected "bug-fix"`,
      );
    }

    // ── Tick 2 ───────────────────────────────────────────────────────────────
    if (!pendingCallback) {
      return failResult("assertion", "tick 1 did not re-arm a timer for tick 2");
    }
    await awaitTick(pendingCallback, "tick-2");

    const childLog: ChildSpawnEntry[] = readDispatchLog(dispatchLogPath);
    if (childLog.length !== 2) {
      return failResult(
        "assertion",
        `expected 2 child-spawn intercepts total; got ${childLog.length}`,
      );
    }
    if (childLog[1].child !== "refactor") {
      return failResult(
        "assertion",
        `tick 2 routed to "${childLog[1].child}"; expected "refactor"`,
      );
    }

    const distinctChildren = new Set(childLog.map((c) => c.child));
    if (distinctChildren.size !== 2) {
      return failResult(
        "assertion",
        `expected 2 distinct child agents across ticks; got ${[...distinctChildren].join(", ")}`,
      );
    }

    const claudeAttempts = getClaudeAttempts();
    if (claudeAttempts.length > 0) {
      return failResult(
        "assertion",
        `audit guard: ${claudeAttempts.length} real claude/cmux spawn attempt(s) occurred`,
      );
    }

    const cleanupErr = await assertDirectorBranchesCleaned(sandbox.path);
    if (cleanupErr) return failResult("assertion", cleanupErr);

    const artifactErr = assertTickArtifacts();
    if (artifactErr) return failResult("artifact", artifactErr);

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
    process.chdir(originalCwd);
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
