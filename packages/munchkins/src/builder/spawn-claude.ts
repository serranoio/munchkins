import { AgentCLI, type AgentUsage, type SpawnOptions, type SpawnResult } from "./agent-cli.js";

export type SpawnClaudeOptions = SpawnOptions;
export type SpawnClaudeResult = SpawnResult;
export type SpawnClaudeUsage = AgentUsage;

export async function spawnClaude(opts: SpawnClaudeOptions): Promise<SpawnClaudeResult> {
  return AgentCLI.fromEnv().spawn(opts);
}
