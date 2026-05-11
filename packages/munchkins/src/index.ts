#!/usr/bin/env bun
export * from "@serranolabs.io/munchkins-core";
import "../agents/bugfix/bugfix-agent.js";
import "../agents/director/director-agent.js";
import "../agents/feat-small/feat-small-agent.js";
import "../agents/refactor/refactor-agent.js";
import { buildCmuxCommand, shouldDelegateToCmux } from "./cmux-launcher.js";

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
  const { registry } = await import("@serranolabs.io/munchkins-core");
  if (argv[2] === "daemon") {
    const { runDaemon } = await import("@serranolabs.io/munchkins-core");
    await runDaemon();
  } else if (argv[2] === "resume") {
    const { runResume } = await import("@serranolabs.io/munchkins-core");
    const result = await runResume(argv.slice(3));
    process.exit(result.exitCode);
  } else if (argv[2] === "status") {
    const { runStatus } = await import("@serranolabs.io/munchkins-core");
    const result = await runStatus(argv.slice(3));
    process.exit(result.exitCode);
  } else if (argv[2] === "skills" && argv[3] === "install") {
    const { runSkillsInstall } = await import("./skills-install.js");
    runSkillsInstall(argv.slice(4));
  } else {
    await registry.cli().parseAsync(argv);
  }
}
