import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder, Prompt, registry } from "@serranolabs.io/munchkins-core";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

const builder = new AgentBuilder("bug-fix", "Fix a bug described in a markdown user-message file.")
  .add(
    new Prompt(join(PROMPTS, "bug-fix.md")).withUserMessageFromOption("userMessage", {
      required: true,
      description: "Path to a markdown file describing the bug",
    }),
  )
  .add(
    new Prompt(join(PROMPTS, "refactorer.md")).withUserMessage(
      "Refactor only files touched by the previous step. Do not expand scope.",
    ),
  )
  .addDeterministic(["bun run lint", "bun run typecheck"], {
    loop: {
      maxIterations: 3,
      fixer: new Prompt(join(PROMPTS, "deterministic-fixer.md")),
    },
  })
  .finalize([], {
    onPass: [
      'git merge --no-ff "$BRANCH"',
      'git worktree remove "$WORKTREE"',
      'git branch -D "$BRANCH"',
    ],
    onFail: [
      'echo "bug-fix pipeline failed: $FAILURE_REASON"',
      'echo "branch $BRANCH preserved at $WORKTREE for manual inspection"',
    ],
  });

registry.register(builder);

export { builder };
