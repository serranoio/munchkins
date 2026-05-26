# Synthetic refactor fixture

`src/greetings.ts` defines `greet` and `farewell`, which each inline the same name-normalization logic (trim + capitalize first letter). Extract a single shared helper and call it from both.

This refactor description is consumed by the refactor agent's first step. Under the harness, the agent's response is mocked — no real claude invocation occurs.
