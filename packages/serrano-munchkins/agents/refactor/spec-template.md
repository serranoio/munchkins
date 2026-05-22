# Refactor: <one-line description of the refactor>

<one-paragraph problem statement: the duplication or design issue being addressed, where it appears, and why a refactor is the right tool>

## Target file(s)

`<path/to/file.ts>` (or `<dir>/`)

## Scope boundary

Touch only files inside `<scope>`. Behavior must be preserved — no change to the public API or the observable result of any caller.

## What to change

- <concrete instruction with file:line references>
- ...

## Constraints

1. <invariant that must hold — e.g., "no signature changes on exported symbols">
2. ...

## Acceptance criteria

- <observable, checkable outcome — e.g., "duplicate helper inlined to one definition">
- All existing tests still pass without modification.

## Out of scope

- <what NOT to touch>
- Any change outside the scope boundary above.
