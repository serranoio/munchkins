import { join } from "node:path";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  BRANCH_PREFIX_OPTION,
  DEFAULT_CHECKS,
  defaultFixer,
  GUIDELINES_PATH,
  getAgentPromptsDir,
} from "../_shared/presets.js";

const PROMPTS = getAgentPromptsDir(import.meta.url);

const builder = new AgentBuilder(
  "refactor",
  "Behavior-preserving refactor of a target via the munchkins refactor agent — runs in a fresh worktree, applies DRY/clarity changes inside the named scope, gates with lint/typecheck/scenario, then merges or opens a PR. Use when the user wants refactoring done via the deterministic agent rather than inline editing.",
  gitWorktreeSandbox(),
)
  .option("branchPrefix", BRANCH_PREFIX_OPTION)
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
  // Per-agent summary writer (not defaultSummaryWriter): requires a per-file
  // lines-before/after table plus a reduction|extraction|other classification.
  .summaryWriter(new Prompt(GUIDELINES_PATH).withSystem(join(PROMPTS, "summary-writer.md")));

registry.register(builder);

export { builder };
