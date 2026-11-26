#!/usr/bin/env python3
"""Pull Chrome Web Store stats for my extension through the official API.

Uses the Chrome Web Store API v2 method publishers.items.queryMetrics
(read-only scope chromewebstore.readonly), not the developer dashboard, so
nothing scrapes a page. Stdlib only.

One-time setup (see README.md, "Chrome Web Store"):
  - an OAuth Desktop client in the "OAT stats" Google Cloud project; its
    client ID goes in config.local.json (cws.clientId), its secret in the
    keyring:  secret-tool store --label="OAT stats CWS client secret" \
                service oat-stats account cws-client-secret
  - python3 cws_stats.py sign-in    (opens the browser once; the refresh
    token goes to the keyring, account cws-refresh-token)

Each run (python3 cws_stats.py, from the Sunday timer) writes, under
~/oat-data/stats/cws/ (override with --out):
  cws-YYYY-MM-DD-daily.csv       date + every metric, all countries
  cws-YYYY-MM-DD-country.csv     date, country, installs, uninstalls, users, users_7d
  cws-YYYY-MM-DD-utm-source.csv  date, utm_source, page_views, impressions
  cws-YYYY-MM-DD-utm-medium.csv  date, utm_medium, page_views, impressions
(Page views and impressions can't be split by country; see COUNTRY_METRICS.)
YYYY-MM-DD is the day of the pull; each file holds the full history the API
returns. Credentials never touch a file: the client secret and refresh token
are read from the keyring, and nothing here prints or logs them.

Guard (pull_guard.py, shared with the LinkedIn/Substack pull): a run less
than 3 days after cws.lastRun does nothing. --force ignores the guard and
records cws.lastForcedRun instead, so a manual forced pull never makes the
scheduled Sunday run a no-op. --dry-run shows what a run would do (guard
decision, queries, files) without signing in, calling the API or writing;
--today pretends it's another date.
"""

import argparse
import base64
import csv
import datetime as dt
import hashlib
import http.server
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Run as `python3 -I` (see bin/stats-weekly-pull.sh), which leaves the
# script's own directory off sys.path; add it back for pull_guard only.
sys.path.insert(0, str(HERE))
import pull_guard  # noqa: E402
CONFIG = HERE / "config.local.json"
DEFAULT_OUT = Path.home() / "oat-data" / "stats" / "cws"

SCOPE = "https://www.googleapis.com/auth/chromewebstore.readonly"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://chromewebstore.googleapis.com/v2"

KEYRING_SERVICE = "oat-stats"
SECRET_ACCOUNT = "cws-client-secret"
REFRESH_ACCOUNT = "cws-refresh-token"

METRICS = ["installs", "uninstalls", "users", "users-7d", "impressions", "page-views"]
# The API allows only some dimensions per metric (found on the first pull,
# 2026-11-25): installs, uninstalls and both user counts split by country only;
# impressions and page views split by UTM tag only, never by country.
COUNTRY_METRICS = ["installs", "uninstalls", "users", "users-7d"]
UTM_METRICS = ["page-views", "impressions"]


class CwsError(Exception):
    pass


# ---------- config and keyring ----------

def load_config():
    with CONFIG.open() as f:
        cfg = json.load(f)
    cws = cfg.get("cws") or {}
    missing = [k for k in ("clientId", "publisherId", "itemId") if not cws.get(k)]
    if missing:
        raise CwsError(f"config.local.json is missing cws.{', cws.'.join(missing)}")
    return cfg




def keyring_get(account):
    r = subprocess.run(["secret-tool", "lookup", "service", KEYRING_SERVICE, "account", account],
                       capture_output=True, text=True)
    value = r.stdout.strip()
    return value or None


def keyring_store(account, label, value):
    # The value goes through stdin, never the command line.
    r = subprocess.run(["secret-tool", "store", f"--label={label}", "service", KEYRING_SERVICE, "account", account],
                       input=value, capture_output=True, text=True)
    if r.returncode != 0:
        raise CwsError("couldn't save to the keyring (is secret-tool installed and the keyring unlocked?)")


# ---------- OAuth ----------

def post_form(url, values):
    body = urllib.parse.urlencode(values).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e)
        except Exception:
            err = {}
        # Only Google's error code and description, never the request (it holds the secret).
        raise CwsError(f"token request failed: {err.get('error', e.code)} {err.get('error_description', '')}".strip()) from None


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign_in(cfg):
    client_id = cfg["cws"]["clientId"]
    secret = keyring_get(SECRET_ACCOUNT)
    if not secret:
        raise CwsError("no client secret in the keyring (service oat-stats, account cws-client-secret)")
    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = b64url(secrets.token_bytes(16))
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            ok = q.get("state", [""])[0] == state and "code" in q
            if ok:
                result["code"] = q["code"][0]
            else:
                result["error"] = q.get("error", ["the reply did not match this sign-in"])[0]
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(("Signed in. You can close this tab." if ok else "Sign-in did not complete. Go back to the terminal.").encode())

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    redirect = f"http://127.0.0.1:{server.server_port}"
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
        "prompt": "consent", "access_type": "offline",
    })
    print(f"Opening Google sign-in in your browser. If it doesn't open, visit:\n{url}", file=sys.stderr)
    webbrowser.open(url)
    t = threading.Thread(target=server.handle_request, daemon=True)
    t.start()
    t.join(timeout=300)
    server.server_close()
    if "code" not in result:
        raise CwsError(f"sign-in not completed: {result.get('error', 'timed out after 5 minutes')}")
    tokens = post_form(TOKEN_URL, {
        "client_id": client_id, "client_secret": secret, "code": result["code"],
        "code_verifier": verifier, "grant_type": "authorization_code", "redirect_uri": redirect,
    })
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise CwsError("Google did not return a refresh token")
    granted = tokens.get("scope", "")
    if granted and SCOPE not in granted.split():
        raise CwsError(f"Google granted {granted!r}, not the read-only Chrome Web Store scope")
    keyring_store(REFRESH_ACCOUNT, "OAT stats CWS refresh token", refresh)
    print("Signed in. The refresh token is in the keyring (service oat-stats, account cws-refresh-token).", file=sys.stderr)


def access_token(cfg):
    secret = keyring_get(SECRET_ACCOUNT)
    refresh = keyring_get(REFRESH_ACCOUNT)
    if not secret or not refresh:
        raise CwsError("not signed in: run `python3 cws_stats.py sign-in` once (needs the client secret in the keyring)")
    tokens = post_form(TOKEN_URL, {
        "client_id": cfg["cws"]["clientId"], "client_secret": secret,
        "refresh_token": refresh, "grant_type": "refresh_token",
    })
    token = tokens.get("access_token")
    if not token:
        raise CwsError("Google did not return an access token")
    return token


# ---------- API ----------

def get_json(url, token, attempts=3):
    """GET with a few retries on network errors and 429/5xx; other errors fail at once."""
    for i in range(attempts):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if e.code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(5 * (i + 1))
                continue
            try:
                msg = json.loads(body).get("error", {}).get("message", body)
            except Exception:
                msg = body[:400]
            raise CwsError(f"Chrome Web Store API answered {e.code}: {msg}") from None
        except urllib.error.URLError as e:
            if i < attempts - 1:
                time.sleep(5 * (i + 1))
                continue
            raise CwsError(f"couldn't reach the Chrome Web Store API: {e.reason}") from None


def query_metrics(cfg, token, metrics, dimension=None):
    """Every row of queryMetrics for these metrics (and at most one dimension), all pages."""
    name = f"publishers/{cfg['cws']['publisherId']}/items/{cfg['cws']['itemId']}"
    rows, page = [], None
    while True:
        params = [("metrics", m) for m in metrics] + [("pageSize", "1000")]
        if dimension:
            params.append(("dimensions", dimension))
        if page:
            params.append(("pageToken", page))
        data = get_json(f"{API}/{name}:queryMetrics?{urllib.parse.urlencode(params)}", token)
        rows.extend(data.get("metricRows", []))
        page = data.get("nextPageToken")
        if not page:
            return rows


def row_date(row):
    d = row.get("date") or {}
    return f"{int(d['year']):04d}-{int(d['month']):02d}-{int(d['day']):02d}"


def row_values(row):
    out = {}
    for mv in row.get("metricValues", []):
        try:
            out[mv["metric"]] = int(float(mv.get("value") or 0))
        except (TypeError, ValueError):
            out[mv["metric"]] = 0
    return out


def col(metric):
    return metric.replace("-", "_")


def to_records(rows, metrics, dim_field=None):
    """Rows as CSV records, summing duplicates of the same (date, dimension value)."""
    acc = {}
    for r in rows:
        if not r.get("date"):
            continue
        key = (row_date(r), (r.get("dimensionValues") or [""])[0] if dim_field else None)
        rec = acc.setdefault(key, {m: 0 for m in metrics})
        for m, v in row_values(r).items():
            if m in rec:
                rec[m] += v
    out = []
    for (d, dv), vals in sorted(acc.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        rec = {"date": d}
        if dim_field:
            rec[dim_field] = dv
        rec.update({col(m): vals[m] for m in metrics})
        out.append(rec)
    return out


def write_csv(path, fields, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(records)
    os.replace(tmp, path)


QUERY_SETS = [
    ("daily", METRICS, None, None),
    ("country", COUNTRY_METRICS, "country", "country"),
    ("utm-source", UTM_METRICS, "utm-source", "utm_source"),
    ("utm-medium", UTM_METRICS, "utm-medium", "utm_medium"),
]


def pull(cfg, out, today):
    token = access_token(cfg)
    written = []
    for suffix, metrics, dimension, field in QUERY_SETS:
        rows = query_metrics(cfg, token, metrics, dimension)
        records = to_records(rows, metrics, field)
        fields = ["date"] + ([field] if field else []) + [col(m) for m in metrics]
        path = out / f"cws-{today}-{suffix}.csv"
        write_csv(path, fields, records)
        written.append((path, len(records)))
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", nargs="?", default="pull", choices=["pull", "sign-in"])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--force", action="store_true",
                    help="ignore the guard; recorded as cws.lastForcedRun, so the guard's clock doesn't move")
    ap.add_argument("--dry-run", action="store_true",
                    help="show the guard decision and what would be fetched and written; no network, no writes")
    ap.add_argument("--today", type=dt.date.fromisoformat, default=None, help="pretend today is this date")
    args = ap.parse_args()
    try:
        cfg = load_config()
        if args.command == "sign-in":
            sign_in(cfg)
            return 0
        today = args.today or dt.date.today()
        if args.force:
            print("cws: --force, guard ignored; the guard's clock won't move.")
        else:
            ok, msg = pull_guard.check(cfg, "cws", today)
            print(msg)
            if not ok:
                return 0
        if args.dry_run:
            for suffix, metrics, dimension, _ in QUERY_SETS:
                by = f" by {dimension}" if dimension else ""
                print(f"would query {', '.join(metrics)}{by} -> {args.out / f'cws-{today}-{suffix}.csv'}")
            field = "cws.lastForcedRun" if args.force else "cws.lastRun"
            print(f"would set {field} = {today}")
            return 0
        for path, n in pull(cfg, args.out, today.isoformat()):
            print(f"wrote {path} ({n} rows)")
        pull_guard.record("cws", today, args.force, CONFIG)
        return 0
    except CwsError as e:
        print(f"cws: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
