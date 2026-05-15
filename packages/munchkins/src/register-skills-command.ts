import type { AgentRegistry } from "@serranolabs.io/munchkins-core";
import { runSkillsInstall } from "./skills-install.js";

export function registerSkillsCommand(registry: AgentRegistry): void {
  registry.registerCommand({
    name: "skills",
    description: "Manage munchkin skills.",
    configure: (cmd) => {
      cmd
        .command("install [target]")
        .description(
          "Install bundled skills into the target directory (defaults to .claude/skills).",
        )
        .action((target: string | undefined) => {
          runSkillsInstall(target ? [target] : []);
        });
    },
  });
}
