import { $ } from "bun";
import type { AgentCLI } from "./builder/agent-cli.js";

const MERGE_FIXER_SYSTEM_PROMPT = `You are a merge conflict resolver running inside a git rebase.

The repository is in the middle of a \`git rebase\` from a feature branch onto \`main\`. One or more files contain conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`). Your job is to edit each file in place so that:

1. All conflict markers are removed.
2. The result preserves the **intent of both sides** of the conflict. The branch side did the feature work; the main side moved underneath. Don't drop work from either side unless the conflict is genuinely contradictory.
3. The resulting code compiles, type-checks, and passes any existing tests. The harness will run the project's checks after you finish; if they fail, you'll be invoked again with the failure output.

What you must NOT do:

- Do **not** run \`git add\`, \`git commit\`, \`git rebase --continue\`, or any other git command. The harness handles git state.
- Do **not** create new files or move files. Only edit the conflicted ones in place.
- Do **not** narrate or summarize. Just edit the files.

The user prompt names the conflicted files and includes the original goal of the run for context.
`;

const FIXER_DISALLOWED_TOOLS = ["Bash"];

export interface IntegrateOptions {
  /** Directory where `branch` is checked out. May be a worktree or any other checkout. */
  workdir: string;
  branch: string;
  repoRoot: string;
  baseBranch: string;
  /** Original goal text from the user-message; surfaces in the fixer's user prompt. */
  originalGoal: string;
  /** Spawn callback — caller passes in their AgentCLI so we don't import the registry. */
  cli: AgentCLI;
  /** Deterministic checks to re-run after a fixer iteration; usually DEFAULT_CHECKS. */
  postFixChecks: string[];
  /** Cap on fixer iterations across the entire integration. Default 3. */
  maxFixerIter?: number;
  /** Hook for the run-log to capture each fixer invocation. */
  onFixerInvocation?: (info: {
    iter: number;
    systemPrompt: string;
    userPrompt: string;
    response: string;
    exitCode: number;
    durationMs: number;
  }) => void;
  /** Hook for narrating progress to the operator. */
  log?: (line: string) => void;
}

export type IntegrateResult =
  | { ok: true; fixerIters: number }
  | { ok: false; reason: string; fixerIters: number };

/**
 * Rebase `branch` onto `baseBranch` inside `workdir`, optionally invoking the
 * fixer to resolve conflicts, then fast-forward `baseBranch` to the rebased tip
 * inside `repoRoot`.
 *
 * `workdir` and `repoRoot` are the same git repository in two checkouts —
 * usually a worktree (workdir) and the main checkout (repoRoot), but any pair
 * works as long as `repoRoot` has `baseBranch` checked out and `workdir` has
 * `branch` checked out. Pass `workdir === repoRoot` only when you do not need
 * the ff-merge step (TODO: a future flag will let callers skip step 3).
 *
 * Contract: on success, `workdir` is clean and `baseBranch` in `repoRoot`
 * points at the rebased tip. On failure, the rebase is aborted and the workdir
 * is left at its pre-rebase state for the operator to inspect.
 */
export async function integrateBranch(opts: IntegrateOptions): Promise<IntegrateResult> {
  const {
    workdir,
    branch,
    repoRoot,
    baseBranch,
    originalGoal,
    cli,
    postFixChecks,
    maxFixerIter = 3,
    onFixerInvocation,
    log,
  } = opts;

  const say = (line: string) => log?.(line);

  // Step 1: rebase
  say(`integrate: rebase onto ${baseBranch}`);
  let rebase = await $`git rebase ${baseBranch}`.cwd(workdir).nothrow().quiet();

  let fixerIters = 0;

  while (rebase.exitCode !== 0) {
    const conflicted = await listConflictedFiles(workdir);

    if (conflicted.length === 0) {
      // Rebase failed for a non-conflict reason (e.g. dirty worktree, broken HEAD)
      await abortRebase(workdir);
      return {
        ok: false,
        reason: `rebase failed without conflict markers: ${rebase.stderr.toString().slice(-1000)}`,
        fixerIters,
      };
    }

    if (fixerIters >= maxFixerIter) {
      await abortRebase(workdir);
      return {
        ok: false,
        reason: `merge-fixer exhausted ${maxFixerIter} iterations; conflicted: ${conflicted.join(", ")}`,
        fixerIters,
      };
    }

    fixerIters++;
    say(`integrate: fixer iter ${fixerIters}/${maxFixerIter} on ${conflicted.length} file(s)`);

    const userPrompt = buildFixerUserPrompt(originalGoal, conflicted);
    const startTime = Date.now();
    const r = await cli.spawn({
      systemPrompt: MERGE_FIXER_SYSTEM_PROMPT,
      userPrompt,
      cwd: workdir,
      disallowedTools: FIXER_DISALLOWED_TOOLS,
    });
    const durationMs = Date.now() - startTime;
    onFixerInvocation?.({
      iter: fixerIters,
      systemPrompt: MERGE_FIXER_SYSTEM_PROMPT,
      userPrompt,
      response: r.output,
      exitCode: r.exitCode,
      durationMs,
    });

    if (r.exitCode !== 0) {
      await abortRebase(workdir);
      return {
        ok: false,
        reason: `merge-fixer CLI exited ${r.exitCode}`,
        fixerIters,
      };
    }

    // The fixer should have removed conflict markers but not staged or committed.
    // Stage all edits and ask git to continue.
    const stillConflicted = await listConflictedFiles(workdir);
    if (stillConflicted.length === conflicted.length) {
      // Fixer didn't actually do anything; bail rather than spin
      await abortRebase(workdir);
      return {
        ok: false,
        reason: `merge-fixer produced no changes; still conflicted: ${stillConflicted.join(", ")}`,
        fixerIters,
      };
    }

    await $`git add -A`.cwd(workdir).quiet();
    rebase = await $`git rebase --continue`
      .cwd(workdir)
      .env({ ...process.env, GIT_EDITOR: "true" })
      .nothrow()
      .quiet();
  }

  // Step 2: post-rebase verification — only if we touched things
  if (fixerIters > 0 && postFixChecks.length > 0) {
    say(`integrate: re-running ${postFixChecks.length} check(s) after fixer`);
    for (const cmd of postFixChecks) {
      const c = await $`${{ raw: cmd }}`.cwd(workdir).nothrow().quiet();
      if (c.exitCode !== 0) {
        return {
          ok: false,
          reason: `post-rebase check failed: ${cmd}\n${c.stderr.toString().slice(-1000)}`,
          fixerIters,
        };
      }
    }
  }

  // Step 3: fast-forward main onto the rebased tip
  say(`integrate: fast-forward ${baseBranch} -> ${branch}`);
  const ff = await $`git merge --ff-only ${branch}`.cwd(repoRoot).nothrow().quiet();
  if (ff.exitCode !== 0) {
    return {
      ok: false,
      reason: `ff-merge failed despite clean rebase: ${ff.stderr.toString().slice(-500)}`,
      fixerIters,
    };
  }

  return { ok: true, fixerIters };
}

async function listConflictedFiles(cwd: string): Promise<string[]> {
  const r = await $`git diff --name-only --diff-filter=U`.cwd(cwd).nothrow().quiet();
  return r
    .text()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function abortRebase(cwd: string): Promise<void> {
  await $`git rebase --abort`.cwd(cwd).nothrow().quiet();
}

function buildFixerUserPrompt(originalGoal: string, conflicted: string[]): string {
  return [
    "## Original goal",
    originalGoal.trim() || "(no user message)",
    "",
    "## Conflicted files",
    "These files contain `<<<<<<<` / `=======` / `>>>>>>>` markers. Edit them in place to resolve the conflicts. Do not stage, commit, or run any git command — the harness handles git state.",
    "",
    ...conflicted.map((f) => `- ${f}`),
  ].join("\n");
}
