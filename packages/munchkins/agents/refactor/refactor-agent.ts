import { join } from "node:path";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFixer,
  getAgentPromptsDir,
  GUIDELINES_PATH,
} from "../_shared/presets.js";

const PROMPTS = getAgentPromptsDir(import.meta.url);

const builder = new AgentBuilder(
  "refactor",
  "Refactor a target for DRY violations and clarity.",
  gitWorktreeSandbox(),
)
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, "refactor.md"))
      .withUserMessageFromOption("userMessage", {
        required: true,
        description: "Path to a markdown file describing what to refactor",
      }),
  )
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "summary-writer.md")));

registry.register(builder);

export { builder };
