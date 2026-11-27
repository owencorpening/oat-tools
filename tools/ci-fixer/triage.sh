#!/usr/bin/env bash
# CI fixer, step 1: decide what to do about one failed workflow run, and
# gather the evidence for Claude. No AI here: the regression test is plain git.
#
# Env: REPO (owner/name), RUN_ID, GH_TOKEN, CTX (directory for evidence),
#      GITHUB_OUTPUT (optional; gets mode=..., and the values below).
# Run inside a full-history checkout of REPO.
#
# Modes:
#   skip        not on the watched branch, or a later run already passed
#   diagnose    not a regression: same code as the last passing run (an
#               outside cause such as an API, a token or a flaky test), no
#               passing run to compare with, or only bot commits since
#   fix         commits by a person since the last passing run: fix or revert
#   revert-fix  the fixer's own fix commit failed: revert it and its suspects
set -euo pipefail
: "${REPO:?}" "${RUN_ID:?}" "${CTX:?}"
mkdir -p "$CTX"
out() { echo "$1=$2"; [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >>"$GITHUB_OUTPUT"; return 0; }
note() { printf '%s\n' "$*" >>"$CTX/triage.md"; }
: >"$CTX/triage.md"

gh api "repos/$REPO/actions/runs/$RUN_ID" >"$CTX/run.json"
j() { jq -r "$1" "$CTX/run.json"; }
SHA=$(j .head_sha); BRANCH=$(j .head_branch); WF_ID=$(j .workflow_id)
WF_NAME=$(j .name); WF_PATH=$(j .path); RUN_URL=$(j .html_url)
out sha "$SHA"; out branch "$BRANCH"; out workflow_id "$WF_ID"; out run_url "$RUN_URL"
out workflow_name "$WF_NAME"; out workflow_path "$WF_PATH"
note "Failed run: $RUN_URL"
note "Workflow: $WF_NAME ($WF_PATH), branch $BRANCH, commit $SHA"

# Watched branch: the Pages source branch for a Pages build, else the default.
if [[ "$WF_PATH" == dynamic/pages/* ]]; then
  WATCHED=$(gh api "repos/$REPO/pages" -q '.source.branch' 2>/dev/null || true)
  out kind pages
else
  WATCHED=$(gh api "repos/$REPO" -q .default_branch)
  out kind workflow
fi
out watched_branch "$WATCHED"
if [ "$BRANCH" != "$WATCHED" ]; then
  note "Skipped: the run is on $BRANCH, not the watched branch $WATCHED."
  out mode skip; exit 0
fi

# A later run of the same workflow on this branch already passed: nothing to do.
LATEST=$(gh api "repos/$REPO/actions/workflows/$WF_ID/runs?branch=$BRANCH&status=completed&per_page=1" \
  -q '.workflow_runs[0] | "\(.id) \(.conclusion)"')
# (TRIAGE_IGNORE_LATER=1 turns this off, for testing against old runs.)
if [ -z "${TRIAGE_IGNORE_LATER:-}" ] && [ "${LATEST%% *}" != "$RUN_ID" ] && [ "${LATEST#* }" = success ]; then
  note "Skipped: a later run (${LATEST%% *}) already passed."
  out mode skip; exit 0
fi

# Failed-job logs, last 300 lines each (secrets are already masked by GitHub).
: >"$CTX/log.txt"
gh api "repos/$REPO/actions/runs/$RUN_ID/jobs" \
  -q '.jobs[] | select(.conclusion=="failure") | "\(.id)\t\(.name)"' |
while IFS=$'\t' read -r jid jname; do
  { echo "===== job: $jname ($jid), last 300 lines ====="
    gh api "repos/$REPO/actions/jobs/$jid/logs" 2>/dev/null | tail -n 300 || echo "(log unavailable)"
    echo; } >>"$CTX/log.txt"
done
[ -f "$WF_PATH" ] && cp "$WF_PATH" "$CTX/workflow.yml" || true

# The fixer's own commits carry a "CI-fixer:" trailer.
MSG=$(git log -1 --format=%B "$SHA" 2>/dev/null || true)
FIXER=$(printf '%s\n' "$MSG" | sed -n 's/^CI-fixer: *//p' | head -1)
if [ "$FIXER" = fix ]; then
  SUSPECTS=$(printf '%s\n' "$MSG" | sed -n 's/^CI-fixer-suspects: *//p' | head -1)
  echo "$SHA $SUSPECTS" | tr ' ' '\n' | grep . >"$CTX/suspects.txt" || true
  note "The failing commit is the fixer's own fix; it and the commits it fixed get reverted."
  out mode revert-fix; exit 0
fi
if [ -n "$FIXER" ]; then
  note "The failing commit is the fixer's own $FIXER commit; it won't act on its own work again. Diagnose only."
  out mode diagnose; exit 0
fi

# Last pass before this run (not after it: a later manual re-run may have passed).
CREATED=$(j .created_at)
GOOD=$(gh api -X GET "repos/$REPO/actions/workflows/$WF_ID/runs" -f branch="$BRANCH" -f status=success \
  -f created="<$CREATED" -F per_page=1 -q '.workflow_runs[0].head_sha // empty')
out last_good "$GOOD"
if [ -z "$GOOD" ]; then
  note "Not treated as a regression: this workflow has never passed on $BRANCH, so there's nothing to compare with."
  out mode diagnose; exit 0
fi
note "Last passing commit: $GOOD"
if [ "$GOOD" = "$SHA" ]; then
  note "Not a regression: this exact commit passed before. The cause is outside the code (a service, a token, the runner, a flaky test)."
  out mode diagnose; exit 0
fi
if ! git merge-base --is-ancestor "$GOOD" "$SHA" 2>/dev/null; then
  note "Not treated as a regression: the last passing commit isn't an ancestor of this one (history was rewritten)."
  out mode diagnose; exit 0
fi

# Suspects: commits since the last pass, minus bots and the fixer.
git log --reverse --format='%H%x09%an%x09%s' "$GOOD..$SHA" >"$CTX/range.tsv"
awk -F'\t' '$2 !~ /\[bot\]$/ && $2 != "ci-fixer"' "$CTX/range.tsv" | cut -f1 >"$CTX/suspects.txt"
if [ ! -s "$CTX/suspects.txt" ]; then
  note "Not treated as a regression: only bot commits since the last pass."
  out mode diagnose; exit 0
fi
note "Suspect commits (since the last pass, oldest first):"
while read -r s; do note "- $(git log -1 --format='%h %an: %s' "$s")"; done <"$CTX/suspects.txt"
{ for s in $(cat "$CTX/suspects.txt"); do git show --stat --patch --format='commit %H%nAuthor: %an%nDate: %ad%n%n%B' "$s"; done; } \
  | head -c 300000 >"$CTX/suspects.patch"
out mode fix
