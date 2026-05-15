#!/usr/bin/env bun
export * from "@serranolabs.io/munchkins-core";
import "../agents/bugfix/bugfix-agent.js";
import "../agents/director/director-agent.js";
import "../agents/feat-small/feat-small-agent.js";
import "../agents/refactor/refactor-agent.js";
import { registry } from "@serranolabs.io/munchkins-core";
import { buildCmuxCommand, shouldDelegateToCmux } from "./cmux-launcher.js";
import { registerSkillsCommand } from "./register-skills-command.js";

registerSkillsCommand(registry);

if (import.meta.main) {
  const hasCmux = Bun.which("cmux") !== null;
  if (shouldDelegateToCmux({ argv: process.argv, env: process.env, hasCmux })) {
    const { command, workspaceName } = buildCmuxCommand({
      argv: process.argv,
      cwd: process.cwd(),
      now: Date.now(),
    });
    const agentName = process.argv[2];
    process.stdout.write(`Launching ${agentName} in cmux workspace: ${workspaceName}\n`);
    const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    process.exit(await proc.exited);
  }

  const argv = process.argv.filter((a) => a !== "--no-cmux");
  await registry.cli().parseAsync(argv);
}
