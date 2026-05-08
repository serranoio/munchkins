import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ChangelogEntry {
  commit?: string;
  type:
    | "config_tune"
    | "strategy_add"
    | "signal_add"
    | "flow_add"
    | "bug_fix"
    | "refactor"
    | "other";
  agent: string;
  title: string;
  problem: string;
  example?: string;
  impact?: string;
  verification?: string;
  filesChanged?: string[];
  rateBefore?: number;
  rateAfter?: number;
}

const CHANGELOG_PATH = "docs/docs/changelog/index.md";
const CHANGELOG_HEADER = `# Changelog

This changelog tracks all autonomous agent changes to the flow detection system.

---

`;

/**
 * Format type label for display
 */
function formatType(type: string): string {
  const labels: Record<string, string> = {
    config_tune: "Config Tuning",
    strategy_add: "Strategy Added",
    signal_add: "Signal Added",
    flow_add: "Flow Added",
    bug_fix: "Bug Fix",
    refactor: "Refactor",
    other: "Other",
  };
  return labels[type] || type;
}

function getCommitTimestamp(): Date {
  try {
    const iso = execSync("git log -1 --format=%cI HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (!iso) throw new Error("empty git output");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`unparseable: ${iso}`);
    return d;
  } catch (err) {
    console.warn(
      `[changelog] failed to read HEAD commit time, using current time: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return new Date();
  }
}

function formatPacificTimestamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";

  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")} ${get("timeZoneName")}`;
}

export function formatEntry(entry: ChangelogEntry): string {
  const timestampStr = formatPacificTimestamp(getCommitTimestamp());

  let sections = `## ${timestampStr} — ${entry.title}

**Commit:** \`${entry.commit || "pending"}\`
**Type:** ${formatType(entry.type)}
**Agent:** ${entry.agent.charAt(0).toUpperCase() + entry.agent.slice(1)}

### What Was Wrong

${entry.problem}
`;

  if (entry.example) {
    sections += `
### Concrete Example

${entry.example}
`;
  }

  if (entry.impact) {
    sections += `
### Impact

${entry.impact}
`;
  }

  if (entry.verification) {
    sections += `
### Verification

${entry.verification}
`;
  }

  if (entry.filesChanged && entry.filesChanged.length > 0) {
    sections += `
### Files Changed

${entry.filesChanged.map((f) => `- \`${f}\``).join("\n")}
`;
  }

  if (entry.rateBefore !== undefined && entry.rateAfter !== undefined) {
    const delta = entry.rateAfter - entry.rateBefore;
    const sign = delta >= 0 ? "+" : "";
    sections += `
### Tradeable Rate

${entry.rateBefore.toFixed(1)}% → ${entry.rateAfter.toFixed(1)}% (${sign}${delta.toFixed(1)}%)
`;
  }

  return (
    sections +
    `
---

`
  );
}

/**
 * Get the path to the changelog file
 */
function getChangelogPath(): string {
  // Find repo root by looking for package.json
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, "package.json"))) {
      return join(dir, CHANGELOG_PATH);
    }
    dir = dirname(dir);
  }
  return join(process.cwd(), CHANGELOG_PATH);
}

/**
 * Ensure changelog file exists with header
 */
function ensureChangelog(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, CHANGELOG_HEADER);
  }
}

/**
 * Append a changelog entry (prepends after header)
 */
export async function appendChangelog(entry: ChangelogEntry): Promise<void> {
  const path = getChangelogPath();
  ensureChangelog(path);

  const content = readFileSync(path, "utf-8");
  const formatted = formatEntry(entry);

  // Find end of header (after first ---)
  const headerEnd = content.indexOf("---\n") + 4;
  const header = content.slice(0, headerEnd);
  const rest = content.slice(headerEnd);

  // Insert new entry after header
  const newContent = `${header}\n${formatted}${rest}`;
  writeFileSync(path, newContent);
}

/**
 * Read the current changelog
 */
export function readChangelog(): string {
  const path = getChangelogPath();
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf-8");
}
