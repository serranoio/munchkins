# feat-small: bug-fix flow scenario coverage for todo entry #1

`docs/pages/internal/plans/todo.md` entry #1 ("Validate the bug-fix flow end-to-end") lists four acceptance bullets. Each must be exercised by a scenario test that drives the `bug-fix` agent via `registry.get("bug-fix")` and asserts the post-conditions named in the bullet. Three existing scenarios already drive the bug-fix agent and need targeted assertion additions; one new scenario is required to cover the `--integrate=pr` path. When all four scenarios pass, mark the four checkboxes in `todo.md` entry #1 as `[x]`.

This is scenario-layer coverage, not unit-layer. `packages/munchkins-core/src/integrate.test.ts` already covers the `integratePR` primitive directly — these tests are complementary and exercise the **bug-fix agent end-to-end**.

## Target file(s)

- `scenarios/index.ts` — extend
- `scenarios/dirty-main-e2e.ts` — extend (the snapshot-author assertion may already be present at line ~231; if so, leave it)
- `scenarios/resume-after-claude-exit-e2e.ts` — extend
- `scenarios/bugfix-pr-integrate-e2e.ts` — create new
- `scenarios/lib/fake-gh-bin/gh` — create new (executable shim)
- `package.json` — add the new scenario to the `scenario` script
- `docs/pages/internal/plans/todo.md` — check all four boxes in entry #1 once the new + extended scenarios all pass `bun run scenario`

## What to change

### 1. `scenarios/index.ts` — assert `docs(changelog):` HEAD commit

Inside `assertHappyPathCleanup`, after the existing marker-file loop and before `return undefined`, add:

```ts
// The summary-writer phase commits `docs(changelog): <message>` after the
// agent's work commits but before the integrate ff-merge. A successful merge
// integration leaves that commit at the top of main.
const headSubject = (await $`git log -1 --format=%s main`.cwd(repoRoot).quiet()).text().trim();
if (!headSubject.startsWith("docs(changelog):")) {
  return `expected HEAD of main to be a docs(changelog) commit; got: ${JSON.stringify(headSubject)}`;
}
```

Confirmed against `packages/munchkins-core/src/builder/agent-builder.ts:601` — the literal prefix is `docs(changelog):`.

### 2. `scenarios/dirty-main-e2e.ts` — assert snapshot author is `munchkins`

Inside `runVariant`, after `const snapshotSha = snapshots[0];` and before the `dirtyFiles` loop, add:

```ts
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
```

Confirmed against `packages/munchkins-core/src/integrate.ts:433` — snapshot commits are authored as `munchkins` via `-c user.name=munchkins -c user.email=munchkins@local`.

**Note:** This assertion may already exist (it survived a previous attempt). If `git log -1 --format=%an` against the snapshot sha already appears in the file, leave it alone.

### 3. `scenarios/resume-after-claude-exit-e2e.ts` — invoke the `resume --list` CLI

The current scenario calls `listResumableRuns()` programmatically. The todo bullet specifically names `munchkins resume --list`, so we must also exercise the CLI surface. After the existing `listResumableRuns` check (assertion 10) and before the `// ── Phase 2 ──` comment, insert a subprocess invocation of `bun .../munchkins/src/index.ts resume --list`:

```ts
const listProc = Bun.spawn(["bun", munchkinsBin, "resume", "--list"], {
  cwd: sandbox.path,
  env: { ...process.env, MUNCHKINS_RUN_LOG_DIR: artifactDir },
  stdout: "pipe",
  stderr: "pipe",
});
const listExit = await listProc.exited;
const listStdout = await new Response(listProc.stdout).text();
const listStderr = await new Response(listProc.stderr).text();
if (listExit !== 0) {
  return failResult(
    "execution",
    `resume --list subprocess exited ${listExit}\n--- stdout ---\n${listStdout}\n--- stderr ---\n${listStderr}`,
  );
}
if (!listStdout.includes(stateAfterPhase1.runId)) {
  return failResult(
    "assertion",
    `expected \`resume --list\` stdout to include runId ${stateAfterPhase1.runId}; got:\n${listStdout}`,
  );
}
```

Confirmed against `packages/munchkins-core/src/resume/command.ts:9` — `--list` is the registered flag.

### 4. `scenarios/lib/fake-gh-bin/gh` — new captured-invocation shim

Bun script that logs every invocation to `FAKE_GH_LOG_FILE` (one JSON object per line) and prints a fake PR URL for `pr create`. Make it executable (`chmod 0o755`). Pattern mirrors the existing `scenarios/lib/fake-claude-bin/claude` shim — same shebang style (`#!/usr/bin/env bun`).

```ts
#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const logFile = process.env.FAKE_GH_LOG_FILE;
if (!logFile) {
  process.stderr.write("fake-gh: FAKE_GH_LOG_FILE must be set\n");
  process.exit(2);
}

const argv = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  const tok = argv[i];
  if (tok.startsWith("--")) {
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[tok.slice(2)] = next;
      i++;
    } else {
      flags[tok.slice(2)] = "";
    }
  }
}

appendFileSync(logFile, `${JSON.stringify({ argv, flags })}\n`);

const counterFile = `${logFile}.counter`;
let n = 1;
try {
  n = Number(readFileSync(counterFile, "utf-8")) + 1;
} catch {
  // first call
}
writeFileSync(counterFile, String(n));

if (argv[0] === "pr" && argv[1] === "create") {
  process.stdout.write(`https://github.com/fake/fake/pull/${n}\n`);
}
process.exit(0);
```

### 5. `scenarios/bugfix-pr-integrate-e2e.ts` — new scenario

Drives the bug-fix agent with `__MUNCHKINS_OPT_integrate = "pr"`. Reuses the `bugfix-agent-e2e` fixtures (seed-repo + mock-claude-responses). Stands up a bare git repo as `origin` so `git push -u origin <branch>` succeeds locally. Stubs `gh` via the shim from step 4.

Asserts:
- `agent.run()` succeeded
- Audit guard saw zero real `claude` invocations
- `gh pr create` was invoked once with `--base main`, `--title <X>`, `--body <Y>`
- The body contains `**Goal:**` (the marker present in the summary-writer fixture's markdown — see `scenarios/fixtures/bugfix-agent-e2e/mock-claude-responses/03-summary-writer.json`)
- Local `main` did not advance (PR strategy never ff-merges)
- The bare remote received an `agent/*` branch; its tip subject starts with `docs(changelog):`
- Worktree teardown: no `.worktrees/` entries, no `agent/*` local branches

Implementation outline (full file should follow the shape of `scenarios/dirty-main-e2e.ts`):

```ts
#!/usr/bin/env bun
import { mock } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { configureMock, getClaudeAttempts, getMockCallLog, setupAuditGuard, spawnClaudeMock } from "./lib/mock-spawn-claude.js";
import { printResult, type ScenarioResult } from "./lib/result.js";
import { createSandbox } from "./lib/sandbox.js";

// SCENARIO_ID = "bugfix-pr-integrate-e2e"
// HARNESS_VERSION = "0.2.0"
// Reuse fixtures from bugfix-agent-e2e — same agent, same mocked pipeline,
// only the integration strategy differs.

// setupAuditGuard(); configureMock(responsesDir);
// mock.module(spawnClaudeAbsPath, () => ({ spawnClaude: spawnClaudeMock }));
// process.env.MUNCHKINS_RUN_LOG_DIR = artifactDir;

// In run():
//   1. chmodSync(<shimDir>/gh, 0o755) — preserve +x for fresh-clone runs
//   2. const sandbox = await createSandbox(seedRepoDir)
//   3. Install bug-fix SKILL.md into sandbox/.claude/skills/munchkins-bug-fix/
//   4. git init --bare <sandbox>/.fake-remote.git
//   5. git remote add origin <bareDir> inside sandbox
//   6. Capture mainBefore = git rev-parse main
//   7. process.env.PATH = `${shimDir}:${originalPath}`
//   8. process.env.FAKE_GH_LOG_FILE = join(artifactDir, "gh.log")
//   9. process.env.__MUNCHKINS_OPT_integrate = "pr"
//  10. process.env.__MUNCHKINS_OPT_userMessage = join(sandbox.path, "bug.md")
//  11. process.chdir(sandbox.path)
//  12. await import("@serranolabs.io/munchkins"); registry.get("bug-fix")
//  13. agent.run() — must succeed
//  14. Assertions (see list above)
//  15. In finally{}, restore PATH and clear FAKE_GH_LOG_FILE / __MUNCHKINS_OPT_integrate.

// Bare-remote query helpers: prefer `.cwd(bareRemoteDir)` over `-C ${dir}`;
// e.g. `await $\`git log -1 --format=%s ${branchRef}\`.cwd(bareRemoteDir).quiet()`.
```

The `Bun.$` PATH-caching issue documented in `718cb60`'s commit message no longer matters here — `integrate.ts`'s `createGithubPR` was refactored to `Bun.spawnSync` with explicit `env: { ...process.env }`, so the shim is discovered correctly.

### 6. `package.json` — register the new scenario

Extend the `scenario` script. Final line:

```
"scenario": "bun run scenarios/index.ts && bun run scenarios/composition.ts && bun run scenarios/resume-after-claude-exit-e2e.ts && bun run scenarios/director-multi-dispatch-e2e.ts && bun run scenarios/agent-uncommitted-smoke-e2e.ts && bun run scenarios/dirty-main-e2e.ts && bun run scenarios/bugfix-pr-integrate-e2e.ts"
```

### 7. `docs/pages/internal/plans/todo.md` — check the four boxes

After `bun run scenario` passes end-to-end, change the four bullets under section `## 1. Validate the bug-fix flow end-to-end` from `- [ ]` to `- [x]`.

## Constraints

1. No agent unit tests — these are scenario-layer tests in `scenarios/*.ts`. Do not add anything under `*/__tests__/` or `*-agent.test.ts`.
2. All four scenarios must use mocked `spawnClaude` via `mock.module(spawnClaudeAbsPath, ...)` plus the audit guard from `scenarios/lib/mock-spawn-claude.ts`. Zero real Claude invocations.
3. The PR scenario must not hit the GitHub network. The `gh` shim + bare-repo `origin` covers both directions.
4. Restore `process.env.PATH` and `process.env.__MUNCHKINS_OPT_integrate` in a `finally{}` block in the PR scenario — leaking these into the same-process scenario harness would break downstream scenarios if a future change ever runs them in-process.
5. `bun run scenario` must pass end-to-end before flipping the checkboxes in `todo.md`.
6. Do not modify `scenarios/lib/mock-spawn-claude.ts`, `scenarios/lib/sandbox.ts`, or `scenarios/lib/result.ts` — they are stable, reused infrastructure.

## Acceptance criteria

- `bun run scenarios/index.ts` passes (existing scenario + new HEAD-commit assertion).
- `bun run scenarios/dirty-main-e2e.ts` passes (existing scenario + author-is-munchkins assertion).
- `bun run scenarios/resume-after-claude-exit-e2e.ts` passes (existing scenario + `resume --list` subprocess block).
- `bun run scenarios/bugfix-pr-integrate-e2e.ts` passes (new scenario, all assertions listed above).
- `bun run scenario` passes top-to-bottom (covers all six existing scenarios + the new one).
- `bun run lint` and `bun run typecheck` pass.
- `docs/pages/internal/plans/todo.md` entry #1's four bullets are `- [x]`.

## Out of scope

- Director scenarios / entry #2 — leave `scenarios/director-multi-dispatch-e2e.ts` alone except for whatever cleanup the agent's auto-refactor pass touches.
- Entries #3, #4, #5 in `todo.md` — do NOT check those boxes.
- Refactoring `integrate.ts`, `agent-builder.ts`, or any other framework code. The scenarios should observe existing behavior, not change it.
- The `--branch-prefix=director` PR variant (that's todo entry #3's bullet 3).
- Onboarding / fresh-clone validation (todo entry #5).
- Changing the existing `gh`/`glab` resolution logic in `integrate.ts`.
- Adding documentation pages or changelog entries beyond the todo.md checkbox flip.
