# Feature: model-initiated HITL via `munchkins hitl` subcommand

Headless agents (Claude `--dangerously-skip-permissions`, Codex `exec`)
have no path back to a human mid-run. Add a tiny CLI surface the agent
can call via its Bash tool when it genuinely needs human input:
`munchkins hitl ask "<question>"` registers a question and prints an id;
`munchkins hitl wait <id>` blocks (no timeout) until a human answers.
A separate `munchkins hitl answer <id> "<text>"` (or stdin) is how the
human responds; `munchkins hitl list` shows pending questions.

This is **model-initiated** HITL — the agent decides when to ask. It is
not pipeline-level approval gating. Approval gating (every write, every
tool call) is explicitly out of scope and tension with PURPOSE.md ("HITL
approval inside the agent pipeline" is listed as out of scope) — the
user has acknowledged this and chosen the model-initiated path anyway.

The CLI itself never times out. The agent's Bash tool may kill the
`wait` call after its own ceiling (Claude: 10min hard cap; Codex: no
cap). The agent re-calls `wait <id>` and picks up where it left off —
question state lives on disk in `<repoRoot>/.munchkins/hitl/`.

## User-facing change

Agents can call `munchkins hitl ask "<question>"` via Bash. The call
returns an id immediately. They then call `munchkins hitl wait <id>`
with a long Bash timeout; that call blocks until the human writes an
answer via `munchkins hitl answer <id> "<text>"`. The human can also
run `munchkins hitl list` to see what's pending.

No change to the existing agent pipeline. No new flags on existing
subcommands. No MCP server. No per-CLI (claude vs. codex) branching.

## Target file(s)

- `packages/munchkins/src/hitl/index.ts` — module barrel.
- `packages/munchkins/src/hitl/store.ts` — file-based question/answer
  store under `<repoRoot>/.munchkins/hitl/`.
- `packages/munchkins/src/hitl/store.test.ts` — store unit tests.
- `packages/munchkins/src/hitl/run-hitl.ts` — the four operations
  (`ask`, `wait`, `answer`, `list`) with injectable deps for tests
  (clock, polling sleep, stdout/stderr) matching the
  `packages/munchkins/src/status/run-status.ts` shape.
- `packages/munchkins/src/hitl/run-hitl.test.ts` — unit tests.
- `packages/munchkins/src/hitl/command.ts` — Commander registration
  matching `packages/munchkins/src/status/command.ts`.
- `packages/munchkins/src/hitl/command.test.ts` — wiring smoke test.
- `packages/munchkins/src/index.ts` — re-export the public surface and
  call `registerHitlCommand(registry)` next to the existing
  `registerStatusCommand(registry)` line (currently L116).
- `packages/serrano-munchkins/` — add a short HITL guidance paragraph
  to each agent's system prompt (locate the prompt files; do NOT
  rewrite unrelated prompt content).
- `scenarios/hitl-roundtrip-e2e.ts` (new) — end-to-end roundtrip
  scenario that does NOT invoke a real LLM. Wire it into the
  `scenario` script in root `package.json` next to the other e2e
  scenarios.
- `packages/munchkins/package.json` — bump version `0.3.0` → `0.4.0`.
- `docs/pages/changelog.md` — add an entry under the most-recent block.

## What to add

1. **Store (`packages/munchkins/src/hitl/store.ts`)**

   Layout under `<repoRoot>/.munchkins/hitl/`:
   - `<id>.question.json` — `{ id, question, createdAt, context?, agent? }`
     where `id` is an 8-char base32-ish slug (use the same pattern as
     `RunLog`'s `crypto.randomUUID().slice(0, 8)`).
   - `<id>.answer.txt` — file existence = answered; contents = the
     answer string. Written atomically (`writeFile` to a `.tmp` then
     `rename`) so a poller never reads a half-written answer.

   Exposed (pure, injectable) functions:
   ```ts
   export interface Question {
     id: string;
     question: string;
     createdAt: string;
     context?: string;
     agent?: string;
   }
   export interface HitlStore {
     dir: string;
     create(input: { question: string; context?: string; agent?: string }): Question;
     readQuestion(id: string): Question | undefined;
     hasAnswer(id: string): boolean;
     readAnswer(id: string): string | undefined;
     writeAnswer(id: string, answer: string): void;
     listPending(): Question[];
     listAll(): Question[];
   }
   export function openStore(repoRoot: string, opts?: { now?: () => number; uuid?: () => string }): HitlStore;
   ```

   Honors `MUNCHKINS_RUN_LOG_DIR` is **not** a requirement — HITL state
   is repo-global, not per-run. Use `<repoRoot>/.munchkins/hitl/`
   directly. Add a `MUNCHKINS_HITL_DIR` env override (absolute or
   relative-to-repoRoot, same resolution as
   `resolveEnvPath` in `run-log.ts:42` — extract that helper into
   `packages/munchkins/src/util/resolve-env-path.ts` and reuse from
   both call sites; do NOT duplicate it).

2. **`run-hitl.ts`** — four exported async functions matching the
   `runStatus` shape (deps injectable, returns `{ exitCode }`):

   ```ts
   export interface HitlDeps {
     repoRoot?: string;
     store?: HitlStore;
     stdout?: (line: string) => void;
     stderr?: (line: string) => void;
     now?: () => number;
     /** Polling sleep for `wait`. Defaults to 500ms. Tests inject 0. */
     sleepMs?: number;
     /** Allows tests to break the wait loop deterministically. */
     shouldStop?: () => boolean;
   }
   export async function runHitlAsk(argv: string[], deps?: HitlDeps): Promise<{ exitCode: number }>;
   export async function runHitlWait(argv: string[], deps?: HitlDeps): Promise<{ exitCode: number }>;
   export async function runHitlAnswer(argv: string[], deps?: HitlDeps): Promise<{ exitCode: number }>;
   export async function runHitlList(argv: string[], deps?: HitlDeps): Promise<{ exitCode: number }>;
   ```

   Behaviors:
   - **ask**: argv `<question> [--context <text>] [--agent <name>]`.
     Creates the question, prints the id (just the id, nothing else)
     to stdout, exits 0. Empty question → stderr + exit 2.
   - **wait**: argv `<id>`. If question missing → stderr + exit 1.
     Loop: if answer file exists, print contents to stdout, exit 0.
     Otherwise `await sleep(sleepMs)` and loop. `shouldStop()` (tests
     only) breaks the loop with exit 124 to keep tests bounded; do
     NOT expose this as a CLI flag.
   - **answer**: argv `<id> [<text>]`. If `<text>` omitted, read from
     stdin (`Bun.stdin.text()`). If question missing → stderr + exit 1.
     If already answered → stderr + exit 3 (prevent silent overwrite).
     Writes answer atomically. Exit 0.
   - **list**: argv `[--all] [--json]`. Default: pending only, table
     form (id, age, question truncated to 60 chars). `--json` emits
     full records. `--all` includes answered. Empty + non-json: print
     `no pending hitl questions`. Always exit 0.

3. **`command.ts`** — register one parent command with four
   subcommands using Commander, matching the shape of
   `packages/munchkins/src/status/command.ts`:

   ```ts
   export function registerHitlCommand(registry: AgentRegistry): void {
     registry.registerCommand({
       name: "hitl",
       description: "Human-in-the-loop question queue for agents.",
       configure: (cmd) => {
         cmd.command("ask <question>")
            .option("--context <text>")
            .option("--agent <name>")
            .action(async (question, opts) => { /* build argv, call runHitlAsk */ });
         cmd.command("wait <id>")
            .action(async (id) => { /* runHitlWait */ });
         cmd.command("answer <id> [text]")
            .action(async (id, text) => { /* runHitlAnswer */ });
         cmd.command("list")
            .option("--all")
            .option("--json")
            .action(async (opts) => { /* runHitlList */ });
       },
     });
   }
   ```

4. **`packages/munchkins/src/index.ts`** — add:
   ```ts
   export { type HitlDeps, runHitlAsk, runHitlWait, runHitlAnswer, runHitlList } from "./hitl/index.js";
   export { type HitlStore, type Question, openStore } from "./hitl/store.js";
   import { registerHitlCommand } from "./hitl/command.js";
   registerHitlCommand(registry);
   ```

5. **Agent prompt guidance** — locate the four dogfood agent prompts
   under `packages/serrano-munchkins/` (likely `feat-small`,
   `bug-fix`, `refactor`, `director`). Add a single short paragraph,
   identical across all four, to each agent's system prompt:

   > **When you need a human:** run `munchkins hitl ask "<question>"`
   > via Bash to capture an id, then `munchkins hitl wait <id>` with
   > a 30-minute Bash timeout (`timeout: 1800000` for Claude;
   > equivalent for Codex). If `wait` exits without an answer, call
   > it again — the question persists. Use HITL sparingly: only for
   > ambiguous design forks or destructive operations you cannot
   > resolve from context. The director runs unattended — it must
   > NOT call `hitl ask`.

   The director carve-out is important: it runs on cron with no
   human present, so its prompt explicitly forbids HITL.

6. **Scenario (`scenarios/hitl-roundtrip-e2e.ts`)** — does NOT invoke
   a real LLM. Mirrors the shape of `scenarios/composition.ts`
   (minimal git repo in tmpdir). Steps:
   - Create a fresh git repo, chdir in.
   - Import `runHitlAsk`, `runHitlWait`, `runHitlAnswer`, `runHitlList`
     from `@serranolabs.io/munchkins`.
   - Call `runHitlAsk(["should I delete the table?"])`, capture
     stdout, parse the id.
   - Start `runHitlWait([id])` (don't await yet) with `sleepMs: 10`.
   - Call `runHitlAnswer([id, "yes, proceed"])`, assert exit 0.
   - Await the wait promise; assert exit 0, stdout `"yes, proceed"`.
   - Call `runHitlList([])`; assert `no pending hitl questions`.
   - Call `runHitlList(["--all", "--json"])`; assert one record.
   - Negative: `runHitlWait(["nonexistent"])` → exit 1.
   - Negative: `runHitlAnswer([id, "again"])` (double-answer) → exit 3.

   Wire into root `package.json` `scenario` script next to the others.

## Constraints

1. **No MCP server.** The agent's Bash tool is the only channel.
2. **No timeout in `wait`.** The CLI process blocks forever. The
   agent's Bash tool may kill it; re-entry is the answer.
3. **No per-CLI branching.** The same CLI surface works for both
   Claude and Codex backends.
4. **Atomic answer writes.** Use `writeFile`-to-tmp + `rename`. A
   poller must never read a partial answer.
5. **Repo-global storage.** `<repoRoot>/.munchkins/hitl/` — not
   per-run. Multiple concurrent agents share one queue; ids prevent
   collision. Override via `MUNCHKINS_HITL_DIR`.
6. **Director must not call HITL.** Director runs unattended on
   cron; its system prompt explicitly forbids `hitl ask`.
7. **DRY: reuse `resolveEnvPath`.** Extract from `run-log.ts:42`
   into `packages/munchkins/src/util/resolve-env-path.ts` and update
   the `RunLog` call site. Do NOT inline it twice.
8. **No new dependencies.** Use Node `fs`, `path`, `crypto.randomUUID`.
9. **No real `claude`/`gh` calls in tests + scenarios.**
   `setupAuditGuard()` must pass for the new scenario.
10. **Style:** matches existing module shape — `index.ts` barrel,
    one concern per file, deps injectable via `runX(argv, deps)`.

## Acceptance criteria

- `bun packages/munchkins/src/hitl/store.test.ts` exits 0.
- `bun packages/munchkins/src/hitl/run-hitl.test.ts` exits 0.
- `bun packages/munchkins/src/hitl/command.test.ts` exits 0.
- `bun scenarios/hitl-roundtrip-e2e.ts` exits 0.
- `bun run scenario` exits 0 (existing scenarios unaffected).
- `bun run lint` and `bun run typecheck` pass.
- `bun packages/munchkins/src/run-log.test.ts` still exits 0 after
  the `resolveEnvPath` extraction.
- `bun run munchkins hitl --help` lists `ask`, `wait`, `answer`,
  `list`.
- Manual smoke: in two terminals at this repo root:
  - T1: `bun run munchkins hitl ask "test"` prints an id.
  - T2: `bun run munchkins hitl wait <id>` blocks.
  - T1: `bun run munchkins hitl answer <id> "ok"`.
  - T2: prints `ok`, exits 0.
- `packages/munchkins/package.json` version is `0.4.0`.
- Changelog has a new entry under the most-recent block.

## Out of scope

- MCP server variant.
- Push / Slack / email notification of pending HITL questions.
- A TUI for answering questions (one-line `answer` subcommand only).
- Surfacing pending HITL questions in `munchkins status`.
- Wiring HITL into the director's tick loop (director is forbidden
  from calling HITL per Constraint #6).
- Per-question timeout / auto-decline policy.
- Multi-repo / cross-repo question queues.
- Backwards-compat shims — this is a new surface.
