export type ParseSummaryWriterJsonResult =
  | { ok: true; commitMessage: string; markdown: string }
  | { ok: false; reason: string };

export function parseSummaryWriterJson(rawOutput: string): ParseSummaryWriterJsonResult {
  let cleaned = rawOutput.trimEnd();
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3).trimEnd();

  // Enumerate every top-level balanced { ... } in `cleaned`, string-aware so
  // braces inside JSON string literals don't throw off the depth counter.
  const candidates: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let j = i;
    for (; j < cleaned.length; j++) {
      const c = cleaned[j];
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (c === "\\" && inString) {
        isEscaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    candidates.push(cleaned.slice(i, j + 1));
    i = j + 1;
  }

  // Try last-to-first; first parseable object with the right keys wins. This
  // is what makes the parser robust against models emitting the envelope twice.
  for (let idx = candidates.length - 1; idx >= 0; idx--) {
    let parsed: { commitMessage?: unknown; markdown?: unknown };
    try {
      parsed = JSON.parse(candidates[idx]) as {
        commitMessage?: unknown;
        markdown?: unknown;
      };
    } catch {
      continue;
    }
    if (typeof parsed.commitMessage === "string" && typeof parsed.markdown === "string") {
      return { ok: true, commitMessage: parsed.commitMessage, markdown: parsed.markdown };
    }
  }

  return {
    ok: false,
    reason:
      candidates.length === 0
        ? `no JSON object found in output`
        : `no parseable JSON object with string commitMessage and markdown found in output (${candidates.length} candidate object(s) inspected)`,
  };
}
