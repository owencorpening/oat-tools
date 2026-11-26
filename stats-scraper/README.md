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
| `github-traffic.timer` | daily ~00:00–00:30 | `github_traffic.py` (GitHub traffic + my own Actions clones) |
| `stats-dashboard.timer` | daily 04:00 | `bin/stats-refresh-dashboard.sh` (rebuild + back up the dashboard) |
| `stats-weekly-pull.timer` | Sun 03:00 | `bin/stats-weekly-pull.sh` (LinkedIn + Substack) |

The units use `%h` (your home directory), so this repo must be at
`~/dev/oat-tools`. Install and start them:

```sh
cp ~/dev/oat-tools/stats-scraper/systemd/*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now github-traffic.timer stats-dashboard.timer stats-weekly-pull.timer
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
commits/pushes the data repo (step 6). The 6-day guard means a manual pull
earlier in the same week makes the scheduled run a safe no-op, while a pull
6+ days back (e.g. a manual Monday pull) still lets Sunday's run go ahead. Logs:
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

**Rebuilt nightly, not just weekly.** GitHub traffic (`github-traffic.timer`,
00:06) and the OAT site (GoatCounter export, 03:17) both refresh their data
*nightly*; only LinkedIn + Substack are weekly (LinkedIn's account-safety
limit). So the dashboard is rebuilt every night at **04:00** by
`stats-dashboard.timer` → [`bin/stats-refresh-dashboard.sh`](bin/stats-refresh-dashboard.sh), which
fetches the latest pageviews from `oat-analytics`'s remote (read-only `git show
origin/main:…` into a temp file — never touches that repo's working tree),
regenerates, and commits **only if the data changed** (the dashboard plus the
GitHub traffic CSVs and `github-actions-clones.csv`, which nothing else backs up). Generation is
deterministic — the header reads "data through `<latest date across sources>`",
not wall-clock time, so a rebuild with no new data is byte-identical and makes
no commit. The weekly LinkedIn/Substack pull calls the same script at the end,
so a fresh scrape shows up immediately too.

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

## GitHub traffic

`github_traffic.py` records views, clones, referrers and popular paths for
every non-fork repo I own, using `gh` (no browser, no scraping). **GitHub only
keeps 14 days of traffic data**, so a systemd user timer
(`~/.config/systemd/user/github-traffic.timer`, `Persistent=true`) runs it
daily to build up the history.

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

**Schedule.** `bin/stats-weekly-pull.sh` runs it on Sunday after the
LinkedIn/Substack pull, with the same 6-day guard (`cws.lastRun`;
`--force` overrides). A failure goes to `failures.log` as `cws pull FAILED`,
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
| `github_traffic.py` | Daily GitHub traffic capture (see [GitHub traffic](#github-traffic)) |
| `cws_stats.py` | Weekly Chrome Web Store stats through the official API (see [Chrome Web Store](#chrome-web-store)) |

Results live outside the repo at the configured `outputPath`.
