import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { createBugfixAgent } from "../builder/bugfix-agent.js";

export const bugfixCommand = new Command("bugfix")
  .description("Run the bugfix agent on a focus file")
  .requiredOption("--focus <path>", "Path to a markdown file describing the bug")
  .action(async (options: { focus: string }) => {
    const focusPath = resolve(process.cwd(), options.focus);
    if (!existsSync(focusPath)) {
      console.error(`--focus file not found: ${focusPath}`);
      process.exit(1);
    }

    process.env.FOCUS_PATH = focusPath;
    process.env.AGENT_NAME = "bug-fix";

    const builder = createBugfixAgent({ focus: focusPath });
    const result = await builder.run();
    process.exit(result.succeeded ? 0 : 1);
  });
