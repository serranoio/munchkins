#!/usr/bin/env bun
// Your project's agent registry. `bun run munchkins` resolves to this file via
// the script declared in package.json. Side-effect-import each agent below
// once you author it; the framework's `runCli` will discover them through the
// shared singleton registry.
//
// Author a new agent inside Claude Code with `/munchkins:new-munchkin`.
//
// Example:
//   import "./agents/my-agent/my-agent.js";
import { runCli } from "@serranolabs.io/munchkins";

if (import.meta.main) {
  await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });
}
