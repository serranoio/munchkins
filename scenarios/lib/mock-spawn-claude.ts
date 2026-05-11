import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

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

const SLUG_OUTPUT = "scenario-bug-fix";

export async function spawnClaudeMock(opts: {
  cwd: string;
  model?: string;
  disallowedTools?: string[];
}): Promise<SpawnClaudeMockResponse> {
  // Slug-derivation calls are dispatched outside the agent-step fixture queue.
  if (opts.model === "haiku") {
    return { exitCode: 0, output: SLUG_OUTPUT, durationMs: 0 };
  }
  if (nextIndex >= responseFiles.length) {
    throw new Error(
      `mock fixture exhausted: spawnClaude invoked ${nextIndex + 1} times but only ${responseFiles.length} canned responses are available`,
    );
  }
  const file = responseFiles[nextIndex];
  const raw = readFileSync(join(responsesDir, file), "utf-8");
  const parsed = JSON.parse(raw) as SpawnClaudeMockResponse;
  const index = nextIndex;
  callLog.push({ index, bytesRead: raw.length });
  nextIndex += 1;

  const marker = `__mock_${index}_${file.replace(/\.json$/, "")}.txt`;
  await Bun.write(join(opts.cwd, marker), `mock invocation ${index}\n`);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "mock",
    GIT_AUTHOR_EMAIL: "mock@local",
    GIT_COMMITTER_NAME: "mock",
    GIT_COMMITTER_EMAIL: "mock@local",
  };
  await $`git add ${marker}`.cwd(opts.cwd).env(env).quiet();
  await $`git commit -m ${`mock-${index}: ${file}`}`.cwd(opts.cwd).env(env).quiet();

  return parsed;
}

export function getMockCallLog(): MockCallEntry[] {
  return [...callLog];
}

export function getExpectedMockCallCount(): number {
  return responseFiles.length;
}

export function getResponseFileNames(): string[] {
  return [...responseFiles];
}

export function getSlugOutput(): string {
  return SLUG_OUTPUT;
}

export function setupAuditGuard(): void {
  const originalSpawn = Bun.spawn.bind(Bun);
  type SpawnArg = string[] | { cmd?: string[] };
  (Bun as { spawn: (cmd: SpawnArg, opts?: unknown) => unknown }).spawn = (
    cmd: SpawnArg,
    opts?: unknown,
  ) => {
    const argv = Array.isArray(cmd) ? cmd : Array.isArray(cmd?.cmd) ? cmd.cmd : [];
    if (argv[0] === "claude" || argv[0] === "cmux") {
      claudeAttempts.push(argv);
      throw new Error(`MOCK GUARD: real \`${argv[0]}\` invocation attempted: ${argv.join(" ")}`);
    }
    return (originalSpawn as (c: SpawnArg, o?: unknown) => unknown)(cmd, opts);
  };
}

export function getClaudeAttempts(): string[][] {
  return [...claudeAttempts];
}
