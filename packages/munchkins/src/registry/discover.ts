import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Glob `<dir>/**\/*-agent.ts` (and `.js`) relative to either an absolute path
 * or the caller's source URL, then dynamic-import each match. Each agent file
 * is expected to call `registry.register(builder)` at module top-level — the
 * side effect is what wires it into the CLI. Replaces hand-maintained
 * side-effect import blocks in bundle entry files.
 */
export async function discoverAgents(dir: string, fromImportUrl?: string): Promise<string[]> {
  const baseDir = _resolveBaseDir(dir, fromImportUrl);
  const glob = new Bun.Glob("**/*-agent.{ts,js}");
  const matches: string[] = [];
  for await (const rel of glob.scan({ cwd: baseDir, absolute: true })) {
    matches.push(rel);
  }
  matches.sort();
  for (const path of matches) {
    await import(path);
  }
  return matches;
}

function _resolveBaseDir(dir: string, fromImportUrl?: string): string {
  if (isAbsolute(dir)) return dir;
  if (fromImportUrl) {
    const callerDir = dirname(_fileUrlToPath(fromImportUrl));
    return resolve(callerDir, dir);
  }
  return resolve(process.cwd(), dir);
}

function _fileUrlToPath(url: string): string {
  if (url.startsWith("file://")) return new URL(url).pathname;
  return url;
}
