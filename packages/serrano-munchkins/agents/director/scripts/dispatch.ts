#!/usr/bin/env bun
// Step 6 — Dispatch. Reads triage.json + plan.md, derives the target munchkin
// from work_type, then runs the child as a foreground subprocess. Early-exits
// on upstream idle. In dry-run, agent steps were skipped so triage.json won't
// exist — this step short-circuits before the file-existence check.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKDIR = process.env.WORKTREE ?? process.cwd();
const REPO = process.env.REPO_ROOT ?? WORKDIR;

let RUN_ID = "";
try {
  RUN_ID = readFileSync(join(WORKDIR, ".director", "current"), "utf-8").trim();
} catch {
  // fall through to the empty-id guard below
}
if (!RUN_ID) {
  console.error("[director] dispatch: .director/current missing — pipeline did not initialize");
  process.exit(1);
}

const RUN_DIR = join(WORKDIR, ".director", RUN_ID);
const TRIAGE = join(RUN_DIR, "triage.json");
const PLAN = join(RUN_DIR, "plan.md");

// Dry-run short-circuit: agent steps skipped Claude, so triage.json / plan.md
// won't exist. Print the would-be dispatch shape (work_type unknown) and exit 0.
if (process.env.__MUNCHKINS_OPT_dryRun === "true") {
  console.log(
    "[director] dispatch (dry-run): would dispatch child munchkin based on triage.json work_type (skipped — agent steps not invoked)",
  );
  process.exit(0);
}

// Upstream-idle guard: if any upstream artifact says idle, exit 0.
const idleRe = /"idle"\s*:\s*true/;
if (existsSync(TRIAGE) && idleRe.test(readFileSync(TRIAGE, "utf-8"))) {
  console.log("[director] dispatch: triage idle — nothing to do");
  process.exit(0);
}
if (existsSync(PLAN)) {
  const head = readFileSync(PLAN, "utf-8").split("\n").slice(0, 5).join("\n");
  if (idleRe.test(head)) {
    console.log("[director] dispatch: plan idle — nothing to do");
    process.exit(0);
  }
}

if (!existsSync(TRIAGE) || !existsSync(PLAN)) {
  console.error(`[director] dispatch: missing triage.json or plan.md in ${RUN_DIR}`);
  process.exit(1);
}

const triage = JSON.parse(readFileSync(TRIAGE, "utf-8")) as { work_type?: string };
const workType = String(triage.work_type ?? "");

// Phase 1 mapping; `performance` is replaced by its own agent in Phase 2.
const TARGET_BY_WORK_TYPE: Record<string, string> = {
  feature: "feat-small",
  "bug-fix": "bug-fix",
  refactor: "refactor",
  performance: "refactor",
};

const target = TARGET_BY_WORK_TYPE[workType];
if (!target) {
  console.error(`[director] dispatch: unknown work_type "${workType}" in ${TRIAGE}`);
  process.exit(1);
}

const cmd = [
  "bun",
  "run",
  "munchkins",
  target,
  `--user-message=${PLAN}`,
  "--branch-prefix=director",
];

console.log(`[director] dispatch: ${cmd.join(" ")}`);
const proc = Bun.spawn(cmd, { cwd: REPO, stdout: "inherit", stderr: "inherit" });
process.exit(await proc.exited);
