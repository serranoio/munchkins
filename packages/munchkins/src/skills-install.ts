import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");

export function runSkillsInstall(argv: string[]): void {
  const target = resolveTarget(argv);
  if (!existsSync(SKILLS_SRC)) {
    console.error(`✖ no skills bundled at ${SKILLS_SRC}`);
    process.exit(1);
  }

  const skills = readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (skills.length === 0) {
    console.error("✖ no skills to install");
    process.exit(1);
  }

  mkdirSync(target, { recursive: true });
  for (const name of skills) {
    const from = join(SKILLS_SRC, name);
    const to = join(target, name);
    cpSync(from, to, { recursive: true, dereference: true, force: true });
    console.log(`✓ ${name} -> ${to}`);
  }
}

function resolveTarget(argv: string[]): string {
  const flagIdx = argv.findIndex((a) => a === "--dest" || a === "-d");
  if (flagIdx !== -1 && argv[flagIdx + 1]) return resolve(argv[flagIdx + 1]);
  return resolve(process.cwd(), ".claude/skills");
}
