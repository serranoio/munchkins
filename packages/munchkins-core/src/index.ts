export {
  AgentBuilder,
  deriveSlugDeterministic,
  type Fragment,
  getSlugWithRetry,
  OPTION_ENV_PREFIX,
  type OptionDeclaration,
  type OptionSchema,
  Prompt,
  type RunResult,
  SLUG_MAX,
  type SlugFallback,
  type SlugResult,
  type SpawnClaudeOptions,
  type SpawnClaudeResult,
  type SpawnClaudeUsage,
  sanitize,
  spawnClaude,
} from "./builder/index.js";
export { AgentRegistry, registry } from "./registry/index.js";
export { RunLog, type RunSummary } from "./run-log.js";
export {
  gitWorktreeSandbox,
  type SandboxFactory,
  type SandboxHandle,
} from "./sandbox/index.js";
export {
  cleanupWorktree,
  createWorktree,
  deleteBranch,
  listWorktrees,
  renameBranch,
  type WorktreeInfo,
  worktreeExists,
} from "./worktree.js";
