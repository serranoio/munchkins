#!/usr/bin/env bun
// Step 2 — Repo-survey. Captures `git log`, `gh pr list`, lint/typecheck status
// into a markdown brief the triage step reads alongside PURPOSE.md.
//
// Gates the rest of the pipeline on PURPOSE.md being present at the repo root.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const WORKDIR = process.env.WORKTREE ?? process.cwd();
const REPO = process.env.REPO_ROOT ?? WORKDIR;

if (!existsSync(join(REPO, "PURPOSE.md"))) {
  console.error(
    "PURPOSE.md not found at repo root. The director requires a written north star. See docs/pages/agents/director.md.",
  );
  process.exit(1);
}

let RUN_ID = "";
try {
  RUN_ID = readFileSync(join(WORKDIR, ".director", "current"), "utf-8").trim();
} catch {
  // fall through to the empty-id guard below
}
if (!RUN_ID) {
  console.error("[director] repo-survey: .director/current missing — did inflight-survey run?");
  process.exit(1);
}

const RUN_DIR = join(WORKDIR, ".director", RUN_ID);
mkdirSync(RUN_DIR, { recursive: true });
const OUT = join(RUN_DIR, "survey.md");

const lines: string[] = [];

lines.push(`# Director repo survey — ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`);
lines.push("");

lines.push("## Recent commits (`git log --oneline -30`)");
lines.push("");
lines.push("```");
const logResult = await $`git -C ${REPO} log --oneline -30`.nothrow().quiet();
lines.push((logResult.stdout.toString() + logResult.stderr.toString()).trimEnd());
lines.push("```");
lines.push("");

lines.push("## Open PRs (`gh pr list`)");
lines.push("");
const ghCheck = await $`command -v gh`.nothrow().quiet();
if (ghCheck.exitCode === 0) {
  lines.push("```");
  const prResult = await $`gh pr list --limit 30`.cwd(REPO).nothrow().quiet();
  const text = (prResult.stdout.toString() + prResult.stderr.toString()).trimEnd();
  lines.push(text.length > 0 ? text : "(gh pr list failed — likely unauthenticated)");
  lines.push("```");
} else {
  lines.push("(`gh` not on PATH — open PRs unknown)");
}
lines.push("");

lines.push("## Lint status (`bun run lint`)");
lines.push("");
const lintResult = await $`bun run lint`.cwd(REPO).nothrow().quiet();
lines.push(lintResult.exitCode === 0 ? "PASS" : "FAIL");
lines.push("");

lines.push("## Typecheck status (`bun run typecheck`)");
lines.push("");
const typecheckResult = await $`bun run typecheck`.cwd(REPO).nothrow().quiet();
lines.push(typecheckResult.exitCode === 0 ? "PASS" : "FAIL");

writeFileSync(OUT, `${lines.join("\n")}\n`);

console.log(`[director] repo-survey wrote ${OUT}`);
