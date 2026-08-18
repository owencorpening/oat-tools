# oat-link-tracker

Minimal trackable-link redirector for social distribution (X, Instagram).
Built 2026-08-18 to answer a real gap: platform-native analytics can't
show whether a social post actually drove traffic, especially on
Instagram where only the bio link is clickable. This gives Owen a link
he controls, so clicks are measured directly.

Same Worker + D1 pattern as `oat-publishing-ledger` — no new
architecture invented.

## Live URL

`https://oat-link-tracker.owencorpening.workers.dev`

**Not a custom domain.** No `owencorpening.dev` (or similar) zone exists
on this Cloudflare account yet — both this and the two existing OAT
Workers run on the default `*.workers.dev` subdomain. A short custom
domain (e.g. `links.owencorpening.dev`) would need a domain registered
and pointed at Cloudflare first — a real cost/DNS decision, not made
here. Flagging rather than assuming either way.

## Creating a tracked link

```bash
export LINK_TRACKER_TOKEN="..."   # the ADMIN_TOKEN secret value
./create-link.sh x-post-1 "https://owencorpening.substack.com/p/some-article" "x-post-1"
```

Returns the tracked URL to actually post:
`https://oat-link-tracker.owencorpening.workers.dev/x-post-1`

**For Instagram:** use a `campaign_label` starting with `ig-` (e.g.
`ig-water-series-p10`). The bio link should point at
`https://oat-link-tracker.owencorpening.workers.dev/ig` — a small
landing page listing the 3 most recent `ig-*` links, so multiple active
Instagram posts can be measured simultaneously instead of only ever
tracking whichever one is live in the bio at a given moment.

## How it works

- `GET /:slug` — logs a click (timestamp, referrer, any `utm_*` query
  params passed through) then 302-redirects to the destination URL.
- `GET /ig` — static-ish landing page, links point back through `/:slug`
  so clicks from the landing page are tracked the same way.
- `POST /admin/create` — creates a new slug → destination mapping.
  Bearer-token protected (`ADMIN_TOKEN` secret).
- `GET /admin/export` — returns the full click log as JSON, clicks
  joined with their link's campaign label. Bearer-token protected.

## Data

D1 database `oat-link-tracker`, two tables:
- `links (slug, destination_url, campaign_label, created_at)`
- `clicks (id, slug, timestamp, referrer, utm_source, utm_medium, utm_campaign)`

## Folding into stats-scraper later

`GET /admin/export` already returns click data in roughly the same
shape as `stats-log.csv` (timestamp, source, campaign label) — this
could become one more source `stats-scraper`'s prompt-template pulls
from, same way it currently pulls LinkedIn/Substack data. Not wired up
yet; this pass was tracking-layer only, per the task's explicit scope
(no dashboard, no auto-posting, no Instagram content tooling).

## Deploying changes

```bash
cd worker/
wrangler deploy
```

## Rotating the admin token

```bash
cd worker/
wrangler secret put ADMIN_TOKEN
```
