const NON_AGENT_SUBCOMMANDS: ReadonlySet<string> = new Set(["daemon", "resume", "status"]);

const ARGV_SKIP_FLAGS: ReadonlySet<string> = new Set([
  "--no-cmux",
  "--help",
  "-h",
  "--version",
  "-v",
  "--dry-run",
]);

interface DelegateDecisionInput {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  hasCmux: boolean;
}

export function shouldDelegateToCmux(input: DelegateDecisionInput): boolean {
  if (!input.hasCmux) return false;
  if (input.env.MUNCHKINS_NO_CMUX === "1") return false;
  for (const arg of input.argv) {
    if (ARGV_SKIP_FLAGS.has(arg)) return false;
  }
  const sub = input.argv[2];
  if (!sub) return false;
  if (sub.startsWith("-")) return false;
  if (NON_AGENT_SUBCOMMANDS.has(sub)) return false;
  return true;
}

interface BuildCmuxCommandInput {
  argv: readonly string[];
  cwd: string;
  now: number;
  env: NodeJS.ProcessEnv;
}

export interface CmuxCommand {
  command: string[];
  workspaceName: string;
}

export function buildCmuxCommand(input: BuildCmuxCommandInput): CmuxCommand {
  const agentName = input.argv[2];
  const workspaceName = `${agentName}-${input.now}`;
  const innerArgs = input.argv.slice(2).filter((a) => a !== "--no-cmux");
  const inner = ["bun", "run", input.argv[1], ...innerArgs];

  // cmux runs the inner command in a context that does NOT reliably inherit
  // the parent shell's environment — most notably MUNCHKINS_CHANGELOG_PATH set
  // by the `munchkins` npm-script wrapper in package.json is lost, causing the
  // agent's changelog entry to land in repoRoot/CHANGELOG.md instead of
  // docs/pages/changelog.md. Propagate any MUNCHKINS_* env var explicitly.
  // MUNCHKINS_NO_CMUX is set unconditionally below to break the recursion.
  const envAssignments = ["MUNCHKINS_NO_CMUX=1"];
  const propagatedKeys = Object.keys(input.env)
    .filter(
      (k) =>
        (k.startsWith("MUNCHKINS_") || k.startsWith("__MUNCHKINS_")) && k !== "MUNCHKINS_NO_CMUX",
    )
    .sort();
  for (const key of propagatedKeys) {
    const value = input.env[key];
    if (value === undefined) continue;
    envAssignments.push(`${key}=${shellEscape(value)}`);
  }
  const innerCommand = `${envAssignments.join(" ")} ${inner.map(shellEscape).join(" ")}`;
  return {
    command: [
      "cmux",
      "new-workspace",
      "--name",
      workspaceName,
      "--cwd",
      input.cwd,
      "--command",
      innerCommand,
    ],
    workspaceName,
  };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
