#!/usr/bin/env bash
set -euo pipefail

# Weekly check: for every git-tracked Apps Script project (any directory
# under the scan root with a committed .clasp.json), clasp-pull the live
# version into a scratch copy and diff it against the git HEAD copy.
#
# Pull-and-flag only — never writes into the real project directory, never
# pushes, never commits. A found difference is reported and the whole run
# exits non-zero so OnFailure=notify-failure@%n.service fires; reconciling
# drift (like ghost-tracker's manual reconcile-and-diff-report flow) stays
# a deliberate, reviewed action, not something this script does for you.
#
# Usage: check.sh [scan-root]   (default: ~/dev)

SCAN_ROOT="${1:-$HOME/dev}"
REPORT_DIR=~/oat-data/apps-script-drift-check
mkdir -p "$REPORT_DIR"
STAMP=$(date +%Y%m%d)

SCRATCH_ROOT=$(mktemp -d)
trap 'rm -rf "$SCRATCH_ROOT"' EXIT

CHECKED=0
DRIFTED=()

while IFS= read -r -d '' clasp_json; do
  project_dir=$(dirname "$clasp_json")
  # Skip anything under node_modules or a prior scratch/temp copy of itself
  case "$project_dir" in */node_modules/*) continue ;; esac

  CHECKED=$((CHECKED + 1))
  rel="${project_dir#"$HOME"/}"
  label=$(echo "$rel" | tr '/' '_')
  scratch="$SCRATCH_ROOT/$label"
  mkdir -p "$scratch"
  cp "$clasp_json" "$scratch/.clasp.json"

  if ! (cd "$scratch" && clasp pull >/dev/null 2>&1); then
    DRIFTED+=("$rel (clasp pull failed — check auth/network)")
    continue
  fi

  # Compare only the files clasp actually pulled (the live project's real
  # file set) against their same-named counterpart in git, if any. The
  # project directory can and does hold unrelated files alongside the
  # Apps Script source (companion client JS, a Python bridge script,
  # __pycache__, etc.) — those aren't part of the live project and must
  # not be reported as "drift" just for not existing on the live side.
  out="$REPORT_DIR/${label}-${STAMP}.diff"
  : > "$out"
  file_drifted=0
  while IFS= read -r -d '' live_file; do
    fname=$(basename "$live_file")
    [ "$fname" = ".clasp.json" ] && continue
    git_file="$project_dir/$fname"
    if [ ! -f "$git_file" ]; then
      echo "=== $rel/$fname: exists live, not tracked in git ===" >> "$out"
      file_drifted=1
    elif ! diff -u "$git_file" "$live_file" >> "$out" 2>&1; then
      file_drifted=1
    fi
  done < <(find "$scratch" -maxdepth 1 -type f -print0)

  if [ "$file_drifted" -eq 1 ]; then
    DRIFTED+=("$rel")
    echo "DRIFT: $rel (see $out)"
  else
    rm -f "$out"   # clean run — don't accumulate noise
  fi
done < <(find "$SCAN_ROOT" -not -path '*/node_modules/*' -iname '.clasp.json' -print0)

if [ "$CHECKED" -eq 0 ]; then
  echo "Apps Script drift check: no .clasp.json found under $SCAN_ROOT — nothing to check."
  exit 0
fi

if [ "${#DRIFTED[@]}" -gt 0 ]; then
  echo "Apps Script drift found in ${#DRIFTED[@]} of $CHECKED project(s):"
  printf '  - %s\n' "${DRIFTED[@]}"
  echo "See $REPORT_DIR/ for diffs. Reconcile manually — this check never auto-applies changes."
  exit 1
fi

echo "Apps Script drift check: all clear, $CHECKED project(s) checked."
