import { spawnClaude } from "./spawn-claude.js";

export const SLUG_MAX = 30;
const SLUG_MIN_TRUNCATION_BOUNDARY = 15;

const SLUG_SYSTEM_PROMPT = [
  "You generate a short kebab-case slug describing the user's task.",
  "Output ONLY the slug — no quotes, no explanation, no markdown.",
  `Max ${SLUG_MAX} characters. Lowercase letters, digits, and hyphens only.`,
  'Examples: "fix-login-redirect-bug", "add-user-export-csv", "refactor-billing-service".',
].join("\n");

const RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000];
const SLUG_TIMEOUT_MS = 15_000;

export function sanitize(raw: string): string {
  if (!raw) return "";
  let candidate = "";
  const h1 = raw.match(/^#\s+(.+)$/m);
  if (h1) {
    candidate = h1[1].trim();
  } else {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        candidate = trimmed;
        break;
      }
    }
  }
  const kebab = candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!kebab) return "";
  if (kebab.length <= SLUG_MAX) return kebab;
  const cut = kebab.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf("-");
  if (lastDash >= SLUG_MIN_TRUNCATION_BOUNDARY) return cut.slice(0, lastDash);
  return cut.replace(/-+$/g, "");
}

export function deriveSlugDeterministic(text: string): string {
  return sanitize(text);
}

export interface SlugFallback {
  attempts: number;
  lastError?: string;
}

export interface SlugResult {
  slug: string;
  fallback?: SlugFallback;
}

export async function getSlugWithRetry(
  userMessage: string,
  opts: {
    cwd?: string;
    spawn?: typeof spawnClaude;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SlugResult> {
  const spawn = opts.spawn ?? spawnClaude;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const cwd = opts.cwd ?? process.cwd();
  let lastError: string | undefined;
  for (let attemptIndex = 0; attemptIndex < RETRY_DELAYS_MS.length; attemptIndex++) {
    const delay = RETRY_DELAYS_MS[attemptIndex];
    if (delay > 0) await sleep(delay);
    try {
      const result = await spawn({
        systemPrompt: SLUG_SYSTEM_PROMPT,
        userPrompt: userMessage,
        cwd,
        model: "haiku",
        disallowedTools: ["*"],
        abortSignal: AbortSignal.timeout(SLUG_TIMEOUT_MS),
      });
      if (result.exitCode !== 0) {
        lastError = `exit ${result.exitCode}`;
        continue;
      }
      const cleaned = sanitize(result.output);
      if (cleaned) return { slug: cleaned };
      lastError = "empty slug";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  const fallback = deriveSlugDeterministic(userMessage);
  return {
    slug: fallback,
    fallback: { attempts: RETRY_DELAYS_MS.length, lastError },
  };
}
