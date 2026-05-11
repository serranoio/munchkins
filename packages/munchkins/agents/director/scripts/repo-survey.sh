#!/usr/bin/env bash
# Step 2 — Repo-survey. Captures `git log`, `gh pr list`, lint/typecheck status
# into a markdown brief the triage step reads alongside PURPOSE.md.
#
# Gates the rest of the pipeline on PURPOSE.md being present at the repo root.

set -euo pipefail

WORKDIR="${WORKTREE:-$PWD}"
REPO="${REPO_ROOT:-$WORKDIR}"

if [ ! -f "$REPO/PURPOSE.md" ]; then
  echo "PURPOSE.md not found at repo root. The director requires a written north star. See docs/pages/agents/director.md." >&2
  exit 1
fi

RUN_ID="$(cat "$WORKDIR/.director/current" 2>/dev/null || true)"
if [ -z "$RUN_ID" ]; then
  echo "[director] repo-survey: .director/current missing — did inflight-survey run?" >&2
  exit 1
fi

RUN_DIR="$WORKDIR/.director/$RUN_ID"
mkdir -p "$RUN_DIR"
OUT="$RUN_DIR/survey.md"

{
  echo "# Director repo survey — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## Recent commits (\`git log --oneline -30\`)"
  echo
  echo '```'
  git -C "$REPO" log --oneline -30 2>&1 || true
  echo '```'
  echo
  echo "## Open PRs (\`gh pr list\`)"
  echo
  if command -v gh >/dev/null 2>&1; then
    echo '```'
    gh pr list --limit 30 2>&1 || echo "(gh pr list failed — likely unauthenticated)"
    echo '```'
  else
    echo "(\`gh\` not on PATH — open PRs unknown)"
  fi
  echo
  echo "## Lint status (\`bun run lint\`)"
  echo
  if (cd "$REPO" && bun run lint >/dev/null 2>&1); then
    echo "PASS"
  else
    echo "FAIL"
  fi
  echo
  echo "## Typecheck status (\`bun run typecheck\`)"
  echo
  if (cd "$REPO" && bun run typecheck >/dev/null 2>&1); then
    echo "PASS"
  else
    echo "FAIL"
  fi
} > "$OUT"

echo "[director] repo-survey wrote $OUT"
