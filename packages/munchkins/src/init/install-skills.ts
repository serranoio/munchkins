import { cpSync, type Dirent, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@serranolabs.io/munchkins";
// install-skills.ts lives at packages/munchkins/src/init/install-skills.ts; the
// framework's bundled skills/ dir is two levels up.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SkillSource {
  pkgName: string;
  skillsDir: string;
}

interface PlannedInstall {
  slug: string;
  fromDir: string;
}

interface InstallPlan {
  entries: PlannedInstall[];
  warnings: string[];
}

export interface RunSkillsInstallOptions {
  cwd: string;
  target: string;
  packageRoot: string | null;
}

export function runSkillsInstall(argv: string[]): void {
  _runSkillsInstall({
    cwd: process.cwd(),
    target: _resolveTarget(argv, process.cwd()),
    packageRoot: PACKAGE_ROOT,
  });
}

export function _runSkillsInstall(opts: RunSkillsInstallOptions): void {
  const sources = _discoverSources(opts.cwd, opts.packageRoot);
  const plan = _buildInstallPlan(sources);

  if (plan.entries.length === 0) {
    console.error("✖ no skills found in any installed package");
    process.exit(1);
  }

  for (const warning of plan.warnings) console.log(warning);

  mkdirSync(opts.target, { recursive: true });
  const installed: string[] = [];
  const kept: string[] = [];
  for (const entry of plan.entries) {
    const to = join(opts.target, entry.slug);
    if (existsSync(join(to, "SKILL.md"))) {
      kept.push(entry.slug);
      continue;
    }
    cpSync(entry.fromDir, to, { recursive: true, dereference: true });
    installed.push(entry.slug);
  }

  console.log(_formatSummaryLine("installed", `${installed.length} new`, installed));
  if (kept.length > 0) {
    console.log(_formatSummaryLine("kept (already present)", String(kept.length), kept));
  }
}

export function _resolveTarget(argv: string[], cwd: string): string {
  const flagIdx = argv.findIndex((a) => a === "--dest" || a === "-d");
  if (flagIdx !== -1 && argv[flagIdx + 1]) return resolve(argv[flagIdx + 1]);
  return resolve(cwd, ".claude/skills");
}

export function _discoverSources(cwd: string, packageRoot: string | null): SkillSource[] {
  const seen = new Set<string>();
  const sources: SkillSource[] = [];

  if (packageRoot) {
    const ownSkills = join(packageRoot, "skills");
    if (_skillsDirHasAnySkill(ownSkills)) {
      seen.add(_safeRealpath(ownSkills));
      sources.push({ pkgName: PACKAGE_NAME, skillsDir: ownSkills });
    }
  }

  const nodeModulesDir = _findNodeModules(cwd);
  if (!nodeModulesDir) return sources;

  const fromNodeModules = _scanNodeModules(nodeModulesDir);
  fromNodeModules.sort(_compareSourcesByPriority);
  for (const src of fromNodeModules) {
    const real = _safeRealpath(src.skillsDir);
    if (seen.has(real)) continue;
    seen.add(real);
    sources.push(src);
  }
  return sources;
}

function _compareSourcesByPriority(a: SkillSource, b: SkillSource): number {
  if (a.pkgName === PACKAGE_NAME && b.pkgName !== PACKAGE_NAME) return -1;
  if (b.pkgName === PACKAGE_NAME && a.pkgName !== PACKAGE_NAME) return 1;
  if (a.pkgName < b.pkgName) return -1;
  if (a.pkgName > b.pkgName) return 1;
  return 0;
}

function _findNodeModules(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    const candidate = join(dir, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function _scanNodeModules(nodeModulesDir: string): SkillSource[] {
  const out: SkillSource[] = [];
  const entries = _readDirSafe(nodeModulesDir);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      const scopedEntries = _readDirSafe(entryPath);
      for (const scoped of scopedEntries) {
        if (scoped.name.startsWith(".")) continue;
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        _maybeAddPackage(out, `${entry.name}/${scoped.name}`, join(entryPath, scoped.name));
      }
    } else {
      _maybeAddPackage(out, entry.name, entryPath);
    }
  }
  return out;
}

function _maybeAddPackage(out: SkillSource[], pkgName: string, pkgDir: string): void {
  const skillsDir = join(pkgDir, "skills");
  if (_skillsDirHasAnySkill(skillsDir)) {
    out.push({ pkgName, skillsDir });
  }
}

function _skillsDirHasAnySkill(skillsDir: string): boolean {
  if (!existsSync(skillsDir)) return false;
  for (const entry of _readDirSafe(skillsDir)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (existsSync(join(skillsDir, entry.name, "SKILL.md"))) return true;
  }
  return false;
}

function _readDirSafe(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function _safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function _buildInstallPlan(sources: SkillSource[]): InstallPlan {
  interface SlugInfo {
    fromDir: string;
    pkgs: string[];
  }
  const slugMap = new Map<string, SlugInfo>();
  for (const src of sources) {
    for (const entry of _readDirSafe(src.skillsDir)) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const slug = entry.name;
      if (!existsSync(join(src.skillsDir, slug, "SKILL.md"))) continue;
      const existing = slugMap.get(slug);
      if (existing) {
        existing.pkgs.push(src.pkgName);
      } else {
        slugMap.set(slug, { fromDir: join(src.skillsDir, slug), pkgs: [src.pkgName] });
      }
    }
  }

  const warnings: string[] = [];
  const entries: PlannedInstall[] = [];
  for (const [slug, info] of slugMap) {
    if (info.pkgs.length > 1) {
      warnings.push(
        `⚠ slug collision: ${slug} shipped by ${info.pkgs.join(", ")} — first wins; remove from one bundle to disambiguate`,
      );
    }
    entries.push({ slug, fromDir: info.fromDir });
  }
  return { entries, warnings };
}

function _formatSummaryLine(label: string, count: string, names: string[]): string {
  const suffix = names.length > 0 ? ` (${names.join(", ")})` : "";
  return `${label}: ${count}${suffix}`;
}
