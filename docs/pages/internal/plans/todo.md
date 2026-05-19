# TODO — open validation work

Recorded 2026-05-19. Each item is a "prove it works" task with explicit
acceptance criteria. Strike through when validated; preserve the entry so
future regressions are testable against the same bar.

---

## 1. Validate the bug-fix flow end-to-end

**Goal:** A real `bun run munchkins bug-fix --user-message=<brief>` against a
non-fixture repo lands a real commit on `main` and the worktree is cleaned.

**Acceptance:**
- [ ] Run against this repo with a trivial brief (e.g. "add a blank line at the
  end of `docs/pages/index.mdx`"). Expect: agent succeeds, a single
  `docs(changelog): <message>` commit lands on `main`, worktree removed,
  agent branch deleted.
- [ ] Repeat with `--integrate=pr`. Expect: GitHub PR opened, branch pushed,
  PR body includes the markdown summary.
- [ ] Run against a dirty `repoRoot` (uncommitted edit to README). Expect:
  agent succeeds, snapshot commit appears on main under author `munchkins`,
  `git show <sha>:README.md` recovers the original edit.
- [ ] On forced failure (e.g. break the seed `lint` script), confirm the
  worktree + branch are preserved and `munchkins resume --list` surfaces the
  interrupted run.

---

## 2. Validate the director works end-to-end

**Goal:** Cron-driven director picks a real slice from this repo's
`PURPOSE.md`, dispatches an actual child munchkin, and the child lands a PR.

**Acceptance:**
- [ ] `bun run munchkins director --dry-run` exits 0 and prints a
  triage outcome (idle OR dispatch target + work_type).
- [ ] One real tick against this repo: `bun run munchkins director` produces
  artifacts under `.director/<run>/`, dispatches a child via `dispatch.sh`,
  and the child opens a PR (or merges, depending on `.integrate()` strategy).
- [ ] Inflight survey detects the dispatched child's branch on a subsequent
  tick — the director should NOT re-dispatch the same slice while it's in
  flight.
- [ ] `bun run munchkins crons` (or equivalent registry listing) shows
  director with schedule `*/10 * * * *`.
- [ ] `bun run munchkins daemon` arms the director and the first tick fires
  the pipeline without spawning real claude (verify via the env-only
  configuration; OR confirm the spawn IS happening by inspecting run-log).

---

## 3. Validate the GitHub PR integration strategy

**Goal:** `--integrate=pr` produces a clean PR linked to the agent's work,
authored by the right identity, with the right base branch and body.

Validated 2026-05-19 via `integrate.test.ts` "integratePR happy path" (I7–I10):
stubbed `gh` on PATH + bare-repo origin exercise the full push + create flow
without burning Claude tokens or opening real PRs. Required a tiny refactor —
`createGithubPR` / `createGitlabMR` now use `Bun.spawnSync` with explicit
`env: { ...process.env }` because Bun's `$` resolves binaries against a
startup-cached PATH that ignores later mutations.

**Acceptance:**
- [x] ~~`bun run munchkins bug-fix --integrate=pr --user-message=...` from
  a clean checkout: confirm PR opens via `gh pr view`, base is `main`,
  branch follows `agent/<slug>-<hash>` (or `director/<...>` when invoked
  by the director).~~ — covered by I7 (asserts branch matches `agent/bug-fix-…`,
  `gh` invoked with `--base main`, stub URL returned through `result.prUrl`).
- [x] ~~PR body includes the markdown summary from the summary-writer phase
  (lifted from the `markdown` field of the parsed JSON).~~ — covered by I7
  (`--body` arg captured by the stub equals the `markdownSummary` passed in;
  I9 covers the fallback when no summary writer ran).
- [x] ~~When the same agent is invoked with `--branch-prefix=director`, the
  branch prefix lands on `director/<...>` and `gh pr list --head 'director/*'`
  finds it (the director's inflight-survey depends on this exact pattern).~~ —
  covered by I8 (pushes `director/feat-thing-deadbeef` to origin; selection
  semantics already covered by `agent-builder.test.ts:373`).
- [x] ~~PR commit history matches local: same SHAs, no force-push surprises.~~
  — covered by I7 (`git ls-remote` SHA == local worktree HEAD SHA after rebase).
- [x] ~~Local `main` does NOT advance (PR strategy never ff-merges directly).~~
  — covered by I7 (asserts `git rev-parse main` is identical before/after).

---

## 4. Walk through each agent against repo practices

**Goal:** Every agent under `packages/munchkins/agents/*` follows the
conventions documented in `AGENTS.md`, `CLAUDE.md`, and the
`munchkins:new-munchkin` skill body.

**Per-agent checklist** (applies to `bugfix`, `feat-small`, `refactor`,
`director`, `bugfix-then-refactor`):

- [x] Agent .ts uses `withSkill("munchkins:<name>")` (not a hardcoded path).
- [x] Skill body lives at `packages/munchkins/skills/munchkins-<name>/SKILL.md`
  and is symlinked into `.claude/skills/munchkins-<name>/` for runtime
  resolution.
- [x] Step composition uses shared presets from `_shared/presets.ts` where
  applicable (refactorer / test-writer / summary-writer / deterministic-fixer).
  `feat-small` and `refactor` keep per-agent `summary-writer.md` prompts (smoke-test
  recipe / line-count metrics respectively) — documented inline at each
  `.summaryWriter(...)` call.
- [x] `AgentBuilder.describe()` matches the AGENTS.md row matches the
  SKILL.md `description:` (three-way sync, per new-munchkin's hard rule).
- [x] No colocated `<name>-agent.test.ts` file (policy: agent unit tests
  forbidden — see `munchkins:new-munchkin` SKILL.md).
- [x] Bundle entry at `packages/munchkins/src/index.ts` side-effect-imports
  the agent module (otherwise it never registers). `bugfix-then-refactor` is an
  example, not registered, by design.
- [x] Omit `.integrate(...)` to inherit the run-layer default (`integrateMerge`).
  Only declare `.integrate(integratePR())` when the agent should default to PR
  (currently none do). The operator `--integrate <merge|pr>` flag overrides
  either choice at run time.
- [x] Cron-armed agents (`director`) declare `.handlesDryRun()` so the
  framework's dry-run short-circuit doesn't bypass deterministic steps.

---

## 5. Validate fresh-clone onboarding

**Goal:** A new user can clone this repo, follow the README, and produce a
green munchkin run without manual debugging.

**Acceptance:**
- [ ] From an empty directory: `git clone <repo> && cd munchkins && bun install`
  succeeds without warnings beyond expected workspace-resolution noise.
- [ ] `bun run typecheck && bun run lint && bun test && bun run scenario`
  all pass on a fresh clone with no extra env setup.
- [ ] `bun run munchkins --help` lists all 5 agents (bug-fix, feat-small,
  refactor, director, bugfix-then-refactor) plus the meta commands
  (resume, status, daemon, skills).
- [ ] `bun run munchkins skills install` materializes the bundled skills
  into `.claude/skills/` and does not overwrite operator edits on re-run.
- [ ] A consumer-style install in a separate repo: `bun add -D
  @serranolabs.io/munchkins` followed by `bun run munchkins skills install`
  produces a working agent invocation against that consumer's `PURPOSE.md`.
- [ ] No reliance on undocumented env vars beyond what's in the README.
- [ ] `MUNCHKINS_CHANGELOG_PATH` works without the npm-script wrapper
  (i.e. a direct `bun run packages/munchkins/src/index.ts` invocation
  with the env var set produces the same result as `bun run munchkins`).
