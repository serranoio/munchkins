# Feature: Framework / consumer split (monolithic restructure)

**This is ONE feature, not many. Do not scope down. Do not pick a single
slice. The feature is the entire restructure described in the plan
referenced below, and the run is not complete until every acceptance
criterion in that plan is met.**

The previous feat-small run on this brief misinterpreted the work as
"pick the smallest preparatory cleanup and ship it." That was wrong.
The user has explicitly re-launched feat-small with instructions that
**the deliverable is the whole restructure landed in one agent run**.

## Source of truth

`docs/pages/internal/plans/framework-consumer-split.md` is the durable
spec. Read it fully before doing anything. Treat its 9 "migration
slices" as the *implementation order* for a single feature, not as nine
independent features. You may commit per-slice (preferred — keeps the
diff readable and the gate runnable between slices), but you do not
stop after any one slice. You stop only after slice 9.

## Concrete success conditions

When you finish, all of these must be true. Verify them before declaring
done:

1. `packages/munchkins-core/` directory no longer exists. Its source
   files live under `packages/munchkins/src/` preserving subdir layout.
2. `packages/serrano-munchkins/` workspace package exists, is `private:
   true`, depends on `@serranolabs.io/munchkins`, owns the 4 default
   agents (`bugfix`, `feat-small`, `refactor`, `director`), owns their
   skill bodies (`munchkins-{bug-fix,feat-small,refactor,director}/`),
   and has its own `agentRegistry.ts` that imports the agents and
   invokes `runCli(process.argv)`.
3. `packages/munchkins/` no longer contains any agent code or any of
   the 4 dogfood skills. It contains only framework primitives, the
   `cmux-launcher`, the new `init/` directory, and the two meta-skills
   `munchkins-new-munchkin` + `munchkins-launch-munchkin`.
4. `runCli` is exported from `@serranolabs.io/munchkins` as a callable
   function — the body of the previous `import.meta.main` block.
5. `munchkins-init` bin exists at `packages/munchkins/src/init/bin.ts`,
   registered in that package's `package.json` `bin` field. It is
   idempotent and performs scaffold + script-add + skill-install.
6. The standalone `skills install` command (registered today via
   `registerSkillsCommand`) is removed from the runtime CLI; its logic
   lives inside `munchkins-init`.
7. Every import in the monorepo that referenced
   `@serranolabs.io/munchkins-core` now references
   `@serranolabs.io/munchkins`. Grep proves zero remaining references.
8. Root `package.json` `"munchkins"` script invokes
   `packages/serrano-munchkins/agentRegistry.ts` (with the existing
   `MUNCHKINS_CHANGELOG_PATH` env var preserved).
9. `scenarios/consumer-bootstrap-e2e.ts` exists and exercises every
   bullet under "Consumer acceptance" in the plan doc. It is added to
   the `scenario` script in root `package.json`.
10. `scripts/onboarding-smoke.ts` exists, is TypeScript only (no .sh —
    this repo has zero shell scripts and that is a hard rule), and
    exercises every bullet under "Contributor acceptance" in the plan
    doc.
11. `docs/pages/internal/plans/todo.md` §5 is rewritten to match the
    plan's "Acceptance criteria" section.
12. `README.md` "Onboarding" section reflects the new flow (`bunx
    munchkins-init` replaces `bun run munchkins skills install`).
13. The full gate is green on the final state: `bun run typecheck &&
    bun run lint && bun test && bun run scenario` all pass.

## Implementation discipline

- **Do not deviate from the plan's slice order.** It is designed so each
  slice leaves the repo green; out-of-order edits will break
  intermediate states and force big-bang rewrites.
- **Commit between slices**, with `<type>(<scope>): <slice summary>`
  messages. The deterministic gate runs at the END of the agent step;
  you do not need to gate per slice, but separate commits keep the
  history navigable.
- **Resolve the two risks listed in the plan as you encounter them:**
  (a) skill resolution through workspace symlinks after the agent move
  (verify by inspecting `node_modules/@serranolabs.io/serrano-munchkins/`
  exists post-`bun install`); (b) director's `PURPOSE.md` path — keep
  it at the repo root and ensure director still reads it from cwd's
  repo root after the package move.
- **Settle the `exports` open question** in the plan: collapse to just
  `.` unless a scenario or test actively imports a subpath.

## What is explicitly out of scope

- Touching the `isDryRunRequested` helper that already landed
  (`b30f7cf`). It was an unrelated cleanup from the previous misfire;
  leave it where it is.
- Modifying any agent's behavior beyond the import-path rewrites
  required by the package move.
- Adding new munchkins.
- Rewriting README beyond the "Onboarding" section update specified
  above.

## Verification before declaring done

Run, in order, and only declare success if all four pass:

```
bun install
bun run typecheck
bun run lint
bun test
bun run scenario
```

Then assert by inspection:

```
test ! -d packages/munchkins-core
test -d packages/serrano-munchkins
test -f packages/serrano-munchkins/agentRegistry.ts
test -f packages/munchkins/src/init/bin.ts
test -f scenarios/consumer-bootstrap-e2e.ts
test -f scripts/onboarding-smoke.ts
rg "@serranolabs.io/munchkins-core" -l    # expect: zero matches
```
