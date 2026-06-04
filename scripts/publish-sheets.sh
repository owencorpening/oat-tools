#!/usr/bin/env bash
# publish-sheets.sh — publish part09 sheets and delete duplicates
# Usage: TOKEN=ya29.xxx bash publish-sheets.sh
#        or: TOKEN=$(gcloud auth application-default print-access-token) bash publish-sheets.sh

set -euo pipefail

TOKEN="${TOKEN:-${GOOGLE_OAUTH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Set TOKEN to a valid OAuth token with Drive scope" >&2
  exit 1
fi

publish() {
  local id="$1" name="$2"
  local resp
  resp=$(curl -sf -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"role":"reader","type":"anyone"}' \
    "https://www.googleapis.com/drive/v3/files/${id}/permissions")
  local perm_id
  perm_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null || echo "ERROR")
  echo "  PUBLISH $name: $perm_id"
}

delete_file() {
  local id="$1" name="$2"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    -H "Authorization: Bearer $TOKEN" \
    "https://www.googleapis.com/drive/v3/files/${id}")
  if [[ "$http_code" == "204" ]]; then
    echo "  DELETE  $name: OK"
  else
    echo "  DELETE  $name: FAILED (HTTP $http_code)"
  fi
}

echo "=== Publishing 8 sheets ==="
publish 13UYEwjc_5Eaeok42bzbHmywQJpj0lfLg7U_r4Blz0SE component
publish 1fk6zEz0UzyI2ntIpETl1GD4jz0BgF-CYJDUH2ZgTC7c component2
publish 1P3iY9-wJnLyo0LoAbmsA-2I4w0JEYRgC4dHHAnNT_ew component3
publish 1cI_1zEp8FPC3EqGMt4laY-RSVfJxiXisFjbhpNNV_SU component4
publish 1ciGlOTPnE8uVoOpXs1ArpPeOtTpNvKZ7sAxN0PTBBWE component5
publish 19oW9sWIUn9KSm0WamOhCYjAhD3SDKVy9G3KpPCALKQk context
publish 1nNjEfh7aLzqXuFZuKo00ZuF1IFwd55z72ZRCBCcfVX8 revenueStream
publish 1QNf-xsHNTyH9vyE_D5qcvv08NAiROgDqca6iQoSLGuk year

echo ""
echo "=== Deleting duplicates ==="
delete_file 1XubJdUKj_BrDzCOCG8ADvJtfu399hTQafMtvKpxi3Xw "component5-duplicate"
delete_file 1vNFVNh6EPJJhCk30NN8CZVipQ6wnqQZmQU54QwDtfyE "revenueStream-TEST"

echo ""
echo "Done."
