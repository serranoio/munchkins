# Purpose — director-multi-dispatch-e2e fixture

Synthetic north star for the director multi-dispatch end-to-end scenario.

## Success criteria

The fixture project is "done" when both opportunities below are addressed.

## Improvement opportunities

### A. Fix the `add()` arithmetic bug

`src/example.ts` declares `add(a, b)` but returns `a - b`. Ship a bug-fix slice
that corrects the operator so the function returns the sum. Scope is a single
file. No new files. No new tests.

### B. Refactor `multiply()` into a shared helper

`src/example.ts` re-implements `multiply()` inline. Extract the body into a
single-line helper, keeping the public surface unchanged. Scope is a single
file. Behavior-preserving.
