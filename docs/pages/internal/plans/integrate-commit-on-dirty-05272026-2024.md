# Feature: integrateBranch commits dirty repoRoot instead of hard-failing

Two commits ago (`be81fd5`) the snapshot mechanism was ripped out and
`integrateBranch` now hard-fails when `repoRoot` is dirty. Reverse that
policy: a dirty `repoRoot` should NOT block autonomous merging. Instead,
the framework should commit the operator's dirty content as a real
first-class commit on `main` with a clean templated subject, then rebase
the agent's branch onto the new `main` tip, then squash-merge as today.

The old snapshot approach polluted history with synthetic
`munchkins: pre-merge snapshot of dirty repoRoot @ <ts>` commits. The
fix: same flow (commit, rebase, squash), but with a humane subject the
operator can recognize and amend if they want.

## User-facing change

Running any default agent against a dirty `repoRoot` no longer aborts.
The dirty content lands on `main` as a real WIP commit (subject:
`wip(operator): changes captured before <agent>/<slug>`), and the
agent's squash-merge lands on top. Operator recovery is a normal
`git log` / `git commit --amend` / `git reset` workflow — no synthetic
prefixes to grep for.

## Target file(s)

- `packages/munchkins/src/integrate.ts` — replace the hard-fail path
  with a commit-on-dirty path. Reference the deleted
  `snapshotDirtyRepoRoot` function in commit `be81fd5^` for the
  mechanics (stage + commit), but produce a different commit subject
  and do NOT export a `SNAPSHOT_MSG_PREFIX` (no recovery-grep hook
  needed — the WIP commit is a normal commit).
- `packages/munchkins/src/integrate.test.ts` — replace the three
  reject-on-dirty tests added in `be81fd5` with new commit-on-dirty
  tests asserting the templated subject + post-condition history shape.
- `packages/munchkins/package.json` — bump version `0.3.0` → `0.4.0`.
- `docs/pages/changelog.md` — add an entry under the most-recent block.
- `scenarios/` — add `scenarios/dirty-main-commit-e2e.ts` (new). It
  seeds a sandbox with dirty tracked + untracked content, drives the
  registered `bug-fix` agent (cheapest known-good fixture pipeline,
  reusing `scenarios/fixtures/bugfix-agent-e2e/`), and asserts the
  post-integrate history is `<agent squash> ⟶ <operator wip> ⟶ <seed>`.
  Wire it into the `scenario` script in root `package.json` next to the
  other e2e scenarios.

## What to add

1. In `integrate.ts`, add a private function with this contract:

   ```ts
   async function commitDirtyRepoRoot(opts: IntegrateOptions): Promise<IntegrateResult | undefined>
   ```

   Behavior:
   - Detect dirty content using the same exclusion as today:
     `git status --porcelain -- . ':!.worktrees'`.
   - If clean, return `undefined` (caller proceeds unchanged).
   - If dirty:
     - `git add -A -- . ':!.worktrees'`
     - Build subject. The agent/slug should be passed in via a new
       optional field on `IntegrateOptions`:
       ```ts
       /** When set, used to build the operator-WIP subject as
        *  `wip(operator): changes captured before <agent>/<slug>`.
        *  When absent, falls back to `wip(operator): changes captured
        *  before <branch>`. */
       operatorWipContext?: { agent: string; slug: string };
       ```
     - Commit with `git -c user.name=munchkins -c user.email=munchkins@local commit -m "<subject>"`.
     - Return `undefined` on success; `{ ok: false, reason, fixerIters: 0 }`
       on stage/commit failure.
   - Wire the agent-builder call site in
     `packages/munchkins/src/builder/agent-builder.ts` (or wherever
     `integrateBranch` is invoked — verify before editing) to populate
     `operatorWipContext` from the agent's name + slug.

2. In `integrateBranch` (around line 219 today, the spot the dirty-tree
   hard-fail lives), replace the `return { ok: false, reason: ... }`
   block with `await commitDirtyRepoRoot(opts)`; bubble the failure
   result through if non-undefined.

3. The existing rebase + squash path is unchanged. After the WIP
   commit lands on `main`, the next call (`rebaseAndResolve`) picks
   up the new tip naturally — verify no hardcoded SHA snapshots
   captured before commit-on-dirty.

4. In `integrate.test.ts`, replace the 3 reject-on-dirty tests with
   3 commit-on-dirty tests:
   - **D1**: dirty tracked file → after integrate, the operator
     commit's subject matches the templated form, `HEAD^` is that
     commit, `HEAD` is the agent squash.
   - **D2**: dirty untracked file → same post-condition; verify the
     untracked file is now tracked at the operator commit.
   - **D3**: dirty `.worktrees/` content → the exclusion still
     applies; no operator commit is created, integrate proceeds as
     if clean.

5. In `dirty-main-commit-e2e.ts`, mirror `scenarios/index.ts` (the
   bug-fix Lights out reference). Differences:
   - Before invoking `agent.run()`, write a dirty tracked-file edit
     and a dirty untracked file into the sandbox at `repoRoot`.
   - After `agent.run()` succeeds, assert:
     - `git log -1 --format=%s main` is the agent's squash subject
     - `git log -2 --format=%s main` second line matches
       `wip(operator): changes captured before bug-fix/.*`
     - the previously-untracked path is present on `main` after
       integration

## Constraints

1. Do NOT reintroduce `SNAPSHOT_MSG_PREFIX` or any prefix-based
   recovery API. The WIP commit is a normal commit; recovery uses
   normal git workflows.
2. Do NOT auto-stash + auto-restore — that was option (1) and the
   user explicitly chose option (A): commit on main.
3. The `.worktrees/` pathspec exclusion from `be81fd5` is preserved.
4. Do NOT introduce a separate side-branch or tag. Just the commit
   on `main`.
5. No new dependencies.
6. Zero real `claude`/`gh` calls in tests + scenarios — `setupAuditGuard()`
   must pass.

## Acceptance criteria

- `bun scenarios/dirty-main-commit-e2e.ts` exits 0 from a clean tree
  and asserts the templated WIP commit + history shape described above.
- `bun packages/munchkins/src/integrate.test.ts` exits 0 with the 3
  new D1/D2/D3 tests passing.
- `bun run scenario` exits 0 (the existing scenarios are unaffected —
  none of them set a dirty pre-integrate state).
- `bun run lint` and `bun run typecheck` pass.
- `packages/munchkins/package.json` version is `0.4.0`.
- Changelog has a new entry under the most-recent block.
- The recent 3 snapshot commits on `main` (`64df20c`, `23801d2`,
  `f917e84`) remain untouched — this slice does not rewrite history.

## Out of scope

- Cleaning up the 3 existing `munchkins: pre-merge snapshot of dirty
  repoRoot @` commits sitting in `main` history. Separate slice if the
  user wants them gone (would require a destructive rebase).
- LLM-generated commit messages (option B from the design conversation).
- Tagging the WIP commit (option C).
- Including diff-stat in the commit body (option D).
- Doing the rebase + squash-merge in an ephemeral worktree so the
  operator's working tree is never touched (the earlier "Option 2").
  That's a bigger refactor; this slice picks the operator-commit path
  the user asked for and keeps the rest of `integrate.ts` shape.
- Backend parity (PURPOSE #4), fixer-cap (PURPOSE #5), refactor's
  yet-unwritten Lights out scenario coverage — all separate slices.
