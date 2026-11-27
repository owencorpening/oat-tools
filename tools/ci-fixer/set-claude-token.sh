#!/usr/bin/env bash
# Store a Claude Code OAuth token as the CLAUDE_CODE_OAUTH_TOKEN secret in
# every owencorpening repo that runs a workflow file or a GitHub Pages build
# (or the repos named on the command line). The fix-failed-build workflow uses it.
#
#   1. claude setup-token          (browser sign-in; copy the token it prints)
#   2. tools/ci-fixer/set-claude-token.sh [repo ...]
#
# The token is read from a hidden prompt and piped to `gh secret set` on
# stdin: it never appears on screen, in shell history or in process arguments.
# It's also kept in the system keyring (secret-tool: service ci-fixer, account
# claude-oauth-token), so later runs reuse it without asking. --new asks again
# and replaces the kept one.
# Rerun it when you add a repo with a workflow, or when the token is replaced.
set -euo pipefail
OWNER=owencorpening
NEW=0; [ "${1:-}" = --new ] && { NEW=1; shift; }
KEYRING=(service ci-fixer account claude-oauth-token)

if [ $# -gt 0 ]; then
  repos=("$@")
else
  echo "Finding repos with workflows (about a minute)..."
  mapfile -t repos < <(
    gh repo list "$OWNER" --limit 200 --json name,isFork,isArchived \
      -q '.[] | select((.isFork or .isArchived) | not) | .name' |
    while read -r r; do
      # Workflow files and GitHub Pages builds count; Dependabot's
      # dependency-graph job doesn't (nothing committed can break it).
      n=$(gh api "repos/$OWNER/$r/actions/workflows" \
            -q '[.workflows[] | select(.path | startswith("dynamic/dependabot") | not)] | length' 2>/dev/null || true)
      printf '.' >&2
      [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -gt 0 ] && echo "$r"
    done
  )
  echo >&2
fi
[ ${#repos[@]} -gt 0 ] || { echo "No repos with workflows found." >&2; exit 1; }
echo "Repos: ${repos[*]}"

token=""
if [ $NEW = 0 ] && command -v secret-tool >/dev/null; then
  token=$(secret-tool lookup "${KEYRING[@]}" 2>/dev/null || true)
  [ -n "$token" ] && echo "Using the token kept in the keyring (--new to replace it)."
fi
from_prompt=0
if [ -z "$token" ]; then
  read -rsp "Paste the token from 'claude setup-token' (hidden), then Enter: " token; echo
  from_prompt=1
fi
token="${token//[[:space:]]/}"
[ -n "$token" ] || { echo "No token entered." >&2; exit 1; }
# Show only the type prefix and the length, never the token itself.
if [[ "$token" == sk-ant-oat* ]]; then
  echo "Got an OAuth token (sk-ant-oat..., ${#token} characters)."
else
  echo "That doesn't look like a 'claude setup-token' token (expected sk-ant-oat...). Nothing stored." >&2
  exit 1
fi

if [ $from_prompt = 1 ] && command -v secret-tool >/dev/null; then
  printf '%s' "$token" | secret-tool store --label="CI fixer: Claude Code OAuth token" "${KEYRING[@]}" \
    && echo "Kept it in the keyring for next time."
fi

for r in "${repos[@]}"; do
  printf '%s' "$token" | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$OWNER/$r" >/dev/null
  echo "  set in $r"
done
unset token
echo "Done. Check with: gh secret list -R $OWNER/<repo>"
