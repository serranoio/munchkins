import { join } from "node:path";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFixer,
  GUIDELINES_PATH,
  getAgentPromptsDir,
  REFACTORER_PATH,
  TEST_WRITER_PATH,
} from "../_shared/presets.js";

const PROMPTS = getAgentPromptsDir(import.meta.url);

const builder = new AgentBuilder(
  "feat-small",
  "Implement a new feature described in a markdown user-message file.",
  gitWorktreeSandbox(),
)
  .add(
    new Prompt(GUIDELINES_PATH).withSkill("feat-small").withUserMessageFromOption("userMessage", {
      required: true,
      description: "Path to a markdown file (or inline text) describing the feature",
    }),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(REFACTORER_PATH)
      .withUserMessage("Refactor only files touched by the previous step. Do not expand scope."),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(TEST_WRITER_PATH)
      .withUserMessage(
        "Analyze the diff and add minimal tests for any new public surface. Skip if there is nothing new to test.",
      ),
  )
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "summary-writer.md")));

registry.register(builder);

export { builder };
