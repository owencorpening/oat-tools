#!/usr/bin/env bash
set -euo pipefail

REPORT_DIR=~/oat-data/secret-scan
BASELINE_DIR=~/dev/oat-tools/tools/secret-scan/baselines
mkdir -p "$REPORT_DIR"
STAMP=$(date +%Y%m%d)
FOUND=0

for repo in ~/dev/*/; do
  [ -d "$repo/.git" ] || continue
  name=$(basename "$repo")
  out="$REPORT_DIR/${name}-${STAMP}.json"
  baseline="$BASELINE_DIR/${name}.json"
  baseline_flag=()
  [ -f "$baseline" ] && baseline_flag=(--baseline-path "$baseline")

  gitleaks detect --source "$repo" --log-opts="--all" "${baseline_flag[@]}" \
    --report-path "$out" --report-format json --exit-code 0 --no-banner --redact

  # gitleaks writes an empty array `[]` when clean
  if [ -s "$out" ] && [ "$(cat "$out")" != "[]" ]; then
    FOUND=1
    echo "LEAK FOUND: $name (see $out)"
  else
    rm -f "$out"   # don't accumulate clean-run noise
  fi
done

if [ "$FOUND" -eq 1 ]; then
  notify-send "Secret scan: leak found" "Check ~/oat-data/secret-scan/ for details" -u critical
fi
