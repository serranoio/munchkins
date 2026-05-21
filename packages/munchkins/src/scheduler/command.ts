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
      cmd
        .command("list")
        .description("List cron-armed builders without arming the daemon.")
        .action(() => {
          const lines: string[] = [];
          for (const name of registry.list()) {
            const cron = registry.get(name)?.getCron();
            if (cron) lines.push(`${name}\t${cron.spec}`);
          }
          if (lines.length === 0) {
            process.stdout.write("(no cron-armed builders registered)\n");
            return;
          }
          process.stdout.write(`${lines.join("\n")}\n`);
        });
    },
  });
}
