# OAT Tools Extension Split Plan

Plan and implementation notes for splitting the former combined `oat-tools` VS
Code extension into two separately installable extensions inside this monorepo.

Status: implemented in the monorepo layout on June 6, 2026. Keep this doc as
the migration map and follow-up checklist.

Implementation note, June 6, 2026: the split was committed as
`f8d9dd6 Split extensions and tighten table screenshots`. Table promotion was
verified after the split, including the tightened table screenshot crop.

## Goal

End with two independent VS Code extensions:

1. `OAT Table Tools`
   - Promotes markdown tables into styled Google Sheets and PNG figure embeds.
   - Owns the Cloudflare Worker and table screenshot pipeline.
2. `OAT Image Staging`
   - Shows staged image records from the D1 publishing ledger.
   - Plans, discards, and tracks publishing images.

Both extensions should be installable side by side without command, setting, or
view ID collisions.

## Proposed Monorepo Shape

```text
oat-tools-vscode/
├── extensions/
│   ├── table-tools/
│   │   ├── package.json
│   │   ├── extension.js
│   │   ├── lib/
│   │   ├── scripts/
│   │   ├── test/
│   │   └── worker/
│   └── image-staging/
│       ├── package.json
│       ├── extension.js
│       ├── lib/
│       ├── views/
│       ├── media/
│       └── credentials/
├── docs/
│   └── split-plan.md
└── README.md
```

Avoid creating shared code until duplication becomes painful. A little duplicated
Node helper code is cheaper than coupling the two extensions too early.

## Ownership Map

### Table Tools

Files owned by `extensions/table-tools/`:

- `extensions/table-tools/extension.js`
- `extensions/table-tools/lib/parseTables.js`
- `extensions/table-tools/test/parseTables.test.js`
- `extensions/table-tools/worker/index.js`
- `extensions/table-tools/worker/wrangler.toml`
- `extensions/table-tools/scripts/get-refresh-token.js`
- table screenshot/render scripts and helpers

Settings renamed:

- `oat.workerUrl` -> `oatTables.workerUrl`
- `oat.imagesRepoPath` -> `oatTables.imagesRepoPath`
- `oat.screenshotScriptPath` -> `oatTables.screenshotScriptPath`

Command renamed:

- `oat.promoteAllTables` -> `oatTables.promoteAllTables`

### Image Staging

Files owned by `extensions/image-staging/`:

- `extensions/image-staging/views/imagePanelProvider.js`
- `extensions/image-staging/media/camera.svg`
- `extensions/image-staging/lib/assetLedgerD1.js`
- `extensions/image-staging/lib/imagePipeline.js`
- `extensions/image-staging/lib/ledgerApiClient.js`
- `extensions/image-staging/lib/plannedPlacementRun.js`
- `extensions/image-staging/lib/request.js`

Settings renamed:

- `oat.unsplashAccessKey` -> `oatImages.unsplashAccessKey`
- `oat.imagesRepoPath` -> `oatImages.imagesRepoPath`
- `oatImages.ledgerApiUrl` is the required image ledger setting.

Command/view IDs renamed:

- `oat.refreshImagePanel` -> `oatImages.refreshPanel`
- `oat-images` -> `oat-image-staging`
- `oatImagePanel` -> `oatImages.panel`

## Migration Sequence

Completed:

1. Moved table files into `extensions/table-tools/`.
2. Moved image staging files into `extensions/image-staging/`.
3. Gave each extension its own `package.json`.
4. Converted the root `package.json` into monorepo metadata.
5. Updated the root README to describe both install paths.
6. Verified Table Tools command registration in VS Code.
7. Smoke-tested table promotion against live credentials.

Remaining manual validation:

1. Install both extension folders with separate symlinks.
2. Confirm Image Staging activity bar registration in VS Code.
3. Smoke-test image placement against live credentials.

## Test Plan

Automated tests should stay focused on pure logic:

- Keep `parseTables` coverage.
- Add tests when moving or extracting descriptor, path, or snippet generation.
- Avoid mocking the full VS Code host unless a regression makes it worthwhile.

Manual smoke tests are more valuable for the VS Code, D1, screenshot, and Git
integration paths:

- Table Tools command appears in the Command Palette.
- Table Tools rejects non-markdown editors.
- Table Tools promotes a sample markdown table end to end.
- Image Staging activity bar icon appears.
- Image Staging panel loads staged D1 records.
- Place creates the expected image repo files and snippet.
- Discard marks the D1 asset record discarded.

## Benchmarks

No benchmarks needed for the split. Runtime is dominated by network calls,
Google APIs, screenshot rendering, and Git pushes. Reliability and clean extension
boundaries matter more than speed.

## Open Questions

- Should the hard-coded `water-series` image path become a setting during the split?
- Should `gas/promote-tables.gs` stay with Table Tools, or be archived if the Worker
  is now the canonical table-promotion backend?
