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

1. **Register the MCP server.** Add the contents of `mcp-config.json` to your
   Claude Code MCP settings — user scope, so it's available from any
   directory. (Currently registered in `~/.claude.json`.) It defines one server,
   `playwright-stats`, pointed at a dedicated profile directory
   (`~/.playwright-stats-profile`).

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

## Running a pull

Paste the prompt from `prompt-template.md` into **Claude Code**. Not claude.ai
— the MCP server and browser profile are both local, so only a locally-running
client can reach them.

The server is registered at user scope, so it works from any directory, and
the prompt uses an absolute path to `config.local.json`. Nothing to fill in.

Run it **weekly, not continuously.** Less exposure to markup drift breaking a
run midway, and it avoids traffic patterns that look automated to LinkedIn.

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

Results live outside the repo at the configured `outputPath`.
