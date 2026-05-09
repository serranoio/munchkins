export * from "@serranolabs.io/munchkins-core";
import "../agents/bugfix/bugfix-agent.js";
import "../agents/feat-small/feat-small-agent.js";
import "../agents/refactor/refactor-agent.js";

if (import.meta.main) {
  const { registry } = await import("@serranolabs.io/munchkins-core");
  await registry.cli().parseAsync(process.argv);
}
