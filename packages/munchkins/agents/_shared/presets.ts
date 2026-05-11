import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type OptionSchema, Prompt } from "@serranolabs.io/munchkins-core";

export function getAgentPromptsDir(importUrl: string): string {
  return join(dirname(fileURLToPath(importUrl)), "prompts");
}

const SHARED_PROMPTS = getAgentPromptsDir(import.meta.url);

export const GUIDELINES_PATH = join(SHARED_PROMPTS, "agent-guidelines.md");
export const DETERMINISTIC_FIXER_PATH = join(SHARED_PROMPTS, "deterministic-fixer.md");
export const REFACTORER_PATH = join(SHARED_PROMPTS, "refactorer.md");
export const SUMMARY_WRITER_PATH = join(SHARED_PROMPTS, "summary-writer.md");
export const TEST_WRITER_PATH = join(SHARED_PROMPTS, "test-writer.md");

export const DEFAULT_CHECKS: readonly string[] = [
  "bun run lint:fix",
  "bun run lint",
  "bun run typecheck",
  "bun run scenario",
  "bun test --pass-with-no-tests",
];

// Shared --branch-prefix declaration for the default agents. Director dispatch
// passes this through to child runs to scope their branches under `director/*`.
export const BRANCH_PREFIX_OPTION: OptionSchema = {
  type: "string",
  required: false,
  description: "Branch namespace prefix; defaults to 'agent'",
};

export function defaultFixer(): Prompt {
  return new Prompt(DETERMINISTIC_FIXER_PATH);
}

export function defaultSummaryWriter(): Prompt {
  return new Prompt(GUIDELINES_PATH).withSystem(SUMMARY_WRITER_PATH);
}
