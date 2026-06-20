# Image Provider Search Plan

Use this plan when resuming the work to make image search feel native to the
author review flow while keeping the existing Downloads and bookmarklet paths.

## Goal

An author reviewing a markdown draft should be able to notice a dense stretch of
text, search for a sourced image inside VS Code, stage it with provenance, place
it in the draft, and continue reviewing without a browser round trip.

The browser bookmarklet and `~/Downloads` intake remain first-class fallback
paths. They are useful when a provider is not searchable from the extension,
when a site requires manual browsing, or when the author already has a file.

## User Story

Primary actor: author reviewing a draft markdown file.

Happy path:

1. The author is reading an open draft in VS Code.
2. The author sees a spot where an image should break up or clarify text.
3. The author opens `OAT Image Staging` and searches for a phrase such as
   `wetland`.
4. The sidebar shows provider results with thumbnail, source, photographer,
   license, and provider name.
5. The author clicks `Stage`.
6. The Worker creates a D1 `asset` record with provider-backed provenance.
7. The author clicks `Place`, chooses the target, and creates an
   `asset_placement`.
8. The author runs the guarded placement command when ready.
9. The placement command writes the accepted image to the images repo, writes
   provenance files, inserts the draft snippet, and updates the ledger.

The image should not enter the images repo until it is accepted for placement or
publication. Before that, it lives as ledger-managed staging state.

## Kept Paths

### In-Editor Provider Search

This becomes the smooth default path for review-time image hunts.

- Search provider APIs from VS Code.
- Keep provider keys server-side in the D1 Worker environment.
- Show only normalized, stageable records in the sidebar.
- Stage through the ledger rather than downloading directly to the images repo.
- Store enough source metadata to make provenance automatic whenever possible.

### Bookmarklet Capture

This remains the browser path for sites that need manual browsing.

- The bookmarklet captures the current source page and best direct image URL it
  can infer.
- The Worker resolves provider metadata when possible.
- The staged record uses D1, not Google Sheets.
- The author can still use the current Chrome `fi<Tab>` shortcut as discovery,
  but a search result page is not provenance.

### Downloads Intake

This remains the escape hatch for local files.

- `~/Downloads` is an intake buffer, not long-term storage.
- Downloads is a mixed inbox. It may contain candidate images, spreadsheets,
  installers, markdown files, screenshots, certificates, and other unrelated
  artifacts.
- Users may spontaneously use another AI image tool, screenshot tool, or design
  tool outside the OAT workflow. The saved filename often carries provenance or
  intent hints, such as tool name, date, timestamp, prompt fragment, subject, or
  style.
- Filename clues should seed the intake form, not silently prove provenance.
- The tool should ask for source page, creator, license, and notes when those
  are missing.
- A downloaded file can be staged, placed, and promoted through the same D1
  placement saga as provider results.
- Provenance confidence should be visible before the image is placed.

Useful filename clues:

| Example pattern | Possible inference |
|-----------------|--------------------|
| `ChatGPT Image Jun 2, 2026, 08_40_36 PM.png` | AI-generated image, likely ChatGPT, creation timestamp. |
| `syntheticBiologyTimeline-publisher-gold.svg` | Intended subject, draft/project context, style variant. |
| `photo-...unsplash...jpg` | Possible provider hint; still needs source page confirmation. |
| `screenshot-2026-06-02.png` | Screenshot, weak provenance unless a source URL is supplied. |

## Source Resolution Rule

Separate these ideas in every intake path:

| Field | Meaning |
|-------|---------|
| `sourceUrl` | Human/provider page that proves where the image came from. |
| `imageSrc` | Direct downloadable image URL or chosen binary source. |
| `provider` | Normalized provider key, such as `unsplash`, `pexels`, or `met`. |
| `providerId` | Provider-native image or object ID, when available. |
| `license` | License or manual-check status. |
| `attribution` | Caption-ready creator/source string. |

Some image sites bury the direct file behind detail pages, visit buttons,
redirects, or dynamic markup. Prefer provider APIs for resolution. Treat browser
scraping, search-result thumbnails, and local downloads as lower-confidence
fallbacks.

## Provider Adapter Shape

Keep provider-specific behavior behind a small adapter boundary:

```js
{
  id: "unsplash",
  label: "Unsplash",
  async search({ query, page, perPage }) {},
  async resolve({ providerId, sourceUrl }) {}
}
```

Normalize every result into:

```js
{
  provider,
  providerId,
  title,
  thumbnailUrl,
  imageSrc,
  sourceUrl,
  photographer,
  license,
  licenseUrl,
  attribution,
  width,
  height,
  rawProviderRecord
}
```

The extension should not need to know remote provider quirks. It asks the Worker
for remote results, displays normalized records, and stages the selected record.
Local providers such as Downloads run extension-side because the Worker cannot
read the user's filesystem.

## Provider Tiers

Phase 1: finish the smooth path with already relevant providers.

- Downloads as a local provider
- Unsplash
- Pexels
- Pixabay
- Smithsonian-on-Unsplash as discoverable Unsplash content

Phase 2: add high-value open collections.

- Wikimedia Commons
- The Met Collection

Phase 3: add broader or more heterogeneous collections.

- Smithsonian Open Access direct API
- Europeana
- Specific museums with stable open APIs or IIIF metadata

Adding providers should be easy once the adapter boundary exists. The hard part
is not usually the HTTP call; it is normalizing license, creator, source page,
direct image URL, rate limits, and search quality into a record the author can
trust.

## Downloads Local Provider

Downloads is implemented as an extension-side provider because VS Code can read
the local filesystem and the Worker cannot.

Behavior:

- Scan `~/Downloads` for likely image files: PNG, JPG, JPEG, WEBP, GIF, and SVG.
- Filter by the sidebar search query against filenames.
- Ignore unrelated files such as installers, spreadsheets, markdown drafts, and
  personal documents.
- Infer filename hints such as tool, timestamp, subject, and style.
- Return local provider results with `provider: "downloads"`, `sourcePath`,
  `sourceName`, proposed metadata, and `provenanceConfidence: "filename-hint"`.
- Compute `contentHash` only when the author clicks `Stage`.
- Stage through the same D1 `asset` shape as manual local-file intake.
- Default staged Downloads results to `needs-provenance` unless source, creator,
  and license are confirmed.

This preserves the manual `OAT Images: Intake Local File` command while making
Downloads searchable from the same sidebar flow as Pexels.

## Pexels First Implementation

Use Pexels as the first provider because the Worker already has
`PEXELS_ACCESS_KEY` support for resolving captured Pexels photo pages.

Reference: [Pexels API documentation](https://www.pexels.com/api/documentation/).

### 1. Extract the Existing Pexels Resolver

Current foothold:

- `tools/d1/worker/index.js` already calls
  `GET https://api.pexels.com/v1/photos/:id`.
- It already sends the API key in the `Authorization` header.
- `extractPexelsPhotoId()` already parses Pexels photo page URLs.

First move:

1. Create `tools/d1/worker/imageProviders/pexels.js`.
2. Move Pexels-specific URL parsing and fetch logic into that module.
3. Export:
   - `id = "pexels"`
   - `label = "Pexels"`
   - `extractPhotoId(sourceUrl)`
   - `resolve({ providerId, sourceUrl }, env)`
   - `search({ query, page, perPage }, env)`
4. Keep `resolveCapturedMetadata()` working by calling the new Pexels module.
5. Add focused tests for Pexels URL parsing and photo normalization.

### 2. Normalize Pexels Photo Records

Normalize both search results and single-photo lookup results into the same
shape:

```js
{
  provider: "pexels",
  providerId: String(photo.id),
  title: photo.alt || "Pexels Photo",
  thumbnailUrl: photo.src?.medium || photo.src?.small,
  imageSrc: photo.src?.large2x || photo.src?.large || photo.src?.original,
  sourceUrl: photo.url,
  photographer: photo.photographer,
  license: "Pexels License",
  licenseUrl: "https://www.pexels.com/license/",
  attribution: "Image: ..., by ..., Source: Pexels. License: Pexels License.",
  width: photo.width,
  height: photo.height,
  rawProviderRecord: photo
}
```

Implementation notes:

- Prefer `photo.url` as `sourceUrl`; it is the human provenance page.
- Prefer `large2x`, then `large`, then `original` as `imageSrc`.
- Keep `original` available for future placement/download choices, but do not
  require the sidebar thumbnail to use it.
- Use `photo.alt` for display text when available.

### 3. Add Worker Provider Endpoints

Add these routes in `tools/d1/worker/index.js`:

| Endpoint | Pexels-first behavior |
|----------|-----------------------|
| `GET /image-providers` | Return `{ providers: [{ id: "pexels", label: "Pexels" }] }` when `PEXELS_ACCESS_KEY` exists. |
| `GET /image-providers/search?q=wetland&providers=pexels` | Call Pexels search and return normalized results. |
| `POST /captures/provider-image` | Resolve the selected Pexels result and create a staged D1 asset. |

Search endpoint details:

1. Require `q`.
2. Default `providers=pexels` for the first implementation.
3. Clamp `perPage` to a small value, such as 12 or 20.
4. Call `GET https://api.pexels.com/v1/search` with `query`, `page`, and
   `per_page`.
5. Return normalized records under `{ results: [...] }`.
6. Return an empty result set, not a Worker crash, when the provider request
   fails.

Provider staging endpoint details:

1. Accept `{ provider: "pexels", providerId }` or a normalized search result.
2. Resolve fresh Pexels metadata by ID before writing D1 when possible.
3. Create an `asset` with:
   - `assetType: "image"`
   - `sourceUrl: normalized.sourceUrl`
   - `imageSrc: normalized.imageSrc`
   - `photographer: normalized.photographer`
   - `license: normalized.license`
   - `attribution: normalized.attribution`
   - `status: "staged"`
4. Use a stable ID such as `asset_pexels_${providerId}` only if duplicates
   should collapse; otherwise use the existing generated asset ID style.

### 4. Add Worker Tests

Extend `tools/d1/worker/ledgerApiWorker.test.js` or add a provider-specific test
file.

Minimum tests:

1. `GET /image-providers` hides Pexels when `PEXELS_ACCESS_KEY` is missing.
2. `GET /image-providers` includes Pexels when `PEXELS_ACCESS_KEY` exists.
3. `GET /image-providers/search?q=wetland&providers=pexels` calls the Pexels
   search endpoint with the Authorization header.
4. Search normalizes `id`, `url`, `src`, `photographer`, `alt`, `width`, and
   `height`.
5. `POST /captures/provider-image` creates a staged asset from a Pexels ID.
6. Failed Pexels fetch returns a controlled response.

### 5. Add Extension Client Methods

Update `extensions/image-staging/lib/ledgerApiClient.js`:

1. `listImageProviders()`
2. `searchImageProviders({ query, providers, page, perPage })`
3. `stageProviderImage({ provider, providerId, sourceUrl })`

Add tests in `extensions/image-staging/test/ledgerApiClient.test.js` for URL,
method, token, and request body shape.

### 6. Add Sidebar Search UI

Update `extensions/image-staging/views/imagePanelProvider.js`.

Extension-side message handling:

1. Add webview message type `providerSearch`.
2. Add webview message type `stageProviderImage`.
3. Call the new ledger client methods.
4. After staging, refresh the staged list.

Webview UI:

1. Add a compact search row above staged assets.
2. Start with one provider filter: `Pexels`.
3. Render provider results separately from staged assets.
4. Each provider result gets `Stage`; staged assets keep `Place` and `Discard`.
5. Show photographer, license, and source domain on each result.

Keep the first UI pass simple. The important behavior is that an author can
search, stage, and place without leaving VS Code.

### 7. Local Smoke Test

1. Start the ledger service with `PEXELS_ACCESS_KEY` available.
2. Open a draft in VS Code.
3. Open `OAT Image Staging`.
4. Search `wetland`.
5. Stage one Pexels result.
6. Confirm it appears in staged assets with source URL, direct image URL,
   photographer, license, and attribution.
7. Click `Place` and create a planned placement.
8. Run `OAT Images: Prepare Planned Placement Run`.

### 8. Expected First Commit Shape

Likely files:

- `tools/d1/worker/imageProviders/pexels.js`
- `tools/d1/worker/index.js`
- `tools/d1/worker/ledgerApiWorker.test.js`
- `extensions/image-staging/lib/ledgerApiClient.js`
- `extensions/image-staging/test/ledgerApiClient.test.js`
- `extensions/image-staging/views/imagePanelProvider.js`
- docs updates if the UI command names change

Verification:

```bash
npm run test:d1-worker
npm run test:image-staging
npm test
```

## API Plan

The D1 Worker should own provider search so browser/API keys stay out of VS Code
settings.

Candidate endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /image-providers` | List enabled providers and labels. |
| `GET /image-providers/search?q=wetland&providers=unsplash,pexels` | Search normalized provider results. |
| `POST /captures/provider-image` | Stage a selected provider result as an asset. |
| `POST /captures/image` | Existing bookmarklet capture endpoint. |

The provider staging endpoint can either accept the normalized search result or
accept `{ provider, providerId, sourceUrl }` and resolve fresh metadata before
writing D1. Prefer resolving fresh metadata if provider rate limits allow it.

## VS Code UX Plan

The `OAT Image Staging` sidebar should support:

- Search input.
- Provider filter.
- Result grid or list with thumbnail, provider, creator, and license.
- `Stage` action on each result.
- Provenance status after staging.
- Existing staged image list.
- Existing `Place` and `Discard` actions.

The author should not need explanatory text in the UI to understand the happy
path. The controls should be ordinary: search box, filters, buttons, and staged
image actions.

## Implementation Checklist

1. Add provider adapter modules and unit tests.
2. Add Worker provider registry and search endpoint.
3. Add Worker provider staging endpoint.
4. Store provider metadata in D1 using existing fields first; add columns only
   when the current schema cannot represent a required provenance field.
5. Add extension client methods for provider list, search, and stage.
6. Add sidebar search UI and provider filters.
7. Show provider results separately from already staged assets.
8. Stage selected provider results into D1.
9. Keep bookmarklet and Downloads commands unchanged except for clearer
   provenance prompts/status.
10. Add docs and quickstart updates.
11. Run unit tests and at least one local ledger smoke test.

## Interruption Recovery

When resuming midway:

1. Run `git status --short`.
2. Read this file and [image-pipeline-architecture.md](image-pipeline-architecture.md#source-intake).
3. Check whether provider adapters, Worker endpoints, extension client methods,
   or sidebar UI are the current incomplete layer.
4. Run `npm test` before committing code changes.
5. For Worker changes, run `npm run test:d1-worker`.
6. For bookmarklet changes, run `npm run bookmarklet:build`.

Resumable milestones:

- Milestone A: provider adapter tests pass.
- Milestone B: Worker search endpoint returns normalized records.
- Milestone C: selected provider result can be staged into D1.
- Milestone D: VS Code sidebar can search and stage without leaving the draft.
- Milestone E: staged provider image can be placed through the existing saga.

## Open Questions

- Should provider search fan out across all enabled providers by default, or
  default to one provider with explicit filters?
- Should provider results be cached in D1 for rate-limit protection, or only
  selected staged assets?
- How should the UI mark weaker provenance from Downloads or scraped pages?
- Which providers need moderation, AI-generated-image flags, or content filters?
- Should Wikimedia Commons and museum providers use direct APIs, IIIF manifests,
  or both?
