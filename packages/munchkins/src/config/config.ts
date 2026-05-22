import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type MunchkinsMode = "source-repo" | "consumer-repo";
export type MunchkinsIntegrate = "merge" | "pr";

export interface MunchkinsConfig {
  mode: MunchkinsMode;
  agentsDir: string;
  skillsDir: string;
  bundleEntry: string;
  integrate: MunchkinsIntegrate;
  agentIndexFile?: string;
  branchPrefix?: string;
}

export const CONFIG_REL_PATH = ".munchkins/config.json";

/**
 * Read `.munchkins/config.json` from `repoRoot` (default: cwd). Returns `null`
 * when the file does not exist. Throws when the file exists but is unparseable
 * or missing required fields — the caller decides whether to treat that as
 * fatal or surface a setup hint.
 */
export function readConfig(repoRoot?: string): MunchkinsConfig | null {
  const path = configPath(repoRoot);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse ${CONFIG_REL_PATH}: ${(err as Error).message}`);
  }
  return _validate(parsed, path);
}

/**
 * Write `.munchkins/config.json` under `repoRoot` (default: cwd), creating
 * the `.munchkins/` directory if absent. Idempotent — overwrites the existing
 * file with the supplied config. Caller is responsible for merging with any
 * pre-existing config they want to preserve.
 */
export function writeConfig(config: MunchkinsConfig, repoRoot?: string): void {
  const path = configPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function _validate(value: unknown, path: string): MunchkinsConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path}: expected an object`);
  }
  const v = value as Record<string, unknown>;
  const mode = v.mode;
  if (mode !== "source-repo" && mode !== "consumer-repo") {
    throw new Error(`${path}: "mode" must be "source-repo" or "consumer-repo" (got ${mode})`);
  }
  const integrate = v.integrate;
  if (integrate !== "merge" && integrate !== "pr") {
    throw new Error(`${path}: "integrate" must be "merge" or "pr" (got ${integrate})`);
  }
  for (const key of ["agentsDir", "skillsDir", "bundleEntry"] as const) {
    if (typeof v[key] !== "string" || (v[key] as string).length === 0) {
      throw new Error(`${path}: "${key}" must be a non-empty string`);
    }
  }
  const out: MunchkinsConfig = {
    mode,
    agentsDir: v.agentsDir as string,
    skillsDir: v.skillsDir as string,
    bundleEntry: v.bundleEntry as string,
    integrate,
  };
  if (typeof v.agentIndexFile === "string") out.agentIndexFile = v.agentIndexFile;
  if (typeof v.branchPrefix === "string") out.branchPrefix = v.branchPrefix;
  return out;
}

/** Absolute path to `.munchkins/config.json` under `repoRoot`. */
export function configPath(repoRoot?: string): string {
  return resolve(repoRoot ?? process.cwd(), CONFIG_REL_PATH);
}

/** Absolute path to the parent `.munchkins/` directory. */
export function configDir(repoRoot?: string): string {
  return dirname(configPath(repoRoot));
}
