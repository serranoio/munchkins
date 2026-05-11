const NON_AGENT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "daemon",
  "resume",
  "status",
  "skills",
]);

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
}

export function buildCmuxCommand(input: BuildCmuxCommandInput): string[] {
  const agentName = input.argv[2];
  const innerArgs = input.argv.slice(2).filter((a) => a !== "--no-cmux");
  const inner = ["bun", "run", input.argv[1], ...innerArgs];
  const command = `MUNCHKINS_NO_CMUX=1 ${inner.map(shellEscape).join(" ")}`;
  return [
    "cmux",
    "new-workspace",
    "--name",
    `${agentName}-${input.now}`,
    "--cwd",
    input.cwd,
    "--command",
    command,
  ];
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
