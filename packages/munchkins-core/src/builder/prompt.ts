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

export class Prompt {
  private systemPaths: string[] = [];
  private _fragments: Fragment[] = [];

  constructor(systemPath?: string) {
    if (systemPath !== undefined) this.systemPaths.push(systemPath);
  }

  withSystem(path: string): this {
    this.systemPaths.push(path);
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
    const systemPrompt = this.systemPaths.map((p) => readFileSync(abs(p), "utf-8")).join("\n\n");
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

export { OPTION_ENV_PREFIX };
