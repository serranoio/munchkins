import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentBuilder } from "./agent-builder.js";
import { Prompt } from "./prompt.js";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_DIR = join(PACKAGE_DIR, "..", "..", "docs", "subagents");

const DEFAULT_FINALIZE_ON_PASS = [
  'git merge --no-ff "$BRANCH"',
  'git branch -D "$BRANCH"',
  'git worktree remove "$WORKTREE"',
];

const DEFAULT_FINALIZE_ON_FAIL = [
  'echo "bug-fix pipeline failed: $FAILURE_REASON"',
  'echo "branch $BRANCH preserved at $WORKTREE for manual inspection"',
];

const DEFAULT_CHECKS = ["bun run lint", "bun run typecheck"];

export interface BugfixAgentOptions {
  focus: string;
  promptDir?: string;
  loopCommands?: {
    scenarios?: string[];
    checks?: string[];
    changelog?: string[];
  };
  finalize?: {
    onPass?: string[];
    onFail?: string[];
  };
}

export function createBugfixAgent(opts: BugfixAgentOptions): AgentBuilder {
  const promptDir = opts.promptDir ?? DEFAULT_PROMPT_DIR;
  const scenarios = opts.loopCommands?.scenarios ?? [];
  const checks = opts.loopCommands?.checks ?? DEFAULT_CHECKS;
  const changelog = opts.loopCommands?.changelog ?? [];
  const onPass = opts.finalize?.onPass ?? DEFAULT_FINALIZE_ON_PASS;
  const onFail = opts.finalize?.onFail ?? DEFAULT_FINALIZE_ON_FAIL;

  const fixer = new Prompt(join(promptDir, "deterministic-fixer.md"));

  const builder = new AgentBuilder("bug-fix")
    .add(new Prompt(join(promptDir, "bug-fix.md")).withInput(opts.focus))
    .add(
      new Prompt(join(promptDir, "refactorer.md")).withText(
        "Refactor only files touched by the previous step. Do not expand scope.",
      ),
    );

  if (scenarios.length > 0) {
    builder.addDeterministic(scenarios, { loop: { maxIterations: 3, fixer } });
  }
  if (checks.length > 0) {
    builder.addDeterministic(checks, { loop: { maxIterations: 3, fixer } });
  }
  if (changelog.length > 0) {
    builder.addDeterministic(changelog, { loop: { maxIterations: 3, fixer } });
  }

  builder.finalize([], { onPass, onFail });

  return builder;
}
