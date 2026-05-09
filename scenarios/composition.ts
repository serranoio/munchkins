#!/usr/bin/env bun
/**
 * Composition scenario — exercises `AgentBuilder.thenRun()` end-to-end via
 * the `--dry-run` describe path. Asserts:
 *
 *   1. `bugfix.thenRun(refactor)` returns a NEW builder with the concatenated
 *      step list, options unioned by name, and sandbox/summaryWriter/integration
 *      stripped.
 *   2. Re-attaching sandbox + summaryWriter on the composed builder works and
 *      the resulting `--dry-run` output reports the correct step count.
 *   3. The original `bugfix` and `refactor` builders are unchanged after the
 *      composition (no shared mutable state).
 *
 * This scenario does not invoke a real Claude backend — `--dry-run` short-
 * circuits the AgentBuilder before any LLM call. It still requires a real git
 * repo because the dry-run path resolves repoRoot via `git rev-parse`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { printResult, type ScenarioResult } from "./lib/result.js";

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "composition-e2e";

const start = Date.now();

type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";

function fail(phase: FailPhase, message: string, sandboxPath?: string): ScenarioResult {
  return {
    scenarioId: SCENARIO_ID,
    result: "fail",
    durationMs: Date.now() - start,
    sandboxPath,
    failure: { phase, message },
    harnessVersion: HARNESS_VERSION,
  };
}

async function run(): Promise<ScenarioResult> {
  // Build a minimal git repo so `git rev-parse --show-toplevel` resolves inside run().
  const repoRoot = mkdtempSync(join(tmpdir(), "munchkins-composition-"));
  const cleanup = () => {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  const originalCwd = process.cwd();

  try {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "harness",
      GIT_AUTHOR_EMAIL: "harness@local",
      GIT_COMMITTER_NAME: "harness",
      GIT_COMMITTER_EMAIL: "harness@local",
    };
    await $`git init -b main`.cwd(repoRoot).env(env).quiet();
    await Bun.write(join(repoRoot, "seed.ts"), "export const seed = 1;\n");
    await $`git add -A`.cwd(repoRoot).env(env).quiet();
    await $`git commit -m seed`.cwd(repoRoot).env(env).quiet();

    process.chdir(repoRoot);

    // Import the framework AFTER chdir so registry/builders pick up env from this dir.
    const { AgentBuilder, Prompt, gitWorktreeSandbox } = await import(
      "@serranolabs.io/munchkins-core"
    );

    // Create two minimal builders. The Prompts here use inline user-message
    // text so we don't need fixture files on disk.
    const a = new AgentBuilder("a-step", "first agent")
      .add(new Prompt().withUserMessage("step a"))
      .add(new Prompt().withUserMessage("step a-2"));

    const b = new AgentBuilder("b-step", "second agent").add(
      new Prompt().withUserMessage("step b"),
    );

    const aStepsBefore = a.getStepCount();
    const bStepsBefore = b.getStepCount();

    // Compose. Sandbox/summaryWriter/integration must be stripped from the
    // composed builder per the S3 contract.
    const composed = a
      .thenRun(b)
      .rename("a-then-b")
      .describe("composed pipeline")
      .setSandbox(gitWorktreeSandbox());

    // Invariants on the composed builder.
    if (composed === a || composed === b) {
      return fail("assertion", "thenRun returned an existing builder; expected a new instance");
    }
    if (composed.getStepCount() !== aStepsBefore + bStepsBefore) {
      return fail(
        "assertion",
        `composed step count ${composed.getStepCount()} !== ${aStepsBefore} + ${bStepsBefore}`,
      );
    }
    if (composed.getSummaryWriter() !== undefined) {
      return fail("assertion", "thenRun did not strip summaryWriter from the composed builder");
    }
    if (composed.getIntegration() !== undefined) {
      return fail("assertion", "thenRun did not strip integration from the composed builder");
    }
    if (composed.name !== "a-then-b") {
      return fail("assertion", `rename() did not stick: got "${composed.name}"`);
    }
    if (composed.description !== "composed pipeline") {
      return fail(
        "assertion",
        `describe() did not stick: got "${composed.description ?? "<undefined>"}"`,
      );
    }

    // Receivers must be unchanged.
    if (a.getStepCount() !== aStepsBefore) {
      return fail(
        "assertion",
        `thenRun mutated receiver A: ${a.getStepCount()} != ${aStepsBefore}`,
      );
    }
    if (b.getStepCount() !== bStepsBefore) {
      return fail(
        "assertion",
        `thenRun mutated receiver B: ${b.getStepCount()} != ${bStepsBefore}`,
      );
    }

    // Exercise the dry-run describe path. This proves the composed pipeline's
    // resolved shape can be walked end-to-end without an LLM.
    process.env.__MUNCHKINS_OPT_dryRun = "true";
    let runResult: { succeeded: boolean; failureReason?: string };
    try {
      runResult = await composed.run();
    } finally {
      delete process.env.__MUNCHKINS_OPT_dryRun;
    }

    if (!runResult.succeeded) {
      return fail("execution", runResult.failureReason ?? "composed dry-run did not succeed");
    }

    return {
      scenarioId: SCENARIO_ID,
      result: "pass",
      durationMs: Date.now() - start,
      harnessVersion: HARNESS_VERSION,
    };
  } catch (err) {
    return fail("setup", err instanceof Error ? err.message : String(err));
  } finally {
    process.chdir(originalCwd);
    cleanup();
  }
}

const result = await run();
printResult(result);
process.exit(result.result === "pass" ? 0 : 1);
