# D1 Image Capture Bookmarklet

This bookmarklet captures a web image candidate and writes it directly to the
OAT publishing ledger Worker. It does not write to Google Sheets.

## Install

1. Edit `image-capture-bookmarklet.js`.
2. Replace `YOUR_LEDGER_API_URL_HERE` with the ledger Worker URL.
   For local testing, use `http://127.0.0.1:8787`.
3. If the Worker has `LEDGER_API_TOKEN` set, replace
   `YOUR_LEDGER_API_TOKEN_HERE` with that token. Leave the placeholder in place
   for a local Worker with no token.
4. Run:

```bash
npm run bookmarklet:build
```

5. Paste the printed `javascript:void(...)` URL into a browser bookmark.

## What It Writes

The bookmarklet sends `POST /captures/image` with the current page URL, the best
direct image URL it can find, photographer/license hints, and an optional
`intakeSection` routing hint from a local helper at `http://localhost:9876/`.

The Worker normalizes that request into an `asset` row with `status = staged`,
enriches Unsplash/Pexels photographer metadata when provider API keys are
configured, and lets the `OAT Image Staging` panel review and place it from D1.

## Related Files

- `../d1/worker/index.js` owns the `/captures/image` endpoint.
- `../d1/README.md` documents the ledger Worker API.
- `../../docs/user/image-pipeline-quickstart.md` documents the daily capture flow.
