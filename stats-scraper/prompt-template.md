# Stats Pull — Prompt Template

Run this against the `playwright-stats` MCP server (isolated browser profile,
logged into LinkedIn + Substack once, session persists).

## Prompt

```
Using the playwright-stats browser:

1. Navigate to https://www.linkedin.com/analytics/creator/content/
   Extract: post date, impressions, reactions, comments for the last 10 posts.

2. Navigate to https://<YOUR_SUBDOMAIN>.substack.com/publish/stats
   Extract: post title, date, opens, open rate, views for the last 10 posts.

3. Output as a single CSV block with columns:
   platform, title, date, impressions_or_views, engagement, open_rate

4. Do not summarize or analyze — just extract structured data.
```

Replace `<YOUR_SUBDOMAIN>` with your actual Substack subdomain before running.

## Cadence

Run weekly, not continuously. Reduces both fragility (markup drift breaking
mid-run) and the appearance of automated traffic patterns on LinkedIn.

## Output handling

Paste/save the returned CSV into `stats-log.csv` in this directory, or feed
it into the Ghost Tracker Google Sheet ingestion path (GAS, zero-infra,
consistent with the rest of the OAT stack).

## Setup notes (one-time)

1. Add `mcp-config.json` to your Claude Code / Claude Desktop MCP settings.
2. Launch it once and log into LinkedIn + Substack manually inside that
   isolated profile — the session persists in `--user-data-dir` afterward.
3. Never point this profile at your everyday logged-in Chrome — isolation is
   the whole point (limits blast radius if a page tries prompt injection,
   and keeps this from touching unrelated logged-in accounts).

## Known risks (carried over from research, 2026-08-03)

- Both platforms can change DOM/markup at any time and break selectors —
  same fragility as any scraper, just without the ToS exposure of
  credential-based scraping.
- Page content is a potential prompt-injection vector; keep this browser
  profile isolated and single-purpose.
- Keep `@playwright/mcp` updated — CVE-2025-9611 (DNS rebinding) was patched
  in versions after 0.0.40.
