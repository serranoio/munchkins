import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFinalize,
  defaultFixer,
  GUIDELINES_PATH,
} from "../_shared/presets.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

const builder = new AgentBuilder("refactor", "Refactor a target for DRY violations and clarity.")
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
  .finalize([], defaultFinalize("refactor"));

registry.register(builder);

export { builder };
