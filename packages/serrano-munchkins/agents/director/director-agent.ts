import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder, gitWorktreeSandbox, Prompt, registry } from "@serranolabs.io/munchkins";
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
  "Cron-driven orchestrator that triages, plans, and dispatches work via other munchkins. Reads PURPOSE.md as its north star, picks a vertical slice independent of in-flight work, and hands the slice to feat-small / bug-fix / refactor.",
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
  .addDeterministic([`bun ${join(SCRIPTS, "inflight-survey.ts")}`])
  .addDeterministic([`bun ${join(SCRIPTS, "repo-survey.ts")}`])
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSkill("munchkins:director")
      .withSystem(join(PROMPTS, "triage.md"))
      .withUserMessage(
        "Execute the Triage step per the system prompt. Discover the current run directory via .director/current; read PURPOSE.md, inflight.json, and survey.md; write triage.json (or the idle short-circuit).",
      ),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSkill("munchkins:director")
      .withSystem(join(PROMPTS, "spec.md"))
      .withUserMessage(
        "Execute the Spec step per the system prompt. Discover the current run directory via .director/current; read triage.json; honor the upstream-idle short-circuit; write spec.md.",
      ),
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSkill("munchkins:director")
      .withSystem(join(PROMPTS, "plan.md"))
      .withUserMessage(
        "Execute the Plan step per the system prompt. Discover the current run directory via .director/current; read spec.md; honor the upstream-idle short-circuit; write plan.md.",
      ),
  )
  .addDeterministic([`bun ${join(SCRIPTS, "dispatch.ts")}`])
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(defaultSummaryWriter())
  .handlesDryRun()
  .cron("*/10 * * * *", { userMessage: "tick", verbosity: "thinking" });

registry.register(builder);

export { builder };
