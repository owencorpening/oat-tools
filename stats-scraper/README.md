# stats-scraper

Pulls LinkedIn and Substack post performance into a single CSV, by driving a
dedicated Playwright browser profile through your own analytics dashboards.

Part of `oat-tools`. Feeds post-level metrics into the Ghost Tracker workflow
so OAT publishing decisions run on real numbers instead of vibes.

## Why this approach

There are off-the-shelf LinkedIn scraper MCPs, and they all work by taking your
session cookies. That puts the account itself at risk, and it violates
LinkedIn's terms.

This does something narrower: it opens a browser you're already logged into,
visits pages you're allowed to see, and reads them. No credentials are stored
by the tool, no third-party data broker is involved, and nothing touches
accounts other than your own. The browser profile is separate from your
everyday Chrome, so a hostile page can't reach your other logged-in sessions.

The tradeoff is fragility — see [Limits](#limits).

## Requirements

- `@playwright/mcp` installed globally: `npm i -g @playwright/mcp`
  (provides the `playwright-mcp` binary — **not** `mcp-server-playwright`)
- A LinkedIn account and a Substack publication you own

## Setup (one-time)

1. **Register the MCP server** at user scope, so it's available from any
   directory. The one-liner (equivalent to the server in `mcp-config.json`):

   ```sh
   claude mcp add --scope user playwright-stats -- \
     /home/owen/dev/oat-tools/stats-scraper/bin/stats-mcp
   ```

   It defines one server, `playwright-stats`, pointed at a dedicated profile
   directory (`~/.playwright-stats-profile`).

   **This registration gets lost.** It is NOT committed to this repo (it lives
   in your local Claude Code config, e.g. `~/.claude.json`), so a config reset,
   a new machine, or a stray edit drops it — and then a stats pull fails with
   "the `playwright-stats` MCP server isn't available in this session" even
   though every file here is intact. Confirmed missing and re-added 2026-11-23.
   To check it's there: `claude mcp list` should show `playwright-stats`.

   After adding it: **restart Claude Code** (MCP servers load at startup, not
   mid-session) and **approve** the server when prompted — a locally-launched
   stdio server first appears as "⏸ Pending approval". The tool permissions
   (`mcp__playwright-stats__browser_*`) are already in `~/.claude/settings*`.

   Note: `--user-data-dir` and `--isolated` are mutually exclusive. This config
   uses `--user-data-dir` on purpose — the persisted login session is the whole
   point of the tool.

2. **Save your settings.** Copy `config.example.json` to `config.local.json`
   and fill in your LinkedIn handle, Substack subdomain, and output path. The
   prompt reads this file, so you never re-enter them.

   `config.local.json` is gitignored — this repo is public, and `outputPath`
   points at your own performance data.

3. **Log in once.** Start the server and manually log into LinkedIn and
   Substack in the browser window it opens. The session persists in the profile
   directory, so you only do this once (until the platforms expire it).

4. **Never point this profile at your everyday Chrome profile.** Isolation is
   what keeps a prompt-injection attempt on a page from reaching anything else.
   This one is enforced, not just advised — see below.

## The profile guard

`bin/stats-mcp` is a wrapper that pins the browser profile and refuses any
attempt to relocate it. `mcp-config.json` invokes the wrapper rather than
`playwright-mcp` directly, so the profile path is no longer a string sitting in
a config file waiting to be edited.

It rejects `--user-data-dir`, `--isolated`, `--config`, and `--storage-state`
(a config file can set `userDataDir` just as well as the flag can), and
sanity-checks its own hardcoded path against known browser profile locations.
The file is mode 555; `chmod u+w` first if you need to change it.

The wrapper also passes `--sandbox`, because `playwright-mcp` launches Chrome
with `--no-sandbox` by default. That default disables the renderer sandbox —
the thing that contains a malicious page — and this browser reads other
people's LinkedIn comments, which is the real injection surface. It also
passes `--block-service-workers`, which nothing here needs.

Backing that up, `~/.claude/settings.json` denies reads of
`~/.config/google-chrome/**` and edits to the wrapper and `mcp-config.json`.

**What this does and doesn't do.** It reliably stops the realistic failure —
someone or something quietly editing the profile path. It is *not* a sandbox:
both profiles are owned by the same Unix user, so any process running as you
can still read either one. Kernel-enforced isolation would mean running the
browser under `bwrap` with `~/.config` unmounted, which isn't set up here.

## Running a pull

Paste the prompt from `prompt-template.md` into **Claude Code**. Not claude.ai
— the MCP server and browser profile are both local, so only a locally-running
client can reach them.

The server is registered at user scope, so it works from any directory, and
the prompt uses an absolute path to `config.local.json`. Nothing to fill in.

Run it **weekly, not continuously.** Less exposure to markup drift breaking a
run midway, and it avoids traffic patterns that look automated to LinkedIn.
(See the Cadence section in `prompt-template.md` for the full reasoning — the
binding limit is LinkedIn's automated-access detection against a logged-in
account.)

### Install the schedule (new or rebuilt machine)

The three jobs' systemd user units live in [`systemd/`](systemd/):

| Timer | When | Runs |
|---|---|---|
| `stats-hourly.timer` | hourly, first 10 min | `bin/stats-hourly.sh`: `github_traffic.py` + `goatcounter_recent.py`, then rebuild the dashboard (no commit) |
| `stats-dashboard.timer` | daily 04:00 | `bin/stats-refresh-dashboard.sh --with-cws`: Chrome Web Store pull, rebuild, back up (commit) |
| `stats-weekly-pull.timer` | Sun 03:00 | `bin/stats-weekly-pull.sh` (LinkedIn + Substack, then Chrome Web Store) |

None of the hourly or daily jobs use Claude; only the Sunday pull does. A
shared lock (`~/.local/state/stats-scraper/stats.lock`) keeps the jobs from
running at the same moment.

Why these intervals (checked 2026-11-27):

| Source | Limit | Use |
|---|---|---|
| GitHub REST API | 5,000 calls/hour | about 220 a run (44 repos × 4 traffic calls, plus Actions runs) |
| GoatCounter stats API | 4 requests/second | 1 a run |
| GoatCounter export | one export an hour | stays in oat-analytics' daily CI, not here: an hourly local export would take CI's slot, and a refused export can use up the hour |
| Chrome Web Store API | Google API quota | 4 queries a day |
| LinkedIn (browser) | automated-access detection | weekly, unchanged (see "Cadence" in `prompt-template.md`) |

The units use `%h` (your home directory), so this repo must be at
`~/dev/oat-tools`. Install and start them:

```sh
cp ~/dev/oat-tools/stats-scraper/systemd/*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now stats-hourly.timer stats-dashboard.timer stats-weekly-pull.timer
systemctl --user disable --now github-traffic.timer 2>/dev/null   # replaced by stats-hourly.timer (2026-11-27)
loginctl enable-linger "$USER"     # run even when you're not logged in
systemctl --user list-timers       # check the next run times
```

The scripts also expect, from the rest of this README: `gh` logged in; the
`oat-stats` repo cloned at `~/oat-data/stats` and `oat-analytics` at
`~/dev/oat-analytics`; `config.local.json` (Setup above); and, for the weekly
pull only, the `claude` CLI with the `playwright-stats` MCP server and a
LinkedIn + Substack login in its browser profile. Edit a unit here, then
repeat the `cp` and `daemon-reload` lines.

### Automated schedule (set up 2026-11-23)

A **systemd user timer** runs the pull unattended every **Sunday 03:00
America/Chicago** (`~/.config/systemd/user/stats-weekly-pull.{timer,service}`):

```ini
# stats-weekly-pull.timer
OnCalendar=Sun *-*-* 03:00:00
Persistent=true          # a run missed while asleep/off fires on next wake/boot
RandomizedDelaySec=300   # small jitter so the time isn't mechanically identical
```

A systemd timer was chosen over cron specifically so a **missed run is caught
up**: plain cron silently skips a job if the machine is suspended or off at the
scheduled time and never backfills it. With `Persistent=true` the run fires
when the machine next wakes or boots. Lingering is enabled
(`loginctl enable-linger owen`) so the timer runs even with no active login,
just as cron did.

Manage it with `systemctl --user {status,start,list-timers} stats-weekly-pull.timer`.

The timer runs [`bin/stats-weekly-pull.sh`](bin/stats-weekly-pull.sh) from
this repo (moved here from `~/.local/bin` on 2026-11-25; the systemd unit's
`ExecStart` points at the repo path). It hardcodes this machine's paths and runs
`claude -p ... --dangerously-skip-permissions` headless: it loads node via
nvm, runs the prompt above against the `playwright-stats` server, and
commits/pushes the data repo (step 6). The guard (`pull_guard.py`, 3 days)
lets Sunday's run go ahead unless an unforced pull happened Friday or
Saturday; a forced manual pull never moves the guard's clock (it's recorded
as `lastForcedRun`). Logs:
`~/.local/state/stats-scraper/logs/` (outside the data repo, so they're never
committed); failures also append to `failures.log` there. If LinkedIn's login
expires, an unattended run fails — re-log into the isolated profile and the
next run recovers.

### Dashboard

`bin/build-dashboard.py` reads all the data CSVs (`stats-log.csv`,
`github-traffic-*.csv`, and `oat-analytics`'s `pageviews.csv`) and writes one
self-contained `~/oat-data/stats/dashboard.html` — GitHub, LinkedIn, Substack,
and the OAT site on a single offline page, data baked in, light/dark aware.

A **Work** panel (brass/granite, top of the page) lists the open items from the
"OAT" GitHub Project (number 2) — Status *In progress* then *Next*, sorted by
Priority, each title linking to its issue. It's pulled via local `gh` at
generation time (no token in the page); a good pull is cached to
`~/oat-data/stats/project-items.json` (gitignored) so the headless 04:00 run
still renders the panel even if the `gh` keyring is locked.

Run it by hand anytime with `python3 -I bin/build-dashboard.py` (reads the local
`oat-analytics` checkout for the site panel; set `OAT_PAGEVIEWS=/path/to/pageviews.csv`
to point it elsewhere).

**Rebuilt hourly; backed up nightly.** GitHub traffic and the live site
visitor counts refresh **hourly** (`stats-hourly.timer`), the Chrome Web Store
**daily at 04:00**, the full site pageview log **daily** (oat-analytics' CI
export, 03:17 plus a catch-up), and LinkedIn + Substack **weekly** (LinkedIn's
account-safety limit). Every run goes through
[`bin/stats-refresh-dashboard.sh`](bin/stats-refresh-dashboard.sh), which
fetches the latest pageviews from `oat-analytics`'s remote (read-only `git show
origin/main:…` into a temp file — never touches that repo's working tree) and
regenerates. The hourly run passes `--no-commit`; the 04:00 run commits **only
if the data changed** (the dashboard plus the GitHub traffic CSVs,
`github-actions-clones.csv`, `goatcounter-recent.json` and `cws/`, which
nothing else backs up), so that's at most one backup commit a day. The weekly
LinkedIn/Substack pull calls the same script at the end, so a fresh scrape
shows up immediately too.

**Each panel says how fresh it is**: "updated <time> · <age> · <cadence>",
where the time is when that source last refreshed (the file's write time, or
the export's `last_run` for the site's pageview log) and the age is counted
when you open the page. It turns red once it's older than its cadence allows
(2 h for hourly, 30 h for daily, 8 days for weekly). The header's "data
through" is still the freshest data date across sources.

**Close the browser when the run finishes.** The login persists in
`Default/Cookies` on disk, so nothing is lost by closing it — and a window
left open is a logged-in session sitting there between runs for no reason.

## Output

Results are appended to the CSV at `outputPath` — one row per post, both
platforms in one file. The default is `~/oat-data/stats/stats-log.csv`,
deliberately **outside this repo**, which is public. Open it in VS Code with
rainbow-csv, or import it to Sheets.

```csv
Platform,Title,Date,Audience,Views,Comments,Engagement Rate,Free Subs,Paid Subs,Estimated Value,Open Rate,URL
```

The two platforms expose different metrics, so each leaves the other's columns
blank (`-`):

| | LinkedIn | Substack |
|---|---|---|
| Views / impressions | ✓ | ✓ |
| Comments | ✓ | — |
| Open rate, engagement rate | — | ✓ |
| Subscriber and revenue columns | — | ✓ |

From there it either stays as a CSV or feeds the Ghost Tracker Google Sheet
ingestion path (GAS, zero-infra, consistent with the rest of the OAT stack).

## Live site counts

`goatcounter_recent.py` reads visitor counts (per day, and per hour for the
latest day) for the last 7 days from GoatCounter's stats API
(`GET /api/v0/stats/total`), hourly, into `~/oat-data/stats/goatcounter-recent.json`.
The OAT site panel shows them as "live" tiles beside the pageview totals,
which still come from the daily export. GoatCounter counts **visitors** here,
the log counts **pageviews**, so the two don't match and aren't meant to.

It needs an API key in the keyring, never in a file:

```sh
secret-tool store --label="OAT stats GoatCounter API key" service oat-stats account goatcounter-api-key
```

(paste the key at the prompt; any key for the site that can read stats).
Without one it writes `"status": "no-key"`, exits 0, and the panel says the
live counts are off. On an API error it keeps the last good numbers and the
panel shows the error. `--dry-run` says what it would fetch.

## GitHub traffic

`github_traffic.py` records views, clones, referrers and popular paths for
every non-fork repo I own, using `gh` (no browser, no scraping). **GitHub only
keeps 14 days of traffic data**, so the hourly job (`stats-hourly.timer`,
`Persistent=true`) runs it to build up the history and keep today's partial
numbers current. Running it by hand any time is safe: same-day reruns replace
rows rather than adding them.

It writes to `~/oat-data/stats/` (`--out` to change), outside this repo:

| File | Contents |
|------|----------|
| `github-traffic-daily.csv` | `date, repo, views, unique_visitors, clones, unique_cloners`. One row per repo per day. A rerun replaces matching rows, because today's numbers are partial. Older rows are never deleted. |
| `github-traffic-referrers.csv` | `captured_on, repo, referrer, count, uniques`. A **snapshot** of the 14-day totals on `captured_on`, not a daily count. |
| `github-traffic-paths.csv` | `captured_on, repo, path, title, count, uniques`. The same kind of snapshot, for the most-viewed pages. |

Repos with no traffic in the window are skipped, except `riffkit`, which
always gets daily rows.

## Chrome Web Store

`cws_stats.py` pulls stats for my extension, Search Grid & Recency Filter for
YouTube, through the official Chrome Web Store API v2
([`publishers.items.queryMetrics`](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/queryMetrics)),
with the read-only scope `chromewebstore.readonly`. No browser, no scraping:
the API has installs, uninstalls, daily and 7-day users, impressions and
listing page views, sliced by one dimension at a time (country, or a UTM tag).

**Setup (one-time).** The Google Cloud project "OAT stats" has the Chrome Web
Store API enabled and a Desktop OAuth client, also named "OAT stats".
`config.local.json` holds `cws.clientId`, `cws.publisherId` and `cws.itemId`
(identifiers, not secrets). The client secret and the refresh token live only
in the keyring:

```sh
secret-tool store --label="OAT stats CWS client secret" service oat-stats account cws-client-secret
python3 cws_stats.py sign-in    # once: opens the browser, saves the refresh token
```

**Schedule.** Daily: the 04:00 dashboard job runs it
(`stats-refresh-dashboard.sh --with-cws`), and on Sunday
`bin/stats-weekly-pull.sh` runs it at 03:00 after the LinkedIn/Substack pull.
The guard (`pull_guard.py`) is 1 day on `cws.lastRun`, so it pulls once a day
and Sunday's 04:00 call skips. (LinkedIn's guard stays at 3 days.) `--force` ignores it and is recorded as `cws.lastForcedRun`,
so it doesn't move the clock. `--dry-run [--today YYYY-MM-DD]` shows what a
run would do without signing in or writing anything. A failure goes to `failures.log` as `cws pull FAILED`,
and the dashboard flags it on the Chrome Web Store panel. The script retries
network errors and 429/5xx answers twice before giving up. The keyring must be
unlocked, as it is for `gh`, which holds while the desktop session is logged in.

**Output**, in `~/oat-data/stats/cws/` (backed up by the dashboard refresh):
`cws-<pull date>-daily.csv`, `-country.csv`, `-utm-source.csv` and
`-utm-medium.csv`, each holding the full history the API returns.

**Romania is my own VPN testing.** The dashboard takes it out of every figure
the API can split by country, day by day. The source/medium breakdown can't be
split by country (one dimension per query), so those lists still include it,
and the panel says so.

## Limits

**LinkedIn's feed actively resists straightforward scraping.** Post cards live
in shadow DOM, and the feed unmounts off-screen posts as you scroll — so a
single DOM read silently *undercounts*, returning a partial set with no error.
Getting a complete, correctly ordered list requires incremental scrolling with
a deduplicating accumulator and sorting by activity ID. `prompt-template.md`
documents the specific failure modes and the working approach; read it before
debugging a run that returned suspiciously few posts.

**Both platforms can change their markup at any time** and break extraction.
That's inherent to scraping — this approach just avoids the account risk of the
credential-based alternatives.

**Page content is a prompt-injection vector.** Keep the profile isolated and
single-purpose.

**Keep `@playwright/mcp` current.** CVE-2025-9611 (DNS rebinding) was patched
after 0.0.40. Since this runs a globally installed binary rather than
`npx @latest`, updates are manual: `npm i -g @playwright/mcp@latest`.

## Files

| File | Purpose |
|------|---------|
| `mcp-config.json` | MCP server definition — isolated profile, own user-data-dir |
| `config.example.json` | Settings template — copy to `config.local.json` |
| `config.local.json` | Your handle, subdomain, output path (gitignored) |
| `prompt-template.md` | The extraction prompt, setup notes, and scrape gotchas |
| `CLAUDE.md` | Working notes and project status for Claude Code |
| `github_traffic.py` | Hourly GitHub traffic capture (see [GitHub traffic](#github-traffic)) |
| `cws_stats.py` | Daily Chrome Web Store stats through the official API (see [Chrome Web Store](#chrome-web-store)) |
| `goatcounter_recent.py` | Hourly OAT site visitor counts from GoatCounter's stats API (see [Live site counts](#live-site-counts)) |
| `pull_guard.py` | Cadence guard: 3 days for LinkedIn/Substack, 1 day for the Chrome Web Store |

Results live outside the repo at the configured `outputPath`.
