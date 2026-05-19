# Current state — project mental model + test coverage

> Snapshot as of 2026-05-19. Refresh by re-running the `find` + `grep -c` audit
> in `scenarios/` against the current tree.

## Test coverage

| File | Tests | Notes |
|---|---|---|
| `agent-builder.ts` | 36 | builder API + dry-run + integration precedence |
| `agent-cli.ts` | 29 | ClaudeCLI / CodexCLI |
| `run-log.ts` | 22 | run artifact pipeline |
| `integrate.ts` | 19 | rebase + ff-merge + dirty-main matrix |
| `sandbox.ts` | 19 | worktree lifecycle + diff() (issue #1) |
| `scheduler/daemon.ts` | 19 | cron arming + callback |
| `cmux-launcher.ts` | 17 | delegation + env propagation |
| `slug.ts` | 16 | branch-name slugging |
| `skills-install.ts` | 14 | skill scaffolding |
| `prompt.ts` | 13 | system/user prompt composition |
| `parse-summary-writer-json.ts` | 13 | JSON parser |
| `resume/run-resume.ts` | 11 | resume orchestration |
| `registry.ts` | 10 | agent + command registration |
| `worktree.ts` | 9 | git worktree primitives |
| `resume/run-state.ts` | 9 | run state persistence |
| `status/run-status.ts` | 6 | running-munchkin enumeration |
| `resume/command.ts` | 6 | resume CLI shape |
| `register-skills-command.ts` | 5 | skills CLI shape |
| `scheduler/command.ts` | 5 | daemon CLI shape |
| `status/command.ts` | 5 | status CLI shape |
| `run-logger.ts` | 4 | presentation/console output |

## Intentionally untested — agent files

By policy, `packages/munchkins/agents/<name>/<name>-agent.ts` files do NOT
get colocated `.test.ts` files. They are pure configuration (builder
declaration, step composition, cron config); asserting against the
registered singleton just re-states the source. Agents are covered
end-to-end by the scenario harness, where real failure modes surface.
The director previously had unit tests; they were removed for this
reason. The policy is recorded in `munchkins:new-munchkin` SKILL.md
under "Hard rules".

Files this applies to:
- `packages/munchkins/agents/bugfix/bugfix-agent.ts`
- `packages/munchkins/agents/feat-small/feat-small-agent.ts`
- `packages/munchkins/agents/refactor/refactor-agent.ts`
- `packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts`
- `packages/munchkins/agents/director/director-agent.ts`
- `packages/munchkins/agents/_shared/presets.ts`
- `packages/munchkins/src/index.ts` (CLI entry — exercised by every scenario)

## "Don't bother" — barrel files

7 `index.ts` re-export shims in `packages/munchkins-core/src/*/index.ts` and
`spawn-claude.ts` (which just re-exports `AgentCLI.spawn`). No logic to test.

---

## Mental model

```
packages/
├─ munchkins-core/                ← framework (no agents)
│  └─ src/
│     ├─ builder/                  ← AgentBuilder, Prompt, AgentCLI (Claude/Codex)
│     ├─ sandbox/                  ← gitWorktreeSandbox (worktree create/diff/teardown)
│     ├─ integrate.ts              ← rebase + ff-merge (now with -X theirs + dirty snapshot)
│     ├─ registry/                 ← AgentRegistry: register agents + commands, build CLI
│     ├─ scheduler/                ← cron daemon
│     ├─ resume/                   ← interrupted-run recovery
│     ├─ status/                   ← list running munchkins
│     ├─ run-log.ts                ← per-run artifact dir (summary.json, events.jsonl, prompts)
│     └─ worktree.ts               ← git plumbing
│
└─ munchkins/                     ← default agents + CLI shell
   ├─ src/                        ← CLI entry + cmux launcher + skills installer
   ├─ skills/                     ← bundled skills (markdown bodies)
   └─ agents/                     ← bug-fix, feat-small, refactor, director (+ composition)

scenarios/                        ← E2E harness (bun run scenario):
                                    bugfix-agent-e2e, composition-e2e, resume-after-claude-exit-e2e,
                                    director-multi-dispatch-e2e, agent-uncommitted-smoke-e2e, dirty-main-e2e
```

### Pipeline a single agent run goes through

1. **CLI parse** (registry.ts) → argv → option env vars (`__MUNCHKINS_OPT_*`)
2. **(optional) cmux delegation** (cmux-launcher.ts) — launch into a workspace, re-exec inner
3. **Builder.run()** (agent-builder.ts)
   - Sandbox: `gitWorktreeSandbox().create()` → fresh branch + worktree
   - For each step: `spawnClaude` (LLM) or deterministic shell
   - Summary-writer phase: `sandbox.diff()` stages + computes diff → LLM → commit message → `git commit` (agent's work + changelog all in one)
   - Integrate: `rebaseAndResolve` (with `-X theirs`) → ff-merge into `main`
   - Teardown: remove worktree + branch on pass; preserve on fail

---

## Director agent layout

```
packages/munchkins/agents/director/
├─ director-agent.ts              ← builder declaration (~1.8K)
├─ director-agent.test.ts         ← 14 tests
├─ scripts/
│  ├─ repo-survey.sh              ← deterministic: scans repo for "what could be done"
│  ├─ inflight-survey.sh          ← deterministic: lists `director/*` PRs + branches already in flight
│  └─ dispatch.sh                 ← deterministic: reads triage.json + spawns the chosen child munchkin
└─ prompts/
   ├─ triage.md                   ← LLM step 1: pick a slice
   ├─ spec.md                     ← LLM step 2: write the brief
   └─ plan.md                     ← LLM step 3: refine
```

7-step pipeline: survey → inflight-check → triage (LLM) → spec (LLM) →
plan (LLM) → dispatch → (child agent does its own pipeline). Cron-armed
to `*/15 * * * *` via `.cron()`. Reads `PURPOSE.md` as north star.

`--branch-prefix=director` distinguishes director-spawned work in
`gh pr list --head 'director/*'` / `git branch --list 'director/*'`.
