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
wrangler d1 migrations apply oat-publishing-ledger --local
wrangler d1 migrations apply oat-publishing-ledger --remote
```

Do not run these as part of local code review unless you intend to create or
mutate a real Cloudflare D1 database.

## Worker API

Endpoints:

- `POST /assets` with `{ "asset": { ... } }`
- `POST /review-image-needs` with `{ "contentDraft": { ... }, "imageNeed": { ... } }`
- `GET /image-needs/open`
- `GET /assets/staged`

Set `LEDGER_API_TOKEN` as a Worker secret when the API should require bearer
authorization. Replace the placeholder `database_id` in `worker/wrangler.jsonc`
with the ID returned by `wrangler d1 create`.
