import { Command } from "commander";
import type { AgentBuilder, OptionSchema } from "../builder/agent-builder.js";
import { OPTION_ENV_PREFIX } from "../builder/prompt.js";

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function flagSpec(name: string, schema: OptionSchema): string {
  const kebab = camelToKebab(name);
  if (schema.type === "boolean") return `--${kebab}`;
  if (schema.type === "string[]") return `--${kebab} <${kebab}...>`;
  return `--${kebab} <${kebab}>`;
}

function coerceForEnv(value: unknown): string {
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

export class AgentRegistry {
  private agents = new Map<string, AgentBuilder>();

  register(builder: AgentBuilder): void {
    if (this.agents.has(builder.name)) {
      throw new Error(`Agent "${builder.name}" is already registered. Use replace() to overwrite.`);
    }
    this.agents.set(builder.name, builder);
  }

  replace(builder: AgentBuilder): void {
    this.agents.set(builder.name, builder);
  }

  list(): string[] {
    return [...this.agents.keys()];
  }

  get(name: string): AgentBuilder | undefined {
    return this.agents.get(name);
  }

  cli(): Command {
    const program = new Command().name("munchkins").description("Munchkins agent CLI");
    for (const [name, builder] of this.agents) {
      const sub = program.command(name).description(builder.description ?? "");
      sub.option(
        "--dry-run",
        "Print the resolved pipeline (system + user prompts, commands) without invoking Claude or creating a worktree.",
      );
      sub.option(
        "--verbose",
        "Print full step-by-step prompts, command outputs, and streaming Claude output.",
      );
      for (const [flag, schema] of builder.options) {
        const spec = flagSpec(flag, schema);
        if (schema.required) {
          sub.requiredOption(spec, schema.description);
        } else if (schema.default !== undefined) {
          sub.option(spec, schema.description, schema.default as never);
        } else {
          sub.option(spec, schema.description);
        }
      }
      sub.action(async (rawOpts: Record<string, unknown>) => {
        if (rawOpts.dryRun) process.env[`${OPTION_ENV_PREFIX}dryRun`] = "true";
        if (rawOpts.verbose) process.env[`${OPTION_ENV_PREFIX}verbose`] = "true";
        for (const flag of builder.options.keys()) {
          const value = rawOpts[flag];
          if (value === undefined) continue;
          process.env[`${OPTION_ENV_PREFIX}${flag}`] = coerceForEnv(value);
        }
        const result = await builder.run();
        process.exit(result.succeeded ? 0 : 1);
      });
    }
    return program;
  }
}

export const registry = new AgentRegistry();
