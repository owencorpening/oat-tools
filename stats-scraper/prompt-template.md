# Stats Pull — Prompt Template

Run this against the `playwright-stats` MCP server (isolated browser profile,
logged into LinkedIn + Substack once, session persists).

**One-time backfill completed 2026-08-06**: full post history pulled for both
platforms (46 LinkedIn activity cards found, 45 counted as posts — one was a
repost of someone else's content, excluded; all 25 Substack posts, both stats
pages). `stats-log.csv` now has complete history back to the start of both
accounts. Steady-state weekly runs only need recent posts — see `postsPerPull`
below, now 25 (was 10). No need to re-run the backfill.

**Columns added 2026-08-06**: `Captured At` (ISO date the row was scraped —
distinct from the post's own publish date, lets you tell how stale a row's
numbers are) and the LinkedIn `Date` column now holds an absolute ISO date
(`YYYY-MM-DD`), not the relative label ("2mo") LinkedIn shows in the feed. See
"LinkedIn absolute dates" below for how it's derived — decoded from the
activity ID itself, not scraped from a page.

## Prompt

Paste this into **Claude Code** (not claude.ai — the browser session and MCP
server are local). The `playwright-stats` server is registered at user scope,
so this works from any directory. Nothing to fill in by hand.

```text
Read /home/owen/dev/oat-tools/stats-scraper/config.local.json first — it holds
linkedinHandle, substackSubdomain, outputPath, postsPerPull, and lastRun. Use
linkedinHandle/substackSubdomain/outputPath/postsPerPull below.

0. Check lastRun against today's date. If fewer than 7 days have passed, stop
   and tell me how many days remain instead of scraping — don't ask, just
   report it and end. If lastRun is null/missing or 7+ days old, continue.

Using the playwright-stats browser:

1. Navigate to
   https://www.linkedin.com/in/{linkedinHandle}/recent-activity/all/
   Extract: post text preview, impressions, comment count for the last
   {postsPerPull} posts. See "LinkedIn scrape gotchas" below — do not trust a
   single accessibility snapshot or a naive querySelectorAll, both undercount.

2. Navigate to
   https://{substackSubdomain}.substack.com/publish/stats/emails
   Extract: post title, date, views, engagement rate, open rate for the
   last {postsPerPull} posts. The table paginates at 20 rows — if
   {postsPerPull} > 20, click the pagination "next" icon button (the second
   of the two icon buttons directly below the table) to reach later rows.
   The stats table only gives day/time ("May 12, 8:03am"), never the year —
   resolve the year for every post before writing it (mandatory, not just
   for backfills: with postsPerPull=25 pulled weekly, posts from a prior
   year enter the window well within a normal year of runs). See "Substack
   dates omit the year" below for where to find it.

3. Append the results to the CSV at {outputPath}, preserving its existing
   rows and header. Columns: Platform, Title, Date, Audience, Views,
   Comments, Engagement Rate, Free Subs, Paid Subs, Estimated Value,
   Open Rate, URL, Captured At (LinkedIn rows leave Audience/Engagement
   Rate/Free Subs/Paid Subs/Estimated Value/Open Rate blank; Substack rows
   leave Comments blank). Dedup on (URL, Captured At), not URL alone: skip a
   row only if that exact URL already has a row with today's Captured At —
   a post pulled again on a later day gets a new snapshot row instead of
   being skipped, so numbers over time are visible. Write both platforms'
   Date column as an absolute ISO date, not whatever the source page shows
   — this is not a post-processing step, do it before the row is written:
     - LinkedIn: decode the date from the activity ID (see "LinkedIn
       absolute dates" below) rather than using the relative label ("2mo")
       shown in the feed. Date-only: `YYYY-MM-DD`.
     - Substack: prepend the year resolved in step 2 to the existing
       day/time, replacing the bare "May 12" with `YYYY-MM-DD`, keeping the
       time: `2026-05-12, 8:03am`.
   Set Captured At to today's date (YYYY-MM-DD) on every new row.

4. Do not summarize or analyze — just extract structured data.

5. Update lastRun in config.local.json to today's date (YYYY-MM-DD), so the
   next pull knows when this one happened.
```

## Settings

`config.local.json` holds your handle, subdomain, output path, and the
`lastRun` cadence guard. It is gitignored — `oat-tools` is a public repo, and
the output path points at your own performance data. `config.example.json` is
the committed template.

## LinkedIn scrape gotchas (found 2026-08-06, updated during full backfill)

The recent-activity feed is harder to scrape reliably than it looks:

- **Selector: use `[data-urn*="urn:li:activity"]`, not `[role="article"]` +
  the analytics link.** The first backfill pass harvested by finding the
  "View analytics" link inside each `[role="article"]` card and pulling the
  activity URN out of its href. That silently drops every post whose
  impressions widget hasn't rendered — which turned out to be **7 of 46**
  posts, all older ones LinkedIn no longer shows rolling impression data
  for (analytics past ~360 days still exist at the direct URL, just not as
  an inline widget on the feed card). `[data-urn*="urn:li:activity"]` is
  present on every post's own wrapper element regardless of whether the
  analytics widget rendered — harvest by that, then check separately
  whether `a[href*="/analytics/post-summary/"]` exists inside each one.
- **Impressions widget missing ≠ skip it.** For any post where the
  analytics link isn't in the card, navigate directly to
  `https://www.linkedin.com/analytics/post-summary/urn:li:activity:<id>/`
  and read the numbers from there — same data, just not inlined in the
  feed. Confirmed working back to an 11-year-old post.
- **Reposts show up in your own activity feed too.** A card whose actor
  line reads "`<You> reposted this`" followed by someone else's name is a
  repost of someone else's content, not your own post — exclude it from the
  stats log rather than logging their content under your byline. It still
  carries `data-urn`, so the selector above will surface it; check the
  actor text before treating it as a real post.
- **Shadow DOM**: `document.querySelectorAll('article')` returns nothing —
  LinkedIn's post cards are `<div role="article">` inside shadow roots.
  If you do need to walk `[role="article"]` for anything, recurse through
  `el.shadowRoot` on every element, don't rely on plain `querySelectorAll`.
- **Virtualization**: the feed unmounts off-screen post cards as you scroll,
  and a persistent `window`-scoped accumulator only helps if you actually
  scroll past every section — jumping straight to the bottom (even via
  `scrollTo(0, scrollHeight)`) skips whatever hasn't rendered yet along the
  way and there's no way to recover it after the fact except reloading and
  re-scrolling from the top. Scroll in small increments (~400-600px) with
  a several-hundred-ms wait between each, harvesting after every step, for
  the *entire* height from top to bottom in one pass. Stop once several
  consecutive steps produce no new posts and `scrollY` stops advancing —
  confirm via `browser_network_requests` (filter `voyagerFeedDashProfileUpdates`)
  that no further paginated fetch (`start=N`) has fired after multiple
  more scroll attempts, which means the feed has no more pages to give you.
- **Ordering**: don't trust DOM order across a scroll session (accumulation
  order isn't guaranteed once virtualization has swapped nodes in and out).
  Instead sort the accumulated results by the numeric activity ID parsed
  out of the URN — these IDs are Snowflake-style and directly decode to a
  timestamp (see "LinkedIn absolute dates" below), so sorting descending
  gives newest-first reliably. Take the top `postsPerPull` after sorting
  for a steady-state run.
- **Document/carousel posts**: some posts have no caption text, only a PDF
  carousel that's still rendering when you read it ("Your document is
  loading" placeholder). Don't fabricate a title — label it explicitly
  (e.g. `[Document/carousel post — no caption text]`) rather than guessing.
- **Analytics page label/value order isn't consistent.** On
  `/analytics/post-summary/`, the headline stats (Impressions, Social
  engagements) show as *value then label* ("28 / Impressions"), but the
  engagement breakdown below it (Reactions, Comments, Reposts, Saves,
  Sends) shows as *label then value* ("Comments / 5"). A regex that grabs
  "the number before the label text" gets the headline stats right and the
  breakdown wrong — it'll silently attribute the Reactions count to
  Comments. Read the full text block and pair each label with the number
  that *follows* it for the breakdown section.

## LinkedIn absolute dates (found 2026-08-06, during the backfill)

The feed only ever shows a relative label ("2mo", "3yr") — LinkedIn does not
expose the exact post date anywhere in the rendered UI. Checked and ruled
out: `title`/`datetime`/`aria-label` attributes on the timestamp element (none
carry a date), hovering the relative-time text (no tooltip appears), the
`/analytics/post-summary/` page (same relative label, no `<time>` elements at
all — it's a different rendering stack that doesn't use `<code>`-embedded
JSON), and the post's own `Update` entity in the feed permalink's embedded
JSON (`com.linkedin.voyager.dash.feed.Update` → `metadata` has no
createdAt/publishedAt field).

**Trap**: the feed permalink page (`/feed/update/urn:li:activity:<id>/`) does
embed normalized JSON in `<code>` tags containing `"createdAt"` fields —
but those belong to *comment* entities (`com.linkedin.voyager.dash.social.Comment`)
that reference the post's URN, not the post itself. A naive extraction that
searches a `<code>` tag's raw text for the first `"createdAt"` near the
activity ID will silently return a comment's timestamp instead of the post's.
This was caught by noticing the extracted dates weren't monotonic with
activity-ID order across the backfill set — always cross-check monotonicity
if you try this route again.

**What works**: LinkedIn activity/share URN IDs are Snowflake-style — the
creation timestamp is encoded directly in the ID. Decode with:

```text
timestamp_ms = activity_id >> 22   # Unix epoch milliseconds, UTC
```

Validated against all 45 backfilled posts: decoding every ID and comparing
against that row's previously-recorded relative label ("2mo" through "11yr")
produced a perfectly monotonic, bucket-consistent result with zero
exceptions — e.g. every "2mo" post decoded to 65–89 days before capture,
every "3yr" post to 1237–1408 days, etc. This is not officially documented by
LinkedIn, but it's a real value embedded in LinkedIn's own ID generation, not
a computed guess, and it worked for all 45 posts checked, including one from
11 years ago. If a future ID ever fails this monotonicity/bucket sanity
check, don't trust the decode for that post — fall back to the relative label
and flag it rather than writing a wrong absolute date.

## Substack dates omit the year (found 2026-08-06, still applies to every run)

`/publish/stats/emails` shows "May 12, 8:03am" — no year, ever, even for
posts over a year old. Never assume the current year: this is not a
backfill-only problem — at postsPerPull=25 pulled weekly, the window
crosses into a prior year for part of the year on every steady-state run
too, not just the one-time backfill that first surfaced this.

**Where the year actually lives, every time**: the `/archive` page lists
every public post's `<time datetime="...">` (full ISO, with year) alongside
its permalink in one page load — visit it once per run and match rows to
the stats table by slug-vs-title (the slug is usually a close match to the
current title, occasionally a stale draft title). This is the standard
source, not just a backfill shortcut. A single post's own `/p/<id>`
permalink also works if you only need one (its "more from this author"
widget additionally surfaces ~10 *other* posts' dates for free, though it's
a fixed set, not a chronological neighbor list — don't expect visiting more
permalinks to reveal new ones). Cross-check by converting the UTC
`datetime` to `America/Chicago` (Austin) and confirming it reproduces the
stats table's exact day-of-month and time-of-day before trusting the year.

**Unlisted/deleted posts** (e.g. an internal template post with a handful of
views) return **404 on both the public permalink and the archive** — they
never got a real public page. For those, use the dashboard's draft-editor
route instead: `https://{subdomain}.substack.com/publish/post/<id>` loads
`GET /api/v1/drafts/<id>` in the network log, whose JSON body has a
`post_date` field (ISO, UTC) even for a post that was never truly published.

Convert whichever UTC timestamp you found to `America/Chicago` and take the
date (`YYYY-MM-DD`) — that's what reproduces the stats table's local
day/time, confirmed across all 25 backfilled posts with zero mismatches.

## Cadence

Run weekly, not continuously. Reduces both fragility (markup drift breaking
mid-run) and the appearance of automated traffic patterns on LinkedIn.

Enforced via `lastRun` in `config.local.json`: step 0 of the prompt checks it
and refuses to scrape if fewer than 7 days have passed, and step 5 updates it
to today's date after a successful pull.

## Output handling

Rows are appended to the CSV at `outputPath` (default
`~/oat-data/stats/stats-log.csv` — outside the repo, since `oat-tools` is
public). Open it in VS Code with rainbow-csv, or import to Sheets for the
Ghost Tracker ingestion path (GAS, zero-infra, consistent with the rest of
the OAT stack).

Columns: Platform, Title, Date, Audience, Views, Comments, Engagement Rate,
Free Subs, Paid Subs, Estimated Value, Open Rate, URL, Captured At.

- **Date** — the post's own publish date, absolute for both platforms, never
  taken at face value from either stats table. LinkedIn's is decoded from
  the activity ID (see "LinkedIn absolute dates" above); Substack's stats
  table gives day/time but omits the year, so the year is resolved
  per-post from the permalink or archive page (see "Substack dates omit
  the year" above) and prepended as `YYYY-MM-DD` ahead of the existing
  `H:MMam/pm` — e.g. `2026-05-12, 8:03am`. LinkedIn rows are date-only
  (`YYYY-MM-DD`) since LinkedIn never exposes a time-of-day at all.
- **Captured At** — the date *this row* was scraped (`YYYY-MM-DD`), added
  2026-08-06. Distinct from Date: a post's numbers (views, engagement) can
  be re-pulled later and change, so this says when the snapshot was taken.

**Dedup key: (URL, Captured At), decided 2026-08-06.** Not URL alone — a
post pulled again on a later day gets a new snapshot row instead of being
skipped, so numbers over time are visible in the CSV (e.g. a post's view
count a week after publish vs. a month after). A second run on the *same*
day still no-ops against an accidental double-run. Tradeoff: the file is no
longer one row per post, it's one row per post per capture — anything
downstream that assumes URL uniqueness (e.g. the Ghost Tracker Sheets
ingestion) needs to pick "latest row per URL" explicitly rather than
assuming a 1:1 mapping.

## Setup notes (one-time)

1. Add `mcp-config.json` to your Claude Code MCP settings (user scope).
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
