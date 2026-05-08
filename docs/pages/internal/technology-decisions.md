---
stage: technology-decisions
artifact_root: docs/pages/internal/
status: draft
upstream:
  - docs/pages/internal/diagnosis.md
  - docs/pages/internal/prd.md
  - docs/pages/internal/scenario-testing-strategy.md
---

# Technology Decisions

Implementation-shaping forks resolved before `plan.md`. Each entry records the chosen option, rejected options, and the reason. Pure-content / plan-level details are NOT here — they live in `plan.md`.

## T1 — Claude-call mock seam mechanism

**Chosen: (a) Bun's `mock.module()`.**

The harness installs the mock at the top of `scenarios/index.ts` via `mock.module('@serranolabs.io/munchkins/builder/spawn-claude.ts', () => ({ spawnClaude: <mockFn> }))` BEFORE dynamic-importing the bugfix-agent constructor. Production source is untouched beyond the existing `program.name("munchkins")` carve-out (D4/D5).

Rejected:
- (b) DI via `AgentBuilder` constructor option — costs a multi-line edit to `agent-builder.ts`, expanding the D4 carve-out.
- (c) Env-var switch inside `spawn-claude.ts` — production code carries test-aware branches, which metastasize.

Reason: keeps test-awareness confined to the harness. Bun-native, designed for this case. Caveat documented for `plan.md`: import-order discipline (mock before dynamic import).

## T2 — Public docs host platform

**Chosen: (a) GitHub Pages.**

`docs-publish.yml` uses official `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages`. Auth via auto-provided `GITHUB_TOKEN`. Site URL: `https://<owner>.github.io/munchkins/` (project pages). Repo Settings → Pages → Source: "GitHub Actions."

Rejected:
- (b) Cloudflare Pages, (c) Vercel, (d) Netlify — all add an external account + 1–3 secrets to manage. Vercel's PR-preview superpower is real but unneeded for the scaffold milestone.

Reason: zero external accounts, zero secrets, first-class GitHub-internal action support, aligns with minimal-scope spirit of D2.

**Side effect on Rspress config:** `rspress.config.ts` must set `base: process.env.PUBLIC_DOCS === 'true' ? '/munchkins/' : '/'` so links resolve correctly under the project-pages subpath in production while keeping local dev rooted at `/`.

## T3 — Tag-naming convention for `publish.yml`

**Chosen: (a) `v0.1.0`-style semver tags.**

`publish.yml` trigger: `on: push: tags: ['v*']`. Convention: `git tag v0.1.0 && git push origin v0.1.0`.

Rejected:
- (b) `munchkins-v0.1.0` — scoped tags future-proof multi-package publishing, but D2 locks the workspace count and there is exactly one publishable package.

Reason: simplest convention; muscle-memory match. Migration to scoped tags later is a workflow-file edit with no historical-tag rename.

## T4 — Linter and formatter

**Chosen: (a) Pinned Biome with checked-in `biome.json`.**

`biome` is added as a `devDependency` at the repo root with a fixed version (latest stable at scaffold time, pinned via `bun.lock`). A `biome.json` lives at the repo root, declaring include/exclude globs and any rule overrides. Commands:

- `bun run lint` → `biome check .`
- `bun run format` → `biome format --write .`
- `bun run format:check` → `biome format .`
- CI: `biome ci .` (single command for lint + format check, designed for CI use)

Rejected:
- (b) `bunx biome check .` (insider-trading's mode) — no version pin, no committed config, can't reliably enforce rules in S10.
- (c) ESLint + Prettier + `@typescript-eslint` — heavier dep tree, ~5–10× slower on a small monorepo, no rule the user has flagged that Biome can't enforce.

Reason: Biome is single-tool (lint + format), Rust-fast, version-pinned for reproducibility, and will reliably trip on the "deliberate violation" used to validate S10.

## T5 — `bun publish` vs `npm publish` for S12

**Chosen: (a) `bun publish`.**

`publish.yml`'s publish step runs `bun publish --access public` (or auth via `.npmrc`). CI's `setup-bun` action provides Bun on PATH; no `setup-node` action needed.

Rejected:
- (b) `npm publish` — would be the only `npm` invocation in the repo, violating CLAUDE.md's Bun-only rule for no upside (auth mechanism and tarball semantics are equivalent).

Reason: Bun-only repo discipline. Fallback to (b) is a one-line workflow swap if Bun ever regresses on `publish` — low-cost rollback, not a reason to start with (b).

## T6 — Root tsconfig strategy

**Chosen: (a) Single root `tsconfig.json` with workspace tsconfigs that `extends` it.**

Layout:
- `/tsconfig.json` — defines common `compilerOptions` (`target: "ESNext"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `skipLibCheck: true`, `noEmit: true`, `esModuleInterop: true`, `isolatedModules: true`, `types: ["@types/bun"]`).
- `/packages/munchkins/tsconfig.json` — `extends: "../../tsconfig.json"`; overrides `include`, may add `experimentalDecorators` if the source needs it (TBD per source inspection in `plan.md`).
- `/docs/tsconfig.json` — `extends: "../tsconfig.json"`; overrides `include`, adds React/Rspress types (`@types/react`, `@types/react-dom`).

Per-workspace typecheck: `tsc --noEmit -p .` orchestrated by Turborepo (T7).

Rejected:
- (b) TypeScript project references — overkill at 2 workspaces with no cross-workspace runtime imports. The incremental-build win is invisible at this scale.
- (c) Mirror insider-trading exactly (standalone, non-extending tsconfigs) — duplicative; an option change requires editing both workspaces.

Reason: DRY, scales naturally to a small number of workspaces, native VSCode TypeScript service support.

## T7 — Turborepo task graph

**Chosen: (b) Light `dependsOn` deps.**

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["typecheck"],
      "outputs": ["dist/**", "doc_build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["typecheck"],
      "outputs": []
    }
  }
}
```

**Root `package.json` scripts** (NOT through turbo):
- `lint` → `biome check .`
- `format` → `biome format --write .`
- `format:check` → `biome format .`
- `scenario` → `bun run scenarios/index.ts` (harness; not a workspace)
- `docs:dev` → `turbo run dev --filter=docs`
- `docs:build` → `turbo run build --filter=docs`
- `typecheck` → `turbo run typecheck`
- `test` → `turbo run test`
- `build` → `turbo run build`

Rejected:
- (a) Minimal — no `dependsOn`. CI workflows would have to enforce ordering manually; developers running `turbo run test` blind would get red runs from unrelated type errors.
- (c) Heavy `^build` / `^typecheck` propagation — buys nothing at 2 workspaces with no cross-workspace runtime imports.

Reason: light deps catch the obvious foot-guns (don't bother testing if types are broken) without the ceremony of full graph-correctness for a tiny monorepo. Lint stays parallel to typecheck/test (it's a root command, not in the turbo graph) for fastest CI signal.

## T8 — Rspress version

**Chosen: (b) Latest Rspress 2.x at scaffold time.**

Pinned via `bun.lock` at install time. `docs/package.json` declares `@rspress/core` with the `^` range from whatever's latest in 2.x when scaffolding runs.

Rejected:
- (a) Pin to `^2.0.9` to match insider-trading — fine, but `^` semantics already pull recent releases on a fresh install, so the lower-bound match buys nothing.

Reason: scaffold installs the most recent stable 2.x; future `bun install` keeps it within the same semver minor.

## T9 — Version-bump tooling

**Chosen: (a) Manual.**

Developer edits `packages/munchkins/package.json` `version` field, commits, tags `v<version>`, pushes. `publish.yml` triggers on the tag push.

Rejected:
- (b) Changesets — designed for multi-package monorepos; one publishable package makes the machinery overhead.
- (c) `semantic-release` — best with team conventional-commits discipline; friction for solo work.

Reason: one publishable package, solo cadence, tag-driven workflow already locked. Adding tooling at scaffold time is premature.

## T10 — Bun version pinning (declared)

`engines.bun` field in root `package.json` pins the minimum (e.g., `">=1.1.30"` for `bun publish` support — exact value finalized in `plan.md` against whatever Bun version is current). All three workflows use `oven-sh/setup-bun` with an explicit `bun-version` input pinned to the same value, ensuring CI matches local dev.

No fork present — this follows directly from "all-Bun + deterministic CI."

## T11 — npm publish access (declared)

`packages/munchkins/package.json` declares:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

Required because `@serranolabs.io/munchkins` is a scoped package and scoped packages default to private on npm (which fails on free npm accounts and for unintended-private publishes).

No fork — required by S12.

## Carry-forward into `plan.md`

Each decision above maps to a concrete artifact the plan must produce:

| Decision | Plan artifact / slice impact |
|----------|------------------------------|
| T1 | `scenarios/index.ts` calls `mock.module()` before the dynamic-import line. Plan documents the import-order rule. |
| T2 | `.github/workflows/docs-publish.yml` uses `actions/configure-pages` + `actions/deploy-pages`. `rspress.config.ts` sets `base` per-env. |
| T3 | `publish.yml` trigger: `tags: ['v*']`. |
| T4 | Root `biome.json` + `devDependencies.@biomejs/biome`. CI uses `biome ci .`. |
| T5 | `publish.yml`'s publish step runs `bun publish`. |
| T6 | `/tsconfig.json` is the only place common compiler options live. Workspace tsconfigs `extends`. |
| T7 | `/turbo.json` exactly as shown above. Root `package.json` scripts wire turbo + biome + harness. |
| T8 | `docs/package.json` `@rspress/core` at scaffold-time-latest 2.x. |
| T9 | No tooling added; manual bump documented in `AGENTS.md` (handed off to `init-project`). |
| T10 | Root `package.json` `engines.bun`; all 3 workflows pin `bun-version`. |
| T11 | `packages/munchkins/package.json` adds `publishConfig.access: "public"`. |

## Current-state honesty (review checkpoint)

Every decision in this artifact describes future state. **No tooling, config, or workflow described here exists in the munchkins repo today** — it is bare except for `.git/`. The plan must materialize all of it. None of these decisions reopen product scope (PRD).
