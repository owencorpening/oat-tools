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

The timer runs `~/.local/bin/stats-weekly-pull.sh` (local to the machine, not
in this repo — it hardcodes paths and runs
`claude -p ... --dangerously-skip-permissions` headless): it loads node via
nvm, runs the prompt above against the `playwright-stats` server, and
commits/pushes the data repo (step 6). The 7-day guard means a manual pull
earlier in the week makes the scheduled run a safe no-op. Logs:
`~/.local/state/stats-scraper/logs/` (outside the data repo, so they're never
committed); failures also append to `failures.log` there. If LinkedIn's login
expires, an unattended run fails — re-log into the isolated profile and the
next run recovers.

### Dashboard

`bin/build-dashboard.py` reads all the data CSVs (`stats-log.csv`,
`github-traffic-*.csv`, and `oat-analytics`'s `pageviews.csv`) and writes one
self-contained `~/oat-data/stats/dashboard.html` — GitHub, LinkedIn, Substack,
and the OAT site on a single offline page, data baked in, light/dark aware. The
weekly wrapper regenerates and commits it after each pull, so it stays current.
Run it by hand anytime with `python3 -I bin/build-dashboard.py`. The site panel
reflects the local `oat-analytics` checkout — `git -C ~/dev/oat-analytics pull`
first if you want the freshest pageviews.

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

Results live outside the repo at the configured `outputPath`.
