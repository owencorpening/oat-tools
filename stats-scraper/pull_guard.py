#!/usr/bin/env python3
"""Cadence guard shared by the weekly pulls (stdlib only).

Two pulls, two clocks in config.local.json:
  linkedin  top-level lastRun        (LinkedIn + Substack, prompt-template.md)
  cws       cws.lastRun              (Chrome Web Store, cws_stats.py)

Rule: a pull proceeds when its clock is empty or GUARD_DAYS[pull] or more
days old:
  linkedin  3 days. The Sunday timer is the normal caller, so last Sunday's
            pull (7 days back) never blocks it, and neither does a manual
            pull from Thursday or earlier.
  cws       1 day. The nightly 04:00 job and the Sunday 03:00 job both call
            it, so it pulls once a day: Sunday's 04:00 call skips because
            03:00 already pulled.

Forced pulls (manual, guard ignored) don't move the clock: they're recorded
as lastForcedRun for the record, and the guard never reads that. So a manual
--force pull midweek can't make the scheduled Sunday run a no-op.

Why not "once per ISO week": ISO weeks run Monday to Sunday, so Sunday is the
last day of its week, and any Monday-Saturday pull would block it.

CLI (used by step 0 and step 5 of prompt-template.md):
  pull_guard.py check  {linkedin|cws} [--today YYYY-MM-DD]   exit 0 = go, 3 = skip
  pull_guard.py record {linkedin|cws} [--force] [--today YYYY-MM-DD]
"""
import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

CONFIG = Path(__file__).resolve().parent / "config.local.json"
# Days a pull must wait after the last unforced one. LinkedIn stays at 3
# (account safety, see prompt-template.md "Cadence"); the Chrome Web Store
# API is official and free, so it runs daily.
GUARD_DAYS = {"linkedin": 3, "cws": 1}
SKIP = 3  # exit code for "guard says skip"
PULLS = ("linkedin", "cws")


def _section(cfg, pull):
    if pull == "cws":
        return cfg.setdefault("cws", {})
    return cfg


def load(config=CONFIG):
    with Path(config).open() as f:
        return json.load(f)


def check(cfg, pull, today):
    """Return (proceed, message) for `pull` on date `today`."""
    last = _section(cfg, pull).get("lastRun")
    if not last:
        return True, f"{pull}: no previous pull on record; go."
    days = GUARD_DAYS[pull]
    gap = (today - dt.date.fromisoformat(last)).days
    if gap >= days:
        return True, f"{pull}: last pull {last}, {gap} day(s) ago (guard {days}); go."
    nxt = dt.date.fromisoformat(last) + dt.timedelta(days=days)
    return False, f"{pull}: last pull {last}, {gap} day(s) ago; next allowed {nxt}. Nothing to do."


def record(pull, today, force, config=CONFIG):
    """Write today's date to the clock, or to lastForcedRun when forced."""
    config = Path(config)
    cfg = load(config)
    _section(cfg, pull)["lastForcedRun" if force else "lastRun"] = today.isoformat()
    tmp = config.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, indent=2) + "\n")
    os.replace(tmp, config)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("action", choices=["check", "record"])
    ap.add_argument("pull", choices=PULLS)
    ap.add_argument("--force", action="store_true", help="record: a forced pull (doesn't move the clock)")
    ap.add_argument("--today", type=dt.date.fromisoformat, default=None, help="pretend today is this date")
    args = ap.parse_args(argv)
    today = args.today or dt.date.today()
    if args.action == "check":
        ok, msg = check(load(), args.pull, today)
        print(msg)
        return 0 if ok else SKIP
    record(args.pull, today, args.force)
    print(f"{args.pull}: recorded {'forced ' if args.force else ''}pull on {today.isoformat()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
