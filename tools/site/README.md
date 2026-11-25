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
   article wins. Articles outside a series use `pub/vectors/<slug>/...`.
2. The tagged commit is on `main`.
3. At that commit exactly one Markdown file has front matter with that
   `slug` and `series` (no `series` means the default series, `vectors`).
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

The site is OAT with three parts under it (2026-11-22):

- OAT home (`/`): cornerstone photo, tagline and three cards: Writing, Free
  tools, Products. The OAT plaque in every header links here.
- Writing (`/writing/`): one card per series with a published article, one
  page per series (`/writing/<series>/`) and one per article
  (`/writing/<series>/<slug>/`). Until 2026-11-22 these lived at the site
  root; every old `/<series>/` and `/<series>/<slug>/` address (and older
  series ids) gets a redirect page. A series id can't be `writing`, `tools`,
  `products`, `about`, `brand` or `assets`.
- Free tools (`/tools/`): the list in `FREE_TOOLS`, also shown on About.
  `/tools/search-grid/` and its `privacy/` page keep their URLs (the Chrome Web
  Store links to them).
- Products (`/products/`): "Coming soon" until a product is ready.
- About (`/about/`) and `404.html`.

Every page has the menu Writing · Free tools · Products · About. Pages inside
a section have a breadcrumb band under the header (OAT › Writing › Water).
Plain HTML and one stylesheet; the only JavaScript is the optional visitor
counter below, and the only outside requests are that counter's. Every image a published article uses is downloaded into
`assets/` and the page points at the copy. Links between published
articles become site links; Substack `?r=` referral codes are removed.

Branding (oat-standards `visual-identity.md`, `sop-branding.md`): every page
has the OAT plaque logo and site name in the header, an OAT favicon, and the
tagline plus sign-off in the footer; the home page opens with the cornerstone
photo. The files are resized copies from `owencorpening/images` `brand/`,
committed in `brand/` and copied to the output's `brand/` folder, so the build
downloads nothing for them.

Custom domain: the base URL (`DEFAULT_BASE_URL` in `build-site.js`, or
`--base-url`) sets canonical links and social preview images. When it isn't a
`*.github.io` address the build writes a `CNAME` file, so GitHub Pages keeps
the custom domain after every publish.

Visitor counter: when `GOATCOUNTER_CODE` (or `--goatcounter`) is set, each
page except 404 and redirects ends with GoatCounter's `count.js`
(`https://gc.zgo.at/count.v4.js`, pinned with Subresource Integrity) plus a
`<noscript>` 1×1 image (`https://CODE.goatcounter.com/count?p=/path/&t=Title`)
for browsers without JavaScript. The script is what lets GoatCounter see the
visitor's referrer and screen size; the image can't (before 2026-11-25 the site
used only the image, so earlier visits show both as "unknown"). The script is
told the same path and short title as the image, so pages aren't split or
renamed in GoatCounter. No cookies either way. Unset means no counter and no
JavaScript at all. Articles still may not contain scripts (the build fails).

Series names, descriptions and order come from `site/series.json` in
oat-content (read from `main`):

```json
[{ "id": "water", "name": "Water Resilience", "description": "…", "order": 1 }]
```

## The Vectors series (formerly "standalone")

Articles with no `series` field are in the `vectors` series, named
"Vectors" on the site. It was called `standalone` until 2026-11-21. The old
id still works, so nothing has to be re-tagged: `pub/standalone/...` tags and
`series: standalone` headers both count as `vectors`, and if an article has
tags under both prefixes the newest date wins. The build also writes small
redirect pages at `/standalone/` and `/standalone/<slug>/` (meta refresh, no
JavaScript) so links shared before the rename still land on the right page.
`site/series.json` may give Vectors its own name, description and order with
`"id": "vectors"`; using `"id": "standalone"` there is an error.

## Moving an article to another series

1. On main, change the article's `series` header (and add the new series to
   `site/series.json` if it is new).
2. Tag it under the new series: `pub/<new-series>/<slug>/<YYYY-MM-DD>`.

Once main and a tag agree on the new series, tags under the old series are
ignored, even if they are newer or the same date. The build writes redirect
pages from `/<old-series>/<slug>/` (and `/standalone/<slug>/` if it was in
Vectors) to the new address. A series left with no articles drops off the
home page, and its `/<old-series>/` page redirects to the home page until it
has an article again. If main names a series the article has no tag in yet,
the build fails, so the live site stays as it was until you tag.

## Status

Still to come: the remaining pre-publish checks (placeholder links, sources
section) and the oat-content workflow that builds and pushes to oat-web.
