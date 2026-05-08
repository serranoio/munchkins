import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { Command } from "commander";
import { appendChangelog, type ChangelogEntry } from "../changelog.js";
import { type AgentResult, isClaudeAvailable, spawnAgent } from "../spawn.js";
import { cleanupWorktree, createWorktree, deleteBranch } from "../worktree.js";

export const agentCommand = new Command("agent").description("Run autonomous agents");

interface AgentRunResult extends AgentResult {
  branch: string;
  instanceLabel: string;
}

/**
 * Check if a branch's changes are already in main (duplicate work detection)
 */
async function isDuplicate(branch: string): Promise<boolean> {
  const diff = await $`git diff main...${branch} --stat`.quiet().nothrow();
  return diff.exitCode === 0 && diff.text().trim() === "";
}

/**
 * Update roadmap.md after a successful merge via separate Claude call
 */
async function updateDocsForMerge(entry: ChangelogEntry): Promise<void> {
  console.log(`  Updating docs for: ${entry.title}...`);
  const prompt = `Update docs/docs/guides/roadmap.md to mark this item as completed: "${entry.title}".
If the item exists, add [DONE] prefix or move to completed section.
If no matching item exists, do nothing.
Make minimal changes.`;

  await $`claude -p ${prompt} --max-turns 1 --dangerously-skip-permissions`.quiet().nothrow();
  await $`git add docs/docs/guides/roadmap.md && git commit --amend --no-edit`.quiet().nothrow();
}

agentCommand
  .command("run <name>")
  .description("Run a specific agent")
  .option("--dry-run", "Don't commit or merge changes")
  .option("--parallel <n>", "Run N instances in parallel", "1")
  .option("--window", "Launch agent(s) in separate cmux window(s)")
  .option(
    "--focus <path>",
    "Path to a markdown file with run-specific instructions that override bottleneck selection",
  )
  .action(
    async (
      name: string,
      options: { dryRun?: boolean; parallel: string; window?: boolean; focus?: string },
    ) => {
      const parallelCount = parseInt(options.parallel, 10);

      // Validate agent name
      const validAgents = [
        "auditor",
        "tuner",
        "discoverer",
        "builder",
        "strategist",
        "refactorer",
        "performance",
      ];
      if (!validAgents.includes(name)) {
        console.error(`Unknown agent: ${name}`);
        console.error(`Valid agents: ${validAgents.join(", ")}`);
        process.exit(1);
      }

      // Resolve --focus to an absolute path now: the agent runs in a worktree
      // with a different cwd, so a relative path would not resolve there.
      let focusPath: string | undefined;
      if (options.focus) {
        focusPath = resolve(process.cwd(), options.focus);
        if (!existsSync(focusPath)) {
          console.error(`--focus file not found: ${focusPath}`);
          process.exit(1);
        }
      }

      // Launch in cmux windows if --window flag is set
      if (options.window) {
        const timestamp = Date.now();
        const cwd = process.cwd();
        for (let i = 0; i < parallelCount; i++) {
          const suffix = parallelCount > 1 ? `-${i}` : "";
          const workspaceName = `${name}-${timestamp}${suffix}`;
          const dryRunFlag = options.dryRun ? " --dry-run" : "";
          const focusFlag = focusPath ? ` --focus ${focusPath}` : "";
          console.log(`Launching ${name} agent in cmux window: ${workspaceName}`);
          await $`cmux new-workspace --name ${workspaceName} --cwd ${cwd} --command ${`bun run cli:agents agent run ${name}${dryRunFlag}${focusFlag}`}`
            .quiet()
            .nothrow();
        }
        console.log(`\nLaunched ${parallelCount} agent(s) in cmux windows`);
        return;
      }

      // Check if claude is available
      const claudeAvailable = await isClaudeAvailable();
      if (!claudeAvailable) {
        console.error("Claude CLI not found. Please install claude-code.");
        process.exit(1);
      }

      console.log(`Running ${parallelCount} instance(s) of ${name} agent...`);
      if (options.dryRun) {
        console.log("(dry-run mode - no commits or merges)");
      }

      // Phase 1: Run all agents in parallel, collect results (NO merging here)
      const agentResults = await Promise.all(
        Array(parallelCount)
          .fill(null)
          .map(async (_, i): Promise<AgentRunResult | null> => {
            const instanceLabel = parallelCount > 1 ? ` #${i + 1}` : "";
            console.log(`Creating worktree for ${name}${instanceLabel}...`);

            const worktree = await createWorktree(name, parallelCount > 1 ? i : undefined);
            console.log(`Worktree created: ${worktree.path}`);

            try {
              console.log(`Spawning ${name} agent${instanceLabel}...`);
              const result = await spawnAgent(name, {
                dryRun: options.dryRun,
                worktreePath: worktree.path,
                focusPath,
              });

              console.log(`Agent ${name}${instanceLabel} completed:`);
              console.log(`  Exit code: ${result.exitCode}`);
              console.log(`  Improved: ${result.improved}`);
              console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);

              return { ...result, branch: worktree.branch, instanceLabel };
            } catch (error) {
              console.error(`Agent ${name}${instanceLabel} failed:`, error);
              return null;
            } finally {
              // Cleanup worktree but keep branch for merging
              console.log(`Cleaning up worktree for ${name}${instanceLabel}...`);
              await cleanupWorktree(worktree.path);
            }
          }),
      );

      // Phase 2: Merge sequentially (prevents race conditions)
      let merged = 0;
      let skipped = 0;
      const failedBranches: string[] = [];

      if (!options.dryRun) {
        console.log(`\n=== Merging Results ===`);

        for (const result of agentResults) {
          if (!result || result.exitCode !== 0 || !result.improved) {
            continue;
          }

          console.log(`\nProcessing ${name}${result.instanceLabel} (${result.branch})...`);

          // Verify branch exists
          const branchCheck = await $`git rev-parse --verify ${result.branch}`.quiet().nothrow();
          if (branchCheck.exitCode !== 0) {
            console.error(`  ERROR: Branch ${result.branch} does not exist!`);
            console.error(
              `  This should not happen - the branch may have been deleted prematurely.`,
            );
            continue;
          }
          console.log(`  Branch verified: exists`);

          // Check for duplicate work
          if (await isDuplicate(result.branch)) {
            console.log(`  Skipping: changes already in main (duplicate work)`);
            skipped++;
            await deleteBranch(result.branch);
            continue;
          }

          // Run scenarios on main before merge (ensures clean state)
          console.log(`  Running scenarios...`);
          const scenarioResult = await $`bun run scenario:all`.nothrow();
          if (scenarioResult.exitCode !== 0) {
            console.error(
              `  Scenarios failed on main (exit code ${scenarioResult.exitCode}), aborting merge`,
            );
            // Show last 20 lines of scenario output for debugging
            const lines = scenarioResult.text().split("\n").slice(-20);
            console.error(
              `  Scenario output (last 20 lines):\n${lines.map((l) => `    ${l}`).join("\n")}`,
            );
            console.error(`  Branch preserved for manual resolution: ${result.branch}`);
            failedBranches.push(result.branch);
            continue;
          }

          // Merge
          console.log(`  Merging...`);
          const mergeResult =
            await $`git merge ${result.branch} --no-ff -m "Agent merge: ${result.branch}"`.nothrow();
          if (mergeResult.exitCode !== 0) {
            const mergeOutput = mergeResult.text() + mergeResult.stderr.toString();
            console.error(`  Merge failed (exit code ${mergeResult.exitCode})`);
            console.error(
              `  Merge output:\n${mergeOutput
                .split("\n")
                .map((l) => `    ${l}`)
                .join("\n")}`,
            );
            // Show conflicting files if any
            const statusResult = await $`git status --porcelain`.quiet().nothrow();
            if (statusResult.text().trim()) {
              console.error(
                `  Git status:\n${statusResult
                  .text()
                  .split("\n")
                  .map((l) => `    ${l}`)
                  .join("\n")}`,
              );
            }
            console.error(`  Branch preserved for manual resolution: ${result.branch}`);
            failedBranches.push(result.branch);
            await $`git merge --abort`.quiet().nothrow();
            continue;
          }

          // Append changelog
          if (result.changelogEntry) {
            const commitHash = await $`git rev-parse --short HEAD`.quiet();
            result.changelogEntry.commit = commitHash.text().trim();
            await appendChangelog(result.changelogEntry);
            await $`git add docs/docs/changelog/index.md && git commit --amend --no-edit`.quiet();

            // Update docs (separate Claude call)
            await updateDocsForMerge(result.changelogEntry);
          }

          // Delete merged branch
          await deleteBranch(result.branch);

          console.log(`  Merged successfully`);
          merged++;
        }
      }

      // Summary
      const successful = agentResults.filter((r) => r?.exitCode === 0).length;
      const improved = agentResults.filter((r) => r?.improved).length;

      console.log(`\n=== Summary ===`);
      console.log(`Successful: ${successful}/${parallelCount}`);
      console.log(`Improved: ${improved}/${parallelCount}`);
      if (!options.dryRun) {
        console.log(`Merged: ${merged}/${parallelCount}`);
        console.log(`Skipped (duplicate): ${skipped}/${parallelCount}`);
        if (failedBranches.length > 0) {
          console.log(`Failed (needs manual merge): ${failedBranches.length}/${parallelCount}`);
          console.log(`\nBranches requiring manual resolution:`);
          for (const branch of failedBranches) {
            console.log(`  git merge ${branch}`);
          }
        }
      }

      // Exit with error if any failed
      if (successful < parallelCount) {
        process.exit(1);
      }
    },
  );

agentCommand
  .command("list")
  .description("List available agents")
  .action(() => {
    console.log("\nAvailable agents:\n");
    console.log("  auditor      - Data integrity and alert audits");
    console.log("  tuner        - Config parameter optimization via A/B testing");
    console.log("  discoverer   - Filter combo discovery via /hypothesis");
    console.log("  builder      - New signals, flows, and features");
    console.log("  strategist   - System observation and roadmap updates");
    console.log("  refactorer   - Code refactoring for DRY and maintainability");
    console.log("  performance  - Speed optimization and bottleneck elimination");
    console.log();
  });
