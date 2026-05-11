import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface OptionDeclaration {
  required?: boolean;
  description: string;
  default?: string;
}

export type Fragment =
  | { kind: "text"; text: string }
  | { kind: "input-from-option"; optionName: string; declaration?: OptionDeclaration };

const OPTION_ENV_PREFIX = "__MUNCHKINS_OPT_";

type SystemSource = { kind: "path"; path: string } | { kind: "skill"; name: string; path: string };

export class Prompt {
  private systemSources: SystemSource[] = [];
  private _fragments: Fragment[] = [];

  constructor(systemPath?: string) {
    if (systemPath !== undefined) this.systemSources.push({ kind: "path", path: systemPath });
  }

  withSystem(path: string): this {
    this.systemSources.push({ kind: "path", path });
    return this;
  }

  withSkill(name: string): this {
    this.systemSources.push({
      kind: "skill",
      name,
      path: `.claude/skills/${name}/SKILL.md`,
    });
    return this;
  }

  withUserMessage(text: string): this {
    this._fragments.push({ kind: "text", text });
    return this;
  }

  withUserMessageFromOption(optionName: string, declaration?: OptionDeclaration): this {
    this._fragments.push({ kind: "input-from-option", optionName, declaration });
    return this;
  }

  get fragments(): readonly Fragment[] {
    return this._fragments;
  }

  resolve(repoRoot: string): { systemPrompt: string; userPrompt: string } {
    const abs = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));
    const systemPrompt = this.systemSources
      .map((src) => {
        const absPath = abs(src.path);
        if (src.kind === "skill" && !existsSync(absPath)) {
          throw new Error(
            `Skill '${src.name}' not found at ${src.path}. Run 'bun run munchkins install-skills' to scaffold default skills.`,
          );
        }
        const content = readFileSync(absPath, "utf-8");
        return src.kind === "skill" ? stripFrontmatter(content, absPath) : content;
      })
      .join("\n\n");
    const userPrompt = this._fragments
      .map((f) => {
        if (f.kind === "text") return f.text;
        const value = process.env[`${OPTION_ENV_PREFIX}${f.optionName}`];
        if (!value) {
          throw new Error(
            `Prompt: option "${f.optionName}" not provided (env var ${OPTION_ENV_PREFIX}${f.optionName} not set)`,
          );
        }
        const candidate = abs(value);
        if (existsSync(candidate)) {
          return readFileSync(candidate, "utf-8");
        }
        return value;
      })
      .join("\n\n");
    return { systemPrompt, userPrompt };
  }
}

function stripFrontmatter(content: string, absPath: string): string {
  const opener = /^---\r?\n/.exec(content);
  if (!opener) return content;
  const afterOpen = opener[0].length;
  const closer = /\r?\n---(\r?\n|$)/.exec(content.slice(afterOpen));
  if (!closer) {
    throw new Error(`Skill at ${absPath}: malformed frontmatter (no closing '---' delimiter)`);
  }
  let bodyStart = afterOpen + closer.index + closer[0].length;
  // Strip a single trailing blank line after the closing '---'.
  const trailing = /^\r?\n/.exec(content.slice(bodyStart));
  if (trailing) bodyStart += trailing[0].length;
  return content.slice(bodyStart);
}

export { OPTION_ENV_PREFIX };
