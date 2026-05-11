#!/usr/bin/env bash
# Step 6 — Dispatch. Reads triage.json + plan.md, derives the target munchkin
# from work_type, then runs the child as a foreground subprocess. Early-exits
# on upstream idle and short-circuits to a print-only path when
# $__MUNCHKINS_OPT_dryRun is "true".

set -euo pipefail

WORKDIR="${WORKTREE:-$PWD}"
REPO="${REPO_ROOT:-$WORKDIR}"

RUN_ID="$(cat "$WORKDIR/.director/current" 2>/dev/null || true)"
if [ -z "$RUN_ID" ]; then
  echo "[director] dispatch: .director/current missing — pipeline did not initialize" >&2
  exit 1
fi

RUN_DIR="$WORKDIR/.director/$RUN_ID"
TRIAGE="$RUN_DIR/triage.json"
PLAN="$RUN_DIR/plan.md"

# Upstream-idle guard: if any upstream artifact says idle, exit 0.
if [ -f "$TRIAGE" ] && grep -qE '"idle"[[:space:]]*:[[:space:]]*true' "$TRIAGE"; then
  echo "[director] dispatch: triage idle — nothing to do"
  exit 0
fi
if [ -f "$PLAN" ] && head -n 5 "$PLAN" | grep -qE '"idle"[[:space:]]*:[[:space:]]*true'; then
  echo "[director] dispatch: plan idle — nothing to do"
  exit 0
fi

if [ ! -f "$TRIAGE" ] || [ ! -f "$PLAN" ]; then
  echo "[director] dispatch: missing triage.json or plan.md in $RUN_DIR" >&2
  exit 1
fi

# Extract work_type. Use a Bun one-liner so we don't ship a shell JSON parser.
work_type="$(bun -e '
  const t = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf-8"));
  process.stdout.write(String(t.work_type ?? ""));
' "$TRIAGE")"

case "$work_type" in
  feature) target="feat-small" ;;
  bug-fix) target="bug-fix" ;;
  refactor) target="refactor" ;;
  performance) target="refactor" ;; # Phase 1 mapping; replaced by `performance` in Phase 2.
  *)
    echo "[director] dispatch: unknown work_type \"$work_type\" in $TRIAGE" >&2
    exit 1
    ;;
esac

cmd=(bun run munchkins "$target" "--user-message=$PLAN" "--branch-prefix=director")

if [ "${__MUNCHKINS_OPT_dryRun:-}" = "true" ]; then
  echo "[director] dispatch (dry-run): ${cmd[*]}"
  exit 0
fi

echo "[director] dispatch: ${cmd[*]}"
cd "$REPO"
exec "${cmd[@]}"
