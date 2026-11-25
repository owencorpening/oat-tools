#!/usr/bin/env python3
"""Generate a single self-contained dashboard.html from the OAT data CSVs.

Reads (all local, all optional — a missing source renders as an empty panel):
  ~/oat-data/stats/stats-log.csv          LinkedIn + Substack post snapshots
  ~/oat-data/stats/github-traffic-daily.csv   GitHub repo traffic per day
  ~/dev/oat-analytics/data/pageviews.csv  GoatCounter site pageviews
  ~/dev/oat-analytics/data/state.json     when that export last ran
  ~/oat-data/stats/github-actions-clones.csv  clones made by my own workflows
  ~/.local/state/stats-scraper/logs/failures.log  failed weekly pulls

Writes:
  ~/oat-data/stats/dashboard.html         standalone, data baked in, no server

Design per the data-viz skill: one coherent system, categorical hue per
platform, light/dark aware, charts drawn in inline SVG (offline-safe).
Run with -I; no third-party deps.
"""
import csv, json, os, re, html, subprocess
from zoneinfo import ZoneInfo
from collections import defaultdict, OrderedDict
from datetime import datetime, date, timedelta

HOME = os.path.expanduser("~")
STATS = os.path.join(HOME, "oat-data/stats/stats-log.csv")
GH = os.path.join(HOME, "oat-data/stats/github-traffic-daily.csv")
PV = os.environ.get("OAT_PAGEVIEWS") or os.path.join(HOME, "dev/oat-analytics/data/pageviews.csv")
PV_STATE = os.environ.get("OAT_PAGEVIEWS_STATE") or os.path.join(HOME, "dev/oat-analytics/data/state.json")
# Set by stats-refresh-dashboard.sh when it read the export from origin/main.
# Unset means the builder fell back to the local clone, which may be stale.
PV_FROM_REMOTE = os.environ.get("OAT_PAGEVIEWS_SOURCE") == "remote"
ACTIONS = os.path.join(HOME, "oat-data/stats/github-actions-clones.csv")
FAILURES = os.path.join(HOME, ".local/state/stats-scraper/logs/failures.log")
OUT = os.environ.get("OAT_DASHBOARD_OUT") or os.path.join(HOME, "oat-data/stats/dashboard.html")
# GoatCounter reports days in the site's time zone; bucket the same way.
SITE_TZ = ZoneInfo("America/Chicago")
# Clean-slate reset of pageviews.csv (oat-analytics README, 2026-11-23 20:43
# CST). Nov 23 is only partly covered, so full days start the day after.
SITE_FULL_DAYS_FROM = "2026-11-24"

def num(x):
    try: return int(str(x).replace(",", ""))
    except: return 0

def pct(x):
    try: return float(str(x).replace("%", ""))
    except: return None

# ---------- LinkedIn + Substack ----------
# ---------- Weekly-delta helpers (honest about sparse data) ----------
def _weekly_from_snapshots(series):
    """series: [(date_str, cumulative_int)] ascending. Weekly gains computed only
    where captures are ~a week apart (4-10 days). Too sparse -> ok=False + reason,
    never an interpolated guess."""
    pts = sorted((date.fromisoformat(d), v) for d, v in series if d)
    out = {"ok": False, "reason": "", "thisWeek": None, "lastWeek": None,
           "pct": None, "down25": False, "bars": {"ok": False, "reason": "", "items": []}}
    if len(pts) < 2:
        out["reason"] = "only one snapshot so far — need at least two"
        out["bars"]["reason"] = out["reason"]
        return out
    wk = lambda a, b: 4 <= (b[0] - a[0]).days <= 10
    gaps = [(pts[i + 1][0] - pts[i][0]).days for i in range(len(pts) - 1)]
    L = pts[-1]
    prev = next((p for p in reversed(pts[:-1]) if wk(p, L)), None)
    if prev is None:
        out["reason"] = (f"captures are ~{'/'.join(str(g) for g in gaps[-3:])} days apart "
                         f"(last gap {gaps[-1]}d) — too sparse to isolate a week")
        out["bars"]["reason"] = "not enough ~weekly snapshots yet"
        return out
    out["ok"] = True
    out["thisWeek"] = L[1] - prev[1]
    prev2 = next((p for p in reversed(pts[:pts.index(prev)]) if wk(p, prev)), None)
    if prev2 is not None:
        out["lastWeek"] = prev[1] - prev2[1]
        if out["lastWeek"]:
            out["pct"] = round((out["thisWeek"] - out["lastWeek"]) / abs(out["lastWeek"]) * 100, 1)
            out["down25"] = out["pct"] < -25
    bars = [{"label": pts[i][0].isoformat()[5:], "value": pts[i][1] - pts[i - 1][1], "hasData": True}
            for i in range(1, len(pts)) if wk(pts[i - 1], pts[i])]
    out["bars"] = ({"ok": True, "reason": "", "items": bars[-8:]} if bars
                   else {"ok": False, "reason": "no consecutive ~weekly snapshots yet", "items": []})
    return out

def _weekly_from_daily(byday, weeks=8, start=None, end=None):
    """byday: {date_str: int} of a daily count (e.g. GitHub views). Rolling 7-day
    windows ending at the latest day; a week counts only if fully covered by data.
    start/end (date) set the covered range when it isn't just the days present
    (days with no rows inside it are real zeros)."""
    days = {date.fromisoformat(d): v for d, v in byday.items()}
    out = {"ok": False, "reason": "", "thisWeek": None, "lastWeek": None,
           "pct": None, "down25": False, "partial": None,
           "bars": {"ok": False, "reason": "", "items": []}}
    if not days and not (start and end):
        out["reason"] = "no daily data"; out["bars"]["reason"] = out["reason"]; return out
    end = end or max(days)
    start = start or min(days)
    wsum = lambda a, b: sum(days.get(a + timedelta(days=i), 0) for i in range((b - a).days + 1))
    out["ok"] = True
    if end - timedelta(days=6) < start:
        # Less than a week of coverage: report what we have, never a padded week.
        n = (end - start).days + 1
        out["thisWeek"] = wsum(start, end)
        out["partial"] = {"days": n, "since": start.isoformat(),
                          "fullWeek": (start + timedelta(days=6)).isoformat()}
    else:
        out["thisWeek"] = wsum(end - timedelta(days=6), end)
    lw_start, lw_end = end - timedelta(days=13), end - timedelta(days=7)
    if lw_start >= start:
        out["lastWeek"] = wsum(lw_start, lw_end)
        if out["lastWeek"]:
            out["pct"] = round((out["thisWeek"] - out["lastWeek"]) / abs(out["lastWeek"]) * 100, 1)
            out["down25"] = out["pct"] < -25
    items = []
    for w in range(weeks - 1, -1, -1):
        b_end = end - timedelta(days=7 * w)
        b_start = b_end - timedelta(days=6)
        full = b_start >= start
        items.append({"label": b_end.isoformat()[5:], "value": wsum(b_start, b_end) if full else 0,
                      "hasData": full})
    nfull = sum(1 for i in items if i["hasData"])
    out["bars"] = {"ok": True, "reason": "", "items": items,
                   "note": (f"{nfull} of {weeks} weeks have full data — history builds up over time"
                            if nfull < weeks else "")}
    return out

def _recent_first7(rows, caps, latest, window=30, n=7):
    """LinkedIn posts published within `window` days; impressions at the snapshot
    nearest publish+n days, so new posts compare fairly with older ones."""
    today = date.today()
    latest_rows = [r for r in rows if r["Captured At"] == latest]
    pub_of = lambda r: date.fromisoformat((r["Date"] or "")[:10])
    recent = []
    for r in latest_rows:
        try:
            p = pub_of(r)
        except Exception:
            continue
        if 0 <= (today - p).days <= window:
            recent.append((p, r))
    if not recent:
        allpubs = [(r["Date"] or "")[:10] for r in latest_rows if r.get("Date")]
        newest = max(allpubs) if allpubs else "—"
        return {"ok": False, "reason": f"no posts published in the last {window} days (newest is {newest})", "posts": []}
    cap_dates = [date.fromisoformat(c) for c in caps]
    posts = []
    for p, r in sorted(recent, reverse=True):
        target = p + timedelta(days=n)
        cand = [cd for cd in cap_dates if abs((cd - target).days) <= 5]
        v = None
        if cand:
            best = min(cand, key=lambda cd: abs((cd - target).days)).isoformat()
            v = next((num(x["Views"]) for x in rows if x["URL"] == r["URL"] and x["Captured At"] == best), None)
        posts.append({"title": r["Title"], "published": p.isoformat(), "first7": v,
                      "note": None if v is not None else "no snapshot near day 7"})
    return {"ok": True, "reason": "", "posts": posts}


def _failed_pulls_since(latest):
    """Timestamps of failed weekly pulls logged after the latest capture date."""
    out = []
    try:
        with open(FAILURES) as f:
            for line in f:
                m = re.match(r"\[(\d{4}-\d{2}-\d{2})T[^\]]*\]", line)
                if m and m.group(1) > latest:
                    out.append(m.group(1))
    except OSError:
        pass
    return sorted(set(out))

def load_stats():
    rows = []
    if os.path.exists(STATS):
        with open(STATS, newline="") as f:
            rows = list(csv.DictReader(f))
    by_plat = defaultdict(list)
    for r in rows:
        by_plat[r["Platform"]].append(r)

    def platform(plat, value_col):
        rs = by_plat.get(plat, [])
        if not rs:
            return {"trend": [], "top": [], "tiles": {}}
        captures = sorted({r["Captured At"] for r in rs})
        latest = captures[-1]
        latest_rows = [r for r in rs if r["Captured At"] == latest]
        # cohort = URLs present in the latest capture; sum those across captures
        cohort = {r["URL"] for r in latest_rows}
        trend = []
        for cap in captures:
            s = sum(num(r[value_col]) for r in rs
                    if r["Captured At"] == cap and r["URL"] in cohort)
            trend.append({"x": cap, "y": s})
        top = sorted(latest_rows, key=lambda r: num(r[value_col]), reverse=True)[:8]
        top = [{"label": r["Title"], "value": num(r[value_col]), "url": r["URL"]} for r in top]
        tiles = {}
        tiles["total"] = sum(num(r[value_col]) for r in latest_rows)
        tiles["posts"] = len(latest_rows)
        if plat == "LinkedIn":
            tiles["comments"] = sum(num(r["Comments"]) for r in latest_rows)
        if plat == "Substack":
            ors = [pct(r["Open Rate"]) for r in latest_rows if pct(r["Open Rate"]) is not None]
            ers = [pct(r["Engagement Rate"]) for r in latest_rows if pct(r["Engagement Rate"]) is not None]
            tiles["open"] = round(sum(ors)/len(ors), 1) if ors else None
            tiles["eng"] = round(sum(ers)/len(ers), 1) if ers else None
        result = {"trend": trend, "top": top, "tiles": tiles, "latest": latest,
                  "failedSince": _failed_pulls_since(latest)}
        if plat == "LinkedIn":
            result["weekly"] = _weekly_from_snapshots([(t["x"], t["y"]) for t in trend])
            result["recent"] = _recent_first7(rs, captures, latest)
        return result

    return platform("LinkedIn", "Views"), platform("Substack", "Views")

# ---------- GitHub ----------
def load_github():
    if not os.path.exists(GH):
        return {"trend": [], "top": [], "tiles": {}}
    with open(GH, newline="") as f:
        rows = list(csv.DictReader(f))
    own_day, own_repo = defaultdict(int), defaultdict(int)
    have_own = os.path.exists(ACTIONS)
    if have_own:
        span = {r["date"] for r in rows}
        with open(ACTIONS, newline="") as f:
            for a in csv.DictReader(f):
                if a["date"] in span:
                    own_day[a["date"]] += num(a["clones"])
                    own_repo[a["target_repo"]] += num(a["clones"])
    by_day = defaultdict(lambda: {"views": 0, "clones": 0, "uv": 0})
    by_repo = defaultdict(lambda: {"views": 0, "clones": 0})
    for r in rows:
        d = r["date"]
        by_day[d]["views"] += num(r["views"])
        by_day[d]["clones"] += num(r["clones"])
        by_day[d]["uv"] += num(r["unique_visitors"])
        by_repo[r["repo"]]["views"] += num(r["views"])
        by_repo[r["repo"]]["clones"] += num(r["clones"])
    days = sorted(by_day)
    trend = [{"x": d, "y": by_day[d]["views"]} for d in days]
    # Views lead; clones are listed beside them, with my own workflows split out.
    top = sorted(by_repo.items(), key=lambda kv: (kv[1]["views"], kv[1]["clones"]), reverse=True)[:8]
    def sub(k, v):
        if not v["clones"]:
            return ""
        mine = f', {own_repo[k]} mine' if own_repo.get(k) else ""
        return f'{v["clones"]:,} clones{mine}'
    top = [{"label": k, "value": v["views"], "sub": sub(k, v)} for k, v in top if v["clones"] or v["views"]]
    clones = sum(by_day[d]["clones"] for d in days)
    own = sum(own_day.values())
    tiles = {
        "clones": clones,
        "ownClones": own if have_own else None,
        "otherClones": clones - own if have_own else None,
        "views": sum(by_day[d]["views"] for d in days),
        "uv": sum(by_day[d]["uv"] for d in days),
        "repos": len([k for k, v in by_repo.items() if v["clones"] or v["views"]]),
        "span": f"{days[0]} → {days[-1]}" if days else "",
        "latest": days[-1] if days else "",
    }
    return {"trend": trend, "top": top, "tiles": tiles,
            "viewsWeekly": _weekly_from_daily({d: by_day[d]["views"] for d in days})}

# ---------- OAT site (GoatCounter) ----------
def load_site():
    rows = []
    if os.path.exists(PV):
        with open(PV, newline="") as f:
            rows = list(csv.DictReader(f))
    state = {}
    try:
        with open(PV_STATE) as f:
            state = json.load(f)
    except Exception:
        pass
    last_run = state.get("last_run")  # export coverage ends here (UTC ISO)

    def local(ts):
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(SITE_TZ)

    by_day = defaultdict(int)
    by_path = defaultdict(int)
    visitors = 0
    for r in rows:
        if not r.get("Date") or r.get("Bot", "0") != "0":
            continue  # GoatCounter leaves bots out of its own counts too
        if (r.get("Referrer") or "").startswith("example.com/oat-counter-test"):
            continue  # 2026-11-25 count.js check visit (oat-analytics README)
        by_day[local(r["Date"]).date().isoformat()] += 1
        by_path[r.get("Path", "")] += 1
        visitors += r.get("FirstVisit") == "1"
    views = sum(by_day.values())
    covered_to = local(last_run) if last_run else None
    start = date.fromisoformat(SITE_FULL_DAYS_FROM)
    weekly = (_weekly_from_daily({d: v for d, v in by_day.items() if d >= SITE_FULL_DAYS_FROM},
                                 start=start, end=covered_to.date())
              if covered_to and covered_to.date() >= start else
              {"ok": False, "reason": "no export since the reset yet"})
    trend = []
    if covered_to:
        d = start
        while d <= covered_to.date():
            trend.append({"x": d.isoformat(), "y": by_day.get(d.isoformat(), 0)})
            d += timedelta(days=1)
    top = sorted(by_path.items(), key=lambda kv: kv[1], reverse=True)[:8]
    top = [{"label": k or "/", "value": v} for k, v in top]
    tiles = {"views": views, "visitors": visitors}
    return {"trend": trend, "top": top, "tiles": tiles, "empty": views == 0,
            "weekly": weekly,
            "coveredTo": covered_to.strftime("%Y-%m-%d %H:%M") if covered_to else None,
            "fromLocalClone": not PV_FROM_REMOTE}

# ---------- Work: open items from GitHub Project "OAT" (number 2) ----------
# Pulled via local `gh` at generation time. A successful pull is cached to
# PROJECT_CACHE so a headless run (e.g. the 04:00 systemd timer, where the gh
# keyring may be locked) can still render the panel from the last good fetch.
PROJECT_CACHE = os.path.join(HOME, "oat-data/stats/project-items.json")
STATUS_ORDER = {"In progress": 0, "Next": 1}
PRIO_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

def load_work():
    items, cached_at = None, None
    try:
        r = subprocess.run(
            ["gh", "project", "item-list", "2", "--owner", "owencorpening",
             "--format", "json", "--limit", "100"],
            capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            items = json.loads(r.stdout).get("items", [])
            try:
                with open(PROJECT_CACHE, "w") as f:
                    json.dump({"items": items, "fetched": datetime.now().isoformat()}, f)
            except Exception:
                pass
    except Exception:
        items = None
    if items is None:  # gh unavailable/unauthed — fall back to the cache
        try:
            with open(PROJECT_CACHE) as f:
                cache = json.load(f)
            items = cache.get("items", [])
            cached_at = (cache.get("fetched") or "")[:10] or "unknown date"
        except Exception:
            items = []
            cached_at = "none — no cache either"
    work = [it for it in items if it.get("status") in STATUS_ORDER]
    work.sort(key=lambda it: (
        STATUS_ORDER.get(it.get("status"), 9),
        PRIO_ORDER.get(it.get("priority"), 9),
        it.get("target date") or "9999-12-31",
        (it.get("content", {}).get("title") or it.get("title", "")).lower(),
    ))
    out = []
    for it in work:
        c = it.get("content", {})
        repo = (it.get("repository") or c.get("repository") or "").rsplit("/", 1)[-1]
        out.append({
            "title": c.get("title") or it.get("title", ""),
            "url": c.get("url", ""),
            "repo": repo,
            "status": it.get("status", ""),
            "priority": it.get("priority") or "",
            "target": it.get("target date") or "",
        })
    return {"items": out, "cachedAt": cached_at}

DATA = {
    "github": load_github(),
    "linkedin": None,
    "substack": None,
    "site": load_site(),
    "work": load_work(),
}
DATA["linkedin"], DATA["substack"] = load_stats()

# "Data through" = the freshest date across all sources, NOT wall-clock time.
# This makes generation deterministic: a rebuild with no new data produces a
# byte-identical file (no spurious git commit when run nightly).
_dates = [t["x"] for t in DATA["github"]["trend"]] + [t["x"] for t in DATA["site"]["trend"] if t["y"]]
for _p in ("linkedin", "substack"):
    _lt = DATA[_p].get("latest")
    if _lt:
        _dates.append(_lt)
_dates = [d for d in _dates if d]
DATA["generated"] = max(_dates) if _dates else datetime.now().strftime("%Y-%m-%d")

HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OAT Dashboard</title>
<style>
  :root{
    --bg:#f4f3f0; --surface:#fcfcfb; --border:#e3e1db;
    --text:#0b0b0b; --muted:#52514e; --faint:#8a8980;
    --github:#2a78d6; --linkedin:#eb6834; --substack:#1baf7a; --site:#eda100;
    --grid:#eceae4;
    --brass:#b8860b; --granite:#4a4f54;
    --p0:#d03b3b; --p1:#b8860b; --p2:#5c6166; --p3:#8a8980;
  }
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
    --bg:#121211; --surface:#1a1a19; --border:#33322e;
    --text:#f0efec; --muted:#c3c2b7; --faint:#8f8e85;
    --github:#3987e5; --linkedin:#d95926; --substack:#199e70; --site:#c98500;
    --grid:#262521;
    --brass:#d4a017; --granite:#c9ccd0;
    --p0:#e66767; --p1:#d4a017; --p2:#a3a8ad; --p3:#8f8e85;
  }}
  :root[data-theme="dark"]{
    --bg:#121211; --surface:#1a1a19; --border:#33322e;
    --text:#f0efec; --muted:#c3c2b7; --faint:#8f8e85;
    --github:#3987e5; --linkedin:#d95926; --substack:#199e70; --site:#c98500;
    --grid:#262521;
    --brass:#d4a017; --granite:#c9ccd0;
    --p0:#e66767; --p1:#d4a017; --p2:#a3a8ad; --p3:#8f8e85;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);zoom:var(--zoom,1.3);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  header{padding:24px 16px 8px;max-width:1200px;margin:0 auto;
    display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  h1{font-size:22px;margin:0;font-weight:650}
  .fontctl{display:flex;gap:6px;flex:none}
  .fontctl button{font:650 15px/1 inherit;cursor:pointer;background:var(--surface);color:var(--text);
    border:1px solid var(--border);border-radius:8px;padding:5px 11px;min-width:34px}
  .fontctl button:hover{border-color:var(--faint)}
  .sub{color:var(--muted);font-size:13px;margin-top:2px}
  .grid{max-width:1200px;margin:0 auto;padding:16px;display:grid;gap:16px;
    grid-template-columns:repeat(2,minmax(0,1fr))}
  @media (max-width:760px){.grid{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
  .card h2{font-size:15px;margin:0 0 2px;display:flex;align-items:center;gap:8px;font-weight:620}
  .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
  .card .meta{color:var(--faint);font-size:12px;margin:0 0 14px}
  .card.wide{grid-column:1 / -1;border-top:3px solid var(--brass)}
  .work{display:flex;flex-direction:column}
  .wi{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:12px;
    padding:10px 2px;border-top:1px solid var(--grid)}
  .wi:first-child{border-top:0}
  .wi .pri{font:800 11px/1.1 inherit;font-variant-numeric:tabular-nums;white-space:nowrap;
    padding:3px 8px;border-radius:999px}
  .wi .pri.P0{color:var(--p0);background:color-mix(in srgb,var(--p0) 15%,transparent)}
  .wi .pri.P1{color:var(--p1);background:color-mix(in srgb,var(--p1) 16%,transparent)}
  .wi .pri.P2{color:var(--p2);background:color-mix(in srgb,var(--p2) 16%,transparent)}
  .wi .pri.P3{color:var(--p3);background:color-mix(in srgb,var(--p3) 16%,transparent)}
  .wi a.t{color:var(--text);text-decoration:none;font-weight:600;overflow-wrap:anywhere}
  .wi a.t:hover{color:var(--brass);text-decoration:underline}
  .wi .m{color:var(--faint);font-size:12px;white-space:nowrap;text-align:right}
  .wi .m .repo{color:var(--muted)} .wi .m .st{color:var(--brass);font-weight:600}
  .wi .m .due.late{color:var(--p0);font-weight:700}
  .tiles{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:14px}
  .tile .n{font-size:24px;font-weight:680;line-height:1.1;font-variant-numeric:tabular-nums}
  .tile .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  svg{display:block;width:100%;height:auto;overflow:visible}
  .axis{fill:var(--faint);font-size:10px}
  .toplist{margin-top:14px;display:flex;flex-direction:column;gap:7px}
  .row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px}
  .row .bar{position:relative;height:22px;border-radius:4px;background:var(--grid);overflow:hidden}
  .row .fill{position:absolute;inset:0 auto 0 0;border-radius:4px;opacity:.85}
  .row .lab{position:absolute;left:8px;top:0;height:22px;display:flex;align-items:center;
    font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 12px)}
  .row .val{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;min-width:52px}
  .row .val small{color:var(--faint)}
  .empty{color:var(--faint);font-style:italic;padding:18px 0;font-size:13px}
  .fresh{font-size:12px;color:var(--muted);margin:-8px 0 12px}
  .fresh .age.old{color:var(--p0);font-weight:650}
  .warn{font-size:12px;color:var(--p0);font-weight:600;margin:-6px 0 12px;
    padding:6px 9px;border-radius:8px;background:color-mix(in srgb,var(--p0) 10%,transparent)}
  .tnote{font-size:12px;color:var(--muted);margin:-6px 0 12px;line-height:1.4}
  .weekly{margin:2px 0 2px;padding-top:12px;border-top:1px solid var(--grid)}
  .wlabel{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:4px}
  .wmain{font-size:13px;color:var(--muted)}
  .wnum{font-size:20px;font-weight:680;color:var(--text);font-variant-numeric:tabular-nums}
  .wunit{font-size:12px;color:var(--muted)}
  .wpct{font-weight:650;color:var(--text)} .wpct.down{color:var(--p0)}
  .wmuted{color:var(--faint)}
  .wnote{font-size:12px;color:var(--faint);font-style:italic;margin-top:6px;line-height:1.35}
  .wbars{display:flex;align-items:flex-end;gap:4px;height:52px;margin-top:10px}
  .wbar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
  .wbar .wbfill{width:100%;border-radius:3px 3px 0 0;min-height:2px}
  .wbar.nodata .wbfill{height:100%;border-radius:3px;
    background:repeating-linear-gradient(45deg,var(--grid),var(--grid) 3px,transparent 3px,transparent 6px)}
  .wblab{font-size:9px;color:var(--faint);margin-top:3px;white-space:nowrap}
  .recent{margin-top:12px;padding-top:12px;border-top:1px solid var(--grid)}
  .rlist{display:flex;flex-direction:column;gap:6px;margin-top:4px}
  .rrow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:baseline;font-size:12px}
  .rrow .rt{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rrow .rsub{color:var(--faint);font-size:11px}
  .rrow .rv{color:var(--text);font-variant-numeric:tabular-nums;font-weight:650;white-space:nowrap}
  .tip{position:fixed;pointer-events:none;background:var(--surface);border:1px solid var(--border);
    border-radius:8px;padding:6px 9px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.14);
    opacity:0;transition:opacity .08s;z-index:10;white-space:nowrap}
  .tip b{font-variant-numeric:tabular-nums}
  footer{max-width:1200px;margin:0 auto;padding:4px 16px 32px;color:var(--faint);font-size:12px}
</style>
</head>
<body>
<header>
  <div>
    <h1>OAT Dashboard</h1>
    <div class="sub" id="sub"></div>
  </div>
  <div class="fontctl">
    <button id="fdn" title="Smaller text" aria-label="Smaller text">A&minus;</button>
    <button id="fup" title="Larger text" aria-label="Larger text">A+</button>
  </div>
</header>
<div class="grid" id="grid"></div>
<footer id="foot"></footer>
<div class="tip" id="tip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const tip = document.getElementById('tip');
const fmt = n => n.toLocaleString();
const shortDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[2]+'/'+m[3] : s; };
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = s => { const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? MON[+m[2]-1]+' '+(+m[3]) : s; };

// Ages are computed when the page is viewed (the file itself stays deterministic).
function daysAgo(s){ // calendar days between that date and today, local time
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s); if(!m) return null;
  const then=new Date(+m[1],+m[2]-1,+m[3]), now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  return Math.max(0,Math.round((today-then)/86400000)); }
function ageText(n){ return n===0?'today':n===1?'1 day ago':n+' days ago'; }
function freshLine(html, days, oldAfter){
  const d=document.createElement('div'); d.className='fresh';
  d.innerHTML=html+(days==null?'':` · <span class="age${days>oldAfter?' old':''}">${ageText(days)}</span>`);
  return d; }
function warnLine(text){ const d=document.createElement('div'); d.className='warn'; d.textContent='⚠ '+text; return d; }
function noteLine(html){ const d=document.createElement('div'); d.className='tnote'; d.innerHTML=html; return d; }
function nextSunday(){ const d=new Date(); d.setDate(d.getDate()+((7-d.getDay())%7||7)); return fmtDate(d.toISOString().slice(0,10)); }

function workPanel(work){
  const items=work.items||[];
  const c=document.createElement('div'); c.className='card wide';
  c.innerHTML=`<h2><span class="dot" style="background:var(--brass)"></span>Work</h2>`+
    `<div class="meta">In progress &amp; Next · from GitHub Project “OAT” · ${items.length} item${items.length===1?'':'s'}</div>`;
  if(work.cachedAt) c.appendChild(warnLine(`gh couldn't reach the Project at build time — showing the cached list from ${work.cachedAt}`));
  if(!items.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='Nothing in progress or queued.'; c.appendChild(e); return c; }
  const wrap=document.createElement('div'); wrap.className='work';
  const today=new Date().toISOString().slice(0,10);
  items.forEach(it=>{
    const row=document.createElement('div'); row.className='wi';
    const pri=document.createElement('span'); pri.className='pri '+(it.priority||''); pri.textContent=it.priority||'—';
    const a=document.createElement('a'); a.className='t'; a.href=it.url||'#'; a.target='_blank'; a.rel='noopener'; a.textContent=it.title;
    const m=document.createElement('div'); m.className='m';
    let h=`<span class="repo">${it.repo}</span> · <span class="st">${it.status}</span>`;
    if(it.target){ const late=it.target<today; h+=` · <span class="due${late?' late':''}">${fmtDate(it.target)}</span>`; }
    m.innerHTML=h;
    row.appendChild(pri); row.appendChild(a); row.appendChild(m);
    wrap.appendChild(row);
  });
  c.appendChild(wrap); return c;
}

function lineChart(series, color, {baseline='auto', area=false, labelFmt=fmt}={}){
  // Uniform-scaled SVG (no preserveAspectRatio=none, so text isn't stretched).
  const W=400,H=150,padT=16,padB=22,padL=8,padR=10;
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  if(series.length===0) return svg;
  const ys=series.map(d=>d.y);
  let lo=Math.min(...ys), hi=Math.max(...ys);
  if(baseline==='zero'){ lo=0; }
  else { const r=(hi-lo)||Math.max(1,hi*0.1); lo=Math.max(0,lo-r*0.35); hi=hi+r*0.35; }
  if(hi===lo) hi=lo+1;
  const n=series.length;
  const X=i=> padL + (n===1?(W-padL-padR)/2 : i*(W-padL-padR)/(n-1));
  const Y=v=> padT + (1-(v-lo)/(hi-lo))*(H-padT-padB);
  // baseline gridline
  const g=document.createElementNS(ns,'line');
  g.setAttribute('x1',padL);g.setAttribute('x2',W-padR);
  g.setAttribute('y1',H-padB);g.setAttribute('y2',H-padB);
  g.setAttribute('stroke','var(--grid)');g.setAttribute('stroke-width','1');
  svg.appendChild(g);
  if(area){
    const a=document.createElementNS(ns,'path');
    let ap=`M ${X(0)} ${Y(series[0].y)}`; series.forEach((d,i)=>ap+=` L ${X(i)} ${Y(d.y)}`);
    ap+=` L ${X(n-1)} ${H-padB} L ${X(0)} ${H-padB} Z`;
    a.setAttribute('d',ap);a.setAttribute('fill',color);a.setAttribute('opacity','.11');svg.appendChild(a);
  }
  const path=document.createElementNS(ns,'path');
  let p=`M ${X(0)} ${Y(series[0].y)}`; series.forEach((d,i)=>p+=` L ${X(i)} ${Y(d.y)}`);
  path.setAttribute('d',p);path.setAttribute('fill','none');path.setAttribute('stroke',color);
  path.setAttribute('stroke-width','2');path.setAttribute('stroke-linejoin','round');path.setAttribute('stroke-linecap','round');
  svg.appendChild(path);
  // endpoint dots
  [0,n-1].forEach(i=>{ const c=document.createElementNS(ns,'circle');
    c.setAttribute('cx',X(i));c.setAttribute('cy',Y(series[i].y));c.setAttribute('r','3.5');c.setAttribute('fill',color);svg.appendChild(c);});
  // x labels first/last
  const mk=(i,anchor)=>{const t=document.createElementNS(ns,'text');
    t.setAttribute('x',X(i));t.setAttribute('y',H-6);t.setAttribute('class','axis');
    t.setAttribute('text-anchor',anchor);t.textContent=shortDate(series[i].x);svg.appendChild(t);};
  mk(0,'start'); if(n>1) mk(n-1,'end');
  // value label on last point
  const vt=document.createElementNS(ns,'text');
  vt.setAttribute('x',X(n-1));vt.setAttribute('y',Math.max(11,Y(series[n-1].y)-7));
  vt.setAttribute('text-anchor','end');vt.setAttribute('fill',color);
  vt.setAttribute('font-size','11');vt.setAttribute('font-weight','650');
  vt.textContent=labelFmt(series[n-1].y);svg.appendChild(vt);
  // hover crosshair + marker
  const cross=document.createElementNS(ns,'line');
  cross.setAttribute('stroke','var(--faint)');cross.setAttribute('stroke-width','1');cross.setAttribute('opacity','0');svg.appendChild(cross);
  const hv=document.createElementNS(ns,'circle');hv.setAttribute('r','4');hv.setAttribute('fill',color);
  hv.setAttribute('stroke','var(--surface)');hv.setAttribute('stroke-width','1.5');hv.setAttribute('opacity','0');svg.appendChild(hv);
  svg.addEventListener('pointermove',e=>{
    const r=svg.getBoundingClientRect(); const rel=(e.clientX-r.left)/r.width*W;
    let bi=0,bd=1e9;series.forEach((d,i)=>{const dd=Math.abs(X(i)-rel);if(dd<bd){bd=dd;bi=i;}});
    const cx=X(bi),cy=Y(series[bi].y);
    cross.setAttribute('x1',cx);cross.setAttribute('x2',cx);cross.setAttribute('y1',padT);cross.setAttribute('y2',H-padB);cross.setAttribute('opacity','1');
    hv.setAttribute('cx',cx);hv.setAttribute('cy',cy);hv.setAttribute('opacity','1');
    tip.innerHTML=`${series[bi].x}<br><b>${labelFmt(series[bi].y)}</b>`;
    tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-10)+'px';tip.style.opacity=1;
  });
  svg.addEventListener('pointerleave',()=>{tip.style.opacity=0;cross.setAttribute('opacity','0');hv.setAttribute('opacity','0');});
  return svg;
}

function topList(items, color, valFmt){
  const wrap=document.createElement('div'); wrap.className='toplist';
  if(!items.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='No data yet.'; wrap.appendChild(e); return wrap; }
  const max=Math.max(...items.map(i=>i.value),1);
  items.forEach(it=>{
    const row=document.createElement('div'); row.className='row';
    const bar=document.createElement('div'); bar.className='bar';
    const fill=document.createElement('div'); fill.className='fill';
    fill.style.width=Math.max(2,it.value/max*100)+'%'; fill.style.background=color;
    const lab=document.createElement('div'); lab.className='lab'; lab.textContent=it.label; lab.title=it.label;
    bar.appendChild(fill); bar.appendChild(lab);
    const val=document.createElement('div'); val.className='val';
    val.innerHTML = (valFmt?valFmt(it.value):fmt(it.value)) + (it.sub?` <small>${it.sub}</small>`:'');
    row.appendChild(bar); row.appendChild(val); wrap.appendChild(row);
  });
  return wrap;
}

function tiles(defs){
  const w=document.createElement('div'); w.className='tiles';
  defs.forEach(d=>{ if(d.v==null) return;
    const t=document.createElement('div'); t.className='tile';
    t.innerHTML=`<div class="n">${d.v}</div><div class="l">${d.l}</div>`; w.appendChild(t); });
  return w;
}

function weekBars(items, color){
  const wrap=document.createElement('div'); wrap.className='wbars';
  const max=Math.max(1, ...items.map(i=>i.value||0));
  items.forEach(it=>{
    const col=document.createElement('div'); col.className='wbar'+(it.hasData===false?' nodata':'');
    const bar=document.createElement('div'); bar.className='wbfill';
    if(it.hasData!==false){ bar.style.height=Math.max(2,(it.value/max)*100)+'%'; bar.style.background=color; }
    bar.title=(it.hasData===false?it.label+': no data':it.label+': '+fmt(it.value));
    const lab=document.createElement('div'); lab.className='wblab'; lab.textContent=it.label;
    col.appendChild(bar); col.appendChild(lab); wrap.appendChild(col);
  });
  return wrap;
}
function weeklyBlock(w, color, label, unit){
  const box=document.createElement('div'); box.className='weekly';
  box.innerHTML=`<div class="wlabel">This week · ${label}</div>`;
  if(!w || !w.ok){
    const n=document.createElement('div'); n.className='wnote'; n.textContent=(w&&w.reason)||'no data'; box.appendChild(n);
    return box;
  }
  const tw=w.thisWeek, lw=w.lastWeek;
  if(w.partial){
    const main=document.createElement('div'); main.className='wmain';
    main.innerHTML=`<span class="wnum">${fmt(tw)}</span> <span class="wunit">${unit} in ${w.partial.days} day${w.partial.days===1?'':'s'} (${fmtDate(w.partial.since)} – latest export)</span> · <span class="wmuted">not a full week yet — first full week ends ${fmtDate(w.partial.fullWeek)}</span>`;
    box.appendChild(main);
    if(w.bars && w.bars.items && w.bars.items.length){ box.appendChild(weekBars(w.bars.items, color));
      if(w.bars.note){ const n=document.createElement('div'); n.className='wnote'; n.textContent=w.bars.note; box.appendChild(n); } }
    return box;
  }
  let delta;
  if(w.pct!=null){ const s=w.pct>0?'+':''; delta=`<span class="wpct${w.down25?' down':''}">${s}${w.pct}%</span> vs last week (${fmt(lw)})`; }
  else if(lw!=null){ delta=`<span class="wmuted">last week ${fmt(lw)}; no % change</span>`; }
  else { delta=`<span class="wmuted">no prior full week to compare yet</span>`; }
  const main=document.createElement('div'); main.className='wmain';
  main.innerHTML=`<span class="wnum">${tw>0?'+':''}${fmt(tw)}</span> <span class="wunit">${unit}</span> · ${delta}`;
  box.appendChild(main);
  if(w.bars && w.bars.ok && w.bars.items.length){
    box.appendChild(weekBars(w.bars.items, color));
    if(w.bars.note){ const n=document.createElement('div'); n.className='wnote'; n.textContent=w.bars.note; box.appendChild(n); }
  } else if(w.bars && w.bars.reason){
    const n=document.createElement('div'); n.className='wnote'; n.textContent='8-week chart: '+w.bars.reason; box.appendChild(n);
  }
  return box;
}
function recentBlock(r){
  const box=document.createElement('div'); box.className='recent';
  box.innerHTML=`<div class="wlabel">New posts (30d) · first 7 days</div>`;
  if(!r || !r.ok){ const n=document.createElement('div'); n.className='wnote'; n.textContent=(r&&r.reason)||'no data'; box.appendChild(n); return box; }
  const list=document.createElement('div'); list.className='rlist';
  r.posts.forEach(p=>{
    const row=document.createElement('div'); row.className='rrow';
    const t=document.createElement('span'); t.className='rt'; t.textContent=p.title; t.title=p.title+' ('+p.published+')';
    const v=document.createElement('span'); v.className='rv';
    if(p.first7!=null){ v.textContent=fmt(p.first7); } else { v.innerHTML=`<span class="rsub">${p.note||'—'}</span>`; }
    row.appendChild(t); row.appendChild(v); list.appendChild(row);
  });
  box.appendChild(list); return box;
}

function card({name,color,meta,pre,tileDefs,post,series,seriesLabelFmt,chartOpts,top,topValFmt,empty,emptyMsg,extra}){
  const c=document.createElement('div'); c.className='card';
  c.innerHTML=`<h2><span class="dot" style="background:${color}"></span>${name}</h2>`+
              (meta?`<div class="meta">${meta}</div>`:'');
  (pre||[]).forEach(n=>c.appendChild(n));
  c.appendChild(tiles(tileDefs));
  (post||[]).forEach(n=>c.appendChild(n));
  if(extra) c.appendChild(extra);
  if(empty){ const e=document.createElement('div'); e.className='empty'; e.textContent=emptyMsg; c.appendChild(e); }
  else{
    if(series && series.length) c.appendChild(lineChart(series,color,Object.assign({labelFmt:seriesLabelFmt},chartOpts||{})));
    c.appendChild(topList(top||[],color,topValFmt));
  }
  return c;
}

const C={github:getComputedStyle(document.documentElement).getPropertyValue('--github').trim(),
         linkedin:getComputedStyle(document.documentElement).getPropertyValue('--linkedin').trim(),
         substack:getComputedStyle(document.documentElement).getPropertyValue('--substack').trim(),
         site:getComputedStyle(document.documentElement).getPropertyValue('--site').trim()};

document.getElementById('sub').textContent=`GitHub · LinkedIn · Substack · Site — data through ${DATA.generated}`;
const grid=document.getElementById('grid');

grid.appendChild(workPanel(DATA.work||{items:[]}));

const g=DATA.github, gt=g.tiles||{};
const gPost=[];
if(gt.ownClones!=null) gPost.push(noteLine(`Clones are mostly automated: <b>${fmt(gt.ownClones)}</b> from my own GitHub Actions (identified per run), <b>${fmt(gt.otherClones)}</b> from elsewhere — bots, mirrors and other people's CI. Views are people loading the repo pages.`));
else gPost.push(noteLine('Clones are mostly automated (bots, CI, my own workflows); views are people loading the repo pages.'));
grid.appendChild(card({name:'GitHub traffic',color:C.github,meta:(gt.span||'')+' · daily views',
  pre:gt.latest?[freshLine(`latest day ${fmtDate(gt.latest)}`, daysAgo(gt.latest), 2)]:[],
  tileDefs:[{l:'Views',v:fmt(gt.views||0)},{l:'Unique visitors',v:fmt(gt.uv||0)},{l:'Clones · mostly automated',v:fmt(gt.clones||0)}],
  post:gPost,
  series:g.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'zero',area:true},top:g.top,
  extra:weeklyBlock(g.viewsWeekly, C.github, 'views (not clones)', 'views')}));

function capturePre(p){
  const out=[];
  if(!p.latest) return out;
  out.push(freshLine(`latest capture ${fmtDate(p.latest)} · next scheduled pull Sun ${nextSunday()}`, daysAgo(p.latest), 8));
  if(p.failedSince && p.failedSince.length) out.push(warnLine(`weekly pull failed on ${p.failedSince.map(fmtDate).join(', ')} — numbers are from ${fmtDate(p.latest)}; see ~/.local/state/stats-scraper/logs/failures.log`));
  return out;
}
const li=DATA.linkedin;
const liExtra=document.createElement('div');
liExtra.appendChild(weeklyBlock(li.weekly, C.linkedin, 'impressions gained', 'impressions'));
liExtra.appendChild(recentBlock(li.recent));
grid.appendChild(card({name:'LinkedIn',color:C.linkedin,meta:'25-post cohort',pre:capturePre(li),
  tileDefs:[{l:'Impressions',v:fmt(li.tiles.total||0)},{l:'Comments',v:fmt(li.tiles.comments||0)},{l:'Posts',v:li.tiles.posts||0}],
  series:li.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'auto',area:false},top:li.top,extra:liExtra}));

const sb=DATA.substack;
grid.appendChild(card({name:'Substack',color:C.substack,meta:'25-post cohort',pre:capturePre(sb),
  tileDefs:[{l:'Views',v:fmt(sb.tiles.total||0)},{l:'Avg open',v:sb.tiles.open!=null?sb.tiles.open+'%':null},
            {l:'Avg engage',v:sb.tiles.eng!=null?sb.tiles.eng+'%':null},{l:'Posts',v:sb.tiles.posts||0}],
  series:sb.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'auto',area:false},top:sb.top}));

const st=DATA.site;
const sPre=[];
if(st.coveredTo) sPre.push(freshLine(`exported through ${fmtDate(st.coveredTo.slice(0,10))} ${st.coveredTo.slice(11)} Central`, daysAgo(st.coveredTo), 1));
if(st.fromLocalClone) sPre.push(warnLine("couldn't fetch oat-analytics at build time — using the local clone, which may be behind"));
grid.appendChild(card({name:'OAT site (owensappliedthinking.com)',color:C.site,
  meta:'GoatCounter · counted from the clean-slate reset, Nov 23 8:43pm Central',
  pre:sPre,
  tileDefs:[{l:'Pageviews since reset',v:fmt(st.tiles.views||0)},{l:'First visits',v:fmt(st.tiles.visitors||0)}],
  post:[noteLine("GoatCounter's own totals run higher: they still include the 24 self-test pageviews from Nov 22–23 that the reset dropped from this log. Days are Central time, like GoatCounter.")],
  extra:weeklyBlock(st.weekly, C.site, 'pageviews', 'pageviews'),
  series:st.trend,seriesLabelFmt:fmt,chartOpts:{baseline:'zero',area:true},top:st.top,
  empty:st.empty,emptyMsg:'No visits since the reset yet (your own devices are ignored).'}));

document.getElementById('foot').textContent=
  'Self-contained snapshot — rebuilt nightly at 4am and after each weekly LinkedIn/Substack pull. Ages are measured from when you open the page. Data stays on this machine.';

// Font-size control: scales the whole page via CSS zoom; remembered per viewer.
(function(){
  const root=document.documentElement;
  let z=1.3;
  try{ const s=localStorage.getItem('oat-dash-zoom'); if(s){ const p=parseFloat(s); if(p) z=p; } }catch(e){}
  const clamp=v=>Math.min(2.2,Math.max(0.8,Math.round(v*20)/20));
  const apply=()=>{ z=clamp(z); root.style.setProperty('--zoom',z);
    try{ localStorage.setItem('oat-dash-zoom',z); }catch(e){} };
  apply();
  document.getElementById('fup').onclick=()=>{ z+=0.1; apply(); };
  document.getElementById('fdn').onclick=()=>{ z-=0.1; apply(); };
})();
</script>
</body>
</html>
"""

out_html = HTML.replace("__DATA__", json.dumps(DATA))
with open(OUT, "w") as f:
    f.write(out_html)
print(f"wrote {OUT} ({len(out_html):,} bytes)")
print("sources:",
      "stats" if os.path.exists(STATS) else "stats:MISSING",
      "github" if os.path.exists(GH) else "github:MISSING",
      "site" if os.path.exists(PV) else "site:MISSING")
