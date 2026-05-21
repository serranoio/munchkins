#!/usr/bin/env bun
// Bump version in packages/munchkins, commit, tag vX.Y.Z, push.
// Pushing the tag fires .github/workflows/publish.yml.
//
//   bun run release patch     # 0.1.0 -> 0.1.1
//   bun run release minor     # 0.1.0 -> 0.2.0
//   bun run release major     # 0.1.0 -> 1.0.0
//   bun run release 0.4.2     # explicit version
//   bun run release patch --dry-run

import { readFileSync, writeFileSync } from "node:fs";

const PACKAGES = ["packages/munchkins/package.json"];

type Bump = "patch" | "minor" | "major";

function sh(cmd: string[], { allowFail = false } = {}): string {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = new TextDecoder().decode(proc.stdout).trim();
  const err = new TextDecoder().decode(proc.stderr).trim();
  if (proc.exitCode !== 0 && !allowFail) {
    console.error(`✖ ${cmd.join(" ")}`);
    if (out) console.error(out);
    if (err) console.error(err);
    process.exit(1);
  }
  return proc.exitCode === 0 ? out : "";
}

function bump(version: string, kind: Bump): string {
  const [maj, min, pat] = version.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const isExplicit = (s: string) => /^\d+\.\d+\.\d+$/.test(s);
const isBump = (s: string): s is Bump => s === "patch" || s === "minor" || s === "major";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const arg = args.find((a) => !a.startsWith("--")) ?? "patch";

if (!isExplicit(arg) && !isBump(arg)) {
  console.error(`✖ unknown release arg: ${arg}`);
  console.error("   expected: patch | minor | major | X.Y.Z");
  process.exit(1);
}

const current = JSON.parse(readFileSync(PACKAGES[0], "utf8")).version as string;
const next = isExplicit(arg) ? arg : bump(current, arg as Bump);
const tag = `v${next}`;

console.log(`current : ${current}`);
console.log(`next    : ${next}`);
console.log(`tag     : ${tag}`);
console.log(`packages: ${PACKAGES.length}`);
console.log("");

const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  console.error(`✖ refusing to release from '${branch}', expected 'main'`);
  process.exit(1);
}

const dirty = sh(["git", "status", "--porcelain"]);
if (dirty) {
  console.error(`✖ working tree is dirty:\n${dirty}`);
  process.exit(1);
}

const tagExists =
  Bun.spawnSync(["git", "rev-parse", tag], { stderr: "ignore", stdout: "ignore" }).exitCode === 0;
if (tagExists) {
  console.error(`✖ tag ${tag} already exists`);
  process.exit(1);
}

const remote = sh(["git", "remote", "get-url", "origin"]);
const slug = remote.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
const runsUrl = `https://github.com/${slug}/actions/workflows/publish.yml`;

if (dryRun) {
  console.log("✓ dry-run — would:");
  for (const p of PACKAGES) console.log(`    write ${p} version=${next}`);
  console.log(`    commit "chore(release): ${tag}"`);
  console.log(`    tag    ${tag}`);
  console.log("    push   origin main && origin <tag>");
  console.log("");
  console.log(`would fire: ${runsUrl}`);
  process.exit(0);
}

for (const path of PACKAGES) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = next;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`✓ ${path} -> ${next}`);
}

sh(["git", "add", ...PACKAGES]);
sh(["git", "commit", "-m", `chore(release): ${tag}`]);
sh(["git", "tag", tag]);
sh(["git", "push", "origin", "main"]);
sh(["git", "push", "origin", tag]);

const sha = sh(["git", "rev-parse", "HEAD"]);
console.log("");
console.log("─── release fired ───");
console.log(`runs   : ${runsUrl}`);
console.log(`release: https://github.com/${slug}/releases/tag/${tag}`);
console.log(`commit : https://github.com/${slug}/commit/${sha}`);
