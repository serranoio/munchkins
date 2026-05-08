import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prompt } from "@serranolabs.io/munchkins-core";

const SHARED_PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

export const GUIDELINES_PATH = join(SHARED_PROMPTS, "agent-guidelines.md");
export const DETERMINISTIC_FIXER_PATH = join(SHARED_PROMPTS, "deterministic-fixer.md");

export const DEFAULT_CHECKS: readonly string[] = [
  "bun run lint",
  "bun run typecheck",
  "bun run scenario",
];

export function defaultFixer(): Prompt {
  return new Prompt(DETERMINISTIC_FIXER_PATH);
}

export function defaultFinalize(agentName: string): {
  onPass: string[];
  onFail: string[];
} {
  return {
    onPass: [
      'git merge --no-ff "$BRANCH"',
      'git worktree remove "$WORKTREE"',
      'git branch -D "$BRANCH"',
    ],
    onFail: [
      `echo "${agentName} pipeline failed: $FAILURE_REASON"`,
      'echo "branch $BRANCH preserved at $WORKTREE for manual inspection"',
    ],
  };
}
