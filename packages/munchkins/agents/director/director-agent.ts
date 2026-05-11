import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins-core";
import {
  DEFAULT_CHECKS,
  defaultFixer,
  defaultSummaryWriter,
  GUIDELINES_PATH,
} from "../_shared/presets.js";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(AGENT_DIR, "prompts");
const SCRIPTS = join(AGENT_DIR, "scripts");

const builder = new AgentBuilder(
  "director",
  "Cron-driven orchestrator that triages, plans, and dispatches work via other munchkins.",
  gitWorktreeSandbox(),
)
  // userMessage is the cron tick payload; the daemon also passes it via env.
  // No prompt step reads it directly — the agent's source of truth is
  // PURPOSE.md plus the in-flight survey, not a per-tick user message.
  .option("userMessage", {
    type: "string",
    required: false,
    description:
      "Per-tick payload (default 'tick'); unused by the pipeline but required by the CLI surface.",
    default: "tick",
  })
  .addDeterministic([`bash ${join(SCRIPTS, "inflight-survey.sh")}`])
  .addDeterministic([`bash ${join(SCRIPTS, "repo-survey.sh")}`])
  .add(new Prompt(GUIDELINES_PATH).withSkill("director").withSystem(join(PROMPTS, "triage.md")))
  .add(new Prompt(GUIDELINES_PATH).withSkill("director").withSystem(join(PROMPTS, "spec.md")))
  .add(new Prompt(GUIDELINES_PATH).withSkill("director").withSystem(join(PROMPTS, "plan.md")))
  .addDeterministic([`bash ${join(SCRIPTS, "dispatch.sh")}`])
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(defaultSummaryWriter())
  .handlesDryRun()
  .cron("*/10 * * * *", { userMessage: "tick", verbosity: "thinking" });

registry.register(builder);

export { builder };
