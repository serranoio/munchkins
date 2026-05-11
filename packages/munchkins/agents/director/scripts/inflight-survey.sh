#!/usr/bin/env bash
# Step 1 — Inflight-survey. Inventories all director-spawned work currently
# in flight: open director/* PRs (when `gh` is available + authed), local
# director/* branches, and director-namespaced worktrees.

set -euo pipefail

WORKDIR="${WORKTREE:-$PWD}"
DIRECTOR_ROOT="$WORKDIR/.director"

# Derive a stable, sortable run id and remember it for downstream steps.
RUN_ID="$(date -u +%Y%m%dT%H%M%S)-${RANDOM}${RANDOM}"
RUN_DIR="$DIRECTOR_ROOT/$RUN_ID"
mkdir -p "$RUN_DIR"
printf '%s' "$RUN_ID" > "$DIRECTOR_ROOT/current"

OUT="$RUN_DIR/inflight.json"

# Branch inventory (always available).
branches=()
while IFS= read -r br; do
  br="${br#"${br%%[![:space:]]*}"}"
  [ -n "$br" ] && branches+=("$br")
done < <(git -C "$WORKDIR" branch --list 'director/*' --format='%(refname:short)' 2>/dev/null || true)

# Worktree inventory (filter porcelain output for director-namespaced branches).
worktrees=()
if git -C "$WORKDIR" worktree list --porcelain >/dev/null 2>&1; then
  current_path=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) current_path="${line#worktree }" ;;
      "branch refs/heads/director/"*)
        wbranch="${line#branch refs/heads/}"
        worktrees+=("$current_path|$wbranch")
        ;;
      "")
        current_path=""
        ;;
    esac
  done < <(git -C "$WORKDIR" worktree list --porcelain)
fi

# Open PRs against director/* heads. Best-effort: skip silently if `gh` is
# missing or unauthenticated — the local inventory is still useful.
pr_json="[]"
if command -v gh >/dev/null 2>&1; then
  if pr_json_raw="$(gh pr list --head 'director/*' --state open \
      --json number,title,headRefName,files 2>/dev/null)"; then
    pr_json="$pr_json_raw"
  fi
fi

# Compose final JSON. Branches and worktrees are flat string arrays; PRs is
# whatever `gh` emitted (already JSON). Idle case is the empty triplet — the
# triage step treats it as "nothing in flight".
{
  printf '{\n'
  printf '  "branches": ['
  if [ "${#branches[@]}" -gt 0 ]; then
    sep=""
    for b in "${branches[@]}"; do
      esc="${b//\\/\\\\}"
      esc="${esc//\"/\\\"}"
      printf '%s"%s"' "$sep" "$esc"
      sep=", "
    done
  fi
  printf '],\n'
  printf '  "worktrees": ['
  if [ "${#worktrees[@]}" -gt 0 ]; then
    sep=""
    for w in "${worktrees[@]}"; do
      p="${w%%|*}"
      bv="${w##*|}"
      printf '%s{"path": "%s", "branch": "%s"}' "$sep" "${p//\"/\\\"}" "${bv//\"/\\\"}"
      sep=", "
    done
  fi
  printf '],\n'
  printf '  "prs": %s\n' "$pr_json"
  printf '}\n'
} > "$OUT"

echo "[director] inflight-survey wrote $OUT (run-id=$RUN_ID)"
