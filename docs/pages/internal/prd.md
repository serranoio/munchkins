---
stage: prd
artifact_root: docs/pages/internal/
status: draft
upstream:
  - docs/pages/internal/diagnosis.md
---

# PRD — Munchkins monorepo scaffold + `agents` package import + Rspress plan-funnel surface

## Problem Statement

The repo at `/Users/davidserrano/Documents/dev/ai/munchkins` started as a bare git repo. The scaffold milestone (Slices 1–8 of `plan.md`) materialized a Bun + Turborepo monorepo with:

1. `packages/munchkins` housing the moved `@serranolabs.io/munchkins` package (framework + agents + bin).
2. An Rspress docs site rendering plan-funnel artifacts under `docs/pages/internal/`, filtered out of public builds via `PUBLIC_DOCS=true`.
3. A scenario harness at `scenarios/` running the single E2E (`bugfix-agent-e2e`).
4. `AGENTS.md`, command registry, repo-level quality gates (Biome, tsc, Bun), GitHub Actions workflows.

**Change-impact round 1 — post-scaffold refactor.** Per `diagnosis.md` D7–D13, this PRD is amended for a follow-up refactor:

- Split `packages/munchkins` into `@serranolabs.io/munchkins` (framework: `AgentBuilder`, `AgentRegistry`, `Prompt`, `spawnClaude`, `worktree`) and `@serranolabs.io/munchkins` (defaults bundle that depends on `-core`).
- Introduce `AgentRegistry` in `-core`. Each `AgentBuilder` declares its configurable inputs via a TypeScript schema. The registry generates a Commander CLI from registered agents — one subcommand per agent, one `--flag` per schema entry.
- Remove the standalone `packages/munchkins/src/cli/bugfix.ts` wrapper. Remove the inherited subcommand wrappers (`agent`, `workflow`, `autonomous`, `changelog`) — those were CLI fixtures of the inherited package, not designed surfaces.
- **No `bin` field on either package.** The bundle is a library; downstream projects build their own bin scripts from `registry.cli()`.
- Relocate the bugfix agent to `packages/munchkins/agents/bugfix/` (outside any `src/`), co-located with its prompts. The bundle re-exports it and auto-registers it with the framework registry.

**Current implementation status of the scaffold milestone (Slices 1–8): implemented.** The repo is no longer bare. The change-impact round below describes a **partially implemented → missing** transition: the existing `bugfix.ts` CLI wrapper exists but contradicts the new design; `AgentRegistry` does not yet exist; `packages/munchkins-core` does not yet exist; the bugfix agent currently lives under `packages/munchkins/src/builder/`, not at `packages/munchkins/agents/`.

## Solution

A single greenfield scaffold operation, executed from a verified plan, producing:

- **Repository shape** mirroring the user's existing `insider-trading` monorepo idiom: root `package.json` declaring Bun workspaces matching `packages/*` and `docs`, root `turbo.json` orchestrating tasks across workspaces, root `tsconfig.json`, root `bun.lock`. Layout lives under decision **D1 / Option A** of `diagnosis.md`.
- **`packages/munchkins`**, flat-copied from `insider-trading/packages/agents/`, with package name renamed to `@serranolabs.io/munchkins`, internal source layout preserved verbatim, and the package's CLI invocable from the new monorepo.
- **`docs/`** as a Bun workspace owning Rspress and its React/`@rspress/core` dependencies. Its `rspress.config.ts` sets `root: path.join(__dirname, 'pages')`, exposing `docs/pages/**` as the renderable content tree. `docs/pages/internal/` holds plan-funnel artifacts and renders during local dev. Public production builds (`PUBLIC_DOCS=true`) filter `**/internal/**` out via `route.exclude`.
- **Cross-cutting deliverables** materialized by invoking the `init-project` skill downstream of plan-funnel completion: `AGENTS.md`, command registry, repo-level quality gates (typecheck, lint, test, format), and a scenario workflow harness rooted at `scenarios/` (a directory, not a workspace).

The scaffold honors plan-funnel boundary rules: no harness identifiers leak into product routes. The `agents` CLI is product-facing; the `scenarios/` harness adapts to it, never the other way around.

## User Scenarios

Each scenario below describes one observable behavior. Each maps 1:1 to an E2E scenario authored in Stage 4 (`scenario-testing-strategy.md`).

### S1 — Developer constructs a CLI from registered agents and runs it

**Pre-state:** Repo is scaffolded AND post-refactor: `@serranolabs.io/munchkins` exposes `AgentBuilder` + `AgentRegistry`, `@serranolabs.io/munchkins` exports the default bugfix agent and registers it on import. Neither package ships a `bin` field.

**Action:** From a project that has both packages installed, the developer writes a tiny bin script:

```ts
import { registry } from "@serranolabs.io/munchkins";
import "@serranolabs.io/munchkins"; // side-effect: registers default agents
registry.cli().parse(process.argv);
```

…and runs `bun run ./bin.ts --help`. (Inside the munchkins repo itself, the equivalent is `bun run scenarios/index.ts` for the harness; an in-repo `bin/` example may be checked in for documentation but is not the published surface.)

**Expected:** The CLI prints its top-level help. The subcommand list is **derived from the registry** — at minimum the default `bug-fix` agent appears as a subcommand (`bin.ts bug-fix --help` lists `--user-message <path>`, etc., matching the agent's declared option schema). Process exits 0. No `MODULE_NOT_FOUND`. No references to `@insider-trading/` resolve from any package source.

**Current status:** partially implemented. `packages/munchkins/src/cli/index.ts` builds a Commander program by hand from hardcoded subcommand wrappers (`agent`, `workflow`, `autonomous`, `changelog`, `bugfix`); `AgentRegistry` does not exist; `AgentBuilder`'s constructor takes only a name (no description arg); `AgentBuilder.add()` does not extract option declarations from prompts; `Prompt` still has `withText`/`withInput` (not yet renamed to `withUserMessage` / replaced by `withUserMessageFromOption(name, schema?)`). The hand-built CLI must be removed and replaced with registry-derived generation. The four inherited subcommands (`agent`, `workflow`, `autonomous`, `changelog`) are dropped from the surface — they were inherited CLI fixtures, not designed product behavior. Only registered agents appear as subcommands going forward.

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

**Expected:** `AGENTS.md` exists, is non-empty, describes the repo's operating contract (how agents work in this repo, what commands are sanctioned, where outputs go). Command registry lists the named commands the repo supports (at minimum: `docs:dev`, `docs:build`, `typecheck`, `lint`, `format`, `test`, `build`, `scenario`). Each entry describes purpose and invocation. **Per D9, the command registry does NOT advertise a `munchkins` global binary** — there is no published bin. Library API references (e.g., "import `AgentRegistry` from `@serranolabs.io/munchkins`; import `@serranolabs.io/munchkins` for default agents that auto-register") replace the prior CLI-binary entry. Reader can run any listed command without inferring it from `package.json` scripts alone.

**Current status:** partially implemented. `AGENTS.md` exists with a "Munchkins CLI" subsection naming the binary command and five inherited subcommands. That subsection must be replaced with the library-API surface and a note that downstream consumers build their own bin from `registry.cli()`.

---

### S7 — Developer runs the scenario harness, which executes a constructed bugfix agent inside a fully simulated environment with all Claude calls mocked

**Pre-state:** Munchkins repo is fully scaffolded AND post-refactor. `@serranolabs.io/munchkins` exposes `AgentBuilder`. `@serranolabs.io/munchkins` exports the default bugfix agent constructor from `packages/munchkins/agents/bugfix/bugfix-agent.ts` and registers it with the core registry on import. The scenario harness lives at `scenarios/` (directory, not workspace) and is the single CLI-invocable contract for E2E verification.

**Action:** Developer runs `bun run scenario` from repo root. The harness:

1. Creates a sandbox directory containing a temporary git repo seeded with a synthetic "bug" fixture (a known-broken file, a known-passing test that the bug breaks, etc.).
2. Replaces the framework's Claude-call seam (`spawnClaude` from `@serranolabs.io/munchkins/builder/spawn-claude.ts`) with a mock that returns canned, fixture-driven responses indexed by step (`bug-fix` step response → `refactorer` step response → `deterministic-fixer` responses if the loop fires).
3. Replaces or stubs the deterministic loop commands (`bun run scenario:all`, `bun run lint`, `bun run typecheck`, changelog append) with sandbox-local equivalents that exit 0 by default and can be configured per fixture to fail-then-pass to exercise the loop's fixer agent.
4. Imports `createBugfixAgent` from `@serranolabs.io/munchkins/agents/bugfix` (or via the bundle's top-level export) and invokes it against the sandbox.
5. Asserts on the deterministic outcome: agent pipeline reached `PASS`, the expected commits exist on the expected branch, the canned mock responses were consumed in the expected order, no real `claude` binary was invoked.

**Expected:**
- `scenario list` prints at least the `bugfix-agent-e2e` scenario with a description.
- `scenario run bugfix-agent-e2e` executes deterministically, prints a structured result, and exits 0.
- ZERO real Claude API calls or `claude` CLI invocations occurred during the run (verifiable via the mock's call log).
- The sandbox is cleaned up on success and preserved on failure for inspection.
- The harness does NOT hardcode `scenario_id` or `run_id` into the munchkins CLI surface or any product route — those identifiers stay inside the harness fixture/result schema.

**Current status:** partially implemented. Harness, mock seam, and constructed bugfix agent all exist post-scaffold milestone. The refactor delta: the spawn-claude module path moves from `@serranolabs.io/munchkins/builder/spawn-claude.ts` to `@serranolabs.io/munchkins/builder/spawn-claude.ts`; the bugfix-agent constructor's import path moves from `@serranolabs.io/munchkins` (resolved through `src/builder/bugfix-agent.ts`) to `@serranolabs.io/munchkins/agents/bugfix` (resolved through the bundle's relocated path). The harness's mock-module call argument and dynamic-import target both update; everything else (sandbox, stubs, audit guard, fixtures) carries over unchanged.

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

**Expected:** A GitHub Actions workflow named `publish` (or equivalent) runs automatically on the tag push. The workflow installs deps, runs lint + test as gating jobs, and on green publishes **both `packages/munchkins-core` and `packages/munchkins`** to npm under `@serranolabs.io/munchkins` and `@serranolabs.io/munchkins`. Per D9, **neither published package installs a `munchkins` global command** — there is no `bin` field on either. Verification of "package shipped correctly" is via `npm view @serranolabs.io/munchkins version` + `npm view @serranolabs.io/munchkins version` matching the tag, plus a smoke import in a downstream sandbox confirming `import { AgentRegistry } from "@serranolabs.io/munchkins"` resolves and `import "@serranolabs.io/munchkins"` registers the default bugfix agent. Workflow exits 0.

If lint or test fail, publish is skipped and the workflow exits non-zero.

**Current status:** partially implemented. A `publish.yml` workflow exists for the single-package case. The refactor delta: the workflow must publish two packages in topological order (`-core` before the bundle, since the bundle's `package.json` declares it as a dependency). Tag convention (T3, `v*`) is unchanged.

---

### S13 — Registering an agent automatically exposes it as a CLI subcommand with typed flags

**Pre-state:** `@serranolabs.io/munchkins` exposes `AgentRegistry`, the `registry` singleton, `AgentBuilder` (constructor takes `name, description?`; exposes plain public readonly fields `name`/`description`/`options`; residual `.option(name, schema)` for non-prompt-consumed flags), and `Prompt.withUserMessage(text)` / `Prompt.withUserMessageFromOption(name, schema?)`. A consumer has written a custom agent (or the default bugfix agent is registered).

**Action:** Consumer writes:

```ts
import { AgentBuilder, Prompt, registry } from "@serranolabs.io/munchkins";

const myAgent = new AgentBuilder(
  "my-agent",
  "Process a target file with optional dry-run.",
)
  .option("dryRun", {
    type: "boolean",
    description: "Skip side effects",
  })
  .add(
    new Prompt("prompts/process.md").withUserMessageFromOption("target", {
      required: true,
      description: "Path to thing to process",
    }),
  )
  .finalize([], {});

registry.register(myAgent);
```

Then runs `registry.cli().parseAsync(['node', 'bin', 'my-agent', '--help'])` (or via a project-local bin script).

**Expected:** `my-agent --help` prints usage with `--target <target>` (required, declared inline on the prompt) and `--dry-run` (boolean flag, declared via `.option()` because it is not consumed by a prompt) listed, with their `description` text — Commander kebab-cases camelCase option names automatically. Running `my-agent --target=foo --dry-run` sets the framework's internal `process.env.__MUNCHKINS_OPT_target=foo` and `__MUNCHKINS_OPT_dryRun=true`, then invokes `myAgent.run()`. Prompt steps that wired themselves via `.withUserMessageFromOption("target")` read the option value at resolve time. Required-flag omission produces a clean Commander validation error and non-zero exit. Unknown flags fail clearly.

**Current status:** missing. `AgentBuilder`'s constructor doesn't accept a description arg and `.add()` doesn't extract option declarations from prompts; `Prompt` has no `withUserMessageFromOption()` and `withText` is not renamed to `withUserMessage`; no `AgentRegistry` exists; the existing `cli/` directory generates Commander programs by hand from per-subcommand wrapper modules.

---

### S14 — Consumer installs `@serranolabs.io/munchkins`, the default bugfix agent registers itself

**Pre-state:** Consumer's project has `bun add @serranolabs.io/munchkins`. The bundle's `package.json` declares `@serranolabs.io/munchkins` as a dependency, so both arrive in `node_modules`.

**Action:** Consumer writes:

```ts
import { registry } from "@serranolabs.io/munchkins";
import "@serranolabs.io/munchkins"; // side-effect import: registers default agents
console.log(registry.list()); // or registry.cli().help()
```

Then runs the file.

**Expected:** Output lists `bug-fix` (and any future default agents) with their declared option schemas. The consumer can immediately invoke `registry.cli().parse([..., 'bug-fix', '--user-message=./bug.md'])` without writing any agent code. Consumer can override prompts by passing `promptDir` or by re-registering a customized builder, demonstrating "ship defaults + keep configurable."

**Current status:** missing. No bundle-vs-core split exists; `import "@serranolabs.io/munchkins"` today triggers no side-effect registration; `createBugfixAgent` does not auto-register.

---

## Implementation Decisions

These decisions are derived from `diagnosis.md` decisions D1–D13 and pinned here because they shape the implementation. Specifics like file paths and code are deferred to `plan.md`. Entries marked **(amended — change-impact round 1)** are revised from the original scaffold-milestone form.

- **Package manager and orchestrator:** Bun + Turborepo. No npm, no pnpm. Workspace glob `packages/*` + explicit `docs` entry. CLAUDE.md mandates Bun.
- **Workspace scope (amended — change-impact round 1, per D7):** **three workspaces — `packages/munchkins-core`, `packages/munchkins`, and `docs/`.** No preallocation of `packages/backend`, `packages/ui`, `packages/shared`, or `packages/scenarios`. The `scenarios/` harness lives at the repo root as a directory, not a workspace. The package split is the only sanctioned expansion past D2's original "two workspaces" rule.
- **Package naming:** all monorepo packages use the `@serranolabs.io/` namespace. The framework package is `@serranolabs.io/munchkins`; the defaults bundle is `@serranolabs.io/munchkins` (depends on `-core`). Imports across workspace boundaries MUST go through monorepo package names, never relative paths.
- **Move method (amended — change-impact round 1, per D10):** the original "flat copy + verbatim" rule is retired. Source files reorganize as needed: framework files (`agent-builder.ts`, `prompt.ts`, `spawn-claude.ts`, `worktree.ts`, `spawn.ts`, `changelog.ts`) move to `packages/munchkins-core/src/`. The inherited `cli/` directory (with `agent.ts`, `workflow.ts`, `autonomous.ts`, `changelog.ts`, `bugfix.ts` subcommand wrappers) is removed. The bugfix-agent constructor relocates to `packages/munchkins/agents/bugfix/`.
- **Docs workspace shape:** mirrors `insider-trading/docs/`. Owns its own `package.json` with `@rspress/core ^2.0.9`, `react ^19`, `react-dom ^19`. Owns its own `rspress.config.ts` with `root: path.join(__dirname, 'pages')`. Has `dev`, `build`, `preview` scripts. Root scripts alias `docs:dev` and `docs:build`.
- **Internal-page filtering:** `rspress.config.ts` reads `process.env.PUBLIC_DOCS`. When `PUBLIC_DOCS === 'true'`, `route.exclude` includes `'**/internal/**'`. When unset/false, no exclusion. Single config — no parallel `rspress.public.config.ts`.
- **Cross-cutting scaffold delegation:** `AGENTS.md`, command registry, repo-level quality gates, and scenario workflow harness are produced by invoking the `init-project` skill DOWNSTREAM of plan-funnel completion, with `prd.md` and `plan.md` as inputs. `init-project` must respect the workspace scope (D2) and the env-gated filter (D3) — no extra workspaces, no deviation from the env gate.
- **Quality gates concrete tooling (carry-forward from insider-trading idiom, pending Stage 5 confirmation):** typecheck via `tsc --noEmit`, lint via `biome check`, format via `biome format`, test via `bun test`. Final tooling lock-in deferred to `technology-decisions.md`.
- **Boundary discipline:** the munchkins CLI is product. The scenario harness is harness. The harness adapts to the munchkins CLI's surface (it invokes the CLI, observes results, asserts) — the munchkins CLI does NOT accept `scenario_id` or `run_id` as input parameters. Plan-funnel artifacts under `docs/pages/internal/` are documentation, not part of the product or the harness.
- **Constructed bugfix agent — location and surface (amended — change-impact round 1, per D8).** The bugfix agent is constructed using `AgentBuilder` (in `@serranolabs.io/munchkins`) and lives at **`packages/munchkins/agents/bugfix/bugfix-agent.ts`** — outside any `src/` directory, co-located with its prompt files at `packages/munchkins/agents/bugfix/prompts/`. The bundle package's entry point side-effect-imports the agent's registration module so a consumer who does `import "@serranolabs.io/munchkins"` automatically gets the default bugfix agent registered with the framework registry. Reason: the harness is the *consumer* of the bugfix agent, not its owner; living outside `src/` makes the "this is an example built with the framework, not part of the framework" boundary visually obvious. The agent itself never imports anything harness-flavored. Concrete API shape (function signature, exported name) is deferred to `plan.md`.
- **AgentRegistry surface (per D11/D12, design Option Y locked in T13).** `AgentRegistry` is a `@serranolabs.io/munchkins` export. `AgentBuilder`'s constructor takes `(name, description?)`; the registry reads `builder.name`, `builder.description`, and `builder.options` as plain public readonly fields (no `get` accessors). `AgentBuilder.option(name, schema)` is a residual method for declaring options NOT consumed by prompts (e.g., `--dry-run`). `Prompt` gains `.withUserMessageFromOption(name, schema?)` — the schema (when present) declares the option, and `AgentBuilder.add(prompt)` extracts those declarations at chain-build time. `Prompt.withText` is renamed to `Prompt.withUserMessage`; `Prompt.withInput` is dropped (eager file reads are rare; agents that want one do `withUserMessage(readFileSync(path))`). `OptionSchema` is `{ type: 'string'|'boolean'|'number'|'string[]', required?: boolean, description: string, default?: <value> }` — no `env` field; the framework owns the runtime channel via internally-namespaced env vars `__MUNCHKINS_OPT_*` invisible to the agent author. `registry.register(builder)` takes a single `AgentBuilder` argument — no metadata wrapping object, no factory closure. `registry.cli()` returns a Commander `Command` whose subcommands and flags are derived from each registered builder. The registry is a singleton exported from `-core` so the framework, the defaults bundle, and any consumer share the same registration surface. `AgentBuilder.run()` signature is unchanged; pipeline-execution behavior is unchanged.
- **No published CLI binary (per D9).** Neither `@serranolabs.io/munchkins` nor `@serranolabs.io/munchkins` declares a `bin` field. There is no `munchkins` global command after `npm i -g`. Downstream projects that want a CLI write a project-local bin script that imports the registry, side-effect-imports any agents they want registered, and calls `registry.cli().parse(process.argv)`. The munchkins repo itself uses the harness CLI (`bun run scenario`) for testing and may check in a sample bin script for documentation; that sample is not a published surface.
- **Claude-call mock seam (amended — change-impact round 1, per D13).** `spawnClaude` lives in `packages/munchkins-core/src/builder/spawn-claude.ts` and is the single place where the framework invokes Claude. The harness replaces this seam at test time via Bun's `mock.module('@serranolabs.io/munchkins/builder/spawn-claude.ts', ...)` (T1). Production code stays unaware of test concerns. The harness MUST also enforce that no real `claude` binary is spawned during a run (process-spawn guard).
- **Simulated environment for S7.** The harness creates a temp directory containing a real (not mocked) git repo with a synthetic bug fixture. Real git operations run (worktree creation, commits, merges) — they are fast, hermetic, and mocking them would invalidate `AgentBuilder`'s actual behavior. The deterministic-loop commands (`bun run scenario:all`, `bun run lint`, `bun run typecheck`, changelog append) ARE stubbed with sandbox-local equivalents because they reference scripts that do not exist in the synthetic sandbox. Stub configuration (which commands fail and on which iteration to exercise the loop's fixer agent) is per-fixture data.
- **GitHub Actions topology.** Workflows live under `.github/workflows/`. Three workflows in scope:
  1. `ci.yml` — runs on every PR and every push to `main`. Jobs: `lint`, `test` (the test job invokes the scenario harness, which runs S7). Both gate merge via branch protection.
  2. `docs-publish.yml` — runs on push to `main` whose change set touches `docs/**` excluding `docs/pages/internal/**`. Builds with `PUBLIC_DOCS=true` and deploys to the configured host.
  3. `publish.yml` — runs on tag push matching the agreed pattern. Re-runs lint + test as gates, then `bun publish`-es **both packages in topological order** (`-core` first, bundle second). Ordering matters because the bundle's `package.json` declares `@serranolabs.io/munchkins` as a dependency at the just-tagged version; publishing the bundle before `-core` would produce a registry entry that resolves to a non-existent dep.
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
