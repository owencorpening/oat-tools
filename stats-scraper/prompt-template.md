# Stats Pull — Prompt Template

Run this against the `playwright-stats` MCP server (isolated browser profile,
logged into LinkedIn + Substack once, session persists).

**One-time backfill completed 2026-08-06**: full post history pulled for both
platforms (46 LinkedIn activity cards found, 45 counted as posts — one was a
repost of someone else's content, excluded; all 25 Substack posts, both stats
pages). `stats-log.csv` now has complete history back to the start of both
accounts. Steady-state weekly runs only need recent posts — see `postsPerPull`
below, now 25 (was 10). No need to re-run the backfill.

**⚠️ LinkedIn re-platformed the activity feed between 2026-09-15 and
2026-11-07.** `[data-urn*="urn:li:activity"]` is gone, `window` doesn't
scroll, and feed cards no longer show impression counts. Read "LinkedIn
scrape gotchas" below **before** writing any selector — the three naive
approaches it rules out now all fail silently, returning a plausible-looking
partial result (20 of 48 cards) rather than an error. Expected shape of a
healthy LinkedIn pass as of 2026-11-07: **48 cards, 1 repost excluded, 9
without analytics widgets, 47 posts.**

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
   {postsPerPull} posts. Read "LinkedIn scrape gotchas" below BEFORE writing
   a selector — a single accessibility snapshot, a naive querySelectorAll,
   `[data-urn]` (removed 2026-11-07) and `window.scrollBy` (no-op on this
   page) all undercount without erroring. Impressions and comment counts are
   no longer in the feed cards at all: enumerate posts from the feed, then
   read each post's numbers from its /analytics/post-summary/ page.

2. Navigate to
   https://{substackSubdomain}.substack.com/publish/stats/emails
   Extract: post title, date, views, engagement rate, open rate for the
   last {postsPerPull} posts. The table paginates at 20 rows — if
   {postsPerPull} > 20, click the pagination "next" icon button (the second
   of the two icon buttons directly below the table) to reach later rows.
   The stats table gives day/time with no year for recent posts ("May 12,
   8:03am"), and adds a year only past ~12 months ("Nov 04 2025, 3:24pm") —
   resolve the year from a dated source for every post before writing it
   (mandatory, not just for backfills: with postsPerPull=25 pulled weekly,
   posts from a prior year enter the window well within a normal year of
   runs). Where the table does show a year, require it to agree rather than
   skipping the lookup. Also grab each row's own /p/<id> link for the URL
   column. See "Substack dates omit the year" below for where the year
   lives and how to join it to these rows.

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

## LinkedIn scrape gotchas (found 2026-08-06, **rewritten 2026-11-07** after a markup migration)

The recent-activity feed is harder to scrape reliably than it looks, and
LinkedIn re-platformed the page between the 2026-09-15 and 2026-11-07 runs.

> **2026-11-07 — the page moved to a new "SDUI" rendering stack.** Three of
> the things this section used to tell you to do now silently fail:
> `[data-urn*="urn:li:activity"]` no longer exists anywhere in the DOM,
> `window` no longer scrolls, and feed cards no longer contain an
> impressions number at all. Class names are obfuscated, per-build hashes
> (`gvymfy gvymfx gvyk8o …`) — never select on them. The bullets below are
> updated; the pre-migration behavior is noted where it's still useful
> history.

- **Selector: use `[role="listitem"][componentkey^="update-card"]`.** Each
  post card is a `div` with that pair, inside the container
  `[data-testid="ProfileRecentActivityAll-{linkedinHandle}"]`
  (`role="list"`, `data-component-type="LazyColumn"`). This is the current
  stand-in for the old `data-urn` wrapper: present on every card whether or
  not the analytics widget rendered.
  - *History:* the original backfill harvested by finding the "View
    analytics" link inside each `[role="article"]` card and pulling the URN
    out of its href. That silently drops every post whose impressions
    widget hasn't rendered — **7 of 46** posts then, **9 of 48** on
    2026-11-07. Then `[data-urn*="urn:li:activity"]` fixed it; now that
    attribute is gone and `componentkey` is the replacement.
- **The activity ID is now *only* in the analytics href.** Post-migration,
  the sole place the URN appears in the DOM is
  `a[href*="/analytics/post-summary/"]` inside the card — i.e. the exact
  fragile source the bullet above warns about, now unavoidable. So the
  card-level selector gets you a complete *count* of posts, but the ~9
  oldest cards have **no ID available from the feed at all**. The
  `componentkey` is an opaque token, not an encoded ID. Harvest those cards
  by `componentkey` so you still know they exist, then resolve their IDs
  out of band (matching title against prior `stats-log.csv` rows works, and
  for a steady-state `postsPerPull=25` run they're well outside the window
  anyway). Don't let a missing ID silently shrink the pull.
- **Impressions are no longer in the feed card — every post needs its
  analytics page.** This used to be true only for posts older than ~360
  days; as of 2026-11-07 the card shows a bare "View analytics" link and no
  number for *any* post. Read each one from
  `https://www.linkedin.com/analytics/post-summary/urn:li:activity:<id>/`.
  That page is **server-rendered**, so don't navigate 25 times — `fetch()`
  it from the page with `credentials: 'include'`, parse with `DOMParser`,
  and read `body.innerText`. 25 posts at a ~700ms gap is one tool call.
  Confirmed working back to an 11-year-old post.
- **The scroll container is `<main>`, not `window`.** `document.body` is
  `overflow: hidden` and `document.documentElement.scrollHeight` sits at
  roughly viewport height (1355px) no matter how much feed there is, so
  `window.scrollBy`/`scrollTo` are silent no-ops — a full scroll pass will
  run to completion with `scrollY: 0` and harvest only the ~20 cards that
  happened to be in the initial DOM. Find it generically rather than by
  class: the element with `scrollHeight > clientHeight`, `clientHeight >
  200`, and computed `overflow-y` of `auto|scroll` (currently exactly one
  match, `main`, e.g. 11212 vs 1303). Drive `sc.scrollBy(0, 500)` and read
  `sc.scrollTop` / `sc.scrollHeight`.
- **Virtualization**: the feed unmounts off-screen post cards as you scroll,
  and a persistent `window`-scoped accumulator only helps if you actually
  scroll past every section — jumping straight to the bottom skips whatever
  hasn't rendered yet along the way and there's no way to recover it after
  the fact except reloading and re-scrolling from the top. Scroll in small
  increments (~400-600px) with a several-hundred-ms wait between each,
  harvesting after every step, for the *entire* height from top to bottom in
  one pass. Pagination fires on the container's scroll and grows
  `scrollHeight` in jumps — observed at ~9500px (+10 cards), ~14000px (+10),
  ~17500px (+6), then two more at the end. Stop once several consecutive
  steps add nothing *and* `scrollTop` has stopped advancing; a known total
  (48 cards / 47 posts as of 2026-11-07) is the best confirmation the feed
  is exhausted.
  - *Note:* `browser_network_requests` filtered on
    `voyagerFeedDashProfileUpdates` no longer confirms exhaustion — the
    initial page is server-rendered and the new stack's pagination fetches
    didn't appear under that name in the 2026-11-07 run.
- **Reposts show up in your own activity feed too.** A card whose actor
  line reads "`<You> reposted this`" followed by someone else's name is a
  repost of someone else's content, not your own post — exclude it from the
  stats log rather than logging their content under your byline. It is a
  normal `update-card` listitem, so the selector above will surface it;
  check the actor text before treating it as a real post. (1 of 48 on
  2026-11-07, same single repost as the backfill.) These cards also carry no
  analytics link, so they land in the "no ID" bucket — don't confuse them
  with old posts.
- **Shadow DOM / `<article>`**: `document.querySelectorAll('article')`
  returns nothing, and post-migration `[role="article"]` is gone as well
  (cards are `role="listitem"`). The 2026-11-07 cards were reachable by
  plain `querySelectorAll` with no shadow roots in the path — but if you
  write a generic element walk for this page, still recurse `el.shadowRoot`
  rather than assuming plain `querySelectorAll` sees everything.
- **Ordering**: don't trust DOM order across a scroll session (accumulation
  order isn't guaranteed once virtualization has swapped nodes in and out).
  Instead sort the accumulated results by the numeric activity ID from the
  analytics href — these IDs are Snowflake-style and directly decode to a
  timestamp (see "LinkedIn absolute dates" below), so sorting descending
  gives newest-first reliably. Take the top `postsPerPull` after sorting
  for a steady-state run. Cards with no ID can't be sorted this way; they
  were all the oldest posts on 2026-11-07, but verify that rather than
  assuming it.
- **Title extraction from the new card layout**: split the card's
  `innerText` into non-empty lines and find the relative-time line
  (`/^\d+\s*(mo|yr|w|d|h)\b/`, which may read "5mo • Edited"); the post's
  own text starts on the **next** line. Lines before it are chrome: "Feed
  post", your name, "• You", your headline. Don't index from the top of the
  card.
- **Some titles come back CSS-truncated** with a trailing "…" (e.g. "The
  Aquifer Restoration Manife…") — these are link-preview/article cards
  where the visible text is clipped, not the real title. Prior
  `stats-log.csv` rows already hold the resolved full title for anything
  from the backfill; reuse that by activity ID rather than writing the
  truncated string. Note the CSV's titles also have leading emoji stripped
  (card "🌊 Part IV: …" vs CSV "Part IV: …") — keep reusing the CSV form so
  a post's title stays stable across snapshot rows.
- **Document/carousel posts**: some posts have no caption text, only a PDF
  carousel that's still rendering when you read it ("Your document is
  loading" placeholder). Don't fabricate a title — label it explicitly
  (e.g. `[Document/carousel post — no caption text]`) rather than guessing.
  Two such posts are already logged under that exact label.
- **Analytics page label/value order isn't consistent.** On
  `/analytics/post-summary/`, the headline stats (Impressions, Social
  engagements) show as *value then label* ("28 / Impressions"), but the
  engagement breakdown below it (Reactions, Comments, Reposts, Saves,
  Sends) shows as *label then value* ("Comments / 5"). A regex that grabs
  "the number before the label text" gets the headline stats right and the
  breakdown wrong — it'll silently attribute the Reactions count to
  Comments. Read the full text block and pair each label with the number
  that *follows* it for the breakdown section.
  **Still true on 2026-11-07** (this page survived the migration). The
  collapsed `innerText` reads
  `…Discovery122ImpressionsProfile activity0…Engagement1Social
  engagementsReactions0Comments1Reposts0Saves0Sends on LinkedIn0…`, so
  `/([\d,]+)\s*Impressions/` and `/Comments\s*([\d,]+)/` are the correct
  pair of directions. Pull `Reactions` too as a sanity check — it's the
  number a "before the label" regex would wrongly hand you for Comments.

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

**Re-validated 2026-11-07**, and this is now the load-bearing check on the
whole LinkedIn pull: all 25 IDs in the window decoded monotonically in ID
order and reproduced the dates recorded on 2026-08-06 and 2026-09-15
exactly. Since the migration removed every other date signal from the page,
a decode that disagrees with a prior `stats-log.csv` row for the same
activity ID is the clearest early warning that something upstream changed —
compare against the CSV on every run, not just on backfills.

## Substack dates omit the year (found 2026-08-06, updated 2026-11-07)

`/publish/stats/emails` shows "May 12, 8:03am" — no year for recent posts.
Never assume the current year: this is not a backfill-only problem — at
postsPerPull=25 pulled weekly, the window crosses into a prior year for
part of the year on every steady-state run too, not just the one-time
backfill that first surfaced this.

**2026-11-07 correction**: the table *does* print a year once a post is
past roughly 12 months ("Nov 04 2025, 3:24pm"), so "no year, ever" was too
strong. That doesn't change the procedure — the rows that matter are the
recent ones, which are still bare, and the 12-month boundary is exactly
where a wrong guess is most likely. Resolve the year from a dated source
for every row regardless; where the table does show one, treat it as a
check that must agree, not as a reason to skip the lookup.

**Where the year actually lives, every time**: the `/archive` page lists
every public post's `<time datetime="...">` (full ISO, with year) alongside
its permalink — visit it once per run and match rows to the stats table by
slug-vs-title (the slug is usually a close match to the current title,
occasionally a stale draft title). This is the standard source, not just a
backfill shortcut. A single post's own `/p/<id>` permalink also works if
you only need one (its "more from this author" widget additionally surfaces
~10 *other* posts' dates for free, though it's a fixed set, not a
chronological neighbor list — don't expect visiting more permalinks to
reveal new ones). Cross-check by converting the UTC `datetime` to
`America/Chicago` (Austin) and confirming it reproduces the stats table's
exact day-of-month and time-of-day before trusting the year.

**The archive is not one page load, and its pagination is not a URL
param** (found 2026-11-07): `/archive?sort=new` renders only the newest
**12** posts and lazy-loads the rest on scroll. `?offset=12` / `?offset=24`
are **ignored** — they return the same first 12 every time, which looks
like success if you only count rows (24 links found, 12 unique). And
`/api/v1/archive?limit=&offset=` returns **400**, so there's no clean JSON
shortcut. Navigate to `/archive` for real and scroll (`window` does scroll
here, unlike LinkedIn), harvesting `<time datetime>` per `/p/<slug>` link
until the count stops growing — 24 of 25 posts in the 2026-11-07 run, the
25th being the unlisted one below.

**Matching archive dates to stats-table rows**: don't rely on title string
equality — the archive and the stats table disagree on curly quotes,
en/em dashes and truncation. Match on the rendered date instead: convert
each archive `datetime` to `America/Chicago`, format it the way the table
does (`%b %d, h:MMam/pm`), and require **exactly one** candidate per row.
That makes the prescribed cross-check *be* the join, so a row that would
have been ambiguous fails loudly instead of silently taking a wrong year.
The numeric post ID for the `URL` column comes from the stats table row's
own link (`a[href]` → `/p/<id>`), not from the archive's slug.

**Unlisted/deleted posts** (e.g. an internal template post with a handful of
views) return **404 on both the public permalink and the archive** — they
never got a real public page. For those, use the dashboard's draft-editor
route instead: `https://{subdomain}.substack.com/publish/post/<id>` loads
`GET /api/v1/drafts/<id>` in the network log, whose JSON body has a
`post_date` field (ISO, UTC) even for a post that was never truly published.
You can skip the page load and `fetch('/api/v1/drafts/<id>')` directly —
confirmed 2026-11-07 for id `183861863` ("Post template", `is_published:
false`), which returned `post_date: 2026-01-08T01:53:19.548Z` → Chicago
`2026-01-07 7:53pm`, reproducing the stats table's "Jan 07, 7:53pm". Note
its `draft_title` ("Master Post template") differs from the title the stats
table shows ("Post template") — another reason not to join on title.

Convert whichever UTC timestamp you found to `America/Chicago` and take the
date (`YYYY-MM-DD`) — that's what reproduces the stats table's local
day/time, confirmed across all 25 posts on both the 2026-08-06 backfill and
the 2026-11-07 run with zero mismatches (including both DST boundaries).

**Stats-table pagination still works as described** (confirmed 2026-11-07):
20 rows per page, and the two icon buttons just below the table are
prev/next — the first is `disabled` on page 1, so click the second. A
reliable way to find them without touching class names: buttons not
contained by the `<table>`, whose bounding box sits within ~160px below the
table's bottom edge, that contain an `<svg>`. Page 2 held the remaining 5
of 25.

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
