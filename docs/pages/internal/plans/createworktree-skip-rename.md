# Plan: pass the slugged branch name to `createWorktree`, skip the rename

## Symptom

`AgentBuilder.run` round-trips the agent branch name through git twice on every sandboxed run:

1. `gitWorktreeSandbox`'s factory calls `createWorktree(agentName, repoRoot)` with two args. `createWorktree` invents a placeholder branch — `agent/{agentName}-{Date.now()}-{uuid8}` — and creates a worktree on it.
2. Immediately after, `agent-builder.run` calls `renameBranch(handle.env.BRANCH, "agent/{slug}-{uuid8}", repoRoot)` to replace that placeholder with the final, slug-based name.

The whole rename step is wasted work. `createWorktree` already accepts an optional `branchName` (third arg) that bypasses the auto-naming, but no caller uses it. The slug is known by the time the sandbox is asked to create the branch, so the sandbox should create the branch with the final name from the start.

## Files involved

- `packages/munchkins-core/src/sandbox/sandbox.ts` — `gitWorktreeSandbox` factory; calls `createWorktree(agentName, repoRoot)` with two args today.
- `packages/munchkins-core/src/builder/agent-builder.ts` — `run()` performs the post-creation `renameBranch` at the post-`Promise.all` block (search for `renameBranch(sandboxHandle.env.BRANCH`).
- `packages/munchkins-core/src/worktree.ts` — `createWorktree` already accepts `branchName?` as the third arg; no change needed there.
- `packages/munchkins-core/src/sandbox/sandbox.test.ts` — exercises the factory directly; will need updates if the factory signature changes.

## Root cause

`SandboxFactory`'s signature is `(agentName, repoRoot) => Promise<SandboxHandle>`. There is no way for the caller to pass a final branch name into the sandbox at creation time, so the agent-builder is forced to create-then-rename. The plumbing for the third arg already exists in `createWorktree`; only the factory and the call site are missing it.

## Fix

1. Widen `SandboxFactory` in `packages/munchkins-core/src/sandbox/sandbox.ts`:
   ```ts
   export type SandboxFactory = (
     agentName: string,
     repoRoot: string,
     branchName?: string,
   ) => Promise<SandboxHandle>;
   ```
2. `gitWorktreeSandbox` in the same file: accept the optional `branchName` and forward it to `createWorktree(agentName, repoRoot, branchName)`. When `branchName` is omitted, behavior must be unchanged from today.
3. `AgentBuilder.run` in `packages/munchkins-core/src/builder/agent-builder.ts`:
   - Sequence: `await` slug derivation **before** calling the sandbox factory. Compute the final branch name (`agent/${slug}-${crypto.randomUUID().slice(0,8)}`) and pass it as the third arg to `this.sandbox(name, repoRoot, finalBranch)`.
   - Remove the `renameBranch(...)` call and any subsequent `sandboxHandle.env.BRANCH = finalBranch;` assignment that was paired with it.
   - Remove the `import { renameBranch } from "../worktree.js";` if it's no longer used elsewhere in the file (verify with grep before deleting).
   - The slug + sandbox previously ran in parallel via `Promise.all`. After this change the sandbox creation waits for slug derivation. The loss is acceptable — slug is the slow step (LLM call); worktree creation is local git in tens of milliseconds.

## Acceptance criteria

- `createWorktree` is called exactly once per run, with the slug-derived branch name.
- `renameBranch` is no longer called from `agent-builder.run`'s sandboxed path.
- `bun run typecheck` and `bun test src` pass in `packages/munchkins-core`.
- The existing sandbox tests still pass; the test that constructs a `gitWorktreeSandbox()` directly may need to either pass a branch name or rely on the optional default. Both forms must keep working.
- No change to the *shape* of the final branch name — it still matches `agent/<slug>-<8-hex-chars>`.

## Out of scope

- Slug derivation logic itself.
- The format of the branch name beyond keeping it the same.
- Other coupling frictions in `gitWorktreeSandbox` (diff hardcoded to `main...`, baseBranch resolved at teardown). Separate diagnoses.
