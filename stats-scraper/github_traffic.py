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
  github-actions-clones.csv     run_id, date, workflow_repo, target_repo, clones
                                Clones made by my own GitHub Actions runs (each
                                checkout step, plus known `git clone` steps).
                                One row per run per cloned repo; runs already
                                listed are not fetched again. Lets the dashboard
                                separate my own workflows from outside clones.
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
ACTION_FIELDS = ["run_id", "date", "workflow_repo", "target_repo", "clones"]

# Steps that clone a repo without being a checkout step: {step name: repo}.
# oat-content's "Publish site" clones oat-web over SSH to push the build.
EXTRA_CLONE_STEPS = {"Push the build to oat-web": "oat-web"}


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


def gh_paged(path, key):
    """All items of a paginated list endpoint (GitHub caps per_page at 100)."""
    items, page = [], 1
    while True:
        sep = "&" if "?" in path else "?"
        data = gh_json("api", f"{path}{sep}per_page=100&page={page}")
        batch = data.get(key, [])
        items += batch
        if len(batch) < 100:
            return items
        page += 1


def checkout_target(step_name, own_repo, repos):
    """Which repo a step clones, or None. Checkout steps clone their own repo
    unless the step name names another one, e.g. "Check out the site builder
    (oat-tools)"."""
    if step_name in EXTRA_CLONE_STEPS:
        return EXTRA_CLONE_STEPS[step_name]
    n = step_name.lower()
    if n.startswith("post ") or not (n.startswith("run actions/checkout") or
                                     n.startswith("checkout") or n.startswith("check out")):
        return None
    named = [r for r in repos if r != own_repo and r.lower() in n]
    return named[0] if named else own_repo


def own_action_clones(repos, since, cache_rows):
    """Rows for completed runs since `since` (YYYY-MM-DD) not already cached."""
    seen = {r["run_id"] for r in cache_rows}
    new = []
    for repo in repos:
        try:
            if not gh_json("api", f"repos/{OWNER}/{repo}/actions/workflows")["total_count"]:
                continue
            runs = gh_paged(f"repos/{OWNER}/{repo}/actions/runs?created=%3E%3D{since}", "workflow_runs")
        except subprocess.CalledProcessError as e:
            print(f"{repo}: actions ERROR {e.stderr.strip()}", file=sys.stderr)
            continue
        for run in runs:
            rid = str(run["id"])
            if rid in seen or run["status"] != "completed":
                continue
            counts = {}
            for job in gh_paged(f"repos/{OWNER}/{repo}/actions/runs/{rid}/jobs", "jobs"):
                for step in job.get("steps") or []:
                    if step.get("conclusion") in (None, "skipped"):
                        continue
                    target = checkout_target(step["name"], repo, repos)
                    if target:
                        counts[target] = counts.get(target, 0) + 1
            day = (run.get("run_started_at") or run["created_at"])[:10]
            if not counts:  # remember the run anyway so it isn't fetched again
                counts = {repo: 0}
            for target, n in counts.items():
                new.append({"run_id": rid, "date": day, "workflow_repo": repo,
                            "target_repo": target, "clones": n})
    return new


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output directory (default {DEFAULT_OUT})")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    daily_new, refs_new, paths_new = {}, [], []
    captured_repos = set()
    errors = 0

    all_repos = list_repos()
    for repo in all_repos:
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

    # My own Actions clones, from the earliest traffic day we hold.
    since = min((k[0] for k in merged), default=today)
    actions_path = args.out / "github-actions-clones.csv"
    cached = read_csv(actions_path)
    added = own_action_clones(all_repos, since, cached)
    write_csv(actions_path, ACTION_FIELDS,
              sorted(cached + added, key=lambda r: (r["date"], r["workflow_repo"], r["run_id"], r["target_repo"])))
    own = sum(int(r["clones"]) for r in added)
    print(f"actions: {len({r['run_id'] for r in added})} new run(s), {own} clone(s) by my own workflows")

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
