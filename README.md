# OAT Tools — VS Code Extension

Owen's Applied Thinking content production commands.

---

## Commands

### OAT: Promote All Tables in Document

Scans the active markdown file, finds every markdown table, and for each one:

1. Calls the Cloudflare Worker (`oat-promote-tables`) which creates a styled Google Sheet
2. Screenshots the table as a PNG via a local HTML render + headless browser
3. Commits and pushes the PNG to the `owencorpening/images` repo
4. Replaces the markdown table in the editor with a `<figure>` embed:

```html
<figure>
  <img width="560" src="https://raw.githubusercontent.com/owencorpening/images/main/..." alt="...">
  <figcaption><a href="https://docs.google.com/spreadsheets/d/...">View full data table</a></figcaption>
</figure>
```

All tables are promoted in one pass. Replacements are applied bottom-up so line numbers stay valid.

---

## Install

```bash
cd ~/.vscode/extensions
ln -s ~/dev/oat-tools-vscode oat-tools-0.2.0
```

Reload VS Code. Commands appear in the Command Palette.

---

## Configuration

| VS Code setting | Required | Description |
|-----------------|----------|-------------|
| `oat.workerUrl` | Yes | Cloudflare Worker URL for sheet creation |
| `oat.unsplashAccessKey` | No | Unsplash API key for image panel thumbnails |
| `oat.imageStagingSheetId` | No | Google Sheet ID for image staging panel |
| `oat.imagesRepoPath` | No | Local images repo. Defaults to `~/dev/images` |
| `oat.screenshotScriptPath` | No | Local screenshot script for table PNG rendering |

Set in `settings.json`:
```json
{
  "oat.workerUrl": "https://oat-promote-tables.owencorpening.workers.dev"
}
```

---

## Setup: Cloudflare Worker

The Worker lives in `worker/` and is deployed to Cloudflare. It handles Google Sheets
creation and OAT styling, keeping table-promotion credentials out of the extension.

### Auth model

Table promotion uses an OAuth refresh token so generated Sheets are created as your
Google user and use your Drive quota. This is intentional for personal Google Drive
accounts, where service accounts can authenticate but cannot reliably own new Drive
files.

Create or use an OAuth 2.0 Client ID, then run:

```bash
node scripts/get-refresh-token.js
```

The script asks for `client_id` and `client_secret`, opens a browser consent flow,
and sets these Worker secrets automatically:

| Secret | Description |
|--------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token for Sheets/Drive access |

### Deploy

```bash
cd worker
npx wrangler deploy
```

---

## Image Staging Panel

The camera icon in the activity bar opens the Image Staging panel. Reads from the
Google Sheet set in `oat.imageStagingSheetId` and shows rows where column H is `staged`.

---

## File structure

```
oat-tools-vscode/
├── extension.js              ← command handlers
├── package.json              ← command registration, settings schema
├── lib/
│   ├── parseTables.js        ← markdown table parser
│   └── imageStagingSheet.js  ← image staging sheet reader
├── scripts/
│   └── get-refresh-token.js  ← OAuth flow + auto-sets Worker secrets ★
├── views/
│   └── imagePanelProvider.js ← webview panel for staged images
└── worker/
    ├── index.js              ← Cloudflare Worker (sheet creation + OAT styling)
    └── wrangler.toml         ← Worker config
```

---

## No npm dependencies

Extension uses only Node.js built-ins and the VS Code API. No `npm install` required.
Worker uses only Cloudflare Workers runtime globals (`fetch`, `Response`).
