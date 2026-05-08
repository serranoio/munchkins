import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

type Fragment = { kind: "input"; path: string } | { kind: "text"; text: string };

export class Prompt {
  private systemPath?: string;
  private fragments: Fragment[] = [];

  constructor(systemPath?: string) {
    this.systemPath = systemPath;
  }

  withInput(path: string): this {
    this.fragments.push({ kind: "input", path });
    return this;
  }

  withText(text: string): this {
    this.fragments.push({ kind: "text", text });
    return this;
  }

  resolve(repoRoot: string): { systemPrompt: string; userPrompt: string } {
    const abs = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));
    const systemPrompt = this.systemPath ? readFileSync(abs(this.systemPath), "utf-8") : "";
    const userPrompt = this.fragments
      .map((f) => (f.kind === "input" ? readFileSync(abs(f.path), "utf-8") : f.text))
      .join("\n\n");
    return { systemPrompt, userPrompt };
  }
}
