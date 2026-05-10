// Example of `.thenRun()` composition. Not registered with the default
// registry — import this module from your own bundle to register it, or copy
// the pattern into a new agent file.
//
// `.thenRun()` strips sandbox / summaryWriter / integration so the composed
// agent has a single, explicit story for those three concerns.
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
