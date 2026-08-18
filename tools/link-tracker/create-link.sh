#!/usr/bin/env bash
# create-link.sh — create a new tracked link on oat-link-tracker
# Usage: ./create-link.sh <slug> <destination-url> <campaign-label>
#   Requires ADMIN_TOKEN env var (or LINK_TRACKER_TOKEN), set once via:
#     export LINK_TRACKER_TOKEN="$(wrangler secret list ...)"  # can't retrieve after the fact —
#     if you don't have it saved, generate + set a new one:
#       wrangler secret put ADMIN_TOKEN   (from tools/link-tracker/worker/)
set -euo pipefail

SLUG="${1:?Usage: create-link.sh <slug> <destination-url> <campaign-label>}"
DEST="${2:?Usage: create-link.sh <slug> <destination-url> <campaign-label>}"
CAMPAIGN="${3:?Usage: create-link.sh <slug> <destination-url> <campaign-label>}"

TOKEN="${LINK_TRACKER_TOKEN:-${ADMIN_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Set LINK_TRACKER_TOKEN (or ADMIN_TOKEN) env var first." >&2
  exit 1
fi

curl -s -X POST "https://oat-link-tracker.owencorpening.workers.dev/admin/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"slug\":\"$SLUG\",\"destination_url\":\"$DEST\",\"campaign_label\":\"$CAMPAIGN\"}" \
  | python3 -m json.tool
