export {
  AgentBuilder,
  type Fragment,
  OPTION_ENV_PREFIX,
  type OptionDeclaration,
  type OptionSchema,
  Prompt,
  type RunResult,
  type SpawnClaudeOptions,
  type SpawnClaudeResult,
  spawnClaude,
} from "./builder/index.js";
export { AgentRegistry, registry } from "./registry/index.js";
export {
  cleanupWorktree,
  createWorktree,
  deleteBranch,
  listWorktrees,
  type WorktreeInfo,
  worktreeExists,
} from "./worktree.js";
