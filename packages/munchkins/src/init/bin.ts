#!/usr/bin/env bun
// `munchkins-init` — idempotent bootstrap for a repo that has just added
// @serranolabs.io/munchkins as a devDependency. Run via `bunx munchkins-init`
// from the repo root.
//
// Tasks:
//   1. Require <cwd>/package.json to exist.
//   2. Write <cwd>/agentRegistry.ts from the bundled template, skip-if-exists.
//   3. Ensure <cwd>/package.json scripts.munchkins points at the registry.
//      Don't clobber a user-set value.
//   4. Install bundled skills into <cwd>/.claude/skills/, skip-if-exists.
//   5. Print a next-step hint pointing at /munchkins:new-munchkin.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _resolveTarget, _runSkillsInstall } from "./install-skills.js";

const TEMPLATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "agentRegistry.template.ts");
// bin.ts → packages/munchkins/src/init/bin.ts; package root is two levels up.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface RunInitOptions {
  cwd: string;
  packageRoot: string;
  templatePath: string;
}

export async function runInit(opts: RunInitOptions): Promise<void> {
  const pkgPath = join(opts.cwd, "package.json");
  if (!existsSync(pkgPath)) {
    console.error(`✖ no package.json at ${opts.cwd} — run \`bunx munchkins-init\` from a repo root`);
    process.exit(1);
  }

  await _ensureAgentRegistry(opts.cwd, opts.templatePath);
  await _ensureMunchkinsScript(opts.cwd, pkgPath);

  _runSkillsInstall({
    cwd: opts.cwd,
    target: _resolveTarget([], opts.cwd),
    packageRoot: opts.packageRoot,
  });

  console.log("");
  console.log("✓ munchkins ready");
  console.log("  next: open Claude Code in this repo and run `/munchkins:new-munchkin`");
}

async function _ensureAgentRegistry(cwd: string, templatePath: string): Promise<void> {
  const dest = join(cwd, "agentRegistry.ts");
  if (existsSync(dest)) {
    console.log(`agentRegistry.ts: kept (already present at ${dest})`);
    return;
  }
  const body = await Bun.file(templatePath).text();
  await Bun.write(dest, body);
  console.log(`agentRegistry.ts: wrote ${dest}`);
}

async function _ensureMunchkinsScript(cwd: string, pkgPath: string): Promise<void> {
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
  const desired = "bun run ./agentRegistry.ts";
  if (scripts.munchkins) {
    if (scripts.munchkins === desired) {
      console.log('scripts.munchkins: kept (already set to "bun run ./agentRegistry.ts")');
    } else {
      console.log(`scripts.munchkins: kept (user-set value: ${JSON.stringify(scripts.munchkins)})`);
    }
    return;
  }
  scripts.munchkins = desired;
  pkg.scripts = scripts;
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('scripts.munchkins: added "bun run ./agentRegistry.ts"');
}

if (import.meta.main) {
  await runInit({ cwd: process.cwd(), packageRoot: PACKAGE_ROOT, templatePath: TEMPLATE_PATH });
}
