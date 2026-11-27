#!/usr/bin/env bash
# Hourly refresh of the free, API-only sources, then a dashboard rebuild.
# Run by stats-hourly.timer. No browser, no Claude usage:
#   GitHub traffic   github_traffic.py (gh API, ~220 calls of the 5,000/hour limit)
#   GoatCounter      goatcounter_recent.py (stats API, 1 request; the full
#                    pageview export stays in oat-analytics' daily CI, because
#                    GoatCounter allows only one export an hour)
# The rebuild doesn't commit; the 04:00 job backs the data up once a day.
# Logs: ~/.local/state/stats-scraper/logs/hourly-YYYY-MM-DD.log
set -uo pipefail
# One stats job at a time (hourly and 04:00 can meet): a shared lock, taken
# once per process tree (stats-hourly.sh takes it before calling this).
if [ -z "${STATS_LOCK_HELD:-}" ]; then
  mkdir -p "$HOME/.local/state/stats-scraper"
  exec 9>"$HOME/.local/state/stats-scraper/stats.lock"
  flock -w 1800 9 || { echo "another stats job held the lock for 30 min; giving up" >&2; exit 1; }
  export STATS_LOCK_HELD=1
fi
export PATH="$HOME/.local/bin:$PATH"
HERE="$(dirname "$(readlink -f "$0")")"
LOG_DIR="$HOME/.local/state/stats-scraper/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/hourly-$(date +%Y-%m-%d).log"
rc=0
{
  echo "=== hourly $(date -Is) ==="
  python3 -I "$HERE/../github_traffic.py" || { echo "github traffic FAILED"; rc=1; }
  python3 -I "$HERE/../goatcounter_recent.py" || { echo "goatcounter FAILED"; rc=1; }
} >>"$LOG" 2>&1
"$HERE/stats-refresh-dashboard.sh" --no-commit || rc=1
echo "=== done rc=$rc $(date -Is) ===" >>"$LOG"
find "$LOG_DIR" -name 'hourly-*.log' -mtime +30 -delete 2>/dev/null || true
exit $rc
