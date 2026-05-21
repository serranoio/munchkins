#!/usr/bin/env bun
// Dogfood entry point — this is THIS repo's agent registry. Consumers of
// @serranolabs.io/munchkins generate their own agentRegistry.ts via
// `bunx munchkins-init`. The framework package itself ships zero default
// agents; the four agents below live in this private workspace.
import { runCli } from "@serranolabs.io/munchkins";
import "@serranolabs.io/munchkins/agents/bugfix";
import "@serranolabs.io/munchkins/agents/director";
import "@serranolabs.io/munchkins/agents/feat-small";
import "@serranolabs.io/munchkins/agents/refactor";

if (import.meta.main) {
  await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });
}
