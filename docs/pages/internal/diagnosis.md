---
stage: diagnose
artifact_root: docs/pages/internal/
status: grilled
---

# Diagnosis — Choose the monorepo layout for `munchkins`

**Triage:**
1. **Monorepo scaffold layout** — single decision that locks in workspace topology, build tool wiring, docs surface, and how the moved package is addressed. Highest leverage. ← diagnosed below.
2. Agents package portability (rename `@insider-trading/agents`, decide whether to preserve git history) — out of scope, separate diagnosis (will surface in `grill-me` / `prd.md`).
3. Rspress information architecture (sidebar/nav for `docs/pages/internal/`, public vs internal section split) — out of scope, separate diagnosis (planning-stage decision).
4. Plan-funnel artifact discoverability (do these pages need a "private" notice, are they shipped to a public docs deploy?) — out of scope, separate diagnosis.

---

**Problem:** The repo at `/Users/davidserrano/Documents/dev/ai/munchkins` is a bare git repo (`.git/` only) and needs a monorepo scaffold that simultaneously hosts the existing `packages/agents` workspace and renders Rspress docs sourced from `docs/pages/internal/`. The scaffold layout decision is upstream of every other decision (build orchestration, package addressing, docs build target, CI surface), so picking it correctly first prevents rework.

**Scope of this diagnosis:**
- In: top-level directory layout, workspace declaration shape, where Rspress lives (root vs nested), where its `root` content directory points, how `docs/pages/internal/` is wired in.
- Out:
  - package rename / namespace choice for the moved `agents` package (`@insider-trading/agents` → `@munchkins/agents` vs `@serranolabs.io/agents`)
  - whether to copy the agents directory or move with `git filter-repo` to preserve history
  - Rspress nav/sidebar IA, theme, custom components
  - CI / release / lint / typecheck root config (deferred to plan stage)
  - `init-project` skill's downstream concerns (AGENTS.md, command registry, scenario harness wiring) — those layer onto whichever layout is chosen

**Assumptions:**
- User wants Bun + Turborepo per CLAUDE.md and earlier confirmation in this session.
- The moved `agents` package is portable: source has zero references to `insider-trading` or `kalshi`, depends only on `commander` + Bun builtins (`bun:$`). Verified via grep across `packages/agents/src/`.
- User's prior monorepo (`insider-trading`) is the reference pattern: workspaces `["packages/*", "scenarios"]`, Rspress as a *separate Bun workspace* under `docs/`, with `rspress.config.ts` setting `root: path.join(__dirname, 'docs')` (so its content root is `docs/docs/`).
- The artifact path `docs/pages/internal/` is a hard requirement: plan-funnel files MUST live there.
- No production UI/backend code currently lives in this repo, so no harness/product-contract leak risk yet — but the layout should not preclude one being added later.
- Rspress 2.x is acceptable (insider-trading uses `^2.0.9`).

**Constraints:**
- Plan-funnel artifacts (`diagnosis.md`, `prd.md`, `scenario-testing-strategy.md`, `technology-decisions.md`, `plan.md`) MUST resolve under `docs/pages/internal/` on disk and MUST be reachable in the Rspress site.
- Bun is the package manager (no npm/pnpm).
- Cross-package imports MUST go through monorepo package names, not relative paths (CLAUDE.md rule).
- Style files for Lit elements must be separate (CLAUDE.md) — irrelevant for the agents package today, but a layout that hosts future UI must respect this.
- Cannot leak harness-only identifiers (`scenario_id`, `run_id`, etc.) into product routes (plan-funnel rule). N/A for this scaffold but the layout must keep harness vs product wiring separable.
- Repo is currently `main` clean; do not introduce uncommitted state until user confirms.

**Unknowns:**
- Whether the user wants Rspress to ship publicly or stay internal (affects whether `docs/pages/internal/` should be wrapped in a route guard, marked `noindex`, or simply rely on not deploying). Insufficient evidence — flagging for `grill-me`.
- Whether the moved `agents` package should keep its `cli` entry layout (`packages/agents/src/cli/index.ts`) verbatim or be reorganized. Insufficient evidence — flagging for `grill-me`.
- Whether additional workspaces (backend, ui, scenarios) are imminent. The scaffold should accommodate them but not preallocate empty dirs. Insufficient evidence — flagging for `grill-me`.
- Whether `init-project` skill should run after this diagnosis to materialize the chosen layout, or whether the user wants a manual scaffold. Insufficient evidence — surface during the planning stage.

**Root cause:**
- The repo has no scaffold yet. Every downstream concern (where does Rspress live, how is `agents` addressed, what does `turbo.json` orchestrate) inherits its answer from the chosen layout. There is one symptom (no working monorepo) and one cause (no scaffold). The three sub-asks (init monorepo / move package / wire Rspress) are not independent problems — they are co-decided by the layout.

---

**Solution options** (each is a different scaffold *shape* for the same root cause):

Concrete metric used: **top-level surface area** = count of repo-root entries (config files + workspace dirs) the user must mentally model + **path-resolution hops** to reach `docs/pages/internal/diagnosis.md` from Rspress's `root` config.

### Option A — Mirror insider-trading: nested `docs/` workspace, Rspress `root` at `docs/pages`

Layout:
```
munchkins/
├── package.json              # workspaces: ["packages/*", "docs"]
├── turbo.json
├── tsconfig.json
├── bun.lock
├── packages/
│   └── agents/               # moved here, rename to @munchkins/agents
└── docs/
    ├── package.json          # name: docs, deps: @rspress/core
    ├── rspress.config.ts     # root: path.join(__dirname, 'pages')
    └── pages/
        ├── index.mdx
        └── internal/
            ├── diagnosis.md
            ├── prd.md
            └── ...
```
- Root entries: 5 configs + 2 workspace dirs = **7**.
- Rspress `root` → `docs/pages`. Plan-funnel files at `docs/pages/internal/*.md` route to `/internal/<file>` (clean).
- Path-resolution hops from `rspress.config.ts` to `diagnosis.md`: **2** (`pages/internal/diagnosis.md`).
- Tradeoff: docs is a real workspace (own `package.json`, own deps), so `bun install` at root installs Rspress only into the docs workspace — keeps the agents package's dep tree clean. But the user has to remember `bun run --cwd docs dev` (mirrors insider-trading's `docs:dev` script, easily aliased at root).

### Option B — Repo-root Rspress, no nested docs workspace

Layout:
```
munchkins/
├── package.json              # workspaces: ["packages/*"], deps: @rspress/core
├── turbo.json
├── tsconfig.json
├── rspress.config.ts         # at repo root, root: path.join(__dirname, 'docs/pages')
├── packages/
│   └── agents/
└── docs/
    └── pages/
        ├── index.mdx
        └── internal/
            ├── diagnosis.md
            └── ...
```
- Root entries: 6 configs + 1 workspace dir = **7** (same count, but more configs at root).
- Rspress `root` → `docs/pages`. Same routing as A.
- Path-resolution hops: **2**.
- Tradeoff: simpler — one fewer `package.json`, no `--cwd docs` indirection. But Rspress's React 19 + `@rspress/core` deps end up in the *root* `node_modules`, polluting the agents package's reachable type space and inflating root install. Also breaks the insider-trading pattern, so muscle memory transfers less cleanly. Loses the option to publish docs as its own workspace later (e.g. its own Vercel deploy target) without refactor.

### Option C — Repo-root Rspress with `docs/` as direct content root (no `pages/` indirection)

Layout:
```
munchkins/
├── package.json
├── rspress.config.ts         # root: path.join(__dirname, 'docs')
├── docs/
│   ├── index.mdx
│   └── pages/
│       └── internal/
│           ├── diagnosis.md
│           └── ...
└── packages/
    └── agents/
```
- Same root surface as B (**7**).
- Plan-funnel files route to `/pages/internal/<file>`. The `pages/` segment leaks into URLs, which is awkward (`pages` is conventionally a Rspress framework concept, not a route).
- Path-resolution hops from `rspress.config.ts` to `diagnosis.md`: **3** (`docs/pages/internal/diagnosis.md`).
- Tradeoff: aligns most literally with the user's phrasing ("docs/pages/internal"), but produces semantically noisy URLs and conflates "pages" the directory with "pages" the framework idiom. Hardest to evolve.

---

**Recommendation:** **Option A (nested `docs/` workspace, `root: docs/pages`).** It matches the user's existing insider-trading pattern, isolates Rspress's heavy React/`@rspress/core` dep tree from the agents package's runtime tree, produces clean URLs (`/internal/diagnosis`), and keeps the door open for additional workspaces (backend, ui, scenarios) without restructuring. The `--cwd docs dev` indirection is trivially papered over with a root `docs:dev` script.

---

**Out-of-scope items to revisit (in this order):**
1. ~~**`grill-me` (Stage 2):**~~ ✅ resolved — see "Resolved decisions (Stage 2 grill-me)" below.
2. **`prd.md` (Stage 3):** Translate the resolved decisions into user scenarios + acceptance criteria. Surface any product-behavior implications of the public Rspress deploy (e.g. landing page, public IA).
3. **`technology-decisions.md` (Stage 5):** Lock in Rspress version (target `^2.0.9` to match insider-trading), Turborepo task graph (`build`, `dev`, `typecheck`, `lint`, `test`, `docs:dev`, `docs:build`), root tsconfig strategy (project references vs single config), Biome vs ESLint, env-gated `PUBLIC_DOCS` flag wiring (CI vs local).
4. **`plan.md` (Stage 6):** Sequence the slices: (a) bare scaffold (root `package.json` + `turbo.json` + `tsconfig.json` + `bun.lock`), (b) move agents package + rename to `@serranolabs.io/agents` + verify CLI runs, (c) Rspress workspace at `docs/` with `route.exclude` env-gated wiring + first plan-funnel page rendered, (d) `AGENTS.md` + command registry + quality gates + scenario workflow scaffolding (delegated to `init-project`), (e) verification scenarios.

---

## Resolved decisions (Stage 2 grill-me)

These supersede the unknowns and out-of-scope items above. Each entry records what was decided and the reason.

### D1 — Scaffold layout
**Option A (mirror insider-trading): nested `docs/` workspace, Rspress `root` at `docs/pages`.**
Reason: matches user's existing pattern, isolates Rspress's React/`@rspress/core` deps from the agents package's runtime tree, produces clean URLs.

### D2 — Workspace scope
**Minimal: `packages/munchkins` + `docs/` only. No `packages/backend`, `packages/ui`, `packages/shared`, or `packages/scenarios` workspaces.**
Reason: explicit user direction — "agents and docs, nothing more" at the workspace level. The `agents` package is renamed to `munchkins` per D5; this entry uses the post-rename directory. Cross-cutting deliverables (AGENTS.md, command registry, quality gates, scenario workflow, GitHub Actions workflows) DO ship — see D6 — but they are not workspaces. The `scenarios/` directory at repo root (harness for S7) is also not a workspace.

### D3 — Rspress deploy target
**Public deployment, with `docs/pages/internal/` filtered out of the public build via env-gated `route.exclude`.**
- `rspress.config.ts` reads `process.env.PUBLIC_DOCS`.
- When `PUBLIC_DOCS=true` (production build), `route.exclude` includes `'**/internal/**'`.
- When unset (local dev), no exclusion — plan-funnel artifacts render in `bun run docs:dev`.

Reason: plan-funnel artifacts must be readable in Rspress (the user's stated motivation for using Rspress to "render these"), but should not ship to the public site. Single config + env gate is the minimal mechanism that satisfies both. Public host, base path, and CI wiring deferred to `technology-decisions.md`.

### D4 — Agents source layout
**Keep verbatim, with one explicit carve-out for the CLI binary rename (D5).** No file moves, no folder rename. `packages/munchkins/src/{worktree,spawn,changelog}.ts` plus `packages/munchkins/src/cli/*` plus `packages/munchkins/src/builder/*` transfer as-is.

**Carve-out:** `src/cli/index.ts` line containing `program.name("agents")` is updated to `program.name("munchkins")` per D5. This is the only source-content edit during the move; everything else (subcommand names — `agent`, `workflow`, `autonomous`, `changelog`; module structure; logic) is verbatim.

Reason: package is portable (zero `insider-trading` / `kalshi` references), works today, and reorganization is unrelated to the scaffold goal. The CLI-name carve-out is minimal and required to make the published binary's name match the package identity.

### D5 — Package rename + move method
- **Rename:** `@insider-trading/agents` → **`@serranolabs.io/munchkins`** (per CLAUDE.md namespace rule, scoped to the new repo's identity).
- **Directory rename:** `packages/agents` → **`packages/munchkins`** so the directory name matches the package's scoped suffix (mirrors insider-trading's `packages/agents` → `@insider-trading/agents` convention).
- **CLI binary command name:** **`munchkins`**. `src/cli/index.ts` is edited from `program.name("agents")` to `program.name("munchkins")`. The package's `package.json` adds a `"bin": { "munchkins": "./src/cli/index.ts" }` field so `npm publish` exposes the `munchkins` command on install. Subcommand names (`agent`, `workflow`, `autonomous`, `changelog`) are unchanged — invocation becomes `munchkins agent run <name>`, `munchkins workflow ...`, etc. This is the carve-out to D4 noted above.
- **Move method:** **flat copy** (`cp -r` source `src/`, `package.json`, `tsconfig.json`; do not copy `node_modules/` or `bun.lock`). Original commit history remains in `insider-trading` for forensic lookup. The `package.json`'s `name` field is updated post-copy as part of the move.

Reason: namespace rule is a hard project rule. Renaming the package to `@serranolabs.io/munchkins` aligns the package identity with the repo and the user's stated intent. Directory rename keeps convention consistent. Flat copy remains correct for solo work on a small (~76K, 12 files) portable package; `git filter-repo` introduces failure modes whose marginal value (preserved authorship for files the user wrote) is low. Keeping the CLI binary command name unchanged honors D4 with the smallest blast radius.

### D6 — Materialization path
**Invoke `init-project` skill downstream of this plan-funnel.** It produces all five cross-cutting deliverables:
1. Turborepo monorepo scaffold ✓
2. AGENTS.md operating contract ✓
3. Command registry ✓
4. Rspress docs site ✓
5. Repo-level quality gates ✓
6. Scenario workflow ✓ (in scope per user revision)

Constraint on init-project: it must respect D2 (no extra workspaces beyond `packages/munchkins` + `docs/`) and D3 (env-gated `route.exclude` for `internal/`). Its scenario-workflow output materializes as a `scenarios/` directory + harness CLI, NOT as a `packages/scenarios` workspace.

Reason: plan-funnel is designed to hand off to `init-project`. All six init-project deliverables align with the revised user scope after the user explicitly added the scenario workflow.

---

## Resolved decisions (Change-impact round 1 — package split + AgentRegistry)

These supersede or amend D1–D6 where noted. Triggered by a user-driven post-scaffold refactor: extract the bugfix agent out of the framework, introduce an `AgentRegistry` that auto-generates CLI surfaces from registered agents, remove the standalone `bugfix.ts` CLI wrapper, and split the package into a framework core and a defaults bundle. All five plan-funnel artifacts are amended in place; original D1–D6 entries are preserved above for traceability.

### D7 — Package split (amends D2)
**Two publishable workspaces under `packages/`:** `@serranolabs.io/munchkins` (framework) and `@serranolabs.io/munchkins` (defaults bundle that depends on `-core`). `docs/` remains the third workspace. Workspace count: **3** (was 2 per D2).

Reason: the refactor needs framework code (`AgentBuilder`, `AgentRegistry`, `Prompt`, `spawnClaude`, `worktree`) to be installable independently of any default agents, while still letting consumers `bun add @serranolabs.io/munchkins` to get sane defaults. D2's minimal-scope discipline is preserved by capping the split at exactly two `packages/*` workspaces with the bundle depending on the framework.

### D8 — Bugfix-agent location (amends PRD §"Constructed bugfix agent — location and surface")
**`packages/munchkins/agents/bugfix/{bugfix-agent.ts, prompts/{bug-fix.md, refactorer.md, deterministic-fixer.md}}`.** Outside any `src/` directory, co-located with its prompts, scoped to the bundle package.

Reason: the bugfix agent is an example/default constructed *with* the framework, not part of the framework. Living outside `src/` makes that boundary visually obvious. Co-locating the prompts with the agent file removes the `docs/subagents/...` indirection. The bundle package's `src/` (if it exists at all) only houses re-exports + registration glue; the bundle's interesting code is under `agents/`.

### D9 — No CLI binary (amends D5)
**Neither `@serranolabs.io/munchkins` nor `@serranolabs.io/munchkins` ships a `bin` field.** There is no installed `munchkins` command on PATH after `npm i -g @serranolabs.io/munchkins`. Consumers invoke programmatically: import `AgentRegistry` from `-core`, import default agents from the bundle (which auto-register), call `registry.cli().parse(process.argv)` from a project-local bin script if a CLI is desired.

Reason: the user-driven design explicitly rejected a published binary. The default-agents bundle is a *library* shipping a registry-aware default set; downstream projects build their own CLIs from that. This dissolves D5's CLI subcommand list (`agent`, `workflow`, `autonomous`, `changelog`) — those were CLI fixtures of the inherited package and have no role in the new design unless re-introduced as registered agents.

### D10 — Source restructure permitted (amends D4)
**The "verbatim copy + single carve-out" rule from D4 is retired.** Source files in the moved package are reorganized as needed: `agent-builder.ts`, `prompt.ts`, `spawn-claude.ts`, `worktree.ts`, `spawn.ts`, `changelog.ts` move into `packages/munchkins-core/src/`. The inherited `cli/` directory (with its `agent.ts`, `workflow.ts`, `autonomous.ts`, `changelog.ts`, `bugfix.ts` subcommand wrappers) is removed. The `bugfix-agent.ts` constructor relocates to `packages/munchkins/agents/bugfix/` per D8.

Reason: D4 was a discipline rule for the scaffold milestone (move fast, don't refactor in flight). With the scaffold complete, deliberate restructuring is the point of the new work, not scope creep.

### D11 — AgentRegistry lives in `-core`
**`AgentRegistry` is a `@serranolabs.io/munchkins` export.** Default agents in the bundle import the registry from `-core` and call `registry.register(agentBuilder)` at module load. Consumers use the same registry instance for their own agents.

Reason: the registry is framework infrastructure — its presence in `-core` keeps "framework + my own agents" a viable consumer path without dragging in the defaults bundle.

### D12 — Schema-driven CLI flag derivation
**`AgentBuilder` (in `-core`) declares its configurable inputs as a plain TypeScript object literal** — e.g. `{ userMessage: { type: 'string', required: true, description: '...' } }` — via an `.option(name, schema)` method called inline in the builder chain. `AgentRegistry.cli()` walks all registered builders, generates a Commander `Command` per builder, and renders each schema entry as a `--flag` (kebab-cased: `userMessage` → `--user-message`). No Zod, no JSON-schema sidecar, no TypeScript reflection.

Reason: schema-driven keeps a single source of truth (the agent file itself) and avoids a runtime dependency for a small set of well-typed primitives (`string`, `boolean`, `number`, `string[]`).

### D13 — Mock seam stays in `-core`
**`spawn-claude.ts` lives in `packages/munchkins-core/src/builder/`.** The harness's `mock.module()` path becomes `@serranolabs.io/munchkins/builder/spawn-claude.ts` — T1's chosen mechanism survives the rename; only the import specifier changes.

Reason: Claude invocation is framework infrastructure. Keeping it in `-core` keeps the mock seam trivially reachable for any consumer who builds their own agents on `-core` directly.

---

## Carry-forward into Stage 3 (PRD)

The PRD must:
- Treat the scaffold layout (D1) and workspace scope (D2) as fixed.
- Express user scenarios for: (s1) running the munchkins CLI from the new monorepo, (s2) reading plan-funnel artifacts in local Rspress dev, (s3) building public docs with internal artifacts excluded, (s4) running scaffolded scenario workflow.
- Call out current implementation status of every behavior in direct language. The current state is: **nothing implemented** — the repo is bare. Do not describe the scaffold as "in progress" or "pending" euphemistically; say "missing — to be created."
- Keep harness vs product contracts separable per plan-funnel boundary rules. The munchkins CLI is product-facing; the scenario workflow is harness — they must not depend on each other's identifiers.

