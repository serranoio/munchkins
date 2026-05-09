import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prompt } from "@serranolabs.io/munchkins-core";

const SHARED_PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

export const GUIDELINES_PATH = join(SHARED_PROMPTS, "agent-guidelines.md");
export const DETERMINISTIC_FIXER_PATH = join(SHARED_PROMPTS, "deterministic-fixer.md");
export const SUMMARY_WRITER_PATH = join(SHARED_PROMPTS, "summary-writer.md");

export const DEFAULT_CHECKS: readonly string[] = [
  "bun run lint",
  "bun run typecheck",
  "bun run scenario",
];

export function defaultFixer(): Prompt {
  return new Prompt(DETERMINISTIC_FIXER_PATH);
}

export function defaultSummaryWriter(): Prompt {
  return new Prompt(GUIDELINES_PATH).withSystem(SUMMARY_WRITER_PATH);
}
