import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  BRANCH_PREFIX_OPTION,
  DEFAULT_CHECKS,
  defaultFixer,
  defaultSummaryWriter,
  GUIDELINES_PATH,
  REFACTORER_PATH,
} from "../_shared/presets.js";

const builder = new AgentBuilder(
  "bug-fix",
  "Fix a bug described in a markdown user-message file.",
  gitWorktreeSandbox(),
)
  .option("branchPrefix", BRANCH_PREFIX_OPTION)
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSkill("munchkins:bug-fix")
      .withUserMessageFromOption("userMessage", {
        required: true,
        description: "Path to a markdown file describing the bug",
      }),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(REFACTORER_PATH)
      .withUserMessage("Refactor only files touched by the previous step. Do not expand scope."),
  )
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(defaultSummaryWriter());

registry.register(builder);

export { builder };
