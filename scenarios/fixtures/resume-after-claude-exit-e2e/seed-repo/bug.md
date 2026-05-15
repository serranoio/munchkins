# Synthetic bug fixture (resume-after-claude-exit-e2e)

The function `add` in `src/math.ts` returns `a - b` instead of `a + b`. Fix it.

Under this scenario, the in-process mock fails at step 2 (refactorer) to exercise the resume-after-interrupt path; the resumed run is driven by a fake-claude shim on PATH.
