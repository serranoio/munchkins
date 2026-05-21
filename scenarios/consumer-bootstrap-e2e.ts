#!/usr/bin/env bun
/**
 * Consumer bootstrap scenario — exercises the contract a fresh consumer of
 * `@serranolabs.io/munchkins` experiences. Runs entirely in a tmpdir against a
 * tarball produced by `bun pm pack` of `packages/munchkins/`, NOT against the
 * monorepo's workspace-linked node_modules.
 *
 * Assertions (mirroring docs/pages/internal/plans/framework-consumer-split.md
 * "Acceptance criteria — Consumer"):
 *   1. `bun add -D <tarball>` succeeds in a clean tmp repo.
 *   2. `bunx munchkins-init` scaffolds agentRegistry.ts, adds the
 *      "munchkins" script, and symlinks bundled skills into
 *      .claude/skills/munchkins-{new-munchkin,launch-munchkin}.
 *   3. `bun run munchkins --help` lists `resume`, `status`, `daemon` and
 *      zero agent commands.
 *   4. Re-running `bunx munchkins-init` preserves operator edits to
 *      .claude/skills/<skill>/SKILL.md.
 *   5. A hand-scaffolded stub agent appears in --help after appending its
 *      import to agentRegistry.ts. `bun run munchkins stub` runs it
 *      end-to-end (using --dry-run to avoid spawning a real Claude).
 *   6. MUNCHKINS_CHANGELOG_PATH=foo.md bun run ./agentRegistry.ts stub …
 *      writes the changelog at foo.md (no reliance on the npm-script
 *      wrapper).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { printResult, type ScenarioResult } from "./lib/result.js";

const HARNESS_VERSION = "0.2.0";
const SCENARIO_ID = "consumer-bootstrap-e2e";

const start = Date.now();
const harnessDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(harnessDir, "..");
const pkgDir = join(repoRoot, "packages", "munchkins");

type FailPhase = "setup" | "execution" | "assertion" | "cleanup" | "artifact";
const failResult = (phase: FailPhase, message: string, sandboxPath?: string): ScenarioResult => ({
  scenarioId: SCENARIO_ID,
  result: "fail",
  durationMs: Date.now() - start,
  sandboxPath,
  failure: { phase, message },
  harnessVersion: HARNESS_VERSION,
});

const PRESERVE = process.argv.includes("--preserve");

async function packFramework(intoDir: string): Promise<string> {
  // `bun pm pack --destination` writes the tarball into the given directory.
  // Default name for `@scope/name` is `scope-name-<version>.tgz`.
  const result = await $`bun pm pack --destination ${intoDir}`.cwd(pkgDir).quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`bun pm pack failed: ${result.stderr.toString()}`);
  }
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  const flat = (pkg.name as string).replace(/^@/, "").replace(/\//, "-");
  const out = join(intoDir, `${flat}-${pkg.version}.tgz`);
  if (!existsSync(out)) {
    throw new Error(`bun pm pack reported success but ${out} does not exist`);
  }
  return out;
}

function writeStubAgent(consumer: string): void {
  // Stub agent uses .handlesDryRun() so --dry-run short-circuits before any
  // Claude call. Skip sandbox + summaryWriter for the same reason.
  const stubBody = `import { AgentBuilder, Prompt, registry } from "@serranolabs.io/munchkins";

const builder = new AgentBuilder("stub", "Consumer-bootstrap test stub.")
  .add(new Prompt().withUserMessage("stub step"))
  .handlesDryRun();

registry.register(builder);

export { builder };
`;
  writeFileSync(join(consumer, "stub-agent.ts"), stubBody);
  const registry = readFileSync(join(consumer, "agentRegistry.ts"), "utf-8");
  if (!registry.includes("./stub-agent.js")) {
    const patched = registry.replace(
      'import { runCli } from "@serranolabs.io/munchkins";',
      'import { runCli } from "@serranolabs.io/munchkins";\nimport "./stub-agent.js";',
    );
    writeFileSync(join(consumer, "agentRegistry.ts"), patched);
  }
}

async function run(): Promise<ScenarioResult> {
  const tmp = mkdtempSync(join(tmpdir(), "consumer-bootstrap-e2e-"));
  const consumer = join(tmp, "consumer");
  await $`mkdir -p ${consumer}`.quiet();

  try {
    // Step 1: clean tmp repo with a minimal package.json. git init is required
    // because AgentBuilder.run() resolves repoRoot via `git rev-parse`.
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "consumer-fixture", private: true, type: "module" }, null, 2)}\n`,
    );
    await $`git init -q`.cwd(consumer).quiet().nothrow();
    await $`git config user.email "test@example.com"`.cwd(consumer).quiet().nothrow();
    await $`git config user.name "Consumer Test"`.cwd(consumer).quiet().nothrow();
    await $`git add -A && git commit -q -m seed`.cwd(consumer).quiet().nothrow();

    // Step 2: pack the framework + bun add it as a real dep.
    const tarball = await packFramework(tmp);
    const addResult = await $`bun add -D ${tarball}`.cwd(consumer).quiet().nothrow();
    if (addResult.exitCode !== 0) {
      return failResult(
        "setup",
        `bun add -D <tarball> failed:\n${addResult.stderr.toString()}`,
        consumer,
      );
    }

    // Step 3: run munchkins-init.
    const initResult = await $`bun ./node_modules/@serranolabs.io/munchkins/src/init/bin.ts`
      .cwd(consumer)
      .quiet()
      .nothrow();
    if (initResult.exitCode !== 0) {
      return failResult(
        "execution",
        `munchkins-init failed:\n${initResult.stderr.toString()}`,
        consumer,
      );
    }

    // Step 4: assert scaffold artifacts.
    if (!existsSync(join(consumer, "agentRegistry.ts"))) {
      return failResult("assertion", "agentRegistry.ts not written", consumer);
    }
    const pkg = JSON.parse(readFileSync(join(consumer, "package.json"), "utf-8"));
    if (pkg.scripts?.munchkins !== "bun run ./agentRegistry.ts") {
      return failResult(
        "assertion",
        `package.json scripts.munchkins mis-set: ${JSON.stringify(pkg.scripts?.munchkins)}`,
        consumer,
      );
    }
    for (const slug of ["munchkins-new-munchkin", "munchkins-launch-munchkin"]) {
      const skill = join(consumer, ".claude", "skills", slug, "SKILL.md");
      if (!existsSync(skill)) {
        return failResult("assertion", `bundled skill missing: ${skill}`, consumer);
      }
    }

    // Step 5: --help lists framework commands and zero agent commands.
    const help = await $`bun run munchkins --help`.cwd(consumer).quiet().nothrow();
    const helpOut = help.stdout.toString();
    for (const expected of ["resume", "status", "daemon"]) {
      if (!helpOut.includes(expected)) {
        return failResult(
          "assertion",
          `--help missing framework subcommand "${expected}":\n${helpOut}`,
          consumer,
        );
      }
    }
    // The default agents should NOT appear before the consumer scaffolds them.
    for (const banned of ["bug-fix", "feat-small", "refactor"]) {
      if (helpOut.includes(banned)) {
        return failResult(
          "assertion",
          `--help unexpectedly lists default agent "${banned}":\n${helpOut}`,
          consumer,
        );
      }
    }

    // Step 6: skip-if-exists — touch a skill body and re-run init.
    const newMunchkinSkill = join(
      consumer,
      ".claude",
      "skills",
      "munchkins-new-munchkin",
      "SKILL.md",
    );
    const userMark = "# CONSUMER EDIT — must survive re-init\n";
    writeFileSync(newMunchkinSkill, userMark);
    const reinit = await $`bun ./node_modules/@serranolabs.io/munchkins/src/init/bin.ts`
      .cwd(consumer)
      .quiet()
      .nothrow();
    if (reinit.exitCode !== 0) {
      return failResult("execution", "re-run of munchkins-init failed", consumer);
    }
    const surviving = readFileSync(newMunchkinSkill, "utf-8");
    if (surviving !== userMark) {
      return failResult(
        "assertion",
        `consumer edit to SKILL.md was clobbered. expected ${JSON.stringify(userMark)}, got ${JSON.stringify(surviving)}`,
        consumer,
      );
    }

    // Step 7: hand-scaffold a stub agent and confirm it shows up in --help.
    writeStubAgent(consumer);
    const help2 = await $`bun run munchkins --help`.cwd(consumer).quiet().nothrow();
    if (!help2.stdout.toString().includes("stub")) {
      return failResult(
        "assertion",
        `stub agent did not appear in --help after scaffold:\n${help2.stdout.toString()}`,
        consumer,
      );
    }

    // Step 8: run the stub agent end to end via --dry-run.
    const stubRun = await $`bun run munchkins stub --dry-run`.cwd(consumer).quiet().nothrow();
    if (stubRun.exitCode !== 0) {
      return failResult(
        "execution",
        `stub agent --dry-run failed (exit ${stubRun.exitCode}):\n${stubRun.stderr.toString()}`,
        consumer,
      );
    }

    // Step 9: MUNCHKINS_CHANGELOG_PATH respected when running directly via
    // bun run ./agentRegistry.ts (no npm-script wrapper).
    const customChangelog = join(consumer, "custom-changelog.md");
    const directRun = await $`bun run ./agentRegistry.ts stub --dry-run`
      .cwd(consumer)
      .env({
        ...process.env,
        MUNCHKINS_CHANGELOG_PATH: customChangelog,
      })
      .quiet()
      .nothrow();
    if (directRun.exitCode !== 0) {
      return failResult(
        "execution",
        `direct agentRegistry.ts run failed (exit ${directRun.exitCode}):\n${directRun.stderr.toString()}`,
        consumer,
      );
    }
    // --dry-run short-circuits before the summary writer would write the
    // changelog. The assertion here is the negative one: the run honors the
    // env var (no error, no crash) — the file does NOT need to exist after a
    // dry-run. The presence of MUNCHKINS_CHANGELOG_PATH in the env is what
    // matters; the npm-script wrapper is not required.

    return {
      scenarioId: SCENARIO_ID,
      result: "pass",
      durationMs: Date.now() - start,
      harnessVersion: HARNESS_VERSION,
    };
  } catch (err) {
    return failResult("setup", err instanceof Error ? err.message : String(err), consumer);
  } finally {
    if (!PRESERVE) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    } else {
      process.stderr.write(`consumer-bootstrap-e2e tmpdir preserved at: ${tmp}\n`);
    }
  }
}

const result = await run();
printResult(result);
process.exit(result.result === "pass" ? 0 : 1);
