#!/usr/bin/env bash
# render-table-pngs.sh — fetch sheet data, render HTML→PNG for each OAT table
# Usage: bash render-table-pngs.sh [images-base-dir]
#   Primary auth: credentials/service-account.json (relative to script dir)
#   Fallback auth: TOKEN or GOOGLE_OAUTH_TOKEN env var
#
# Requires: curl, google-chrome, convert (ImageMagick), python3, google-auth

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SA_FILE="${SCRIPT_DIR}/../credentials/service-account.json"

if [[ -f "$SA_FILE" ]]; then
  echo "Auth: service account ($SA_FILE)"
  TOKEN=$(/home/owen/.venv/songster/bin/python3 - "$SA_FILE" <<'PYAUTH'
import sys
from google.oauth2 import service_account
import google.auth.transport.requests

creds = service_account.Credentials.from_service_account_file(
  sys.argv[1],
  scopes=[
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ]
)
creds.refresh(google.auth.transport.requests.Request())
print(creds.token)
PYAUTH
)
else
  TOKEN="${TOKEN:-${GOOGLE_OAUTH_TOKEN:-}}"
fi

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: No credentials/service-account.json found and TOKEN env var not set" >&2
  exit 1
fi

IMAGES_BASE="${1:-/home/owen/dev/images/water-series/part-09}"
TMPDIR_RENDER="$(mktemp -d /tmp/oat-render-XXXXXX)"
trap 'rm -rf "$TMPDIR_RENDER"' EXIT

# ── OAT CSS ─────────────────────────────────────────────────────────────────
OAT_CSS='
  body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; display: inline-block; }
  table { border-collapse: collapse; white-space: nowrap; table-layout: auto; width: max-content; }
  th {
    background: #005f73; color: #fff;
    font-family: Arial, sans-serif; font-size: 11pt; font-weight: bold;
    padding: 8px 14px; vertical-align: middle;
    border-bottom: 3px solid #94d2bd;
  }
  th + th { border-left: 1px solid #94d2bd; }
  td {
    font-family: Arial, sans-serif; font-size: 10pt; color: #000;
    padding: 7px 14px; vertical-align: middle;
  }
  td + td { border-left: 1px solid #94d2bd; }
  tr.odd  td { background: #ffffff; }
  tr.even td { background: #f0f7f8; }
'

fetch_values() {
  local sheet_id="$1"
  # Get all values from Sheet1 (A1:Z100 is wide enough)
  curl -sf \
    -H "Authorization: Bearer $TOKEN" \
    "https://sheets.googleapis.com/v4/spreadsheets/${sheet_id}/values/Sheet1!A1:Z100"
}

generate_html() {
  local json="$1"
  local out_html="$2"

  # Parse rows from JSON using python3 (built-in, no deps)
  python3 - "$json" "$out_html" "$OAT_CSS" <<'PYEOF'
import sys, json

json_file, out_html, css = sys.argv[1], sys.argv[2], sys.argv[3]
with open(json_file) as f:
  data = json.load(f)

rows = data.get('values', [])
if not rows:
  print("WARNING: no values in sheet", file=sys.stderr)
  sys.exit(1)

headers = rows[0]
data_rows = rows[1:]

# Pad rows to header length
ncols = len(headers)
data_rows = [r + [''] * (ncols - len(r)) for r in data_rows]

th_html = ''.join(f'<th>{h}</th>' for h in headers)
tr_html = ''
for i, row in enumerate(data_rows):
  cls = 'even' if (i + 1) % 2 == 0 else 'odd'
  tds = ''.join(f'<td>{cell}</td>' for cell in row[:ncols])
  tr_html += f'<tr class="{cls}">{tds}</tr>\n'

html = f'''<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>{css}</style>
</head><body>
<table>
<thead><tr>{th_html}</tr></thead>
<tbody>{tr_html}</tbody>
</table>
</body></html>'''

with open(out_html, 'w') as f:
  f.write(html)
print(f"HTML written: {out_html}")
PYEOF
}

screenshot_html() {
  local html="$1"
  local out_png="$2"
  local tmp_png="${TMPDIR_RENDER}/raw-$(basename "$out_png")"

  google-chrome \
    --headless \
    --disable-gpu \
    --no-sandbox \
    --hide-scrollbars \
    --screenshot="$tmp_png" \
    --window-size=2400,900 \
    "file://${html}" \
    2>/dev/null

  # Trim whitespace, add 10px white border
  convert "$tmp_png" \
    -trim +repage \
    -bordercolor white -border 10 \
    "$out_png"

  local dims
  dims=$(identify -format "%wx%h" "$out_png")
  echo "  PNG: $dims → $out_png"
}

# ── Main loop ────────────────────────────────────────────────────────────────

declare -A SHEETS=(
  [part09-table-component]=13UYEwjc_5Eaeok42bzbHmywQJpj0lfLg7U_r4Blz0SE
  [part09-table-component2]=1fk6zEz0UzyI2ntIpETl1GD4jz0BgF-CYJDUH2ZgTC7c
  [part09-table-component3]=1P3iY9-wJnLyo0LoAbmsA-2I4w0JEYRgC4dHHAnNT_ew
  [part09-table-component4]=1cI_1zEp8FPC3EqGMt4laY-RSVfJxiXisFjbhpNNV_SU
  [part09-table-component5]=1ciGlOTPnE8uVoOpXs1ArpPeOtTpNvKZ7sAxN0PTBBWE
  [part09-table-context]=19oW9sWIUn9KSm0WamOhCYjAhD3SDKVy9G3KpPCALKQk
  [part09-table-revenueStream]=1nNjEfh7aLzqXuFZuKo00ZuF1IFwd55z72ZRCBCcfVX8
  [part09-table-year]=1QNf-xsHNTyH9vyE_D5qcvv08NAiROgDqca6iQoSLGuk
)

FAILED=0
for name in "${!SHEETS[@]}"; do
  sheet_id="${SHEETS[$name]}"
  out_dir="${IMAGES_BASE}/${name}"
  out_png="${out_dir}/${name}-preview.png"

  echo "Rendering ${name} ..."

  json_file="${TMPDIR_RENDER}/${name}.json"
  html_file="${TMPDIR_RENDER}/${name}.html"

  # Fetch values
  if ! fetch_values "$sheet_id" > "$json_file"; then
    echo "  FAILED: could not fetch values (token expired?)"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Generate HTML
  if ! generate_html "$json_file" "$html_file"; then
    echo "  FAILED: HTML generation error"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Screenshot
  mkdir -p "$out_dir"
  if ! screenshot_html "$html_file" "$out_png"; then
    echo "  FAILED: screenshot error"
    FAILED=$((FAILED + 1))
    continue
  fi
done

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "All tables rendered. Push images repo to publish."
else
  echo "${FAILED} table(s) failed."
fi
