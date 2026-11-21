#!/usr/bin/env python3
"""Capture GitHub traffic (views, clones, referrers, paths) for my repos.

GitHub only keeps 14 days of traffic, so this runs daily (systemd user
timer) and accumulates the history in CSVs outside this public repo.

Uses the `gh` CLI (must be logged in). Stdlib only.

Outputs (default dir ~/oat-data/stats, override with --out):
  github-traffic-daily.csv      date, repo, views, unique_visitors, clones, unique_cloners
                                One row per repo per day. A rerun replaces
                                existing (date, repo) rows; older rows are kept.
  github-traffic-referrers.csv  captured_on, repo, referrer, count, uniques
  github-traffic-paths.csv      captured_on, repo, path, title, count, uniques
                                14-day-total snapshots as of captured_on. A
                                rerun on the same day replaces that day's
                                snapshot for the repo; other days are kept.
"""

import argparse
import csv
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

OWNER = "owencorpening"
ALWAYS_RECORD = {"riffkit"}
DEFAULT_OUT = Path.home() / "oat-data" / "stats"

DAILY_FIELDS = ["date", "repo", "views", "unique_visitors", "clones", "unique_cloners"]
REF_FIELDS = ["captured_on", "repo", "referrer", "count", "uniques"]
PATH_FIELDS = ["captured_on", "repo", "path", "title", "count", "uniques"]


def gh_json(*args):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def list_repos():
    repos = gh_json("repo", "list", OWNER, "--limit", "1000", "--json", "name,isFork")
    return sorted(r["name"] for r in repos if not r["isFork"])


def traffic(repo, kind):
    return gh_json("api", f"repos/{OWNER}/{repo}/traffic/{kind}")


def read_csv(path):
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, fields, rows):
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output directory (default {DEFAULT_OUT})")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    daily_new, refs_new, paths_new = {}, [], []
    captured_repos = set()
    errors = 0

    for repo in list_repos():
        try:
            views = traffic(repo, "views")
            clones = traffic(repo, "clones")
            refs = traffic(repo, "popular/referrers")
            paths = traffic(repo, "popular/paths")
        except subprocess.CalledProcessError as e:
            errors += 1
            print(f"{repo}: ERROR {e.stderr.strip()}", file=sys.stderr)
            continue

        has_traffic = views["count"] or clones["count"] or refs or paths
        if not has_traffic and repo not in ALWAYS_RECORD:
            continue
        captured_repos.add(repo)

        days = {}
        for v in views["views"]:
            d = days.setdefault(v["timestamp"][:10], dict.fromkeys(DAILY_FIELDS[2:], 0))
            d["views"], d["unique_visitors"] = v["count"], v["uniques"]
        for c in clones["clones"]:
            d = days.setdefault(c["timestamp"][:10], dict.fromkeys(DAILY_FIELDS[2:], 0))
            d["clones"], d["unique_cloners"] = c["count"], c["uniques"]
        if not days:  # ALWAYS_RECORD repo with nothing: still log today as zeros
            days[today] = dict.fromkeys(DAILY_FIELDS[2:], 0)
        for date, d in days.items():
            daily_new[(date, repo)] = {"date": date, "repo": repo, **d}

        for r in refs:
            refs_new.append({"captured_on": today, "repo": repo, "referrer": r["referrer"],
                             "count": r["count"], "uniques": r["uniques"]})
        for p in paths:
            paths_new.append({"captured_on": today, "repo": repo, "path": p["path"], "title": p["title"],
                              "count": p["count"], "uniques": p["uniques"]})

        top = f", top referrer {refs[0]['referrer']} ({refs[0]['count']})" if refs else ""
        print(f"{repo}: {views['count']} views ({views['uniques']} unique), "
              f"{clones['count']} clones ({clones['uniques']} unique) over 14d{top}")

    # Daily: replace (date, repo) rows we just fetched, keep everything else.
    daily_path = args.out / "github-traffic-daily.csv"
    merged = {(r["date"], r["repo"]): r for r in read_csv(daily_path)}
    merged.update(daily_new)
    write_csv(daily_path, DAILY_FIELDS, sorted(merged.values(), key=lambda r: (r["date"], r["repo"])))

    # Snapshots: drop today's earlier snapshot for repos we just captured, then append.
    for name, fields, new in (("github-traffic-referrers.csv", REF_FIELDS, refs_new),
                              ("github-traffic-paths.csv", PATH_FIELDS, paths_new)):
        path = args.out / name
        kept = [r for r in read_csv(path)
                if not (r["captured_on"] == today and r["repo"] in captured_repos)]
        write_csv(path, fields, kept + new)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
