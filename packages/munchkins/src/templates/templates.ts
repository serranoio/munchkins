import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentArchetype = "single-step" | "main-refactor" | "main-refactor-tests";
export type SpecKind = "refactor" | "bug" | "feature";

// templates.ts → packages/munchkins/src/templates/templates.ts; templates dir
// is two levels up at packages/munchkins/templates/.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATES_DIR = resolve(PACKAGE_ROOT, "templates");

/** Absolute path to the bundled `templates/` directory. */
export function templatesDir(): string {
  return TEMPLATES_DIR;
}

/** Absolute path to a specific archetype's `agent.ts.<archetype>` template. */
export function agentTemplatePath(archetype: AgentArchetype): string {
  const path = resolve(TEMPLATES_DIR, `agent.ts.${archetype}`);
  if (!existsSync(path)) throw new Error(`agent template missing: ${path}`);
  return path;
}

/** Absolute path to a specific archetype's `skill-body.<archetype>.md` template. */
export function skillBodyTemplatePath(archetype: AgentArchetype): string {
  const path = resolve(TEMPLATES_DIR, `skill-body.${archetype}.md`);
  if (!existsSync(path)) throw new Error(`skill body template missing: ${path}`);
  return path;
}

/** Absolute path to a specific spec kind's `spec-template.<kind>.md`. */
export function specTemplatePath(kind: SpecKind): string {
  const path = resolve(TEMPLATES_DIR, `spec-template.${kind}.md`);
  if (!existsSync(path)) throw new Error(`spec template missing: ${path}`);
  return path;
}

/** Absolute path to the cron-overlay template (chained onto an agent template). */
export function cronOverlayPath(): string {
  const path = resolve(TEMPLATES_DIR, "agent.ts.cron-overlay");
  if (!existsSync(path)) throw new Error(`cron overlay template missing: ${path}`);
  return path;
}

/**
 * Read a template file and substitute `{{key}}` slots. Unmatched slots are
 * left intact so callers can spot incomplete substitutions in the output.
 */
export function fillTemplate(path: string, slots: Record<string, string>): string {
  const raw = readFileSync(path, "utf-8");
  return raw.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return Object.hasOwn(slots, key) ? slots[key] : match;
  });
}

/**
 * Archetype → default spec kind mapping. Matches the brief: single-step →
 * refactor, main + refactor → bug, main + refactor + tests → feature.
 */
export function specKindForArchetype(archetype: AgentArchetype): SpecKind {
  if (archetype === "single-step") return "refactor";
  if (archetype === "main-refactor") return "bug";
  return "feature";
}
