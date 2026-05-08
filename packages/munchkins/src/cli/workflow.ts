import { $ } from "bun";
import { Command } from "commander";
import { appendChangelog } from "../changelog.js";
import { isClaudeAvailable, spawnAgent } from "../spawn.js";
import { cleanupWorktree, createWorktree } from "../worktree.js";

interface WorkflowAgent {
  name: string;
  parallel?: number;
}

type WorkflowStep = string | WorkflowAgent;

const WORKFLOWS: Record<string, WorkflowStep[]> = {
  default: ["auditor", "tuner", "discoverer", "builder"],
  "tune-only": ["auditor", "tuner"],
  "build-blitz": ["auditor", { name: "builder", parallel: 3 }],
  "discover-only": ["auditor", "discoverer"],
  audit: ["auditor"],
};

export const workflowCommand = new Command("workflow").description(
  "Run predefined agent workflows",
);

workflowCommand
  .command("run <preset>")
  .description("Run a workflow preset")
  .option("--dry-run", "Don't commit or merge changes")
  .action(async (preset: string, options: { dryRun?: boolean }) => {
    const workflow = WORKFLOWS[preset];
    if (!workflow) {
      console.error(`Unknown workflow: ${preset}`);
      console.error(`Available workflows: ${Object.keys(WORKFLOWS).join(", ")}`);
      process.exit(1);
    }

    // Check if claude is available
    const claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      console.error("Claude CLI not found. Please install claude-code.");
      process.exit(1);
    }

    console.log(`Running workflow: ${preset}`);
    if (options.dryRun) {
      console.log("(dry-run mode - no commits or merges)");
    }
    console.log(
      `Steps: ${workflow.map((s) => (typeof s === "string" ? s : `${s.name}x${s.parallel}`)).join(" → ")}\n`,
    );

    let totalImproved = 0;
    let totalMerged = 0;

    for (const step of workflow) {
      const agentName = typeof step === "string" ? step : step.name;
      const parallel = typeof step === "string" ? 1 : step.parallel || 1;

      console.log(`\n=== ${agentName.toUpperCase()} ===`);

      const results = await Promise.all(
        Array(parallel)
          .fill(null)
          .map(async (_, i) => {
            const instanceId = parallel > 1 ? ` #${i + 1}` : "";

            const worktree = await createWorktree(agentName);
            console.log(`Worktree: ${worktree.path}`);

            try {
              const result = await spawnAgent(agentName, {
                dryRun: options.dryRun,
                worktreePath: worktree.path,
              });

              console.log(
                `${agentName}${instanceId}: ${result.improved ? "improved" : "no change"} (${(result.duration / 1000).toFixed(1)}s)`,
              );

              if (result.exitCode === 0 && result.improved && !options.dryRun) {
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

                  return { ...result, merged: true };
                }
              }

              return { ...result, merged: false };
            } finally {
              await cleanupWorktree(worktree.path);
            }
          }),
      );

      totalImproved += results.filter((r) => r.improved).length;
      totalMerged += results.filter((r) => r.merged).length;
    }

    console.log(`\n=== Workflow Complete ===`);
    console.log(`Total improvements: ${totalImproved}`);
    if (!options.dryRun) {
      console.log(`Total merged: ${totalMerged}`);
    }
  });

workflowCommand
  .command("custom")
  .description("Run a custom agent sequence")
  .requiredOption("--agents <list>", "Comma-separated list of agents")
  .option("--dry-run", "Don't commit or merge changes")
  .action(async (options: { agents: string; dryRun?: boolean }) => {
    const agents = options.agents.split(",").map((a) => a.trim());

    // Validate agents
    const validAgents = ["auditor", "tuner", "discoverer", "builder", "strategist"];
    for (const agent of agents) {
      if (!validAgents.includes(agent)) {
        console.error(`Unknown agent: ${agent}`);
        process.exit(1);
      }
    }

    // Run as a custom workflow
    console.log(`Running custom workflow: ${agents.join(" → ")}`);

    for (const agentName of agents) {
      console.log(`\n=== ${agentName.toUpperCase()} ===`);

      const worktree = await createWorktree(agentName);

      try {
        const result = await spawnAgent(agentName, {
          dryRun: options.dryRun,
          worktreePath: worktree.path,
        });

        console.log(`${agentName}: ${result.improved ? "improved" : "no change"}`);

        if (result.exitCode === 0 && result.improved && !options.dryRun) {
          const scenarioResult = await $`bun run scenario:all`.quiet().nothrow();
          if (scenarioResult.exitCode === 0) {
            await $`cd ${worktree.path} && git checkout main && git merge ${worktree.branch} --no-ff -m "Agent merge: ${worktree.branch}"`.quiet();

            if (result.changelogEntry) {
              const commitHash = await $`git rev-parse --short HEAD`.quiet();
              result.changelogEntry.commit = commitHash.text().trim();
              await appendChangelog(result.changelogEntry);
              await $`git add docs/docs/changelog/index.md && git commit --amend --no-edit`.quiet();
            }
          }
        }
      } finally {
        await cleanupWorktree(worktree.path);
      }
    }

    console.log("\nCustom workflow complete.");
  });

workflowCommand
  .command("list")
  .description("List available workflow presets")
  .action(() => {
    console.log("\nAvailable workflows:\n");
    for (const [name, steps] of Object.entries(WORKFLOWS)) {
      const stepsStr = steps
        .map((s) => (typeof s === "string" ? s : `${s.name}x${s.parallel}`))
        .join(" → ");
      console.log(`  ${name.padEnd(15)} ${stepsStr}`);
    }
    console.log();
  });
