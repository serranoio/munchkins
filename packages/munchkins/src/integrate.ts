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

export interface RebaseAndResolveOptions {
  /** Directory where the branch to rebase is currently checked out. Any git checkout works — worktree, clone, bind-mount, etc. */
  workdir: string;
  /** Branch to rebase onto. Resolved inside `workdir`. */
  baseBranch: string;
  /** Original goal text from the user-message; surfaces in the fixer's user prompt. */
  originalGoal: string;
  /** Spawn callback — caller passes in their AgentCLI so we don't import the registry. */
  cli: AgentCLI;
  /** Deterministic checks to re-run after a fixer iteration; usually DEFAULT_CHECKS. */
  postFixChecks: string[];
  /** Cap on fixer iterations across the entire rebase. Default 3. */
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

export type RebaseAndResolveResult =
  | { ok: true; fixerIters: number }
  | { ok: false; reason: string; fixerIters: number };

/**
 * Rebase the current branch in `workdir` onto `baseBranch`, invoking the
 * merge-fixer LLM to resolve any conflicts up to `maxFixerIter` times, and
 * re-running `postFixChecks` after the fixer touches things.
 *
 * Sandbox-agnostic: this primitive only requires a single git checkout where
 * the branch to rebase is currently HEAD. It does not land the branch
 * anywhere — that's `integrateBranch`'s job.
 *
 * Contract: on success, `workdir` is on the rebased tip with no conflict
 * markers and a clean working tree. On failure, the rebase is aborted and the
 * workdir is left at its pre-rebase state for the operator to inspect.
 */
export async function rebaseAndResolve(
  opts: RebaseAndResolveOptions,
): Promise<RebaseAndResolveResult> {
  const {
    workdir,
    baseBranch,
    originalGoal,
    cli,
    postFixChecks,
    maxFixerIter = 3,
    onFixerInvocation,
    log,
  } = opts;

  const say = (line: string) => log?.(line);
  const abortAndFail = async (reason: string): Promise<RebaseAndResolveResult> => {
    await abortRebase(workdir);
    return { ok: false, reason, fixerIters };
  };

  say(`rebase: onto ${baseBranch}`);
  // `-X theirs` resolves content conflicts in favor of the side being replayed
  // (the agent's commits). This matters when `integrateBranch` lands an
  // operator-WIP commit on `baseBranch` and the agent's work touches the same
  // lines — the agent should win on overlap. For clean rebases the flag is a
  // no-op.
  let rebase = await $`git rebase -X theirs ${baseBranch}`.cwd(workdir).nothrow().quiet();

  let fixerIters = 0;

  while (rebase.exitCode !== 0) {
    const conflicted = await listConflictedFiles(workdir);

    if (conflicted.length === 0) {
      return abortAndFail(
        `rebase failed without conflict markers: ${rebase.stderr.toString().slice(-1000)}`,
      );
    }

    if (fixerIters >= maxFixerIter) {
      return abortAndFail(
        `merge-fixer exhausted ${maxFixerIter} iterations; conflicted: ${conflicted.join(", ")}`,
      );
    }

    fixerIters++;
    say(`rebase: fixer iter ${fixerIters}/${maxFixerIter} on ${conflicted.length} file(s)`);

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
      return abortAndFail(`merge-fixer CLI exited ${r.exitCode}`);
    }

    // Detect leftover markers via working-tree content (`git diff --check`).
    // The previous index-based check was structurally broken: editing a file
    // doesn't remove its unmerged index entry, so the old check could never
    // observe the fixer's edits as progress.
    const stillMarked = new Set(await filesWithLeftoverMarkers(workdir));

    // Bail early if the fixer wrote markers to files outside the conflict set.
    const stray = [...stillMarked].filter((f) => !conflicted.includes(f));
    if (stray.length > 0) {
      return abortAndFail(
        `merge-fixer wrote markers to files outside the conflict set: ${stray.join(", ")}`,
      );
    }

    // Bail if the fixer made zero forward progress.
    if (stillMarked.size === conflicted.length) {
      return abortAndFail(
        `merge-fixer left markers in every conflicted file: ${[...stillMarked].join(", ")}`,
      );
    }

    // Stage only the files we've verified clean. Files still carrying markers
    // keep their unmerged index entries; `git rebase --continue` will fail and
    // the outer loop re-invokes the fixer on the remaining unresolved subset.
    for (const f of conflicted) {
      if (!stillMarked.has(f)) {
        await $`git add ${f}`.cwd(workdir).quiet();
      }
    }
    rebase = await $`git rebase --continue`
      .cwd(workdir)
      .env({ ...process.env, GIT_EDITOR: "true" })
      .nothrow()
      .quiet();
  }

  if (fixerIters > 0 && postFixChecks.length > 0) {
    say(`rebase: re-running ${postFixChecks.length} check(s) after fixer`);
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

  return { ok: true, fixerIters };
}

export interface IntegrateOptions extends RebaseAndResolveOptions {
  /** Branch to squash-merge into `baseBranch` after the rebase succeeds. */
  branch: string;
  /** Separate checkout of the same repo with `baseBranch` checked out. */
  repoRoot: string;
  /** Subject line for the squash commit. Falls back to `agent: <branch>` when absent. */
  commitMessage?: string;
  /** Body appended to the squash commit message. Omitted when absent. */
  markdownSummary?: string;
  /**
   * When set, used to build the operator-WIP subject as
   * `wip(operator): changes captured before <agent>/<slug>`. When absent,
   * falls back to `wip(operator): changes captured before <branch>`.
   */
  operatorWipContext?: { agent: string; slug: string };
}

export type IntegrateResult = RebaseAndResolveResult;

/**
 * `rebaseAndResolve` + squash-merge `baseBranch` to the rebased tip in
 * `repoRoot`. Use when you want the agent's branch to actually land on the
 * parent branch as a single commit (S1 / S3 use cases). For flows that just
 * need the rebase to happen — e.g. preparing a branch for a PR (S2 / S4) —
 * call `rebaseAndResolve` directly.
 *
 * `workdir` and `repoRoot` must be two checkouts of the same repository:
 * `workdir` has the branch to rebase, `repoRoot` has `baseBranch`. Worktrees
 * are the most ergonomic source of that pairing but any two-checkout setup
 * works.
 *
 * The squash commit is authored as `munchkins / munchkins@local`. Its subject
 * is `opts.commitMessage ?? "agent: <branch>"` and its body is
 * `opts.markdownSummary` (omitted when absent). Branch deletion is left to
 * the caller's `teardown` (which removes the worktree first, then force-deletes
 * the branch — a prerequisite since git refuses to delete a branch in use by a
 * worktree).
 */
export async function integrateBranch(opts: IntegrateOptions): Promise<IntegrateResult> {
  const wipResult = await commitDirtyRepoRoot(opts);
  if (wipResult) return wipResult;

  const r = await rebaseAndResolve(opts);
  if (!r.ok) return r;

  const subject = opts.commitMessage ?? `agent: ${opts.branch}`;
  const fullMessage = opts.markdownSummary ? `${subject}\n\n${opts.markdownSummary}` : subject;

  opts.log?.(`integrate: squash-merge ${opts.baseBranch} <- ${opts.branch}`);
  const squash = await $`git merge --squash ${opts.branch}`.cwd(opts.repoRoot).nothrow().quiet();
  if (squash.exitCode !== 0) {
    return {
      ok: false,
      reason: `squash merge failed despite clean rebase: ${squash.stderr.toString().slice(-500)}`,
      fixerIters: r.fixerIters,
    };
  }

  const squashCommit = await munchkinsCommit(opts.repoRoot, fullMessage);
  if (squashCommit.exitCode !== 0) {
    return {
      ok: false,
      reason: `squash commit failed: ${squashCommit.stderr.toString().slice(-500)}`,
      fixerIters: r.fixerIters,
    };
  }

  // Branch deletion is intentionally left to `sandboxHandle.teardown`: the
  // worktree is still attached to the branch at this point, and git refuses
  // to delete a branch that a worktree is sitting on. `teardown` removes the
  // worktree first, then calls `deleteBranch` (which uses `git branch -D`).

  return r;
}

/**
 * Run-layer integration strategy. Chosen by precedence:
 * operator CLI flag > author declaration > run-layer default (`integrateMerge`).
 */
export interface IntegrationContext {
  workdir: string;
  branch: string;
  repoRoot: string;
  baseBranch: string;
  cli: AgentCLI;
  postFixChecks: string[];
  originalGoal: string;
  /** Set by the summary writer when one ran — used as PR title. */
  commitMessage?: string;
  /** Set by the summary writer when one ran — used as PR body. */
  markdownSummary?: string;
  /** Threaded through to integrateBranch when the merge strategy commits operator-dirty content. */
  operatorWipContext?: { agent: string; slug: string };
  log?: (line: string) => void;
  onFixerInvocation?: (info: {
    iter: number;
    systemPrompt: string;
    userPrompt: string;
    response: string;
    exitCode: number;
    durationMs: number;
  }) => void;
}

export type IntegrationResult =
  | { ok: true; fixerIters: number; prUrl?: string }
  | { ok: false; reason: string; fixerIters: number };

export interface IntegrationStrategy {
  readonly kind: "merge" | "pr";
  run(ctx: IntegrationContext): Promise<IntegrationResult>;
}

export function integrateMerge(): IntegrationStrategy {
  return {
    kind: "merge",
    async run(ctx) {
      return integrateBranch({
        workdir: ctx.workdir,
        branch: ctx.branch,
        repoRoot: ctx.repoRoot,
        baseBranch: ctx.baseBranch,
        originalGoal: ctx.originalGoal,
        cli: ctx.cli,
        postFixChecks: ctx.postFixChecks,
        onFixerInvocation: ctx.onFixerInvocation,
        log: ctx.log,
        commitMessage: ctx.commitMessage,
        markdownSummary: ctx.markdownSummary,
        operatorWipContext: ctx.operatorWipContext,
      });
    },
  };
}

export interface IntegratePROptions {
  /** "auto" (default) detects from `git remote get-url $remote` containing "gitlab". */
  provider?: "auto" | "github" | "gitlab";
  /** Default "origin". */
  remote?: string;
}

export function integratePR(opts?: IntegratePROptions): IntegrationStrategy {
  const provider = opts?.provider ?? "auto";
  const remote = opts?.remote ?? "origin";
  return {
    kind: "pr",
    async run(ctx) {
      const resolvedProvider =
        provider === "auto" ? await detectProvider(ctx.repoRoot, remote) : provider;
      const cliName = resolvedProvider === "gitlab" ? "glab" : "gh";
      // Bun.which honors a per-call PATH so tests can scope availability without
      // mutating the global env Bun captured at shell init.
      const probe = Bun.which(cliName, { PATH: process.env.PATH ?? "" });
      if (!probe) {
        return {
          ok: false,
          reason: `${cliName} not installed or not on PATH; required for integratePR(provider=${resolvedProvider})`,
          fixerIters: 0,
        };
      }

      const r = await rebaseAndResolve({
        workdir: ctx.workdir,
        baseBranch: ctx.baseBranch,
        originalGoal: ctx.originalGoal,
        cli: ctx.cli,
        postFixChecks: ctx.postFixChecks,
        onFixerInvocation: ctx.onFixerInvocation,
        log: ctx.log,
      });
      if (!r.ok) return r;

      ctx.log?.(`pr: push ${ctx.branch} → ${remote}`);
      const push = await $`git push -u ${remote} ${ctx.branch}`.cwd(ctx.workdir).nothrow().quiet();
      if (push.exitCode !== 0) {
        return {
          ok: false,
          reason: `git push to ${remote} failed: ${push.stderr.toString().slice(-500)}`,
          fixerIters: r.fixerIters,
        };
      }

      const title = ctx.commitMessage ?? `agent: ${ctx.branch}`;
      const body = ctx.markdownSummary ?? "(no summary writer ran)";
      ctx.log?.(`pr: open via ${resolvedProvider} into ${ctx.baseBranch}`);
      const pr =
        resolvedProvider === "gitlab"
          ? await createGitlabMR(ctx.workdir, title, body, ctx.baseBranch)
          : await createGithubPR(ctx.workdir, title, body, ctx.baseBranch);

      if (!pr.ok) return { ok: false, reason: pr.reason, fixerIters: r.fixerIters };
      ctx.log?.(`pr: ${pr.url}`);
      return { ok: true, fixerIters: r.fixerIters, prUrl: pr.url };
    },
  };
}

export async function detectProvider(
  repoRoot: string,
  remote: string,
): Promise<"github" | "gitlab"> {
  const url = (await $`git remote get-url ${remote}`.cwd(repoRoot).nothrow().quiet()).text().trim();
  return url.toLowerCase().includes("gitlab") ? "gitlab" : "github";
}

type CreateResult = { ok: true; url: string } | { ok: false; reason: string };

function parseCreateResult(
  cliLabel: string,
  r: { exitCode: number | null; stdout: Uint8Array; stderr: Uint8Array },
): CreateResult {
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  if (r.exitCode !== 0) {
    return { ok: false, reason: `${cliLabel} failed: ${decode(r.stderr).slice(-500)}` };
  }
  const stdout = decode(r.stdout);
  return { ok: true, url: stdout.match(/https?:\/\/\S+/)?.[0] ?? stdout.trim() };
}

// `Bun.spawnSync` (not `$`) because Bun's shell resolves the `gh`/`glab`
// binary against a startup-cached PATH, ignoring later `process.env.PATH`
// mutations. Tests rely on prepending a stub directory to PATH at runtime, so
// the spawn call captures `{ ...process.env }` explicitly and Bun resolves the
// binary against the current PATH instead of the cached one.
async function createGithubPR(
  workdir: string,
  title: string,
  body: string,
  base: string,
): Promise<CreateResult> {
  const r = Bun.spawnSync(
    ["gh", "pr", "create", "--title", title, "--body", body, "--base", base],
    {
      cwd: workdir,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return parseCreateResult("gh pr create", r);
}

async function createGitlabMR(
  workdir: string,
  title: string,
  body: string,
  base: string,
): Promise<CreateResult> {
  const r = Bun.spawnSync(
    [
      "glab",
      "mr",
      "create",
      "--title",
      title,
      "--description",
      body,
      "--target-branch",
      base,
      "--yes",
    ],
    {
      cwd: workdir,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return parseCreateResult("glab mr create", r);
}

/**
 * If `repoRoot` has any dirty/staged/untracked content (excluding `.worktrees/`),
 * stage all of it and commit it on `baseBranch` as a first-class WIP commit
 * authored by the operator. Returns `undefined` when clean (caller proceeds with
 * the rebase + squash-merge path unchanged) or on successful commit. Returns
 * an `IntegrateResult` only on stage/commit failure.
 *
 * The WIP commit is a normal commit: operators recover via `git log` /
 * `git commit --amend` / `git reset`; no synthetic prefix to grep for.
 */
async function commitDirtyRepoRoot(opts: IntegrateOptions): Promise<IntegrateResult | undefined> {
  // Exclude the `.worktrees/` directory: worktrees live there by convention and
  // are not operator dirty content. Real consumer repos gitignore `.worktrees/`;
  // this pathspec exclusion covers repos (e.g. test fixtures) that do not.
  const dirty = (
    await $`git status --porcelain -- . ':!.worktrees'`.cwd(opts.repoRoot).quiet().nothrow()
  ).stdout
    .toString()
    .trim();
  if (!dirty) return undefined;

  // `.worktrees/` is gitignored in real consumer repos; pass `:!.worktrees` as
  // a pathspec exclusion only when it isn't already ignored. With both an exclude
  // pathspec AND a gitignore entry, git treats `.worktrees` as "explicitly named
  // but ignored" and fails the add. With neither, `git add -A` would slurp in
  // sub-worktree directories as gitlinks. `git check-ignore` picks the right
  // command for the operator's repo layout.
  const worktreesIgnored =
    (await $`git check-ignore .worktrees`.cwd(opts.repoRoot).nothrow().quiet()).exitCode === 0;
  const addResult = worktreesIgnored
    ? await $`git add -A`.cwd(opts.repoRoot).nothrow().quiet()
    : await $`git add -A -- . ':!.worktrees'`.cwd(opts.repoRoot).nothrow().quiet();
  if (addResult.exitCode !== 0) {
    return {
      ok: false,
      reason: `pre-merge stage failed: ${addResult.stderr.toString().slice(-500)}`,
      fixerIters: 0,
    };
  }

  const ctx = opts.operatorWipContext;
  const subject = ctx
    ? `wip(operator): changes captured before ${ctx.agent}/${ctx.slug}`
    : `wip(operator): changes captured before ${opts.branch}`;

  const commitResult = await munchkinsCommit(opts.repoRoot, subject);
  if (commitResult.exitCode !== 0) {
    return {
      ok: false,
      reason: `operator-WIP commit failed: ${commitResult.stderr.toString().slice(-500)}`,
      fixerIters: 0,
    };
  }

  opts.log?.(`integrate: repoRoot was dirty; committed operator WIP — "${subject}"`);
  return undefined;
}

async function listConflictedFiles(cwd: string): Promise<string[]> {
  const r = await $`git diff --name-only --diff-filter=U`.cwd(cwd).nothrow().quiet();
  return r
    .text()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function filesWithLeftoverMarkers(workdir: string): Promise<string[]> {
  const r = await $`git diff --check`.cwd(workdir).nothrow().quiet();
  if (r.exitCode === 0) return [];
  const files = new Set<string>();
  for (const line of r.text().split("\n")) {
    // git diff --check emits both whitespace and conflict-marker warnings;
    // filter to conflict markers so a stray trailing-whitespace warning
    // doesn't masquerade as a leftover marker.
    if (!line.includes("conflict marker")) continue;
    const colon = line.indexOf(":");
    if (colon > 0) files.add(line.slice(0, colon));
  }
  return [...files];
}

async function abortRebase(cwd: string): Promise<void> {
  await $`git rebase --abort`.cwd(cwd).nothrow().quiet();
}

// Single source of truth for the operator identity stamped on both the squash
// commit and the operator-WIP commit; keeps the long `-c user.name=…` config
// out of caller code and the two commit call sites in lockstep.
function munchkinsCommit(cwd: string, message: string) {
  return $`git -c user.name=munchkins -c user.email=munchkins@local commit -m ${message}`
    .cwd(cwd)
    .nothrow()
    .quiet();
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
