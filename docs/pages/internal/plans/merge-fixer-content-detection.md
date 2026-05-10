# Bug-fix: merge-fixer harness flags every real conflict as "no progress"

The post-fixer "did the fixer make progress" check in `integrate.ts` queries the **index** (`git diff --name-only --diff-filter=U`) to enumerate conflicted files. After the fixer edits the working tree, the index is unchanged — `git add` is what collapses stage 1/2/3 to stage 0, not file-content edits. Result: `stillConflicted.length === conflicted.length` is structurally always true after any real conflict, so every fixer-triggering rebase bails with `"merge-fixer produced no changes"` regardless of whether the fixer correctly resolved the markers. This was masked because the existing tests use a `FailIfSpawnedCLI` that asserts the no-conflict happy path; no test exercises a real conflict.

## Target file

`packages/munchkins-core/src/integrate.ts`

## What to change

Replace the post-fixer block in `rebaseAndResolve` (the section starting `// The fixer should have removed conflict markers but not staged or committed.`) with a content-based progress check using `git diff --check`, plus selective staging.

1. Add a helper at the bottom of the file (next to `listConflictedFiles`):

   ```ts
   async function filesWithLeftoverMarkers(workdir: string): Promise<string[]> {
     const r = await $`git diff --check`.cwd(workdir).nothrow().quiet();
     if (r.exitCode === 0) return [];
     const files = new Set<string>();
     for (const line of r.stdout.toString().split("\n")) {
       // git diff --check emits both whitespace and conflict-marker warnings;
       // filter to conflict markers so a stray trailing-whitespace warning
       // doesn't masquerade as a leftover marker.
       if (!line.includes("conflict marker")) continue;
       const colon = line.indexOf(":");
       if (colon > 0) files.add(line.slice(0, colon));
     }
     return [...files];
   }
   ```

2. Replace the post-fixer block. Today (in the `while (rebase.exitCode !== 0)` loop, after the fixer call):

   ```ts
   // The fixer should have removed conflict markers but not staged or committed.
   // Stage all edits and ask git to continue.
   const stillConflicted = await listConflictedFiles(workdir);
   if (stillConflicted.length === conflicted.length) {
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
   ```

   Becomes:

   ```ts
   // Detect leftover markers via working-tree content (`git diff --check`).
   // The previous index-based check was structurally broken: editing a file
   // doesn't remove its unmerged index entry, so the old check could never
   // observe the fixer's edits as progress.
   const stillMarked = new Set(await filesWithLeftoverMarkers(workdir));

   // Bail early if the fixer wrote markers to files outside the conflict set.
   const stray = [...stillMarked].filter((f) => !conflicted.includes(f));
   if (stray.length > 0) {
     await abortRebase(workdir);
     return {
       ok: false,
       reason: `merge-fixer wrote markers to files outside the conflict set: ${stray.join(", ")}`,
       fixerIters,
     };
   }

   // Bail if the fixer made zero forward progress.
   if (stillMarked.size === conflicted.length) {
     await abortRebase(workdir);
     return {
       ok: false,
       reason: `merge-fixer left markers in every conflicted file: ${[...stillMarked].join(", ")}`,
       fixerIters,
     };
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
   ```

3. **Add tests in a new file** `packages/munchkins-core/src/integrate.test.ts`. Follow the style of `packages/munchkins-core/src/sandbox/sandbox.test.ts` (mkdtemp + git init, `gitEnv()` helper, `TEST_GIT_IDENTITY`, etc.). Use a stub `AgentCLI` whose `spawn` is a constructor-injected handler so each test can program the fixer's behavior.

   Five tests required:

   | # | Setup | Stub fixer behavior | Expected |
   |---|---|---|---|
   | 1 | One file, conflicting edits in main vs branch | Writes valid merged content (no markers); exit 0 | `{ok: true, fixerIters: 1}`; ff-merge lands; main HEAD log contains both edits |
   | 2 | Same setup as 1 | No edits (markers remain); exit 0 | `{ok: false, reason: /left markers in every/, fixerIters: 1}`; main not advanced |
   | 3 | Two files A and B, both conflicting | First call resolves A only; second call resolves B | `{ok: true, fixerIters: 2}`; stub invocation count is 2; both edits in final commit |
   | 4 | Same as 1 | Stub returns exit 1 | `{ok: false, reason: /CLI exited/, fixerIters: 1}` |
   | 5 | Branch is already on main (no rebase work) | `FailIfSpawnedCLI`-style stub that throws if invoked | `{ok: true, fixerIters: 0}`; stub never called |

   Test 3 is the load-bearing regression test for partial-progress; it's the case the new code is designed to handle correctly and the old code couldn't.

## Constraints

1. **No change to `integrateBranch`'s public signature** (`IntegrateOptions`, `IntegrateResult`, `RebaseAndResolveOptions`, `RebaseAndResolveResult`).
2. **No change to the merge-fixer system prompt** — the prompt is correct, the harness was wrong.
3. **Do not remove `listConflictedFiles`** — it's still the right call for the *initial* per-iteration enumeration of unmerged files (before the fixer runs). Only the *post-fixer* check changes.
4. **Do not change `gitWorktreeSandbox`, `agent-builder.ts`, or any agent definitions** — the bug and fix are scoped to `integrate.ts` + the new test file.
5. The post-fixer staging must use per-file `git add ${f}` (not `git add -A`). `git add -A` would silently stage marker-bearing files, allowing them to land in commits.

## Acceptance criteria

- `bun run typecheck` passes.
- `bun test src` passes — the existing 49 tests plus the 5 new ones.
- The new test file runs against the actual `integrateBranch` (not a mock); only the `AgentCLI.spawn` is stubbed.
- Test 3 (partial progress) explicitly asserts the stub was invoked twice — proves the outer loop re-prompted the fixer on the remaining unresolved file.

## Out of scope

- The concurrent-changelog-prepend hazard between parallel agent runs — orthogonal, separate diagnosis.
- Splitting the merge-fixer into per-file invocations — future optimization, not required for this fix.
- Cleaning up the failed worktree at `.worktrees/bug-fix-1778361665819-93ae5272` — operator concern, separate.
- Re-running the original `createworktree-skip-rename` plan — happens after this fix lands, separate run.
- Filtering `git diff --check` output by warning *category* beyond conflict markers — current behavior (skip whitespace warnings) is already correct.
