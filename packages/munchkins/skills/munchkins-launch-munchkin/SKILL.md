---
name: munchkins:launch-munchkin
description: Use this skill when the user wants to delegate a coding task to a munchkins background agent — signaled by words like "munchkin", "spawn an agent", "delegate to an agent", "kick off feat-small", "launch a bug-fix agent", or by naming a registered munchkin subcommand directly. Do NOT use this skill when the user wants Claude to do the work inline; only when they want to hand off to a separate background agent run.
---

# Launch Munchkin

Hands a coding task off to a `munchkins` background agent and exits. Fire-and-forget — do not poll, do not wait for results, do not surface the agent's output. The agent runs in its own worktree, runs its own post-checks, and integrates commits back to the parent branch on its own.

## When this skill applies

Trigger on explicit delegation vocabulary: "munchkin", "spawn agent", "delegate to agent", "send this to an agent", "launch [subcommand]", or the user naming a registered munchkin subcommand directly.

If the request is ambiguous between "do it inline" and "delegate to a munchkin," default to inline. Only fire this skill when the user has signaled delegation.

## Workflow

### 1. Pre-flight

Verify `munchkins` is available:

```bash
bun run munchkins --version
```

If it fails, tell the user "launch-munchkin requires `@serranolabs.io/munchkins` to be installed in this repo" and stop.

### 2. Pick the subcommand

Read the live agent list:

```bash
bun run munchkins --help
```

**If the request includes a path to an existing `.md` plan/spec/brief, read it first** — the plan is the primary signal for agent selection; the user's free-text prompt is secondary.

Look for **structured signals first** (these are cross-project conventions and never wrong):

1. **Frontmatter** — `agent: <name>` or `work_type: <type>` at the top of the file. If present, pick the matching agent. Done.
2. **Director-generated plan** — if the path matches `.director/<run>/plan.md`, read the sibling `.director/<run>/triage.json` (if it exists) and use its `work_type` field. Map `feature` → `feat-small`, `bug-fix` → `bug-fix`, `refactor` → `refactor`, `performance` → `refactor` (until a dedicated performance munchkin exists). Done.

If no structured signal exists, **read the plan and judge** which registered agent best matches its intent — using the agent descriptions in `--help` as the rubric, not any fixed vocabulary. Every project has its own vocabulary; don't keyword-match on verbs or section names. Reason about what the plan is *asking for*: is the goal to restore broken behavior, add new behavior, or reshape existing behavior without changing it? Then pick the agent whose description fits that intent.

Resolution:

- **Single clear candidate** → use it.
- **Multiple plausible candidates** → ask the user which one, listing the candidates and quoting the plan passage that's ambiguous.
- **Zero candidates** (no plan, no hint in the user's message) → ask the user, listing all registered agents from `--help`.

Never guess. If the plan signal contradicts the user's prompt (e.g., plan's frontmatter says `bug-fix` but user said "refactor this"), ask — don't silently pick one.

### 3. Resolve the spec file

**If the request includes a path to an `.md` file that exists and is non-empty** (e.g., "launch refactor with `docs/plans/refactor-runlogger.md`"): use that path as-is.

**If the request mentions a path that is missing, empty, or not `.md`**: ask the user to clarify (typo, or generate a new spec instead?) before continuing.

**Otherwise**, generate a new spec at:

```
<specsDir>/<subcommand>-<short-slug>-<MMDDYYYY-HHMM>.md
```

Where `<specsDir>` is read from `.munchkins/config.json` (`specsDir` key), defaulting to `.munchkins/specs` if absent.

Always timestamp — never overwrite an existing spec.

Load the per-agent template from the first path that exists:

1. `packages/munchkins/agents/<subcommand>/spec-template.md` (when running inside this monorepo)
2. `node_modules/@serranolabs.io/munchkins/agents/<subcommand>/spec-template.md` (consumer repos)
3. `.munchkins/agents/<subcommand>/spec-template.md` (project-local agents)

Fill the template from conversation context. If no template exists for the chosen agent, generate the spec free-form with goal, target files (`file:line`), acceptance criteria, and an explicit **Out of scope** section.

### 4. Soft-check active worktrees

List worktrees matching the chosen subcommand:

```bash
ls -1d .worktrees/<subcommand>-* 2>/dev/null
```

If any exist, surface them in the confirmation step below — they're either still running or failed and preserved. The user decides whether to proceed.

### 5. Resolve flags

Read `.munchkins/config.json` if present. Apply config defaults:

- `integrate`: skill default is `pr`. A config value (`"merge"` or `"pr"`) overrides the skill default for this repo.
- `specsDir`: directory where generated spec files are written. Defaults to `.munchkins/specs` if absent.
- Explicit user flags always win over config.

Build the resolved command. Example shape:

```bash
bun run munchkins <subcommand> --user-message <path> --integrate=pr
```

### 6. Confirm

Show the user:

- The spec contents (path + body).
- The resolved command.
- Any active or stale worktrees from step 4.

**Always wait for explicit confirmation before proceeding** — even under auto mode. Spawning an autonomous coding agent that creates commits and PRs is the class of action that requires a human in the loop.

### 7. Validate via `--dry-run`

Run the resolved command foreground with `--dry-run` appended:

```bash
bun run munchkins <subcommand> --user-message <path> --integrate=<mode> --dry-run
```

If it exits non-zero, surface the error and stop. Do not proceed to the real launch.

### 8. Spawn

Run the same command (without `--dry-run`) in the background and exit. Invoke via `Bash(run_in_background: true)`. Then **stop**.

- Do NOT tail the output file.
- Do NOT call `ScheduleWakeup`.
- Do NOT pgrep, ps, or otherwise check on the process.
- Do NOT report PASS/FAIL when it eventually finishes.

The agent integrates its own commits when it finishes; the user will see them in `git log` on their own pace.

Reply to the user with two lines:

```
launched: <subcommand> agent on <path>
check `bun run munchkins status` or `.worktrees/` later if you don't see commits within ~1h.
```

…and stop.

## User-passed `--dry-run`

If the user explicitly passed `--dry-run` in their request: run the command foreground, show the output, stop. Do not run a second invocation. The fire-and-forget rule in step 8 applies only to non-dry-run launches.

## Spec-only mode

If the user explicitly says "just write the spec", "give me the command, don't run it", or similar: write the spec file, print the resolved command, and stop. Skip steps 6–8.

## Flag handling

Pass these flags through only when the user explicitly asks for them. Do not infer.

- `--cli claude|codex` — backend selector
- `--thinking` — middle verbosity (Claude streaming without boxed prompts)
- `--integrate <mode>` — `pr` (skill default) or `merge`. Read repo-level default from `.munchkins/config.json` if present.

## What this skill does NOT do

- Does not poll, tail, or report on the running agent.
- Does not hard-block on concurrent worktrees — only surfaces them in the confirmation.
- Does not retry on failure.
- Does not validate flag combinations beyond the `--dry-run` pre-check (the CLI does the rest).
- Does not bundle scripts — all operations are inline shell.
- Does not hardcode the agent list — agents are discovered at runtime via `bun run munchkins --help`.
- Does not own spec templates — each agent ships its own `spec-template.md`.
