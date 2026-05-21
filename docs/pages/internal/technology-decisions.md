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

## T1 — Claude-call mock seam mechanism (amended — change-impact round 1)

**Chosen: (a) Bun's `mock.module()`.**

The harness installs the mock at the top of `scenarios/index.ts` via `mock.module('@serranolabs.io/munchkins/builder/spawn-claude.ts', () => ({ spawnClaude: <mockFn> }))` BEFORE dynamic-importing the bugfix-agent constructor from `@serranolabs.io/munchkins/agents/bugfix`. **Module path amended per D13** — `spawn-claude.ts` now lives in `packages/munchkins-core/src/builder/`, not `packages/munchkins/src/builder/`. Production source is untouched.

Rejected:
- (b) DI via `AgentBuilder` constructor option for the spawn-claude function — costs a multi-line edit to `agent-builder.ts`. The new constructor signature `(name, description?)` is unrelated and solves a different problem (CLI metadata, not test-time injection).
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

## T5 — `bun publish` vs `npm publish` for S12 (amended — change-impact round 1)

**Chosen: (a) `bun publish`, run twice in topological order.**

`publish.yml`'s publish job, after the gate jobs pass, runs:

```sh
bun publish --cwd packages/munchkins-core   # publish framework first
bun publish --cwd packages/munchkins        # then bundle (depends on -core)
```

Both auth via the same `.npmrc` written from `${{ secrets.NPM_TOKEN }}`. Both packages declare `publishConfig.access: "public"` (T11). Topological order matters because the bundle's `dependencies["@serranolabs.io/munchkins"]` is set to the just-tagged version; publishing the bundle first would land a registry entry pointing at a non-existent dep version, breaking installs until `-core` lands.

Rejected:
- (b) `npm publish` — would be the only `npm` invocation in the repo, violating CLAUDE.md's Bun-only rule for no upside.
- (c) Single `bun publish` from the workspace root — Bun does not yet have first-class workspace-aware publishing that handles inter-workspace dep version-rewriting; running per-workspace is reliable.
- (d) Parallel publishes via `bun publish --cwd ... &` — race conditions on registry write order can break the dep chain.

Reason: Bun-only repo discipline; explicit ordering is the safest dep-graph-aware approach for two packages.

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

## T11 — npm publish access (declared, amended — change-impact round 1)

**Both** `packages/munchkins-core/package.json` and `packages/munchkins/package.json` declare:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

Required because both `@serranolabs.io/munchkins` and `@serranolabs.io/munchkins` are scoped packages and scoped packages default to private on npm (which fails on free npm accounts and for unintended-private publishes).

No fork — required by S12.

## T12 — Package split topology

**Chosen: two `packages/*` workspaces with the bundle depending on the framework via workspace protocol.**

```
packages/
├── munchkins-core/       # @serranolabs.io/munchkins — framework
│   ├── package.json      # name, version, exports, publishConfig
│   ├── tsconfig.json     # extends ../../tsconfig.json
│   └── src/
│       ├── index.ts                      # re-exports
│       ├── builder/
│       │   ├── agent-builder.ts          # AgentBuilder(name, description?) + .option() (residual) + .add() option-extraction
│       │   ├── prompt.ts
│       │   ├── spawn-claude.ts           # mock seam (T1, D13)
│       │   └── index.ts
│       ├── registry/
│       │   ├── registry.ts               # AgentRegistry singleton
│       │   ├── cli.ts                    # registry.cli() Commander generator
│       │   └── index.ts
│       ├── worktree.ts
│       ├── spawn.ts
│       └── changelog.ts
└── munchkins/            # @serranolabs.io/munchkins — defaults bundle
    ├── package.json      # depends on @serranolabs.io/munchkins: "workspace:*"
    ├── tsconfig.json
    ├── src/
    │   └── index.ts                      # re-exports + side-effect registers default agents
    └── agents/
        └── bugfix/
            ├── bugfix-agent.ts           # createBugfixAgent + auto-register call
            └── prompts/
                ├── bug-fix.md
                ├── refactorer.md
                └── deterministic-fixer.md
```

The bundle's `package.json` declares:

```json
{
  "dependencies": {
    "@serranolabs.io/munchkins": "workspace:*"
  }
}
```

`bun publish` resolves `workspace:*` to the published version at publish time (Bun handles this automatically; verified in `plan.md`). Both packages export from a top-level `src/index.ts` for ergonomics; the bundle additionally exports `agents/bugfix` as a subpath for explicit deep imports.

Rejected:
- (b) Single workspace with a `subpath/exports` map — published consumers can't separate framework from defaults; defeats the purpose of D7.
- (c) Three workspaces (`munchkins-core`, `munchkins-bugfix`, `munchkins` meta-bundle re-exporting both) — more topology than needed today; revisit if a second default agent appears.

Reason: minimal split that satisfies "framework installable independently" + "defaults shipped to consumers by default" + "outside `src/` for the example agent."

## T13 — AgentRegistry + AgentBuilder shape (amended — Option Y)

**Chosen: agent name + description live in the `AgentBuilder` constructor. Prompt-consumed options are declared inline via `Prompt.withUserMessageFromOption(name, schema?)`. Non-prompt-consumed flags use the residual `AgentBuilder.option(name, schema)`. `AgentRegistry.register(builder)` takes no metadata. Per-invocation values flow through internally-namespaced env vars (`__MUNCHKINS_OPT_*`); the agent author never types env-var names. `AgentBuilder` exposes `name`, `description`, `options` as plain public readonly fields — no `get` accessors.**

### `Prompt` (in `-core`) — renamed/added methods

```ts
type Fragment =
  | { kind: "text";              text: string }
  | { kind: "input-from-option"; optionName: string };

export class Prompt {
  constructor(systemPath?: string) { /* unchanged */ }

  // Renamed from `withText(text)`. Eager literal user message.
  withUserMessage(text: string): this {
    this.fragments.push({ kind: "text", text });
    return this;
  }

  // New. Lazy, option-driven. The optional schema arg DECLARES the option
  // when first encountered; subsequent calls referring to the same option
  // can pass just the name. Implicit type: "string" (a path).
  withUserMessageFromOption(
    optionName: string,
    schema?: { required?: boolean; description: string; default?: string },
  ): this {
    this.fragments.push({ kind: "input-from-option", optionName, schema });
    return this;
  }

  resolve(repoRoot: string): { systemPrompt: string; userPrompt: string } {
    // existing branches plus:
    // for { kind: "input-from-option", optionName }:
    //   const path = process.env[`__MUNCHKINS_OPT_${optionName}`];
    //   if (!path) throw new Error(`Option "${optionName}" not provided`);
    //   return readFileSync(abs(path), "utf-8");
  }

  // Internal: lets AgentBuilder pull declared options out at .add() time.
  get fragments(): readonly Fragment[] { return this._fragments; }
}
```

The previous `withInput(path)` (eager file read) is **dropped**. Agents that need to bake a static file's contents in at module load can do `withUserMessage(readFileSync(path, "utf-8"))` explicitly.

### `AgentBuilder` (in `-core`) — additions

`AgentBuilder` keeps its existing methods (`.add`, `.addDeterministic`, `.finalize`, `.run`) and signatures. `.run()` is unchanged. `name` and `description` move into the constructor; the registry reads them as plain public readonly fields (no `get` accessors).

```ts
export class AgentBuilder {
  // Public readonly fields, read directly by AgentRegistry:
  readonly name: string;
  readonly description?: string;
  readonly options = new Map<string, OptionSchema>();

  // Pipeline state stays private:
  private steps: Step[] = [];

  constructor(name: string, description?: string) {
    this.name = name;
    this.description = description;
  }

  // Residual escape hatch: declare an option NOT consumed by any prompt
  // (e.g., a boolean flag that only deterministic commands or finalize
  // echoes care about). Prompt-consumed options are auto-extracted in .add().
  option(name: string, schema: OptionSchema): this {
    if (this.options.has(name)) throw new Error(`Option "${name}" already declared`);
    this.options.set(name, schema);
    return this;
  }

  // .add() extracts option declarations from the prompt's fragments.
  add(prompt: Prompt): this {
    this.steps.push({ kind: "agent", prompt });
    for (const f of prompt.fragments) {
      if (f.kind !== "input-from-option" || !f.schema) continue;
      if (this.options.has(f.optionName)) continue;       // first-declaration-wins
      this.options.set(f.optionName, {
        type: "string",                                    // implicit — option drives a file path
        required: f.schema.required ?? false,
        description: f.schema.description,
        default: f.schema.default,
      });
    }
    return this;
  }

  // .addDeterministic(), .finalize(), .run() — unchanged.
}
```

No `.description()` method (constructor takes it). No `get` accessors (plain readonly fields).

### `AgentRegistry` (new — `packages/munchkins-core/src/registry/`)

```ts
export interface OptionSchema {
  type: "string" | "boolean" | "number" | "string[]";
  required?: boolean;
  description: string;
  default?: string | boolean | number | string[];
  // No `env` field. The framework owns the env-var namespace.
}

export class AgentRegistry {
  private agents = new Map<string, AgentBuilder>();

  register(builder: AgentBuilder): void {
    const name = builder.name;
    if (this.agents.has(name)) throw new Error(`Agent "${name}" already registered. Use replace() to overwrite.`);
    this.agents.set(name, builder);
  }
  replace(builder: AgentBuilder): void { this.agents.set(builder.name, builder); }
  list(): string[] { return [...this.agents.keys()]; }
  get(name: string): AgentBuilder | undefined { return this.agents.get(name); }

  cli(): Command {
    const program = new Command().name("munchkins");
    for (const [name, builder] of this.agents) {
      const sub = program.command(name).description(builder.description ?? "");
      for (const [flag, schema] of builder.options) {
        const flagStr = toCommanderFlag(flag, schema);   // "userMessage" + string + required → "--user-message <user-message>"
        if (schema.required) sub.requiredOption(flagStr, schema.description);
        else                 sub.option(flagStr, schema.description, schema.default as never);
      }
      sub.action(async (rawOpts: Record<string, unknown>) => {
        for (const [flag, value] of Object.entries(rawOpts)) {
          if (value === undefined) continue;
          process.env[`__MUNCHKINS_OPT_${flag}`] = String(value);   // private channel
        }
        const result = await builder.run();
        process.exit(result.succeeded ? 0 : 1);
      });
    }
    return program;
  }
}

export const registry = new AgentRegistry();
```

The `__MUNCHKINS_OPT_*` namespace is the framework's private bridge between the registry's CLI parser and `Prompt.resolve()`. Agent authors never see it; subprocesses spawned by deterministic steps inherit it but normally don't reference it directly.

### Bugfix agent registration (illustrative)

```ts
const builder = new AgentBuilder(
  "bug-fix",
  "Fix a bug described in a markdown user-message file.",
)
  .add(
    new Prompt(join(PROMPTS, "bug-fix.md")).withUserMessageFromOption("userMessage", {
      required: true,
      description: "Path to a markdown file describing the bug",
    }),
  )
  .add(new Prompt(join(PROMPTS, "refactorer.md")).withUserMessage("Refactor only files touched by the previous step. Do not expand scope."))
  .addDeterministic(["bun run lint", "bun run typecheck"], { loop: { ... } })
  .finalize([], { onPass: [...], onFail: [...] });

registry.register(builder);
```

The string `"userMessage"` appears once. No env-var name typed by the agent author. No `.option()` line for prompt-consumed options. The CLI surface (one subcommand `bug-fix`, one required flag `--user-message`) is fully derived from this builder.

### Why Option Y (vs Option Z — registry as separate metadata layer)

- Single source of truth: the builder owns its name, description, options, and pipeline together. The option declaration co-locates with the prompt that consumes it.
- `register(builder)` is single-arg — no metadata wrapping object, no factory closure.
- `AgentBuilder.run()` signature unchanged. Pipeline-execution behavior is untouched.
- The internal env-var namespace (`__MUNCHKINS_OPT_*`) keeps the runtime channel out of the builder's run-method signature and out of the agent author's mental model. No system-env collision risk.

Rejected:
- (Z) Registry takes `register(builder, meta)` with metadata as a separate arg — splits the agent's declarations across two files (or two locations in one file) for no concrete benefit on this codebase. Reopen if a future agent needs to be registered under multiple CLI shapes from the same builder.
- (X) Per-step CLI metadata via `add(prompt, meta)` widening — couples step ownership to flag ownership; multi-consumer flags become awkward.
- F1a (factory + AgentDefinition wrapping object + generics) — rejected by the user as "ugly."
- Decorator-based registration — needs decorator runtime support; tsconfig complexity.
- Auto-discovery via filesystem scan — fails for npm consumers (no filesystem to scan).

Reason: explicit `register(builder)` + a singleton registry is the simplest model that works the same way for the bundle, the harness, and downstream consumers. Constructor-level identity (`name` + `description`) plus inline option declarations (`withUserMessageFromOption(...)` for prompt-consumed; residual `.option(...)` for side-channel flags like `--dry-run`) keeps the builder file the single source of truth without growing the wrapping ceremony of separate metadata objects.

## T14 — Bugfix-agent location inside the bundle

**Chosen: `packages/munchkins/agents/bugfix/bugfix-agent.ts` with prompts at `agents/bugfix/prompts/`.**

The bundle's `package.json` `files` field includes `["src", "agents"]` so both directories ship in the published tarball. The bundle's `package.json` `exports` map adds:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./agents/bugfix": "./agents/bugfix/bugfix-agent.ts"
  }
}
```

`packages/munchkins/src/index.ts` side-effect-imports the bugfix module so a consumer's `import "@serranolabs.io/munchkins"` triggers `registry.register(createBugfixAgent(...))` automatically. Consumers who want to override prompts call `createBugfixAgent({ promptDir: ... })` and re-register.

Rejected:
- (a) `packages/munchkins/src/agents/bugfix/...` — keeps the agent inside `src/`, violating the user's stated constraint.
- (c) Repo-root `agents/bugfix/` outside any package — would not ship to consumers via `bun add @serranolabs.io/munchkins`; defeats the "ship as default" intent.

Reason: visually obvious "this is an example built with the framework, not part of the framework" boundary; co-located prompts; participates in the published tarball.

## T15 — Project-local bin script convention (no published binary)

**Chosen: no published `bin`. The repo checks in a sample bin script at `bin/munchkins.ts` for documentation only.**

The sample bin script (NOT a published surface — referenced only in `AGENTS.md` as an example):

```ts
#!/usr/bin/env bun
import { registry } from "@serranolabs.io/munchkins";
import "@serranolabs.io/munchkins"; // side-effect: registers default agents
await registry.cli().parseAsync(process.argv);
```

Neither `packages/munchkins-core/package.json` nor `packages/munchkins/package.json` declares a `bin` field. `npm i -g @serranolabs.io/munchkins` does NOT install a `munchkins` command on PATH. Downstream consumers who want a CLI write their own equivalent of the sample bin script and add their own bin/path wiring.

Rejected:
- (a) `bin` field on the bundle package — contradicts D9.
- (b) `bin` field on `-core` — same; also forces a default-agent-registration story on consumers who only want the framework.
- (c) Auto-generated bin via post-install hook — npm post-install hooks are deprecated/discouraged; security-flagged in many environments.

Reason: explicit, framework-agnostic, no surprise binaries. The sample bin script is documentation, not a contract.

## Carry-forward into `plan.md`

Each decision above maps to a concrete artifact the plan must produce. Entries marked **(amended)** are revised for change-impact round 1.

| Decision | Plan artifact / slice impact |
|----------|------------------------------|
| T1 (amended) | `scenarios/index.ts` calls `mock.module('@serranolabs.io/munchkins/builder/spawn-claude.ts', ...)` before the dynamic import of `@serranolabs.io/munchkins/agents/bugfix`. |
| T2 | `.github/workflows/docs-publish.yml` uses `actions/configure-pages` + `actions/deploy-pages`. `rspress.config.ts` sets `base` per-env. |
| T3 | `publish.yml` trigger: `tags: ['v*']`. |
| T4 | Root `biome.json` + `devDependencies.@biomejs/biome`. CI uses `biome ci .`. |
| T5 (amended) | `publish.yml`'s publish step runs `bun publish --cwd packages/munchkins-core` then `bun publish --cwd packages/munchkins`. |
| T6 | `/tsconfig.json` is the only place common compiler options live. All three workspace tsconfigs `extends` it. |
| T7 | `/turbo.json` task graph. Root `package.json` scripts wire turbo + biome + harness. |
| T8 | `docs/package.json` `@rspress/core` at scaffold-time-latest 2.x. |
| T9 | No tooling added; manual bump in BOTH `packages/munchkins-core/package.json` and `packages/munchkins/package.json` (and update bundle's dep on `-core` to match). Documented in `AGENTS.md`. |
| T10 | Root `package.json` `engines.bun`; all 3 workflows pin `bun-version`. |
| T11 (amended) | BOTH `packages/munchkins-core/package.json` and `packages/munchkins/package.json` add `publishConfig.access: "public"`. |
| T12 | Two-package topology under `packages/`. Bundle depends on `-core` via `workspace:*`. Bundle ships `src/` + `agents/` in tarball via `files`. |
| T13 | `packages/munchkins-core/src/registry/{registry.ts, cli.ts, index.ts}` materialize `AgentRegistry` + Commander generator. `AgentBuilder` constructor takes `(name, description?)`; exposes `name`/`description`/`options` as plain public readonly fields (no getters); residual `.option(name, schema)` for non-prompt-consumed flags; `.add()` extracts option declarations from prompts. `Prompt`: `withText` → `withUserMessage`; `withInput` dropped; new `withUserMessageFromOption(name, schema?)` + `"input-from-option"` fragment kind. Internal env channel `__MUNCHKINS_OPT_*`. `AgentBuilder.run()` signature unchanged. |
| T14 | `packages/munchkins/agents/bugfix/{bugfix-agent.ts, prompts/*.md}`. Bundle's `src/index.ts` side-effect-imports + registers it. |
| T15 | Sample `bin/munchkins.ts` checked in (documentation only). NEITHER package's `package.json` declares a `bin` field. |

## Current-state honesty (review checkpoint)

Every decision in this artifact describes future state. **No tooling, config, or workflow described here exists in the munchkins repo today** — it is bare except for `.git/`. The plan must materialize all of it. None of these decisions reopen product scope (PRD).
