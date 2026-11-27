#!/usr/bin/env bash
# CI fixer, step 3: act on Claude's result. Pushes a fix or a revert straight
# to the watched branch, re-runs the failed workflow when it can, and files an
# issue saying what happened.
#
# Env: REPO, MODE (fix|revert-fix|diagnose), CTX, BRANCH, KIND (workflow|pages),
#      WF_ID, WF_NAME, RUN_URL, SHA, TIP (branch tip before Claude ran), GH_TOKEN
set -euo pipefail
: "${REPO:?}" "${MODE:?}" "${CTX:?}" "${BRANCH:?}" "${KIND:?}" "${WF_ID:?}" "${WF_NAME:?}" "${RUN_URL:?}" "${SHA:?}" "${TIP:?}"
MAX_FILES=20
RESULT="$CTX/result.json"
r() { jq -r "$1 // empty" "$RESULT" 2>/dev/null || true; }
short() { for s in "$@"; do printf '%s ' "${s:0:7}"; done | sed 's/ $//'; }
SELF_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$REPO}/actions/runs/${GITHUB_RUN_ID:-}"

git config user.name "ci-fixer"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
# PUSH_URL overrides where to push (for a local test run with your own git
# credentials); in Actions it's the repo with the workflow's token.
git remote set-url origin "${PUSH_URL:-https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git}"

issue() { # title, body
  gh label create ci-fixer --color B60205 --description "Opened by the CI fixer" -R "$REPO" >/dev/null 2>&1 || true
  local n
  n=$(gh issue list -R "$REPO" --label ci-fixer --state open --search "in:title \"$1\"" --json number,title \
        -q ".[] | select(.title == \"$1\") | .number" | head -1)
  if [ -n "$n" ]; then gh issue comment "$n" -R "$REPO" --body "$2" >/dev/null; echo "commented on #$n"
  else gh issue create -R "$REPO" --title "$1" --label ci-fixer --body "$2"; fi
}

rerun() {
  if [ "$KIND" = pages ]; then
    gh api -X POST "repos/$REPO/pages/builds" >/dev/null && echo "requested a Pages build" && return 0
  elif grep -q 'workflow_dispatch' "$CTX/workflow.yml" 2>/dev/null; then
    gh workflow run "$WF_ID" -R "$REPO" --ref "$BRANCH" && echo "re-ran $WF_NAME" && return 0
  fi
  echo "couldn't re-run $WF_NAME automatically"; return 1
}

push() {
  for attempt in 1 2; do
    git push origin "HEAD:$BRANCH" && return 0
    [ $attempt = 1 ] && git pull --rebase origin "$BRANCH"
  done
  return 1
}

# Revert the given commits (newest first) in one commit. Returns 1 on conflict.
revert() { # reason, shas...
  local reason=$1; shift
  local shas=() s
  for s in "$@"; do git cat-file -e "$s^{commit}" 2>/dev/null && shas+=("$s"); done
  [ ${#shas[@]} -gt 0 ] || return 1
  git reset -q --hard "$TIP"; git clean -qfd
  mapfile -t shas < <(git rev-list --no-walk=sorted "${shas[@]}")   # newest first
  git revert --no-commit "${shas[@]}" || { git revert --abort || true; return 1; }
  git commit -q -F - <<EOF
Revert $(short "${shas[@]}"): broke $WF_NAME

$reason

Failed run: $RUN_URL
Fixer run: $SELF_URL

CI-fixer: revert
EOF
}

body_common() {
  printf '%s\n\n' "$(cat "$CTX/triage.md")"
  printf -- '- Fixer run: %s\n' "$SELF_URL"
}

case "$MODE" in
diagnose)
  title="CI failure: $WF_NAME"
  body="$(body_common)

**Verdict:** $(r .verdict)
**Cause:** $(r .cause)
**What to do:** $(r .action)

\`\`\`
$(r .evidence)
\`\`\`

Nothing was changed: this isn't treated as a regression."
  [ -s "$RESULT" ] || body="$(body_common)

Claude didn't produce a diagnosis (see the fixer run). Nothing was changed."
  issue "$title" "$body"
  ;;

fix)
  mapfile -t suspects <"$CTX/suspects.txt"
  verdict=$(r .verdict); mapfile -t offending < <(r '.offending[]?')
  [ ${#offending[@]} -gt 0 ] || offending=("${suspects[@]}")
  # Claude must not commit: if it did, keep its changes but drop the commits.
  [ "$(git rev-parse HEAD)" = "$TIP" ] || git reset -q --soft "$TIP"
  git add -A
  nfiles=$(git diff --cached --name-only | wc -l)
  touched_ci=$(git diff --cached --name-only | grep -c '^\.github/' || true)
  why=""
  if [ "$verdict" != fixed ]; then why="Claude's verdict: ${verdict:-no result}."
  elif [ "$nfiles" -eq 0 ]; then why="Claude reported a fix but changed no files."
  elif [ "$nfiles" -gt "$MAX_FILES" ]; then why="The fix changed $nfiles files (limit $MAX_FILES)."
  elif [ "$touched_ci" -gt 0 ]; then why="The fix changed files under .github/, which the fixer doesn't do."
  fi

  if [ -z "$why" ]; then
    git commit -q -F - <<EOF
Fix $WF_NAME, broken by $(short "${offending[@]}")

$(r .summary)

$(r .fix)

Verified on the runner: $(r .verified_by)

Failed run: $RUN_URL
Fixer run: $SELF_URL

CI-fixer: fix
CI-fixer-suspects: ${offending[*]}
EOF
    push || { issue "CI fixer couldn't push: $WF_NAME" "$(body_common)

The fix was ready but the push to \`$BRANCH\` failed twice. Nothing was changed."; exit 1; }
    fixsha=$(git rev-parse HEAD)
    rerun_note=$(rerun || true)
    issue "CI fixed: $WF_NAME" "$(body_common)

**Fixed** in $fixsha, pushed to \`$BRANCH\`. $rerun_note.

**What broke:** $(r .summary)
**The fix:** $(r .fix)
**Verified by:** $(r .verified_by)

If the re-run fails, the fixer reverts $fixsha and $(short "${offending[@]}") on its own."
    exit 0
  fi

  echo "Not fixing: $why Reverting instead."
  if revert "$why

$(r .summary)" "${offending[@]}" && push; then
    rsha=$(git rev-parse HEAD)
    rerun_note=$(rerun || true)
    issue "CI reverted: $WF_NAME" "$(body_common)

**Reverted** $(short "${offending[@]}") in $rsha, pushed to \`$BRANCH\`. $rerun_note.
Why not fixed: $why

**What broke:** $(r .summary)

Redo the change with the problem fixed, then revert the revert."
  else
    issue "CI broken, couldn't fix or revert: $WF_NAME" "$(body_common)

$why The revert of $(short "${offending[@]}") didn't apply cleanly (or the push failed), so nothing was changed. **The branch is still broken.**

**What broke:** $(r .summary)"
    exit 1
  fi
  ;;

revert-fix)
  mapfile -t suspects <"$CTX/suspects.txt"
  if revert "The fixer's own fix ($(short "$SHA")) failed $WF_NAME, so it and the commits it fixed are reverted." "${suspects[@]}" && push; then
    rsha=$(git rev-parse HEAD)
    rerun_note=$(rerun || true)
    issue "CI reverted: $WF_NAME" "$(body_common)

The fixer's earlier fix didn't hold, so **reverted** $(short "${suspects[@]}") in $rsha, pushed to \`$BRANCH\`. $rerun_note.

Redo the change with the problem fixed, then revert the revert."
  else
    issue "CI broken, couldn't fix or revert: $WF_NAME" "$(body_common)

The fixer's own fix failed and reverting $(short "${suspects[@]}") didn't apply cleanly (or the push failed). Nothing was changed. **The branch is still broken.**"
    exit 1
  fi
  ;;
*) echo "unknown mode $MODE" >&2; exit 2 ;;
esac
