# Stats Pull — Prompt Template

Run this against the `playwright-stats` MCP server (isolated browser profile,
logged into LinkedIn + Substack once, session persists).

## Prompt

Paste this as-is — it reads your settings from `config.local.json`, so there
is nothing to fill in by hand.

```
Read stats-scraper/config.local.json first — it holds linkedinHandle,
substackSubdomain, outputPath, and postsPerPull. Use those values below.

Using the playwright-stats browser:

1. Navigate to
   https://www.linkedin.com/in/{linkedinHandle}/recent-activity/all/
   Extract: post text preview, impressions, comment count for the last
   {postsPerPull} posts. See "LinkedIn scrape gotchas" below — do not trust a
   single accessibility snapshot or a naive querySelectorAll, both undercount.

2. Navigate to
   https://{substackSubdomain}.substack.com/publish/stats/emails
   Extract: post title, date, views, engagement rate, open rate for the
   last {postsPerPull} posts.

3. Append the results to the CSV at {outputPath}, preserving its existing
   rows and header. Columns: Platform, Title, Date, Audience, Views,
   Comments, Engagement Rate, Free Subs, Paid Subs, Estimated Value,
   Open Rate, URL (LinkedIn rows leave Audience/Engagement Rate/Free Subs/
   Paid Subs/Estimated Value/Open Rate blank; Substack rows leave Comments
   blank). Skip any post already present in the file — match on URL.

4. Do not summarize or analyze — just extract structured data.
```

## Settings

`config.local.json` holds your handle, subdomain, and output path. It is
gitignored — `oat-tools` is a public repo, and the output path points at your
own performance data. `config.example.json` is the committed template.

## LinkedIn scrape gotchas (found 2026-08-06)

The recent-activity feed is harder to scrape reliably than it looks:

- **Shadow DOM**: `document.querySelectorAll('article')` returns nothing —
  LinkedIn's post cards are `<div role="article">` inside shadow roots.
  Query by `[role="article"]` and recurse through `el.shadowRoot` on every
  element, don't rely on plain `querySelectorAll`.
- **Virtualization**: the feed unmounts off-screen post cards as you scroll.
  Jumping straight to the bottom and reading the DOM once will silently
  *skip* posts in the middle — the accessibility snapshot and a single
  `browser_evaluate` pass both undercounted on the first attempt (5 of 20
  loaded, then 19 of a different set after one scroll-to-bottom).
  Fix: scroll in ~15 small increments across the full page height, and
  after each increment harvest any not-yet-seen `[role="article"]` node
  (dedupe by the analytics URL, which embeds the activity URN) into a
  `window`-scoped accumulator. This reliably picks up 30+ posts.
- **Ordering**: don't trust DOM order across a scroll session (accumulation
  order isn't guaranteed once virtualization has swapped nodes in and out).
  Instead sort the accumulated results by the numeric activity ID parsed
  out of the analytics URL (`/analytics/post-summary/urn:li:activity:<id>/`)
  — these IDs are roughly time-ordered (Snowflake-style), so sorting
  descending gives newest-first reliably. Take the top 10 after sorting.
- **Document/carousel posts**: some posts have no caption text, only a PDF
  carousel that's still rendering when you read it ("Your document is
  loading" placeholder). Don't fabricate a title — label it explicitly
  (e.g. `[Document/carousel post — no caption text]`) rather than guessing.

## Cadence

Run weekly, not continuously. Reduces both fragility (markup drift breaking
mid-run) and the appearance of automated traffic patterns on LinkedIn.

## Output handling

Rows are appended to the CSV at `outputPath` (default
`~/oat-data/stats/stats-log.csv` — outside the repo, since `oat-tools` is
public). Open it in VS Code with rainbow-csv, or import to Sheets for the
Ghost Tracker ingestion path (GAS, zero-infra, consistent with the rest of
the OAT stack).

## Setup notes (one-time)

1. Add `mcp-config.json` to your Claude Code / Claude Desktop MCP settings.
2. Copy `config.example.json` to `config.local.json` and fill in your handle,
   subdomain, and output path.
3. Launch it once and log into LinkedIn + Substack manually inside that
   isolated profile — the session persists in `--user-data-dir` afterward.
4. Never point this profile at your everyday logged-in Chrome — isolation is
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
