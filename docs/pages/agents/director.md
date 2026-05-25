# Director

Cron-driven orchestrator that picks the next vertical slice of work, plans it, and dispatches the slice to an existing munchkin (`feat-small`, `bug-fix`, or `refactor`). The director does not edit code itself — it decides *what* to work on and hands the work off.

## What it does

`director` is a six-step pipeline:

1. **Inflight-survey** — inventory all `director/*` PRs, branches, and worktrees currently in flight.
2. **Repo-survey** — `git log`, `gh pr list`, lint/typecheck status. Fails fast if `PURPOSE.md` is missing.
3. **Triage** — read `PURPOSE.md` and the surveys; pick a `work_type` + goal that is *independent* of every in-flight slice. Idle if no candidate qualifies.
4. **Spec** — ambitious draft followed by a less-is-more cut in the same conversation. Emits the thinnest viable slice.
5. **Plan** — enumerate ambiguities; resolve each with an opinionated architect call. Idle if anything is unresolvable.
6. **Dispatch** — `bun run munchkins <target> --user-message=.director/<run>/plan.md --branch-prefix=director`. Blocks until the child completes.

All intermediate artifacts live in `.director/<run>/` inside the director's worktree. The directory is gitignored.

## When to reach for it

- You want an "always on" agent that grinds against `PURPOSE.md` while you do other work. The director runs every 10 minutes via the daemon and stacks parallel slices when they're independent.
- You want a single decision point in code that selects between `feat-small`, `bug-fix`, and `refactor` automatically. The director's triage step makes that call by reading the repo state.
- You want each dispatched run to live on a `director/*` branch so it's distinguishable from manual agent invocations.

If you know exactly which agent and brief to run, call that agent directly — the director is overhead.

## Prerequisites

- A `PURPOSE.md` at the repo root. The director refuses to run without one. See [the contract](#purposemd-contract) below.
- The `gh` CLI on `PATH` and authenticated, for the inflight-survey to enumerate open PRs. The director still runs without `gh`, but the inflight inventory will only include local branches and worktrees.

## Quickstart

One-shot tick (no daemon):

```sh
bun run munchkins director --user-message=tick
```

Daemon mode — fires every 10 minutes until you Ctrl-C:

```sh
bun run munchkins daemon
```

Dry-run — runs steps 1–5 and prints the resolved dispatch command without invoking the child munchkin:

```sh
bun run munchkins director --user-message=tick --dry-run
```

In dry-run mode, all reasoning steps execute and the artifacts in `.director/<run>/` are populated for inspection.

## PURPOSE.md contract

Every repo the director runs against MUST have a `PURPOSE.md` at the root. Minimum sections:

```markdown
# Purpose

**<one-sentence headline: what this repo is trying to be>**

## Success looks like
<numbered or bulleted list: 3–5 concrete outcomes that mean the project succeeded>

## Out of scope
<bulleted list: hard NOs — things the director should never propose as a slice>

## Current bets
<dated bullets: what the operator is currently steering toward; ideally include hints on which work-types fit each bet, e.g. "Slice candidates: feat-small, bug-fix">
```

The director re-reads `PURPOSE.md` every tick. Editing the file is your steering mechanism between daemon restarts — no STOP sentinel, no flag file.

**Optional but useful:**

- A north-star callout right under `# Purpose` (e.g., `> This file is the director's north star. It is re-read every tick. Edit it to steer.`) as a self-reminder for future editors.
- A structure / modes table near the top describing what shape the project takes. This repo's own [`PURPOSE.md`](https://github.com/serranoio/munchkins/blob/main/PURPOSE.md) uses one to define the three Autonomous Modes (Autopilot / Lights out / Foreman). Recommended when the project ships more than one shape of output; skip it when the project has one obvious shape.
- A "who it's for" paragraph if the persona isn't already implied by the headline.

## Vertical-slice rule

The director allows parallel slices to stack, on one condition: each new slice must be *independent* of every in-flight `director/*` slice. The triage step applies three checks against the inflight inventory:

1. **Disjoint file scope** — no file currently being edited by an in-flight branch.
2. **No upstream dependency** — the slice does not require code that exists only on an in-flight branch.
3. **No downstream coupling** — landing this slice and an in-flight slice in either order produces a green tree.

If no candidate passes all three, the director idles the tick. The next firing reassesses.

## Cron schedule

The director registers itself with:

```ts
.cron("*/10 * * * *", { userMessage: "tick", verbosity: "thinking" })
```

`bun run munchkins daemon` startup table will show `director` armed for `*/10 * * * *` with verbosity `thinking`. To change the cadence permanently, edit `packages/munchkins/agents/director/director-agent.ts`.

## Stop condition

The director never self-terminates. Stop the daemon with Ctrl-C (foreground) or `kill <pid>` (background). Removing `PURPOSE.md` is *not* a stop signal — it causes every tick to fail fast, which clutters the log without releasing the process.

## Flags

| Flag | What it does |
|------|--------------|
| `--user-message <value>` | Per-tick payload (default `tick`). The pipeline does not actually consume it — `PURPOSE.md` is the source of truth. Required by the CLI surface so manual one-shot invocations work. |
| `--dry-run` | Run steps 1–5 normally; step 6 (dispatch) prints the resolved command and exits without invoking the child munchkin. |
| `--cli <claude\|codex>` | Backend CLI for the agent steps. Default `claude`. |
| `--verbose` / `--thinking` | Stream agent output. Default verbosity for cron'd ticks is `thinking`. |

## Out of scope

- A dedicated `performance` munchkin. Phase 1 maps the director's `performance` work-type to `refactor`. A future Phase 2 may introduce a `performance` agent.
- Cross-tick learning. The director's only memory is `git log` + open PRs.
- Multi-repo direction. The director runs against the repo it's invoked in.
- Human-in-the-loop review gates. All output flows through the dispatched munchkin's normal PR/merge contract.
