#!/usr/bin/env bash
# Write .github/workflows/fix-failed-build.yml into each repo (committed
# straight to its default branch through the GitHub API), watching every
# workflow the repo runs except Dependabot's and the fixer itself.
#
#   tools/ci-fixer/install-callers.sh [--dry-run] repo [repo ...]
#
# Rerun it after adding or renaming a workflow in a repo: it rewrites the file
# with the current workflow names, and does nothing if they haven't changed.
# The repo also needs the CLAUDE_CODE_OAUTH_TOKEN secret (set-claude-token.sh).
set -euo pipefail
OWNER=owencorpening
DRY=0; [ "${1:-}" = --dry-run ] && { DRY=1; shift; }
[ $# -gt 0 ] || { echo "usage: $0 [--dry-run] repo [repo ...]" >&2; exit 2; }
FILE=.github/workflows/fix-failed-build.yml

for repo in "$@"; do
  # Names to watch. GitHub's Pages workflow is listed as "pages-build-deployment"
  # but its runs are named "pages build and deployment"; watch both.
  mapfile -t names < <(gh api "repos/$OWNER/$repo/actions/workflows" -q '.workflows[]
      | select(.path | startswith("dynamic/dependabot") | not)
      | select(.path != ".github/workflows/fix-failed-build.yml")
      | select(.name != "CI fixer")
      | .name' | sort -u)
  if printf '%s\n' "${names[@]}" | grep -qx 'pages-build-deployment'; then
    names+=("pages build and deployment")
  fi
  [ ${#names[@]} -gt 0 ] || { echo "$repo: no workflows to watch, skipped"; continue; }
  list=$(printf '"%s", ' "${names[@]}"); list="[${list%, }]"

  content=$(cat <<EOF
# CI fixer: when a workflow below fails, check whether a commit broke it. If
# so, fix it (or revert the commit) straight on the branch and open an issue;
# if not, open an issue with a diagnosis. The logic lives in
# owencorpening/oat-tools (.github/workflows/fix-failed-build.yml and
# tools/ci-fixer/). Written by tools/ci-fixer/install-callers.sh; rerun that
# after adding or renaming a workflow here.
name: Fix failed build

on:
  workflow_run:
    workflows: $list
    types: [completed]

permissions:
  contents: write   # push the fix or the revert
  issues: write     # report what it did
  actions: write    # read the failed logs; re-run the workflow
  pages: write      # request a Pages build after a fix

jobs:
  fix:
    if: github.event.workflow_run.conclusion == 'failure'
    uses: owencorpening/oat-tools/.github/workflows/fix-failed-build.yml@main
    with:
      run_id: \${{ github.event.workflow_run.id }}
      head_branch: \${{ github.event.workflow_run.head_branch }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
EOF
)
  if [ $DRY = 1 ]; then echo "== $repo"; echo "$content"; continue; fi

  branch=$(gh api "repos/$OWNER/$repo" -q .default_branch)
  old=$(gh api "repos/$OWNER/$repo/contents/$FILE?ref=$branch" -q '.sha + " " + .content' 2>/dev/null || true)
  sha=${old%% *}
  if [ -n "$old" ] && [ "$(printf '%s' "${old#* }" | tr -d '\n' | base64 -d)" = "$content" ]; then
    echo "$repo: up to date"; continue
  fi
  args=(-X PUT "repos/$OWNER/$repo/contents/$FILE" -f branch="$branch"
        -f message="Add the CI fixer (fix-failed-build.yml)"$'\n\n'"Watches: ${names[*]}"
        -f content="$(printf '%s\n' "$content" | base64 -w0)")
  [ -n "$old" ] && args+=(-f sha="$sha")
  gh api "${args[@]}" -q '"'"$repo"': committed " + .commit.sha[0:7] + " to '"$branch"'"'
done
