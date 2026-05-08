# Munchkins agent guidelines

These guidelines are prepended to every default-agent system prompt in this repo. They apply to anything you write, fix, or refactor.

## Project facts

- Bun + Turborepo monorepo. Three workspaces: `packages/munchkins-core` (framework), `packages/munchkins` (defaults bundle), `docs` (Rspress docs site).
- **Bun only.** Never invoke `npm install` or `pnpm install`. Use `bun install` / `bun add` / `bun run`. Lockfile is `bun.lock`.
- Cross-package imports go through monorepo package names (`@serranolabs.io/munchkins-core`, `@serranolabs.io/munchkins`). No relative paths across workspace boundaries.
- The scenario harness at `scenarios/` mocks Claude via `mock.module()` targeting `packages/munchkins-core/src/builder/spawn-claude.ts`. Don't change that file's exported shape (`spawnClaude` function returning `{ exitCode, output, durationMs }`) without updating the harness in lockstep.
- Plan-funnel artifacts at `docs/pages/internal/{diagnosis,prd,scenario-testing-strategy,technology-decisions,plan}.md` are durable design records. Update them only when the design actually changes; do not edit them as scratchpads.

## Code rules

- **Prefer Bun APIs over Node-style equivalents** wherever both are available:
  - `Bun.file(path).text()` / `Bun.write(path, contents)` over `fs.readFileSync` / `fs.writeFileSync` for new code.
  - `Bun.$\`...\`` template tag over `child_process.spawn` / `child_process.exec` for shell-style calls.
  - `Bun.spawn(...)` over `child_process.spawn` when you need streaming stdio.
  - `Bun.glob(...)` over pulling in a `glob` package.
  - `import.meta.main` over `require.main === module`.
  - Existing code already on Node APIs may stay there — only adopt Bun APIs when adding new code or actively restructuring. Don't rewrite working code just to switch styles.

- **Use libraries instead of handwriting** for any non-trivial concern that has a well-maintained library covering it:
  - CLI parsing → `commander` (already a dependency).
  - Glob matching → `Bun.glob` (built-in).
  - Date formatting → `Intl.DateTimeFormat` (built-in).
  - Schema validation → don't handwrite; if no dep covers it, surface the question rather than rolling your own.
  - Don't reimplement what is one `bun add` away unless you have actively justified avoiding the dep.

- No scope creep. Don't add features, abstractions, refactors, or "while I'm here" cleanup beyond what the task requires. Three similar lines is fine — premature abstraction is not.

- No defensive code for impossible cases. Trust internal call sites and framework guarantees. Validate only at real system boundaries (user input, external APIs).

- Comments off by default. Add one only when the WHY is non-obvious — a hidden constraint, a workaround for a specific bug, behavior that would surprise a careful reader. Don't reference the current task or fix in comments; that belongs in the commit message.

## Output expectations

- Make changes in the worktree at `$WORKTREE`. Commit before finalizing.
- The deterministic loop after your agent step(s) runs `bun run lint`, `bun run typecheck`, and `bun run scenario` in the worktree. Aim for green on first try; the deterministic-fixer subagent gets up to 3 iterations to recover if anything fails.
