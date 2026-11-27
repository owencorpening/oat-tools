#!/usr/bin/env python3
"""Hourly visitor counts for the OAT site from GoatCounter's stats API.

The full pageview log comes from oat-analytics' export (GitHub Actions,
daily, plus a catch-up run). That export can't run more often: GoatCounter
allows one export an hour, and a refused one can use up the hour. So this
reads the stats API instead (rate limit 4 requests/second; one request per
run), which gives visitor counts per day and per hour, and leaves the export
alone.

Writes ~/oat-data/stats/goatcounter-recent.json (override with --out):
  {"fetched": "<UTC ISO>", "status": "ok" | "no-key" | "error",
   "days": [{"day": "YYYY-MM-DD", "visitors": N}, ...],   # last 7 days
   "hourly": [N x 24] for the latest day, "total": N, "error": "..."}
On an error the last good days/hourly are kept, so the dashboard keeps
showing them, marked with the error.

The API key is read from the keyring (never a file, never printed):
  secret-tool store --label="OAT stats GoatCounter API key" \\
    service oat-stats account goatcounter-api-key
Any key for the site works; it needs read access to stats. Without one, the
run writes status "no-key" and exits 0, and the dashboard says how to add it.

Usage: python3 -I goatcounter_recent.py [--dry-run] [--out DIR]
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITE = os.environ.get("GOATCOUNTER_SITE", "owensappliedthinking")
API = os.environ.get("GOATCOUNTER_API", f"https://{SITE}.goatcounter.com/api/v0")
DEFAULT_OUT = Path.home() / "oat-data" / "stats"
FILE = "goatcounter-recent.json"
DAYS = 7


def keyring_key():
    if os.environ.get("GOATCOUNTER_TEST_KEY"):  # tests against a fake server only
        return os.environ["GOATCOUNTER_TEST_KEY"]
    try:
        r = subprocess.run(["secret-tool", "lookup", "service", "oat-stats", "account", "goatcounter-api-key"],
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() or None


def window(now):
    """DAYS days back and the next whole hour, in UTC, rounded to the hour as the API asks."""
    start = (now - dt.timedelta(days=DAYS)).replace(minute=0, second=0, microsecond=0)
    end = (now + dt.timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    f = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")
    return f(start), f(end)


def fetch(key, start, end, attempts=3):
    url = f"{API}/stats/total?" + urllib.parse.urlencode({"start": start, "end": end})
    for i in range(attempts):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}",
                                                   "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(5 * (i + 1))
                continue
            hint = {401: " (key missing or wrong)", 403: " (key lacks permission to read stats)"}.get(e.code, "")
            raise RuntimeError(f"GoatCounter answered {e.code}{hint}") from None
        except urllib.error.URLError as e:
            if i < attempts - 1:
                time.sleep(5 * (i + 1))
                continue
            raise RuntimeError(f"couldn't reach GoatCounter: {e.reason}") from None


def parse(resp):
    stats = resp.get("stats")
    if not isinstance(stats, list):
        raise RuntimeError(f"unexpected reply from /stats/total (keys: {sorted(resp)})")
    days = sorted(({"day": s["day"][:10], "visitors": int(s.get("daily") or 0),
                    "hourly": [int(h or 0) for h in (s.get("hourly") or [])]} for s in stats),
                  key=lambda d: d["day"])
    days = days[-DAYS:]
    hourly = days[-1]["hourly"] if days else []
    return {"days": [{"day": d["day"], "visitors": d["visitors"]} for d in days],
            "hourly": hourly, "total": int(resp.get("total") or sum(d["visitors"] for d in days))}


def write(path, data):
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n")
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true", help="say what would be fetched and written; no network, no writes")
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    path = a.out / FILE
    start, end = window(now)
    key = keyring_key()
    if a.dry_run:
        print(f"goatcounter: key in keyring: {'yes' if key else 'NO (would write status no-key)'}")
        print(f"goatcounter: would GET {API}/stats/total?start={start}&end={end} -> {path}")
        return 0
    try:
        prev = json.loads(path.read_text())
    except Exception:
        prev = {}
    fetched = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if not key:
        write(path, {**{k: prev[k] for k in ("days", "hourly", "total") if k in prev},
                     "fetched": fetched, "status": "no-key"})
        print("goatcounter: no API key in the keyring; skipped (see goatcounter_recent.py)")
        return 0
    try:
        data = parse(fetch(key, start, end))
    except Exception as e:
        write(path, {**{k: prev[k] for k in ("days", "hourly", "total", "fetched") if k in prev},
                     "status": "error", "error": str(e), "errorAt": fetched})
        print(f"goatcounter: {e}", file=sys.stderr)
        return 1
    write(path, {"fetched": fetched, "status": "ok", **data})
    print(f"goatcounter: {len(data['days'])} day(s), {data['total']} visitor(s) -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
