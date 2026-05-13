import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import { GUIDELINES_PATH } from "../_shared/presets.js";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(AGENT_DIR, "prompts");
const SCRIPTS = join(AGENT_DIR, "scripts");

const builder = new AgentBuilder(
  "issue-fixer",
  "Cron-driven munchkin that scans bot:fix-me-labeled GitHub issues and dispatches a child munchkin to land the fix as a PR.",
  gitWorktreeSandbox(),
)
  // userMessage is the cron tick payload; the pipeline doesn't read it.
  // Source of truth is the GitHub issue list, not a per-tick string.
  .option("userMessage", {
    type: "string",
    required: false,
    description:
      "Per-tick payload (default 'tick'); unused by the pipeline but required by the CLI surface.",
    default: "tick",
  })
  .addDeterministic([`bash ${join(SCRIPTS, "survey.sh")}`])
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSkill("munchkins:issue-fixer")
      .withSystem(join(PROMPTS, "triage.md")),
  )
  .addDeterministic([`bash ${join(SCRIPTS, "dispatch.sh")}`])
  .handlesDryRun()
  .cron("*/15 * * * *", { userMessage: "tick", verbosity: "thinking" });

registry.register(builder);

export { builder };
