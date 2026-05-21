#!/usr/bin/env bun
// Step 1 — Inflight-survey. Inventories all director-spawned work currently
// in flight: open director/* PRs (when `gh` is available + authed), local
// director/* branches, and director-namespaced worktrees.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKDIR = process.env.WORKTREE ?? process.cwd();
const DIRECTOR_ROOT = join(WORKDIR, ".director");

// Derive a stable, sortable run id and remember it for downstream steps.
const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const ts =
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
  `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
const RUN_ID = `${ts}-${Math.floor(Math.random() * 32768)}${Math.floor(Math.random() * 32768)}`;
const RUN_DIR = join(DIRECTOR_ROOT, RUN_ID);
mkdirSync(RUN_DIR, { recursive: true });
writeFileSync(join(DIRECTOR_ROOT, "current"), RUN_ID);

const OUT = join(RUN_DIR, "inflight.json");

async function captureStdout(cmd: string[]): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

// Branch inventory (always available).
const branchResult = await captureStdout([
  "git",
  "-C",
  WORKDIR,
  "branch",
  "--list",
  "director/*",
  "--format=%(refname:short)",
]);
const branches = branchResult.stdout
  .split("\n")
  .map((b) => b.trim())
  .filter((b) => b.length > 0);

// Worktree inventory (filter porcelain output for director-namespaced branches).
const worktrees: { path: string; branch: string }[] = [];
const wtResult = await captureStdout(["git", "-C", WORKDIR, "worktree", "list", "--porcelain"]);
if (wtResult.exitCode === 0) {
  let currentPath = "";
  for (const line of wtResult.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/director/")) {
      worktrees.push({ path: currentPath, branch: line.slice("branch refs/heads/".length) });
    } else if (line === "") {
      currentPath = "";
    }
  }
}

// Open PRs against director/* heads. Best-effort: skip silently if `gh` is
// missing or unauthenticated — the local inventory is still useful.
let prs: unknown = [];
const ghCheck = await captureStdout(["sh", "-c", "command -v gh"]);
if (ghCheck.exitCode === 0) {
  const prResult = await captureStdout([
    "gh",
    "pr",
    "list",
    "--head",
    "director/*",
    "--state",
    "open",
    "--json",
    "number,title,headRefName,files",
  ]);
  if (prResult.exitCode === 0) {
    try {
      prs = JSON.parse(prResult.stdout);
    } catch {
      prs = [];
    }
  }
}

writeFileSync(OUT, `${JSON.stringify({ branches, worktrees, prs }, null, 2)}\n`);

console.log(`[director] inflight-survey wrote ${OUT} (run-id=${RUN_ID})`);
