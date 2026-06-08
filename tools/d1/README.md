# D1 Publishing Ledger

Fresh-start D1 schema for the image and table asset pipeline.

This intentionally does not migrate the legacy image staging sheet. The current
sheet-backed panel can remain available as the old tool while new commands and
panels write directly to D1.

## Files

- `migrations/0001_image_pipeline.sql` creates the first operational ledger:
  `content_item`, `content_draft`, `asset`, `asset_placement`, `image_need`, and
  `asset_saga`.
- `worker/` contains the HTTP API that the VS Code extension can call when
  `oatImages.ledgerApiUrl` is configured.

## Later Wrangler Commands

Create the database once a Cloudflare project/config is ready:

```bash
wrangler d1 create oat-publishing-ledger
```

Apply migrations after adding the D1 binding to a Wrangler config:

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

## Worker API

Endpoints:

- `POST /assets` with `{ "asset": { ... } }`
- `POST /review-image-needs` with `{ "contentDraft": { ... }, "imageNeed": { ... } }`
- `POST /placements` with `{ "contentDraft": { ... }, "placement": { ... }, "saga": { ... } }`
- `GET /image-needs/open`
- `GET /assets/staged`
- `GET /placements/planned`

Set `LEDGER_API_TOKEN` as a Worker secret when the API should require bearer
authorization. Replace the placeholder `database_id` in `worker/wrangler.jsonc`
with the ID returned by `wrangler d1 create`.
