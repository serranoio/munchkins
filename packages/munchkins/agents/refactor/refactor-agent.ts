import { join } from "node:path";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFixer,
  GUIDELINES_PATH,
  getAgentPromptsDir,
} from "../_shared/presets.js";

const PROMPTS = getAgentPromptsDir(import.meta.url);

const builder = new AgentBuilder(
  "refactor",
  "Refactor a target for DRY violations and clarity.",
  gitWorktreeSandbox(),
)
  .option("branchPrefix", {
    type: "string",
    required: false,
    description: "Branch namespace prefix; defaults to 'agent'",
  })
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSkill("munchkins:refactor")
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
