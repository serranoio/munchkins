import type { AgentRegistry } from "../registry/registry.js";
import { runDaemon } from "./daemon.js";

export function registerDaemonCommand(registry: AgentRegistry): void {
  registry.registerCommand({
    name: "daemon",
    description: "Run cron-armed builders on their schedules.",
    configure: (cmd) => {
      cmd.action(async () => {
        await runDaemon();
      });
    },
  });
}
