#!/usr/bin/env bun
// Dogfood entry point — this is THIS repo's agent registry. Consumers of
// @serranolabs.io/munchkins generate their own agentRegistry.ts via
// `bunx munchkins-init`. The framework package itself ships zero default
// agents; the four agents below live in this private workspace.
import { runCli } from "@serranolabs.io/munchkins";
import "./agents/bugfix/bugfix-agent.js";
import "./agents/director/director-agent.js";
import "./agents/feat-small/feat-small-agent.js";
import "./agents/refactor/refactor-agent.js";

if (import.meta.main) {
  await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });
}
