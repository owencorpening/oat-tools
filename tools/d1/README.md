# D1 Publishing Ledger

Fresh-start D1 schema for the image and table asset pipeline.

The image pipeline is clean-slate D1: the ledger is the source of truth for
image capture, staging, placement, and discard state. The legacy "Images"
Google Sheet still exists as a human-readable mirror — the image-capture
Apps Script forwards bookmarklet captures to `POST /captures/image` and its
`syncFromLedger()` (hourly trigger) upserts sheet rows from `GET /assets`.

## Deployment

Deployed 2026-07-19 at **https://oat-publishing-ledger.owencorpening.workers.dev**
(D1 database `oat-publishing-ledger`, id in `worker/wrangler.jsonc`). Secrets
set on the Worker: `LEDGER_API_TOKEN` (bearer auth — same value as the
`oatImages.ledgerApiToken` VS Code setting), `UNSPLASH_ACCESS_KEY`,
`PEXELS_ACCESS_KEY`. Redeploy after code changes with:

```bash
cd tools/d1/worker && npx wrangler deploy
```

The Worker entry is `worker/entry.mjs`, a module-format shim over the
CommonJS `worker/index.js` (D1 bindings reject service-worker-format
uploads; index.js stays CommonJS for tests and `ledger:dev:node`).

## Files

- `migrations/0001_image_pipeline.sql` creates the first operational ledger:
  `content_item`, `content_draft`, `asset`, `asset_placement`, `image_need`, and
  `asset_saga`.
- `worker/` contains the HTTP API that the VS Code extension can call when
  `oatImages.ledgerApiUrl` is configured.
- `../bookmarklet/` contains the browser capture bookmarklet that writes image
  candidates to this Worker instead of Google Sheets.

## Wrangler Commands

The production database already exists and has migrations applied (see
Deployment above). These commands remain for local dev and future migrations:

```bash
npm run ledger:migrations:list:local
npm run ledger:migrations:apply:local
npm run ledger:migrations:apply:remote
```

The Worker config lives in `worker/wrangler.jsonc` and points its D1 binding at
`../migrations`, so the commands can be run from the `worker/` directory once
the placeholder `database_id` has been replaced.

Do not run the remote apply command as part of local code review unless you
intend to mutate a real Cloudflare D1 database.

Run the Worker locally after local migrations have been applied:

```bash
npm run ledger:dev
```

If Wrangler's local `workerd` runtime fails to start its D1 binding, use the
Node-backed local Worker server instead:

```bash
npm run ledger:dev:node
```

This serves the same Worker request handler at `http://127.0.0.1:8787`, applies
the local schema automatically, and stores its SQLite ledger at
`tools/d1/worker/.wrangler/state/local-ledger.sqlite`.

## Worker API

Endpoints:

- `POST /assets` with `{ "asset": { ... } }`
- `POST /captures/image` with browser capture fields such as `sourceUrl`,
  `imageSrc`, `displayName`, `photographer`, `license`, and `intakeSection`.
  The Worker normalizes these into a staged `asset` row. When
  `UNSPLASH_ACCESS_KEY` or `PEXELS_ACCESS_KEY` is configured, the Worker also
  asks the provider API for authoritative photographer metadata before writing
  the asset.
- `GET /image-providers` lists enabled image search providers. Pexels appears
  when `PEXELS_ACCESS_KEY` is configured.
- `GET /image-providers/search?q=wetland&providers=pexels` searches enabled
  providers and returns normalized results with source URL, direct image URL,
  photographer, license, and attribution fields.
- `POST /captures/provider-image` stages a selected provider result as a D1
  `asset`. For Pexels, the Worker resolves the selected photo ID before writing
  the staged asset when the API key is available.
- `POST /review-image-needs` with `{ "contentDraft": { ... }, "imageNeed": { ... } }`
- `POST /placements` with `{ "contentDraft": { ... }, "placement": { ... }, "saga": { ... } }`
- `POST /sagas/:id/step`
- `POST /sagas/:id/failed`
- `POST /assets/:id/publishing`
- `POST /assets/:id/publication`
- `POST /assets/:id/discarded`
- `POST /placements/:id/publishing`
- `POST /placements/:id/snippet`
- `POST /placements/:id/placed`
- `GET /image-needs/open`
- `GET /assets/staged`
- `GET /assets` — every asset joined with its latest placement and draft
  title; powers the Google Sheet mirror sync
- `GET /placements/planned`

VS Code commands that use this API:

- `OAT Images: Intake URL`
- `OAT Images: Intake Local File`
- `OAT Images: Create Review Image Need`
- `OAT Images: List Open Image Needs`
- `OAT Images: List Staged Notebook Images`
- `OAT Images: List Planned Image Placements`
- `OAT Images: Prepare Planned Placement Run`
- `OAT Images: Execute Planned Placement Run`

Set `LEDGER_API_TOKEN` as a Worker secret when the API should require bearer
authorization (the deployed Worker has it set).

Optional capture metadata secrets:

- `UNSPLASH_ACCESS_KEY`
- `PEXELS_ACCESS_KEY`

These replace the old Google Apps Script Script Properties used by the
sheet-backed capture endpoint. In deployed Cloudflare Workers, store them as
Worker secrets. In `npm run ledger:dev:node`, pass them as environment
variables before starting the local server.
