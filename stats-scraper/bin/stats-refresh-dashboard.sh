#!/usr/bin/env bash
# Rebuild ~/oat-data/stats/dashboard.html from the latest CSVs and back it up.
# No scraping — safe to run nightly. Freshens the OAT-site pageviews from
# oat-analytics' remote (read-only) first. Generation is deterministic (keyed
# on "data through" dates, not wall-clock), so it commits only when the data
# actually changed. Called by the nightly dashboard timer and at the end of
# the weekly stats pull. Lives in oat-tools/stats-scraper/bin; the systemd unit
# ~/.config/systemd/user/stats-dashboard.service runs it from there.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PATH="$HOME/.local/bin:$PATH"

LOG_DIR="$HOME/.local/state/stats-scraper/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/dashboard-$(date +%Y-%m-%d).log"

{
  echo "=== dashboard refresh $(date -Is) ==="
  PV_TMP="$(mktemp 2>/dev/null)" || PV_TMP=""
  ST_TMP="$(mktemp 2>/dev/null)" || ST_TMP=""
  if [ -n "$PV_TMP" ] && [ -n "$ST_TMP" ] \
     && git -C "$HOME/dev/oat-analytics" fetch -q origin main \
     && git -C "$HOME/dev/oat-analytics" show origin/main:data/pageviews.csv >"$PV_TMP" 2>/dev/null \
     && git -C "$HOME/dev/oat-analytics" show origin/main:data/state.json >"$ST_TMP" 2>/dev/null \
     && [ -s "$PV_TMP" ] && [ -s "$ST_TMP" ]; then
    export OAT_PAGEVIEWS="$PV_TMP" OAT_PAGEVIEWS_STATE="$ST_TMP" OAT_PAGEVIEWS_SOURCE=remote
  else
    echo "WARN: couldn't read oat-analytics origin/main; the site panel uses the local clone and says so"
  fi
  if python3 -I "$HOME/dev/oat-tools/stats-scraper/bin/build-dashboard.py"; then
    # Also back up the GitHub traffic CSVs (written by the nightly
    # github_traffic.py) — nothing else commits them.
    git -C "$HOME/oat-data/stats" add dashboard.html github-traffic-*.csv github-actions-clones.csv 2>/dev/null
    if ! git -C "$HOME/oat-data/stats" diff --cached --quiet 2>/dev/null; then
      git -C "$HOME/oat-data/stats" commit -m "Dashboard refresh $(date +%F)" \
        && git -C "$HOME/oat-data/stats" push || true
    else
      echo "no data change; nothing to commit"
    fi
  fi
  unset OAT_PAGEVIEWS OAT_PAGEVIEWS_STATE OAT_PAGEVIEWS_SOURCE
  [ -n "$PV_TMP" ] && rm -f "$PV_TMP"
  [ -n "$ST_TMP" ] && rm -f "$ST_TMP"
  echo "=== done $(date -Is) ==="
} >>"$LOG" 2>&1

# prune dashboard logs older than 120 days
find "$LOG_DIR" -name 'dashboard-*.log' -mtime +120 -delete 2>/dev/null || true
