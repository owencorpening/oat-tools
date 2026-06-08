# Image Pipeline Architecture

This note reconciles the running VS Code extensions with the content standards
currently kept in `~/dev/wraith/standards`. It is the working architecture target
for content, asset, and audience-aware publishing workflows.

For the broader plan to split the current mixed `wraith` workspace into repos by
role, see [repo-refactor-plan.md](repo-refactor-plan.md).

## Core Contract

The pipeline uses durable stores by role, not by repo name:

| Store | Role |
|-------|------|
| Content repo | Drafts, standards, templates, source markdown, carousel files, and publish workflow notes. Currently `~/dev/wraith`. |
| Asset repo | Final publishable public assets and provenance files. Currently `~/dev/images`. |
| Tool repo | VS Code extensions, Workers, scripts, tests, and pipeline implementation. Currently this repo. |
| Publishing ledger | Preferred transactional ledger for content records, asset records, source intake, placement state, audience relationships, and retry/cleanup status. In this stack, this is Cloudflare D1. |
| Raw GitHub URL | Permanent published reference for Substack, carousel, and handoff output. |

VS Code is one interface over this pipeline. The extension should orchestrate the
workflow, but the lifecycle rules should live in reusable pipeline modules.

## Publishing Data Model

The image pipeline is one piece of a larger publishing system. Anticipate an
audience, paid or otherwise, and keep that relationship in the database rather
than in Git.

Core publishing ledger entities:

| Entity | Purpose |
|--------|---------|
| `content_item` | Article, carousel, LinkedIn post, table, or other publishable work. |
| `content_draft` | Working draft identity before publication, including repo path, draft path, and optional heading anchors. |
| `asset` | Image, table screenshot, generated diagram, source file, or hosted media item. |
| `asset_placement` | Join between a content item and an asset, including figure number, target, URL, and status. |
| `image_need` | Review-time visual need tied to a draft location, reason, status, and eventual resolved asset. |
| `publication_channel` | Substack, LinkedIn, Buffer, raw GitHub, or another distribution surface. |
| `publication_event` | When a content item was published, where, and with which URL. |
| `audience_member` | A person or account known to the system. Store only what is needed. |
| `subscription` | Free, paid, complimentary, trial, cancelled, or external subscription state. |
| `entitlement` | What an audience member can access or receive. |
| `engagement_event` | Optional record of opens, clicks, comments, replies, referrals, or manual notes. |

Git repos should not be named as domain concepts in the data model. Instead,
records should describe roles:

- `content_repo_path`
- `asset_repo_path`
- `tool_repo_path`
- `published_url`
- `raw_asset_url`

This keeps the model stable if the content repo stops being named `wraith`, if
assets move out of Git, or if a second asset backend is added.

Audience and payment rules:

- Do not store audience lists, email addresses, payment records, or private
  customer notes in Git.
- Do not store card details or payment secrets in the publishing ledger. Use a
  payment/subscription provider as the authority for money movement.
- The publishing ledger may store provider IDs, subscription state, entitlement
  state, timestamps, and lightweight relationship notes needed by the publishing
  workflow.
- Public content and public assets can live in Git. Private audience state lives
  in the ledger.

Model assets and placements separately:

- `asset` owns intake, identity, provenance, file hashes, license state, final
  public asset path, and raw asset URL.
- `asset_placement` owns publication target, figure number, draft insertion
  location, target-specific snippet state, placement status, and published URL.
- A single asset may have multiple placements, such as a Substack figure, a
  carousel background, and a LinkedIn handoff.

## Ledger Choice

Cloudflare D1 is the preferred shared ledger implementation because this repo already uses
Cloudflare Workers for table promotion. Keeping the asset ledger in the same
platform gives the pipeline a natural place to handle transactional state and
removes Google Sheets from the image workflow target.

Use the publishing ledger for:

- Asset records and immutable asset IDs.
- Content draft records and draft locations when a visual need is tied to a
  working markdown file rather than a published content item.
- Intake state for captured URLs, Downloads files, AI-generated files, and
  review-triggered image hunts.
- Provenance fields and manual-check flags.
- Placement transactions and retry status.
- Links to generated table Sheets and screenshots.
- Cleanup queues for abandoned candidates, failed downloads, and orphaned table
  promotion attempts.

Eliminate Google Sheets from the target image pipeline:

- No staging sheet as the image queue.
- No sheet row as the canonical image record.
- No sheet update as the placement/discard transaction.
- No sheet-specific service account path for image workflow state.

Keep Google Sheets only for promoted tables when the sheet itself is the
reader-facing accessible data artifact.

## Fresh-Start Plan

This image pipeline is clean-slate D1. Spreadsheet continuity is not part of the
implementation target.

Fresh-start rules:

- Do not build sheet-backed adapters or image sheet import jobs.
- Build the ledger, intake, saga, and panel against the publishing ledger from
  the first implementation step.
- Keep capture, placement, discard, and retry state in D1.

Fresh-start baby steps implemented in this repo:

1. Created the first ledger schema for `asset`, `asset_placement`, `image_need`,
   `content_draft`, and `asset_saga`.
2. Added `assetLedgerD1.js` with small ledger functions:
   `createAsset`, `createPlacement`, `createImageNeed`, `markSagaStep`,
   `markPlaced`, `markFailed`, `listOpenNeeds`, `listStagedAssets`, and
   `listPlannedPlacements`.
3. Added path-specific intake functions in `imageIntake.js` for URLs, Downloads
   files, AI-generated files, user-provided files, and review-triggered needs.
4. Added a thin `imagePipeline.js` that runs one ledger-backed placement saga
   from an existing asset record to a placed snippet.
5. Added ledger Worker API endpoints for assets, review image needs, placements,
   open needs, staged assets, and planned placements.
6. Added VS Code commands and panel entry points for ledger URL intake, local-file
   intake, review image needs, staged assets, planned placements, and planned
   placement instructions.
7. Kept local side-effect execution explicit: `OAT Images: Prepare Planned
   Placement Run` copies placement instructions instead of silently touching the
   asset repo, Git, or the active draft.

8. Added `OAT Images: Execute Planned Placement Run`, a guarded local command
   that calls `imagePipeline.placeAsset`, writes or replaces the draft snippet,
   and updates saga state through Worker-backed ledger lifecycle endpoints.
9. Added the D1 image capture bookmarklet under `tools/bookmarklet` and a Worker
   `POST /captures/image` route so browser capture writes directly to D1.

Remaining implementation gap:

- After image placement works end to end in daily use, route table screenshots through the
  same asset saga and shared asset repo utilities.

Keep Git for:

- Final, publishable assets.
- Provenance files required by the content standards.
- Stable raw GitHub URLs referenced by drafts and published posts.

Do not require Git for:

- Candidate images.
- Failed downloads.
- AI experiments.
- Review-hunt scratch assets.
- Temporary render files.

Those should stay in ledger-managed staging state and temporary storage until
they are accepted for publication.

## Source Intake

Images can enter the pipeline from several places:

- **Author draft review:** the author is reading an open markdown draft and
  notices a spot where a visual should go. This is the human trigger for the
  Downloads path, bookmarklet path, or existing-staged-image path.
- **Browser provider search:** current manual path using the Chrome `fi<Tab>`
  shortcut to search `site:unsplash.com OR site:pexels.com OR
  site:pixabay.com` plus the author's search term. This is discovery, not
  provenance; results can still include previews or linked assets from other
  sites.
- **D1 bookmarklet captures:** images captured in the browser by the bookmarklet
  in `tools/bookmarklet`. The bookmarklet posts page/source metadata to the
  ledger Worker, which enriches provider metadata when API keys are configured
  and creates a staged `asset` record.
- **In-editor provider search:** target-state flow where the author searches
  providers such as Unsplash or Pexels from the VS Code sidebar, stages a result
  with provider-backed provenance, and stays in the draft-review loop. The
  resumable implementation plan is
  [image-provider-search-plan.md](image-provider-search-plan.md).
- **`~/Downloads`:** local files that may have been generated, downloaded, or
  routed by a watcher.
- **AI-generated files:** obvious generated images such as `chatgpt*.png` or
  similar filenames. These often carry useful filename metadata such as date,
  timestamp, prompt fragments, or generation source.
- **Unprovenanced local files:** images found in `~/Downloads` or supplied by
  the user where source, creator, and license are missing or incomplete.
- **User-provided image:** an image the user spontaneously wants to place, even
  if it was not pre-staged.
- **Review-triggered image hunt:** during final review, the user spots a dense
  stretch of prose and decides the article needs a visual break, such as a
  diagram, map, table, or sourced image at that location.

The pipeline should normalize all of these into an asset record or an
`image_need` before placement. Placement-specific choices should be captured only
when the user decides where and how the asset will be used.

Source-page resolution rule:

- Store the human source page separately from the direct image URL.
- Prefer provider APIs for source metadata and direct image URLs when available.
- Treat browser scraping and Downloads intake as fallback paths, because some
  sites hide the actual image behind detail pages, visit buttons, redirects, or
  dynamic markup.
- Do not treat a search result page or thumbnail preview as provenance; resolve
  to the provider/source page before staging when possible.
- If a direct image URL cannot be resolved with confidence, keep the asset
  staged or `needs-provenance` until the author confirms the source.

## Asset And Placement Records

A normalized asset record should carry intake and provenance fields:

| Field | Purpose |
|-------|---------|
| `slug` | Canonical kebab-case asset slug used for new published paths. |
| `displayName` | Human-readable name for captions, alt text, and review UI. |
| `sourceName` | Original captured name or filename before normalization. |
| `sourcePath` | Local file path when the image starts on disk. |
| `sourceUrl` | Original web/source URL when known. |
| `imageSrc` | Direct downloadable image URL when known. |
| `contentHash` | File hash used to deduplicate local intake and make retries idempotent. |
| `photographer` | Photographer, creator, or `Owen Corpening` for originals. |
| `license` | License string or explicit manual-check status. |
| `attribution` | Caption-ready attribution string. |
| `intakeSection` | Optional routing hint from intake, such as `water-series/part-09` or `standalone/<article>`. |
| `assetPath` | Final repo-relative path after publication, when known. |
| `rawAssetUrl` | Raw GitHub URL or other durable public asset URL, when known. |
| `status` | `candidate`, `staged`, `publishing`, `published`, `discarded`, or `needs-provenance`. |

If the pipeline cannot prove provenance, it should keep the image in
`needs-provenance` rather than silently treating it as publishable.
`intakeSection` is only a convenience for staging and review; `assetPath`
supersedes it once the asset is promoted, and placement records should own
content relationships.

Placement records should carry target-specific fields:

| Field | Purpose |
|-------|---------|
| `assetId` | Asset being placed. |
| `contentItemId` | Published or publishable work that will contain the asset. |
| `contentDraftId` | Draft receiving the snippet before publication, when applicable. |
| `target` | `substack`, `carousel`, `linkedin-post`, or another placement target. |
| `figureNumber` | Figure number for article placement. |
| `draftLocation` | Structured draft pointer, such as file path plus line range or heading anchor. |
| `snippet` | Target-specific generated embed or handoff text. |
| `snippetFormat` | `html-figure`, `marp-image`, `linkedin-handoff-text`, or another explicit render format. |
| `status` | `planned`, `publishing`, `placed`, `published`, `removed`, or `failed`. |

`draftLocation` should be structured JSON rather than a loose sentence whenever
possible. A minimal shape is `{ "path": "...", "heading": "...", "lineStart": 0,
"lineEnd": 0 }`.

Image need records should carry review-time visual gaps:

| Field | Purpose |
|-------|---------|
| `contentDraftId` | Draft that needs a visual anchor. |
| `draftLocation` | Structured draft pointer for the dense passage, placeholder, heading, or selected text. |
| `reason` | Short reason, such as `dense prose`, `needs map`, `needs concept diagram`, `needs sourced photo`, or `needs table`. |
| `neededAssetKind` | Optional hint such as `photo`, `diagram`, `map`, `table`, or `ai-image`. |
| `status` | `open`, `resolved`, or `dismissed`. |
| `resolvedAssetId` | Asset selected or created to satisfy the need. |
| `resolvedPlacementId` | Placement that inserted or handed off the resolved asset. |
| `createdAt` | When the need was recorded. |
| `resolvedAt` | When the need was resolved or dismissed. |

## Transaction Model

The publishing ledger can make the record changes transactional, but it cannot
make filesystem writes, Git commits, table Google Sheet creation, and editor
edits part of one database transaction. Model those steps as an idempotent saga:

| Step | Forward action | Idempotency key | Compensation or retry rule | Resolution |
|------|----------------|-----------------|-----------------------------|------------|
| 1 | Create or update an asset record with `status = publishing`. | `asset.id` or `contentHash` for local files. | Restore previous status if no external side effect has happened. | `auto-retry` or `discard` |
| 2 | Write or move files into a staging location. | Staging path derived from `asset.id`. | Delete staging files if the asset is discarded before promotion. | `auto-retry` or `discard` |
| 3 | Promote accepted files into the asset repo. | Repo-relative `assetPath`. | Re-run as overwrite-if-same-hash; otherwise stop for manual conflict review. | `auto-retry` or `manual-review` |
| 4 | Write provenance files and optional `asset.json`. | Repo-relative metadata paths. | Re-run as replace; provenance should be deterministic from the asset record. | `auto-retry` |
| 5 | Commit and push final assets. | Git tree state plus commit message containing `asset.id` or slug. | Retry push if commit exists; if commit failed, re-run add/commit on the same paths. | `auto-retry` or `manual-review` |
| 6 | Insert or replace the draft snippet. | `asset_placement.id` and `draftLocation`. | Replace an existing generated snippet for the same placement instead of inserting a duplicate. | `auto-retry` or `manual-review` |
| 7 | Mark the `asset_placement` `placed` and the asset `published` when appropriate. | `asset_placement.id`. | Recompute from repo state and draft snippet if the ledger update failed after side effects. | `auto-retry` |

Each saga record should store `current_step`, `last_error`, `retry_count`,
`next_retry_at`, `resolution`, and a short `compensation` note. `resolution`
drives UI behavior: `auto-retry` can be retried by the orchestrator, `manual-review`
needs a VS Code notification or queue item, and `discard` runs cleanup for
abandoned work. If any step fails, keep the current step and error in the
publishing ledger so the pipeline can retry or clean up deliberately. This is
safer than scattering half-finished state across `~/Downloads`, `/tmp`, and the
asset repo.

## Review-Triggered Image Hunt

The image need often appears late, during final review. The user sees a dense
block of text and decides the article needs a visual anchor before it publishes.

That should be modeled as a pipeline entry point:

1. Capture the current draft location or selected text.
2. Record the reason for the image need, such as `dense prose`, `needs map`,
   `needs concept diagram`, `needs sourced photo`, or `needs table`.
3. Create an `image_need` record with `draftLocation`, `reason`, and
   `status = open`.
4. Let the user choose an intake path:
   - Search/source a web image and capture it directly to the ledger.
   - Use an existing staged image.
   - Use a local image from `~/Downloads`.
   - Provide or generate an AI image.
   - Promote a nearby markdown table if the visual need is really data.
5. Continue through normal provenance, placement, and snippet generation.
6. Resolve the `image_need` with `resolved_asset_id`,
   `resolved_placement_id`, and `status = resolved`.

This keeps final-review image hunts from becoming an undocumented side path.
It also lets review UI show open needs for a draft, such as three requested
visual breaks with two already resolved.

## Downloads Handling

`~/Downloads` should be treated as an intake buffer, not storage.
It is also a mixed human workspace: the same folder may contain candidate
images, AI outputs, screenshots, spreadsheets, installers, markdown drafts, and
personal files. Intake should filter for likely image assets and never assume
that everything in the folder belongs to the pipeline.

For local source files:

1. Detect likely image files and sidecar metadata.
2. Compute `contentHash` before moving or renaming the file.
3. Upsert intake records by `contentHash` when available, falling back to
   source URL or filename only when there is no file content to hash.
4. Infer useful fields from the filename when possible. AI tools, screenshot
   tools, and design tools often save names with tool, date, timestamp, subject,
   prompt fragment, draft context, or style hints.
5. Store filename-derived fields as proposed metadata with a confidence marker,
   not as confirmed provenance.
6. Ask for or record missing provenance before placement.
7. Move the image into the asset repo at the final `assetPath`.
8. Write provenance files alongside the image:
   - `url.txt`
   - `license.txt`
   - `photographer.txt`
9. Remove or move sidecar/source files so `~/Downloads` is not left carrying
   finished assets.

This follows the content standard that `~/Downloads` should be empty of processed
assets when the pipeline is done.

Filename hints are especially useful for spontaneous images created outside the
OAT workflow, such as `ChatGPT Image Jun 2, 2026, 08_40_36 PM.png` or
`syntheticBiologyTimeline-publisher-gold.svg`. They can prefill source/tool,
creation date, subject, and slug candidates, but the user should still confirm
creator, license, and publishability.

## Placement Outputs

For a publishable image, placement creates:

- An asset folder in the asset repo.
- The image file.
- Provenance files.
- A raw GitHub URL.
- A target-specific snippet.
- A ledger `asset_placement` transition to `placed`.

For Substack body images, the snippet should be an HTML figure:

```html
<figure>
  <img src="IMAGE_URL" width="400" style="display:block" alt="DESCRIPTION">
  <figcaption>Figure N: ATTRIBUTION_STRING</figcaption>
</figure>
```

For carousels, the output should be Marp-aware and reuse the same raw GitHub URL.

For LinkedIn handoff, the output should be clipboard text with image URL and
attribution instructions, because the image is attached manually in LinkedIn.

## Table Promotion Pipeline

Table promotion is an asset pipeline too. It starts from markdown table source
inside a draft and produces both a Google Sheet and a generated image asset.

Current behavior:

1. Parse markdown tables from the active markdown editor.
2. Create a styled Google Sheet from the table headings and rows through the
   Cloudflare Worker.
3. Render the table locally as HTML.
4. Take a headless screenshot of the rendered table.
5. Save the PNG into the asset repo.
6. Commit and push the generated PNG.
7. Replace the original markdown table with a figure embed whose caption links
   readers to the full data sheet.

Architecture target:

- Treat generated table screenshots as first-class assets in the same asset repo.
- Run table screenshot promotion through the same asset saga rather than through
  a parallel untracked path.
- Store table provenance metadata:
  - `url.txt` = Google Sheet URL
  - `photographer.txt` = `Owen Corpening`
  - `license.txt` = OAT rights/license string
- Reconcile naming with the content table standard:
  `part[NN]-table-[descriptor]-preview.png`.
- Keep the accessible data link in the caption or linked figure consistently
  across article and carousel outputs.

Table promotion maps onto the saga with one table-specific side effect:

| Saga step | Table promotion action |
|-----------|------------------------|
| 1 | Create an `asset` for the table screenshot and an `asset_placement` for the draft replacement. |
| 1.5 | Create the reader-facing Google Sheet and store its URL as provenance/source metadata. |
| 2 | Render the markdown table as local HTML and screenshot it into staging. |
| 3 | Promote the PNG into the asset repo at the final `assetPath`. |
| 4 | Write `url.txt`, `photographer.txt`, `license.txt`, and optional `asset.json`. |
| 5 | Commit and push the PNG and metadata files. |
| 6 | Replace the markdown table with the generated figure embed. |
| 7 | Mark the `asset_placement` `placed` and the asset `published` when the repo and draft agree. |

The current table tool already performs most side effects, but wiring it to the
publishing ledger and saga retry state is a migration gap to close.

## Suggested Module Boundaries

```text
extensions/image-staging/lib/
├── imageRecord.js        # normalize and validate records
├── imageIntake.js        # composed intake functions for URL, Downloads, AI, and user files
├── assetLedgerD1.js      # publishing ledger asset records, state transitions, retry log
├── imageAssetsRepo.js    # asset repo paths, provenance files, raw URLs, git
├── imagePipeline.js      # thin saga orchestrator and retry routing
└── snippetBuilder.js     # substack, carousel, linkedin-post snippets

extensions/table-tools/lib/
├── tableRecord.js        # parsed table descriptor and naming
├── tableAssetsRepo.js    # screenshot paths, metadata, raw URLs, git
└── tableEmbedBuilder.js  # article/carousel embed output
```

The goal is for VS Code views and commands to call pipeline functions instead of
embedding workflow rules directly in UI handlers. `imagePipeline.js` should stay
thin: it calls `assetLedgerD1` for steps 1 and 7, `imageAssetsRepo` for file and
Git side effects, and `snippetBuilder` for target-specific output. It should not
become the home for record validation, repo path rules, thumbnail resolution, or
provider-specific intake logic.

`imageIntake.js` should compose separate intake functions for URL capture,
Downloads files, AI-generated files, and user-provided files. Each intake path
has different inference and provenance rules, so the module should avoid becoming
a single branching handler.

`imageAssetsRepo.js` and `tableAssetsRepo.js` should share common asset repo
utilities for path resolution, provenance file writes, raw URL generation, and
Git add/commit/push. As table screenshots move fully onto the same asset saga,
`tableAssetsRepo.js` should either become a thin table-specific wrapper around
the shared utilities or merge into the shared asset repo module.
