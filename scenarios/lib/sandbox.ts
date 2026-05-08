import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export interface Sandbox {
  path: string;
  cleanup: () => void;
}

export async function createSandbox(seedRepoDir: string): Promise<Sandbox> {
  const path = mkdtempSync(join(tmpdir(), "munchkins-bugfix-"));
  cpSync(seedRepoDir, path, { recursive: true });

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "harness",
    GIT_AUTHOR_EMAIL: "harness@local",
    GIT_COMMITTER_NAME: "harness",
    GIT_COMMITTER_EMAIL: "harness@local",
  };
  await $`git init -b main`.cwd(path).env(env).quiet();
  await $`git add -A`.cwd(path).env(env).quiet();
  await $`git commit -m "seed"`.cwd(path).env(env).quiet();

  return {
    path,
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}
