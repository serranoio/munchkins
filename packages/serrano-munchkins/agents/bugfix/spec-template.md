# Bug: <one-line description of the bug>

<one-paragraph problem statement: what's broken, where it surfaces, and any relevant context for why it matters>

## Current behavior

<observable symptom — exact error text, wrong output, missing behavior, etc.>

## Expected behavior

<what the code should do instead>

## Repro

```
<minimal steps or command sequence that reproduces the bug — paste exact CLI output if helpful>
```

## Target file(s)

`<path/to/file.ts>` (or `<dir>/` if the bug spans a small surface)

## What to change

- <concrete instruction with file:line references>
- ...

## Acceptance criteria

- <observable, checkable outcome that proves the bug is fixed>
- Existing tests still pass; a regression test (or scenario step) guards the fix.

## Out of scope

- <what NOT to touch — adjacent code paths, unrelated bugs, drive-by refactors>
- ...
