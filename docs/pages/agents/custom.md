# Build your own

Write a registered agent that auto-appears in `bun run munchkins --help` alongside the defaults. The default bundle is just three small files using the public framework — there is no hidden surface.

## What you're building

A custom agent is a TypeScript file that constructs an `AgentBuilder`, attaches steps and a deterministic gate, and calls `registry.register(builder)`. A side-effect import from your bundle's entry pulls it into the CLI. After that:

```sh
bun run munchkins your-agent --user-message=./scratch/brief.md
```

…just works. `--help` lists it; `--dry-run` describes it; `resume`, `daemon`, and the `launch-munchkin` skill all treat it like a default.

## The easy path: the `new-munchkin` skill

If you're inside Claude Code, the `new-munchkin` skill scaffolds the agent for you. Trigger it with phrases like *"new munchkin"*, *"add a default agent"*, or *"scaffold a munchkin agent"*. The skill walks you through a sequential interview — purpose, distinctness from existing agents, archetype (single-step vs. main+refactor vs. main+refactor+tests), name, prompt content — then writes the files. See `packages/munchkins/skills/new-munchkin/SKILL.md` in this repo for the full workflow.

The rest of this page is the manual path. Use it to understand what the skill is doing or when you want to do something the skill doesn't cover.

## File layout

The convention the default agents and the `new-munchkin` skill assume:

```
packages/<your-bundle>/
├── src/
│   └── index.ts                       # bundle entry — side-effect import lives here
└── agents/
    └── <your-agent>/
        ├── <your-agent>-agent.ts       # the AgentBuilder construction
        └── prompts/
            └── <your-agent>.md         # the agent's system prompt
```

Then in `src/index.ts`:

```ts
export * from "@serranolabs.io/munchkins-core";
import "../agents/<your-agent>/<your-agent>-agent.js";

if (import.meta.main) {
  const { registry } = await import("@serranolabs.io/munchkins-core");
  // … same dispatch table as packages/munchkins/src/index.ts
  await registry.cli().parseAsync(process.argv);
}
```

The side-effect import is what causes `registry.register()` to fire. Without it the agent is invisible.

## `AgentBuilder` full surface

Every method on `AgentBuilder` is part of the public API. Construct one, chain whatever you need, register the result.

```ts
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";

const builder = new AgentBuilder("your-agent", "Short description.", gitWorktreeSandbox());
```

| Method | Signature | What it does |
|--------|-----------|--------------|
| `option` | `option(name: string, schema: OptionSchema): this` | Declare a CLI flag explicitly. Most agents skip this and let `.add()` declare options indirectly. |
| `add` | `add(prompt: Prompt): this` | Append an agent step. If the prompt declares a `withUserMessageFromOption`, the option is auto-declared on the builder. |
| `addDeterministic` | `addDeterministic(commands: string[], opts?: { loop?: { maxIterations?: number; fixer?: Prompt } }): this` | Append a deterministic gate. `maxIterations` defaults to 3; `fixer` defaults to `new Prompt("docs/subagents/deterministic-fixer.md")` — pass your own to override. |
| `summaryWriter` | `summaryWriter(prompt?: Prompt): this` | Attach a summary writer that runs after the gate, reads the diff, and emits the commit message + changelog markdown. Pass `undefined` to disable. |
| `integrate` | `integrate(strategy?: IntegrationStrategy): this` | Pin an integration strategy on the agent. Without a flag override, this strategy runs at land time. Calling with no argument is equivalent to `integrateMerge()`. |
| `setSandbox` | `setSandbox(factory: SandboxFactory): this` | Replace the constructor sandbox. Useful after `.thenRun()` strips it. |
| `rename` | `rename(name: string): this` | Change the registered name. Useful for composed agents. |
| `describe` | `describe(description: string): this` | Change the description shown in `--help`. |
| `thenRun` | `thenRun(other: AgentBuilder): AgentBuilder` | Returns a **new** builder concatenating both step lists. Sandbox / summary writer / integration are stripped. |
| `cron` | `cron(spec: string, opts: { userMessage: string; verbosity?: Verbosity }): this` | Schedule the agent on a cron spec for `bun run munchkins daemon`. Verbosity is one of `"default"`, `"thinking"`, `"verbose"`. |
| `run` | `run(): Promise<RunResult>` | Execute the pipeline once. The CLI calls this; you can call it directly from a script. |
| `runFromState` | `runFromState(state: RunState, sandboxHandle, deps?): Promise<RunResult>` | Resume a serialized run. The CLI's `resume` subcommand calls this. |

### Example: a single-step agent

```ts
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import { DEFAULT_CHECKS, defaultFixer, defaultSummaryWriter, GUIDELINES_PATH } from "../_shared/presets.js";

const builder = new AgentBuilder("dep-bump", "Bump a single npm dep and run the gate.", gitWorktreeSandbox())
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem("./prompts/dep-bump.md")
      .withUserMessageFromOption("userMessage", {
        required: true,
        description: "Markdown file naming the package and target version",
      }),
  )
  .addDeterministic([...DEFAULT_CHECKS], { loop: { maxIterations: 3, fixer: defaultFixer() } })
  .summaryWriter(defaultSummaryWriter());

registry.register(builder);
export { builder };
```

### `OptionSchema`

Every CLI flag has a schema. Most agents only ever declare one flag, `userMessage`, indirectly via `withUserMessageFromOption`.

```ts
export interface OptionSchema {
  type: "string" | "boolean" | "number" | "string[]";
  required?: boolean;
  description: string;
  default?: string | boolean | number | string[];
}
```

The CLI auto-converts camelCase option names to kebab-case flags: `userMessage` becomes `--user-message`. `string[]` flags become repeatable variadic args (`--target a b c`). Booleans are presence-only (no value). String defaults are wired into commander's option default; required strings use `requiredOption`.

## `Prompt` full surface

A `Prompt` is a system prompt + a user prompt fragment list. The system can be one or more files; the user prompt can mix literal text and option-driven fragments.

```ts
import { Prompt } from "@serranolabs.io/munchkins-core";

const prompt = new Prompt("./prompts/agent-guidelines.md") // optional first system path
  .withSystem("./prompts/your-agent.md")                    // append another system path
  .withUserMessage("Refactor only files touched in the previous step.")
  .withUserMessageFromOption("userMessage", {
    required: true,
    description: "Markdown file describing the work",
  });
```

| Method | Signature | What it does |
|--------|-----------|--------------|
| `new Prompt(systemPath?)` | `(systemPath?: string)` | Optionally seed with one system prompt file. |
| `withSystem` | `withSystem(path: string): this` | Append another system prompt file. Concatenated with `\n\n` at resolve time. |
| `withUserMessage` | `withUserMessage(text: string): this` | Append a literal text fragment to the user prompt. |
| `withUserMessageFromOption` | `withUserMessageFromOption(optionName: string, declaration?: OptionDeclaration): this` | Append a fragment whose value is read at run time from the named CLI option. The auto-declaration on `.add()` registers the option for you. |
| `fragments` | `get fragments(): readonly Fragment[]` | Read-only view of the user-prompt fragments. Used by `AgentBuilder` to harvest option declarations. |

### Path-vs-literal resolution

Both system paths and option-driven user-message fragments resolve identically:

- Absolute paths are read from disk.
- Relative paths are joined to `repoRoot` (resolved at the call site).
- For option-driven fragments, if the value resolves to an existing file path, the file's contents are used; otherwise the value itself is the prompt.

That last rule is what lets `--user-message="Fix add() in src/math.ts"` work alongside `--user-message=./scratch/bug.md` with no schema change.

### The `__MUNCHKINS_OPT_<name>` env channel

Options reach the agent via environment variables prefixed with `__MUNCHKINS_OPT_`. The CLI sets them right before calling `builder.run()`; `Prompt.resolve()` reads them at prompt-construction time. The exported constant is `OPTION_ENV_PREFIX`. You only need to know about this if you're wrapping the framework — most authors never touch the env channel directly.

## Registration

```ts
registry.register(builder);
```

Call it once per agent at module top level. The registry rejects duplicate names. The `registry` export is a singleton — every package importing `@serranolabs.io/munchkins-core` shares it, which is why a side-effect import is enough to wire your agent into `--help`.

If you're testing or composing agents and need to overwrite an existing registration, `registry.replace(builder)` swaps without throwing. Use sparingly.

## Sandboxes

The default sandbox is `gitWorktreeSandbox()`. It cuts a fresh `.worktrees/<agent>-<ts>-<uuid>` checkout from `repoRoot`, exposes the resulting cwd to every step, and on success removes the directory and deletes the branch. On failure, it preserves both for inspection.

Three environment variables are injected into every agent step:

- `WORKTREE` — absolute path to the worktree.
- `BRANCH` — current branch name (the agent renames it to `agent/<slug>-<short-id>` before steps start).
- `REPO_ROOT` — absolute path to the repo root the worktree was cut from.

Use these in your prompts to point the model at the right place: `Commit on $BRANCH with a message that names …`.

For advanced cases, `SandboxFactory` is the interface to implement:

```ts
export interface SandboxFactory {
  create(agentName: string, repoRoot: string): Promise<SandboxHandle>;
  rehydrate?(state: SandboxState, repoRoot: string): Promise<SandboxHandle>;
}
```

A `rehydrate` implementation is required for `munchkins resume` to work against your sandbox. The shipped `gitWorktreeSandbox()` implements both.

## Integration strategies

The agent's branch has to land somewhere. Strategy resolution order: operator's `--integrate` flag → author's `.integrate(strategy)` declaration → run-layer default (`integrateMerge`).

```ts
import { integrateMerge, integratePR } from "@serranolabs.io/munchkins-core";

builder.integrate(integrateMerge());                                // explicit default
builder.integrate(integratePR());                                   // open a PR
builder.integrate(integratePR({ provider: "gitlab", remote: "origin" })); // pin provider
```

**`integrateMerge()`** rebases the worktree branch onto the base branch (with up to 3 merge-fixer iterations on conflicts) and fast-forwards the base branch.

**`integratePR()`** does the same rebase, then `git push -u <remote> <branch>` and opens a PR via `gh` (GitHub) or `glab` (GitLab). Provider defaults to `"auto"`, which calls `detectProvider(repoRoot, remote)` — that returns `"gitlab"` if the remote URL contains `gitlab` and `"github"` otherwise. Override with `provider: "github" | "gitlab"`.

The PR's title is the summary writer's commit message; its body is the markdown changelog entry. The PR URL is returned in the `IntegrationResult` and printed in the PASS line.

## Deterministic checks + fixer

The default bundle ships three reusable presets out of `packages/munchkins/agents/_shared/presets.ts`:

```ts
export const DEFAULT_CHECKS: readonly string[] = [
  "bun run lint:fix",
  "bun run lint",
  "bun run typecheck",
  "bun run scenario",
  "bun test --pass-with-no-tests",
];

export function defaultFixer(): Prompt {
  return new Prompt(DETERMINISTIC_FIXER_PATH);
}

export function defaultSummaryWriter(): Prompt {
  return new Prompt(GUIDELINES_PATH).withSystem(SUMMARY_WRITER_PATH);
}
```

`DEFAULT_CHECKS` is exported as `readonly`; spread it (`[...DEFAULT_CHECKS]`) when handing it to `addDeterministic`, which expects a mutable array. Override the loop's max iterations or fixer prompt by passing your own:

```ts
.addDeterministic([...DEFAULT_CHECKS, "bun run e2e"], {
  loop: { maxIterations: 5, fixer: new Prompt("./prompts/my-fixer.md") },
})
```

`defaultSummaryWriter()` returns a `Prompt` that prepends `agent-guidelines.md` to `summary-writer.md`. Replace it with your own when you want a different output format — but bear in mind that `parseSummaryWriterJson` expects a specific JSON envelope. The shipped writer prompt produces it; a custom writer must too.

## Composition with `.thenRun()`

`thenRun()` concatenates two builders into a new one and **strips** the sandbox, summary writer, and integration. The caller must reattach them. Reference example: `packages/munchkins/agents/bugfix-then-refactor/bugfix-then-refactor-agent.ts`:

```ts
import { AgentBuilder, gitWorktreeSandbox, Prompt } from "@serranolabs.io/munchkins-core";
import { defaultSummaryWriter } from "../_shared/presets.js";

const a = new AgentBuilder("a", "fix the bug").add(
  new Prompt().withUserMessageFromOption("userMessage", {
    required: true,
    description: "Path to a markdown file describing the bug",
  }),
);

const b = new AgentBuilder("b", "refactor for DRYness").add(
  new Prompt().withUserMessage("Refactor only files touched by the previous step."),
);

export const bugfixThenRefactor = a
  .thenRun(b)
  .rename("bugfix-then-refactor")
  .describe("Fix a bug, then refactor only the files the bug-fix touched.")
  .setSandbox(gitWorktreeSandbox())
  .summaryWriter(defaultSummaryWriter())
  .integrate();
```

Why strip the three concerns? Because composing two agents with two summary writers, two sandboxes, or two integration strategies is almost always a bug. The caller knows which one matters; the framework refuses to guess.

`thenRun()` does **not** mutate either input builder. The original `a` and `b` are still usable. `getStepCount()`, `getSandbox()`, `getSummaryWriter()`, and `getIntegration()` are read-only accessors useful for tests asserting non-mutation.

## Scheduling

Attach `.cron(spec, { userMessage, verbosity })` to your builder, then start the daemon:

```ts
builder.cron("0 2 * * *", {
  userMessage: "./scratch/nightly-target.md",
  verbosity: "default",
});
```

```sh
bun run munchkins daemon
```

The daemon collects every cronned builder in the registry, prints a startup table (next firing time per agent), and arms one timer per agent. When a tick fires, the daemon resets `--verbose` / `--thinking`, sets `--user-message` from the cron config, and calls `builder.run()`. Each builder reschedules itself after its run completes.

Overlap policy: one timer per builder. If a tick fires while the previous run is still in flight, both will execute concurrently. Keep cron specs loose enough that one tick finishes before the next.

## Distributing skills with your bundle

Drop a `skills/<name>/SKILL.md` into your bundle and ship it. Users in any host repo install it into their `.claude/skills` directory:

```sh
bun run munchkins skills install
```

By default this copies every skill bundled with `@serranolabs.io/munchkins` (or your package, if you wrap your own CLI) into `.claude/skills` in the current working directory. Override the destination:

```sh
bun run munchkins skills install --dest ./tools/claude-skills
bun run munchkins skills install -d ./tools/claude-skills
```

The shipped skills include `launch-munchkin` (delegate work to a background agent from inside Claude Code) and `new-munchkin` (scaffold a new agent in a host repo). See `packages/munchkins/skills/launch-munchkin/SKILL.md` and `packages/munchkins/skills/new-munchkin/SKILL.md` for what each one does. After installing, the skills auto-appear in Claude Code's skill list — trigger them with phrases like *"launch a refactor agent on …"* or *"new munchkin"*.

## Worked example

A custom `dep-bump` agent that takes an inline target version, runs a single Claude step, and ships.

`packages/<your-bundle>/agents/dep-bump/dep-bump-agent.ts`:

```ts
import { join } from "node:path";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFixer,
  defaultSummaryWriter,
  GUIDELINES_PATH,
  getAgentPromptsDir,
} from "../_shared/presets.js";

const PROMPTS = getAgentPromptsDir(import.meta.url);

const builder = new AgentBuilder(
  "dep-bump",
  "Bump a single npm dep and run the gate.",
  gitWorktreeSandbox(),
)
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, "dep-bump.md"))
      .withUserMessageFromOption("userMessage", {
        required: true,
        description: "Inline text or markdown path naming the package and target version",
      }),
  )
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(defaultSummaryWriter());

registry.register(builder);
export { builder };
```

`packages/<your-bundle>/agents/dep-bump/prompts/dep-bump.md`:

```md
# dep-bump subagent

You are the dep-bump subagent. The user prompt names a single npm package and
target version.

## Mandate

1. Read the user-message; identify the package name and target version.
2. Update the matching `dependencies` or `devDependencies` entry in the
   nearest `package.json`. Do not change unrelated entries.
3. Run `bun install` so `bun.lock` updates.
4. Commit on `$BRANCH` with a message of the form `chore(deps): bump <pkg> to <version>`.
5. Stop. Do not refactor consumer code; the deterministic gate proves the new
   version still works.

## Out of scope

- Bumping multiple packages in one run.
- Refactoring code that consumes the bumped package.
- Editing lockfiles other than `bun.lock`.
```

Side-effect import in `packages/<your-bundle>/src/index.ts`:

```ts
import "../agents/dep-bump/dep-bump-agent.js";
```

Invoke:

```sh
bun run munchkins dep-bump --user-message="bump zod to 3.23.0"
```

That's the whole agent. ~30 lines of TypeScript, ~12 lines of system prompt, one import line. Everything else — the sandbox, the deterministic gate with retries, the summary writer, the changelog, the resume support, the merge integration — is inherited from the framework.
