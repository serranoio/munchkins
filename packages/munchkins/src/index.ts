export * from "@serranolabs.io/munchkins-core";
import "../agents/bugfix/bugfix-agent.js";
import "../agents/feat-small/feat-small-agent.js";
import "../agents/refactor/refactor-agent.js";

if (import.meta.main) {
  const { registry } = await import("@serranolabs.io/munchkins-core");
  if (process.argv[2] === "daemon") {
    const { runDaemon } = await import("@serranolabs.io/munchkins-core");
    await runDaemon();
  } else {
    await registry.cli().parseAsync(process.argv);
  }
}
