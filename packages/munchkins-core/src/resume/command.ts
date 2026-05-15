import type { AgentRegistry } from "../registry/registry.js";
import { runResume } from "./run-resume.js";

export function registerResumeCommand(registry: AgentRegistry): void {
  registry.registerCommand({
    name: "resume",
    description: "Resume a previously interrupted agent run.",
    configure: (cmd) => {
      cmd.option("--list", "List resumable runs (default when no runId given).");
      cmd.option("--latest", "Resume the most recently started run.");
      cmd.argument("[runId]", "Run id or slug to resume.");
      cmd.action(async (runId: string | undefined, opts: { list?: boolean; latest?: boolean }) => {
        const argv: string[] = [];
        if (opts.list) argv.push("--list");
        else if (opts.latest) argv.push("--latest");
        else if (runId) argv.push(runId);
        const result = await runResume(argv);
        process.exit(result.exitCode);
      });
    },
  });
}
