#!/usr/bin/env bash
# Step 1 — Survey. Queries open GitHub issues labeled `bot:fix-me`, filters out
# anything already locked (`bot:in-progress`) or marked failed
# (`bot:fix-failed`), and writes a markdown brief for the triage step.
#
# Best-effort on `gh`: if the CLI is missing or unauthenticated, the survey
# falls back to "no eligible issues" rather than failing the tick.

set -euo pipefail

WORKDIR="${WORKTREE:-$PWD}"
IF_ROOT="$WORKDIR/.issue-fixer"

RUN_ID="$(date -u +%Y%m%dT%H%M%S)-${RANDOM}${RANDOM}"
RUN_DIR="$IF_ROOT/$RUN_ID"
mkdir -p "$RUN_DIR"
printf '%s' "$RUN_ID" > "$IF_ROOT/current"

OUT="$RUN_DIR/issues.md"

issues_json="[]"
if command -v gh >/dev/null 2>&1; then
  if raw="$(gh issue list \
      --label "bot:fix-me" \
      --state open \
      --json number,title,body,labels,url \
      --limit 10 2>/dev/null)"; then
    issues_json="$raw"
  fi
fi

# Filter + render via Bun so we don't ship a shell JSON parser. Drops issues
# whose label list contains `bot:in-progress` or `bot:fix-failed`.
bun -e '
  const issues = JSON.parse(process.argv[1]);
  const skip = new Set(["bot:in-progress", "bot:fix-failed"]);
  const labelNames = (i) => (i.labels ?? []).map((l) => l.name ?? l);
  const eligible = issues.filter((i) => !labelNames(i).some((l) => skip.has(l)));
  const lines = [];
  lines.push(`# Issue-fixer survey — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Eligible issues: ${eligible.length}`);
  lines.push("");
  if (eligible.length === 0) {
    lines.push("(no open issues carry `bot:fix-me` without a blocking label)");
  } else {
    for (const i of eligible) {
      lines.push(`## #${i.number} — ${i.title}`);
      lines.push("");
      lines.push(`- URL: ${i.url}`);
      lines.push(`- Labels: ${labelNames(i).join(", ")}`);
      lines.push("");
      lines.push("### Body");
      lines.push("");
      lines.push(i.body || "(empty body)");
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }
  await Bun.write(process.argv[2], lines.join("\n"));
' "$issues_json" "$OUT"

echo "[issue-fixer] survey wrote $OUT (run-id=$RUN_ID)"
