# Changelog

Autonomously-generated entries from agent runs. Most recent first.

---

## feat(integrate): commit dirty repoRoot as operator WIP instead of hard-failing (484fcae)
**2026-05-27 20:46 PDT · feat-small · 1292.6s · $11.2000**

**Goal:** Reverse the hard-fail on dirty `repoRoot` in `integrateBranch` — instead, commit the operator's dirty content as a first-class WIP commit on `main` with a humane templated subject, then rebase + squash-merge the agent's branch on top.

**Outcome:** `integrateBranch` now calls a new private `commitDirtyRepoRoot` helper that detects dirty content (excluding `.worktrees/`), stages it (`git add -A`, with a `:!.worktrees` pathspec exclusion only when `.worktrees` isn't already gitignored), and commits it under the subject `wip(operator): changes captured before <agent>/<slug>` (or `…before <branch>` when no `operatorWipContext` is threaded through). The agent-builder populates the context from the agent's name + slug; `integrateMerge` threads it through. Replaced the three reject-on-dirty unit tests with four commit-on-dirty tests (D1 tracked, D2 untracked, D3 `.worktrees/` exclusion, D4 fallback subject) plus an `integrateMerge` threading test, and added `scenarios/dirty-main-commit-e2e.ts` wired into `bun run scenario`. Bumped to 0.4.0 with a changelog entry. Also extracted a small `munchkinsCommit` helper so the operator-identity git config is in one place.

**How to test manually:**

1. From repo root, run the new scenario directly to exercise the full bug-fix pipeline against a sandbox with both dirty tracked + untracked content:
   ```
   bun run scenarios/dirty-main-commit-e2e.ts
   ```
   Expected: exits 0 and prints a `pass` result line. On failure, sandbox + artifacts are preserved under `.scenario-artifacts/dirty-main-commit-e2e-<ts>/`.
2. Run the full scenario suite to confirm no other scenarios regressed:
   ```
   bun run scenario
   ```
   Expected: every scenario including `dirty-main-commit-e2e.ts` exits 0.
3. Run the new unit tests in isolation to see the D1–D4 + `integrateMerge` threading assertions:
   ```
   bun test packages/munchkins/src/integrate.test.ts
   ```
   Expected: the `integrateBranch commits dirty repoRoot as operator WIP` describe block (D1–D4) and the new `integrateMerge threads operatorWipContext…` test all pass.
4. Out-of-band check the scenario doesn't cover: simulate the operator-recovery story by hand. In a throwaway sandbox after running the scenario with `--preserve`:
   ```
   bun run scenarios/dirty-main-commit-e2e.ts --preserve
   cd <preserved sandbox path printed on failure, or cd into the sandbox before cleanup>
   git log --oneline main -5
   ```
   Confirm the second line on `main` is `wip(operator): changes captured before bug-fix/<slug>` and is a normal commit (no synthetic prefix). Then verify operator recovery is just standard git: `git commit --amend -m "docs: my real subject"` rewrites it, and `git reset HEAD^` would pop it back off cleanly.
5. Edge case — `.worktrees/` exclusion: in any sandbox with an agent worktree already created, drop a file at `.worktrees/stray.txt` and re-run integration. Expected: integration proceeds as if clean, no operator WIP commit is created, and `git log main^` shows the pre-integration tip (this is what D3 verifies, but worth eyeballing once).
6. Fallback subject path: call `integrateBranch` (or `integrateMerge`) without `operatorWipContext` against a dirty repo — expected subject is `wip(operator): changes captured before <branch>` (D4 covers this; the smallest manual repro is just reading D4 in `integrate.test.ts`).

**Files changed:**

- packages/munchkins/src/integrate.ts
- packages/munchkins/src/integrate.test.ts
- packages/munchkins/src/builder/agent-builder.ts
- packages/munchkins/package.json
- docs/pages/changelog.md
- scenarios/dirty-main-commit-e2e.ts
- package.json

---
## feat(integrate): commit dirty repoRoot as operator WIP instead of hard-failing (0.4.0)
**2026-05-27**

- `integrateBranch` no longer aborts when `repoRoot` is dirty. The operator's dirty content (tracked + untracked, excluding `.worktrees/`) is staged and committed on `baseBranch` as a real first-class WIP commit before the rebase, then the agent's squash-merge lands on top.
- WIP commit subject is templated as `wip(operator): changes captured before <agent>/<slug>` (via the new optional `IntegrateOptions.operatorWipContext`), falling back to `wip(operator): changes captured before <branch>` when the context is absent. No synthetic prefix is exported — recovery uses normal `git log` / `git commit --amend` / `git reset`.
- Replaced the 3 reject-on-dirty unit tests with 3 commit-on-dirty tests (D1 tracked, D2 untracked, D3 `.worktrees/` exclusion).
- Added `scenarios/dirty-main-commit-e2e.ts` driving the `bug-fix` agent against a sandbox seeded with both dirty tracked and untracked content; asserts the post-integrate history is `<agent squash> ⟶ <operator wip> ⟶ <seed>` and the previously-untracked file reaches `main`.
- Version bumped to 0.4.0.

---

## chore(integrate): hard-fail on dirty repoRoot, remove snapshotDirtyRepoRoot (0.3.0)
**2026-05-27**

- Removed `snapshotDirtyRepoRoot` function and `SNAPSHOT_MSG_PREFIX` export from `integrate.ts`.
- `integrateBranch` now returns `{ ok: false }` immediately when `repoRoot` is dirty instead of auto-committing a snapshot; consumers must reject dirty repos at their `ensure-repo-clean` step before munchkin runs.
- Deleted `scenarios/dirty-main-e2e.ts`; replaced the five D1-D5 snapshot-tolerance unit tests with three tighter reject-on-dirty tests (D1/D3/D4) that assert the new contract.
- Version bumped to 0.3.0.

---

## feat(scenarios): add director Foreman PR-integrate e2e scenario (3580a16)
**2026-05-25 18:03 PDT · feat-small · 710.4s · $5.8304**

**Goal:** Close PURPOSE.md Success #1's empty director Foreman slot by adding a `--integrate=pr` end-to-end scenario that drives the registered `director` agent against a fake `gh` shim and a bare-repo `origin`, without exercising real child dispatch.

**Outcome:** Added `scenarios/director-pr-integrate-e2e.ts` (renamed from the prior refactor PR harness) with its own dedicated fixture tree under `scenarios/fixtures/director-pr-integrate-e2e/`. The seed includes a `PURPOSE.md` so the director's deterministic surveys succeed; mocked Claude responses cover triage (emitting an upstream-idle short-circuit), spec, plan, and the summary-writer (whose body contains the `**Goal:**` marker so the existing PR-body assertion holds). The harness installs the `munchkins-director` skill, sets `__MUNCHKINS_OPT_integrate=pr` and `__MUNCHKINS_OPT_userMessage=tick`, asserts the same PR-create boundary as the feat-small Foreman scenario, and additionally asserts `summary.json.agent === "director"`. Wired the new scenario into the `scenario` script in `package.json` and removed the prior refactor Foreman / Lights out scenarios + plan docs that are owned by the parallel sibling slices.

**How to test manually:**

1. From the repo root, run the new scenario standalone: `bun scenarios/director-pr-integrate-e2e.ts`. Expect exit code 0 and a `PASS` line for `director-pr-integrate-e2e`.
2. Run it a second time immediately: `bun scenarios/director-pr-integrate-e2e.ts`. Expect exit code 0 again with no leftover `.scenario-artifacts/director-pr-integrate-e2e-*` directory (artifacts are cleaned on pass unless `--preserve` is passed).
3. Inspect artifacts on a preserved run: `bun scenarios/director-pr-integrate-e2e.ts --preserve`, then `ls .scenario-artifacts/` and `cat .scenario-artifacts/director-pr-integrate-e2e-*/gh.log` — verify exactly one JSON line with `argv[0]="pr"`, `argv[1]="create"`, `flags.base="main"`, non-empty `flags.title`, and `flags.body` containing `**Goal:**`.
4. Confirm the run-log identifies the director: `cat .scenario-artifacts/director-pr-integrate-e2e-*/*/summary.json | jq .agent` should print `"director"`.
5. Verify the aggregate gate picks it up: `bun run scenario`. Expect every scenario (including the new one) to pass and exit 0.
6. Sanity-check audit guarding: `PATH=/usr/bin:/bin bun scenarios/director-pr-integrate-e2e.ts` (no real `claude` or `gh` binary required since the harness mocks `spawn-claude` and prepends the fake `gh` shim onto PATH). Still exits 0 — proves no real `claude`/`gh` spawn occurred.
7. Confirm fixture isolation from the parallel refactor slices: `ls scenarios/fixtures/director-pr-integrate-e2e/` should show `seed-repo/` and `mock-claude-responses/`; the prior `scenarios/fixtures/refactor-*/` directories are intentionally absent in this slice's diff (owned by sibling refactor slices).
8. Cross-check the multi-dispatch scenario is untouched: `bun scenarios/director-multi-dispatch-e2e.ts` still exits 0 — the Lights out half of the director's PURPOSE #1 coverage remains intact.

**Files changed:**

- package.json
- scenarios/director-pr-integrate-e2e.ts
- scenarios/fixtures/director-pr-integrate-e2e/.gitignore
- scenarios/fixtures/director-pr-integrate-e2e/seed-repo/PURPOSE.md
- scenarios/fixtures/director-pr-integrate-e2e/seed-repo/package.json
- scenarios/fixtures/director-pr-integrate-e2e/seed-repo/.gitignore
- scenarios/fixtures/director-pr-integrate-e2e/mock-claude-responses/01-triage.json
- scenarios/fixtures/director-pr-integrate-e2e/mock-claude-responses/02-spec.json
- scenarios/fixtures/director-pr-integrate-e2e/mock-claude-responses/03-plan.json
- scenarios/fixtures/director-pr-integrate-e2e/mock-claude-responses/04-summary.json
- docs/pages/changelog.md
- docs/pages/internal/plans/director-foreman-scenario-05252026-1749.md
- docs/pages/internal/plans/refactor-foreman-scenario-05252026-1749.md
- docs/pages/internal/plans/refactor-lights-out-scenario-05252026-1749.md
- scenarios/refactor-agent-e2e.ts
- scenarios/refactor-pr-integrate-e2e.ts
- scenarios/fixtures/refactor-agent-e2e/mock-claude-responses/01-refactor.json
- scenarios/fixtures/refactor-agent-e2e/mock-claude-responses/02-summary-writer.json
- scenarios/fixtures/refactor-agent-e2e/seed-repo/refactor.md
- scenarios/fixtures/refactor-agent-e2e/seed-repo/src/greet.ts
- scenarios/fixtures/refactor-agent-e2e/seed-repo/package.json
- scenarios/fixtures/refactor-pr-integrate-e2e/mock-claude-responses/01-refactor.json
- scenarios/fixtures/refactor-pr-integrate-e2e/mock-claude-responses/02-summary-writer.json
- scenarios/fixtures/refactor-pr-integrate-e2e/seed-repo/refactor.md
- scenarios/fixtures/refactor-pr-integrate-e2e/seed-repo/src/greetings.ts
- scenarios/fixtures/refactor-pr-integrate-e2e/seed-repo/package.json

---
## feat(scenarios): add feat-small Foreman PR-integrate E2E (e265009)
**2026-05-24 20:31 PDT · feat-small · 391.9s · $1.7435**

**Goal:** Close the feat-small Foreman half of PURPOSE.md Success #1 by adding a `--integrate=pr` end-to-end scenario for the registered `feat-small` agent.

**Outcome:** Added `scenarios/feat-small-pr-integrate-e2e.ts`, patterned after `scenarios/bugfix-pr-integrate-e2e.ts` but pointed at the feat-small fixtures, skill, agent registration, and `feature.md` user message. The harness stands up a bare-repo `origin` plus a fake `gh` PATH shim, runs the agent end-to-end, and asserts: zero real `claude` spawns, exactly one `gh pr create --base main` with non-empty `--title`/`--body` containing `**Goal:**`, local `main` SHA unchanged, an `agent/*` branch pushed to the remote with a `docs(changelog):` tip subject, and clean worktree teardown. Wired the new scenario into the `scenario` script in `package.json` so it runs alongside the existing gates.

**How to test manually:**

1. From the repo root on a clean working tree, run `bun scenarios/feat-small-pr-integrate-e2e.ts` and confirm it exits 0 and prints a `pass` result. Re-run it immediately to confirm it still exits 0 with no leftover state.
2. Run `bun scenarios/feat-small-pr-integrate-e2e.ts --preserve`, then inspect the preserved artifact directory printed to stderr (`.scenario-artifacts/feat-small-pr-integrate-e2e-<ts>/`). Open `gh.log` and verify there is exactly one JSON line whose `argv` starts with `["pr","create",...]` and whose `flags` include `base: "main"`, a non-empty `title`, and a `body` containing `**Goal:**`. Open `result.json` and confirm `result: "pass"`.
3. Negative-path check: temporarily edit `packages/serrano-munchkins/agents/feat-small/feat-small-agent.ts` to break the integrate step (e.g. force the integrate strategy to `"merge"`), run `bun scenarios/feat-small-pr-integrate-e2e.ts`, and confirm it now exits 1 with a `phase: "assertion"` failure about `gh pr create` invocation count or local main advancing. Revert the edit and confirm the scenario passes again.
4. Regression sweep: run `bun run scenario` and confirm the full chain — including `scenarios/index.ts`, `scenarios/bugfix-pr-integrate-e2e.ts`, and `scenarios/feat-small-agent-e2e.ts` — still passes. Then run `bun run lint` and `bun run typecheck` to confirm both gates are green.

**Files changed:**

- scenarios/feat-small-pr-integrate-e2e.ts
- package.json

---
## feat(scenarios): add feat-small Lights out end-to-end scenario (5b08529)
**2026-05-24 20:17 PDT · feat-small · 689.4s · $5.0330**

**Goal:** Close half of PURPOSE.md Success #1 by adding a `feat-small` Lights out (`--integrate=merge`) scenario that mirrors the existing `bugfix-agent-e2e` harness and asserts a merged diff plus intact run-log artifacts.

**Outcome:** Added `scenarios/feat-small-agent-e2e.ts` patterned after `scenarios/index.ts`, wired it into the root `scenario` script, and shipped supporting fixtures: a minimal seed repo with a `multiply` TODO in `src/math.ts`, a `feature.md` describing the requested change, and four mock Claude responses — one per pipeline step (implementer → refactorer → test-writer → summary-writer). The harness installs the `munchkins-feat-small` skill into the sandbox, drives the registered agent to completion against the mocks, then asserts `agentResult.succeeded`, the mock call count, zero real `claude` spawns, clean `.worktrees/` and `agent/*` branch teardown, that `main` advanced past the seed with all per-step marker files tracked, and that the four `step-0{1..4}` run-log triples plus a parseable `summary.json` with `agent === "feat-small"` were emitted.

**How to test manually:**

1. From the repo root, run `bun scenarios/feat-small-agent-e2e.ts` from a clean working tree and expect exit code 0 with a `pass` result printed by `printResult`. Confirm the artifact directory is removed afterward (no `.scenario-artifacts/feat-small-agent-e2e-*` leftover).
2. Run it a second time immediately — `bun scenarios/feat-small-agent-e2e.ts` — and expect another clean exit 0 with no leftover sandbox, `.worktrees/`, or `agent/*` branch in the munchkins repo. Verify with `git worktree list` and `git branch --list 'agent/*'`.
3. Force the artifact path to stick: `bun scenarios/feat-small-agent-e2e.ts --preserve` and confirm stderr prints `scenario artifacts preserved at: …` and that the directory contains `summary.json`, `events.jsonl`, and the four `step-0{1..4}` `.system.md` / `.user.md` / `.response.txt` triples. Open `summary.json` and confirm `"agent": "feat-small"`.
4. Confirm the regression gate by running `bun run scenario` from the repo root and verifying the new scenario runs in sequence between `bugfix-pr-integrate-e2e` and `consumer-bootstrap-e2e`, and that the pre-existing scenarios (`scenarios/index.ts`, `scenarios/bugfix-pr-integrate-e2e.ts`) still pass unaffected.
5. Edge check: temporarily edit `scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/04-summary-writer.json` to set `"exitCode": 1` and re-run `bun scenarios/feat-small-agent-e2e.ts`. Expect a non-zero exit, an `execution` or `assertion` phase failure in the printed result, and the artifact directory preserved with a `result.json` capturing the failure. Revert the change after.

**Files changed:**

- package.json
- scenarios/feat-small-agent-e2e.ts
- scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/01-implementer.json
- scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/02-refactorer.json
- scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/03-test-writer.json
- scenarios/fixtures/feat-small-agent-e2e/mock-claude-responses/04-summary-writer.json
- scenarios/fixtures/feat-small-agent-e2e/seed-repo/feature.md
- scenarios/fixtures/feat-small-agent-e2e/seed-repo/package.json
- scenarios/fixtures/feat-small-agent-e2e/seed-repo/src/math.ts

---
## feat(munchkins): meta-skills overhaul — config, discovery, templates, kind, cmux verbosity (4a9d737)
**2026-05-21 17:27 PDT · feat-small · 1395.0s · $17.3850**

**Goal:** Implement the framework + repo changes that back the rewritten `munchkins:init`, `munchkins:new-munchkin`, and `munchkins:launch-munchkin` skills — config reader, auto-discovery, templates, kind flag, cmux verbosity auto-injection, and per-agent spec templates.

**Outcome:** Added `MunchkinsConfig` read/write at `.munchkins/config.json`, a `discoverAgents()` glob helper that replaces hand-maintained side-effect imports, a `templates/` directory with archetype scaffolds + spec templates + a `fillTemplate()` slot helper, an `AgentBuilder.kind()` flag (`launchable` | `cron-only`) plus a `list-launchable` CLI command, cmux `--verbose` auto-injection for agent subcommands, spec-template.md files for the three launchable shipped agents, and converted `serrano-munchkins/agentRegistry.ts` to use `discoverAgents`. The director agent is now marked `cron-only`.

**How to test manually:**

1. From the repo root, verify config round-trips:
   ```
   bun test packages/munchkins/src/config/config.test.ts
   ```
   Expect all 5 tests green.

2. Verify auto-discovery globs and dynamic-imports `*-agent.ts` files in sorted order, and that the existing four agents still register through it:
   ```
   bun test packages/munchkins/src/registry/discover.test.ts
   bun run munchkins --help
   ```
   The help output should list `bugfix`, `director`, `feat-small`, `refactor` — same as before the refactor.

3. Verify the new `list-launchable` command omits cron-only agents:
   ```
   bun run munchkins list-launchable
   bun run munchkins list-launchable --json
   ```
   First should print `bugfix`, `feat-small`, `refactor` one per line (NOT `director`). JSON should be `["bugfix","feat-small","refactor"]` (order may vary by registration).

4. Verify cmux verbosity auto-injection by inspecting the built command:
   ```
   bun test packages/munchkins/src/cmux-launcher.test.ts
   ```
   All variants (auto-inject when absent, skip when `--verbose`/`--thinking`/`--dry-run` present, skip for `daemon`/`skills`/`list-launchable`) should pass.

5. Verify templates exist and slot substitution works:
   ```
   bun test packages/munchkins/src/templates/templates.test.ts
   ```
   Then sanity-check a template by hand:
   ```
   bun -e 'import { fillTemplate, specTemplatePath } from "@serranolabs.io/munchkins"; console.log(fillTemplate(specTemplatePath("bug"), { oneLineGoal: "X", problemStatement: "Y" }))'
   ```
   Output should contain `# Bug: X` and `Y`, with unfilled slots like `{{currentBehavior}}` left intact.

6. Verify `.munchkins/config.json` is loadable from the repo root:
   ```
   bun -e 'import { readConfig } from "@serranolabs.io/munchkins"; console.log(readConfig())'
   ```
   Expect the source-repo config object to print.

7. Verify `kind()` flag on the director:
   ```
   bun -e 'import "./packages/serrano-munchkins/agents/director/director-agent.js"; import { registry } from "@serranolabs.io/munchkins"; console.log(registry.get("director")?.getKind())'
   ```
   Expect `cron-only`.

8. Out-of-band check the auto-discovery converted bundle still wires the CLI end-to-end:
   ```
   bun run munchkins refactor --help
   ```
   Should print the refactor agent's help with all options — proves `discoverAgents` actually imported it and `registry.register` fired as a side effect.

**Files changed:**

- .gitignore
- .munchkins/config.json
- AGENTS.md
- docs/pages/internal/plans/meta-skills-overhaul.md
- docs/pages/internal/plans/todo.md
- packages/munchkins/package.json
- packages/munchkins/skills/munchkins-init/SKILL.md
- packages/munchkins/skills/munchkins-launch-munchkin/SKILL.md
- packages/munchkins/skills/munchkins-new-munchkin/SKILL.md
- packages/munchkins/src/builder/agent-builder.ts
- packages/munchkins/src/builder/agent-builder.test.ts
- packages/munchkins/src/builder/index.ts
- packages/munchkins/src/cmux-launcher.ts
- packages/munchkins/src/cmux-launcher.test.ts
- packages/munchkins/src/config/config.ts
- packages/munchkins/src/config/config.test.ts
- packages/munchkins/src/config/index.ts
- packages/munchkins/src/index.ts
- packages/munchkins/src/registry/discover.ts
- packages/munchkins/src/registry/discover.test.ts
- packages/munchkins/src/registry/index.ts
- packages/munchkins/src/registry/list-launchable-command.ts
- packages/munchkins/src/registry/list-launchable-command.test.ts
- packages/munchkins/src/registry/registry.ts
- packages/munchkins/src/registry/registry.test.ts
- packages/munchkins/src/templates/templates.ts
- packages/munchkins/src/templates/templates.test.ts
- packages/munchkins/src/templates/index.ts
- packages/munchkins/templates/agent.ts.single-step
- packages/munchkins/templates/agent.ts.main-refactor
- packages/munchkins/templates/agent.ts.main-refactor-tests
- packages/munchkins/templates/agent.ts.cron-overlay
- packages/munchkins/templates/skill-body.single-step.md
- packages/munchkins/templates/skill-body.main-refactor.md
- packages/munchkins/templates/skill-body.main-refactor-tests.md
- packages/munchkins/templates/spec-template.refactor.md
- packages/munchkins/templates/spec-template.bug.md
- packages/munchkins/templates/spec-template.feature.md
- packages/serrano-munchkins/agentRegistry.ts
- packages/serrano-munchkins/agents/director/director-agent.ts
- packages/serrano-munchkins/agents/director/scripts/inflight-survey.test.ts
- packages/serrano-munchkins/agents/bugfix/spec-template.md
- packages/serrano-munchkins/agents/feat-small/spec-template.md
- packages/serrano-munchkins/agents/refactor/spec-template.md

---
## feat(packages): split framework from dogfood agents into serrano-munchkins (85e1405)
**2026-05-20 20:38 PDT · feat-small · 512.9s · $4.4392**

**Goal:** Collapse the framework/defaults two-package split into a single published framework (`@serranolabs.io/munchkins`) and move the four dogfood agents + their skills into a new private workspace (`@serranolabs.io/serrano-munchkins`). Replace `bun run munchkins skills install` with a `bunx munchkins-init` bootstrap that scaffolds a consumer's `agentRegistry.ts`, wires the `"munchkins"` script, and installs bundled skills.

**Outcome:** Deleted `packages/munchkins-core/` and merged its source under `packages/munchkins/src/`. Extracted `runCli` from the `import.meta.main` block so consumer registries can call it directly. Added `packages/munchkins/src/init/{bin.ts,agentRegistry.template.ts}` (registered as the `munchkins-init` bin) and moved the old `skills-install.ts` under `src/init/install-skills.ts`. Created `packages/serrano-munchkins/` (private) owning `agentRegistry.ts`, the four agents (`bugfix`, `director`, `feat-small`, `refactor`), their `_shared/presets.ts`, and the four `munchkins-<slug>` skill bodies. Rewrote every `@serranolabs.io/munchkins-core` import in scenarios, agents, presets, root `package.json`, README, and plan docs. Added `scenarios/consumer-bootstrap-e2e.ts` (runs `bun pm pack` → `bun add -D <tarball>` → `bunx munchkins-init` → asserts scaffold, skip-if-exists, stub-agent visibility, and `MUNCHKINS_CHANGELOG_PATH` honored on direct `bun run ./agentRegistry.ts`). Added `scripts/onboarding-smoke.ts` (TypeScript) for the contributor clean-clone path. Rewrote `docs/pages/internal/plans/todo.md` §5 and the README "Onboarding" section.

**How to test manually:**

1. Run the full gate from the worktree root:
   ```
   bun install
   bun run typecheck && bun run lint && bun test && bun run scenario
   ```
   All four must exit 0. `bun run scenario` now includes `consumer-bootstrap-e2e.ts` as its 7th step — that's the most load-bearing new test.

2. Confirm the directory restructure:
   ```
   test ! -d packages/munchkins-core && echo OK
   test -d packages/serrano-munchkins && test -f packages/serrano-munchkins/agentRegistry.ts && echo OK
   test -f packages/munchkins/src/init/bin.ts && test -f packages/munchkins/src/init/agentRegistry.template.ts && echo OK
   ```

3. Confirm zero residual references to the old package name (excluding plan/changelog history files, which intentionally still mention the rename):
   ```
   rg "@serranolabs.io/munchkins-core" --type ts --type json
   ```
   Expect zero matches in `.ts`/`.json` (markdown history under `docs/pages/internal/` and `docs/pages/changelog.md` will still contain old references — that's expected since they're durable design records).

4. Confirm the dogfood CLI surface is intact:
   ```
   bun run munchkins --help
   ```
   The output must list `bug-fix`, `feat-small`, `refactor`, `director` (the four dogfood agents) plus `resume`, `status`, `daemon` (framework commands). It must NOT list `skills` (removed) or any agent twice.

5. Smoke the consumer bootstrap by hand (the scenario covers this, but this is the out-of-band check):
   ```
   cd $(mktemp -d) && git init -q && echo '{"name":"smoke","private":true,"type":"module"}' > package.json
   bun pm pack --destination . --cwd <worktree>/packages/munchkins
   bun add -D ./serranolabs.io-munchkins-*.tgz
   bun ./node_modules/@serranolabs.io/munchkins/src/init/bin.ts
   ```
   Verify: `agentRegistry.ts` exists, `package.json` `scripts.munchkins` is `"bun run ./agentRegistry.ts"`, and `.claude/skills/munchkins-{new-munchkin,launch-munchkin}/SKILL.md` are present. Then `bun run munchkins --help` should list only `resume`, `status`, `daemon` — zero agent commands. Re-run `bun ./node_modules/.../bin.ts` with an edited skill body and confirm the edit survives (skip-if-exists).

6. Run the contributor smoke against a fresh clone:
   ```
   bun run scripts/onboarding-smoke.ts
   ```
   This clones the local repo into a tmpdir, runs `bun install` + typecheck + lint + test, asserts `--help` lists the four dogfood agents, and runs `bug-fix --dry-run` to confirm the command resolves. Add `--with-scenario` to also run the scenario gate inside the clone.

7. Sanity-check the workspace symlink risk called out in the plan:
   ```
   bun install && ls -la node_modules/@serranolabs.io/serrano-munchkins
   ```
   Must show a symlink into `packages/serrano-munchkins`. If this is missing, the dogfood scenarios that `import "@serranolabs.io/serrano-munchkins"` will fail.

**Files changed:**

- `package.json` (root) — `munchkins` script now points at `packages/serrano-munchkins/agentRegistry.ts`; dev-dep renamed.
- `packages/munchkins/package.json` — declares `munchkins` + `munchkins-init` bins, drops `munchkins-core` dep, picks up `commander` + `cron-parser` directly.
- `packages/munchkins/src/index.ts` — re-exports the framework surface, defines `runCli`, no longer side-effect-imports any agents.
- `packages/munchkins/src/init/bin.ts` (new) + `packages/munchkins/src/init/bin.test.ts` (new) + `packages/munchkins/src/init/agentRegistry.template.ts` (new).
- `packages/munchkins/src/init/install-skills.ts` + `install-skills.test.ts` (moved from `packages/munchkins/src/skills-install*`).
- `packages/munchkins/src/{builder,registry,resume,sandbox,scheduler,status}/**`, `packages/munchkins/src/{integrate,run-log,worktree}.ts` and tests (moved from `packages/munchkins-core/src/...`).
- `packages/munchkins/src/cmux-launcher.ts` + test — dropped `skills` from the non-agent subcommand set.
- `packages/munchkins/src/register-skills-command.{ts,test.ts}` (deleted).
- `packages/munchkins-core/` (deleted).
- `packages/serrano-munchkins/package.json` (new), `agentRegistry.ts` (new), `tsconfig.json` (new).
- `packages/serrano-munchkins/agents/{_shared,bugfix,director,feat-small,refactor,bugfix-then-refactor}/**` (moved from `packages/munchkins/agents/...`, imports rewritten).
- `packages/serrano-munchkins/skills/munchkins-{bug-fix,director,feat-small,refactor}/SKILL.md` (moved from `packages/munchkins/skills/...`).
- `.claude/skills/munchkins-{bug-fix,director,feat-small,refactor}` symlinks repointed to `packages/serrano-munchkins/skills/...`.
- `scenarios/consumer-bootstrap-e2e.ts` (new) + `package.json` `scenario` script extended.
- `scenarios/{index,composition,dirty-main-e2e,bugfix-pr-integrate-e2e,director-multi-dispatch-e2e,agent-uncommitted-smoke-e2e,resume-after-claude-exit-e2e}.ts` — import paths + skill source paths rewritten.
- `scripts/onboarding-smoke.ts` (new).
- `scripts/release.ts` — releases only `packages/munchkins/package.json` now.
- `.github/workflows/publish.yml` — drops the `munchkins-core` version check + workspace dep rewrite + `munchkins-core` publish step.
- `bun.lock` — workspace topology updated.
- `README.md` — Onboarding section rewritten around `bunx munchkins-init`; default-agents table removed.
- `AGENTS.md` — Where-things-live table + workspace prose updated for the split.
- `docs/pages/internal/plans/todo.md` §5 — rewritten to acceptance criteria from the plan.
- `docs/pages/internal/{plans/framework-consumer-split,plans/director-and-performance,plans/todo,diagnosis,prd,plan,scenario-testing-strategy,technology-decisions,hitl/*,add-skill/*}.md` — durable design refs updated.
- `packages/munchkins/skills/munchkins-new-munchkin/SKILL.md` — source-repo vs consumer-repo detection rewritten for the new layout.
- `docs/pages/agents/custom.md`, `docs/pages/changelog.md` — import-path examples updated.

---
## refactor(builder): extract isDryRunRequested helper (14a89e2)
**2026-05-20 18:05 PDT · feat-small · 484.0s · $2.7167**

**Goal:** Framework / consumer split + onboarding test design — pre-ship restructure that moves the 4 default agents out of the published package, deletes `munchkins-core`, adds a `munchkins-init` bootstrap bin, and adds consumer + contributor onboarding scenarios.

**Outcome:** This step is a small DRY cleanup inside `packages/munchkins-core/src/builder/agent-builder.ts`: the three inline `process.env.__MUNCHKINS_OPT_dryRun === "true"` checks at the dry-run guard points in `run()`, the post-steps integration gate, and the per-step Claude skip are replaced with a single private `isDryRunRequested()` helper. Behavior is unchanged. None of the larger slices in the plan (workspace split, `munchkins-init`, scenario scaffolding) have landed yet — this just consolidates the env-var read so subsequent slices have one call site to repoint if the dry-run signal moves.

**How to test manually:**

1. From the repo root, run the existing scenario harness to confirm dry-run still short-circuits the agent steps as before:
   - `bun run scenario`
   - Expect: green. The harness exercises dry-run paths through the builder; any regression in the three rewritten branches would surface as a scenario failure or as agent steps unexpectedly calling the mocked `spawnClaude`.
2. Spot-check the dry-run guard end-to-end by invoking a dogfood agent with `--dry-run`:
   - `bun run munchkins bug-fix --dry-run --user-message="noop"`
   - Expect: the agent prints its describe block and exits with `succeeded: true`; no worktree is created, no commits land, no summary writer runs.
3. Confirm the helper is the only reader of the env var inside `agent-builder.ts`:
   - `rg "__MUNCHKINS_OPT_dryRun" packages/munchkins-core/src/builder/agent-builder.ts`
   - Expect: exactly one match, inside the `isDryRunRequested` function body. Other matches elsewhere in the repo (CLI flag plumbing, tests) are fine and out of scope for this change.
4. Edge case — verify the inner per-step dry-run branch still records an empty-usage Claude call in the run log rather than actually spawning Claude. Easiest path: re-run step 2 and inspect the most recent run-log directory under `.munchkins/runs/`; the per-step `claude.json` (or equivalent run-log entry) should show zero input/output tokens and an empty response.

**Files changed:**

- packages/munchkins-core/src/builder/agent-builder.ts


---
## feat(scenarios): cover bug-fix flow end-to-end for todo #1 (6af7dfe)
**2026-05-20 17:26 PDT · feat-small · 173.9s · $8.9340**

**Goal:** Extend scenario coverage so each acceptance bullet in `docs/pages/internal/plans/todo.md` entry #1 ("Validate the bug-fix flow end-to-end") is exercised against the `bug-fix` agent end-to-end, and flip the four checkboxes.

**Outcome:** Added a new `scenarios/bugfix-pr-integrate-e2e.ts` that drives `bug-fix` with `__MUNCHKINS_OPT_integrate=pr` against a bare-repo `origin` and a captured-invocation `gh` shim, and tightened three existing scenarios with the missing post-conditions: a `docs(changelog):` HEAD-of-main assertion in `scenarios/index.ts`, a snapshot-author=`munchkins` assertion in `scenarios/dirty-main-e2e.ts`, and a `munchkins resume --list` CLI subprocess assertion in `scenarios/resume-after-claude-exit-e2e.ts`. Registered the new scenario in `package.json`'s `scenario` script and checked all four boxes in `todo.md` entry #1. Zero real `claude` and zero real `gh` invocations.

**How to test manually:**

1. From the repo root, run the existing scenarios one at a time to confirm the new in-place assertions hold:
   - `bun run scenarios/index.ts` — expect `result: pass`; if you grep the artifact JSON you should not see `expected HEAD of main to be a docs(changelog) commit`.
   - `bun run scenarios/dirty-main-e2e.ts` — expect `result: pass`; the new author check fails loudly if a snapshot author is not `munchkins`.
   - `bun run scenarios/resume-after-claude-exit-e2e.ts` — expect `result: pass`; the new CLI block actually spawns `bun packages/munchkins/src/index.ts resume --list` and asserts the runId is in stdout.
2. Run the new PR scenario in isolation: `bun run scenarios/bugfix-pr-integrate-e2e.ts`. Expect `result: pass`. To inspect what the fake `gh` saw, re-run with `--preserve` and then `cat .scenario-artifacts/bugfix-pr-integrate-e2e-*/gh.log` — you should see exactly one line whose `argv` begins `["pr","create"]` and whose `flags` includes `base: "main"`, a non-empty `title`, and a `body` containing `**Goal:**`.
3. Force-fail the new assertion to convince yourself it isn't vacuous: temporarily change `**Goal:**` to `**Nope:**` in `scenarios/bugfix-pr-integrate-e2e.ts`, rerun the scenario, and confirm it fails with the body-marker message. Revert.
4. Run the full pipeline: `bun run scenario`. Expect all seven scenarios to pass top-to-bottom. Also run `bun run lint` and `bun run typecheck` and expect clean exits.
5. Edge check — fresh-clone executability of the shim: `chmod -x scenarios/lib/fake-gh-bin/gh && bun run scenarios/bugfix-pr-integrate-e2e.ts`. The scenario re-applies `0o755` at startup, so it should still pass; this proves the +x preservation step in the scenario isn't ornamental.
6. Open `docs/pages/internal/plans/todo.md` and confirm all four bullets under section `## 1. Validate the bug-fix flow end-to-end` are `- [x]`, and the three other todo entries remain `- [ ]`.

**Files changed:**

- docs/pages/internal/plans/todo.md
- package.json
- scenarios/bugfix-pr-integrate-e2e.ts
- scenarios/dirty-main-e2e.ts
- scenarios/index.ts
- scenarios/lib/fake-gh-bin/gh
- scenarios/resume-after-claude-exit-e2e.ts

---
## feat(integrate): tolerate dirty repoRoot on ff-merge via snapshot commit (7fa9c95)
**2026-05-19 15:40 PDT · feat-small · 1640.6s · $12.4510**

**Goal:** Make the agent's isolated branch always land on `main` even when the operator's `repoRoot` working tree is dirty, preserving pre-existing dirty work as a recoverable snapshot commit.

**Outcome:** `integrateBranch` now runs a pre-flight check (`snapshotDirtyRepoRoot`) that stages everything (`git add -A`) and commits it on `main` as `munchkins: pre-merge snapshot of dirty repoRoot @ <unix-ms>` under a forced `munchkins <munchkins@local>` identity when the working tree is non-empty. The rebase invocation in `rebaseAndResolve` now uses `git rebase -X theirs main`, so the agent's commits win every content conflict against the snapshot, then the existing ff-merge path succeeds unchanged. A parameterized scenario harness at `scenarios/dirty-main-e2e.ts` exercises five dirty-tree variants end-to-end, and `integrate.test.ts` pins the same matrix at the unit level.

**How to test manually:**

1. From the repo root, run `bun run scenario` and confirm `dirty-main-e2e` is in the script output and exits 0. The harness covers D1–D5 in-process; expect a single `pass` line for `dirty-main-e2e`.
2. Run only the unit matrix: `bun test packages/munchkins-core/src/integrate.test.ts`. Look for the `integrateBranch dirty-repoRoot matrix` describe block — D1 through D5 should all pass, plus the existing single/two-file conflict tests now resolving without a fixer.
3. Real-agent smoke test of the clean-tree regression path: in a clean checkout of this repo, run `bun run munchkins bug-fix --userMessage="trivial: append a blank line to docs/pages/index.mdx"` and confirm the agent merges to `main` with no snapshot commit. Verify with `git log --grep="munchkins: pre-merge snapshot" main` — should return empty.
4. Real-agent smoke test of the dirty-tree path with no overlap: from a clean main, run `echo 'dirty' >> README.md` (do NOT stage), then `bun run munchkins bug-fix --userMessage="trivial: add a comment to docs/pages/index.mdx"`. Expect agent success, then `git log --grep="munchkins: pre-merge snapshot" main` returns one commit. Recover the dirty README via `git show <sha>:README.md` and confirm it ends with the `dirty` line.
5. Real-agent smoke test of the overlap path: from a clean main, stage a conflicting edit to a file you know the agent will touch (e.g. `echo 'export const x = 99' > some-file.ts && git add some-file.ts`) then run the same agent. Expect agent success; `cat some-file.ts` shows the agent's version (not `99`); `git show <snapshot-sha>:some-file.ts` shows `export const x = 99`.
6. Run `git log --author=munchkins main` after step 4 or 5 — the snapshot commit should appear with author `munchkins <munchkins@local>`, confirming it is filterable and doesn't impersonate the operator.

**Files changed:**

- AGENTS.md
- docs/pages/internal/scenario-testing-strategy.md
- package.json
- packages/munchkins-core/src/integrate.ts
- packages/munchkins-core/src/integrate.test.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- scenarios/dirty-main-e2e.ts

---
## feat(core): preserve worktree on agent failure for resume (0c1d9cc)
**2026-05-14 18:11 PDT · feat-small · 1231.9s · $12.2061**

**Goal:** When a Claude subprocess exits non-zero mid-run, preserve the worktree on disk and surface the run via `munchkins resume --list` so the operator can recover with `bun run munchkins resume <runId>`.

**Outcome:** Replaced the `failed` phase with `interrupted` in `RunPhase`, gated sandbox teardown so it only runs on success, and persisted `phase: "interrupted"` eagerly at every spawnClaude-bearing failure site. `listResumableRuns` no longer filters `failed` (forward-compat for legacy state files) and now surfaces interrupted runs. A new end-to-end scenario `resume-after-claude-exit-e2e` drives the bug-fix agent through a phase-1 in-process failure at step 2, then resumes via a fake-claude shim subprocess and asserts all 17 acceptance invariants.

**How to test manually:**

1. From the repo root, run the new scenario in isolation:
   ```
   bun run scenarios/resume-after-claude-exit-e2e.ts
   ```
   Expect `result: pass` and exit code 0. The harness internally exercises phase 1 (in-process mock fails at step 2 with the "usage cap" fixture) and phase 2 (subprocess `bun .../munchkins resume <runId>` driven by the fake-claude shim on PATH).
2. Run the full scenario gate to confirm the existing scenarios still pass alongside the new one:
   ```
   bun run scenario
   ```
   Expect all three scenarios (`scenarios/index.ts`, `scenarios/composition.ts`, `scenarios/resume-after-claude-exit-e2e.ts`) to pass.
3. Run the unit suite to confirm `run-state` filter changes and forward-compat are covered:
   ```
   bun test packages/munchkins-core/src/resume/run-state.test.ts
   ```
   Expect green; the new cases assert `interrupted` is included, `done` is excluded, and legacy `failed` state files are surfaced rather than purged.
4. Out-of-band manual check (failure-preservation invariant): preserve a failing run's artifacts and inspect them by hand:
   ```
   bun run scenarios/resume-after-claude-exit-e2e.ts --preserve
   ls .scenario-artifacts/resume-after-claude-exit-e2e-*/
   cat .scenario-artifacts/resume-after-claude-exit-e2e-*/*/state.json
   ```
   On a pass run, you'll see `result.json` in the artifact dir; on a failure run, inspect `state.json` to confirm `phase: "interrupted"`, `failureReason` set, and the step statuses (`completed`, `in-progress`). This also confirms the audit guard (no real `claude` spawns were attempted — the harness records `claudeAttempts` and fails if any are seen).
5. Edge case — legacy state file forward-compat: write a state.json containing `"phase": "failed"` into a fresh run-log dir under `MUNCHKINS_RUN_LOG_DIR`, then run `bun run munchkins resume --list` and confirm the legacy run appears (operators don't lose recovery options across the rename).

**Files changed:**

- package.json
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/resume/run-state.ts
- packages/munchkins-core/src/resume/run-state.test.ts
- scenarios/lib/fake-claude-bin/claude
- scenarios/lib/mock-spawn-claude.ts
- scenarios/fixtures/resume-after-claude-exit-e2e/seed-repo/bug.md
- scenarios/fixtures/resume-after-claude-exit-e2e/seed-repo/package.json
- scenarios/fixtures/resume-after-claude-exit-e2e/seed-repo/src/math.ts
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase1/01-bug-fix-success.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase1/02-refactorer-usage-cap.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase2/01-refactorer-retry.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase2/02-summary-writer.json
- scenarios/fixtures/resume-after-claude-exit-e2e/mock-claude-responses-phase2/03-integration-fixer.json
- scenarios/resume-after-claude-exit-e2e.ts

---

## refactor(registry): self-register daemon/resume/status/skills as commander commands (215a7de)
**2026-05-14 17:17 PDT · refactor · 398.6s · $2.3238**

**Goal:** Stop the hardcoded `if/else` dispatch for `daemon`, `resume`, `status`, and `skills install` in `packages/munchkins/src/index.ts` and let the registry expose every system command in `munchkins --help` alongside the agents.

**Outcome:** Added `AgentRegistry.registerCommand({ name, description, configure })` plus a parallel `commands` map; `cli()` now appends a commander subcommand per registered command without leaking agent-only flags (`--dry-run`, `--thinking`, `--verbose`, `--cli`, `--integrate`) onto them. Each core subsystem ships a dedicated `command.ts` (`packages/munchkins-core/src/{resume,status,scheduler}/command.ts`) that wraps the existing `runResume` / `runStatus` / `runDaemon` in a commander `action`, and the CLI package adds `packages/munchkins/src/register-skills-command.ts` for the `skills install` subcommand (kept in-package because it depends on `PACKAGE_ROOT`). All four are wired at module-load: core's `index.ts` calls the three `register*Command(registry)` helpers as a side effect, so any consumer of `@serranolabs.io/munchkins` gets them for free, and the CLI's `index.ts` calls `registerSkillsCommand(registry)` once at the top before `registry.cli().parseAsync(argv)`. The cmux delegation block and `--no-cmux` argv filter are preserved verbatim.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/index.ts | 79 | 88 | +9 |
| packages/munchkins-core/src/registry/index.ts | 1 | 1 | 0 |
| packages/munchkins-core/src/registry/registry.test.ts | 144 | 210 | +66 |
| packages/munchkins-core/src/registry/registry.ts | 100 | 118 | +18 |
| packages/munchkins-core/src/resume/command.ts | 0 | 22 | +22 |
| packages/munchkins-core/src/scheduler/command.ts | 0 | 14 | +14 |
| packages/munchkins-core/src/status/command.ts | 0 | 16 | +16 |
| packages/munchkins/src/index.ts | 42 | 29 | −13 |
| packages/munchkins/src/register-skills-command.ts | 0 | 19 | +19 |

**Total:** 366 → 517 (Δ +151)

The net line growth reflects four new dedicated command modules + extended test coverage. The extracted abstraction is `AgentRegistry.registerCommand()`: system commands now share one registration mechanism instead of four hand-rolled `if/else` branches in the CLI entrypoint, and the agent flag block stays scoped to `AgentBuilder` subcommands only.

**Files changed:**
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/registry/index.ts
- packages/munchkins-core/src/registry/registry.test.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/resume/command.ts
- packages/munchkins-core/src/scheduler/command.ts
- packages/munchkins-core/src/status/command.ts
- packages/munchkins/src/index.ts
- packages/munchkins/src/register-skills-command.ts

**Recovery note:** The originating refactor agent run (`.munchkins/runs/self-register-system-commands-2c7cdac2`) hit a Claude usage cap immediately after producing the diff — its agent step exited 1 with the rate-limit string as its response, so the deterministic loop skipped the summary writer phase even though the integration commit had already landed via tool-call. This entry was hand-written from the diff to close out the run.

---

## feat(munchkins): launch agent runs inside cmux workspace when available (86ddc5a)
**2026-05-10 19:35 PDT · feat-small · 604.6s · $4.0926**

**Goal:** When `cmux` is on PATH, `bun run munchkins <agent> ...` should re-launch the same invocation inside a fresh `cmux new-workspace` and exit immediately; otherwise behavior is unchanged.

**Outcome:** Added `packages/munchkins/src/cmux-launcher.ts` exporting two pure helpers (`shouldDelegateToCmux`, `buildCmuxCommand`) plus a Bun-test suite covering delegation gating and POSIX-safe command construction. Wired the pre-check into `packages/munchkins/src/index.ts` ahead of the existing registry dispatch, strips `--no-cmux` from argv before commander sees it, and extended the scenario harness audit guard to also reject real `cmux` invocations.

**How to test manually:**

1. From the repo root run `bun run lint && bun run typecheck && bun test packages/munchkins/src` — all three should pass; the new `cmux-launcher.test.ts` suite must be green.
2. Run `bun run scenario` — should pass; the audit guard now also bans `cmux` invocations, but no scenario invokes one so there is no regression.
3. With `cmux` NOT on PATH (verify via `which cmux` → empty), run `bun run munchkins bug-fix --user-message=./scratch/example.md` (create a tiny scratch file first). It should execute inline exactly as before — same stdout, same worktree behavior.
4. With `cmux` installed and the cmux app running, run the same `bun run munchkins bug-fix --user-message=./scratch/example.md`. Expect a single stdout line of the form `Launching bug-fix in cmux workspace: bug-fix-<timestamp>` and the outer shell to return promptly. Open the cmux app and confirm a new workspace named `bug-fix-<timestamp>` exists with the agent running inside it.
5. Opt-out via env: with cmux installed, run `MUNCHKINS_NO_CMUX=1 bun run munchkins bug-fix --user-message=./scratch/example.md`. It should run inline (no `Launching ...` line, no new workspace).
6. Opt-out via flag: with cmux installed, run `bun run munchkins bug-fix --user-message=./scratch/example.md --no-cmux`. It should run inline, and commander must NOT error on the unknown flag (the flag is stripped before parsing). Also verify `bun run munchkins bug-fix --help` does not list `--no-cmux`.
7. Meta/help paths stay inline with cmux installed — verify each prints normally without opening a workspace: `bun run munchkins --help`, `bun run munchkins`, `bun run munchkins daemon` (cancel with Ctrl-C), `bun run munchkins resume`, `bun run munchkins status`, `bun run munchkins skills install`, `bun run munchkins bug-fix --dry-run`, `bun run munchkins bug-fix --help`.
8. Edge case for shell escaping: with cmux installed, run `bun run munchkins bug-fix --user-message="can't stop"` and confirm the workspace launches successfully (the single quote in the value is POSIX-escaped via `'\''` inside the `--command` payload, covered by `cmux-launcher.test.ts` as well).

**Files changed:**

- packages/munchkins/package.json
- packages/munchkins/src/cmux-launcher.ts
- packages/munchkins/src/cmux-launcher.test.ts
- packages/munchkins/src/index.ts
- scenarios/lib/mock-spawn-claude.ts

---
## feat(munchkins-core): add Prompt.withSkill() helper (07441da)
**2026-05-10 19:34 PDT · feat-small · 385.0s · $2.3356**

**Goal:** Add a `Prompt.withSkill(name)` helper that reads `<repoRoot>/.claude/skills/<name>/SKILL.md`, strips YAML frontmatter, and contributes the body to the system prompt — same slot as `withSystem(path)`.

**Outcome:** Refactored `Prompt`'s internal `systemPaths: string[]` into a tagged `systemSources` array supporting both `path` and `skill` source kinds. `withSystem(path)` semantics are unchanged; the new `withSkill(name)` queues a skill source that resolves to `.claude/skills/<name>/SKILL.md` at `resolve()` time, with a textual frontmatter strip (including one trailing blank line). Missing-skill and malformed-frontmatter errors carry actionable messages pointing at `bun run munchkins install-skills` and the offending path. Eight test cases in the new `prompt.test.ts` cover stripping, chaining, errors, composition with `withSystem`, and preservation of pre-change `withSystem` behavior.

**How to test manually:**

1. From the repo root, run the new test file directly: `bun test packages/munchkins-core/src/builder/prompt.test.ts` — expect all 8 cases to pass.
2. Run the broader gate: `bun run lint && bun run typecheck && bun run test` — expect green; existing tests must still pass since `withSystem(path)` behavior is preserved.
3. Verify the skill happy path against a real on-disk file. Create a fixture and a one-liner script:
   ```
   mkdir -p /tmp/wskill-demo/.claude/skills/demo
   printf -- '---\nname: demo\ndescription: x\n---\n\n# Demo body\n' > /tmp/wskill-demo/.claude/skills/demo/SKILL.md
   bun -e 'import {Prompt} from "./packages/munchkins-core/src/builder/prompt.ts"; console.log(JSON.stringify(new Prompt().withSkill("demo").resolve("/tmp/wskill-demo")))'
   ```
   Expected: `systemPrompt` equals `"# Demo body\n"` (no frontmatter, no leading blank line).
4. Edge: missing skill. Run the same one-liner but with `withSkill("missing")` — expect a thrown error whose message contains `Skill 'missing' not found` and `install-skills`.
5. Edge: malformed frontmatter. Overwrite the file with `printf -- '---\nname: demo\nno close here' > /tmp/wskill-demo/.claude/skills/demo/SKILL.md` and re-run the one-liner — expect an error containing `malformed frontmatter (no closing '---' delimiter)` and the absolute path to the file.
6. Edge: composition order. Create `/tmp/wskill-demo/a.md` (`AAA`) and `/tmp/wskill-demo/b.md` (`BBB`), then chain `new Prompt().withSystem("/tmp/wskill-demo/a.md").withSkill("demo").withSystem("/tmp/wskill-demo/b.md").resolve("/tmp/wskill-demo")` — expect `systemPrompt` to be `AAA\n\n# Demo body\n\n\nBBB` (sources joined with `\n\n` in call order).
7. Sanity: confirm existing agents still work without changes — `bun run scenario` should pass, exercising `withSystem(path)` callers in `bugfix-agent.ts`, `refactor-agent.ts`, `feat-small-agent.ts`, and `bugfix-then-refactor-agent.ts`.

**Files changed:**

- packages/munchkins-core/src/builder/prompt.ts
- packages/munchkins-core/src/builder/prompt.test.ts

---
## feat(munchkins): add SKILL.md discovery surface for default agents (bd12fe3)
**2026-05-10 19:20 PDT · feat-small · 265.9s · $2.0450**

**Goal:** Add Claude Code `SKILL.md` files for the three default munchkins agents (`bug-fix`, `refactor`, `feat-small`) and symlink them into `.claude/skills/` so Claude Code discovers them as `/<name>`.

**Outcome:** Created three new `SKILL.md` files under `packages/munchkins/skills/<name>/` with YAML frontmatter (`name`, `description`) followed by the body copied byte-for-byte from each agent's source prompt md. Added three relative symlinks under `.claude/skills/` pointing at the corresponding skill directories. No agent `.ts` files were modified — content is duplicated with `agents/<name>/prompts/<name>.md` for this MVP; the later migration will collapse the duplication.

**How to test manually:**

1. From the repo root, confirm the three new SKILL.md files exist:
   ```sh
   ls packages/munchkins/skills/bug-fix/SKILL.md packages/munchkins/skills/refactor/SKILL.md packages/munchkins/skills/feat-small/SKILL.md
   ```
   Expected: all three paths print with no error.
2. Verify the frontmatter is well-formed and only contains `name` and `description`:
   ```sh
   head -5 packages/munchkins/skills/bug-fix/SKILL.md
   head -5 packages/munchkins/skills/refactor/SKILL.md
   head -5 packages/munchkins/skills/feat-small/SKILL.md
   ```
   Expected: each starts with `---`, has `name: <slug>` matching the directory, `description: ...` (one sentence), and closes with `---`.
3. Verify the body of each SKILL.md is byte-identical to the source prompt md (skipping the 4-line frontmatter + blank line):
   ```sh
   diff <(tail -n +6 packages/munchkins/skills/bug-fix/SKILL.md) packages/munchkins/agents/bugfix/prompts/bug-fix.md
   diff <(tail -n +6 packages/munchkins/skills/refactor/SKILL.md) packages/munchkins/agents/refactor/prompts/refactor.md
   diff <(tail -n +6 packages/munchkins/skills/feat-small/SKILL.md) packages/munchkins/agents/feat-small/prompts/feat-small.md
   ```
   Expected: all three diffs produce no output.
4. Verify each symlink resolves to the expected relative target:
   ```sh
   readlink .claude/skills/bug-fix
   readlink .claude/skills/refactor
   readlink .claude/skills/feat-small
   ```
   Expected: each prints `../../packages/munchkins/skills/<name>`.
5. Verify the existing agents still register and run:
   ```sh
   bun run munchkins --help
   ```
   Expected: usage lists `bug-fix`, `refactor`, and `feat-small` subcommands (no regression).
6. Verify the source prompt files were not modified by the change:
   ```sh
   git diff HEAD~1 -- packages/munchkins/agents/bugfix/prompts/bug-fix.md packages/munchkins/agents/refactor/prompts/refactor.md packages/munchkins/agents/feat-small/prompts/feat-small.md
   ```
   Expected: no output (files unchanged in this commit).
7. Out-of-band Claude Code discovery check: open this repo in Claude Code and confirm that typing `/bug-fix`, `/refactor`, and `/feat-small` each surface the new skills with their full descriptions (matches the strings in `packages/munchkins/skills/<name>/SKILL.md`).

**Files changed:**

- packages/munchkins/skills/bug-fix/SKILL.md
- packages/munchkins/skills/refactor/SKILL.md
- packages/munchkins/skills/feat-small/SKILL.md
- .claude/skills/bug-fix (symlink)
- .claude/skills/refactor (symlink)
- .claude/skills/feat-small (symlink)

---
## feat(docs): re-orient onboarding around the new-munchkin skill (deb5605)
**2026-05-10 14:10 PDT · feat-small · 458.8s · $3.2744**

**Goal:** Re-orient the docs onboarding so the `new-munchkin` skill is the destination, with the bug-fix run demoted to a proof-of-life smoke test.

**Outcome:** Restructured `docs/pages/getting-started.md` into six sections (Prerequisites, Install, Proof of life, Scaffold your first agent, Next steps), added a fifth Claude Code prerequisite, surfaced `bun run munchkins skills install`, and compressed the artifact tree and failure recovery to one-liners. Updated `docs/pages/index.mdx` to drop the working-guide line, split the CTA row into Defaults vs. Build-your-own, and rewrite the Get-started gloss. Reordered `docs/pages/agents/custom.md` so the `new-munchkin` skill section leads (now 3 paragraphs covering trigger phrases, repo introspection, and create-mode outputs) and the manual path follows. Reordered `docs/pages/agents/_meta.json` so `custom` is first.

**How to test manually:**

1. From the repo root, run `bun run docs:dev` and open the docs site in a browser.
2. Land on `/` and confirm the lede now reads "The default agents are working examples…"; verify the CTA row shows three lines: `Get started`, `Defaults (reference): …`, and `Build your own: /new-munchkin skill · AgentBuilder API`. The headline and proof-tail should be unchanged.
3. Click `Get started`. Confirm the page has six top-level `##` headings in this exact order: Prerequisites, Install, Proof of life: run the bug-fix agent, Scaffold your first agent for this repo, Next steps. (Plus the `# Getting started` title.) The old "Where the artifacts go" tree and "If it fails" subsection should be gone.
4. In Prerequisites, confirm there are five items and the fifth names Claude Code as optional.
5. In Install, confirm `"munchkins": "munchkins"` is the only script line shown, the `bunx` alternative is mentioned in one sentence, and `bun run munchkins skills install` appears exactly once.
6. In the new "Scaffold your first agent" section, confirm `/new-munchkin` (with the slash) is shown in a fenced block and the three create-mode bullets are present.
7. Click into Agents from the sidebar. Confirm the order is `Build your own`, `Bug fix`, `Small feature`, `Refactor`.
8. Open `Build your own`. Confirm the first `##` after the title is "Scaffold with the `new-munchkin` skill" and contains 3 paragraphs; the second `##` is "What you're building" and starts with the bridging sentence about the manual path.
9. Edge case: grep the rendered docs for the deleted line `This site is a working guide to the framework` — it should return zero hits. Also grep `getting-started.md` to confirm `/new-munchkin` appears at least once and `bun run munchkins skills install` appears exactly once.
10. Run `bun run munchkins skills install --dest /tmp/munchkins-skills-test` and confirm the bundled skills land at the override path — this validates that the new Install step works as documented.

**Files changed:**

- docs/pages/getting-started.md
- docs/pages/index.mdx
- docs/pages/agents/custom.md
- docs/pages/agents/_meta.json

---
## docs(pages): add user-facing agent guide organized by agent (a01c8fb)
**2026-05-10 13:31 PDT · feat-small · 445.7s · $7.0202**

**Goal:** Replace the thin Rspress site with a full user-facing guide where each default agent has its own self-contained page, plus getting-started and custom-agent pages.

**Outcome:** Added `getting-started.md`, `agents/{bug-fix,feat-small,refactor,custom}.md`, and `agents/_meta.json`; rewrote `index.mdx` as a real landing page; updated root `_meta.json` to surface the new sections. The three default-agent pages each follow the 14-section skeleton (substantive content, intentional repetition for self-containment); `custom.md` covers every public method on `AgentBuilder` and `Prompt`. Also bumped two `agent-builder.test.ts` integration tests to a 30s timeout so the real-git E2E cases don't graze the default 5s limit under parallel load.

**How to test manually:**

1. From the repo root, run `PUBLIC_DOCS=true bun run docs:build` and confirm it exits 0. Verify the four agent pages and `getting-started` are emitted under `docs/doc_build/` (or wherever Rspress writes output) and that `internal/**` is excluded.
2. Run `bun --cwd docs run dev` and open the site in a browser. Confirm the sidebar order: `Home`, `Getting started`, `Agents` (expandable to `Bug fix`, `Small feature`, `Refactor`, `Build your own`), `Changelog`. The `Internal` section should still render in dev mode.
3. From the home page, click **Get started** — expect to land on `/getting-started`. Click **Bug fix** — expect `/agents/bug-fix`. Each default-agent page should scroll through all 14 sections in order (What it does → Worked example).
4. On `/agents/bug-fix`, ctrl-F for `--user-message`, `--cli`, `--integrate`, `--dry-run`, `--thinking`, `--verbose` — all six must appear in the Flags table. Repeat on `feat-small.md` and `refactor.md`.
5. On `/agents/custom`, ctrl-F for each `AgentBuilder` method (`option`, `add`, `addDeterministic`, `summaryWriter`, `integrate`, `setSandbox`, `rename`, `describe`, `thenRun`, `cron`, `run`, `runFromState`) and each `Prompt` method (`withSystem`, `withUserMessage`, `withUserMessageFromOption`). All must be present. Confirm `launch-munchkin` and `new-munchkin` are both referenced.
6. Search across all four new pages for `MUNCHKINS_CLI`, `MUNCHKINS_RUN_LOG_DIR`, and `MUNCHKINS_CHANGELOG_PATH` — each env var should appear at least once across the set.
7. Confirm `bun run munchkins resume --list | --latest | <id>` syntax appears in each of the three default-agent pages, and `bun run munchkins daemon` + `.cron()` appear in all three default-agent pages and in `custom.md`. `bun run munchkins skills install [--dest <path>]` should appear in `custom.md`.
8. Run `bun run lint`, `bun run typecheck`, and `bun run scenario` from the repo root — all should pass. (The deterministic gate in CI does this automatically.)
9. Edge case: open `docs/pages/changelog.md` and `docs/pages/internal/**` in git — confirm they are unchanged by this commit (`git diff HEAD~1 -- docs/pages/changelog.md docs/pages/internal/`).
10. Edge case: run `bun test packages/munchkins-core/src/builder/agent-builder.test.ts` and confirm the two integration tests in `AgentBuilder.run integration dispatch end-to-end` pass without timeout warnings.

**Files changed:**

- docs/pages/_meta.json
- docs/pages/index.mdx
- docs/pages/getting-started.md
- docs/pages/agents/_meta.json
- docs/pages/agents/bug-fix.md
- docs/pages/agents/feat-small.md
- docs/pages/agents/refactor.md
- docs/pages/agents/custom.md

---

## fix(munchkins): make package bunx-executable via bin entry (b630027)
**2026-05-10 13:29 PDT · bug-fix · 377.0s · $3.1778**

**Goal:** Fix `bunx @serranolabs.io/munchkins skills install` failing with "could not determine executable to run for package" because the package declared no `bin` field.

**Outcome:** Added a `bin` entry mapping `munchkins` to `./src/index.ts` in `packages/munchkins/package.json`, bumped the version from `0.1.1` to `0.1.2`, and prepended a `#!/usr/bin/env bun` shebang to `packages/munchkins/src/index.ts` so the entrypoint is directly runnable. The existing `if (import.meta.main)` dispatch in `src/index.ts` remains the single source of truth — no wrapper file was introduced and no dispatch logic changed. Also extended the timeout on two integration-dispatch end-to-end tests in `agent-builder.test.ts` to 30s to accommodate the ~10 git subprocess invocations per run on slower/concurrent CI environments. Publishing was intentionally not performed; the user can run that as a separate manual step. Consider a follow-up to document `bunx @serranolabs.io/munchkins …` usage in the README.

**Files changed:**
- packages/munchkins/package.json
- packages/munchkins/src/index.ts
- packages/munchkins-core/src/builder/agent-builder.test.ts

---

## feat(agent-cli): wait for Claude rate-limit reset and retry once (c7e4fa8)
**2026-05-10 13:00 PDT · feat-small · 742.8s · $4.0512**

**Goal:** When the Claude CLI exits because the user's usage limit was hit, sleep until the reported reset time and retry the spawn exactly once instead of failing the whole pipeline.

**Outcome:** Switched the base `AgentCLI.runJsonStream` from `stderr: "inherit"` to `stderr: "pipe"` while forwarding bytes to `process.stderr` in real time, and added captured stderr to `SpawnResult`. Introduced file-local `isLimitHit`, `parseResetTimestamp`, and `sleepUntil` helpers in `agent-cli.ts`. `ClaudeCLI.spawn()` now inspects the result, sleeps until the parsed reset (unix-seconds or HH:MM, today/tomorrow), logs a single `⏳ Claude limit hit, waiting until <HH:MM:SS local>` line to stderr, and retries the same spawn exactly once. `CodexCLI.spawn` is untouched.

**How to test manually:**

1. From the repo root, run the new unit tests to exercise all branches (unix-seconds retry, HH:MM, parse failure, abort mid-wait, double-limit no-third-spawn, stderr-only detection, out-of-range HH:MM):
   ```
   bun test packages/munchkins-core/src/builder/agent-cli.test.ts
   ```
   Expect every test in the `ClaudeCLI rate-limit retry` describe block to pass in well under a second.
2. Verify the repo-wide gates the deterministic loop runs:
   ```
   bun run typecheck
   bun run lint
   bun run scenario
   ```
   All three should be green.
3. Out-of-band manual check that the unit tests don't cover — confirm stderr is still forwarded live (the change from `inherit` to `pipe` is the riskiest part). In a throwaway script, drive a Claude spawn that prints to stderr and watch it appear in your terminal in real time:
   ```
   bun -e "import { ClaudeCLI } from './packages/munchkins-core/src/builder/agent-cli.ts'; await new ClaudeCLI().spawn({ systemPrompt: '', userPrompt: 'say hi then exit', cwd: process.cwd() });"
   ```
   You should see Claude's stderr stream appear as it's produced (not buffered until exit). If you have a real rate-limited account handy, trigger a limit and confirm you see the single `⏳ Claude limit hit, waiting until …` line followed by exactly one retry after the reset.
4. Edge case — abort during wait. In a REPL, kick off a spawn with a fake limit message in stderr that points ~60s into the future via a stub of `runJsonStream`, then abort the controller after 50ms; `spawn()` should reject promptly with the abort reason and not fire a second spawn. (This is exactly what the `aborted abortSignal during the wait` test asserts; rerun that single test in watch mode if you want to poke at it: `bun test packages/munchkins-core/src/builder/agent-cli.test.ts -t "aborted abortSignal"`.)

**Files changed:**

- packages/munchkins-core/src/builder/agent-cli.ts
- packages/munchkins-core/src/builder/agent-cli.test.ts

---
## feat(munchkins-core): add resume subcommand for interrupted runs
**2026-05-09 20:11 PDT · feat-small · 1532.9s · $15.7377**

**Goal:** Add `bun run munchkins resume [runId]` so an interrupted run (rate limit, Ctrl-C, OOM) can pick up from the last completed step, including resuming the underlying Claude/Codex session.

**Outcome:** Each run now writes an incremental `state.json` to its `.munchkins/runs/<slug>-<uuid>/` directory tracking phase, per-step status, and captured CLI session ids. `SandboxFactory` was reshaped into an object with `create()` + `rehydrate()`; `gitWorktreeSandbox` implements `rehydrate()` against an existing worktree with hard-fail preconditions for missing worktree/branch and a logged warning for dirty/advanced state. `AgentBuilder` exposes `runFromState()` (called by both fresh runs and the new resume orchestrator); `ClaudeCLI`/`CodexCLI` capture `session_id` from their JSONL streams and emit `--resume <id>` (Claude) or `codex resume <id> exec` (Codex) with a continue message when given a `resumeSessionId`. A new `runResume(argv)` orchestrator wired into `packages/munchkins/src/index.ts` handles `--list`, `--latest`, full runId, and unique-slug resolution; `RunLog.resume(dir)` replays `events.jsonl` so token/cost totals survive across the resume boundary.

**How to test manually:**

1. From the repo root, build/install once: `bun install`.
2. Confirm the new subcommand surfaces with no resumable runs: `bun run munchkins resume --list` — should print `no resumable runs` and exit 0. Same with no args: `bun run munchkins resume`.
3. Kick off a real bug-fix run against a throwaway change so it produces a `state.json`: `bun run munchkins bug-fix --user-message="add a no-op comment to packages/munchkins-core/src/index.ts"`. Once you see the first agent step actually start (the banner prints `[step 1/N agent]`), interrupt with Ctrl-C.
4. Inspect the preserved run dir: `ls .munchkins/runs/` then `cat .munchkins/runs/<slug>-<uuid>/state.json` — verify `phase` is still `"steps"` (not `"done"` / `"failed"`), step 0 has `status: "in-progress"`, and (if Claude got far enough to emit its init event) `sessionId` is populated.
5. List resumables: `bun run munchkins resume --list` — should print a table row for that run with `runId`, `agent`, `slug`, `started-at`, `phase`, and `completed/total` step counts.
6. Resume by full id: `bun run munchkins resume <slug>-<uuid>`. Confirm in output that the worktree path is reused (no new `agent/...` branch is created), and that step 0 is re-attempted via `claude --resume <id>` (look for the continue message in verbose output by re-running with `--verbose`). When it finishes, `state.json.phase` should be `"done"`.
7. Slug resolution edge case — happy path: with one resumable, run `bun run munchkins resume <slug>` (no uuid). Should resolve and run.
8. Slug resolution edge case — ambiguous: leave two interrupted runs with the same slug, run `bun run munchkins resume <slug>` — should exit 1 and print both full runIds in the error.
9. `--latest`: with multiple resumables, run `bun run munchkins resume --latest` and confirm it picks the most recent by `startedAt`.
10. Rehydrate hard-fail: from another resumable run dir, `rm -rf` the worktree it points at, then `bun run munchkins resume <runId>` — should exit 1 with `Worktree at <path> no longer exists`. Likewise delete its branch (`git branch -D agent/...`) for the deleted-branch failure.
11. Session-not-found fallback: edit a `state.json`'s `steps[0].sessionId` to `"definitely-bogus-id"`, then resume — Claude returns a session-not-found error and the builder should log `[resume] session ... no longer available; restarting step with worktree-state hint.` and re-spawn fresh with a `git status` / `git diff --stat HEAD` preamble baked into the system prompt.
12. Token accounting: after a resumed run completes, open `.munchkins/runs/<slug>-<uuid>/summary.json` and confirm tokens-in/out and cost reflect both the original run's events AND the resumed CLI calls (i.e. greater than what a fresh run alone would have produced).
13. Regression check on the unchanged path: run a fresh `bun run munchkins bug-fix --user-message="..."` to completion and confirm it still works end-to-end with no prompts about resume, no extra args, and produces the same shape of summary as before.
14. Automated tests cover the unit-level behavior — `bun run test packages/munchkins-core/src/resume` and `bun run test packages/munchkins-core/src/sandbox/sandbox.test.ts` — but step 11 above (real session-not-found against the live `claude` CLI) is the one out-of-band check the tests don't perform.

**Files changed:**

- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/agent-builder.test.ts
- packages/munchkins-core/src/builder/agent-cli.ts
- packages/munchkins-core/src/builder/agent-cli.test.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/resume/index.ts
- packages/munchkins-core/src/resume/run-resume.ts
- packages/munchkins-core/src/resume/run-resume.test.ts
- packages/munchkins-core/src/resume/run-state.ts
- packages/munchkins-core/src/resume/run-state.test.ts
- packages/munchkins-core/src/resume/test-fixtures.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/run-log.test.ts
- packages/munchkins-core/src/sandbox/index.ts
- packages/munchkins-core/src/sandbox/sandbox.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- packages/munchkins/src/index.ts

---

## fix(feat-small): swap new-surface section for manual-test recipe
**2026-05-09 19:49 PDT · bug-fix · 261.2s · $1.6490**

**Goal:** Replace the feat-small summary writer's `New surface` catalog with a `How to test manually` section so changelog entries give operators a concrete smoke-test recipe.

**Outcome:** Rewrote `packages/munchkins/agents/feat-small/prompts/summary-writer.md`. Deleted the `What "new surface" means` section and its category bullets, retargeted the framing paragraph at giving operators a manual smoke-test recipe, swapped the template's `New surface` block (and the now-redundant `Lines added` line) for a required `How to test manually` block with guidance on covering happy path plus an edge case and a fallback string for non-runtime features, and kept the `Files changed` block. Output contract, JSON envelope, no-headings-in-body rule, and `feat(<scope>): <subject>` commit format are unchanged. Default and refactor summary writers were not touched.

**Files changed:**
- packages/munchkins/agents/feat-small/prompts/summary-writer.md

---
## fix(builder): tolerate duplicate JSON envelope from summary writer
**2026-05-09 19:17 PDT · bug-fix · 477.2s · $3.4697**

**Goal:** Fix the summary writer JSON parser so it survives the model emitting the envelope twice in one response — a production failure mode (run `agent-composition-integration-df872018`) where the greedy regex spans both objects and `JSON.parse` chokes on the gap.

**Outcome:** Replaced the regex-based extraction in `runSummaryWriter` with a string-aware balanced-brace forward scan extracted into a new `parseSummaryWriterJson` helper. The scan enumerates every top-level `{...}` object in the response, then iterates them last-to-first and returns the first one that parses and has both `commitMessage` and `markdown` as strings. Trailing ` ``` ` fence handling and existing type checks are preserved; backward-compatible for the single-envelope case. Added 12 unit tests covering the duplicate-emit regression, prose preambles, fenced output, braces inside string literals, escaped quotes, missing/wrong-typed fields, and a realistic fixture.

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/parse-summary-writer-json.ts
- packages/munchkins-core/src/builder/parse-summary-writer-json.test.ts

**Notes for future debuggers:** The brace scanner is intentionally string-aware (tracks `inString` + `isEscaped`) so a JSON string value like `"see {a, b, c}"` or `"escaped \"quote\""` doesn't desync the depth counter. If the scanner ever encounters an unbalanced `{`, it stops scanning rather than emitting a partial candidate. Failure reason distinguishes "no JSON object found" from "N candidate object(s) inspected" so harness logs point at the right diagnosis.

---
## feat(core): pluggable integration strategies + agent composition
**2026-05-09 16:00 PDT · feat-small · 1264.1s · $13.0129**

**Goal:** Add pluggable integration strategies (`integrateMerge` / `integratePR`) and `AgentBuilder` composition (`.thenRun()`), wiring operator > author > default precedence and moving integration out of sandbox teardown into the run layer.

**Outcome:** Introduced `IntegrationStrategy` with `integrateMerge` (delegates to existing `integrateBranch`) and `integratePR` (rebase + push + open PR via `gh`/`glab`, with auto provider detection). Added `.integrate()`, `.thenRun()`, `.setSandbox()`, `.rename()`, `.describe()` builder methods; `.thenRun()` returns a new builder with steps concatenated and sandbox/summaryWriter/integration stripped per the S3 contract. Run-layer dispatch enforces precedence and surfaces a clear error for unknown modes; `gitWorktreeSandbox.teardown` is now cleanup-only. Added `--integrate <mode>` CLI flag, an example `bugfix-then-refactor` agent, and a composition scenario.

**Note on this entry:** the run's summary writer emitted the JSON envelope twice and the harness's greedy regex parser failed to parse it, so this entry is hand-authored from the summary writer's first emitted block (verbatim). The agent's actual work — the diff, the tests, and the deterministic checks — completed cleanly before the parser tripped. A follow-up bug-fix to the harness regex will harden the parser against duplicate-emit hiccups.

**New surface:**

- Export: `integrateMerge()` (in `packages/munchkins-core/src/integrate.ts`)
- Export: `integratePR(opts?)` (in `packages/munchkins-core/src/integrate.ts`)
- Export: `detectProvider(repoRoot, remote)` (in `packages/munchkins-core/src/integrate.ts`)
- Export: `IntegrationStrategy`, `IntegrationContext`, `IntegrationResult`, `IntegratePROptions` types (in `packages/munchkins-core/src/integrate.ts`)
- Export: `AgentBuilder.integrate(strategy)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.thenRun(other)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.setSandbox(factory)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.rename(name)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.describe(description)` method (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `RunLog.getAgentSummaryMarkdown()`, `RunLog.getAgentSummaryCommitMessage()` (in `packages/munchkins-core/src/run-log.ts`)
- Example agent: `bugfix-then-refactor` (in `packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts`)
- CLI flag: `--integrate <mode>` on every registered agent (registered in `packages/munchkins-core/src/registry/registry.ts`)
- Env var: `__MUNCHKINS_OPT_integrate`
- New scenario: `scenarios/composition.ts`
- Other: `PassOpts.prUrl` field on `RunLogger.pass()` surfaces the PR URL in quiet and verbose output (in `packages/munchkins-core/src/builder/run-logger.ts`)
- Removed: `IntegrateContext` export and `TeardownContext.integrate` field (sandbox teardown is now cleanup-only)

**Files changed:**

- package.json
- packages/munchkins-core/src/builder/agent-builder.test.ts (new)
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/run-logger.test.ts (new)
- packages/munchkins-core/src/builder/run-logger.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/integrate.test.ts
- packages/munchkins-core/src/integrate.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/run-log.test.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/sandbox/index.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- packages/munchkins-core/src/sandbox/sandbox.ts
- packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts (new)
- scenarios/composition.ts (new)

---

## feat(scheduler): add cron support for AgentBuilder + daemon subcommand
**2026-05-09 15:25 PDT · feat-small · 642.2s · $6.0585**

**Goal:** Add per-agent cron scheduling via a new `.cron()` builder method and a `bun run munchkins daemon` entrypoint that arms timers per cronned builder and fires `builder.run()` at each tick.

**Outcome:** `AgentBuilder` now carries an optional `CronConfig` set via `.cron(spec, { userMessage, verbosity })` and exposed via `getCron()`; calling `.cron()` twice throws naming the agent. A new `scheduler/daemon.ts` module collects cronned builders from a registry, renders a column-aligned startup table with ISO + humanized next-tick offsets via `cron-parser`, and arms one `setTimeout` per builder that resets per-tick env (`__MUNCHKINS_OPT_verbose` / `__MUNCHKINS_OPT_thinking` / `__MUNCHKINS_OPT_userMessage`) before each run, re-arming in `finally`. The `munchkins` entrypoint branches on `process.argv[2] === "daemon"` to invoke `runDaemon()` ahead of `registry.cli()`. No default agent is cronned; the API ships dormant.

**New surface:**

- Export: `AgentBuilder.prototype.cron(spec, opts)` (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: `AgentBuilder.prototype.getCron()` (in `packages/munchkins-core/src/builder/agent-builder.ts`)
- Export: type `Verbosity` (in `packages/munchkins-core/src/builder/agent-builder.ts`, re-exported from `builder/index.ts` and `src/index.ts`)
- Export: interface `CronConfig` (in `packages/munchkins-core/src/builder/agent-builder.ts`, re-exported from `builder/index.ts` and `src/index.ts`)
- Export: `runDaemon(opts?)` (in `packages/munchkins-core/src/scheduler/daemon.ts`, re-exported from `scheduler/index.ts` and `src/index.ts`)
- Export: `applyTickEnv(cfg)` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- Export: `collectCronnedBuilders(registry)` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- Export: interface `CronnedBuilder` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- Export: interface `RunDaemonOptions` (in `packages/munchkins-core/src/scheduler/daemon.ts`)
- CLI flag: `daemon` subcommand on the `munchkins` entrypoint (registered in `packages/munchkins/src/index.ts` as a pre-`registry.cli()` argv branch)
- Env var: `__MUNCHKINS_OPT_userMessage` (set per tick by `applyTickEnv`)
- Env var: `__MUNCHKINS_OPT_verbose` (set per tick when verbosity is `"verbose"`)
- Env var: `__MUNCHKINS_OPT_thinking` (set per tick when verbosity is `"thinking"`)
- New file: `packages/munchkins-core/src/scheduler/daemon.ts`
- New file: `packages/munchkins-core/src/scheduler/index.ts`
- New file: `packages/munchkins-core/src/scheduler/daemon.test.ts`
- New package export path: `@serranolabs.io/munchkins/scheduler` (added in `packages/munchkins-core/package.json`)
- Other: `cron-parser@^5.5.0` added as a dependency of `@serranolabs.io/munchkins`

**Lines added:** +407 (across 8 files)

**Files changed:**
- bun.lock
- packages/munchkins-core/package.json
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/scheduler/daemon.ts
- packages/munchkins-core/src/scheduler/index.ts
- packages/munchkins-core/src/scheduler/daemon.test.ts
- packages/munchkins/src/index.ts

---

## docs(summary-writer): forbid markdown headings in changelog body
**2026-05-09 15:15 PDT · bug-fix · 321.1s · $2.0794**

**Goal:** Stop the default summary-writer prompt from producing `##` headings inside changelog entry bodies, which collide with the harness-emitted entry title and break the document hierarchy.

**Outcome:** Updated the Output contract section of `packages/munchkins/agents/_shared/prompts/summary-writer.md` to explicitly prohibit any Markdown headings (`#`, `##`, `###`, etc.) inside the `markdown` field. Promoted the bold inline labels (`**Goal:**`, `**Outcome:**`, `**Files changed:**`) from a suggested skeleton to a required body shape, and added a side-by-side correct/wrong example so the contrast is visual. The JSON output contract (`commitMessage` + `markdown` keys, no code fences) is unchanged, and the harness-side assembly in `RunLog.prependChangelogIn` was not touched. Per-agent summary-writer prompts under `feat-small` and `refactor` were left alone per the task constraints (they were out of scope unless they shared the defect).

**Files changed:**
- packages/munchkins/agents/_shared/prompts/summary-writer.md

Future changelog entries produced by agents using this default prompt should contain zero `#`-prefixed lines in the body while still carrying the bold inline labels for Goal / Outcome / Files changed.

---
## fix(munchkins-core): detect merge-fixer progress via working-tree content
**2026-05-09 15:04 PDT · bug-fix · 451.4s · $2.6168**

## Goal
Fix the merge-fixer harness in `integrate.ts` so it stops misclassifying every real conflict resolution as "no progress."

## Outcome
Replaced the index-based post-fixer progress check with a content-based check using `git diff --check`. The new logic detects leftover conflict markers in the working tree, bails out if the fixer wrote markers to files outside the conflict set, fails with a no-progress reason only when every conflicted file still has markers, and stages only files verified clean (per-file `git add`, never `git add -A`). Added a small `abortAndFail` helper to deduplicate the bail-out paths in `rebaseAndResolve`. Introduced `packages/munchkins-core/src/integrate.test.ts` with five real-`integrateBranch` tests covering the happy path, no-progress, partial-progress (regression test that proves the outer loop re-prompts the fixer), CLI failure, and the clean-rebase no-spawn case.

## Files changed
- `packages/munchkins-core/src/integrate.ts` — swap index-based stillConflicted check for `filesWithLeftoverMarkers` (new helper using `git diff --check`); add stray-file guard; switch staging to per-file `git add`; extract repeated `abortRebase` + return into a local `abortAndFail` helper.
- `packages/munchkins-core/src/integrate.test.ts` — new file. mkdtemp + `git init -b main` repos, `gitEnv()` helper with `TEST_GIT_IDENTITY`, `StubFixerCLI` with constructor-injected handler and `FailIfSpawnedCLI`, plus shared `setupSingleFileConflict` / `setupTwoFileConflict` setup helpers driving the five required scenarios.

## Notes for future readers
- The partial-progress test (#3) is the load-bearing regression: it asserts `cli.invocations === 2` and `fixerIters === 2`, which is only achievable if the harness correctly recognizes per-file forward progress and re-enters the fixer for the remaining unresolved file.
- `listConflictedFiles` is intentionally retained for the *initial* per-iteration enumeration before the fixer runs; only the post-fixer check moved to a content-based detector.

---
## refactor(agent-builder): extract RunLogger to centralize verbose/quiet formatting
**2026-05-09 14:25 PDT · refactor · 590.3s · $3.3619**

**Goal:** Extract every verbose/quiet branch site in `AgentBuilder.run()` (and its `runAgent` / `runDeterministic` / `runSummaryWriter` helpers) into a single `RunLogger` class so `run()` orchestrates and `RunLogger` formats — byte-identical output in both modes.

**Outcome:** Created `packages/munchkins-core/src/builder/run-logger.ts` housing the new `RunLogger` class plus the `C` color table, `banner()`, and `printInvocation()` helpers (moved out of `agent-builder.ts` so there's a single home for terminal formatting). `AgentBuilder` imports them back, drops the inline `if (verbose) … else …` blocks at all twelve call sites, and threads a single `RunLogger` instance into the helpers in place of the bare `verbose: boolean` parameter. `streamOutput` stays where it was — it's a separate concern (Claude streaming) — and the env reads at the top of `run()` are untouched.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/builder/agent-builder.ts | 642 | 525 | −117 |
| packages/munchkins-core/src/builder/run-logger.ts | 0 | 200 | +200 |
| packages/munchkins-core/src/index.ts | 46 | 46 | 0 |

**Total:** 688 → 771 (Δ +83)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/run-logger.ts
- packages/munchkins-core/src/index.ts

**Call sites that now share the extracted helpers:**
- `RunLogger.stepResultOk()` — called by both `runAgent` and `runSummaryWriter`, replacing the duplicated quiet-mode " ok (Xs, in→out)\n" line that previously existed inline in each.
- `RunLogger.starting()` / `stepBanner()` / `pass()` / `fail()` / `logDir()` / `integrationLine()` — collapse the six verbose-vs-quiet branch pairs in `AgentBuilder.run()` into single calls.
- `RunLogger.summaryWriterEmptyDiff()` / `summaryWriterStart()` — collapse the two branch pairs in `runSummaryWriter`.
- `RunLogger.agentStepStart()` — collapses the single branch pair in `runAgent`.
- `RunLogger.deterministicIterationHeader()` / `deterministicCommand()` / `deterministicCommandOutput()` / `deterministicQuietSummary()` / `fixerStart()` / `fixerResult()` — collapse the six branch pairs in `runDeterministic`.
- `banner()` and `printInvocation()` — now defined once in `run-logger.ts` and re-imported by `agent-builder.ts` instead of being module-local helpers.

---
## refactor(munchkins/agents): extract getAgentPromptsDir helper
**2026-05-09 14:12 PDT · refactor · 243.6s · $1.6386**

**Goal:** Eliminate the 4× duplicated `dirname(fileURLToPath(import.meta.url)) + join("prompts")` incantation across `bugfix-agent.ts`, `refactor-agent.ts`, `feat-small-agent.ts`, and `presets.ts` by adding a single `getAgentPromptsDir(importUrl)` helper to `presets.ts`.

**Outcome:** Added `getAgentPromptsDir(importUrl: string)` to `packages/munchkins/agents/_shared/presets.ts` and re-exported it. The shared `SHARED_PROMPTS` constant and all three agent files (`bugfix`, `feat-small`, `refactor`) now call the helper instead of recomputing `dirname(fileURLToPath(import.meta.url))` inline. The `node:url` import was dropped from the three agent files; only `join` is still pulled from `node:path` where needed alongside the helper. The trailing import-order delta in `packages/munchkins-core/src/index.ts` is incidental cleanup from the biome lint pass that ran with this refactor.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/index.ts | 43 | 43 | 0 |
| packages/munchkins/agents/_shared/presets.ts | 26 | 30 | +4 |
| packages/munchkins/agents/bugfix/bugfix-agent.ts | 39 | 39 | 0 |
| packages/munchkins/agents/feat-small/feat-small-agent.ts | 46 | 46 | 0 |
| packages/munchkins/agents/refactor/refactor-agent.ts | 28 | 32 | +4 |

**Total:** 182 → 190 (Δ +8)

**Files changed:**
- packages/munchkins-core/src/index.ts
- packages/munchkins/agents/_shared/presets.ts
- packages/munchkins/agents/bugfix/bugfix-agent.ts
- packages/munchkins/agents/feat-small/feat-small-agent.ts
- packages/munchkins/agents/refactor/refactor-agent.ts

**Call sites now sharing `getAgentPromptsDir`:**
- `packages/munchkins/agents/_shared/presets.ts` — defines and consumes it for `SHARED_PROMPTS`
- `packages/munchkins/agents/bugfix/bugfix-agent.ts` — `const PROMPTS = getAgentPromptsDir(import.meta.url)`
- `packages/munchkins/agents/feat-small/feat-small-agent.ts` — `const PROMPTS = getAgentPromptsDir(import.meta.url)`
- `packages/munchkins/agents/refactor/refactor-agent.ts` — `const PROMPTS = getAgentPromptsDir(import.meta.url)`

Net line count grew by 8 because the helper is defined once and each agent still needs an import line for it; the win is that the `dirname(fileURLToPath(...))` pattern is no longer repeated and there is now a single place to change how agent prompt directories are resolved.

---
## docs: add README with concise repo intro and usage
**2026-05-08 21:21 PDT · feat-small · 300.9s · $1.7630**

**Goal:** Add a concise, compelling README with Usage upfront, then push.

**Outcome:** Created a new top-level `README.md` that opens with a one-paragraph pitch, then leads with `Usage` (install + invocation + examples), followed by default agents, backend selection, per-run lifecycle, repo layout, a build-your-own-agent snippet, requirements, and a pointer to `AGENTS.md`. Also tightened `docs/tsconfig.json` to use `@types/bun` instead of `node`.

**New surface:**

- New file: `README.md`

**Lines added:** +87 (across 2 files)

**Files changed:**
- README.md
- docs/tsconfig.json

---
## feat(core): add switchable agent CLI backend (claude/codex)
**2026-05-08 20:59 PDT · feat-small · 671.0s · $6.1088**

**Goal:** Add a process-wide backend switch so operators can run any agent against either the `claude` CLI (default) or the `codex` CLI, selected by `--cli` flag or `MUNCHKINS_CLI` env var.

**Outcome:** Introduced an abstract `AgentCLI` base class with `ClaudeCLI` and `CodexCLI` subclasses behind a single `AgentCLI.fromEnv()` seam. The existing `spawnClaude` export collapses to a one-liner that delegates to `AgentCLI.fromEnv().spawn()`, preserving the harness mock seam and all 3 internal call sites unchanged. Cost tracking becomes optional end-to-end (`AgentUsage.costUsd?`, `RunSummary.costUsd?`, `RunLog.getCostUsd()` returns `number | undefined`) so Codex's missing cost data renders as `—` honestly instead of being faked as `$0.0000`. Codex's missing system-prompt flag is handled by prepending `## System\n…\n\n## Task\n…` as a single positional argument.

**New surface:**

- Export: `AgentCLI` abstract class (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: `ClaudeCLI` class with `buildArgs()` and `spawn()` (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: `CodexCLI` class with `buildArgs()` and `spawn()` (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: `AgentCLI.fromEnv()` static factory (in `packages/munchkins-core/src/builder/agent-cli.ts`)
- Export: types `SpawnOptions`, `SpawnResult`, `AgentUsage`, `AgentCLIName` (in `packages/munchkins-core/src/builder/agent-cli.ts`, re-exported from `packages/munchkins-core/src/builder/index.ts`)
- CLI flag: `--cli <cli>` on every registered agent subcommand (registered in `packages/munchkins-core/src/registry/registry.ts`)
- Env var: `MUNCHKINS_CLI` (public; read by `AgentCLI.fromEnv()`)
- Env var: `__MUNCHKINS_OPT_cli` (internal flag-bridge set by the registry; takes priority over `MUNCHKINS_CLI`)
- New file: `packages/munchkins-core/src/builder/agent-cli.ts`
- New file: `packages/munchkins-core/src/builder/agent-cli.test.ts`

**Lines added:** +484 (across 8 files)

**Files changed:**
- AGENTS.md
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/agent-cli.ts (new)
- packages/munchkins-core/src/builder/agent-cli.test.ts (new)
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/builder/spawn-claude.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/registry/registry.test.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/run-log.test.ts

---
## feat(core): human-readable run names from LLM slug
**2026-05-08 20:29 PDT · feat-small · 1077.4s · $9.3383**

**Goal:** Replace timestamp-based run-log directory names and worktree branch names with LLM-generated, human-readable slugs derived from the user's task description.

**Outcome:** Added a slug-derivation pipeline (Haiku LLM call with retry + deterministic kebab fallback) that feeds both `RunLog` directory names and worktree branch names. Run dirs are now `<slug>-<uuid8>` and branches are `agent/<slug>-<uuid8>`, with the slug capped at 30 chars. Slug derivation runs in parallel with sandbox creation and the worktree branch is renamed once the slug resolves; fallbacks are recorded as `slug-fallback` events in `events.jsonl`. The scenario harness recognizes the new naming via a Haiku-aware mock branch.

**New surface:**

- Export: `sanitize(raw)` (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `deriveSlugDeterministic(text)` (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `getSlugWithRetry(userMessage, opts?)` (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `SLUG_MAX` constant (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `SlugResult` type (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `SlugFallback` type (in `packages/munchkins-core/src/builder/slug.ts`)
- Export: `renameBranch(oldBranch, newBranch, repoRoot)` (in `packages/munchkins-core/src/worktree.ts`)
- Export: `RunLog.recordEvent(event)` public method (in `packages/munchkins-core/src/run-log.ts`)
- Export: `getSlugOutput()` (in `scenarios/lib/mock-spawn-claude.ts`)
- Export: New `slug?: string` option on `RunLog` constructor (in `packages/munchkins-core/src/run-log.ts`)
- Export: New optional `branchName` parameter on `createWorktree` (in `packages/munchkins-core/src/worktree.ts`)
- Export: New `model`, `disallowedTools`, `abortSignal` fields on `SpawnClaudeOptions` (in `packages/munchkins-core/src/builder/spawn-claude.ts`)
- New file: `packages/munchkins-core/src/builder/slug.ts`
- New file: `packages/munchkins-core/src/builder/slug.test.ts`
- New file: `packages/munchkins-core/src/run-log.test.ts`
- New file: `packages/munchkins-core/src/worktree.test.ts`
- Other: New `slug-fallback` event type written to `events.jsonl` (recorded from `agent-builder.ts`)
- Other: `claude` CLI now invoked with `--model` and `--disallowedTools` flags when those options are set (in `packages/munchkins-core/src/builder/spawn-claude.ts`)

**Lines added:** +362 (across 12 files)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/builder/index.ts
- packages/munchkins-core/src/builder/slug.ts
- packages/munchkins-core/src/builder/slug.test.ts
- packages/munchkins-core/src/builder/spawn-claude.ts
- packages/munchkins-core/src/index.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/run-log.test.ts
- packages/munchkins-core/src/sandbox/sandbox.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- packages/munchkins-core/src/worktree.ts
- packages/munchkins-core/src/worktree.test.ts
- scenarios/index.ts
- scenarios/lib/mock-spawn-claude.ts

---

## refactor: extract duplicated helpers across builder, run-log, scenarios
**2026-05-08 20:11 PDT · refactor · 408.3s · $3.3636**

**Goal:** Fix any refactoring opportunities found across the codebase.

**Outcome:** Pulled four sets of duplicated inline logic into named helpers/constants. In `agent-builder.ts`, the user-message resolution and summary-writer prompt construction were duplicated across `_buildSummaryWriterUserPrompt`-equivalent call sites; these are now `resolveOriginalGoal()` and `buildSummaryWriterUserPrompt()`. In `run-log.ts`, the command-entry log formatter and env-path resolution logic were each duplicated; extracted as `formatCommandEntries()` and `resolveEnvPath()`. In `sandbox.test.ts`, the git identity env block was inlined twice; extracted to `TEST_GIT_IDENTITY` constant and `gitEnv()` helper. In `scenarios/index.ts`, six near-identical fail-result objects were collapsed into a single `failResult()` factory closure. Net line count drops, but the primary value is single source of truth for each pattern.

**Refactor type:** extraction

**Lines changed:**

| File | Before | After | Δ |
|------|--------|-------|---|
| packages/munchkins-core/src/builder/agent-builder.ts | 656 | 637 | −19 |
| packages/munchkins-core/src/run-log.ts | 331 | 332 | +1 |
| packages/munchkins-core/src/sandbox/sandbox.test.ts | 182 | 181 | −1 |
| scenarios/index.ts | 358 | 311 | −47 |

**Total:** 1527 → 1461 (Δ −66)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/run-log.ts
- packages/munchkins-core/src/sandbox/sandbox.test.ts
- scenarios/index.ts

**Extracted helpers and their call sites:**
- `resolveOriginalGoal(repoRoot)` in `agent-builder.ts` — called from the runtime summary-writer phase (~line 317) and the resolved-prompt preview phase (~line 442).
- `buildSummaryWriterUserPrompt(originalGoal, diffSection)` in `agent-builder.ts` — called from the same two phases as above.
- `formatCommandEntries(entries)` in `run-log.ts` — called from `recordDeterministic` (~line 206) and `recordFinalize` (~line 244).
- `resolveEnvPath(envValue, fallback, repoRoot)` in `run-log.ts` — called from the `RunLog` constructor (run-log dir) and `_prependChangelog` (changelog path).
- `TEST_GIT_IDENTITY` constant + `gitEnv()` helper in `sandbox.test.ts` — used by `createRepo()` and `commit()`.
- `failResult(phase, message, opts?)` closure in `scenarios/index.ts` — replaces six inline fail-shaped returns covering registry-miss, agent failure, mock-call audit, claude-spawn audit, cleanup assertion, artifact assertion, and the catch-all setup error.

---
## feat(cli): add --thinking flag for mid verbosity level
**2026-05-08 19:58 PDT · feat-small · 582.6s · $4.0524**

**Goal:** Add a middle verbosity level called `--thinking` that sits between the default (terse) and `--verbose` (full), streaming Claude output without the boxed prompt prefaces.

**Outcome:** Registered a new `--thinking` Commander option on every agent subcommand that sets `__MUNCHKINS_OPT_thinking=true`. `AgentBuilder.run()` now reads both `verbose` and `thinking` env vars and computes a `streamOutput` flag (`verbose || thinking`) that is threaded through `runAgent`, `runDeterministic`, and the writer phase to control whether `spawnClaude` streams. Boxed `printInvocation` output, phase banners, and per-command stdout remain gated on the existing `verbose` flag, so `--thinking` only unlocks streaming. Updated `--verbose` help text to mention the three levels and added registry tests covering option registration and env-var wiring.

**New surface:**

- CLI flag: `--thinking` on every registered agent subcommand (registered in `packages/munchkins-core/src/registry/registry.ts`)
- Env var: `__MUNCHKINS_OPT_thinking`
- New file: `packages/munchkins-core/src/registry/registry.test.ts`

**Lines added:** +124 (across 4 files)

**Files changed:**
- packages/munchkins-core/src/builder/agent-builder.ts
- packages/munchkins-core/src/registry/registry.ts
- packages/munchkins-core/src/registry/registry.test.ts
- packages/munchkins-core/src/sandbox/sandbox.ts


---
## refactor(run-log): extract _writeClaudeCall helper
**2026-05-08 19:02 PDT · refactor · 267.4s · $1.6061**

**Goal:** Deduplicate three near-identical Claude-call writers in `RunLog` (`agentStep`, `summaryStep`, `fixerInvocation`) by extracting a private helper.

**Outcome:** Added `_writeClaudeCall(prefix, kind, systemPrompt, userPrompt, response, exitCode, durationMs, extra)` that writes the `*.system.md` / `*.user.md` / `*.response.txt` artifacts, increments `claudeCallCount`, and emits the corresponding event with `systemBytes` / `userBytes` / `responseBytes`. Each public method now computes only its own prefix and per-kind `extra` fields (`stepIndex`, `iteration`) and delegates to the helper, while preserving its own counter bumps (`agentStepCount`, `fixerInvocationCount`). Behavior, file names, and event payload shapes are unchanged.

**Files changed:**
- `packages/munchkins-core/src/run-log.ts` — introduced `_writeClaudeCall` helper; rewrote `agentStep`, `summaryStep`, and `fixerInvocation` to delegate to it; consolidated the `claudeCallCount` increment into the helper.

---
_No agent runs have been recorded yet. The first successful run of `bun run munchkins <agent>` will prepend an entry above._
