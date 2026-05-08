#!/usr/bin/env bun
import { Command } from "commander";
import { agentCommand } from "./agent.js";
import { autonomousCommand } from "./autonomous.js";
import { bugfixCommand } from "./bugfix.js";
import { changelogCommand } from "./changelog.js";
import { workflowCommand } from "./workflow.js";

const program = new Command()
  .name("munchkins")
  .description("Autonomous agent infrastructure")
  .version("0.1.0");

program.addCommand(agentCommand);
program.addCommand(workflowCommand);
program.addCommand(autonomousCommand);
program.addCommand(changelogCommand);
program.addCommand(bugfixCommand);

program.parse();
