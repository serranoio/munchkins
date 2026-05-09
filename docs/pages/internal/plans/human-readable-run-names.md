# Plan — Human-readable run names

Replace timestamp-based run-log directory names and worktree branch names with LLM-generated, human-readable slugs derived from the user's task description.

## Problem

Today, `RunLog` (`packages/munchkins-core/src/run-log.ts:72-86`) names every run directory `${agentName}-${epochMs}-${uuid8}` — e.g. `bug-fix-1730000000000-a1b2c3d4`. The same pattern is mirrored in the worktree branch (`packages/munchkins-core/src/worktree.ts:15-16`), so `git branch` and any PR cut from a run also surfaces an opaque timestamp. Operators cannot tell at a glance which run handled which task.

## Goal

Both the run-log directory and the worktree branch should use a human-readable slug (≤30 characters) derived from the user's task description, with a short uuid suffix preserved for collision avoidance.

Final shape:
- Dir: `<slug ≤30>-<uuid8>` — e.g. `fix-login-redirect-bug-a1b2c3d4`
- Branch: `agent/<slug ≤30>-<uuid8>` — e.g. `agent/fix-login-redirect-bug-a1b2c3d4`

## Decisions

The decision tree was resolved interactively. Each row records the chosen option and the constraint that drove it.

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Slug source | LLM call (Haiku) on the user message — the "feature" identity already lives in the user's task description. |
| D1.a | Long-input compression | Send the full userMessage content as the user prompt. Haiku has 200K context; cost is negligible. |
| D2 | LLM invocation path | Extend `spawnClaude` with `model` + `disallowedTools` flags. Reuse the existing CLI auth path; no new SDK dependency. |
| D3 | Failure handling | Fall back to deterministic kebab (H1 → first-line → strip → trunc). Record the fallback as an event in `events.jsonl`. Never block a run on naming. |
| D4 | Concurrency topology | `Promise.all([getSlug, createSandbox])`. Worktree is created with a temp branch; once the slug arrives, `git branch -m` renames it so dir and branch share identity. |
| D5 | Concurrency primitive | `Promise.all` with async I/O. **Not** Bun workers — workers solve CPU-blocking, not I/O-bound work, and the child `claude` process already runs in its own OS process. |

## Defaults baked in

- **30-char cap** applies to the slug portion only. Final dir name is `<slug ≤30>-<uuid8>` (~39 chars max).
- **Retry policy:** 5 attempts with exponential backoff (0, 1s, 2s, 4s, 8s — ~15s wall time max). Each attempt uses `AbortSignal.timeout(15_000)`. After all 5 fail, fall back to the deterministic kebab.
- **Agents without a `userMessage` option** skip the LLM call entirely and use the deterministic kebab seeded with `agentName`.
- **Uuid suffix stays** for collision insurance — re-running the same task should not clobber the prior run-log dir.

## Implementation

### Files touched

| File | Change |
|------|--------|
| `packages/munchkins-core/src/builder/spawn-claude.ts` | Add `model` and `disallowedTools` to `SpawnClaudeOptions`; thread them into the `claude` CLI args. Add `abortSignal` for the per-attempt timeout. |
| `packages/munchkins-core/src/builder/slug.ts` (new) | `getSlugWithRetry(text)`, `deriveSlugDeterministic(text)`, `sanitize(raw)`. Single source of truth for slug derivation. |
| `packages/munchkins-core/src/run-log.ts` | `RunLog` constructor accepts a `slug` parameter; uses it instead of generating `${epochMs}-${uuid8}`. |
| `packages/munchkins-core/src/worktree.ts` | `createWorktree` accepts an optional `branchName`; falls back to today's pattern when none is supplied. |
| `packages/munchkins-core/src/sandbox/sandbox.ts` | Pass-through for the optional branch name. Add a `renameBranch` helper for the parallel-rename case. |
| `packages/munchkins-core/src/builder/agent-builder.ts` | In `run()`: read userMessage, kick off `Promise.all([getSlug, sandbox])`, rename branch + construct `RunLog` with the resolved slug. |

### Slug call shape

```ts
async function getSlugWithRetry(userMessage: string): Promise<string> {
  const delays = [0, 1_000, 2_000, 4_000, 8_000];
  for (const d of delays) {
    if (d) await Bun.sleep(d);
    try {
      const r = await spawnClaude({
        systemPrompt: SLUG_PROMPT,
        userPrompt: userMessage,
        cwd: process.cwd(),
        model: "haiku",
        disallowedTools: ["*"],
        abortSignal: AbortSignal.timeout(15_000),
      });
      const cleaned = sanitize(r.output);
      if (cleaned) return cleaned;
    } catch {}
  }
  return deriveSlugDeterministic(userMessage);
}
```

### Sanitizer

`sanitize(raw)` and `deriveSlugDeterministic(text)` share the same kebab pipeline:

1. Prefer the first H1 heading (`/^#\s+(.+)$/m`) if present.
2. Otherwise, take the first non-empty trimmed line.
3. Lowercase, replace any run of non-`[a-z0-9]` with `-`, strip leading/trailing `-`.
4. If result > 30 chars, truncate at the last `-` boundary ≥ 15 chars; otherwise hard-cut at 30.
5. If result is empty (non-Latin input, all punctuation, etc.), return `""` so the caller can fall back to `agentName`.

### Run lifecycle change

```ts
// agent-builder.ts — replace the current sandbox/RunLog construction
const userMessageText = readUserMessage(repoRoot);  // reuses logic at agent-builder.ts:316-325

const [slug, sandboxHandle] = await Promise.all([
  userMessageText
    ? getSlugWithRetry(userMessageText)
    : Promise.resolve(deriveSlugDeterministic(this.name) || this.name),
  this.sandbox?.(this.name, repoRoot),
]);

if (sandboxHandle) {
  const finalBranch = `agent/${slug}-${uuid8()}`;
  await renameBranch(sandboxHandle.env.BRANCH, finalBranch, repoRoot);
  sandboxHandle.env.BRANCH = finalBranch;
}

const runLog = new RunLog(repoRoot, this.name, { slug });
```

## Tests

- Unit: `sanitize` covers H1 input, no-H1 input, empty input, non-Latin input, oversize input, punctuation-only input.
- Unit: `deriveSlugDeterministic` matches `sanitize` semantics for clean inputs.
- Integration: `getSlugWithRetry` falls back to the deterministic path when `spawnClaude` is stubbed to reject 5 times in a row; records the fallback event.
- Integration: existing sandbox tests in `sandbox.test.ts` continue to pass; add one that asserts `handle.env.BRANCH` reflects the renamed slug-based name after the parallel construction.
