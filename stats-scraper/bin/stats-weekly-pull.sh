#!/usr/bin/env bash
# Weekly LinkedIn + Substack stats pull, run unattended by a systemd user timer
# (~/.config/systemd/user/stats-weekly-pull.{service,timer}, ExecStart points here).
#
# Launches Claude Code headless against the stats-scraper prompt. The 6-day
# guard in config.local.json makes this no-op safely if a manual pull already
# ran earlier in the week, so a fixed weekly schedule can't double-pull.
#
# Scheduled: Sunday 03:00 America/Chicago (systemd user timer stats-weekly-pull.timer).
# Logs (outside the ~/oat-data/stats git repo, so they're never committed):
#   ~/.local/state/stats-scraper/logs/
set -uo pipefail

# cron has a minimal environment: load node (nvm) and ~/.local/bin onto PATH
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PATH="$HOME/.local/bin:$PATH"

LOG_DIR="$HOME/.local/state/stats-scraper/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/pull-$(date +%Y-%m-%d_%H%M%S).log"

PROMPT='Read /home/owen/dev/oat-tools/stats-scraper/prompt-template.md in full and carry out the instructions in its "Prompt" section exactly, including reading config.local.json first for linkedinHandle, substackSubdomain, outputPath, and postsPerPull. Follow the "LinkedIn scrape gotchas", "LinkedIn absolute dates", and "Substack dates omit the year" sections. This requires the playwright-stats MCP server; if it is not available, stop and report rather than scraping another way. Do every step including step 5 (update lastRun) and step 6 (commit and push the ~/oat-data/stats repo).'

{
  echo "=== stats weekly pull $(date -Is) ==="
  cd "$HOME/dev/oat-tools/stats-scraper" || exit 1
  # Isolated browser profile; headless has no approver, so skip permission prompts.
  timeout 1800 claude -p "$PROMPT" --dangerously-skip-permissions
} >>"$LOG" 2>&1
rc=$?
echo "=== exit rc=$rc $(date -Is) ===" >>"$LOG"

# Rebuild the dashboard from the fresh data. Shared with the nightly dashboard
# timer — it logs separately and only commits when the data actually changed.
"$(dirname "$(readlink -f "$0")")/stats-refresh-dashboard.sh" || true

if [ $rc -ne 0 ]; then
  echo "[$(date -Is)] stats pull FAILED rc=$rc — $LOG" >>"$LOG_DIR/failures.log"
  # best-effort desktop notification (works only if a session bus is reachable)
  command -v notify-send >/dev/null 2>&1 && notify-send -u critical "Weekly stats pull failed" "rc=$rc — see $LOG" 2>/dev/null || true
fi

# prune logs older than 120 days
find "$LOG_DIR" -name 'pull-*.log' -mtime +120 -delete 2>/dev/null || true
exit $rc
