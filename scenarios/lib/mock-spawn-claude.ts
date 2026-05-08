import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SpawnClaudeMockResponse {
  exitCode: number;
  output: string;
  durationMs: number;
}

export interface MockCallEntry {
  index: number;
  bytesRead: number;
}

const callLog: MockCallEntry[] = [];
const claudeAttempts: string[][] = [];

let responsesDir = "";
let responseFiles: string[] = [];
let nextIndex = 0;

export function configureMock(dir: string): void {
  responsesDir = dir;
  responseFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  nextIndex = 0;
  callLog.length = 0;
}

export async function spawnClaudeMock(): Promise<SpawnClaudeMockResponse> {
  if (nextIndex >= responseFiles.length) {
    throw new Error(
      `mock fixture exhausted: spawnClaude invoked ${nextIndex + 1} times but only ${responseFiles.length} canned responses are available`,
    );
  }
  const file = responseFiles[nextIndex];
  const raw = readFileSync(join(responsesDir, file), "utf-8");
  const parsed = JSON.parse(raw) as SpawnClaudeMockResponse;
  callLog.push({ index: nextIndex, bytesRead: raw.length });
  nextIndex += 1;
  return parsed;
}

export function getMockCallLog(): MockCallEntry[] {
  return [...callLog];
}

export function getExpectedMockCallCount(): number {
  return responseFiles.length;
}

export function setupAuditGuard(): void {
  const originalSpawn = Bun.spawn.bind(Bun);
  type SpawnArg = string[] | { cmd?: string[] };
  (Bun as { spawn: (cmd: SpawnArg, opts?: unknown) => unknown }).spawn = (
    cmd: SpawnArg,
    opts?: unknown,
  ) => {
    const argv = Array.isArray(cmd) ? cmd : Array.isArray(cmd?.cmd) ? cmd.cmd : [];
    if (argv[0] === "claude") {
      claudeAttempts.push(argv);
      throw new Error(`MOCK GUARD: real \`claude\` invocation attempted: ${argv.join(" ")}`);
    }
    return (originalSpawn as (c: SpawnArg, o?: unknown) => unknown)(cmd, opts);
  };
}

export function getClaudeAttempts(): string[][] {
  return [...claudeAttempts];
}
