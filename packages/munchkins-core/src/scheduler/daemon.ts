import { CronExpressionParser } from "cron-parser";
import type { AgentBuilder, CronConfig } from "../builder/agent-builder.js";
import { OPTION_ENV_PREFIX } from "../builder/prompt.js";
import { registry as defaultRegistry } from "../registry/registry.js";

// Overlap policy: this daemon arms one timer per cronned builder. If a tick
// fires while the previous run for the same agent is still in flight, both
// will execute concurrently. That's undefined behavior — keep cron specs
// loose enough that one tick finishes before the next.

interface DaemonDeps {
  registry?: { list(): string[]; get(name: string): AgentBuilder | undefined };
  now?: () => Date;
  // setTimer/clearTimer let tests inject a fake clock; default to Node timers.
  setTimer?: (cb: () => void, ms: number) => unknown;
  // stderr/stdout are kept as parameters so tests can capture output.
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
}

export interface CronnedBuilder {
  builder: AgentBuilder;
  cfg: CronConfig;
}

export function applyTickEnv(cfg: {
  verbosity: CronConfig["verbosity"];
  userMessage: string;
}): void {
  // Reset-then-set: agent A's verbosity must not leak into agent B's tick.
  delete process.env[`${OPTION_ENV_PREFIX}verbose`];
  delete process.env[`${OPTION_ENV_PREFIX}thinking`];
  process.env[`${OPTION_ENV_PREFIX}userMessage`] = cfg.userMessage;
  if (cfg.verbosity === "verbose") {
    process.env[`${OPTION_ENV_PREFIX}verbose`] = "true";
  } else if (cfg.verbosity === "thinking") {
    process.env[`${OPTION_ENV_PREFIX}thinking`] = "true";
  }
}

export function collectCronnedBuilders(registry: {
  list(): string[];
  get(name: string): AgentBuilder | undefined;
}): CronnedBuilder[] {
  const out: CronnedBuilder[] = [];
  for (const name of registry.list()) {
    const builder = registry.get(name);
    if (!builder) continue;
    const cfg = builder.getCron();
    if (!cfg) continue;
    out.push({ builder, cfg });
  }
  return out;
}

function nextTickMs(spec: string, from: Date): { date: Date; deltaMs: number } {
  const it = CronExpressionParser.parse(spec, { currentDate: from });
  const next = it.next().toDate();
  return { date: next, deltaMs: Math.max(0, next.getTime() - from.getTime()) };
}

function humanizeDelta(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m ${s}s`;
  return `in ${s}s`;
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + " ".repeat(w - s.length);
}

function renderStartupTable(rows: CronnedBuilder[], now: Date): string {
  const cols = ["agent", "schedule", "verbosity", "next tick"];
  const data = rows.map(({ builder, cfg }) => {
    const { date, deltaMs } = nextTickMs(cfg.spec, now);
    return [
      builder.name,
      cfg.spec,
      cfg.verbosity,
      `${date.toISOString()} (${humanizeDelta(deltaMs)})`,
    ];
  });
  const widths = cols.map((c, i) => Math.max(c.length, ...data.map((r) => r[i].length)));
  const sep = widths.map((w) => "─".repeat(w)).join("  ");
  const header = cols.map((c, i) => pad(c, widths[i])).join("  ");
  const body = data.map((r) => r.map((cell, i) => pad(cell, widths[i])).join("  "));
  return ["", `  ${header}`, `  ${sep}`, ...body.map((b) => `  ${b}`)].join("\n");
}

export interface RunDaemonOptions extends DaemonDeps {
  // Allow tests to opt out of arming the loop after announcing.
  arm?: boolean;
}

export async function runDaemon(opts: RunDaemonOptions = {}): Promise<void> {
  const registry = opts.registry ?? defaultRegistry;
  const now = opts.now ?? (() => new Date());
  const stderr = opts.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  const stdout = opts.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const setTimer = opts.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown);
  const arm = opts.arm ?? true;

  const rows = collectCronnedBuilders(registry);
  if (rows.length === 0) {
    stderr("[daemon] no cronned builders — nothing to do");
    process.exit(1);
  }

  const startNow = now();
  stdout(`[daemon] munchkins daemon — ${rows.length} cronned builder(s) armed`);
  stdout(renderStartupTable(rows, startNow));
  stdout("");
  stdout("[daemon] ready — Ctrl-C to stop");

  if (!arm) return;

  for (const { builder, cfg } of rows) {
    armNextTick(builder, cfg, { now, setTimer, stdout });
  }
}

interface ArmDeps {
  now: () => Date;
  setTimer: (cb: () => void, ms: number) => unknown;
  stdout: (line: string) => void;
}

function armNextTick(builder: AgentBuilder, cfg: CronConfig, deps: ArmDeps): void {
  const { deltaMs } = nextTickMs(cfg.spec, deps.now());
  deps.setTimer(() => {
    void fireTick(builder, cfg, deps);
  }, deltaMs);
}

async function fireTick(builder: AgentBuilder, cfg: CronConfig, deps: ArmDeps): Promise<void> {
  applyTickEnv(cfg);
  deps.stdout(`[daemon] ${builder.name} tick (${cfg.verbosity})`);
  try {
    await builder.run();
  } catch (err) {
    deps.stdout(`[daemon] ${builder.name} run threw: ${(err as Error).message}`);
  } finally {
    armNextTick(builder, cfg, deps);
  }
}
