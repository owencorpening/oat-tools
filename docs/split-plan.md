# OAT Tools Extension Split Plan

Draft plan for splitting the current combined `oat-tools` VS Code extension into
two separately installable extensions inside this monorepo.

## Goal

End with two independent VS Code extensions:

1. `OAT Table Tools`
   - Promotes markdown tables into styled Google Sheets and PNG figure embeds.
   - Owns the Cloudflare Worker and table screenshot pipeline.
2. `OAT Image Staging`
   - Shows staged image rows from the image staging sheet.
   - Places, discards, and tracks publishing images.

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

Current files likely owned by `extensions/table-tools/`:

- `extension.js` table-promotion command code
- `lib/parseTables.js`
- `test/parseTables.test.js`
- `worker/index.js`
- `worker/wrangler.toml`
- `scripts/get-refresh-token.js`
- table screenshot/render scripts and helpers

Current settings to rename:

- `oat.workerUrl` -> `oatTables.workerUrl`
- `oat.imagesRepoPath` -> `oatTables.imagesRepoPath`
- `oat.screenshotScriptPath` -> `oatTables.screenshotScriptPath`

Current command to rename:

- `oat.promoteAllTables` -> `oatTables.promoteAllTables`

### Image Staging

Current files likely owned by `extensions/image-staging/`:

- `views/imagePanelProvider.js`
- `media/camera.svg`
- `lib/imageStagingSheet.js`
- `lib/imageWorkflow.js`
- `lib/serviceAccountAuth.js`
- `lib/thumbResolver.js`
- `lib/request.js`
- `credentials/service-account.json`
- image staging sheet setup helpers

Current settings to rename:

- `oat.imageStagingSheetId` -> `oatImages.sheetId`
- `oat.unsplashAccessKey` -> `oatImages.unsplashAccessKey`
- `oat.imagesRepoPath` -> `oatImages.imagesRepoPath`

Current command/view IDs to rename:

- `oat.refreshImagePanel` -> `oatImages.refreshPanel`
- `oat-images` -> `oat-image-staging`
- `oatImagePanel` -> `oatImages.panel`

## Migration Sequence

1. Keep the current root extension working.
2. Extract table-promotion logic into table-focused modules at the root.
3. Move table files into `extensions/table-tools/`.
4. Give Table Tools its own `package.json` and local install instructions.
5. Run parser tests and manually smoke-test command registration.
6. Move image staging files into `extensions/image-staging/`.
7. Give Image Staging its own `package.json` and local install instructions.
8. Manually smoke-test panel load, refresh, place, and discard flows.
9. Remove the old combined root extension package only after both split extensions
   load independently.
10. Update the root README to describe the monorepo and both install paths.

## Test Plan

Automated tests should stay focused on pure logic:

- Keep `parseTables` coverage.
- Add tests when moving or extracting descriptor, path, or snippet generation.
- Avoid mocking the full VS Code host unless a regression makes it worthwhile.

Manual smoke tests are more valuable for the VS Code, Google, screenshot, and Git
integration paths:

- Table Tools command appears in the Command Palette.
- Table Tools rejects non-markdown editors.
- Table Tools promotes a sample markdown table end to end.
- Image Staging activity bar icon appears.
- Image Staging panel loads staged rows.
- Place creates the expected image repo files and snippet.
- Discard marks the sheet row and handles placed images as expected.

## Benchmarks

No benchmarks needed for the split. Runtime is dominated by network calls,
Google APIs, screenshot rendering, and Git pushes. Reliability and clean extension
boundaries matter more than speed.

## Open Questions

- Should credentials remain inside each extension directory, or should local docs
  point to a configurable credential path?
- Should the hard-coded `water-series` image path become a setting during the split?
- Should `gas/promote-tables.gs` stay with Table Tools, or be archived if the Worker
  is now the canonical table-promotion backend?
- Should old `oat.*` settings be read as fallbacks for one transition release?
