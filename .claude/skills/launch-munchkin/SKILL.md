---
name: launch-munchkin
description: Use this skill when the user wants to delegate a coding task to a munchkins background agent in this repo — signaled by words like "munchkin", "spawn an agent", "send this to a refactor agent", "launch a bug-fix agent", "kick off feat-small", or by naming a munchkin subcommand directly (bug-fix, feat-small, refactor). Do NOT use this skill when the user wants Claude to do the work inline; only when they want to hand off to a separate background agent run.
---

# Launch Munchkin

Hands a coding task off to a `munchkins` background agent and exits. Fire-and-forget — do not poll, do not wait for results, do not surface the agent's output. The agent runs in its own worktree, runs its own post-checks, and integrates commits back to the parent branch on its own.

## When this skill applies

Trigger on explicit delegation vocabulary: "munchkin", "spawn agent", "delegate to agent", "send this to a [bug-fix|feat-small|refactor] agent", "launch [subcommand]", or the user naming a munchkin subcommand directly.

If the request is ambiguous between "do it inline" and "delegate to a munchkin," default to inline. Only fire this skill when the user has signaled delegation.

## Subcommands

- `bug-fix` — fix a described bug
- `feat-small` — implement a small new feature
- `refactor` — refactor a target for DRY/clarity

## Workflow

### 1. Pre-flight

Verify cwd is the munchkins repo:

```bash
test -f packages/munchkins/src/index.ts
```

If it fails, tell the user "launch-munchkin only runs inside the munchkins repo" and stop.

### 2. Pick the subcommand

Infer from the request:
- "bug", "fix", "broken", "regression" → `bug-fix`
- "feature", "add", "implement", "new" → `feat-small`
- "refactor", "dedupe", "DRY", "extract", "clean up" → `refactor`

If multiple subcommands could apply (e.g., "fix the duplicated logic in X" — `bug-fix` or `refactor`?), ask the user before proceeding. Do not guess.

### 3. Resolve the user-message file

**If the request includes a path to an existing `.md` file** (e.g., "launch refactor with `scratch/refactor-runlogger.md`"): use that path as-is.

**Otherwise**, generate a spec at `scratch/<subcommand>-<short-slug>.md` from the conversation context. The spec must:
- State the goal in one paragraph at the top
- Identify target files using `path:line` references
- List acceptance criteria (concrete, checkable)
- Include an explicit **Out of scope** section listing what NOT to touch

Use the existing `scratch/refactor-runlogger.md` and `scratch/feat-thinking-flag.md` as shape references — short headings, ASCII tables for behavior matrices, code blocks for type signatures.

Show the user the spec contents and the exact command before invoking. Confirm once.

### 4. Spawn (default mode)

Run in background and exit:

```bash
bun run munchkins <subcommand> --user-message <path>
```

Invoke via `Bash(run_in_background: true)`. Then **stop**.

- Do NOT tail the output file.
- Do NOT call `ScheduleWakeup`.
- Do NOT pgrep, ps, or otherwise check on the process.
- Do NOT report PASS/FAIL when it eventually finishes.

The agent integrates its own commits onto the parent branch when it finishes; the user will see them in `git log` on their own pace.

Reply to the user with one line:

```
launched: <subcommand> agent on <path>
```

…and stop.

### 5. Spec-only mode (when explicitly asked)

If the user explicitly says "just write the spec", "give me the command, don't run it", or similar: write the markdown file, print the exact command, and stop. Do NOT invoke the CLI.

## Flag handling

Pass these flags through only when the user explicitly asks for them. Do not infer.

- `--cli claude|codex` — backend selector
- `--verbose` — full output
- `--thinking` — middle verbosity (Claude streaming visible without boxed prompts)
- `--dry-run` — print resolved pipeline without invoking; in this mode run **foreground** (it's fast, side-effect-free, and the output is the entire point)

## What this skill does NOT do

- Does not poll, tail, or report on the running agent.
- Does not check for concurrent worktrees or duplicate launches.
- Does not retry on failure.
- Does not validate flag combinations — the CLI does that.
- Does not bundle scripts — all operations are inline shell.

## Spec template (for generated `scratch/*.md` files)

```markdown
# <Type>: <one-line goal>

<one-paragraph problem statement>

## Target file(s)

`<path/to/file.ts>`

## What to change

- <concrete instruction with file:line references>
- ...

## Constraints

1. <invariant that must hold>
2. ...

## Acceptance criteria

- <observable, checkable outcome>
- ...

## Out of scope

- <what NOT to touch>
- ...
```
