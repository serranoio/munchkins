---
name: munchkins:init
description: One-time bootstrap that wires @serranolabs.io/munchkins into a host repo — writes the bundle entry, the agent config file, scaffolds default skills, and (in source-repo mode) creates the .claude/skills/ symlinks. Use when the user is setting up munchkins in a fresh repo — signaled by phrases like "set up munchkins", "init munchkins", "bootstrap munchkins", "I just added @serranolabs.io/munchkins". Do NOT use to author a new agent (use `/munchkins:new-munchkin`) or run an existing agent (use `/munchkins:launch-munchkin`).
---

# Init Munchkins

One-time bootstrap that wires `@serranolabs.io/munchkins` into a host repo. Idempotent — re-running is safe and skips anything already in place.

## When this skill applies

Trigger on explicit setup vocabulary: "set up munchkins", "init munchkins", "bootstrap munchkins", "I just installed @serranolabs.io/munchkins".

If `.munchkins/config.json` already exists with all expected fields, this skill exits with a one-line "already initialized" message.

## Workflow

### 1. Pre-flight

Verify `@serranolabs.io/munchkins` is on the dependency tree:

```bash
test -f node_modules/@serranolabs.io/munchkins/package.json || test -f packages/munchkins/package.json
```

If neither, tell the user "install `@serranolabs.io/munchkins` first (`bun add -D @serranolabs.io/munchkins`)" and stop.

If `.munchkins/config.json` already exists and is complete, print a one-liner and stop:

```
already initialized. config at .munchkins/config.json.
```

### 2. Detect mode

- **source-repo** — cwd is the framework monorepo. Signal: `packages/munchkins/package.json` declares `"name": "@serranolabs.io/munchkins"`.
- **consumer-repo** — cwd consumes the framework as a dep. Signal: `@serranolabs.io/munchkins` in `package.json` deps AND no local `packages/munchkins/`.

If neither signal applies, ask the user.

### 3. Discover repo state

Used to populate `.munchkins/config.json` and validate the bootstrap is feasible.

- **3a** CI gate commands: parse `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`. Fall back to `package.json` `scripts`.
- **3b** Primary language: from manifest (`package.json`, `pyproject.toml`, `go.mod`).
- **3c** Package manager: from lockfile (`bun.lock` → bun, etc.).
- **3d** Agent-index file: scan `AGENTS.md`, `SKILLS.md`, `docs/agents.md`, `docs/skills.md` for a markdown table listing agents. If exactly one match, record it. If multiple or zero, leave the field unset (new-munchkin will detect/prompt later).

### 4. Resolve paths

**Consumer-repo defaults:**

```
agentsDir       = munchkins/agents
skillsDir       = .claude/skills
bundleEntry     = munchkins/index.ts
integrate       = pr
```

**Source-repo defaults:**

```
agentsDir       = packages/munchkins/agents
skillsDir       = packages/munchkins/skills
bundleEntry     = packages/munchkins/src/index.ts
integrate       = merge
```

Allow the user to override `agentsDir` and `bundleEntry` if their repo has strong existing conventions (e.g., `tooling/munchkins/`). `skillsDir` is NOT overridable in consumer-repo mode — Claude Code's discovery is fixed at `.claude/skills/`.

### 5. Write `.munchkins/config.json`

```json
{
  "mode": "consumer-repo",
  "agentsDir": "munchkins/agents",
  "skillsDir": ".claude/skills",
  "bundleEntry": "munchkins/index.ts",
  "integrate": "pr",
  "agentIndexFile": "AGENTS.md"
}
```

Omit fields not yet detected. `agentIndexFile` is filled lazily by new-munchkin on first use if absent here.

### 6. Write the bundle entry

If the configured `bundleEntry` doesn't exist, create it:

```ts
#!/usr/bin/env bun
import { discoverAgents, registry } from "@serranolabs.io/munchkins";

await discoverAgents("./agents");

// Add additional munchkins-bundle imports here:
// import "@my-org/internal-munchkins";

if (import.meta.main) {
  await registry.cli().parseAsync(process.argv);
}
```

Detect any sibling munchkins-bundle packages in `package.json` deps (heuristic: name contains `munchkins`, not equal to `@serranolabs.io/munchkins`) and append side-effect import lines for each.

If the bundle entry already exists, leave it alone. The user has customized it.

### 7. Add `package.json` scripts.munchkins

Add or update:

```json
{
  "scripts": {
    "munchkins": "bun <bundleEntry>"
  }
}
```

Skip if already present and pointing at the same target.

### 8. Scaffold default skills

Copy templates from `node_modules/@serranolabs.io/munchkins/skills/` to `<skillsDir>/`. Skip files that already exist (consumer edits are sacred). This makes the default skills discoverable in Claude Code:

```
/munchkins:bug-fix
/munchkins:feat-small
/munchkins:refactor
/munchkins:launch-munchkin
/munchkins:new-munchkin
```

### 9. Source-repo mode: create symlinks

Only fires in source-repo mode. For each `<name>` in `packages/munchkins/skills/`, create a relative symlink:

```
.claude/skills/<name> → ../../packages/munchkins/skills/<name>
```

Skip if the symlink already exists.

### 10. Done

Print summary:

```
munchkins initialized.
  mode:          <mode>
  agents:        <agentsDir>
  skills:        <skillsDir>
  bundle entry:  <bundleEntry>
  integration:   <integrate>
  agent index:   <agentIndexFile or "none">

Next:
  bun run munchkins --help            # see registered agents
  /munchkins:new-munchkin             # author your first agent
  /munchkins:launch-munchkin          # delegate work to a registered agent
```

## What this skill does NOT do

- Does not author agents (use `/munchkins:new-munchkin`).
- Does not run agents (use `/munchkins:launch-munchkin`).
- Does not install the `@serranolabs.io/munchkins` package itself — user runs `bun add -D` first.
- Does not modify an existing bundle entry — assumes the user has customized it.
- Does not overwrite consumer-edited skills in `.claude/skills/`.
- Does not commit changes.
