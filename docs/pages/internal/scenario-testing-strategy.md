---
stage: scenario-testing-strategy
artifact_root: docs/pages/internal/
status: draft
upstream:
  - docs/pages/internal/diagnosis.md
  - docs/pages/internal/prd.md
---

# Scenario Testing Strategy

This strategy assumes `prd.md` (14 scenarios — S1–S12 from the original scaffold milestone, S13–S14 added in change-impact round 1) and `diagnosis.md` (D1–D13). It does not restate them.

## Scenario Mapping

The harness owns **exactly one** deep scenario: S7. This is an explicit exception to the skill's default unified-harness rule, set by the PRD's Testing Decisions. The other scenarios are verified outside the harness per the methods the PRD already lists; they are not invoked by the harness CLI.

| PRD ID | E2E ID | In Harness? | Verification |
|--------|--------|-------------|--------------|
| S7 | `bugfix-agent-e2e` | ✓ | `bun run scenario` |
| S1, S3, S4, S5, S6 | — | ✗ | Direct shell, asserted in `ci.yml` `test` job |
| S2, S8 | — | ✗ | Manual (browser) |
| S9, S10, S11, S12 | — | ✗ | Real GitHub Actions run |
| S13, S14 | — | ✗ | Direct shell — runtime smoke test in `ci.yml` `test` job, asserting `registry.cli().parse(['bugfix','--help'])` exits 0 and `registry.list()` includes `bugfix` after a side-effect bundle import |

## Harness CLI Contract

```
bun run scenario        # runs bugfix-agent-e2e; exit 0 pass / 1 fail
```

Wired via root `package.json` `"scenario": "bun run scenarios/index.ts"`. No `list`, no `run <id>`, no mode dispatcher. Surface grows only when a second deep-simulation scenario is added by a future PRD.

**Behavior on invocation:** create temp sandbox → init git repo from seed fixture → install in-process Claude mock seam at `@serranolabs.io/munchkins-core/builder/spawn-claude.ts` (per D13/T1) → install sandbox-local stubs for deterministic-loop commands → import bugfix-agent constructor from `@serranolabs.io/munchkins/agents/bugfix` (per D8 — relocated post-refactor) → invoke against sandbox → assert outcomes + run mock-call audit → emit structured JSON result + summary line → on pass remove sandbox, on fail preserve and print path.

**Boundary:** harness imports normal package exports. Neither munchkins-core nor the bundle depends on the harness, accepts `scenario_id`/`run_id`/harness-only inputs, or knows the harness exists.

## Scenario Placement

```
scenarios/
├── index.ts                                  # CLI entrypoint
├── lib/
│   ├── sandbox.ts                            # temp-dir + git-init helpers
│   ├── mock-spawn-claude.ts                  # Claude mock + Bun.spawn guard
│   ├── stub-deterministic.ts                 # sandbox stubs for scenario:all/lint/typecheck/changelog
│   └── result.ts                             # JSON result schema + printer
└── fixtures/bugfix-agent-e2e/
    ├── seed-repo/                            # synthetic git repo template
    ├── mock-claude-responses/                # canned spawnClaude responses, indexed by step
    └── stub-script-config.json               # which loop commands fail on which iteration
```

`scenarios/` is a repo-root directory, not a workspace (per D2). Verification commands for the out-of-harness scenarios live inline in `ci.yml` and root `package.json` scripts, NOT under `scenarios/`.

## Environment Recreation Model

Only the harness scenario has one. Per run:

- Fresh temp dir under `os.tmpdir()`.
- Real git repo initialized there, seeded from `fixtures/bugfix-agent-e2e/seed-repo/`. Seed includes a synthetic `package.json` whose `lint`/`typecheck`/`scenario:all`/`append-changelog` scripts point at `lib/stub-deterministic.ts`.
- Fresh in-process module-mock of `spawnClaude` via the mechanism locked in `technology-decisions.md`.
- Env vars `WORKTREE`, `BRANCH`, `REPO_ROOT`, `USER_MESSAGE_PATH`, `AGENT_NAME` set per `AgentBuilder` expectations, pointing into the sandbox. (`USER_MESSAGE_PATH` replaces the original `FOCUS_PATH` per the change-impact-round-1 rename of `focus` → `userMessage`.)

Real git binary, real Bun, real filesystem (sandboxed). Mocked Claude only.

Cleanup: pass → remove temp dir; fail → preserve + print path.

## External Dependency Strategy

Mock surface = `spawnClaude` only. Everything else (git, filesystem, Bun, the agent's own logic) is real. The harness wraps `Bun.spawn` to reject any spawn whose argv starts with `claude` — a real `claude` invocation fails the scenario regardless of what the agent pipeline reports.

For out-of-harness scenarios, real dependencies all the way: real Rspress, real linter, real `tsc`, real GitHub Actions runner, real npm registry (S12 uses pre-release versions like `0.0.0-alpha.X` to sandbox-by-version, not by mocking).

## Observability And Failure Artifacts

Structured JSON result (parseable by `jq`, wrapped in delimiters for CI log extraction):

```json
{
  "scenarioId": "bugfix-agent-e2e",
  "result": "pass" | "fail",
  "durationMs": 0,
  "sandboxPath": "/tmp/...",
  "mockCallLog": [],
  "stubCallLog": [],
  "failure": { "phase": "setup|execution|assertion|cleanup", "message": "", "stack": "" },
  "harnessVersion": "<git-sha>"
}
```

**Mock-call audit** (always runs after the agent pipeline, even on agent-PASS): assert mock-call count matches fixture's expected sequence length, in expected order, and that ZERO real `claude` invocations occurred. Any audit failure fails the scenario regardless of pipeline outcome.

**On failure:** preserve sandbox dir, capture mock-call + stub-call logs, capture sandbox `git status` snapshot, capture last 100 lines of each spawned subprocess. Color in TTY, plain in CI.

## Manual Verification Subsections

Required by plan-funnel skill rules for browser/operator-driven scenarios. Each lists how to run, how to open the UI, expected states, forbidden states, artifacts to inspect.

### S2 — Rspress dev renders internal artifacts

- **Run:** `bun run docs:dev` from repo root.
- **Open:** printed dev-server URL + `/internal/diagnosis`.
- **Expected:** Rspress-themed page; title `Diagnosis — Choose the monorepo layout for \`munchkins\``; sidebar lists internal artifacts (if `_meta.json` configured); markdown rendered with styling; cross-artifact links navigate.
- **Forbidden:** 404; raw markdown; missing CSS; console errors (`MODULE_NOT_FOUND`, hydration); sidebar present but missing `internal/` entries.
- **Inspect:** dev server log (no parse errors); browser network tab (all requests succeed); browser console (clean).

### S8 — New internal artifact appears in dev nav

- **Run:** with `bun run docs:dev` running, create `docs/pages/internal/scratch-test.md` with frontmatter + heading.
- **Open:** existing browser tab; navigate to `/internal/scratch-test`.
- **Expected:** HMR picks up the file under ~5s; new heading renders; `_meta.json` edits may require dev-server restart (acceptable per Rspress 2.x).
- **Forbidden:** 404 after save; dev-server crash; stale content; silent HMR (no reload log).
- **Inspect:** dev server log shows reload referencing the new file path; browser console clean.

### S9 — Push touching docs triggers public publish

- **Run:** push commit to `main` editing `docs/pages/index.mdx`. Separately, push a commit touching ONLY `docs/pages/internal/` to confirm path-filter exclusion.
- **Open:** GitHub repo → Actions tab → `docs-publish` run; then the deployed public URL.
- **Expected:** workflow starts within ~30s; all steps green; ≤5min; deployed site reflects edit within ~2min after deploy. Internal-only commit triggers NO workflow run.
- **Forbidden:** workflow runs on internal-only commit; deploy succeeds but public site stale; build output contains plan-funnel artifact titles (env gate broken).
- **Inspect:** workflow run log; deploy step output URL; spot-check 3 public pages.

### S10 — PR runs lint as required check

- **Run:** open PR with deliberate lint violation; remove violation in follow-up commit.
- **Open:** GitHub PR → Checks tab.
- **Expected:** `lint` job in required-checks list; fails red within ~2min; merge button blocked; fix flips to green and unblocks.
- **Forbidden:** `lint` job missing from PR checks; lint passes despite deliberate violation; merge possible despite red X.
- **Inspect:** PR check pane; `lint` job log (violation quoted); `main` branch protection settings (verify `lint` is required).

### S11 — PR runs tests as required check

- **Run:** open PR that makes `bugfix-agent-e2e` fail (e.g., bad fixture assertion); revert in follow-up.
- **Open:** GitHub PR → Checks tab.
- **Expected:** `test` job runs and fails; failure log contains harness output (sandbox path, mock-call log, assertion message); merge blocked; revert flips to green.
- **Forbidden:** `test` job runs without invoking `bun run scenario`; `bugfix-agent-e2e` passes despite deliberate failure; ANY real `claude` invocation in the job log.
- **Inspect:** `test` job log; structured JSON result printed at end; branch protection settings (verify `test` is required).

### S12 — Tag triggers npm publish (amended — change-impact round 1)

- **Run:** with `NPM_TOKEN` repo secret configured for `@serranolabs.io` scope, bump **both** `packages/munchkins-core/package.json` and `packages/munchkins/package.json` versions to `0.0.0-alpha.0` (and update the bundle's `dependencies["@serranolabs.io/munchkins-core"]` to match), commit, push, then tag and push per pattern locked in `technology-decisions.md`.
- **Open:** GitHub Actions `publish` run; npm registry pages for both `@serranolabs.io/munchkins-core` and `@serranolabs.io/munchkins`.
- **Expected:** lint+test gating jobs run first; on green, publish step runs `bun publish` for `-core` first, then for the bundle (topological order — bundle's dep on `-core` requires `-core` to be on the registry first); new versions on both registry pages within ~1min; `npm i @serranolabs.io/munchkins@<version>` in a sandbox project resolves both packages, and `import { registry } from "@serranolabs.io/munchkins-core"; await import("@serranolabs.io/munchkins"); registry.cli().parse(['bug-fix','--help'])` exits 0 with the expected `--user-message` flag listed.
- **Forbidden:** publish runs despite gating-job red; published `name` wrong on either package; **`bin` field PRESENT on either package** (per D9 — neither package ships a binary); tarball includes `node_modules`/`bun.lock`/unwanted files; bundle published before `-core`; `import "@serranolabs.io/munchkins"` fails to register the default bugfix agent.
- **Inspect:** publish workflow run log (verify topological order); both npm registry pages; sandbox-project import smoke test result.

## Completion Gate

A vertical slice in `plan.md` is "done" only when the verification path for each scenario it claims to deliver completes successfully:

- **S7:** `bun run scenario` exits 0, JSON `result: "pass"`, mock-call audit zero real Claude invocations, sandbox cleaned up.
- **S1/S3/S4/S5/S6:** direct-shell verification commands exit 0 against the live repo AND are asserted in `ci.yml`'s `test` job.
- **S2/S8:** operator confirms the manual subsection's expected states; pass recorded in the slice's acceptance log (recording mechanism deferred to `plan.md`).
- **S9/S10/S11/S12:** corresponding workflow triggered on real GitHub at least once with the expected outcome; operator records the workflow-run URL + downstream artifact (deployed site / npm registry version) in the slice's acceptance log.

A slice that delivers code but does not deliver verification through one of these paths is NOT done. The scaffold milestone is "done" when ALL 12 scenarios reach their respective conditions.

## Ambiguities And Walkthrough Questions

Non-blocking for `plan.md` creation; resolved in `technology-decisions.md` or `plan.md`:

1. **Mock seam mechanism** — `mock.module()` vs DI vs env-switch in `spawn-claude.ts`. (`technology-decisions.md`)
2. **Public docs host platform** — affects `docs-publish.yml` deploy step + S9 expected URL. (`technology-decisions.md`)
3. **Tag-naming convention** for `publish.yml`. (`technology-decisions.md`)
4. **Linter choice** (Biome vs ESLint) + exact `lint`/`format` command names — affects S5/S10. (`technology-decisions.md`)
5. **`bun publish` vs `npm publish`** for S12. (`technology-decisions.md`)
6. **Stub-fixture content** — exactly which deterministic-loop commands fail on which iteration in the seed fixture. (`plan.md`)
7. **Manual-pass recording mechanism** — `scenarios/manual-log.md`, PR comment, or trust-but-verify. (`plan.md`)
