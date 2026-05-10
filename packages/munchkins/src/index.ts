export * from "@serranolabs.io/munchkins-core";
import "../agents/bugfix/bugfix-agent.js";
import "../agents/feat-small/feat-small-agent.js";
import "../agents/refactor/refactor-agent.js";

if (import.meta.main) {
  const { registry } = await import("@serranolabs.io/munchkins-core");
  if (process.argv[2] === "daemon") {
    const { runDaemon } = await import("@serranolabs.io/munchkins-core");
    await runDaemon();
  } else if (process.argv[2] === "resume") {
    const { runResume } = await import("@serranolabs.io/munchkins-core");
    const result = await runResume(process.argv.slice(3));
    process.exit(result.exitCode);
  } else if (process.argv[2] === "status") {
    const { runStatus } = await import("@serranolabs.io/munchkins-core");
    const result = await runStatus(process.argv.slice(3));
    process.exit(result.exitCode);
  } else if (process.argv[2] === "skills" && process.argv[3] === "install") {
    const { runSkillsInstall } = await import("./skills-install.js");
    runSkillsInstall(process.argv.slice(4));
  } else {
    await registry.cli().parseAsync(process.argv);
  }
}
