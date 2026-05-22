import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "inflight-survey.ts");

async function seedRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "inflight-survey-test-"));
  await $`git init -q -b main ${dir}`.quiet();
  await $`git -C ${dir} config user.email "test@example.com"`.quiet();
  await $`git -C ${dir} config user.name "Test"`.quiet();
  await $`git -C ${dir} commit -q --allow-empty -m seed`.quiet();
  return dir;
}

async function runSurvey(workdir: string): Promise<{
  branches: string[];
  worktrees: { path: string; branch: string }[];
  prs: unknown;
}> {
  const proc = Bun.spawn(["bun", SCRIPT], {
    cwd: workdir,
    env: { ...process.env, WORKTREE: workdir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`inflight-survey exited ${exitCode}: ${stderr}`);
  }
  const currentId = readFileSync(join(workdir, ".director", "current"), "utf-8").trim();
  return JSON.parse(readFileSync(join(workdir, ".director", currentId, "inflight.json"), "utf-8"));
}

describe("inflight-survey", () => {
  test("lists director/* branches; ignores non-director branches", async () => {
    const repo = await seedRepo();
    try {
      await $`git -C ${repo} branch director/feat-x`.quiet();
      await $`git -C ${repo} branch director/bug-y`.quiet();
      await $`git -C ${repo} branch agent/refactor-z`.quiet();
      await $`git -C ${repo} branch unrelated-branch`.quiet();

      const inflight = await runSurvey(repo);

      expect(inflight.branches).toContain("director/feat-x");
      expect(inflight.branches).toContain("director/bug-y");
      expect(inflight.branches).not.toContain("agent/refactor-z");
      expect(inflight.branches).not.toContain("unrelated-branch");
      expect(inflight.branches).not.toContain("main");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("returns empty branches list on a fresh repo with no director/* branches", async () => {
    const repo = await seedRepo();
    try {
      const inflight = await runSurvey(repo);
      expect(inflight.branches).toEqual([]);
      expect(inflight.worktrees).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("lists director/* worktrees with their branch and path", async () => {
    const repo = await seedRepo();
    const wtDir = mkdtempSync(join(tmpdir(), "inflight-survey-wt-"));
    rmSync(wtDir, { recursive: true, force: true });
    try {
      await $`git -C ${repo} worktree add ${wtDir} -b director/wt-test`.quiet();

      const inflight = await runSurvey(repo);

      expect(inflight.worktrees).toHaveLength(1);
      expect(inflight.worktrees[0].branch).toBe("director/wt-test");
      // macOS canonicalizes /var/folders -> /private/var/folders via realpath;
      // compare realpaths so the assertion survives the platform-specific prefix.
      expect(realpathSync(inflight.worktrees[0].path)).toBe(realpathSync(wtDir));
    } finally {
      await $`git -C ${repo} worktree remove ${wtDir} --force`.quiet().nothrow();
      rmSync(repo, { recursive: true, force: true });
      rmSync(wtDir, { recursive: true, force: true });
    }
  });

  test("writes .director/current pointing at the run-id and inflight.json in that run dir", async () => {
    const repo = await seedRepo();
    try {
      await runSurvey(repo);
      const currentId = readFileSync(join(repo, ".director", "current"), "utf-8").trim();
      expect(currentId).toMatch(/^\d{8}T\d{6}-\d+$/);
      const inflightPath = join(repo, ".director", currentId, "inflight.json");
      expect(() => readFileSync(inflightPath, "utf-8")).not.toThrow();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
