---
stage: prd
artifact_root: docs/pages/internal/
status: draft
upstream:
  - docs/pages/internal/diagnosis.md
---

# PRD — Munchkins monorepo scaffold + `agents` package import + Rspress plan-funnel surface

## Problem Statement

The repo at `/Users/davidserrano/Documents/dev/ai/munchkins` is a bare git repo (`.git/` only). To do work, the user needs:

1. A working Bun + Turborepo monorepo scaffold rooted there.
2. The existing `@insider-trading/agents` package, which today lives in a separate repo, brought in as a workspace under the `@serranolabs.io/` namespace and renamed to `@serranolabs.io/munchkins` on import. Its CLI binary command is renamed from `agents` to `munchkins` (the only source-content edit during the move; subcommand names are unchanged).
3. An Rspress docs site that renders plan-funnel planning artifacts under `docs/pages/internal/` for local reading, while filtering those artifacts out of the public docs build.
4. Cross-cutting operating discipline (`AGENTS.md` operating contract, a command registry, repo-level quality gates, and a scenario workflow harness) so the monorepo is usable, not just present.

**Current implementation status: missing.** Nothing on this list exists in the repo today. The repo contains only `.git/`. Diagnosis has been completed, but no scaffold, no package, no docs site, no quality gates, and no scenario workflow exist yet. The scaffold is greenfield — there is no partial state to reconcile with, no broken capability to soften with words like "in progress" or "needs hardening."

## Solution

A single greenfield scaffold operation, executed from a verified plan, producing:

- **Repository shape** mirroring the user's existing `insider-trading` monorepo idiom: root `package.json` declaring Bun workspaces matching `packages/*` and `docs`, root `turbo.json` orchestrating tasks across workspaces, root `tsconfig.json`, root `bun.lock`. Layout lives under decision **D1 / Option A** of `diagnosis.md`.
- **`packages/munchkins`**, flat-copied from `insider-trading/packages/agents/`, with package name renamed to `@serranolabs.io/munchkins`, internal source layout preserved verbatim, and the package's CLI invocable from the new monorepo.
- **`docs/`** as a Bun workspace owning Rspress and its React/`@rspress/core` dependencies. Its `rspress.config.ts` sets `root: path.join(__dirname, 'pages')`, exposing `docs/pages/**` as the renderable content tree. `docs/pages/internal/` holds plan-funnel artifacts and renders during local dev. Public production builds (`PUBLIC_DOCS=true`) filter `**/internal/**` out via `route.exclude`.
- **Cross-cutting deliverables** materialized by invoking the `init-project` skill downstream of plan-funnel completion: `AGENTS.md`, command registry, repo-level quality gates (typecheck, lint, test, format), and a scenario workflow harness rooted at `scenarios/` (a directory, not a workspace).

The scaffold honors plan-funnel boundary rules: no harness identifiers leak into product routes. The `agents` CLI is product-facing; the `scenarios/` harness adapts to it, never the other way around.

## User Scenarios

Each scenario below describes one observable behavior. Each maps 1:1 to an E2E scenario authored in Stage 4 (`scenario-testing-strategy.md`).

### S1 — Developer runs the `munchkins` CLI from the new monorepo

**Pre-state:** Munchkins repo is fully scaffolded. `packages/munchkins` exists with renamed package name (`@serranolabs.io/munchkins`) and renamed CLI binary command (`munchkins`, declared via `package.json` `bin` field). Dependencies installed via `bun install` at the repo root.

**Action:** From the repo root, the developer runs the CLI (e.g., `bun run --cwd packages/munchkins cli --help`, or via a root script alias, or — once published and installed — directly as `munchkins --help`).

**Expected:** The CLI prints its top-level help with `munchkins` as the program name, listing the four subcommands present in the source today (`agent`, `workflow`, `autonomous`, `changelog`). Process exits 0. No `MODULE_NOT_FOUND` errors. No references to `@insider-trading/` resolve from inside the package.

**Current status:** missing. The source package is in `insider-trading/packages/agents/`, its `package.json` is named `@insider-trading/agents`, and the CLI source today calls `program.name("agents")`.

---

### S2 — Developer reads a plan-funnel artifact in local Rspress dev

**Pre-state:** Munchkins repo is fully scaffolded. Plan-funnel artifacts (`diagnosis.md`, `prd.md`, etc.) exist under `docs/pages/internal/`. `docs/` workspace dependencies installed.

**Action:** Developer runs `bun run docs:dev` (or workspace-scoped equivalent) from repo root. Rspress dev server starts. Developer opens a browser to the dev server URL and navigates to the route corresponding to one plan-funnel artifact (e.g., `/internal/diagnosis`).

**Expected:** The artifact renders as a styled Rspress page with frontmatter respected, internal links to sibling artifacts work, and the page is reachable in the dev server's nav. No 404. No build error. No reference to a missing `_meta.json` in console.

**Current status:** missing. No Rspress workspace exists; `docs/pages/internal/diagnosis.md` exists but is not yet rendered.

---

### S3 — Developer builds the public docs and verifies internal artifacts are excluded

**Pre-state:** Same as S2. At least one non-internal page exists under `docs/pages/` (an `index.mdx` landing page is sufficient).

**Action:** Developer runs `PUBLIC_DOCS=true bun run docs:build` from the repo root. Build completes. Developer inspects the build output directory (`docs/doc_build/` or whatever Rspress emits per its config).

**Expected:** The build output contains the public landing page and any other non-internal pages. The build output does NOT contain any HTML, JSON, or asset file derived from `docs/pages/internal/**`. A grep for "Diagnosis — Choose the monorepo layout" or any other plan-funnel artifact title in the build output returns zero matches. Build process exits 0.

**Current status:** missing. No build mechanism exists, no env-gated `route.exclude` wiring exists.

---

### S4 — Developer builds the local docs without the env flag and confirms internal artifacts ARE included

**Pre-state:** Same as S3.

**Action:** Developer runs `bun run docs:build` (no `PUBLIC_DOCS` env var) from the repo root. Build completes. Developer inspects build output.

**Expected:** Build output contains both public pages AND internal pages. Plan-funnel artifact titles ARE present in the build output. Build process exits 0. This is the local/preview mode — useful for the developer to preview the full doc site before deciding to publish.

**Current status:** missing. Inverse of S3, depends on the same env-gated wiring.

---

### S5 — Developer runs repo-level quality gates and sees them all pass on a clean scaffold

**Pre-state:** Munchkins repo is fully scaffolded. No source has been edited since scaffold completion. Dependencies installed.

**Action:** Developer runs the four quality-gate commands in sequence from repo root: typecheck, lint, format check, test.

**Expected:** All four exit 0. Typecheck reports no errors across `packages/munchkins` and `docs/`. Lint reports no violations. Format check reports no diffs. Test command exits 0 even if no tests exist yet (an empty pass is acceptable for the scaffold milestone).

**Current status:** missing. No quality-gate tooling configured.

---

### S6 — Developer reads `AGENTS.md` and the command registry to understand how the repo is operated

**Pre-state:** Munchkins repo is fully scaffolded.

**Action:** Developer opens `AGENTS.md` at the repo root. Developer locates the command registry (per `init-project` convention, this is a discoverable file or section of `AGENTS.md`).

**Expected:** `AGENTS.md` exists, is non-empty, describes the repo's operating contract (how agents work in this repo, what commands are sanctioned, where outputs go). Command registry lists the named commands the repo supports (at minimum: `docs:dev`, `docs:build`, `cli` for agents, `typecheck`, `lint`, `test`, plus the scenario harness entry). Each entry describes purpose and invocation. Reader can run any listed command without inferring it from `package.json` scripts alone.

**Current status:** missing.

---

### S7 — Developer runs the scenario harness, which executes a constructed bugfix agent inside a fully simulated environment with all Claude calls mocked

**Pre-state:** Munchkins repo is fully scaffolded. The munchkins package exposes a constructable bugfix agent (built with `AgentBuilder`, modeled on `insider-trading/scripts/agent-bug-fix.ts`: agent step → refactorer step → deterministic loop steps → finalize). The scenario harness lives at `scenarios/` (directory, not workspace) and is the single CLI-invocable contract for E2E verification.

**Action:** Developer runs the scenario harness CLI (e.g., `bun run scenario list`, then `bun run scenario run bugfix-agent-e2e`). The harness:

1. Creates a sandbox directory containing a temporary git repo seeded with a synthetic "bug" fixture (a known-broken file, a known-passing test that the bug breaks, etc.).
2. Replaces the munchkins package's Claude-call seam (`spawnClaude` from `packages/munchkins/src/builder/spawn-claude.ts`) with a mock that returns canned, fixture-driven responses indexed by step (`bug-fix` step response → `refactorer` step response → `deterministic-fixer` responses if the loop fires).
3. Replaces or stubs the deterministic loop commands (`bun run scenario:all`, `bun run lint`, `bun run typecheck`, changelog append) with sandbox-local equivalents that exit 0 by default and can be configured per fixture to fail-then-pass to exercise the loop's fixer agent.
4. Invokes the constructed bugfix agent against the sandbox.
5. Asserts on the deterministic outcome: agent pipeline reached `PASS`, the expected commits exist on the expected branch, the canned mock responses were consumed in the expected order, no real `claude` binary was invoked.

**Expected:**
- `scenario list` prints at least the `bugfix-agent-e2e` scenario with a description.
- `scenario run bugfix-agent-e2e` executes deterministically, prints a structured result, and exits 0.
- ZERO real Claude API calls or `claude` CLI invocations occurred during the run (verifiable via the mock's call log).
- The sandbox is cleaned up on success and preserved on failure for inspection.
- The harness does NOT hardcode `scenario_id` or `run_id` into the munchkins CLI surface or any product route — those identifiers stay inside the harness fixture/result schema.

**Current status:** missing. No harness, no mock seam, no constructed bugfix agent in the new monorepo. The pattern from `insider-trading/scripts/agent-bug-fix.ts` exists as reference but is not portable as-is (it imports relative paths and depends on insider-trading-specific scripts like `scenario:all` and `append-changelog-from-diff.ts`).

---

### S8 — Developer adds a new plan-funnel artifact and it surfaces in Rspress nav within local dev

**Pre-state:** Same as S2. Rspress dev server can be running or restarted.

**Action:** Developer writes a new file at `docs/pages/internal/<some-name>.md` and saves it. Optionally edits `docs/pages/internal/_meta.json` (or its equivalent) to add the page to the sidebar.

**Expected:** Within the dev server's HMR cycle, the new page is reachable at the corresponding route. If a `_meta.json` was edited, the new page appears in the sidebar. No restart required for content edits. Restart may be required for `_meta.json` edits depending on Rspress version behavior (acceptable).

**Current status:** missing.

---

### S9 — A push to `main` changing the docsite triggers a public docs publish via GitHub Actions

**Pre-state:** Munchkins repo is fully scaffolded, GitHub Actions workflows are committed, the public docs host is configured (host platform is decided in `technology-decisions.md`), and the necessary deploy credentials are available as repo secrets.

**Action:** Developer commits and pushes a non-internal docsite change (e.g., edits `docs/pages/index.mdx`) to `main`. The push affects paths under `docs/**` excluding `docs/pages/internal/**`.

**Expected:** A GitHub Actions workflow named `docs-publish` (or equivalent) runs automatically. The workflow installs deps, runs `PUBLIC_DOCS=true bun run docs:build`, and deploys the build output to the configured public host. Workflow exits 0. The public site, when fetched after the workflow completes, reflects the committed change. The workflow does NOT run on changes confined to `docs/pages/internal/**`, since those are filtered out of the public build and would be wasted runs.

**Current status:** missing. No `.github/workflows/` directory, no host configured.

---

### S10 — A pull request runs lint as a required check and blocks merge on lint failure

**Pre-state:** Munchkins repo is fully scaffolded, GitHub Actions workflows committed, branch protection on `main` requires the lint check to pass.

**Action:** Developer opens a PR introducing a deliberate lint violation (e.g., unused import, formatting violation that the chosen linter flags).

**Expected:** A GitHub Actions workflow runs the `lint` job. The lint job fails with a non-zero exit code. The PR's merge button is blocked by the failed required check. Removing the violation and pushing makes the lint job pass and unblocks merge. Workflow runs on every PR and on every push to `main` (post-merge re-verification).

**Current status:** missing.

---

### S11 — A pull request runs the test suite as a required check and blocks merge on test failure

**Pre-state:** Same as S10. Test suite includes at least the S7 scenario harness E2E run plus any unit tests added during scaffolding.

**Action:** Developer opens a PR that breaks a test (or adds a deliberately failing test).

**Expected:** A GitHub Actions workflow runs the `test` job. The job fails with a non-zero exit code. The PR's merge button is blocked. The S7 scenario harness run is part of the test job (or a sibling required job) so a regression in the bugfix-agent simulation gates merges.

**Current status:** missing.

---

### S12 — Tagging a release triggers `npm publish` for `@serranolabs.io/munchkins`

**Pre-state:** Munchkins repo is fully scaffolded, the publish workflow is committed, an `NPM_TOKEN` repo secret with publish rights to the `@serranolabs.io` npm scope is configured, and the package's `package.json` has the next version set.

**Action:** Developer creates and pushes a git tag matching the agreed-upon pattern (e.g., `agents-v0.1.0` or `v0.1.0` — pattern is decided in `technology-decisions.md`).

**Expected:** A GitHub Actions workflow named `publish` (or equivalent) runs automatically on the tag push. The workflow installs deps, runs lint + test as gating jobs, and on green publishes `packages/munchkins` to npm under `@serranolabs.io/munchkins`. The published version matches the tag. A subsequent `npm view @serranolabs.io/agents version` returns the published version. Workflow exits 0.

If lint or test fail, publish is skipped and the workflow exits non-zero.

**Current status:** missing. No publish workflow, no npm scope authentication configured.

---

## Implementation Decisions

These decisions are derived from `diagnosis.md` decisions D1–D6 and pinned here because they shape the implementation. Specifics like file paths and code are deferred to `plan.md`.

- **Package manager and orchestrator:** Bun + Turborepo. No npm, no pnpm. Workspace glob `packages/*` + explicit `docs` entry. CLAUDE.md mandates Bun.
- **Workspace scope:** exactly two workspaces — `packages/munchkins` and `docs/`. No preallocation of `packages/backend`, `packages/ui`, `packages/shared`, or `packages/scenarios`. The `scenarios/` harness lives at the repo root as a directory, not a workspace.
- **Package naming:** all monorepo packages use the `@serranolabs.io/` namespace. The moved `agents` package becomes `@serranolabs.io/munchkins`. Imports across workspace boundaries MUST go through monorepo package names, never relative paths.
- **Move method:** flat copy — `src/`, `package.json`, `tsconfig.json` only. Do NOT copy `node_modules/` or the source repo's `bun.lock`. Internal CLI/builder source layout preserved verbatim.
- **Docs workspace shape:** mirrors `insider-trading/docs/`. Owns its own `package.json` with `@rspress/core ^2.0.9`, `react ^19`, `react-dom ^19`. Owns its own `rspress.config.ts` with `root: path.join(__dirname, 'pages')`. Has `dev`, `build`, `preview` scripts. Root scripts alias `docs:dev` and `docs:build`.
- **Internal-page filtering:** `rspress.config.ts` reads `process.env.PUBLIC_DOCS`. When `PUBLIC_DOCS === 'true'`, `route.exclude` includes `'**/internal/**'`. When unset/false, no exclusion. Single config — no parallel `rspress.public.config.ts`.
- **Cross-cutting scaffold delegation:** `AGENTS.md`, command registry, repo-level quality gates, and scenario workflow harness are produced by invoking the `init-project` skill DOWNSTREAM of plan-funnel completion, with `prd.md` and `plan.md` as inputs. `init-project` must respect the workspace scope (D2) and the env-gated filter (D3) — no extra workspaces, no deviation from the env gate.
- **Quality gates concrete tooling (carry-forward from insider-trading idiom, pending Stage 5 confirmation):** typecheck via `tsc --noEmit`, lint via `biome check`, format via `biome format`, test via `bun test`. Final tooling lock-in deferred to `technology-decisions.md`.
- **Boundary discipline:** the munchkins CLI is product. The scenario harness is harness. The harness adapts to the munchkins CLI's surface (it invokes the CLI, observes results, asserts) — the munchkins CLI does NOT accept `scenario_id` or `run_id` as input parameters. Plan-funnel artifacts under `docs/pages/internal/` are documentation, not part of the product or the harness.
- **Constructed bugfix agent — location and surface.** The bugfix agent is constructed using `AgentBuilder` (already in the moved package) and lives inside `packages/munchkins` as an exported constructor, NOT as a script under `scenarios/` or at repo root. Reason: the harness is the *consumer* of the bugfix agent (it runs it under mocks), not its owner. Keeping the agent in the package preserves the boundary — the harness imports `@serranolabs.io/munchkins` and gets the constructor; the agent itself never imports anything harness-flavored. Concrete API shape (function signature, exported name) is deferred to `plan.md`.
- **Claude-call mock seam.** `spawnClaude` (in `packages/munchkins/src/builder/spawn-claude.ts`) is the single place where the munchkins package invokes Claude. The harness must replace this seam at test time with a deterministic mock. Mechanism is one of: (a) Bun's `mock.module()` to swap the module at runtime, (b) dependency-injection — pass a `spawnClaudeFn` option into `AgentBuilder` and let the harness inject a mock implementation, (c) environment-variable switch inside `spawn-claude.ts` itself. Mechanism choice deferred to `technology-decisions.md` because each option has different implications for the verbatim-keep rule (D4) and for how cleanly the production code stays unaware of test concerns. The harness MUST also enforce that no real `claude` binary is spawned during a run (process-spawn guard or env-flag check).
- **Simulated environment for S7.** The harness creates a temp directory containing a real (not mocked) git repo with a synthetic bug fixture. Real git operations run (worktree creation, commits, merges) — they are fast, hermetic, and mocking them would invalidate `AgentBuilder`'s actual behavior. The deterministic-loop commands (`bun run scenario:all`, `bun run lint`, `bun run typecheck`, changelog append) ARE stubbed with sandbox-local equivalents because they reference scripts that do not exist in the synthetic sandbox. Stub configuration (which commands fail and on which iteration to exercise the loop's fixer agent) is per-fixture data.
- **GitHub Actions topology.** Workflows live under `.github/workflows/`. Three workflows in scope:
  1. `ci.yml` — runs on every PR and every push to `main`. Jobs: `lint`, `test` (the test job invokes the scenario harness, which runs S7). Both gate merge via branch protection.
  2. `docs-publish.yml` — runs on push to `main` whose change set touches `docs/**` excluding `docs/pages/internal/**`. Builds with `PUBLIC_DOCS=true` and deploys to the configured host.
  3. `publish.yml` — runs on tag push matching the agreed pattern. Re-runs lint + test as gates, then `bun publish` (or `npm publish`) the munchkins package.
  The exact workflow filenames, the path-filter syntax for `docs-publish.yml`, the public-docs host platform, and the tag-naming convention for `publish.yml` are all locked in `technology-decisions.md`.
- **npm publish wiring.** The munchkins package is published as `@serranolabs.io/munchkins`. `package.json` MUST set `"private": false` (or remove the `private` field) and declare a `publishConfig` block targeting the public npm registry under the `@serranolabs.io` scope. An `NPM_TOKEN` GitHub secret with publish rights to the scope is required at S12 pre-state. Whether the munchkins package version is bumped manually (developer edits `package.json`) or via a tooling integration (e.g., changesets, semantic-release) is deferred to `technology-decisions.md`.
- **Docs publish path filter.** The `docs-publish.yml` workflow uses GitHub's `paths` and `paths-ignore` filters to fire only on changes touching the public docs surface. Specifically: trigger on `docs/**`, ignore `docs/pages/internal/**`. This avoids burning CI minutes and host-deploy quota on plan-funnel-only commits whose content is filtered out anyway.
- **CI privacy.** The CI workflows MUST NOT publish or expose the contents of `docs/pages/internal/**`. The `PUBLIC_DOCS=true` env gate in `rspress.config.ts` is the single mechanism preventing leakage; CI MUST set this var explicitly in `docs-publish.yml`.

## Testing Decisions

- **Scenario harness scope is narrow on purpose.** ONLY **S7** is implemented as a scenario inside the scenario testing harness. S1–S6 and S8 are verified by other, lighter means listed below. This keeps the harness from becoming a generic bash-runner — its purpose is to exercise the munchkins package's most complex behavior (the bugfix agent) against a controlled, hermetic environment.
- **Verification surface per scenario:**
  - **S1 (munchkins CLI runs):** verified by a direct shell invocation in a verification script — `bun run --cwd packages/munchkins cli --help` returns 0 and prints expected subcommands. No harness needed.
  - **S2 (Rspress dev renders internal artifacts):** **manual verification only.** Stage 4 must include a manual verification subsection covering: how to start the dev server, the URL to open, expected visible page elements, forbidden states (404, raw markdown, console errors).
  - **S3 (PUBLIC_DOCS=true build excludes internal):** verified by a direct shell invocation — run the build with the env var, then `grep -r "Diagnosis —" <build-output>` returns no matches and exit code reflects no-match. No harness needed.
  - **S4 (default build includes internal):** same mechanism as S3, inverse assertion. No harness needed.
  - **S5 (quality gates pass on clean scaffold):** direct shell invocation — run the four gate commands sequentially, assert all exit 0. No harness needed.
  - **S6 (`AGENTS.md` + command registry exist and are non-empty):** direct file existence + non-emptiness check. No harness needed.
  - **S7 (bugfix agent E2E with mocked Claude in simulated env):** **the only scenario inside the scenario harness.** The harness owns the sandbox, the Claude mock, the deterministic-command stubs, and the assertion logic. Detailed mapping in Stage 4.
  - **S8 (new internal artifact appears in dev nav):** **manual verification only.** Stage 4 must include a manual verification subsection covering: how to add a file, how to confirm HMR picked it up, expected sidebar behavior.
  - **S9 (push to docs triggers publish):** verified by inspecting workflow runs on a real PR/push. Optional local pre-merge verification via `act` if `act` is configured. Stage 4 must include a manual verification subsection: how to trigger the workflow, how to confirm the deploy URL reflects the change, expected workflow status.
  - **S10 (lint blocks merge):** verified locally by running the same lint command CI runs (`bun run lint`) and inspecting workflow runs on a deliberately-violating PR. Stage 4 includes a manual verification subsection: how to construct a violating PR, expected GitHub check states.
  - **S11 (test blocks merge):** verified by inspecting workflow runs on a PR that breaks a test. The S7 harness must be inside the `test` job. Stage 4 includes a manual verification subsection.
  - **S12 (tag triggers npm publish):** verified by tagging a pre-release version in a sandbox or test scope (e.g., a `0.0.0-alpha.0` tag) and confirming the workflow runs and the package appears on npm. Stage 4 includes a manual verification subsection covering: how to tag, how to verify the workflow ran, how to verify the npm registry reflects the publish, how to roll back if needed.
- **Smoke vs deep:** the scaffold milestone needs smoke verification only — that each capability *exists and works once*. Exhaustive coverage of the munchkins CLI's behavior is out of scope for this milestone (the package is being moved, not refactored). S7 is the single deep scenario because the bugfix agent is the most failure-prone composite behavior in the munchkins package, and it must remain green across future refactors.
- **Failure mode discipline:** if any scenario fails on the scaffolded repo, treat it as a scaffold defect, not a flaky test. The scaffold either works on a clean clone or it doesn't. Test instability in S7 specifically must be diagnosed as a mock-fixture problem or a real bug in `AgentBuilder`, never accepted as flake.
- **Mock isolation requirement (S7):** the mock must be installed at the `spawnClaude` seam in such a way that ZERO real `claude` CLI invocations can occur during a harness run, even if the munchkins package is later refactored. The harness must verify this post-run (e.g., a process-spawn audit or guard env var) so a regression in the mock seam fails the scenario rather than silently calling the real Claude.

## Out Of Scope

- **Public host platform choice (GitHub Pages vs Vercel vs Cloudflare Pages vs other) and the DNS/domain attached to it.** The mechanism to produce a `PUBLIC_DOCS=true` build is in scope, the GitHub Actions workflow that triggers the deploy is in scope, but the destination platform decision and DNS configuration are deferred to `technology-decisions.md`. Status: missing, deferred to tech-decisions.
- **Public docs IA, theme, branding, custom components.** A minimal `docs/pages/index.mdx` landing page is sufficient for S3/S4 to be testable. Status: missing, deferred.
- **Migrating other packages from `insider-trading`** (`backend`, `ui`, `shared`, etc.). Status: out of scope by D2.
- **Preserving git history** of `agents` during the move. Status: out of scope by D6 (flat copy).
- **Refactoring or extending the `agents` CLI.** Source moves verbatim. Status: out of scope by D4.
- **Documentation site search, sitemap, robots.txt, OG metadata.** Status: missing, deferred.
- **Authentication or access control on the public docs site.** D3 chose filtering-by-omission; auth-gating internal pages on a public deploy is a different problem. Status: out of scope.
- **Replacing the user's existing `insider-trading` repo** with anything in munchkins. The original repo continues to exist and operate; munchkins is additive. Status: out of scope.
- **Real Anthropic API key handling, rate-limit handling, retry/backoff behavior** for the bugfix agent under S7. S7 mocks all Claude calls — no API key is exercised in the harness. Status: out of scope.
- **Coverage of failure modes in the bugfix agent's deterministic loop fixer** beyond a single fail-then-pass fixture. S7 verifies the agent assembles, spawnClaude is mocked, the loop's branch is reachable, and the pipeline finalizes. Exhaustive failure-mode permutations (max-iteration exhaustion, partial commits, finalize-on-fail branch behaviors) are deferred to follow-up scenarios. Status: missing, deferred.

## Further Notes

- The diagnosis stage (`diagnosis.md`) is the canonical record for the scaffold-shape decision (D1 / Option A) and the five other resolved decisions (D2–D6). This PRD treats those as inputs, not as topics to revisit.
- The `init-project` skill is the materialization tool, but it is invoked AFTER plan-funnel completion. The plan-funnel itself stops at `plan.md` per its skill contract; it does not invoke `init-project` as part of stage execution. The plan handoff point will be explicit in `plan.md`.
- Stage 4 (`scenario-testing-strategy.md`) must keep the harness CLI a single CLI-invocable contract per plan-funnel rules. The harness CLI is invoked as `bun run scenario run <id>` (or equivalent) — that is the single entry point. Inside S7, the harness imports the bugfix-agent constructor directly from `@serranolabs.io/munchkins` to install the Claude mock seam in-process; this is acceptable because the imported constructor is a normal package export (also reachable via the munchkins CLI subcommand), not a harness-only mode. The munchkins CLI subcommand for invoking the bugfix agent IS the product-facing surface; S7 just exercises the same construction logic in-process so mocks can be installed.
- Stage 5 (`technology-decisions.md`) will lock the remaining tool versions: Rspress version, Biome vs ESLint, root tsconfig strategy (project references vs single config), and Turborepo task-graph shape (which tasks depend on which).
- This PRD intentionally does not include file paths or code snippets per `prd-stage.md` rules. Those land in `plan.md`.
