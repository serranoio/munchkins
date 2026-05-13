#!/usr/bin/env bash
# Step 3 — Dispatch. Reads dispatch.json + payload.md, labels the chosen issue
# `bot:in-progress`, then exec's the matching child munchkin with
# `--integrate=pr`. Honors $__MUNCHKINS_OPT_dryRun (skip side effects, print
# would-be command). Idle dispatch.json is a no-op (with an optional comment).

set -euo pipefail

WORKDIR="${WORKTREE:-$PWD}"
REPO="${REPO_ROOT:-$WORKDIR}"

RUN_ID="$(cat "$WORKDIR/.issue-fixer/current" 2>/dev/null || true)"
if [ -z "$RUN_ID" ]; then
  echo "[issue-fixer] dispatch: .issue-fixer/current missing — pipeline did not initialize" >&2
  exit 1
fi

RUN_DIR="$WORKDIR/.issue-fixer/$RUN_ID"
DISPATCH="$RUN_DIR/dispatch.json"

if [ ! -f "$DISPATCH" ]; then
  echo "[issue-fixer] dispatch: $DISPATCH missing — triage step did not write it" >&2
  exit 1
fi

DRY_RUN="${__MUNCHKINS_OPT_dryRun:-}"

# Parse dispatch.json once via Bun and emit a shell-eval'able snippet.
eval "$(bun -e '
  const fs = require("node:fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
  const esc = (v) => `'"'"'${String(v).replace(/'"'"'/g, "'"'"'\\'"'"''"'"'")}'"'"'`;
  if (d.idle) {
    process.stdout.write(`IDLE=1\n`);
    process.stdout.write(`REASON=${esc(d.reason ?? "")}\n`);
    process.stdout.write(`COMMENT_ON=${esc(d.comment_on ?? "")}\n`);
    process.stdout.write(`COMMENT_BODY=${esc(d.comment_body ?? "")}\n`);
  } else {
    process.stdout.write(`IDLE=0\n`);
    process.stdout.write(`ISSUE_NUMBER=${esc(d.issue_number ?? "")}\n`);
    process.stdout.write(`WORK_TYPE=${esc(d.work_type ?? "")}\n`);
    process.stdout.write(`BRANCH_SLUG=${esc(d.branch_slug ?? "")}\n`);
  }
' "$DISPATCH")"

if [ "${IDLE:-0}" = "1" ]; then
  echo "[issue-fixer] dispatch: idle — ${REASON:-no reason}"
  if [ -n "${COMMENT_ON:-}" ] && [ -n "${COMMENT_BODY:-}" ]; then
    if [ "$DRY_RUN" = "true" ]; then
      echo "[issue-fixer] dispatch (dry-run): would comment on #${COMMENT_ON}: ${COMMENT_BODY}"
    elif command -v gh >/dev/null 2>&1; then
      gh issue comment "$COMMENT_ON" --body "$COMMENT_BODY" >/dev/null && \
        echo "[issue-fixer] commented on #${COMMENT_ON}"
    else
      echo "[issue-fixer] dispatch: skipping comment (gh not on PATH)"
    fi
  fi
  exit 0
fi

PAYLOAD="$RUN_DIR/payload.md"
if [ ! -f "$PAYLOAD" ]; then
  echo "[issue-fixer] dispatch: payload.md missing for non-idle dispatch.json" >&2
  exit 1
fi

case "$WORK_TYPE" in
  bug-fix)  target="bug-fix" ;;
  refactor) target="refactor" ;;
  feature)  target="feat-small" ;;
  *)
    echo "[issue-fixer] dispatch: unknown work_type \"$WORK_TYPE\"" >&2
    exit 1
    ;;
esac

branch_prefix="issue-${ISSUE_NUMBER}"

cmd=(bun run munchkins "$target" "--user-message=$PAYLOAD" "--branch-prefix=$branch_prefix" "--integrate=pr")

if [ "$DRY_RUN" = "true" ]; then
  echo "[issue-fixer] dispatch (dry-run): issue #${ISSUE_NUMBER} → ${target}: ${cmd[*]}"
  exit 0
fi

# Soft lock — label first so a racing tick sees `bot:in-progress` and skips.
if command -v gh >/dev/null 2>&1; then
  gh issue edit "$ISSUE_NUMBER" --add-label "bot:in-progress" >/dev/null || \
    echo "[issue-fixer] dispatch: failed to add bot:in-progress label (continuing)" >&2
fi

echo "[issue-fixer] dispatch: issue #${ISSUE_NUMBER} → ${target}: ${cmd[*]}"
cd "$REPO"

set +e
"${cmd[@]}"
child_exit=$?
set -e

if command -v gh >/dev/null 2>&1; then
  gh issue edit "$ISSUE_NUMBER" --remove-label "bot:in-progress" >/dev/null || true
  if [ "$child_exit" -eq 0 ]; then
    gh issue edit "$ISSUE_NUMBER" --add-label "bot:fixed" >/dev/null || true
  else
    gh issue edit "$ISSUE_NUMBER" --add-label "bot:fix-failed" >/dev/null || true
    run_url=""
    if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
      run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
    fi
    body="Issue-fixer dispatch to \`${target}\` failed (exit ${child_exit})."
    if [ -n "$run_url" ]; then
      body="${body} Workflow run: ${run_url}"
    fi
    gh issue comment "$ISSUE_NUMBER" --body "$body" >/dev/null || true
  fi
fi

exit "$child_exit"
