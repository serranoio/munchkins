import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registry } from "@serranolabs.io/munchkins-core";
import { $ } from "bun";
import "./director-agent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const SCRIPTS = join(HERE, "scripts");

const TEST_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

interface Repo {
  path: string;
  cleanup: () => void;
}

async function createBareRepo(): Promise<Repo> {
  const path = mkdtempSync(join(tmpdir(), "munchkins-director-test-"));
  const env = { ...process.env, ...TEST_GIT_IDENTITY };
  await $`git init -b main`.cwd(path).env(env).quiet();
  await $`git config user.email t@t`.cwd(path).env(env).quiet();
  await $`git config user.name t`.cwd(path).env(env).quiet();
  await Bun.write(join(path, "seed.ts"), "export const seed = 1;\n");
  await $`git add -A`.cwd(path).env(env).quiet();
  await $`git commit -m seed`.cwd(path).env(env).quiet();
  return {
    path,
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

describe("director registration", () => {
  test("director is registered under name 'director' after side-effect import", () => {
    expect(registry.get("director")).toBeDefined();
    expect(registry.get("director")?.name).toBe("director");
  });

  test("cron config is every 10 minutes, thinking verbosity, userMessage 'tick'", () => {
    const builder = registry.get("director");
    expect(builder?.getCron()).toEqual({
      spec: "*/10 * * * *",
      userMessage: "tick",
      verbosity: "thinking",
    });
  });

  test("step count is 7: 3 deterministic + 3 agent + 1 trailing post-checks", () => {
    // The director's main pipeline is 6 steps (steps 1–6); the trailing
    // .addDeterministic(DEFAULT_CHECKS, defaultFixer) is the 7th, kept for
    // parity with other munchkins so the integration phase has a gate to run.
    expect(registry.get("director")?.getStepCount()).toBe(7);
  });

  test("director opts out of the framework's --dry-run short-circuit", () => {
    expect(registry.get("director")?.getHandlesDryRun()).toBe(true);
  });
});

describe("director scripts", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = await createBareRepo();
    // The scripts read $WORKTREE and $REPO_ROOT from the env; for these
    // tests both point at the same temp repo (one-checkout fixture).
  });

  afterEach(() => {
    repo.cleanup();
  });

  test("repo-survey.sh exits non-zero with the expected error when PURPOSE.md is absent", async () => {
    const env = {
      ...process.env,
      ...TEST_GIT_IDENTITY,
      WORKTREE: repo.path,
      REPO_ROOT: repo.path,
      PATH: process.env.PATH ?? "",
    };
    // Seed the .director/current sentinel; the script checks PURPOSE.md
    // before reading it, so the failure path doesn't depend on this — but
    // having it present rules out "missing sentinel" as the failure mode.
    await $`mkdir -p ${repo.path}/.director`.quiet();
    await Bun.write(join(repo.path, ".director", "current"), "fake-run");
    const r = await $`bash ${join(SCRIPTS, "repo-survey.sh")}`.env(env).nothrow().quiet();
    expect(r.exitCode).not.toBe(0);
    const combined = r.stdout.toString() + r.stderr.toString();
    expect(combined).toContain("PURPOSE.md not found at repo root");
    expect(combined).toContain("docs/pages/agents/director.md");
  });

  test("inflight-survey.sh in a repo with no director/* branches writes inflight.json with empty branches and worktrees", async () => {
    // Stub `gh` to fail so the PR inventory falls back to '[]'.
    const stubDir = mkdtempSync(join(tmpdir(), "munchkins-director-stub-"));
    try {
      await Bun.write(join(stubDir, "gh"), "#!/usr/bin/env bash\nexit 1\n");
      await $`chmod +x ${join(stubDir, "gh")}`.quiet();

      const env = {
        ...process.env,
        ...TEST_GIT_IDENTITY,
        WORKTREE: repo.path,
        REPO_ROOT: repo.path,
        PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      };
      const r = await $`bash ${join(SCRIPTS, "inflight-survey.sh")}`.env(env).nothrow().quiet();
      expect(r.exitCode).toBe(0);

      const runId = (await Bun.file(join(repo.path, ".director", "current")).text()).trim();
      expect(runId).toMatch(/^\d{8}T\d{6}-/);

      const inflightPath = join(repo.path, ".director", runId, "inflight.json");
      const inflight = JSON.parse(await Bun.file(inflightPath).text());
      expect(inflight.branches).toEqual([]);
      expect(inflight.worktrees).toEqual([]);
      // gh stub fails, so prs falls back to '[]' (empty array).
      expect(inflight.prs).toEqual([]);
    } finally {
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  test("repo-survey.sh happy path writes survey.md with the expected sections when PURPOSE.md is present", async () => {
    // Seed PURPOSE.md and the .director/current sentinel the script reads to
    // resolve the active run dir.
    await Bun.write(join(repo.path, "PURPOSE.md"), "# Purpose\nShip thin slices.\n");
    await $`mkdir -p ${repo.path}/.director`.quiet();
    const runId = "20260101T000000-survey-test";
    await Bun.write(join(repo.path, ".director", "current"), runId);

    const env = {
      ...process.env,
      ...TEST_GIT_IDENTITY,
      WORKTREE: repo.path,
      REPO_ROOT: repo.path,
      PATH: process.env.PATH ?? "",
    };
    const r = await $`bash ${join(SCRIPTS, "repo-survey.sh")}`.env(env).nothrow().quiet();
    expect(r.exitCode).toBe(0);

    const surveyPath = join(repo.path, ".director", runId, "survey.md");
    const survey = await Bun.file(surveyPath).text();
    expect(survey).toContain("# Director repo survey —");
    expect(survey).toContain("## Recent commits");
    expect(survey).toContain("## Open PRs");
    expect(survey).toContain("## Lint status");
    expect(survey).toContain("## Typecheck status");
  });

  test("inflight-survey.sh detects existing director/* branches and lists them in inflight.json", async () => {
    const gitEnv = { ...process.env, ...TEST_GIT_IDENTITY };
    // Create two director/* branches against the seed commit so the survey
    // has something to inventory.
    await $`git branch director/alpha-001`.cwd(repo.path).env(gitEnv).quiet();
    await $`git branch director/beta-002`.cwd(repo.path).env(gitEnv).quiet();

    const stubDir = mkdtempSync(join(tmpdir(), "munchkins-director-stub-"));
    try {
      await Bun.write(join(stubDir, "gh"), "#!/usr/bin/env bash\nexit 1\n");
      await $`chmod +x ${join(stubDir, "gh")}`.quiet();

      const env = {
        ...process.env,
        ...TEST_GIT_IDENTITY,
        WORKTREE: repo.path,
        REPO_ROOT: repo.path,
        PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      };
      const r = await $`bash ${join(SCRIPTS, "inflight-survey.sh")}`.env(env).nothrow().quiet();
      expect(r.exitCode).toBe(0);

      const runId = (await Bun.file(join(repo.path, ".director", "current")).text()).trim();
      const inflight = JSON.parse(
        await Bun.file(join(repo.path, ".director", runId, "inflight.json")).text(),
      );
      expect(inflight.branches).toContain("director/alpha-001");
      expect(inflight.branches).toContain("director/beta-002");
    } finally {
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  test("dispatch.sh constructs the correct child argv for each work_type via the dry-run path", async () => {
    // Seed the .director/<run>/ inputs dispatch.sh reads — triage.json drives
    // the work_type → child-agent mapping; plan.md is the user-message payload.
    const runId = "20260101T000000-dispatch-test";
    const runDir = join(repo.path, ".director", runId);
    await $`mkdir -p ${runDir}`.quiet();
    await Bun.write(join(repo.path, ".director", "current"), runId);
    await Bun.write(
      join(runDir, "triage.json"),
      JSON.stringify({ work_type: "bug-fix", goal: "fix the thing" }),
    );
    await Bun.write(join(runDir, "plan.md"), "# Plan\nDo the thing.\n");

    const cases: { work_type: string; expected: string }[] = [
      { work_type: "bug-fix", expected: "bug-fix" },
      { work_type: "refactor", expected: "refactor" },
      { work_type: "feature", expected: "feat-small" },
      { work_type: "performance", expected: "refactor" },
    ];

    for (const { work_type, expected } of cases) {
      await Bun.write(
        join(runDir, "triage.json"),
        JSON.stringify({ work_type, goal: "irrelevant" }),
      );

      const env = {
        ...process.env,
        ...TEST_GIT_IDENTITY,
        WORKTREE: repo.path,
        REPO_ROOT: repo.path,
        PATH: process.env.PATH ?? "",
        __MUNCHKINS_OPT_dryRun: "true",
      };
      const r = await $`bash ${join(SCRIPTS, "dispatch.sh")}`.env(env).nothrow().quiet();
      expect(r.exitCode).toBe(0);
      const out = r.stdout.toString();
      expect(out).toContain("[director] dispatch (dry-run):");
      expect(out).toContain(`bun run munchkins ${expected}`);
      expect(out).toContain(`--user-message=${join(runDir, "plan.md")}`);
      expect(out).toContain("--branch-prefix=director");
    }
  });

  test("dispatch.sh short-circuits when triage.json reports idle", async () => {
    const runId = "20260101T000000-dispatch-idle";
    const runDir = join(repo.path, ".director", runId);
    await $`mkdir -p ${runDir}`.quiet();
    await Bun.write(join(repo.path, ".director", "current"), runId);
    await Bun.write(
      join(runDir, "triage.json"),
      JSON.stringify({ idle: true, reason: "nothing in flight" }),
    );
    // plan.md is intentionally not created — the idle short-circuit must run
    // before the "missing plan.md" failure path.

    const env = {
      ...process.env,
      ...TEST_GIT_IDENTITY,
      WORKTREE: repo.path,
      REPO_ROOT: repo.path,
      PATH: process.env.PATH ?? "",
    };
    const r = await $`bash ${join(SCRIPTS, "dispatch.sh")}`.env(env).nothrow().quiet();
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("triage idle");
  });
});

// Smoke check that the director skill symlink resolves to the package source.
// Important because every agent step loads the skill via withSkill("director")
// and a stale symlink would surface as a runtime "skill not found".
describe("director skill availability", () => {
  test(".claude/skills/director points at packages/munchkins/skills/director", async () => {
    const skillPath = join(REPO_ROOT, ".claude/skills/director/SKILL.md");
    const content = await Bun.file(skillPath).text();
    expect(content).toContain("name: director");
    expect(content).toContain("Vertical-slice rule");
  });
});
