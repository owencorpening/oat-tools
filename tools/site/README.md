# OAT site build

Builds the public Owen's Applied Thinking site (repo `oat-web`) from the
private `oat-content` repo. It runs in oat-content's CI; only the output
directory is pushed to oat-web.

```bash
node tools/site/build-site.js --content <path to oat-content> --out <empty dir>
npm run test:site
```

## The publish gate (`lib/gate.js`)

An article is published only when all of these hold:

1. A tag `pub/<series>/<slug>/<YYYY-MM-DD>[.N]` exists. The newest tag for an
   article wins. Standalone articles use `pub/standalone/<slug>/...`.
2. The tagged commit is on `main`.
3. At that commit exactly one Markdown file has front matter with that
   `slug` and `series` (no `series` means standalone).
4. That file has `text_status: published`, `title`, `published`
   (YYYY-MM-DD), `slug` and `type` (`substack-article`, `linkedin-article`
   or `linkedin-post`), and is not a carousel (`marp: true`).
5. On `main` today the article still says `text_status: published`.
   Changing it on main unpublishes the article on the next build.

The text comes from the tagged commit only, so edits after the tag stay off
the site until the article is tagged again. The build never walks folders,
so drafts, notes and corrections can't be picked up. A published article that
links to an OAT Substack post that isn't published, or to a repo `.md` file,
fails the build. Any failure stops the build before anything is written.

## The gate test (`test/publishGate.test.js`)

Builds throwaway git repos with made-up articles and plants `CANARY_` text in
drafts, untagged articles, notes, superseded versions, post-tag edits and
unpublished articles, then checks that none of it appears in any output file.
It also checks each failure rule. This repo is public, so fixtures must never
contain real drafts.

## Pages (`lib/writeSite.js`)

Home (`/`), one page per series with a published article (`/<series>/`,
plus `/standalone/`), one page per article (`/<series>/<slug>/`) and
`404.html`. Plain HTML and one stylesheet: no JavaScript, no outside
requests. Every image a published article uses is downloaded into
`assets/` and the page points at the copy. Links between published
articles become site links; Substack `?r=` referral codes are removed.

Series names, descriptions and order come from `site/series.json` in
oat-content (read from `main`):

```json
[{ "id": "water", "name": "Water Resilience", "description": "…", "order": 1 }]
```

## Status

Still to come: the remaining pre-publish checks (placeholder links, sources
section) and the oat-content workflow that builds and pushes to oat-web.
