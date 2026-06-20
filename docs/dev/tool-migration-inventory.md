# Tool Migration Inventory

This inventory classifies tool-like files currently found in `~/dev/wraith`.
It does not move or delete files from that repo. Use it to decide what belongs
in this tool repo, what belongs in a future platform repo, what belongs in a lab
repo, and what should not be migrated.

## Imported Here

| Source | Destination | Notes |
|--------|-------------|-------|
| `tools/blockquoteRenderer.py` | `tools/blockquotes/blockquote-renderer.py` | Productized as a reusable publishing tool with configurable asset repo, section, and slug. |
| New tool | `tools/carousels/export-carousel.js` | Wraps Marp carousel PDF export with standard theme, output naming, local-file flag, and dry-run support. |
| New tool | `tools/assets/validate-provenance.js` | Validates final asset folders for `url.txt`, `license.txt`, and `photographer.txt`. |

## Already Superseded Here

| Source | Current replacement | Notes |
|--------|---------------------|-------|
| `scripts/screenshot-html.sh` | `extensions/table-tools/scripts/screenshot-html.sh` | Table Tools already carries its own screenshot script. |
| `scripts/table-promote.js` | `extensions/table-tools/extension.js` plus Worker | The old script starts from an existing Google Sheet. Current Table Tools promotes markdown tables end to end. |
| `scripts/TABLE-PROMOTE-README.md` | `docs/use-cases.md` and `docs/image-pipeline-architecture.md` | Keep old README as historical reference only. |

## Candidate For Tool Repo

| Source | Proposed destination | Notes |
|--------|----------------------|-------|
| `scripts/generate_chart.py` | `tools/charts/` or lab | Candidate if it is a reusable chart generator rather than one article's one-off helper. |
| `scripts/getFiles.py` | `tools/files/` or lab | Needs purpose review before importing. |

## Better Next Tool Candidates

| Tool idea | Proposed destination | Notes |
|-----------|----------------------|-------|
| Pre-publish review checker | `tools/review/` | Automate parts of the pre-publish checklist: frontmatter, CTA block, table promotion reminders, image references, and common formatting problems. |
| D1 asset ledger bootstrap | `tools/d1/` or platform repo | Create/migrate the first D1 schema for content, assets, placements, and pipeline states. |

## Candidate For Lab Repo

| Source | Reason |
|--------|--------|
| `scripts/SecureMarkdownPDF.sh` | Old Mac-specific markdown-to-password-protected-PDF helper. Not central to the current publishing pipeline. Archive unless password-protected PDFs become active again. |
| `widgets/planetary-aquifer-registry.html` | Prototype/widget, not a reusable publishing tool yet. |
| `scripts/fred_vc_plot.py` | Research/chart exploration tied to a topic. |
| `scripts/fred_vc_extended.py` | Research/chart exploration tied to a topic. |
| `scripts/fred_charts/` | Generated chart outputs. Move final public outputs to asset repo only when published. |
| `scripts/read_mp3_metadata.py` | Media utility; not part of current OAT publishing pipeline. |
| `scripts/split_mp3s.py` | Media utility; not part of current OAT publishing pipeline. |
| `scripts/stem_separator.py` | Media utility; not part of current OAT publishing pipeline. |

## Do Not Import As-Is

| Source | Reason |
|--------|--------|
| `scripts/cookies.txt` | Credential/session material. Do not commit to any repo. |
| `scripts/YoutubeScrape.py` | Depends on local cookie/session behavior; only migrate after replacing credential handling. |
| `scripts/CaptainMidnightDownloader.sh` | Downloader workflow likely tied to external media and local credentials/state. Review before migration. |

## Migration Rules

- Import only reusable tools with clear inputs, outputs, and documentation.
- Do not import generated outputs, cookies, logs, virtual environments, or context dumps.
- Replace hard-coded repo names with role-based paths such as content repo,
  asset repo, and tool repo.
- Prefer environment variables and command-line flags over local absolute paths.
- Add tests when a migrated tool has parsing, naming, path, or output-contract
  logic that can regress.
