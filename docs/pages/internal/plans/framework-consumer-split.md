# Framework / consumer split + onboarding test design

Recorded 2026-05-20. Pre-ship restructure — no published-package back-compat
constraints. Goal: cleanest possible consumer onboarding flow + the test
surfaces that prove it works.

## Goal

A consumer can:

```sh
bun add -D @serranolabs.io/munchkins
bunx munchkins-init                  # scaffolds agentRegistry.ts +
                                       installs bundled skills +
                                       adds package.json script
# in Claude Code:
/munchkins:new-munchkin              # scaffolds their first agent
bun run munchkins <their-agent>      # works
```

Zero default agents ship in the published package. The 4 current agents
(`bug-fix`, `feat-small`, `refactor`, `director`) become this-repo's dogfood.

## Architecture (settled)

| Concern | Decision |
|---|---|
| Published package | `@serranolabs.io/munchkins` |
| `munchkins-core` package | **Deleted.** Src merged into `packages/munchkins/src/`. |
| Dogfood location | `packages/serrano-munchkins/` (private workspace) |
| Entry point (consumer & dogfood) | A single `agentRegistry.ts` file |
| Command registration | Framework import side-effect registers `resume`/`status`/`daemon`; each agent import side-effect registers itself |
| Package.json script | `"munchkins": "bun run ./agentRegistry.ts"` |
| Bootstrap | `munchkins-init` bin (idempotent) — scaffolds + installs skills + adds script |
| Standalone `skills install` | **Deleted.** Folded into init. |
| Bundled skills | `munchkins-new-munchkin`, `munchkins-launch-munchkin` only |
| PURPOSE.md | Scaffolded by `new-munchkin` only when generating a director-shape agent |

### Final layout

```
packages/
  munchkins/                        # PUBLISHED
    src/
      builder/                      ← from munchkins-core
      registry/                     ← from munchkins-core
      resume/                       ← from munchkins-core
      status/                       ← from munchkins-core
      scheduler/                    ← from munchkins-core
      sandbox/                      ← from munchkins-core
      integrate.ts                  ← from munchkins-core
      worktree.ts                   ← from munchkins-core
      run-log.ts                    ← from munchkins-core
      cmux-launcher.ts              ← stays
      init/
        bin.ts                      ← NEW: bootstrap binary
        agentRegistry.template.ts   ← NEW: template emitted into consumer repo
        install-skills.ts           ← logic lifted from skills-install.ts
      index.ts                      ← re-exports + side-effect registers framework commands; exports runCli()
    skills/
      munchkins-new-munchkin/
      munchkins-launch-munchkin/
    package.json                    # bin: { "munchkins-init": "./src/init/bin.ts" }

  serrano-munchkins/                # PRIVATE — this repo's dogfood
    agents/                         ← moved from packages/munchkins/agents/
      bugfix/
      feat-small/
      refactor/
      director/
    skills/                         ← moved from packages/munchkins/skills/
      munchkins-bug-fix/
      munchkins-feat-small/
      munchkins-refactor/
      munchkins-director/
    PURPOSE.md                      ← moved from repo root (director reads it)
    agentRegistry.ts                ← imports the 4 agents, calls runCli
    package.json                    # private: true
```

Root `package.json` `"munchkins"` script repoints to
`packages/serrano-munchkins/agentRegistry.ts`. Repo-root `PURPOSE.md` stays
as a project-purpose doc; the director's input copy lives at
`packages/serrano-munchkins/PURPOSE.md` (or director reads from repo root —
TBD during slice 3).

## Migration slices

Each slice leaves the repo green (`bun run typecheck && bun run lint && bun
test && bun run scenario`).

### Slice 1 — Extract `runCli` from the bin

- Lift the body of the `import.meta.main` block in
  `packages/munchkins/src/index.ts:13-29` into an exported
  `runCli({ argv, cwd, env }): Promise<void>`.
- The bin still calls `runCli(process.argv)` when run directly.
- No behavioral change.

### Slice 2 — Stand up `packages/serrano-munchkins/`

- New private workspace package.
- `agentRegistry.ts` imports `runCli` + the 4 agents, calls
  `runCli(process.argv)`.
- Root `"munchkins"` script repoints to it.
- `packages/munchkins/src/index.ts` still imports the agents for the moment
  — both entry points work in parallel.
- Add to `turbo.json` pipeline (typecheck / test) if needed.

### Slice 3 — Move agents + their skills out of `packages/munchkins/`

- `packages/munchkins/agents/*` → `packages/serrano-munchkins/agents/*`
  (full git mv).
- `packages/munchkins/skills/munchkins-{bug-fix,feat-small,refactor,director}` →
  `packages/serrano-munchkins/skills/`. The `new-munchkin` /
  `launch-munchkin` skills stay in `packages/munchkins/skills/`.
- Remove the 4 agent imports from `packages/munchkins/src/index.ts`. Now the
  framework package has zero knowledge of agents.
- Move/copy `PURPOSE.md` if director needs it co-located. Otherwise leave
  at repo root and document that director reads from cwd's repo root.
- Update agent-side imports: `@serranolabs.io/munchkins` references in
  the 4 agents become `@serranolabs.io/munchkins` (still resolves through
  workspace; munchkins-core not yet deleted).

### Slice 4 — Collapse `munchkins-core` into `munchkins`

- `git mv packages/munchkins-core/src/* packages/munchkins/src/` (preserve
  per-subdir grouping: `builder/`, `registry/`, `resume/`, `status/`,
  `scheduler/`, `sandbox/`, plus the loose files).
- Rewrite every import in the monorepo from `@serranolabs.io/munchkins`
  → `@serranolabs.io/munchkins`. Sites today (per grep): agents (4),
  agents `_shared/presets.ts`, `register-skills-command.ts`, dogfood
  `agentRegistry.ts`, all scenario files (6+), `packages/munchkins/src/index.ts`,
  test files.
- Delete `packages/munchkins-core/` directory.
- Drop `@serranolabs.io/munchkins` from root `devDependencies` and
  from `packages/munchkins/package.json`'s `dependencies`.
- Update `packages/munchkins/package.json` `exports` to re-include
  what `munchkins-core/package.json` was exporting (`./builder`,
  `./registry`, `./scheduler` — see if they're actually used externally;
  if only used internally by the dogfood, root `.` export suffices).

### Slice 5 — Build `munchkins-init` + delete standalone `skills install`

- New bin `packages/munchkins/src/init/bin.ts`. Tasks (all idempotent):
  1. Detect `<cwd>/package.json`; require its existence.
  2. Write `<cwd>/agentRegistry.ts` if absent (template at
     `init/agentRegistry.template.ts`).
  3. Ensure `<cwd>/package.json` has `"scripts"."munchkins"` set to
     `"bun run ./agentRegistry.ts"`. Don't clobber if already set.
  4. Run skill install (lifted from `skills-install.ts`) — symlink
     framework's bundled skills into `<cwd>/.claude/skills/`,
     skip-if-exists.
  5. Print next-step hint pointing at `/munchkins:new-munchkin`.
- Add to `packages/munchkins/package.json`:
  `"bin": { "munchkins-init": "./src/init/bin.ts" }`.
- Delete `packages/munchkins/src/register-skills-command.ts`,
  `register-skills-command.test.ts`, `skills-install.ts` (logic moves into
  `init/install-skills.ts`), `skills-install.test.ts`. Or keep
  `skills-install.ts` as a callable function consumed by `init/bin.ts`
  and the dogfood's bootstrap path — TBD during the slice.
- Remove `registerSkillsCommand(registry)` call from
  `packages/munchkins/src/index.ts`.

### Slice 6 — Consumer-simulation scenario

`scenarios/consumer-bootstrap-e2e.ts`. Asserts the consumer onboarding
contract end to end. See "Acceptance criteria" below for the assertion
list.

Mechanism: `bun pm pack` the framework package to a `.tgz`, install into
a temp dir via `bun add -D <tgz>` (real install, real node_modules — not
`workspace:*`).

### Slice 7 — Contributor onboarding smoke

`scripts/onboarding-smoke.ts` — runs the clean-clone path in a tmpdir.
Manual + invokable from CI on PRs that touch packaging. TypeScript only;
no shell scripts in this repo.

### Slice 8 — Rewrite acceptance criteria in `todo.md`

Update `docs/pages/internal/plans/todo.md:120-141` with the criteria below.

### Slice 9 — README + onboarding docs

- README's "Onboarding" section reflects the new flow (`bunx
  munchkins-init` replaces `bun run munchkins skills install`).
- Default-agents table moves into a "Dogfood" section or out of the README
  entirely.

## Acceptance criteria (replaces current todo.md §5)

**Consumer (`scenarios/consumer-bootstrap-e2e.ts`):**
- `bun add -D <tarball>` succeeds in a clean tmp repo with no warnings
  beyond expected workspace-resolution noise.
- `bunx munchkins-init` scaffolds `agentRegistry.ts`, adds the
  `"munchkins"` script, and symlinks bundled skills into
  `.claude/skills/munchkins-{new-munchkin,launch-munchkin}/`.
- `bun run munchkins --help` lists `resume`, `status`, `daemon` —
  and zero agent commands.
- Re-running `bunx munchkins-init` preserves operator edits to
  `.claude/skills/*/SKILL.md` (skip-if-exists).
- A hand-scaffolded stub agent appears in `--help` after appending its
  import to `agentRegistry.ts`. `bun run munchkins stub` runs it end to
  end.
- `MUNCHKINS_CHANGELOG_PATH=foo.md bun run ./agentRegistry.ts stub …`
  writes the changelog at `foo.md` (no reliance on the npm-script
  wrapper).

**Contributor (`scripts/onboarding-smoke.ts`):**
- `git clone` → `bun install` → `bun run typecheck && bun run lint &&
  bun test && bun run scenario` all green.
- `bun run munchkins --help` lists the 4 dogfood agents plus framework
  commands.
- `bun run munchkins bug-fix --user-message=<trivial>` lands a single
  commit on `main` and cleans the worktree.

## Out of scope for this plan

- Testing `/munchkins:new-munchkin`'s scaffolding behavior end-to-end —
  requires a real Claude session; lives in its own skill scenario.
- Migrating consumers (there are none — pre-ship).
- Rewriting the `director` agent's `PURPOSE.md` discovery semantics
  beyond the location move in slice 3.
- Per-agent CI workflows in consumer repos. Covered by README guidance,
  not enforced by this plan.

## Risks / open subquestions

- **Skill resolution from `node_modules/@serranolabs.io/munchkins/skills/`
  for the dogfood.** Currently the 4 dogfood skills sit at
  `packages/munchkins/skills/` and are symlinked into `.claude/skills/`
  via the workspace-linked node_modules path. After slice 3 they move to
  `packages/serrano-munchkins/skills/`. The `skills install` (now `init`)
  walker must traverse both `node_modules/@serranolabs.io/munchkins/skills/`
  (for new-munchkin / launch-munchkin) AND
  `node_modules/@serranolabs.io/serrano-munchkins/skills/` (for the dogfood
  4). Verify this works through Bun's workspace symlinks during slice 3.
- **Director's PURPOSE.md path.** Today it reads from cwd's repo root.
  Confirm before slice 3 whether to keep it there or move into the
  serrano-munchkins package.
- **`exports` field in published package.** Decide whether to expose
  framework subpaths (`./builder`, `./registry`, `./scheduler`) the way
  `munchkins-core` did, or collapse to just `.`. Lean: just `.` —
  consumers import named exports from the root.
