import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";
import type { ChangelogEntry } from "./changelog.js";

export interface AgentOptions {
  dryRun?: boolean;
  worktreePath: string;
  /**
   * Absolute path to a markdown file containing run-specific instructions.
   * When set, its contents are injected into the user prompt as a "Current
   * Run Focus" block that overrides the agent's normal bottleneck-selection
   * mandate for this run only. The system prompt is unchanged.
   */
  focusPath?: string;
}

export interface AgentResult {
  exitCode: number;
  output: string;
  improved: boolean;
  changelogEntry?: ChangelogEntry;
  duration: number;
}

const LOGS_DIR = "logs/agents";
const MAX_LOGS_PER_AGENT = 100;

/**
 * Get the root directory of the repository
 */
function getRepoRoot(): string {
  // Walk up from current directory to find .git
  let dir = process.cwd();
  while (dir !== "/") {
    try {
      const gitDir = join(dir, ".git");
      if (Bun.file(gitDir).size !== undefined || readdirSync(gitDir)) {
        return dir;
      }
    } catch {
      // Not found, continue
    }
    dir = dirname(dir);
  }
  return process.cwd();
}

/**
 * Read agent system prompt from docs/subagents/<agent>.md
 */
function readAgentPrompt(agentName: string): string {
  const repoRoot = getRepoRoot();
  const promptPath = join(repoRoot, "docs", "subagents", `${agentName}.md`);

  try {
    return readFileSync(promptPath, "utf-8");
  } catch {
    throw new Error(`Agent prompt not found: ${promptPath}`);
  }
}

/**
 * Clean up old logs, keeping only the most recent MAX_LOGS_PER_AGENT
 */
function cleanupOldLogs(agentName: string): void {
  const repoRoot = getRepoRoot();
  const logsPath = join(repoRoot, LOGS_DIR);

  try {
    const files = readdirSync(logsPath)
      .filter((f) => f.startsWith(`${agentName}-`) && f.endsWith(".log"))
      .sort()
      .reverse();

    // Remove files beyond the limit
    for (const file of files.slice(MAX_LOGS_PER_AGENT)) {
      unlinkSync(join(logsPath, file));
    }
  } catch {
    // Logs directory might not exist yet
  }
}

/**
 * Write agent output to log file
 */
function writeLog(agentName: string, timestamp: number, output: string): string {
  const repoRoot = getRepoRoot();
  const logsPath = join(repoRoot, LOGS_DIR);
  const logFile = join(logsPath, `${agentName}-${timestamp}.log`);

  mkdirSync(logsPath, { recursive: true });
  writeFileSync(logFile, output);

  // Cleanup old logs
  cleanupOldLogs(agentName);

  return logFile;
}

/**
 * Parse structured JSON output from agent
 */
function parseAgentOutput(output: string): {
  improved: boolean;
  changelog?: ChangelogEntry;
} {
  // Strip markdown code fences if present
  let cleanOutput = output;

  // Look for JSON in markdown code block: ```json ... ```
  const codeBlockMatch = output.match(/```(?:json)?\s*(\{[\s\S]*"improved"[\s\S]*\})\s*```/);
  if (codeBlockMatch) {
    cleanOutput = codeBlockMatch[1];
  }

  // Look for JSON block at the end of output
  const jsonMatch = cleanOutput.match(/\{[\s\S]*"improved"[\s\S]*\}(?:\s*)$/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        improved: parsed.improved === true,
        changelog: parsed.changelog,
      };
    } catch {
      // JSON parsing failed
    }
  }

  // Default: no improvement
  return { improved: false };
}

/**
 * Spawn Claude Code with agent-specific system prompt
 */
export async function spawnAgent(agentName: string, options: AgentOptions): Promise<AgentResult> {
  const startTime = Date.now();
  const timestamp = startTime;

  // Read the agent's system prompt
  const systemPrompt = readAgentPrompt(agentName);

  // Build the command
  const dryRunFlag = options.dryRun ? " This is a dry-run - do not commit or merge." : "";

  let focusBlock = "";
  if (options.focusPath) {
    const focusContent = readFileSync(options.focusPath, "utf-8");
    focusBlock =
      `\n\n--- Current Run Focus (overrides bottleneck selection) ---\n` +
      `The bottleneck for this run has already been diagnosed. Implement ONLY what is described below. ` +
      `Do not profile or pick a different target.\n\n${focusContent}`;
  }

  const userPrompt = `Execute your mandate.${dryRunFlag}${focusBlock} When done, output a JSON object at the end with this format: {"improved": true/false, "changelog": {"type": "...", "agent": "${agentName}", "title": "...", "problem": "..."}}`;

  let output = "";
  let exitCode = 0;

  try {
    // Run claude with streaming JSON output for real-time visibility
    const proc = Bun.spawn(
      [
        "claude",
        "--dangerously-skip-permissions",
        "-p",
        userPrompt,
        "--system-prompt",
        systemPrompt,
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      {
        cwd: options.worktreePath,
        stdout: "pipe",
        stderr: "inherit",
      },
    );

    // Stream stdout to console and capture for parsing
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let finalResult = "";

    for await (const chunk of proc.stdout) {
      const text = decoder.decode(chunk);
      chunks.push(text);
      // Parse and display assistant messages
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                process.stdout.write(block.text);
              } else if (block.type === "tool_use") {
                console.log(`\n[Tool: ${block.name}]`);
              }
            }
          } else if (event.type === "result") {
            if (event.result) {
              finalResult = event.result;
              process.stdout.write(`\n${event.result}`);
            }
          }
        } catch {
          // Not JSON or parsing error, skip
        }
      }
    }

    exitCode = await proc.exited;
    // Use final result for parsing if available
    output = finalResult || chunks.join("");
  } catch (error) {
    output = `Error spawning agent: ${error}`;
    exitCode = 1;
  }

  const duration = Date.now() - startTime;

  // Write log
  const logFile = writeLog(agentName, timestamp, output);
  console.log(`Agent log: ${logFile}`);

  // Parse output for structured data
  const { improved, changelog } = parseAgentOutput(output);

  return {
    exitCode,
    output,
    improved,
    changelogEntry: changelog,
    duration,
  };
}

/**
 * Check if claude CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
  try {
    await $`which claude`.quiet();
    return true;
  } catch {
    return false;
  }
}
