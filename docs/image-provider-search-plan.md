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
- The tool should ask for source page, creator, license, and notes when those
  are missing.
- A downloaded file can be staged, placed, and promoted through the same D1
  placement saga as provider results.
- Provenance confidence should be visible before the image is placed.

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

The extension should not need to know provider quirks. It asks the Worker for
results, displays normalized records, and stages the selected record.

## Provider Tiers

Phase 1: finish the smooth path with already relevant providers.

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
