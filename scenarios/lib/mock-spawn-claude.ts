import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";

export interface SpawnClaudeMockResponse {
  exitCode: number;
  output: string;
  durationMs: number;
}

interface SpawnClaudeMockFixture extends SpawnClaudeMockResponse {
  /**
   * Optional list of files to write to opts.cwd before returning. The path may
   * contain the literal `<RUN>` placeholder which is replaced with the trimmed
   * contents of `.director/current` at call time. Used by multi-step pipelines
   * whose subsequent steps depend on artifacts the LLM would normally produce.
   */
  writeFiles?: { path: string; content: string }[];
}

export interface MockCallEntry {
  index: number;
  bytesRead: number;
  bucket?: string;
}

export interface ChildSpawnEntry {
  child: string;
  argv: string;
}

const callLog: MockCallEntry[] = [];
const claudeAttempts: string[][] = [];

let responsesDir = "";
// Single-bucket mode: responseFiles is the full ordered list at responsesDir.
let responseFiles: string[] = [];
let nextIndex = 0;
// Multi-bucket mode: bucketFiles is keyed by bucket name; activeBucket selects
// which queue spawnClaudeMock consumes; nextIndex is reset on bucket switch.
let bucketFiles: Map<string, string[]> | undefined;
let activeBucket: string | undefined;

const SLUG_OUTPUT = "scenario-bug-fix";

export function configureMock(dir: string, opts?: { buckets?: string[] }): void {
  responsesDir = dir;
  callLog.length = 0;
  nextIndex = 0;

  if (opts?.buckets && opts.buckets.length > 0) {
    bucketFiles = new Map();
    for (const name of opts.buckets) {
      const files = readdirSync(join(dir, name))
        .filter((f) => f.endsWith(".json"))
        .sort();
      bucketFiles.set(name, files);
    }
    activeBucket = opts.buckets[0];
    responseFiles = [];
  } else {
    bucketFiles = undefined;
    activeBucket = undefined;
    responseFiles = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  }
}

export function useTickBucket(name: string): void {
  if (!bucketFiles) {
    throw new Error("useTickBucket: configureMock was not called with buckets");
  }
  if (!bucketFiles.has(name)) {
    throw new Error(`useTickBucket: unknown bucket "${name}"`);
  }
  activeBucket = name;
  nextIndex = 0;
}

function currentBucketFiles(): { files: string[]; dir: string; bucket?: string } {
  if (bucketFiles && activeBucket) {
    return {
      files: bucketFiles.get(activeBucket) ?? [],
      dir: join(responsesDir, activeBucket),
      bucket: activeBucket,
    };
  }
  return { files: responseFiles, dir: responsesDir };
}

export async function spawnClaudeMock(opts: {
  cwd: string;
  model?: string;
  disallowedTools?: string[];
}): Promise<SpawnClaudeMockResponse> {
  // Slug-derivation calls are dispatched outside the agent-step fixture queue.
  if (opts.model === "haiku") {
    return { exitCode: 0, output: SLUG_OUTPUT, durationMs: 0 };
  }
  const { files, dir, bucket } = currentBucketFiles();
  if (nextIndex >= files.length) {
    throw new Error(
      `mock fixture exhausted: spawnClaude invoked ${nextIndex + 1} times but only ${files.length} canned responses are available in bucket ${bucket ?? "<default>"}`,
    );
  }
  const file = files[nextIndex];
  const raw = readFileSync(join(dir, file), "utf-8");
  const parsed = JSON.parse(raw) as SpawnClaudeMockFixture;
  const index = nextIndex;
  callLog.push({ index, bytesRead: raw.length, bucket });
  nextIndex += 1;

  // A real claude session that exits non-zero hasn't committed anything — the
  // step's commit is the agent's responsibility on success. Mirror that so a
  // mid-pipeline failure leaves a clean worktree (and an unbroken commit graph
  // for the resume path to land on).
  if (parsed.exitCode !== 0) return parsed;

  if (parsed.writeFiles && parsed.writeFiles.length > 0) {
    materializeFixtureFiles(opts.cwd, parsed.writeFiles);
  }

  // Include the bucket name (if any) so markers from successive tick buckets
  // don't collide when their committed contents land on shared parent main.
  const bucketTag = bucket ? `${bucket}_` : "";
  const marker = `__mock_${bucketTag}${index}_${file.replace(/\.json$/, "")}.txt`;
  await Bun.write(join(opts.cwd, marker), `mock invocation ${bucketTag}${index}\n`);
  const env = mockGitEnv();
  await $`git add ${marker}`.cwd(opts.cwd).env(env).quiet();
  await $`git commit -m ${`mock-${bucketTag}${index}: ${file}`}`.cwd(opts.cwd).env(env).quiet();

  return parsed;
}

export function getMockCallLog(): MockCallEntry[] {
  return [...callLog];
}

export function getExpectedMockCallCount(): number {
  if (bucketFiles) {
    let total = 0;
    for (const files of bucketFiles.values()) total += files.length;
    return total;
  }
  return responseFiles.length;
}

export function getResponseFileNames(): string[] {
  return [...responseFiles];
}

export function getSlugOutput(): string {
  return SLUG_OUTPUT;
}

/**
 * Read child-dispatch attempts recorded by the fake-bun shim. Each tab-
 * delimited line in the log is `<child>\t<full-argv-string>`.
 */
export function readDispatchLog(path: string): ChildSpawnEntry[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [child, argv = ""] = line.split("\t");
      return { child, argv };
    });
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

function mockGitEnv(): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "mock",
    GIT_AUTHOR_EMAIL: "mock@local",
    GIT_COMMITTER_NAME: "mock",
    GIT_COMMITTER_EMAIL: "mock@local",
  };
}

function materializeFixtureFiles(cwd: string, files: { path: string; content: string }[]): void {
  let runId = "";
  const currentPath = join(cwd, ".director", "current");
  if (existsSync(currentPath)) {
    runId = readFileSync(currentPath, "utf-8").trim();
  }
  for (const f of files) {
    const path = f.path.replaceAll("<RUN>", runId);
    const abs = join(cwd, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
}
