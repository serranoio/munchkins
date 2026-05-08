import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { appendChangelog, type ChangelogEntry, readChangelog } from "../changelog.js";

export const changelogCommand = new Command("changelog").description(
  "Manage the autonomous changelog",
);

changelogCommand
  .command("append")
  .description("Append an entry to the changelog")
  .option("--input <path>", "JSON file with entry data")
  .option("--type <type>", "Change type")
  .option("--agent <agent>", "Agent that made the change")
  .option("--title <title>", "Short title for the change")
  .option("--problem <problem>", "What was wrong or what needed to change")
  .option("--rate-before <rate>", "Rate before change")
  .option("--rate-after <rate>", "Rate after change")
  .action(async (options) => {
    let entry: ChangelogEntry;

    if (options.input) {
      const content = readFileSync(options.input, "utf-8");
      entry = JSON.parse(content);
    } else if (options.type && options.agent && options.title && options.problem) {
      entry = {
        type: options.type,
        agent: options.agent,
        title: options.title,
        problem: options.problem,
        rateBefore: options.rateBefore ? parseFloat(options.rateBefore) : undefined,
        rateAfter: options.rateAfter ? parseFloat(options.rateAfter) : undefined,
      };
    } else {
      console.error("Either --input or (--type, --agent, --title, --problem) required");
      process.exit(1);
    }

    // Get current commit hash if not provided
    if (!entry.commit) {
      try {
        entry.commit = execSync("git rev-parse --short HEAD").toString().trim();
      } catch {
        entry.commit = "unknown";
      }
    }

    await appendChangelog(entry);
    console.log("Changelog entry appended.");
  });

changelogCommand
  .command("show")
  .description("Show the current changelog")
  .option("--lines <n>", "Number of lines to show", "50")
  .action((options) => {
    const content = readChangelog();
    const lines = content.split("\n").slice(0, parseInt(options.lines, 10));
    console.log(lines.join("\n"));
  });

changelogCommand
  .command("init")
  .description("Initialize the changelog file")
  .action(async () => {
    const entry: ChangelogEntry = {
      type: "other",
      agent: "system",
      title: "Initialized changelog",
      problem: "Phase 3 setup",
    };
    await appendChangelog(entry);
    console.log("Changelog initialized at docs/docs/changelog/index.md");
  });
