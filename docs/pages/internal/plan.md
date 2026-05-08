---
stage: plan
artifact_root: docs/pages/internal/
status: approved
upstream:
  - docs/pages/internal/diagnosis.md
  - docs/pages/internal/prd.md
  - docs/pages/internal/scenario-testing-strategy.md
  - docs/pages/internal/technology-decisions.md
---

# Plan

## Problem Summary

`/Users/davidserrano/Documents/dev/ai/munchkins` is a bare git repo (`.git/` only). Materialize the scaffold described by the upstream artifacts: Bun + Turborepo monorepo with `packages/munchkins` + `docs/`, Rspress docs site rendering plan-funnel artifacts under `docs/pages/internal/` (filtered out of the public build via `PUBLIC_DOCS=true`), one-scenario harness for S7, AGENTS.md + command registry + repo-level quality gates, and three GitHub Actions workflows.

**Current state: nothing implemented.** Every artifact this plan produces must be created from scratch.

## Plan Review Findings (Stage 7 — applied)

This section records issues found during `plan-gap-review` and the corrections applied below. Listed for traceability so future readers know which slices were tightened and why.

**Critical (would break execution):**
1. **`createBugfixAgent` must be parametric** (Slice 3). The original `insider-trading/scripts/agent-bug-fix.ts` hardcodes `bun run scenario:all`, `bun run lint`, `bun run typecheck`, `bun run scripts/append-changelog-from-diff.ts` as deterministic-loop commands. Copying verbatim into `packages/munchkins` would mean the production `munchkins bugfix` subcommand tries to run `bun run scenario:all` — which IS the harness. Slice 3 is amended below to require parametric loop-command configuration.
2. **Mock-response JSON schema must match `SpawnClaudeResult`** (Slice 6). `spawnClaude` returns `{ exitCode: number, output: string, durationMs: number }`. Mock fixtures MUST produce that shape (durationMs may be 0 or fixture-supplied). Slice 6 amended.
3. **Branch protection is a manual operator action, not a workflow file** (Slice 8). S10 and S11 require `lint` and `test` to be *required* status checks on `main`; without one-time GitHub UI/API configuration, those scenarios can never block merges. Slice 8 amended to call this out as a documented prerequisite.

**High-priority (would degrade quality):**
4. **Slice 5 is a false-vertical** — it adds no new artifacts, only confirms gates pass. Restructured below as a verification checkpoint embedded inside Slices 1–4 rather than a standalone slice. The completion checks against S5 happen at the end of Slice 4.
5. **Command-registry path must be pinned** (Slice 7). If `init-project` chooses a non-discoverable path, S6 verification can't grep what it can't locate. Slice 7 amended to require the registry at `AGENTS.md` itself or at a documented sibling path.
6. **GitHub Actions versions not pinned** (Slice 8). Floating `@v4` etc. are reproducibility regressions waiting to happen. Slice 8 amended with explicit pinning policy.
7. **Plan-funnel artifacts already exist at `docs/pages/internal/`** (Slice 4). Slice 4 amended to make explicit that Rspress reads them in-place; nothing is to be relocated or duplicated.

**Parallelism gain:**
8. Slice 7 (`init-project` for AGENTS.md + cmd registry) was sequenced after Slices 1–6 in the original draft. It actually depends only on Slices 1 + 4 (scaffold + Rspress workspace; init-project reads existing scripts/structure to materialize the registry). It does NOT need Slice 6's harness or Slice 5's gate confirmation. The parallelism diagram below is corrected.

**Verification tightening:**
9. S6 verification was "AGENTS.md exists + non-empty" — too soft. Strengthened to require structural assertions (no `@insider-trading/agents` references; canonical commands present) so a later regression that empties or stubs AGENTS.md still fails the gate.
10. Slice 3 had no isolated typecheck verification. Added.

## Goal And Non-Goals

**Goal.** Land a single primary-agent execution that satisfies all 12 PRD scenarios (S1–S12) per their verification paths in `scenario-testing-strategy.md`. Done = every scenario reaches its completion gate.

**Non-goals (verbatim from upstream Out-of-Scope):**
- Public host platform beyond GitHub Pages, custom domain, DNS — out, deferred.
- CI integration beyond the three workflows in scope.
- Public docs IA / theme / branding / search / sitemap.
- Adding workspaces beyond `packages/munchkins` + `docs/` (D2).
- Migrating other `insider-trading` packages.
- Preserving git history of the moved package (D6).
- Refactoring the munchkins source beyond the D5 carve-out (`program.name("munchkins")` + `bin` field).
- Anthropic API key / rate-limit / retry handling under S7.
- Exhaustive failure-mode coverage of the bugfix-agent loop fixer.

## Scenario Harness Contract

Source of truth: `scenario-testing-strategy.md`. Summary the plan binds to:

- Single CLI: `bun run scenario`. Runs `bugfix-agent-e2e` only. Exit 0 pass, 1 fail.
- Behavior: temp-dir sandbox → real git init from `scenarios/fixtures/bugfix-agent-e2e/seed-repo/` → in-process `mock.module()` of `spawn-claude` (T1) → sandbox-local stubs for deterministic loop commands → dynamic-import the bugfix-agent constructor → invoke against sandbox → assert pipeline outcome + mock-call audit (zero real `claude` invocations).
- Boundary: harness consumes `@serranolabs.io/munchkins` via normal package exports. Munchkins package does not depend on the harness, does not accept `scenario_id`/`run_id`/harness-only inputs.
- Out-of-harness scenarios (S1, S3, S4, S5, S6 → direct shell + ci.yml; S2, S8 → manual; S9–S12 → real GitHub) are NOT routed through the harness CLI.

## Resolved Technology Decisions

Source of truth: `technology-decisions.md`. Hard constraints the plan must respect:

| ID | Decision |
|----|----------|
| T1 | `mock.module()` for Claude mock seam. Order: mock before dynamic-import. |
| T2 | GitHub Pages. Rspress `base: '/munchkins/'` when `PUBLIC_DOCS=true`. |
| T3 | `v*` semver tags trigger `publish.yml`. |
| T4 | Pinned `@biomejs/biome` + checked-in `biome.json`. CI uses `biome ci .`. |
| T5 | `bun publish --access public`. |
| T6 | Single root `tsconfig.json`; workspaces `extends`. |
| T7 | Light turbo deps (`build`/`test` `dependsOn: ["typecheck"]`). Lint runs root-level outside turbo. |
| T8 | Latest Rspress 2.x at scaffold time. |
| T9 | Manual `version` bump in `packages/munchkins/package.json`. |
| T10 | `engines.bun` + `setup-bun` pinned across workflows. |
| T11 | `publishConfig.access: "public"` on the scoped package. |

## Vertical Slices

Each slice is the thinnest useful unit that delivers user-visible progress and ties to specific PRD scenarios. Each defines completion via the verification path in `scenario-testing-strategy.md`.

---

### Slice 1 — Bare scaffold root

**Delivers:** root configuration that lets `bun install` succeed and `turbo --version` work.

**Files to create:**
- `package.json` — `private: true`, `workspaces: ["packages/*", "docs"]`, `engines.bun`, scripts (`lint`, `format`, `format:check`, `typecheck`, `test`, `build`, `scenario`, `docs:dev`, `docs:build`), devDependencies (`turbo`, `@biomejs/biome`, `typescript`, `@types/bun`).
- `turbo.json` — exactly per T7's structure.
- `tsconfig.json` — common compiler options per T6.
- `biome.json` — include/exclude globs covering `packages/`, `docs/pages/`, `scenarios/`. Standard formatter rules. Strict-but-not-pedantic linter rule set.
- `.gitignore` — `node_modules`, `dist`, `doc_build`, `.turbo`, `bun.lock` is committed (deliberate — it's the lockfile), `.env*` (defensive).
- `bun.lock` — generated by `bun install`.

**Completion:**
- `bun install` exits 0.
- `bun run lint` (against an empty repo body) exits 0 (biome reports nothing to do or formatting clean).
- `bun run typecheck` exits 0 (no source yet — turbo finds no workspaces with the task — passes).
- No PRD scenarios are fully verified yet; this is a foundation slice. Partial-progress on S5 (quality gates exist).

---

### Slice 2 — Move `packages/munchkins` and verify CLI

**Delivers:** S1 (munchkins CLI runs from the new monorepo).

**Files to create:**
- `packages/munchkins/package.json` — copy from `insider-trading/packages/agents/package.json`, rename `name` to `@serranolabs.io/munchkins`, add `bin: { "munchkins": "./src/cli/index.ts" }`, add `publishConfig: { "access": "public" }`, keep `main`, scripts, dependencies (`commander`).
- `packages/munchkins/tsconfig.json` — extends root tsconfig per T6, `include: ["src/**/*"]`.
- `packages/munchkins/src/**/*` — flat copy of `insider-trading/packages/agents/src/**/*` (12 files: `worktree.ts`, `spawn.ts`, `changelog.ts`, `cli/{index,agent,workflow,autonomous,changelog}.ts`, `builder/{agent-builder,spawn-claude,prompt,index}.ts`).
- **Edit (D4 carve-out):** in `packages/munchkins/src/cli/index.ts`, change `program.name("agents")` to `program.name("munchkins")`. Single-line edit, only source-content change.

**Do NOT copy:** `insider-trading/packages/agents/node_modules/`, `insider-trading/packages/agents/bun.lock`.

**Completion:**
- `bun install` exits 0 with the new workspace.
- `bun run --cwd packages/munchkins cli --help` (S1 verification): exits 0, stdout contains `munchkins` as program name and the four subcommand names (`agent`, `workflow`, `autonomous`, `changelog`).
- `bun run typecheck` passes for the workspace.

---

### Slice 3 — Bugfix-agent constructor exported

**Delivers:** the construction primitive S7 will exercise, plus a `munchkins bugfix` CLI subcommand for production use.

**Critical correction (Review Finding 1):** the constructor MUST be parametric. The original `insider-trading/scripts/agent-bug-fix.ts` hardcoded loop commands (`bun run scenario:all`, `bun run lint`, `bun run typecheck`, `bun run scripts/append-changelog-from-diff.ts`). Those names are insider-trading-specific. Copying them into `packages/munchkins` verbatim would have the `munchkins bugfix` subcommand try to invoke a `scenario:all` script that is the harness, not a runtime check. The constructor's signature configures these per-call.

**Files to create:**
- `packages/munchkins/src/builder/bugfix-agent.ts` — exports:
  ```ts
  interface BugfixAgentOptions {
    focus: string;                    // path to bug.md
    promptDir?: string;               // default "docs/subagents"
    loopCommands?: {
      scenarios?: string[];           // default: []
      checks?: string[];              // default: ["bun run lint", "bun run typecheck"]
      changelog?: string[];           // default: []
    };
    finalize?: {
      onPass?: string[];
      onFail?: string[];
    };
  }
  export function createBugfixAgent(opts: BugfixAgentOptions): AgentBuilder;
  ```
  Body wires `AgentBuilder` exactly as the original pattern: agent step (`bug-fix.md`) → agent step (`refactorer.md`) → deterministic loop step from `loopCommands.scenarios` (skipped if empty) → deterministic loop step from `loopCommands.checks` → deterministic loop step from `loopCommands.changelog` (skipped if empty) → finalize. Each deterministic step retains the 3-iteration fixer loop from the original.
- `packages/munchkins/src/cli/bugfix.ts` — commander subcommand `munchkins bugfix --focus=<path>`. Calls `createBugfixAgent({ focus })` with no override (uses defaults: lint+typecheck only as the check loop). Production users override via direct API import if they need richer loops; the CLI surface stays simple.
- **Edit:** `packages/munchkins/src/cli/index.ts` — add `program.addCommand(bugfixCommand)`.
- **Edit:** `packages/munchkins/src/builder/index.ts` — re-export `createBugfixAgent` and `BugfixAgentOptions`.
- `packages/munchkins/docs/subagents/bug-fix.md`, `refactorer.md`, `deterministic-fixer.md` — minimal placeholder prompt files. Need to exist and be non-empty so the default `promptDir` resolves under production invocation.

**Completion:**
- `bun run typecheck` exits 0 — both the workspace and root scopes (Review Finding 10).
- `bun run --cwd packages/munchkins cli --help` lists `bugfix` as a subcommand alongside `agent`, `workflow`, `autonomous`, `changelog`.
- `bun run --cwd packages/munchkins cli bugfix --help` exits 0 and prints usage with `--focus` documented.
- Importing `createBugfixAgent` in TS resolves cleanly (verified by Slice 6).
- No PRD scenario is fully verified by this slice; it's a prerequisite for S7.

---

### Slice 4 — Rspress workspace

**Delivers:** S2 (manual), S3, S4, AND S5 (via the slice's completion checks — see Review Finding 4 below).

**Important (Review Finding 7):** the plan-funnel artifacts already exist at `docs/pages/internal/{diagnosis,prd,scenario-testing-strategy,technology-decisions,plan}.md`. They are the artifacts this plan was produced from. Slice 4 reads them in-place — it does NOT relocate, duplicate, or rewrite them. Custom frontmatter fields (`stage`, `artifact_root`, `status`, `upstream`) are non-standard for Rspress; Rspress 2.x ignores unknown frontmatter, so they are harmless.

**Files to create:**
- `docs/package.json` — name `docs`, `private: true`, scripts `dev` / `build` / `preview`, dep `@rspress/core` at scaffold-time-latest 2.x (T8), devDeps `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@types/node`.
- `docs/tsconfig.json` — extends root tsconfig per T6.
- `docs/rspress.config.ts` —
  - `root: path.join(__dirname, 'pages')`
  - `base: process.env.PUBLIC_DOCS === 'true' ? '/munchkins/' : '/'` (T2)
  - `route: { exclude: process.env.PUBLIC_DOCS === 'true' ? ['**/internal/**'] : [] }` (D3 / PRD)
  - `title`, `description` placeholders.
- `docs/pages/index.mdx` — minimal landing page (one heading, one sentence). Required so S3/S4 have a non-internal page to verify build outputs against.
- `docs/pages/_meta.json` — top-level nav stub (excluding `internal/` from the public sidebar; including it in dev nav per the env gate is a downstream config detail).
- `docs/pages/internal/_meta.json` — sidebar listing for the plan-funnel artifacts (`diagnosis`, `prd`, `scenario-testing-strategy`, `technology-decisions`, `plan`) so dev-mode S2 verification has a working sidebar.

**Completion:**
- `bun install` succeeds with the new workspace.
- `bun run docs:dev` starts the dev server. **S2 manual verification** per its subsection in `scenario-testing-strategy.md`.
- `PUBLIC_DOCS=true bun run docs:build` succeeds. **S3 verification:** `! grep -rq "Diagnosis — Choose the monorepo layout" docs/doc_build/` returns 0 (no match).
- `bun run docs:build` (no env) succeeds. **S4 verification:** `grep -rq "Diagnosis — Choose the monorepo layout" docs/doc_build/` returns 0 (matches found).
- **S5 verification (Review Finding 4 — folded in here, not a separate slice):** `bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build` exits 0 in sequence on the post-Slice-4 repo state. Any actual lint/type/format issues that emerge from the moved package's source (Slice 2) or the bugfix-agent additions (Slice 3) get resolved here by tightening `biome.json`, the workspace `tsconfig.json`, or the offending source. The `test` script may be a no-op until Slice 6 wires the harness; an empty pass is acceptable for the scaffold milestone (`turbo run test` with no workspace `test` scripts exits clean).

---

### Slice 5 — REMOVED (folded into Slice 4)

The original Slice 5 was a verification-only slice that delivered no new artifacts. Per Review Finding 4, the S5 verification is now performed at the end of Slice 4 (see Slice 4's completion checks above). This keeps slices vertical and removes a false-vertical from the plan. Slice numbering for downstream slices is preserved (Slice 6, 7, 8) to avoid renumbering churn in references.

---

### Slice 6 — Scenario harness for S7

**Delivers:** S7 (`bugfix-agent-e2e`).

**Files to create:**
- `scenarios/index.ts` — entry. **Order-critical:** call `mock.module(...)` for the spawn-claude module path BEFORE the dynamic `await import('@serranolabs.io/munchkins')` line that pulls the bugfix-agent constructor. T1's contract.
- `scenarios/lib/sandbox.ts` — `createSandbox()` returns `{ path, cleanup }`. Creates temp dir under `os.tmpdir()`, copies seed-repo template, runs `git init` + `git add -A` + `git commit -m "seed"`, sets up env vars (`WORKTREE`, `BRANCH`, `REPO_ROOT`).
- `scenarios/lib/mock-spawn-claude.ts` — exports a mock factory that consumes responses from the fixture in order. Also wraps `Bun.spawn` to reject any spawn whose argv starts with `claude` (the audit guard).
- `scenarios/lib/stub-deterministic.ts` — sandbox-local stub script(s) for `scenario:all`, `lint`, `typecheck`, changelog. Behavior driven by `stub-script-config.json`.
- `scenarios/lib/result.ts` — JSON result schema printer per the strategy doc.
- `scenarios/fixtures/bugfix-agent-e2e/seed-repo/` — synthetic repo template:
  - `package.json` with `scripts.lint`, `scripts.typecheck`, `scripts.scenario:all`, `scripts.append-changelog` all pointing to the sandbox stubs.
  - `docs/subagents/bug-fix.md`, `refactorer.md`, `deterministic-fixer.md` — minimal stub content.
  - One synthetic broken file + one synthetic test that depends on it (the "bug").
  - One `bug-focus.md` for `--focus=`.
- `scenarios/fixtures/bugfix-agent-e2e/mock-claude-responses/` — JSON files indexed by step. **Schema (Review Finding 2):** each file matches `SpawnClaudeResult` exactly:
  ```json
  {
    "exitCode": 0,
    "output": "<canned assistant output the agent step is meant to produce>",
    "durationMs": 0
  }
  ```
  `exitCode: 0` for success steps. `output` carries the canned assistant response — typically a short string the surrounding `AgentBuilder` machinery treats as a successful agent turn. Fixture files: `01-bug-fix.json` (response to the `bug-fix` agent step), `02-refactorer.json` (response to the `refactorer` step). Optional `03-fixer-iter-N.json` files (one per iteration) are included only if `stub-script-config.json` schedules a fail-then-pass loop. The mock loader consumes these in alphabetical filename order, one per `spawnClaude` invocation. If `AgentBuilder` invokes `spawnClaude` more times than there are fixture files, the harness fails with `"phase": "execution", "message": "mock fixture exhausted"`.
- `scenarios/fixtures/bugfix-agent-e2e/stub-script-config.json` — declares which deterministic-loop commands fail on which iteration. For the seed scenario: all stubs pass on first invocation (simplest valid path). A second checked-in fixture variant exercising one fail-then-pass loop iteration is acceptable but not required for the milestone (PRD Out-of-Scope item).

**Completion (S7 verification):**
- `bun run scenario` exits 0.
- Structured JSON result `result: "pass"`, `mockCallLog` length matches expected sequence, `stubCallLog` matches expected order.
- The `Bun.spawn` audit reports zero `claude` invocations.
- Sandbox dir is removed on success; preserved on failure with path printed.

---

### Slice 7 — AGENTS.md + command registry

**Delivers:** S6 (AGENTS.md + command registry exist and are non-empty AND structurally correct).

**Approach:** invoke `init-project` skill with the upstream artifacts as input. `init-project` materializes `AGENTS.md` + the command registry per its own conventions, respecting D2 (no extra workspaces) and D3 (env-gated `route.exclude`).

**Constraints to enforce when invoking init-project (HARD; reject violating output):**
- It must NOT add `packages/backend`, `packages/ui`, `packages/shared`, or `packages/scenarios` workspaces.
- It must NOT modify `rspress.config.ts` to remove or alter the env-gated `route.exclude`.
- It must NOT replace `scenarios/` with its own scenario workflow output (Slice 6 already materialized it).
- It must NOT add or change technology decisions locked in `technology-decisions.md` (e.g., it cannot swap Biome for ESLint).
- **Command registry path is pinned (Review Finding 5):** the canonical commands MUST appear either inline in `AGENTS.md` or in `AGENTS.md`'s sibling file `commands.md` at repo root. No deeper-nested location is acceptable. S6's verification grep depends on this fixed location.
- The command registry MUST list, at minimum: `docs:dev`, `docs:build`, `cli` (with note that the binary is `munchkins`), `typecheck`, `lint`, `format`, `format:check`, `test`, `build`, `scenario`. Each entry: name, purpose (one sentence), invocation.

**Completion (S6 verification — strengthened per Review Finding 9):**
- `AGENTS.md` exists at repo root and is non-empty.
- `AGENTS.md` (or `commands.md` if used) contains a command-registry section with every canonical command listed above.
- `grep -F "@insider-trading/agents" AGENTS.md commands.md 2>/dev/null` returns no matches (would-be-stale references to the source repo's package name).
- `grep -F "@serranolabs.io/munchkins" AGENTS.md` returns ≥1 match (the registry references the correct package).
- `grep -F "munchkins" AGENTS.md` returns multiple matches (the operating contract names the project).

**Fallback if `init-project` cannot satisfy the constraints:** hand-author `AGENTS.md` + `commands.md`. Time cost is small (≤30 lines each). Document fallback choice in this slice's commit message.

---

### Slice 8 — GitHub Actions workflows + manual prerequisites

**Delivers:** S9, S10, S11, S12.

**Manual prerequisites (Review Finding 3) — NOT code, MUST be configured by an operator BEFORE S10/S11 can be verified:**
1. **Branch protection on `main`** with required status checks set to `lint` and `test` (the job names from `ci.yml`). Configure via GitHub UI (Settings → Branches → Branch protection rules) or via API. Without this, S10 and S11 can never block a merge — the workflows would run, fail red, and the PR could still merge. This is a one-time setup recorded in the slice's acceptance log.
2. **Repository secret `NPM_TOKEN`** with publish rights to the `@serranolabs.io` npm scope. Configure via Settings → Secrets and variables → Actions. Required for S12.
3. **GitHub Pages source set to "GitHub Actions"** (Settings → Pages → Source). Required for S9's `actions/deploy-pages` to succeed.

**Action pinning policy (Review Finding 6):** every third-party action is pinned to either a major-version tag (`@v4`) acceptable for first-party `actions/*` and `oven-sh/setup-bun`, OR a full commit SHA for any community/non-first-party action (none currently in use; this rule covers future additions).

**Files to create under `.github/workflows/`:**

- **`ci.yml`** — triggers `pull_request` and `push: branches: [main]`. Top-level `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` so rapid pushes cancel stale runs. Two jobs:
  - `lint` — `actions/checkout@v4`, `oven-sh/setup-bun@v2` with `bun-version` pinned per T10, `bun install --frozen-lockfile`, `biome ci .`.
  - `test` — `actions/checkout@v4`, `setup-bun@v2`, `bun install --frozen-lockfile`, `bun run typecheck`, `bun run scenario` (S11's required check; harness exit code surfaces here).

- **`docs-publish.yml`** — triggers `push: branches: [main]` with `paths: ['docs/**']` and `paths-ignore: ['docs/pages/internal/**']`. Top-level `concurrency: { group: pages, cancel-in-progress: false }` (deploys serialize). Permissions: `pages: write`, `id-token: write`. Single job:
  - `actions/checkout@v4`, `setup-bun@v2`, `bun install --frozen-lockfile`.
  - `PUBLIC_DOCS=true bun run docs:build` (env var set on the step, not workflow-wide).
  - `actions/configure-pages@v5`.
  - `actions/upload-pages-artifact@v3` with `path: docs/doc_build`.
  - `actions/deploy-pages@v4`.

- **`publish.yml`** — triggers `push: tags: ['v*']` (T3). Two jobs:
  - `gate` — duplicates the steps of `ci.yml`'s `lint` and `test` jobs inline (chosen over `workflow_call` for simpler tag-driven semantics; minor DRY tradeoff is acceptable for a 3-workflow repo).
  - `publish` — `needs: gate`. `actions/checkout@v4`, `setup-bun@v2`, `bun install --frozen-lockfile`. Write `.npmrc`:
    ```
    echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" > ~/.npmrc
    ```
    (Note: GitHub Actions secrets are masked in logs, but this echo's output is suppressed by writing to a file rather than stdout.)
    Then `bun publish --cwd packages/munchkins`. The `--access public` flag is unnecessary at the CLI because `publishConfig.access: "public"` is in `package.json` (T11) — but adding it as a belt-and-suspenders flag is harmless.

**Completion:**
- **S9 manual verification** — push a docs change, observe `docs-publish` runs and deploys; push an internal-only change, observe NO workflow run.
- **S10 manual verification** — open a PR with a deliberate lint violation, observe `lint` job fails red and merge is blocked.
- **S11 manual verification** — open a PR that breaks `bugfix-agent-e2e`, observe `test` job fails red, merge blocked, harness output present in job log.
- **S12 manual verification** — bump version to `0.0.0-alpha.0`, push tag `v0.0.0-alpha.0`, observe `publish` workflow runs end-to-end, package appears on npm registry, `npm i -g @serranolabs.io/munchkins@0.0.0-alpha.0 && munchkins --help` works.
- Manual-verification outcomes recorded per Slice 7's command-registry acceptance log mechanism (or the slice's PR comment, as plan.md does not lock the recording medium).

## Slice Order And Dependencies

(Slice 5 removed per Review Finding 4; its S5 verification folded into Slice 4. Slice numbering preserved for reference stability.)

```
Slice 1 (scaffold)
  ├──► Slice 2 (move package + S1)
  │      └──► Slice 3 (bugfix-agent constructor)
  │             └──► Slice 6 (S7 harness) ────┐
  └──► Slice 4 (Rspress + S2/S3/S4 + S5) ─────┤
                                              │
                          ┌───────────────────┘
                          ▼
                      Slice 7 (init-project + S6)
                          │
                          ▼
                      Slice 8 (workflows + S9/S10/S11/S12)
```

- **Slice 1** is the foundation. Nothing else can start without it.
- **Slices 2 and 4** are independent of each other given Slice 1.
- **Slice 3** depends on Slice 2 (needs the moved package).
- **Slice 4** absorbs the S5 verification (Review Finding 4). Once Slice 4 lands and lint/typecheck/format/test/build all pass, S5 is satisfied.
- **Slice 6** depends on Slice 3 (needs the bugfix-agent constructor exported).
- **Slice 7** depends only on Slice 1 (root scaffold) and Slice 4 (Rspress workspace) — `init-project` reads the existing scaffold + docs structure to materialize `AGENTS.md` + `commands.md`. It does NOT need the bugfix-agent constructor or harness in place (Review Finding 8).
- **Slice 8** depends on Slice 4 (lint/test commands established in Slice 1 + verified in Slice 4) AND Slice 6 (test job runs `bun run scenario`). Slice 8 does NOT need Slice 7's AGENTS.md.

## Parallelizable Work

(Updated per Review Finding 8 — Slice 7 was over-sequenced in the original draft.)

**Two-agent parallel split (recommended):**

- **Agent A:** `Slice 1 → Slice 2 → Slice 3 → Slice 6`. Owns the moved package + bugfix-agent constructor + S7 harness.
- **Agent B (concurrent with A after Slice 1):** `Slice 4`. Owns Rspress + S2/S3/S4/S5.

After both agents converge, Slices 7 and 8 become eligible:

- **Slice 7** can run as soon as Slice 4 is complete (parallel with Agent A's still-in-flight Slice 6 work).
- **Slice 8** must wait for Slices 4 + 6 (its `test` job invokes `bun run scenario` from Slice 6, and its lint/test commands are validated by Slice 4).

**Single-agent linear order:** `1 → 2 → 3 → 4 → 6 → 7 → 8` is correct and has no skipped dependencies. (Slice 5's number is intentionally absent — it was removed.) This is the order a single primary agent should execute.

**Cannot-parallel constraints:**
- Slice 3 cannot start before Slice 2 (needs the moved package).
- Slice 6 cannot start before Slice 3 (needs the constructor).
- Slice 8 cannot start before both Slice 4 and Slice 6 are complete.

## Risks And Failure Modes

1. **Mock-order regression in Slice 6.** Bun's `mock.module()` only takes effect for imports that happen AFTER the mock call. If a future refactor of `scenarios/index.ts` switches from dynamic `await import()` to static `import` of the bugfix-agent constructor, the static import is hoisted above the mock call and the real `spawn-claude` resolves. **Mitigation:** the `Bun.spawn` audit guard in `mock-spawn-claude.ts` catches this — any real `claude` spawn fails the scenario. The harness must NEVER be relaxed to skip this audit.

2. **Subagent prompt files missing in production callers.** The bugfix-agent constructor resolves `Prompt` paths relative to repo root by default (`docs/subagents/bug-fix.md`). If a future consumer of `@serranolabs.io/munchkins` doesn't ship those files, the agent fails at construction time. **Mitigation:** Slice 3 ships placeholder prompt files at `packages/munchkins/docs/subagents/` AND the constructor accepts a `promptDir` option to point elsewhere. Documented in `AGENTS.md` (Slice 7).

3. **Rspress `base` mismatch.** If `PUBLIC_DOCS=true` is forgotten in the workflow, the deploy goes out without the `/munchkins/` prefix and all asset URLs break under GitHub Pages. **Mitigation:** Slice 8's `docs-publish.yml` sets `PUBLIC_DOCS=true` as a step env var, and the post-deploy public URL is hand-checked in S9 manual verification.

4. **`docs-publish.yml` path filter regression.** A typo in `paths-ignore` could let internal-only commits trigger deploys. **Mitigation:** S9 manual verification explicitly tests an internal-only commit and confirms NO workflow run.

5. **`npm publish` race or duplicate version.** If the version in `package.json` is not bumped before tagging, `bun publish` fails. **Mitigation:** the publish step's failure is fatal (no fallback), and S12 manual verification uses pre-release versions (`0.0.0-alpha.X`) for first round-trip testing.

6. **`init-project` overshoot in Slice 7.** `init-project` may try to add a `packages/scenarios` workspace, modify the env-gated `route.exclude`, or otherwise expand scope beyond D2/D3. **Mitigation:** explicit constraints declared at the top of Slice 7. Reject any init-project diff that violates them before commit.

7. **`Prompt.resolve()` working-directory assumption.** The original `Prompt` class resolves paths relative to a `repoRoot` argument passed in by `AgentBuilder.run()` (which itself runs `git rev-parse --show-toplevel`). In the harness sandbox, `repoRoot` will be the temp dir, NOT the munchkins repo. The seed-repo fixture must include the prompt files at the expected path INSIDE the sandbox. **Mitigation:** documented in Slice 6's seed-repo file list above.

8. **Slice 8 manual prerequisites missed or misconfigured.** Branch protection on `main` requiring `lint` + `test` checks is a one-time GitHub UI/API action — easy to forget. Without it, S10 and S11 manual verification will report "PR could merge despite red X." NPM_TOKEN missing or scoped to the wrong scope will fail S12 silently at the publish step. GitHub Pages source not set to "GitHub Actions" will make `actions/deploy-pages` fail with a misleading error. **Mitigation:** Slice 8's commit message MUST include a checklist confirming all three manual prerequisites were configured, with screenshots or API-response excerpts pasted into the slice's acceptance log. Until those are confirmed, the slice is not done.

## Execution Notes

- **Use `bun install` after every slice that adds or edits a `package.json`.** Each slice's verification depends on a fresh dependency state.
- **Do not run real `claude` during harness work.** If Slice 6's harness fails to install mocks correctly, it should fail loudly via the `Bun.spawn` audit — never fall back to invoking real Claude.
- **Don't bundle slice work.** Each slice is committed independently with verification output in the commit message (PRD scenario IDs the slice satisfies + scenario-result JSON for harness scenarios).
- **`init-project` invocation in Slice 7 is downstream of plan-funnel.** The plan-funnel itself ends here — at confirming this plan. Implementation is handed off via `initialize-work` and `build-feature` per the plan-funnel skill's contract.
- **Manual-verification recording.** Until plan locks a mechanism, record manual-pass/fail outcomes in the slice's commit message body or PR description. A `scenarios/manual-log.md` file is acceptable but not required for the scaffold milestone.
- **D4 carve-out is exactly one line.** `program.name("agents")` → `program.name("munchkins")` in `packages/munchkins/src/cli/index.ts`. Any other source-content change to the moved package files in Slice 2 is a scope creep — flag and stop.
