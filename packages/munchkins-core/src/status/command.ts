import type { AgentRegistry } from "../registry/registry.js";
import { runStatus } from "./run-status.js";

export function registerStatusCommand(registry: AgentRegistry): void {
  registry.registerCommand({
    name: "status",
    description: "Show running munchkins.",
    configure: (cmd) => {
      cmd.option("--json", "Emit machine-readable JSON instead of the table.");
      cmd.action(async (opts: { json?: boolean }) => {
        const result = await runStatus(opts.json ? ["--json"] : []);
        process.exit(result.exitCode);
      });
    },
  });
}
