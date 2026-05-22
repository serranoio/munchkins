#!/usr/bin/env bun
// Dogfood entry point — this is THIS repo's agent registry. Consumers of
// @serranolabs.io/munchkins generate their own agentRegistry.ts via
// `bunx munchkins-init`. The framework package itself ships zero default
// agents; the four agents below live in this private workspace and are
// auto-discovered via `discoverAgents("./agents")`.
import { discoverAgents, runCli } from "@serranolabs.io/munchkins";

await discoverAgents("./agents", import.meta.url);

if (import.meta.main) {
  await runCli({ argv: process.argv, cwd: process.cwd(), env: process.env });
}
