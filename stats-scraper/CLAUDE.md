# stats-scraper

Part of `oat-tools`. Pulls LinkedIn + Substack post performance stats via an
isolated Playwright MCP browser session (own-account dashboards only, no
credential scraping, no third-party data broker).

## Status

- **State:** Operational — first successful run 2026-08-06, both platforms
- **Last updated:** 2026-08-06
- **Owner:** Owen Corpening

## What it does

Drives a dedicated, isolated Chrome profile through `@playwright/mcp` to
read the analytics pages you're already logged into (LinkedIn Creator
Analytics, Substack Stats) and extract post-level metrics into CSV.

## Dependencies

- `@playwright/mcp` installed globally (`npm i -g @playwright/mcp`) — runs as
  the `playwright-mcp` binary. Not via npx: `npx @latest` re-resolves against
  the registry on every launch and is noticeably slower to start.
- One-time manual login to LinkedIn + Substack inside the isolated profile

## Files

- `mcp-config.json` — MCP server config (isolated profile, own user-data-dir)
- `config.example.json` — settings template (committed)
- `config.local.json` — real handle/subdomain/output path (gitignored)
- `prompt-template.md` — the extraction prompt + setup notes + known risks
- `README.md` — human-facing overview

Output goes to `outputPath` from `config.local.json`, default
`~/oat-data/stats/stats-log.csv`. **Not** in this repo — `oat-tools` is a
public GitHub repo, and the CSV holds Owen's own performance numbers. An
earlier version was committed and pushed here; removed and scrubbed from
history 2026-08-06.

## Next steps

- [x] Add `mcp-config.json` to Claude Code MCP settings
- [x] One-time login inside isolated profile
- [x] First test run against real LinkedIn/Substack accounts
- [x] Add LinkedIn alongside Substack (both platforms pulling)
- [ ] Wire CSV output into Ghost Tracker's GAS/Sheet ingestion path
- [ ] Set weekly cadence (manual trigger or scheduled)

## Notes

Setup gotchas found during the first run:

- The binary `@playwright/mcp` installs is `playwright-mcp`, **not**
  `mcp-server-playwright`.
- `--isolated` and `--user-data-dir` conflict — pass one or the other, not
  both. Use `--user-data-dir` here, since the persisted login session is the
  whole point.

Deliberately avoids the community LinkedIn scraper MCPs (cookie-based,
ToS-risk to the account) in favor of browsing your own dashboards through
an official, isolated Playwright session. See `prompt-template.md` for the
full risk rundown as researched 2026-08-03.
