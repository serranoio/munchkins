import { $ } from "bun";
import { Command } from "commander";
import { appendChangelog } from "../changelog.js";
import { isClaudeAvailable, spawnAgent } from "../spawn.js";
import { cleanupWorktree, createWorktree } from "../worktree.js";

const DEFAULT_WORKFLOW = ["auditor", "tuner", "discoverer", "builder"];

export const autonomousCommand = new Command("autonomous").description(
  "Run autonomous improvement loop",
);

autonomousCommand
  .command("start")
  .description("Start the autonomous loop")
  .option("--max-failures <n>", "Stop after N consecutive failures", "5")
  .option("--dry-run", "Don't commit or merge changes")
  .option("--workflow <preset>", "Workflow to run each iteration", "default")
  .action(async (options: { maxFailures: string; dryRun?: boolean; workflow: string }) => {
    const maxFailures = parseInt(options.maxFailures, 10);

    // Check if claude is available
    const claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      console.error("Claude CLI not found. Please install claude-code.");
      process.exit(1);
    }

    console.log("Starting autonomous improvement loop");
    console.log(`Max consecutive failures: ${maxFailures}`);
    if (options.dryRun) {
      console.log("(dry-run mode - no commits or merges)");
    }
    console.log();

    let consecutiveFailures = 0;
    let iteration = 0;
    let totalImprovements = 0;

    while (consecutiveFailures < maxFailures) {
      iteration++;
      console.log(`\n========== ITERATION ${iteration} ==========`);
      console.log(`Consecutive failures: ${consecutiveFailures}/${maxFailures}`);

      let improvedThisIteration = false;

      for (const agentName of DEFAULT_WORKFLOW) {
        console.log(`\n--- ${agentName.toUpperCase()} ---`);

        const worktree = await createWorktree(agentName);

        try {
          const result = await spawnAgent(agentName, {
            dryRun: options.dryRun,
            worktreePath: worktree.path,
          });

          console.log(
            `Exit: ${result.exitCode}, Improved: ${result.improved}, Duration: ${(result.duration / 1000).toFixed(1)}s`,
          );

          if (result.exitCode === 0 && result.improved) {
            improvedThisIteration = true;

            if (!options.dryRun) {
              // Run scenarios
              const scenarioResult = await $`bun run scenario:all`.quiet().nothrow();
              if (scenarioResult.exitCode === 0) {
                // Merge
                await $`cd ${worktree.path} && git checkout main && git merge ${worktree.branch} --no-ff -m "Agent merge: ${worktree.branch}"`.quiet();

                if (result.changelogEntry) {
                  const commitHash = await $`git rev-parse --short HEAD`.quiet();
                  result.changelogEntry.commit = commitHash.text().trim();
                  await appendChangelog(result.changelogEntry);
                  await $`git add docs/docs/changelog/index.md && git commit --amend --no-edit`.quiet();
                }

                console.log(`Merged: ${agentName}`);
                totalImprovements++;
              } else {
                console.log(`Scenarios failed, not merging`);
              }
            } else {
              totalImprovements++;
            }
          }
        } finally {
          await cleanupWorktree(worktree.path);
        }
      }

      if (improvedThisIteration) {
        consecutiveFailures = 0;
        console.log("\nIteration improved! Resetting failure count.");
      } else {
        consecutiveFailures++;
        console.log(`\nNo improvement. Failures: ${consecutiveFailures}/${maxFailures}`);
      }
    }

    console.log(`\n========== AUTONOMOUS LOOP COMPLETE ==========`);
    console.log(`Iterations: ${iteration}`);
    console.log(`Total improvements: ${totalImprovements}`);
    console.log(`Stopping: ${maxFailures} consecutive failures reached`);
  });

autonomousCommand
  .command("status")
  .description("Check autonomous loop status")
  .action(() => {
    console.log("Autonomous loop status: not running");
    console.log("(Status tracking not yet implemented)");
  });
