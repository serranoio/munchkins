#!/usr/bin/env bun
// Contributor onboarding smoke — exercises the clean-clone path end-to-end in
// a tmpdir. Mirrors what a fresh checkout against `main` would do:
//
//   1. git clone the local repo into a tmpdir.
//   2. bun install.
//   3. bun run typecheck && bun run lint && bun test && bun run scenario.
//   4. bun run munchkins --help lists the 4 dogfood agents + framework
//      commands.
//   5. bun run munchkins bug-fix --dry-run --user-message=<trivial> exits
//      cleanly. (Full bug-fix end-to-end is covered by scenarios/index.ts;
//      this is the "the command resolves and runs at all" smoke.)
//
// Runs from the repo root: `bun run scripts/onboarding-smoke.ts`.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const PRESERVE = process.argv.includes("--preserve");
const SCENARIO = process.argv.includes("--with-scenario");

const repoRoot = resolve(new URL(".", import.meta.url).pathname, "..");
const tmp = mkdtempSync(join(tmpdir(), "munchkins-onboarding-"));
const clone = join(tmp, "munchkins-clone");

const start = Date.now();
let failed = false;

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  if (failed) return;
  process.stdout.write(`▶ ${label}…\n`);
  try {
    await fn();
    process.stdout.write(`  ✓ ${label}\n`);
  } catch (err) {
    process.stderr.write(`  ✖ ${label}\n`);
    process.stderr.write(err instanceof Error ? `${err.message}\n` : `${String(err)}\n`);
    failed = true;
  }
}

await step("git clone (local)", async () => {
  const r = await $`git clone --local ${repoRoot} ${clone}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`git clone failed: ${r.stderr.toString()}`);
});

await step("bun install", async () => {
  const r = await $`bun install`.cwd(clone).quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`bun install failed: ${r.stderr.toString()}`);
});

await step("bun run typecheck", async () => {
  const r = await $`bun run typecheck`.cwd(clone).quiet().nothrow();
  if (r.exitCode !== 0) {
    throw new Error(`typecheck failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
  }
});

await step("bun run lint", async () => {
  const r = await $`bun run lint`.cwd(clone).quiet().nothrow();
  if (r.exitCode !== 0) {
    throw new Error(`lint failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
  }
});

await step("bun test", async () => {
  const r = await $`bun test`.cwd(clone).quiet().nothrow();
  if (r.exitCode !== 0) {
    throw new Error(`bun test failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
  }
});

if (SCENARIO) {
  await step("bun run scenario", async () => {
    const r = await $`bun run scenario`.cwd(clone).quiet().nothrow();
    if (r.exitCode !== 0) {
      throw new Error(`scenario failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
    }
  });
} else {
  process.stdout.write("  · scenario step skipped (pass --with-scenario to enable)\n");
}

await step("bun run munchkins --help lists the 4 dogfood agents", async () => {
  const r = await $`bun run munchkins --help`.cwd(clone).quiet().nothrow();
  if (r.exitCode !== 0) {
    throw new Error(`munchkins --help failed:\n${r.stderr.toString()}`);
  }
  const out = r.stdout.toString();
  for (const expected of ["bug-fix", "feat-small", "refactor", "director"]) {
    if (!out.includes(expected)) {
      throw new Error(`--help missing dogfood agent "${expected}":\n${out}`);
    }
  }
  for (const expected of ["resume", "status", "daemon"]) {
    if (!out.includes(expected)) {
      throw new Error(`--help missing framework subcommand "${expected}":\n${out}`);
    }
  }
});

const WITH_REAL_BUGFIX = process.argv.includes("--with-real-bugfix");

await step(
  WITH_REAL_BUGFIX
    ? "bun run munchkins bug-fix --user-message=<trivial> lands one commit on main"
    : "bun run munchkins bug-fix --dry-run resolves",
  async () => {
    const bugFile = join(clone, "smoke-bug.md");
    writeFileSync(bugFile, "Make src/README.md say 'smoke verified'.\n");

    if (!WITH_REAL_BUGFIX) {
      const r = await $`bun run munchkins bug-fix --dry-run --user-message=${bugFile}`
        .cwd(clone)
        .quiet()
        .nothrow();
      if (r.exitCode !== 0) {
        throw new Error(
          `bug-fix --dry-run failed (exit ${r.exitCode}):\n${r.stdout.toString()}\n${r.stderr.toString()}`,
        );
      }
      return;
    }

    // Real bug-fix path — requires `claude` CLI authenticated; will burn
    // tokens. Asserts (a) the run lands one commit on `main` beyond the seed
    // history and (b) the worktree is gone afterward.
    const before = (await $`git rev-list --count main`.cwd(clone).quiet()).text().trim();
    const r = await $`bun run munchkins bug-fix --user-message=${bugFile}`
      .cwd(clone)
      .quiet()
      .nothrow();
    if (r.exitCode !== 0) {
      throw new Error(
        `bug-fix failed (exit ${r.exitCode}):\n${r.stdout.toString()}\n${r.stderr.toString()}`,
      );
    }
    const after = (await $`git rev-list --count main`.cwd(clone).quiet()).text().trim();
    if (Number(after) - Number(before) < 1) {
      throw new Error(`expected ≥1 new commit on main, got before=${before} after=${after}`);
    }
    const wt = (await $`git worktree list --porcelain`.cwd(clone).quiet()).text();
    if (wt.includes(".worktrees/")) {
      throw new Error(`agent worktree was not cleaned up:\n${wt}`);
    }
  },
);

if (PRESERVE) {
  process.stderr.write(`tmpdir preserved at: ${tmp}\n`);
} else {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

const secs = ((Date.now() - start) / 1000).toFixed(1);
if (failed) {
  process.stderr.write(`\nFAIL onboarding-smoke (${secs}s)\n`);
  process.exit(1);
}
process.stdout.write(`\nPASS onboarding-smoke (${secs}s)\n`);
