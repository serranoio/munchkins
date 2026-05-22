import type { AgentRegistry } from "./registry.js";

/**
 * Wires `munchkins list-launchable` into the CLI. The launch-munchkin skill
 * uses this to enumerate operator-targetable agents — `--help` still shows
 * everything (including cron-only agents), but launch-munchkin only inspects
 * the launchable subset to avoid offering the director as a target.
 */
export function registerListLaunchableCommand(registry: AgentRegistry): void {
  registry.registerCommand({
    name: "list-launchable",
    description:
      "List agents whose kind is 'launchable' — the operator-targetable agents. Cron-only agents are omitted.",
    configure: (cmd) => {
      cmd.option("--json", "Emit machine-readable JSON instead of plain text.");
      cmd.action((opts: { json?: boolean }) => {
        const names = registry.listLaunchable();
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(names)}\n`);
        } else {
          for (const name of names) process.stdout.write(`${name}\n`);
        }
        process.exit(0);
      });
    },
  });
}
