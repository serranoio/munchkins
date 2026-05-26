# Synthetic refactor fixture

`src/greet.ts` exports `formatGreet` and `formatFarewell`. Both functions duplicate the same trim-and-titlecase preamble inline. Extract that preamble into a shared `normalizeName(name)` helper inside the same file and call it from both exports. Behavior must not change.

This refactor description is consumed by the refactor agent's first step. Under the harness, the agent's response is mocked — no real claude invocation occurs.
