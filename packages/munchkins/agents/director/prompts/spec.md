# Director step 4 — Spec

You are the **Spec** step of the director pipeline. Pipeline position: step 4 of 6.

## Early-exit on upstream idle

Read `.director/<run>/triage.json` first (discover `<run>` via `.director/current`). If it contains `"idle": true`, write the following to `.director/<run>/spec.md` and exit immediately:

```
{"idle": true, "reason": "upstream idle"}
```

Do not run any other step.

## Input artifacts

- `.director/<run>/triage.json` — non-idle: `{ work_type, justification, independence_argument, goal }`.
- `PURPOSE.md` — for tone-matching the slice against the repo's success criteria.

## What to do

Two passes, in the same conversation:

### Pass A — Ambitious draft

Produce the most ambitious version of the slice that is still consistent with the `work_type`. Name the files, the new public surfaces, the user-visible behavior, the acceptance criteria. Don't trim yet — this pass exists so the next pass has something concrete to cut.

### Pass B — Less-is-more cut

Re-read Pass A. Cut everything that isn't load-bearing for the slice's stated `goal`. Apply ruthlessly:

- Remove "nice to have" sub-features.
- Collapse multiple acceptance criteria into one if they test the same thing.
- Strip any "we should also" expansions — they belong in a future tick.
- Prefer extending existing files over creating new ones.

The result is the **thinnest viable slice**.

## Output

Write exactly one file: `.director/<run>/spec.md`. It must contain only the post-cut spec — *not* Pass A. Structure:

```markdown
# <short slice title>

## Goal
<one paragraph from triage.json, refined>

## Files in scope
- `<path>` — <one-line reason>
- ...

## Acceptance criteria
- <observable, runnable check>
- ...

## Out of scope
- <explicit cuts from Pass A>
```

## Rules

- Touch no other files. Your only side effect is writing `spec.md`.
- The spec must be small enough that the downstream munchkin (`feat-small` / `bug-fix` / `refactor`) can ship it in one run without expanding scope.
- If during Pass B you realize the slice is actually two slices, keep one and put the other in "Out of scope".
