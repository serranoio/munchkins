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

export interface RunCliOptions {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export async function runCli(opts: RunCliOptions): Promise<void> {
  const hasCmux = Bun.which("cmux") !== null;
  if (shouldDelegateToCmux({ argv: opts.argv, env: opts.env, hasCmux })) {
    const { command, workspaceName } = buildCmuxCommand({
      argv: opts.argv,
      cwd: opts.cwd,
      now: Date.now(),
      env: opts.env,
    });
    const agentName = opts.argv[2];
    process.stdout.write(`Launching ${agentName} in cmux workspace: ${workspaceName}\n`);
    const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    process.exit(await proc.exited);
  }

  const argv = opts.argv.filter((a) => a !== "--no-cmux");
  await registry.cli().parseAsync(argv);
}

if (import.meta.main) {
  await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });
}
