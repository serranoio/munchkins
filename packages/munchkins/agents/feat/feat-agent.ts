import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFixer,
  defaultSummaryWriter,
  GUIDELINES_PATH,
} from "../_shared/presets.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
const BUGFIX_PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "bugfix", "prompts");

const builder = new AgentBuilder(
  "feat",
  "Implement a new feature described in a markdown user-message file.",
  gitWorktreeSandbox(),
)
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, "feat.md"))
      .withUserMessageFromOption("userMessage", {
        required: true,
        description: "Path to a markdown file (or inline text) describing the feature",
      }),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(BUGFIX_PROMPTS, "refactorer.md"))
      .withUserMessage("Refactor only files touched by the previous step. Do not expand scope."),
  )
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(defaultSummaryWriter());

registry.register(builder);

export { builder };
