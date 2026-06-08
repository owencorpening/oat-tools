# OAT Tools VS Code Extensions

Owen's Applied Thinking content production tools for VS Code.

This repo is a monorepo with two separately installable extensions:

- `OAT Table Tools` for markdown table promotion
- `OAT Image Staging` for staged image placement

For the fastest image ledger walkthrough, see
[docs/image-pipeline-quickstart.md](docs/image-pipeline-quickstart.md). For the
workflow-level guide to what each tool is for and how to use it, see
[docs/use-cases.md](docs/use-cases.md). For the working architecture target that
reconciles these extensions with the content standards, see
[docs/image-pipeline-architecture.md](docs/image-pipeline-architecture.md). For
the provider-search plan that keeps bookmarklet and Downloads intake, see
[docs/image-provider-search-plan.md](docs/image-provider-search-plan.md). For
the broader repository split plan, see
[docs/repo-refactor-plan.md](docs/repo-refactor-plan.md). For the inventory of
tool-like files being migrated from the current content workspace, see
[docs/tool-migration-inventory.md](docs/tool-migration-inventory.md).

---

## Extensions

### OAT Table Tools

Location: `extensions/table-tools/`

Command:

- `OAT Tables: Promote All Tables in Document`

Scans the active markdown file, finds every markdown table, and for each one:

1. Calls the Cloudflare Worker (`oat-promote-tables`) to create a styled Google Sheet
2. Screenshots the table as a PNG via a local HTML render and headless browser
3. Commits and pushes the PNG to the `owencorpening/images` repo
4. Replaces the markdown table in the editor with a `<figure>` embed

Settings:

| VS Code setting | Required | Description |
|-----------------|----------|-------------|
| `oatTables.workerUrl` | Yes | Cloudflare Worker URL for sheet creation |
| `oatTables.imagesRepoPath` | No | Local images repo. Defaults to `~/dev/images` |
| `oatTables.screenshotScriptPath` | No | Local screenshot script. Defaults to `scripts/screenshot-html.sh` in the extension if present, then `~/dev/wraith/scripts/screenshot-html.sh` |

For transition, Table Tools also reads the old `oat.*` setting names as fallbacks.

### OAT Image Staging

Location: `extensions/image-staging/`

Activity bar view:

- `OAT Image Staging`

Commands:

- `OAT Images: Refresh Image Panel`
- `OAT Images: Intake URL`
- `OAT Images: Intake Local File`
- `OAT Images: Create Review Image Need`
- `OAT Images: List Open Image Needs`
- `OAT Images: List Staged Notebook Images`
- `OAT Images: List Planned Image Placements`
- `OAT Images: Prepare Planned Placement Run`

The panel reads staged assets from the image ledger Worker when
`oatImages.ledgerApiUrl` is configured. The image pipeline is clean-slate D1;
it does not use Google Sheets for staging, placement, or discard state.

In this stack, the image ledger is backed by Cloudflare D1. Ledger-native image
work can intake URL/local assets, create review image needs, plan placements,
list planned placements, prepare placement instructions, execute guarded local
placement, and mark staged assets discarded.

Settings:

| VS Code setting | Required | Description |
|-----------------|----------|-------------|
| `oatImages.ledgerApiUrl` | Yes | D1 ledger Worker API URL |
| `oatImages.ledgerApiToken` | No | Bearer token for the D1 ledger Worker |
| `oatImages.imagesRepoPath` | No | Local images repo. Defaults to `~/dev/images` |
| `oatImages.unsplashAccessKey` | No | Unsplash API key for thumbnail previews |

---

## Local Install

Install each extension separately:

```bash
cd ~/.vscode/extensions
ln -s ~/dev/oat-tools-vscode/extensions/table-tools oat-table-tools-0.1.0
ln -s ~/dev/oat-tools-vscode/extensions/image-staging oat-image-staging-0.1.0
```

Reload VS Code. The table command appears in the Command Palette, and the image
staging panel appears in the activity bar.

---

## Cloudflare Worker

The table-promotion Worker lives in `extensions/table-tools/worker/`. It handles
Google Sheets creation and OAT styling, keeping table-promotion credentials out
of the extension.

Table promotion uses an OAuth refresh token so generated Sheets are created as
your Google user and use your Drive quota.

Create or use an OAuth 2.0 Client ID, then run:

```bash
node extensions/table-tools/scripts/get-refresh-token.js
```

The script asks for `client_id` and `client_secret`, opens a browser consent flow,
and sets these Worker secrets automatically:

| Secret | Description |
|--------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token for Sheets/Drive access |

Deploy:

```bash
cd extensions/table-tools/worker
npx wrangler deploy
```

---

## Tests

```bash
npm test
```

The current automated test coverage is focused on markdown table parsing. VS Code,
Google API, screenshot, and Git workflows should be smoke-tested manually.

---

## File Structure

```text
oat-tools-vscode/
├── extensions/
│   ├── table-tools/
│   │   ├── extension.js
│   │   ├── package.json
│   │   ├── lib/
│   │   ├── scripts/
│   │   ├── test/
│   │   ├── gas/
│   │   └── worker/
│   └── image-staging/
│       ├── extension.js
│       ├── package.json
│       ├── lib/
│       ├── views/
│       ├── media/
│       └── scripts/
├── docs/
│   ├── image-pipeline-architecture.md
│   ├── image-provider-search-plan.md
│   ├── repo-refactor-plan.md
│   ├── split-plan.md
│   ├── tool-migration-inventory.md
│   └── use-cases.md
├── tools/
│   ├── assets/
│   ├── blockquotes/
│   └── carousels/
└── package.json
```

---

## Dependencies

The extensions use only Node.js built-ins and the VS Code API. No `npm install`
is required for extension runtime code.

External workflow dependencies still apply: `git`, `bash`, a screenshot script
and browser setup, `wrangler` for Worker deployment, and Google credentials for
table promotion.
